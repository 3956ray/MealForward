"""Bounded original-operation observation; no signer access or automatic retries."""
import json
from hexbytes import HexBytes
from web3._utils.events import get_event_data
from server.backend import canonical
from server.chain.client import ChainConflict, ChainUnavailable, plain
from server.projection import Projector
from .rpc import number

NAMES = {'fund': 'Funded', 'issue': 'Issued', 'lock': 'Locked', 'report': 'Reported', 'settle': 'Settled'}


class Observer:
    def __init__(self, backend):
        self.b, self.rpc, self.store = backend, backend.rpc, backend.store
        self.projector = Projector(backend)

    def observe(self, operation_id):
        with self.store.transaction() as db:
            row = db.execute('SELECT * FROM cp28_signing WHERE operation_id=?', (operation_id,)).fetchone()
            if not row or row['kind'] == 'proof': raise ChainUnavailable('No original transaction signing context')
            if row['state'].startswith('FINALIZED_'): return {'state': row['state'], 'txHash': row['tx_hash']}
            if row['polls'] >= 12 or (row['polls'] and self.b.now()-row['last_poll'] < 5):
                raise ChainUnavailable('Original operation polling limit')
            db.execute('UPDATE cp28_signing SET polls=polls+1,last_poll=? WHERE operation_id=?', (self.b.now(), operation_id))
            row = dict(row)
            support = db.execute('SELECT * FROM support_intents WHERE operation_id=?', (operation_id,)).fetchone()
            ids = [operation_id]
            if support: ids += [support['intent_id'], support['batch_id']]
            private = db.execute('SELECT batch_id FROM private_vouchers WHERE id=(SELECT target FROM operations WHERE id=?)', (operation_id,)).fetchone()
            if private: ids += [private['batch_id']]
            op = db.execute('SELECT * FROM operations WHERE id=?', (operation_id,)).fetchone()
            ids.append(op['target'])
        try:
            with self.rpc.observation(hashes=[row['tx_hash']] if row['tx_hash'] else [], ids=ids):
                final = self.rpc.guard()
                if not row['tx_hash']:
                    observed_nonce = self.rpc.nonce(row['sender'])
                    start = row['scan_from'] or self.b.deployment['deploymentBlock']
                    events = []
                    end = min(final['number'], start+1023)
                    for low in range(start, end+1, 256):
                        events += self.rpc.events(low, min(end, low+255), NAMES[row['kind']])
                    if len(events) > 1: raise ChainConflict('Duplicate original operation event')
                    if not events:
                        with self.store.transaction() as db:
                            db.execute("UPDATE cp28_signing SET state='UNKNOWN',scan_from=? WHERE operation_id=?", (end+1, operation_id))
                        return {'state': 'UNKNOWN', 'sender': row['sender'], 'nonce': row['nonce'], 'observedPendingNonce': observed_nonce}
                    row['tx_hash'] = events[0]['transactionHash']
                receipt = self.rpc.receipt(row['tx_hash']); tx = self.rpc.transaction(row['tx_hash'])
                if not receipt or not tx: return {'state': 'UNKNOWN', 'txHash': row['tx_hash']}
                height = number(receipt['blockNumber'])
                if height > final['number']: return {'state': 'UNKNOWN', 'txHash': row['tx_hash']}
                if (receipt['transactionHash'].lower() != row['tx_hash'].lower() or tx['hash'].lower() != row['tx_hash'].lower() or
                        self.rpc.block(height)['hash'] != receipt['blockHash'] or tx['blockHash'] != receipt['blockHash'] or
                        number(tx['blockNumber']) != height or tx['transactionIndex'] != receipt['transactionIndex']):
                    raise ChainConflict('Original canonical transaction conflict')
                expected = json.loads(row['review'])['tx']
                actual = {'from': tx['from'], 'to': tx['to'], 'data': tx['input'], **{k: number(tx[k]) for k in
                          ('chainId', 'nonce', 'value', 'gas', 'maxFeePerGas', 'maxPriorityFeePerGas')}}
                # Addresses are case-insensitive; all byte and quantity fields remain exact.
                for key in ('from', 'to'):
                    if actual[key].lower() == expected[key].lower(): actual[key] = expected[key]
                parsed = {k: number(receipt[k]) for k in ('gasUsed', 'effectiveGasPrice', 'status')}
                event = None
                if parsed['status']:
                    topic = next(k for k, a in self.rpc.event_abis.items() if a['name'] == NAMES[row['kind']])
                    matching = [l for l in receipt['logs'] if l['address'].lower() == self.rpc.contract.address.lower()
                                and l.get('topics', [None])[0] == topic]
                    if len(matching) != 1: raise ChainConflict('Exact business receipt event required')
                    log = matching[0]
                    if log.get('removed') or log['transactionHash'] != row['tx_hash'] or log['blockHash'] != receipt['blockHash']:
                        raise ChainConflict('Receipt event context mismatch')
                    if number(log['blockNumber']) != height or log['transactionIndex'] != receipt['transactionIndex']:
                        raise ChainConflict('Receipt event position mismatch')
                    typed = {**log, 'blockNumber': number(log['blockNumber']), 'transactionIndex': number(log['transactionIndex']),
                             'logIndex': number(log['logIndex']), 'topics': [HexBytes(v) for v in log['topics']]}
                    decoded = get_event_data(self.rpc.w3.codec, self.rpc.event_abis[topic], typed)
                    event = {'deploymentId': self.b.deployment['deploymentId'], 'chainId': self.b.policy.chain_id,
                             'contract': self.rpc.contract.address, 'blockNumber': height, 'blockHash': receipt['blockHash'],
                             'transactionHash': row['tx_hash'], 'transactionIndex': typed['transactionIndex'],
                             'logIndex': typed['logIndex'], 'eventName': NAMES[row['kind']], 'args': plain(decoded['args'])}
                    args = event['args']
                    if (support and (args.get('intentId') != support['intent_id'] or args.get('batchId') != support['batch_id'] or
                                     args.get('amount') != support['value_wei'] or args.get('payer', '').lower() != row['sender'].lower())):
                        raise ChainConflict('Funding event differs from original intent')
                    if not support and args.get('operationId') != operation_id: raise ChainConflict('Wrong operation event')
                    if row['kind'] == 'issue':
                        vouchers = [v['id'] for v in self.store.all('SELECT id FROM private_vouchers WHERE operation_id=? ORDER BY rowid', (operation_id,))]
                        if args.get('batchId') != op['target'] or args.get('voucherIds') != vouchers:
                            raise ChainConflict('Issuance event differs from original intent')
                    if row['kind'] in ('lock', 'report', 'settle') and args.get('voucherId') != op['target']:
                        raise ChainConflict('Wrong voucher event')
                    if row['kind'] == 'settle' and args.get('merchant', '').lower() != self.b.deployment['merchant'].lower():
                        raise ChainConflict('Settlement merchant mismatch')
                paused = self.rpc.read('paused', [], final['number'])
                batch_id = support['batch_id'] if support else op['target'] if row['kind'] == 'issue' else private['batch_id']
                accounting = self.rpc.read('getBatch', [batch_id], final['number'])
                liability = self.rpc.read('liability', [], final['number'])
                total_funded = self.rpc.read('totalFunded', [], final['number'])
                contract_balance = self.rpc.balance(self.rpc.contract.address)
                if self.rpc.block(final['number'])['hash'] != final['hash']: raise ChainConflict('Finalized block changed')
                with self.store.transaction() as db:
                    if not self.b.runtime.account_receipt(db, operation_id, actual, parsed):
                        return {'state': 'HALTED', 'reason': 'ACTUAL_TRANSACTION_CONFLICT'}
                    if event:
                        event_id = f"{event['deploymentId']}:{row['tx_hash']}:{event['logIndex']}"
                        if not db.execute('SELECT 1 FROM chain_events WHERE event_id=?', (event_id,)).fetchone():
                            self.projector.apply(db, event)
                            db.execute('INSERT INTO chain_events VALUES(?,?,?,?,?,?,?,?)',
                                       (event_id, height, receipt['blockHash'], row['tx_hash'], event['logIndex'], event['transactionIndex'],
                                        event['eventName'], canonical(event['args'])))
                        self.projector.finalize(db, event, final['number'])
                        batch = db.execute('SELECT * FROM batches WHERE id=?', (batch_id,)).fetchone()
                        if tuple(batch[k] for k in ('F', 'A', 'R', 'H', 'S')) != tuple(accounting[:5]):
                            raise ChainConflict('Same-block batch accounting mismatch')
                    else:
                        db.execute("UPDATE operations SET status='FINALIZED_REVERT',tx_hash=?,receipt_block=?,receipt_hash=?,finalized_block=? WHERE id=?",
                                   (row['tx_hash'], height, receipt['blockHash'], final['number'], operation_id))
                        if op['kind'] != 'support': self.b.work.release_failed(db, op)
                    totals = db.execute('SELECT coalesce(sum(F),0) AS funded,coalesce(sum(A+R+H),0) AS liability FROM batches').fetchone()
                    if totals['funded'] != total_funded or totals['liability'] != liability or contract_balance < liability:
                        raise ChainConflict('Same-block global accounting mismatch')
                    batch = db.execute('SELECT * FROM batches WHERE id=?', (batch_id,)).fetchone()
                    if batch and tuple(batch[k] for k in ('F', 'A', 'R', 'H', 'S', 'X', 'L')) != tuple(accounting):
                        raise ChainConflict('Public snapshot batch accounting mismatch')
                    snapshot = {'deploymentId': self.b.deployment['deploymentId'], 'chainId': self.b.policy.chain_id,
                                'contract': self.rpc.contract.address, 'blockNumber': final['number'], 'blockHash': final['hash'],
                                'observedAt': self.b.now(), 'source': 'Monad finalized' if self.b.policy.chain_id == 10143 else 'isolated Anvil test finality',
                                'batch': {k: str(batch[k]) for k in ('id', 'F', 'A', 'R', 'H', 'S', 'X')} if batch else None}
                    db.execute("INSERT OR REPLACE INTO metadata VALUES('cp28_public_snapshot',?)", (canonical(snapshot),))
                    db.execute('UPDATE cp28_signing SET tx_hash=? WHERE operation_id=?', (row['tx_hash'], operation_id))
                    db.execute("UPDATE metadata SET value=? WHERE key='paused'", (str(int(paused)),))
                    return {'state': 'FINALIZED_SUCCESS' if event else 'FINALIZED_REVERT', 'txHash': row['tx_hash']}
        except ChainConflict:
            with self.store.transaction() as db:
                db.execute("UPDATE cp28_identity SET halted='CHAIN_EVIDENCE_CONFLICT' WHERE id=1")
            raise
