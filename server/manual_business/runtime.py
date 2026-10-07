"""Finite signing authority. Caller supplies a reviewed plan, never an HTTP body."""
import json
import re
import time
from server.backend import canonical, digest
from server.contracts import ApiError

ACTIONS = {'fund', 'issue', 'lock', 'report', 'settle', 'proof'}
TX_FIELDS = {'from', 'to', 'data', 'value', 'chainId', 'nonce', 'gas', 'maxFeePerGas', 'maxPriorityFeePerGas'}


def deny(code, message):
    raise ApiError(409, code, message)


def integer(value):
    if type(value) is not int or value < 0:
        deny('INVALID_RUNTIME_PLAN', 'Nonnegative integer cap required')
    return value


def address(value):
    if not isinstance(value, str) or not re.fullmatch(r'0x[0-9a-fA-F]{40}', value):
        deny('INVALID_RUNTIME_PLAN', 'Explicit public participant required')
    return value.lower()


def plan_digest(plan):
    return digest(canonical(plan))


class RuntimeGate:
    def __init__(self, store, config, plan=None, clock=time.time, source_check=None):
        self.store, self.config, self.plan, self.clock = store, config, plan, clock
        self.config_digest = digest(canonical(config))
        self.source_check = source_check

    def validate(self):
        if digest(canonical(self.config)) != self.config_digest:
            deny('RUNTIME_CHANGED', 'Loaded configuration changed')
        if self.source_check is not None: self.source_check()
        p = self.plan
        required = {'version', 'runId', 'configDigest', 'chainId', 'genesisHash', 'deploymentId',
                    'expiresAt', 'participants', 'actions', 'totalValueWei', 'totalFeeWei'}
        if not isinstance(p, dict) or set(p) != required:
            deny('RUNTIME_NOT_AUTHORIZED', 'Complete reviewed runtime plan required')
        if type(p['version']) is not int or p['version'] != 1 or p['configDigest'] != self.config_digest:
            deny('RUNTIME_CHANGED', 'Configuration or authorization changed')
        for k in ('runId', 'chainId', 'genesisHash', 'deploymentId'):
            if p[k] != self.config.get(k): deny('RUNTIME_CHANGED', 'Runtime identity mismatch')
        if integer(p['expiresAt']) <= int(self.clock()): deny('RUNTIME_EXPIRED', 'Runtime authorization expired')
        integer(p['totalValueWei']); integer(p['totalFeeWei'])
        roles = {'admin', 'supporter', 'merchant', 'issuer', 'operator'}
        if not isinstance(p['participants'], dict) or set(p['participants']) != roles:
            deny('INVALID_RUNTIME_PLAN', 'All participant roles required')
        participants = {k: address(v) for k, v in p['participants'].items()}
        if p['participants'] != self.config.get('participants'):
            deny('RUNTIME_CHANGED', 'Participant configuration changed')
        if {participants['issuer'], participants['operator']} & {participants['admin'], participants['merchant']}:
            deny('INVALID_RUNTIME_PLAN', 'Service signer must not be admin or merchant')
        if not isinstance(p['actions'], dict) or not p['actions'] or set(p['actions']) - ACTIONS:
            deny('INVALID_RUNTIME_PLAN', 'Finite allowed actions required')
        for kind, cap in p['actions'].items():
            if not isinstance(cap, dict) or set(cap) != {'count', 'gas', 'maxFeePerGas', 'maxPriorityFeePerGas', 'value'}:
                deny('INVALID_RUNTIME_PLAN', 'Every per-action cap is required')
            for v in cap.values(): integer(v)
            if not cap['count'] or cap['maxPriorityFeePerGas'] > cap['maxFeePerGas']:
                deny('INVALID_RUNTIME_PLAN', 'Invalid count or priority fee')
            if kind == 'proof':
                if any(cap[k] for k in ('gas', 'maxFeePerGas', 'maxPriorityFeePerGas', 'value')):
                    deny('INVALID_RUNTIME_PLAN', 'Proof is not a transaction')
            elif not cap['gas'] or not cap['maxFeePerGas']:
                deny('INVALID_RUNTIME_PLAN', 'Transaction fee caps cannot be zero')
            if kind != 'fund' and cap['value']:
                deny('INVALID_RUNTIME_PLAN', 'Only funding transfers value')
        return p

    def require(self, db, kind=None):
        p = self.validate()
        row = db.execute('SELECT * FROM cp28_identity WHERE id=1').fetchone()
        if not row or row['run_id'] != p['runId'] or row['config_digest'] != self.config_digest:
            deny('RESTORE_QUARANTINED', 'Run identity or configuration mismatch')
        if row['halted']: deny('RUNTIME_HALTED', 'Original operation requires reconciliation')
        if row['plan_digest'] and row['plan_digest'] != plan_digest(p):
            deny('RUNTIME_CHANGED', 'Existing authorization cannot be replaced in place')
        if kind is not None and kind not in p['actions']:
            deny('ACTION_NOT_AUTHORIZED', 'Action absent from runtime plan')
        return p

    def start(self, db, operation_id, kind, tx, context):
        """Atomic with domain transition in the same ManualStore transaction."""
        p = self.require(db, kind)
        previous = db.execute('SELECT * FROM cp28_signing WHERE operation_id=?', (operation_id,)).fetchone()
        review = canonical({'kind': kind, 'tx': tx, 'context': context})
        if previous:
            if previous['review'] != review: deny('INTENT_CONFLICT', 'Original review changed')
            return False
        cap = p['actions'][kind]
        role = {'fund': 'supporter', 'issue': 'issuer', 'lock': 'operator', 'report': 'operator',
                'settle': 'merchant', 'proof': 'merchant'}[kind]
        if kind == 'proof':
            if set(tx) != {'from', 'message'} or address(tx['from']) != address(p['participants'][role]):
                deny('TRANSACTION_MISMATCH', 'Bound owner proof required')
            nonce, fee, value = None, 0, 0
        else:
            if set(tx) != TX_FIELDS or address(tx['from']) != address(p['participants'][role]):
                deny('TRANSACTION_MISMATCH', 'Exact reviewed transaction fields required')
            if tx['chainId'] != p['chainId'] or address(tx['to']) != address(self.config['contractAddress']):
                deny('TRANSACTION_MISMATCH', 'Wrong chain or contract')
            if not re.fullmatch(r'0x(?:[0-9a-fA-F]{2})+', tx['data']):
                deny('TRANSACTION_MISMATCH', 'Invalid ABI data')
            for k in ('nonce', 'gas', 'maxFeePerGas', 'maxPriorityFeePerGas', 'value'): integer(tx[k])
            if any(tx[k] > cap[k] for k in ('gas', 'maxFeePerGas', 'maxPriorityFeePerGas', 'value')):
                deny('BUDGET_EXCEEDED', 'Transaction exceeds reviewed cap')
            if not tx['gas'] or not tx['maxFeePerGas'] or tx['maxPriorityFeePerGas'] > tx['maxFeePerGas']:
                deny('TRANSACTION_MISMATCH', 'Invalid transaction fee fields')
            nonce, fee, value = tx['nonce'], tx['gas'] * tx['maxFeePerGas'], tx['value']
            occupied = db.execute('SELECT 1 FROM cp28_signing WHERE lower(sender)=? AND nonce=?',
                                  (address(tx['from']), nonce)).fetchone()
            if occupied: deny('NONCE_RESERVED', 'Original sender nonce already reserved')
        rows = db.execute('SELECT kind,fee_reserved,value_reserved FROM cp28_signing').fetchall()
        if sum(r['kind'] == kind for r in rows) >= cap['count']:
            deny('BUDGET_EXCEEDED', 'Action count exhausted')
        if sum(int(r['fee_reserved']) for r in rows) + fee > p['totalFeeWei']:
            deny('BUDGET_EXCEEDED', 'Total fee budget exhausted')
        if sum(int(r['value_reserved']) for r in rows) + value > p['totalValueWei']:
            deny('BUDGET_EXCEEDED', 'Total value budget exhausted')
        db.execute('UPDATE cp28_identity SET plan_digest=? WHERE id=1', (plan_digest(p),))
        db.execute('''INSERT INTO cp28_signing(operation_id,kind,sender,nonce,review,state,fee_reserved,value_reserved,started_at)
                      VALUES(?,?,?,?,?,'SIGNING_STARTED',?,?,?)''',
                   (operation_id, kind, address(tx['from']), nonce, review, str(fee), str(value), int(self.clock())))
        return True

    def unknown(self, operation_id):
        with self.store.transaction() as db:
            db.execute("UPDATE cp28_signing SET state='UNKNOWN' WHERE operation_id=? AND state IN ('SIGNING_STARTED','SIGNED','BROADCAST_STARTED')", (operation_id,))

    def record_hash(self, operation_id, tx_hash):
        if not isinstance(tx_hash, str) or not re.fullmatch(r'0x[0-9a-fA-F]{64}', tx_hash):
            deny('TRANSACTION_MISMATCH', 'Invalid original hash')
        with self.store.transaction() as db:
            row = db.execute('SELECT * FROM cp28_signing WHERE operation_id=?', (operation_id,)).fetchone()
            if not row: deny('SIGNING_NOT_STARTED', 'Original signing marker required')
            if row['tx_hash'] and row['tx_hash'].lower() != tx_hash.lower():
                deny('INTENT_CONFLICT', 'Original hash already bound')
            db.execute("UPDATE cp28_signing SET tx_hash=?,state='UNKNOWN' WHERE operation_id=?", (tx_hash, operation_id))

    def account_receipt(self, db, operation_id, tx, receipt):
        """Invoke only after canonical, finalized transaction/event checks. Never releases count."""
        row = db.execute('SELECT * FROM cp28_signing WHERE operation_id=?', (operation_id,)).fetchone()
        if not row: deny('SIGNING_NOT_STARTED', 'Missing original signing context')
        expected = json.loads(row['review'])['tx']
        actual_fee = integer(receipt['gasUsed']) * integer(receipt['effectiveGasPrice'])
        matches = all(tx.get(k) == v for k, v in expected.items())
        if (not matches or actual_fee > int(row['fee_reserved']) or
                receipt['gasUsed'] > expected['gas'] or receipt['status'] not in (0, 1)):
            db.execute("UPDATE cp28_identity SET halted='ACTUAL_TRANSACTION_CONFLICT' WHERE id=1")
            return False
        db.execute('UPDATE cp28_signing SET state=?,fee_reserved=?,value_reserved=?,actual_fee=? WHERE operation_id=?',
                   ('FINALIZED_SUCCESS' if receipt['status'] else 'FINALIZED_REVERT', str(actual_fee),
                    str(expected['value'] if receipt['status'] else 0), str(actual_fee), operation_id))
        return True
