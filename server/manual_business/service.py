"""Independent fixed intent construction and one-shot signing reservations."""
import json
from eth_utils import keccak
from server.backend import canonical
from server.contracts import ApiError
from server.chain.client import ChainConflict
from .runtime import plan_digest


class BusinessService:
    def __init__(self, backend):
        self.b, self.store, self.rpc, self.gate = backend, backend.store, backend.rpc, backend.runtime

    def intent(self, db, operation_id):
        op = db.execute('SELECT * FROM operations WHERE id=?', (operation_id,)).fetchone()
        if not op: raise ApiError(404, 'NOT_FOUND', 'Original operation missing')
        kind = 'fund' if op['kind'] == 'support' else op['kind']
        p = self.gate.require(db, kind)
        if kind == 'fund':
            row = db.execute('SELECT * FROM support_intents WHERE operation_id=?', (operation_id,)).fetchone()
            if not row or row['quote_expires_at'] <= self.b.now()*1000:
                raise ApiError(409, 'REVIEW_EXPIRED', 'Original funding review expired')
            tx = {'to': self.rpc.contract.address, 'chainId': self.b.policy.chain_id,
                  'data': self.rpc.contract.encode_abi('fund', args=[row['intent_id'], row['quantity'], self.b.policy.rule]),
                  'value': row['value_wei'], 'from': p['participants']['supporter']}
            if tx['data'] != row['data'] or tx['from'].lower() != row['payer'].lower(): raise ChainConflict('Original funding changed')
        elif kind == 'issue':
            if not self.b.work.dispatch_authorized(db, op): raise ApiError(403, 'MAPPING_REVOKED', 'Issue authorization changed')
            vouchers = [r['id'] for r in db.execute('SELECT id FROM private_vouchers WHERE operation_id=? ORDER BY rowid', (operation_id,))]
            tx = {**self.b.action_transaction(kind, operation_id, {'batchId': op['target'], 'voucherIds': vouchers}),
                  'from': p['participants']['issuer']}
        elif kind in ('lock', 'report', 'settle'):
            r = db.execute('SELECT * FROM redemptions WHERE id=?', (op['redemption_id'],)).fetchone()
            if not r or r['voucher_id'] != op['target']: raise ChainConflict('Original redemption changed')
            if kind in ('lock', 'report') and not self.b.work.dispatch_authorized(db, op):
                raise ApiError(403, 'MAPPING_REVOKED', 'Service action authorization changed')
            payload = {'voucherId': r['voucher_id']}
            if kind != 'settle': payload['lockId'] = r['lock_id']
            tx = {**self.b.action_transaction(kind, operation_id, payload),
                  'from': p['participants']['merchant' if kind == 'settle' else 'operator']}
        else: raise ApiError(403, 'ACTION_NOT_AUTHORIZED', 'Fixed business action required')
        if kind in ('issue', 'lock', 'report'):
            queued = db.execute('SELECT * FROM outbox WHERE operation_id=?', (operation_id,)).fetchone()
            expected = {k: v for k, v in tx.items() if k != 'from'}
            if not queued or json.loads(queued['tx_json']) != expected or queued['signer'].lower() != tx['from'].lower():
                raise ChainConflict('Persisted intent differs from independent ABI construction')
        return dict(op), kind, tx

    def review(self, operation_id):
        with self.store.transaction() as db:
            op, kind, tx = self.intent(db, operation_id)
            existing = db.execute('SELECT * FROM cp28_signing WHERE operation_id=?', (operation_id,)).fetchone()
            if existing: return {'operationId': operation_id, 'maySign': False, 'state': existing['state']}
            saved = db.execute('SELECT review FROM cp28_wallet_reviews WHERE operation_id=?', (operation_id,)).fetchone()
            if saved: return json.loads(saved['review'])
            cap = self.gate.plan['actions'][kind]
        with self.rpc.observation(ids=[operation_id]):
            final = self.rpc.guard()
            role = {'fund': 'SUPPORTER', 'issue': 'ISSUER', 'lock': 'OPERATOR', 'report': 'OPERATOR', 'settle': 'SETTLER'}[kind]
            if not self.rpc.read('hasRole', [keccak(text=role+'_ROLE'), tx['from']], final['number']):
                raise ApiError(403, 'CHAIN_ROLE_REQUIRED', 'Current chain permission required')
            if kind in ('issue', 'lock', 'report'):
                for forbidden in (bytes(32), keccak(text='SETTLER_ROLE'), keccak(text='SUPPORTER_ROLE')):
                    if self.rpc.read('hasRole', [forbidden, tx['from']], final['number']):
                        raise ApiError(403, 'SERVICE_ROLE_EXCESS', 'Service signer has excessive chain permissions')
            if kind != 'report' and self.rpc.read('paused', [], final['number']):
                raise ApiError(409, 'PAUSED', 'Business is paused')
            if kind == 'fund' and self.rpc.read('totalFunded', [], final['number']) != 0:
                raise ApiError(409, 'NEW_ROUND_REQUIRED', 'New one-meal round requires an unused verified deployment')
            nonce = self.rpc.nonce(tx['from'])
            balance = self.rpc.balance(tx['from'])
            if balance < tx['value']+cap['gas']*cap['maxFeePerGas']:
                raise ApiError(409, 'BALANCE_REQUIRED', 'Insufficient value and worst-case fee balance')
            if self.rpc.estimate({**tx, 'nonce': nonce, **{k: cap[k] for k in ('gas', 'maxFeePerGas', 'maxPriorityFeePerGas')}}) > cap['gas']:
                raise ApiError(409, 'BUDGET_EXCEEDED', 'Estimate exceeds reviewed gas cap')
        complete = {**tx, 'nonce': nonce, **{k: cap[k] for k in ('gas', 'maxFeePerGas', 'maxPriorityFeePerGas')}}
        review = {'operationId': operation_id, 'kind': kind, 'maySign': True, 'transaction': complete,
                  'configDigest': self.gate.config_digest, 'authorizationDigest': plan_digest(self.gate.plan), 'expiresAt': self.b.now()+120}
        with self.store.transaction() as db:
            self.gate.require(db, kind)
            db.execute('INSERT OR IGNORE INTO cp28_wallet_reviews VALUES(?,?)', (operation_id, canonical(review)))
            return json.loads(db.execute('SELECT review FROM cp28_wallet_reviews WHERE operation_id=?', (operation_id,)).fetchone()['review'])

    def start(self, review, *, actor=None, service=False):
        op_id = review['operationId']
        with self.store.transaction() as db:
            self.gate.require(db)
            if db.execute('SELECT 1 FROM cp28_signing WHERE operation_id=?', (op_id,)).fetchone(): return False
            saved = db.execute('SELECT review FROM cp28_wallet_reviews WHERE operation_id=?', (op_id,)).fetchone()
            if not saved or saved['review'] != canonical(review): raise ChainConflict('Server review changed')
        # Fresh chain checks immediately before the atomic signing boundary, outside SQLite.
        tx = review['transaction']; kind = review['kind']
        with self.rpc.observation(ids=[op_id]):
            final = self.rpc.guard()
            role = {'fund': 'SUPPORTER', 'issue': 'ISSUER', 'lock': 'OPERATOR', 'report': 'OPERATOR', 'settle': 'SETTLER'}[kind]
            if not self.rpc.read('hasRole', [keccak(text=role+'_ROLE'), tx['from']], final['number']):
                raise ApiError(403, 'CHAIN_ROLE_REQUIRED', 'Original chain permission changed')
            if kind in ('issue', 'lock', 'report'):
                for forbidden in (bytes(32), keccak(text='SETTLER_ROLE'), keccak(text='SUPPORTER_ROLE')):
                    if self.rpc.read('hasRole', [forbidden, tx['from']], final['number']):
                        raise ApiError(403, 'SERVICE_ROLE_EXCESS', 'Service signer has excessive chain permissions')
            if kind != 'report' and self.rpc.read('paused', [], final['number']): raise ApiError(409, 'PAUSED', 'Business paused')
            if kind == 'fund' and self.rpc.read('totalFunded', [], final['number']) != 0:
                raise ApiError(409, 'NEW_ROUND_REQUIRED', 'Existing funding cannot be reused as a new round')
            if self.rpc.nonce(tx['from']) != tx['nonce']: raise ApiError(409, 'NONCE_CHANGED', 'Original nonce changed; no automatic replacement')
            if self.rpc.balance(tx['from']) < tx['value']+tx['gas']*tx['maxFeePerGas'] or self.rpc.estimate(tx) > tx['gas']:
                raise ApiError(409, 'BUDGET_EXCEEDED', 'Original balance or fee cap no longer sufficient')
        with self.store.transaction() as db:
            op, kind, expected = self.intent(db, op_id)
            saved = db.execute('SELECT review FROM cp28_wallet_reviews WHERE operation_id=?', (op_id,)).fetchone()
            if not saved or saved['review'] != canonical(review): raise ChainConflict('Server review changed')
            if service and kind not in ('issue', 'lock', 'report'):
                raise ApiError(403, 'SIGNER_ACTION_DENIED', 'Service only issues, locks and reports')
            if not service and kind not in ('fund', 'settle'):
                raise ApiError(403, 'WALLET_ACTION_DENIED', 'User wallet only funds and settles')
            if (review['configDigest'] != self.gate.config_digest or review['expiresAt'] <= self.b.now() or
                    review['authorizationDigest'] != plan_digest(self.gate.plan)):
                raise ApiError(409, 'REVIEW_EXPIRED', 'Review context changed or expired')
            tx = review['transaction']
            if any(tx.get(k) != v for k, v in expected.items()): raise ChainConflict('Review transaction changed')
            if kind == 'settle':
                if actor is None: raise ApiError(401, 'AUTH_REQUIRED', 'Owner identity required')
                self.b.owner_wallet.scoped(db, actor, op_id, proof=True)
                intent = db.execute('SELECT * FROM owner_settlements WHERE operation_id=?', (op_id,)).fetchone()
                if not intent or intent['review_expires_at'] <= self.b.now():
                    raise ApiError(409, 'REVIEW_EXPIRED', 'Original owner review expired')
            if not self.gate.start(db, op_id, kind, tx, {'configDigest': self.gate.config_digest}): return False
            if kind == 'settle':
                db.execute('UPDATE owner_settlements SET submission_started_at=? WHERE operation_id=?', (self.b.now(), op_id))
            db.execute("UPDATE operations SET status='SUBMISSION_UNKNOWN' WHERE id=?", (op_id,))
            if service: db.execute("UPDATE outbox SET signing_stage='SIGNING_STARTED' WHERE operation_id=?", (op_id,))
            return True
