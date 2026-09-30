"""Single local worker, durable nonce/raw first; no new transaction to resolve an unknown."""
import fcntl
import json
from contextlib import contextmanager
from eth_account import Account
from web3.exceptions import ContractLogicError
from server.backend import TERMINAL, canonical
from server.chain.client import ChainConflict, hx
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
                if self.rpc.contract.functions.paused().call(): return
                tx=json.loads(job['tx_json']); tx['from']=self.account.address
                try: gas=self.rpc.w3.eth.estimate_gas(tx)
                except ContractLogicError:
                    with self.store.transaction() as db:
                        self.b.resolve_reservation(db,job['operation_id'],False)
                        # A crash may have reserved this nonce before any raw existed.
                        # With the worker lease and serial queue it can be safely reclaimed.
                        if job['nonce'] is not None:
                            db.execute('UPDATE signer_nonces SET next_nonce=? WHERE signer=? AND next_nonce=?',
                                       (job['nonce'],self.account.address,job['nonce']+1))
                            db.execute('UPDATE outbox SET nonce=NULL WHERE operation_id=?',(job['operation_id'],))
                        db.execute("UPDATE operations SET status='NOT_SUBMITTED',error_code='PREFLIGHT_REJECTED',updated_at=? WHERE id=?",(self.b.now(),job['operation_id']))
                        db.execute("UPDATE outbox SET state='DONE' WHERE operation_id=?",(job['operation_id'],))
                    return
                pending_nonce=self.rpc.w3.eth.get_transaction_count(self.account.address,'pending')
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
