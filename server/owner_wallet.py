"""Owner identity proof and immutable external settlement intents. Never signs transactions."""
import sqlite3
import threading
import re
import json
from eth_account import Account
from eth_account.messages import encode_defunct
from web3 import Web3
from web3.exceptions import TransactionNotFound
from server.backend import canonical, digest, random_id, require_id
from server.actions import action_transaction
from server.contracts import (ApiError, LOCAL_SHOP_ID, AUTH_IDLE_TTL, OWNER_CHALLENGE_TTL,
                              OWNER_PROOF_TTL, OWNER_REVIEW_TTL)
from server.chain.client import PRICE, ChainConflict, hx

_VERIFY_LOCK=threading.RLock()

class OwnerWalletService:
    def __init__(self, backend): self.b,self.store,self.rpc=backend,backend.store,backend.rpc
    def binding(self, db, actor):
        if not self.b.owner_mode: raise ApiError(503,'OWNER_UNCONFIGURED','Owner wallet mode unavailable')
        self.b.work.require_actor(db,actor,'owner')
        row=db.execute('SELECT * FROM owner_wallet_bindings WHERE actor_id=?',(actor.actor_id,)).fetchone()
        if (not row or not row['enabled'] or row['shop_id']!=LOCAL_SHOP_ID or row['shop_id']!=actor.shop_id
                or row['deployment_id']!=self.b.deployment['deploymentId']
                or row['address'].lower()!=self.b.deployment['merchant'].lower()):
            raise ApiError(403,'WALLET_BINDING_REQUIRED','Current shop wallet binding required')
        return dict(row)
    def require(self, db, actor):
        binding=self.binding(db,actor);now=self.b.now()
        proof=db.execute('SELECT * FROM owner_wallet_sessions WHERE session_id=?',(actor.session_id,)).fetchone()
        session=db.execute('SELECT * FROM work_sessions WHERE token_hash=?',(actor.session_id,)).fetchone()
        if (not proof or proof['revoked'] or proof['actor_id']!=actor.actor_id or proof['expires_at']<=now
                or proof['address'].lower()!=binding['address'].lower() or not session or session['revoked']
                or session['user_id']!=actor.actor_id or session['expires_at']<=now or session['last_seen_at']<=now-AUTH_IDLE_TTL):
            raise ApiError(403,'WALLET_PROOF_REQUIRED','Verify the bound owner wallet')
        return binding
    def challenge(self, actor, body, origin):
        if body: raise ApiError(422,'INVALID_INPUT','Empty object required')
        with self.store.transaction() as db:
            self.b.work.writable(db,allow_paused=True);binding=self.binding(db,actor)
            now=self.b.now()
            if db.execute('SELECT count(*) AS n FROM owner_wallet_challenges WHERE session_id=? AND expires_at>?',
                          (actor.session_id,now)).fetchone()['n']>=5:
                raise ApiError(429,'RATE_LIMITED','Try later')
            challenge_id=random_id();expires=now+OWNER_CHALLENGE_TTL
            message='Mealforward owner identity only; no transaction or settlement authorization.\n'+canonical({
                'origin':origin,'chainId':31337,'deploymentId':self.b.deployment['deploymentId'],
                'contract':self.b.deployment['contractAddress'],'shopId':binding['shop_id'],
                'actorId':actor.actor_id,'sessionId':actor.session_id,'address':binding['address'],
                'challengeId':challenge_id,'expiresAt':expires})
            db.execute('INSERT INTO owner_wallet_challenges VALUES(?,?,?,?,?,0)',
                       (challenge_id,actor.session_id,actor.actor_id,message,expires))
            return {'challengeId':challenge_id,'message':message,'address':binding['address'],'expiresAt':expires}
    def verify(self, actor, body, origin):
        if set(body)!={'challengeId','signature'} or not isinstance(body['signature'],str) or len(body['signature'])>1024:
            raise ApiError(422,'INVALID_INPUT','Challenge and signature required')
        throttle='owner-proof:'+actor.session_id
        with _VERIFY_LOCK:
            if self.store.auth_failure_count(throttle,self.b.now(),900)>=5: raise ApiError(429,'RATE_LIMITED','Try later')
            self.store.record_auth_failure(throttle,self.b.now())
            with self.store.transaction() as db:
                self.b.work.writable(db,allow_paused=True);binding=self.binding(db,actor);now=self.b.now()
                row=db.execute('SELECT * FROM owner_wallet_challenges WHERE id=?',(require_id(body['challengeId']),)).fetchone()
                if not row or row['consumed'] or row['expires_at']<=now or row['session_id']!=actor.session_id or row['actor_id']!=actor.actor_id:
                    raise ApiError(403,'WALLET_PROOF_INVALID','Wallet proof unavailable')
                if json.loads(row['message'].split('\n',1)[1])['origin']!=origin:
                    raise ApiError(403,'WALLET_PROOF_INVALID','Wallet proof domain changed')
                try: address=Account.recover_message(encode_defunct(text=row['message']),signature=body['signature'])
                except (ValueError,TypeError): raise ApiError(403,'WALLET_PROOF_INVALID','Wallet proof unavailable') from None
                if address.lower()!=binding['address'].lower(): raise ApiError(403,'WALLET_PROOF_INVALID','Wallet proof unavailable')
                session=db.execute('SELECT * FROM work_sessions WHERE token_hash=?',(actor.session_id,)).fetchone()
                if not session or session['revoked'] or session['user_id']!=actor.actor_id or session['expires_at']<=now:
                    raise ApiError(401,'AUTH_REQUIRED','Current work session required')
                expires=min(now+OWNER_PROOF_TTL,session['expires_at'])
                db.execute('UPDATE owner_wallet_challenges SET consumed=1 WHERE id=?',(row['id'],))
                db.execute('INSERT OR REPLACE INTO owner_wallet_sessions VALUES(?,?,?,?,?,0)',
                           (actor.session_id,actor.actor_id,address,now,expires))
            self.store.clear_auth_failures(throttle)
        return {'verified':True,'address':address,'expiresAt':expires}
    def session(self, actor):
        with self.store.transaction() as db:
            binding=self.binding(db,actor)
            try: self.require(db,actor)
            except ApiError as exc:
                if exc.code!='WALLET_PROOF_REQUIRED': raise
                return {'verified':False,'address':binding['address']}
            row=db.execute('SELECT expires_at FROM owner_wallet_sessions WHERE session_id=?',(actor.session_id,)).fetchone()
            return {'verified':True,'address':binding['address'],'expiresAt':row['expires_at']}
    def logout(self, actor, body):
        if body: raise ApiError(422,'INVALID_INPUT','Empty object required')
        with self.store.transaction() as db:
            self.b._writable_in_transaction(db)
            db.execute('UPDATE owner_wallet_sessions SET revoked=1 WHERE session_id=?',(actor.session_id,))
            db.execute('UPDATE owner_wallet_challenges SET consumed=1 WHERE session_id=?',(actor.session_id,))
    def chain_permission(self):
        self.rpc.guard()
        address=self.b.deployment['merchant']
        if self.rpc.contract.functions.merchant().call().lower()!=address.lower(): raise ChainConflict('Merchant binding changed')
        if not self.rpc.contract.functions.hasRole(self.rpc.contract.functions.SETTLER_ROLE().call(),address).call():
            raise ApiError(403,'WALLET_ROLE_REQUIRED','Bound wallet lacks settlement permission')
    def scoped(self, db, actor, op_id, *, proof=False):
        (self.require if proof else self.binding)(db,actor)
        op=db.execute("SELECT * FROM operations WHERE id=? AND kind='settle'",(op_id,)).fetchone()
        intent=db.execute('SELECT * FROM owner_settlements WHERE operation_id=?',(op_id,)).fetchone()
        if not op or not intent: raise ApiError(404,'NOT_FOUND','Original wallet operation unavailable')
        if op['actor_id']!=actor.actor_id or op['shop_id']!=actor.shop_id: raise ApiError(403,'FORBIDDEN','Original owner scope required')
        return dict(op),dict(intent)
    def view(self, op, intent):
        return {'operation':self.b.operation_view(op),'intent':{'operationId':op['id'],'from':intent['address'],
                'to':intent['contract'],'chainId':intent['chain_id'],'data':intent['data'],'value':'0',
                'merchant':self.b.deployment['merchant'],'amountWei':str(PRICE),'gasSeparate':True,
                'reviewExpiresAt':intent['review_expires_at'],'submissionStarted':intent['submission_started_at'] is not None}}
    def operation(self, actor, *, op_id=None, key=None):
        with self.store.transaction() as db:
            if key is not None:
                row=db.execute("SELECT id FROM operations WHERE actor_id=? AND kind='settle' AND intent_key=?",(actor.actor_id,key)).fetchone()
                if not row: raise ApiError(404,'NOT_FOUND','Original wallet operation unavailable')
                op_id=row['id']
            return self.view(*self.scoped(db,actor,op_id))
    def prepare(self, actor, redemption_id, body):
        if set(body)!={'intentKey'}: raise ApiError(422,'INVALID_INPUT','Intent key required')
        key=require_id(body['intentKey']);self.chain_permission()
        snapshot={'intentKey':key,'redemptionId':redemption_id}
        with self.store.transaction() as db:
            self.b.work.writable(db);binding=self.require(db,actor)
            previous=db.execute("SELECT * FROM operations WHERE actor_id=? AND kind='settle' AND intent_key=?",(actor.actor_id,key)).fetchone()
            if previous:
                if previous['request_json']!=canonical(snapshot): raise ApiError(409,'INTENT_CONFLICT','Original parameters changed')
                op,intent=self.scoped(db,actor,previous['id'],proof=True)
                if op['status']=='PREPARED' and intent['submission_started_at'] is None:
                    db.execute('UPDATE owner_settlements SET review_expires_at=? WHERE operation_id=?',(self.b.now()+OWNER_REVIEW_TTL,op['id']))
                    op,intent=self.scoped(db,actor,op['id'])
                return self.view(op,intent)
            r=db.execute('SELECT * FROM redemptions WHERE id=?',(redemption_id,)).fetchone()
            if not r or r['actor_id']!=actor.actor_id or r['shop_id']!=actor.shop_id: raise ApiError(404,'NOT_FOUND','Payable unavailable')
            voucher=self.b.work.voucher(db,r['voucher_id'])
            lock=db.execute('SELECT status FROM operations WHERE id=?',(r['lock_operation_id'],)).fetchone()
            statement=db.execute('SELECT * FROM handoff_statements WHERE redemption_id=?',(redemption_id,)).fetchone()
            report=db.execute("SELECT 1 FROM operations WHERE redemption_id=? AND kind='report' AND status='FINALIZED_SUCCESS'",(redemption_id,)).fetchone()
            if voucher['chain_status']!=3 or not lock or lock['status']!='FINALIZED_SUCCESS' or not statement or statement['actor_id']!=actor.actor_id or not report:
                raise ApiError(409,'NOT_PAYABLE','Original finalized report and handoff required')
            op_id=random_id();now=self.b.now();tx=action_transaction(self.rpc.contract,'settle',op_id,{'voucherId':r['voucher_id']})
            try:
                db.execute('''INSERT INTO operations(id,kind,actor_id,shop_id,redemption_id,intent_key,request_json,
                              payload_hash,status,target,created_at,updated_at) VALUES(?,'settle',?,?,?,?,?,?,'PREPARED',?,?,?)''',
                           (op_id,actor.actor_id,actor.shop_id,redemption_id,key,canonical(snapshot),digest(canonical(snapshot)),r['voucher_id'],now,now))
            except sqlite3.IntegrityError: raise ApiError(409,'OPERATION_PENDING','Original action remains pending') from None
            db.execute('INSERT INTO owner_settlements VALUES(?,?,?,?,?,?,?,NULL)',
                       (op_id,binding['address'],31337,tx['to'],tx['data'],0,now+OWNER_REVIEW_TTL))
            db.execute("UPDATE redemptions SET state='SETTLE_PENDING' WHERE id=?",(redemption_id,))
            return self.view(*self.scoped(db,actor,op_id))
    def start(self, actor, op_id, body):
        if body: raise ApiError(422,'INVALID_INPUT','Empty object required')
        self.chain_permission()
        with self.store.transaction() as db:
            self.b.work.writable(db);op,intent=self.scoped(db,actor,op_id,proof=True)
            if op['status']!='PREPARED' or intent['submission_started_at'] is not None:
                return {**self.view(op,intent),'maySubmit':False}
            if intent['review_expires_at']<=self.b.now(): raise ApiError(409,'REVIEW_EXPIRED','Explicitly review original intent again')
            now=self.b.now()
            db.execute('UPDATE owner_settlements SET submission_started_at=? WHERE operation_id=?',(now,op_id))
            db.execute("UPDATE operations SET status='SUBMISSION_UNKNOWN',updated_at=? WHERE id=?",(now,op_id))
            db.execute("INSERT INTO work_audit(operation_id,event,created_at) VALUES(?,'OWNER_SUBMISSION_STARTED',?)",(op_id,now))
            return {**self.view(*self.scoped(db,actor,op_id)),'maySubmit':True}
    def transaction(self, actor, op_id, body):
        if set(body)!={'txHash'} or not isinstance(body['txHash'],str) or not re.fullmatch(r'0x[0-9a-fA-F]{64}',body['txHash']):
            raise ApiError(422,'INVALID_INPUT','Transaction hash required')
        with self.store.transaction() as db:
            self.b._writable_in_transaction(db);op,intent=self.scoped(db,actor,op_id,proof=True)
            if intent['submission_started_at'] is None: raise ApiError(409,'SUBMISSION_NOT_STARTED','Original submission must be started')
        try: matches=self.rpc.transaction_matches(body['txHash'],sender=intent['address'],data=intent['data'],value=0)
        except TransactionNotFound:
            # An unseen untrusted hash cannot replace verified original evidence.
            return self.operation(actor,op_id=op_id)
        if not matches:
            raise ApiError(409,'TRANSACTION_MISMATCH','Transaction does not match original intent')
        with self.store.transaction() as db:
            self.b._writable_in_transaction(db);current,_=self.scoped(db,actor,op_id,proof=True)
            if current['tx_hash'] and current['tx_hash'].lower()!=body['txHash'].lower(): raise ApiError(409,'ORIGINAL_TRANSACTION_BOUND','Query the original transaction')
            db.execute('UPDATE operations SET tx_hash=? WHERE id=?',(body['txHash'],op_id))
        return self.operation(actor,op_id=op_id)
    def observe(self, op):
        """Internal read-only chain recovery; does not require a live browser session."""
        intent=self.store.one('SELECT * FROM owner_settlements WHERE operation_id=?',(op['id'],))
        if not intent: raise ChainConflict('Missing original owner intent')
        if intent['submission_started_at'] is None: return
        tx_hash=op['tx_hash']
        if not tx_hash:
            events=self.rpc.events(int(self.b.deployment['deploymentBlock']),'latest')
            matches=[e for e in events if e['eventName']=='Settled' and e['args']['operationId']==op['id']]
            if not matches: return
            if len(matches)!=1: raise ChainConflict('Duplicate settlement evidence')
            tx_hash=matches[0]['transactionHash']
        if not self.rpc.transaction_matches(tx_hash,sender=intent['address'],data=intent['data'],value=0):
            raise ChainConflict('Original owner transaction mismatch')
        receipt=self.rpc.receipt(tx_hash)
        if not receipt: return
        if hx(self.rpc.w3.eth.get_block(receipt['blockNumber'])['hash'])!=hx(receipt['blockHash']):
            self.store.execute("UPDATE operations SET status='SUBMISSION_UNKNOWN' WHERE id=?",(op['id'],));return
        final=self.rpc.w3.eth.get_block('finalized')['number'];success=receipt['status']==1
        if success and final>=receipt['blockNumber']:
            raise ChainConflict('Finalized owner event missing from projection')
        state='INCLUDED_SUCCESS' if success else ('FINALIZED_REVERT' if final>=receipt['blockNumber'] else 'INCLUDED_REVERT')
        with self.store.transaction() as db:
            current=db.execute('SELECT status FROM operations WHERE id=?',(op['id'],)).fetchone()
            if current['status'] in ('FINALIZED_SUCCESS','FINALIZED_REVERT'): return
            db.execute('''UPDATE operations SET tx_hash=?,status=?,receipt_block=?,receipt_hash=?,finalized_block=?,updated_at=? WHERE id=?''',
                       (tx_hash,state,receipt['blockNumber'],hx(receipt['blockHash']),final if state=='FINALIZED_REVERT' else None,self.b.now(),op['id']))
            if state=='FINALIZED_REVERT': self.b.work.release_failed(db,op)
