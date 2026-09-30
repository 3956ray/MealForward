"""Single local worker, durable nonce/raw first; no new transaction to resolve an unknown."""
import fcntl
import json
from contextlib import contextmanager
from eth_account import Account
from eth_abi import encode
from web3.exceptions import ContractLogicError
from server.backend import TERMINAL, canonical
from server.chain.client import ChainConflict, ZERO, hx
from server.projection import Projector

class Worker:
    def __init__(self, backend, issuer_key, fault=None):
        self.b,self.rpc,self.store=backend,backend.rpc,backend.store
        self.account=Account.from_key(issuer_key)
        if self.account.address.lower()!=backend.signer.lower(): raise ValueError('Wrong local signer')
        self.projector=Projector(backend)
        self.fault=fault or (lambda phase: None)
    @contextmanager
    def lease(self):
        with open(str(self.store.path)+'.worker.lock','a') as file:
            try: fcntl.flock(file,fcntl.LOCK_EX|fcntl.LOCK_NB)
            except BlockingIOError: raise RuntimeError('Worker already owns this database')
            try: yield
            finally: fcntl.flock(file,fcntl.LOCK_UN)
    def tick(self):
        with self.lease():
            self.projector.sync()
            for op in self.store.all("SELECT * FROM operations WHERE kind='support' AND status NOT IN ('FINALIZED_SUCCESS','FINALIZED_REVERT','NOT_SUBMITTED')"):
                self.observe_support(op)
            job=self.store.one("SELECT * FROM outbox WHERE state!='DONE' ORDER BY rowid LIMIT 1")
            if not job: return
            self.b.check_halted(); self.rpc.guard()
            if job['raw_cipher'] is None:
                # A restored backup can predate signing/broadcast. Recover original
                # evidence before estimation; absence of raw is not proof of no send.
                if self.recover_unsigned(job): return
                if self.rpc.contract.functions.paused().call(): return
                tx=json.loads(job['tx_json']); tx['from']=self.account.address
                try: gas=self.rpc.w3.eth.estimate_gas(tx)
                except ContractLogicError:
                    self.unsigned_unknown(job,'PREFLIGHT_UNRESOLVED')
                    return
                pending_nonce=self.rpc.w3.eth.get_transaction_count(self.account.address,'pending')
                saved=self.store.one('SELECT next_nonce FROM signer_nonces WHERE signer=?',(self.account.address,))
                expected=job['nonce'] if job['nonce'] is not None else (saved['next_nonce'] if saved else 0)
                if pending_nonce!=expected:
                    self.unsigned_unknown(job,'SIGNER_NONCE_UNRESOLVED'); return
                with self.store.transaction() as db:
                    saved=db.execute('SELECT next_nonce FROM signer_nonces WHERE signer=?',(self.account.address,)).fetchone()
                    nonce=job['nonce'] if job['nonce'] is not None else max(pending_nonce,saved['next_nonce'] if saved else 0)
                    if job['nonce'] is None:
                        db.execute('INSERT OR REPLACE INTO signer_nonces VALUES(?,?)',(self.account.address,nonce+1))
                        db.execute('UPDATE outbox SET nonce=? WHERE operation_id=?',(nonce,job['operation_id']))
                self.fault('before_sign')
                tx.update(nonce=nonce,gas=(gas*110+99)//100,gasPrice=self.rpc.w3.eth.gas_price)
                signed=self.account.sign_transaction(tx)
                raw=hx(signed.raw_transaction); tx_hash=hx(signed.hash)
                with self.store.transaction() as db:
                    db.execute("UPDATE outbox SET raw_cipher=?,tx_hash=?,state='SIGNED' WHERE operation_id=?",(self.b.encrypt(raw),tx_hash,job['operation_id']))
                    db.execute("UPDATE operations SET tx_hash=?,status='SIGNED',updated_at=? WHERE id=?",(tx_hash,self.b.now(),job['operation_id']))
                self.fault('after_sign')
                job=self.store.one('SELECT * FROM outbox WHERE operation_id=?',(job['operation_id'],))
            receipt=self.rpc.receipt(job['tx_hash'])
            if receipt:
                self.observe_work(job,receipt)
                return
            self.fault('before_broadcast')
            # Mark possibility of propagation before network call; all exceptions preserve reservation.
            self.store.execute("UPDATE operations SET status='SUBMISSION_UNKNOWN',updated_at=? WHERE id=?",(self.b.now(),job['operation_id']))
            try:
                result=self.rpc.broadcast_same_raw(self.b.decrypt(job['raw_cipher']))
                if result.lower()!=job['tx_hash'].lower(): raise ChainConflict('Broadcast hash mismatch')
                self.fault('after_broadcast')
            except ChainConflict:
                self.b.halt('BROADCAST_CONFLICT'); raise
            except Exception:
                self.store.execute("UPDATE outbox SET state='UNKNOWN',broadcast_count=broadcast_count+1 WHERE operation_id=?",(job['operation_id'],))
                return
            self.store.execute("UPDATE outbox SET state='BROADCAST',broadcast_count=broadcast_count+1 WHERE operation_id=?",(job['operation_id'],))
            self.store.execute("UPDATE operations SET status='BROADCAST',updated_at=? WHERE id=?",(self.b.now(),job['operation_id']))
    def unsigned_unknown(self, job, reason):
        self.store.execute("UPDATE operations SET status='SUBMISSION_UNKNOWN',error_code=?,updated_at=? WHERE id=?",
                           (reason,self.b.now(),job['operation_id']))
    def recover_unsigned(self, job):
        payload,result=self.rpc.contract.functions.getOperation(1,job['operation_id']).call()
        recorded=hx(payload)!=ZERO
        if recorded:
            _,args=self.rpc.contract.decode_function_input(json.loads(job['tx_json'])['data'])
            expected=self.rpc.w3.keccak(encode(['bytes32','bytes32[]'],[args['batchId'],args['voucherIds']]))
            if bytes(payload)!=bytes(expected) or bytes(result)!=bytes(args['batchId']):
                self.b.halt('RECOVERY_CONFLICT'); raise ChainConflict('Original operation mapping conflict')
        matches=[e for e in self.rpc.events(int(self.b.deployment['deploymentBlock']),'latest')
                 if e['eventName']=='Issued' and e['args']['operationId']==job['operation_id']]
        if matches:
            if len(matches)!=1:
                self.b.halt('RECOVERY_CONFLICT'); raise ChainConflict('Duplicate original issuance')
            event=matches[0]
            try:
                receipt=self.rpc.verify_event(event)
                self.projector.validate_operation_event(event)
                tx=self.rpc.w3.eth.get_transaction(event['transactionHash'])
                if (job['tx_hash'] and job['tx_hash']!=event['transactionHash']) or (job['nonce'] is not None and job['nonce']!=tx['nonce']):
                    raise ChainConflict('Original issuance nonce/hash conflict')
            except ChainConflict:
                self.b.halt('RECOVERY_CONFLICT'); raise
            with self.store.transaction() as db:
                db.execute("UPDATE outbox SET tx_hash=?,nonce=?,state='OBSERVED' WHERE operation_id=?",
                           (event['transactionHash'],tx['nonce'],job['operation_id']))
                db.execute('UPDATE operations SET tx_hash=? WHERE id=?',(event['transactionHash'],job['operation_id']))
                db.execute('INSERT INTO signer_nonces VALUES(?,?) ON CONFLICT(signer) DO UPDATE SET next_nonce=max(next_nonce,excluded.next_nonce)',
                           (self.account.address,tx['nonce']+1))
            job=self.store.one('SELECT * FROM outbox WHERE operation_id=?',(job['operation_id'],))
            self.observe_work(job,receipt)
            return True
        if job['tx_hash']:
            receipt=self.rpc.receipt(job['tx_hash'])
            if receipt: self.observe_work(job,receipt)
            else: self.unsigned_unknown(job,'ORIGINAL_RAW_UNAVAILABLE')
            return True # Never fabricate replacement raw for an observed original.
        if recorded:
            self.unsigned_unknown(job,'ORIGINAL_EVENT_UNAVAILABLE')
            return True
        saved=self.store.one('SELECT next_nonce FROM signer_nonces WHERE signer=?',(self.account.address,))
        expected=job['nonce'] if job['nonce'] is not None else (saved['next_nonce'] if saved else 0)
        latest=self.rpc.w3.eth.get_transaction_count(self.account.address,'latest')
        pending=self.rpc.w3.eth.get_transaction_count(self.account.address,'pending')
        if latest!=expected or pending!=expected:
            self.unsigned_unknown(job,'SIGNER_NONCE_UNRESOLVED')
            return True # Pending/reverted original without recoverable raw needs reconciliation.
        return False
    def observe_work(self, job, receipt):
        tx=json.loads(job['tx_json'])
        if not self.rpc.transaction_matches(job['tx_hash'],sender=job['signer'],data=tx['data'],value=0):
            self.b.halt('PAYLOAD_CONFLICT'); raise ChainConflict('Work payload mismatch')
        canonical_block=self.rpc.w3.eth.get_block(receipt['blockNumber'])
        if hx(canonical_block['hash'])!=hx(receipt['blockHash']):
            self.store.execute("UPDATE operations SET status='SUBMISSION_UNKNOWN' WHERE id=?",(job['operation_id'],)); return
        final=self.rpc.w3.eth.get_block('finalized')['number']
        success=receipt['status']==1
        if success and final>=receipt['blockNumber']:
            # Projector must have found and validated its Issued event, not merely a successful receipt.
            self.b.halt('FINALIZED_EVENT_GAP'); raise ChainConflict('Missing finalized issue event')
        state='INCLUDED_SUCCESS' if success else 'INCLUDED_REVERT'
        if not success and final>=receipt['blockNumber']: state='FINALIZED_REVERT'
        with self.store.transaction() as db:
            db.execute('UPDATE operations SET status=?,receipt_block=?,receipt_hash=?,finalized_block=?,updated_at=? WHERE id=?',
                       (state,receipt['blockNumber'],hx(receipt['blockHash']),final if state=='FINALIZED_REVERT' else None,self.b.now(),job['operation_id']))
            if state=='FINALIZED_REVERT':
                self.b.resolve_reservation(db,job['operation_id'],False)
                db.execute("UPDATE outbox SET state='DONE' WHERE operation_id=?",(job['operation_id'],))
    def observe_support(self, op):
        row=self.store.one('SELECT * FROM support_intents WHERE operation_id=?',(op['id'],))
        events=self.rpc.events(int(self.b.deployment['deploymentBlock']),'latest')
        matches=[e for e in events if e['eventName']=='Funded' and e['args']['intentId']==row['intent_id'] and e['args']['payer'].lower()==row['payer'].lower()]
        if not matches:
            if op['status']=='INCLUDED_SUCCESS':
                self.store.execute("UPDATE operations SET status='SUBMISSION_UNKNOWN' WHERE id=?",(op['id'],))
            return  # zero mapping/empty source is never definitive failure
        if len(matches)!=1: self.b.halt('DUPLICATE_FUND_EVIDENCE'); raise ChainConflict('Duplicate fund evidence')
        event=matches[0]
        self.rpc.verify_event(event); self.projector.validate_operation_event(event)
        self.store.execute("UPDATE operations SET status='INCLUDED_SUCCESS',tx_hash=?,receipt_block=?,receipt_hash=?,updated_at=? WHERE id=?",
                           (event['transactionHash'],event['blockNumber'],event['blockHash'],self.b.now(),op['id']))
