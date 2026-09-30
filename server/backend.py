"""CP15 persisted support capabilities and atomic issuance acceptance."""
import hashlib
import json
import secrets
import time
from cryptography.fernet import Fernet
from eth_abi import encode
from web3 import Web3
from server.contracts import ApiError, SUPPORT_TTL
from server.chain.client import PRICE, RULE, hx

TERMINAL = ('FINALIZED_SUCCESS','FINALIZED_REVERT','NOT_SUBMITTED')
def digest(value): return hashlib.sha256(value.encode()).hexdigest()
def canonical(value): return json.dumps(value,sort_keys=True,separators=(',',':'))
def random_id(): return '0x'+secrets.token_hex(32)
def require_id(value, name='id'):
    if not isinstance(value,str) or not value.strip() or len(value)>128: raise ApiError(422,'INVALID_INPUT',f'Invalid {name}')
    return value

def quantity(value):
    if type(value) is not int or not 1<=value<=20: raise ApiError(422,'INVALID_INPUT','Quantity must be 1–20')
    return value

class Backend:
    def __init__(self, store, rpc, secret_key, signer, clock=time.time):
        self.store,self.rpc,self.box,self.signer,self.clock=store,rpc,Fernet(secret_key),signer,clock
        self.deployment=rpc.deployment
        public_identity={k:v for k,v in self.deployment.items() if k!='rpcUrl'}
        binding=canonical(public_identity)
        with store.transaction() as db:
            old=db.execute("SELECT value FROM metadata WHERE key='deployment'").fetchone()
            if old and old['value']!=binding: raise ValueError('Database deployment mismatch')
            db.execute("INSERT OR IGNORE INTO metadata VALUES('deployment',?)",(binding,))
            db.execute("INSERT OR IGNORE INTO metadata VALUES('halted','')")
            db.execute("INSERT OR IGNORE INTO metadata VALUES('paused','0')")
    def now(self): return int(self.clock())
    def encrypt(self, value): return self.box.encrypt(value.encode()).decode()
    def decrypt(self, value): return self.box.decrypt(value.encode()).decode()
    def halt(self, reason): self.store.execute("UPDATE metadata SET value=? WHERE key='halted'",(reason,))
    def check_halted(self):
        if self.store.one("SELECT value FROM metadata WHERE key='halted'")['value']:
            raise ApiError(503,'CHAIN_HALTED','Chain evidence requires reconciliation')
    def cap(self, token):
        if not token: raise ApiError(401,'SUPPORT_SESSION_REQUIRED','Support session required')
        cap=self.store.one('SELECT * FROM support_caps WHERE token_hash=?',(digest(token),))
        if not cap or cap['expires_at']<=self.now(): raise ApiError(401,'SUPPORT_SESSION_EXPIRED','Support session expired')
        return cap
    def support_session(self, token, start_new=False):
        if token:
            try: current=self.cap(token)
            except ApiError: current=None
            if current:
                if not current['operation_id']: return token,current
                old=self.store.one('SELECT status FROM operations WHERE id=?',(current['operation_id'],))
                if not start_new or old['status'] not in TERMINAL:
                    return token,current
        token=secrets.token_urlsafe(32); now=self.now(); cap_id=random_id()
        self.store.execute('INSERT INTO support_caps VALUES(?,?,?,?,NULL)',(cap_id,digest(token),now,now+SUPPORT_TTL))
        return token,self.cap(token)
    def create_support(self, token, body):
        cap=self.cap(token)
        expected={'clientRequestId','account','chainId','quantity','ruleVersion','walletKind'}
        if set(body)!=expected or body['chainId']!=31337 or body['ruleVersion']!=RULE or body['walletKind'] not in ('local-test','dynamic','mera'):
            raise ApiError(422,'INVALID_INPUT','Invalid support request')
        # Configured SDK names are not claims of authentication or SDK availability.
        key=require_id(body['clientRequestId'],'clientRequestId'); n=quantity(body['quantity'])
        if not Web3.is_address(body['account']): raise ApiError(422,'INVALID_INPUT','Invalid account')
        body={**body,'account':Web3.to_checksum_address(body['account'])}
        snapshot=canonical(body); now=self.now()
        with self.store.transaction() as db:
            current=db.execute('SELECT * FROM support_caps WHERE id=?',(cap['id'],)).fetchone()
            if current['operation_id']:
                old=dict(db.execute('SELECT * FROM operations WHERE id=?',(current['operation_id'],)).fetchone())
                if old['intent_key']!=key or old['request_json']!=snapshot: raise ApiError(409,'INTENT_CONFLICT','Original intent remains bound')
                return self.support_view_db(db,old['id'])
            op_id=random_id(); intent=random_id()
            batch=hx(Web3.keccak(encode(['uint256','address','address','bytes32'],[31337,self.rpc.contract.address,body['account'],bytes.fromhex(intent[2:])])))
            data=self.rpc.contract.encode_abi('fund',args=[intent,n,RULE])
            db.execute('INSERT INTO operations(id,kind,actor_id,intent_key,request_json,payload_hash,status,target,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
                (op_id,'support',cap['id'],key,snapshot,digest(snapshot),'PREPARED',batch,now,now))
            db.execute('INSERT INTO support_intents VALUES(?,?,?,?,?,?,?,?)',(op_id,intent,body['account'],n,n*PRICE,batch,data,(now+120)*1000))
            db.execute('UPDATE support_caps SET operation_id=? WHERE id=?',(op_id,cap['id']))
            return self.support_view_db(db,op_id)
    @staticmethod
    def operation_view(op):
        return {'id':op['id'],'action':op['kind'],'target':op['target'],'status':op['status'],'txHash':op['tx_hash'],
                'receiptBlock':op['receipt_block'],'receiptBlockHash':op['receipt_hash'],'finalizedBlock':op['finalized_block'],
                'errorCode':op['error_code'],'lastCheckedAt':op['updated_at'],
                'retryPolicy':'COMPLETE' if op['status']=='FINALIZED_SUCCESS' else 'READ_ORIGINAL_ONLY'}
    def support_view_db(self, db, op_id):
        op=dict(db.execute('SELECT * FROM operations WHERE id=?',(op_id,)).fetchone())
        intent=dict(db.execute('SELECT * FROM support_intents WHERE operation_id=?',(op_id,)).fetchone())
        return {'operation':self.operation_view(op),'intent':{'operationId':op_id,'intentId':intent['intent_id'],
                'batchId':intent['batch_id'],'account':intent['payer'],'chainId':31337,'to':self.rpc.contract.address,
                'data':intent['data'],'valueWei':str(intent['value_wei']),'quantity':intent['quantity'],
                'ruleVersion':RULE,'quoteExpiresAt':intent['quote_expires_at']}}
    def get_support(self, token, op_id):
        cap=self.cap(token)
        if cap['operation_id']!=op_id: raise ApiError(403,'FORBIDDEN','Not this support intent')
        with self.store.transaction() as db: return self.support_view_db(db,op_id)
    def issue(self, actor, body):
        if actor.role!='partner' or not actor.partner_id: raise ApiError(403,'FORBIDDEN','Partner required')
        if set(body)!={'intentKey','recipientRef','batchId','quantity','quotePriceWei','ruleVersion'}: raise ApiError(422,'INVALID_INPUT','Invalid issuance request')
        key=require_id(body['intentKey']); ref=require_id(body['recipientRef']); batch_id=require_id(body['batchId'])
        n=quantity(body['quantity'])
        if body['quotePriceWei']!=str(PRICE) or body['ruleVersion']!=RULE: raise ApiError(409,'QUOTE_CHANGED','Review quote')
        snapshot=canonical(body)
        with self.store.transaction() as db:
            old=db.execute("SELECT * FROM operations WHERE actor_id=? AND kind='issue' AND intent_key=?",(actor.actor_id,key)).fetchone()
            if old:
                if old['request_json']!=snapshot: raise ApiError(409,'INTENT_CONFLICT','Intent parameters changed')
                return self.issuance_view_db(db,dict(old))
            self._healthy_in_transaction(db)
            if db.execute("SELECT value FROM metadata WHERE key='paused'").fetchone()['value']=='1': raise ApiError(409,'PAUSED','New issuance paused')
            q=db.execute('SELECT * FROM qualifications WHERE partner_id=? AND recipient_ref=?',(actor.partner_id,ref)).fetchone()
            if not q or not q['eligible'] or not q['channel_verified']: raise ApiError(403,'INELIGIBLE','Eligibility/channel not verified')
            if q['used']+q['reserved']+n>q['quota']: raise ApiError(409,'QUOTA_EXCEEDED','Insufficient qualification quota')
            batch=db.execute('SELECT * FROM batches WHERE id=?',(batch_id,)).fetchone()
            reserved=db.execute("SELECT coalesce(sum(amount_wei),0) AS n FROM reservations WHERE batch_id=? AND state='PENDING'",(batch_id,)).fetchone()['n']
            if not batch or batch['A']-batch['L']-reserved<n*PRICE: raise ApiError(409,'BUDGET_UNAVAILABLE','Finalized available budget insufficient')
            op_id=random_id(); now=self.now(); voucher_ids=[random_id() for _ in range(n)]
            db.execute('INSERT INTO operations(id,kind,actor_id,partner_id,intent_key,request_json,payload_hash,status,target,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                (op_id,'issue',actor.actor_id,actor.partner_id,key,snapshot,digest(snapshot),'QUEUED',batch_id,now,now))
            for v in voucher_ids:
                secret=secrets.token_urlsafe(32)
                db.execute('INSERT INTO private_vouchers VALUES(?,?,?,?,?,0)',(v,op_id,batch_id,digest(secret),self.encrypt(secret)))
            db.execute('UPDATE qualifications SET reserved=reserved+? WHERE partner_id=? AND recipient_ref=?',(n,actor.partner_id,ref))
            db.execute("INSERT INTO reservations VALUES(?,?,?,?,?,?,'PENDING')",(op_id,actor.partner_id,ref,batch_id,n,n*PRICE))
            tx={'to':self.rpc.contract.address,'data':self.rpc.contract.encode_abi('issue',args=[op_id,batch_id,voucher_ids]),'value':0,'chainId':31337}
            db.execute("INSERT INTO outbox(operation_id,signer,tx_json,state) VALUES(?,?,?,'QUEUED')",(op_id,self.signer,canonical(tx)))
            return self.issuance_view_db(db,dict(db.execute('SELECT * FROM operations WHERE id=?',(op_id,)).fetchone()))
    @staticmethod
    def _healthy_in_transaction(db):
        if db.execute("SELECT value FROM metadata WHERE key='halted'").fetchone()['value']: raise ApiError(503,'CHAIN_HALTED','Reconciliation required')
    def issuance_view_db(self, db, op):
        rows=db.execute('SELECT id,batch_id,confirmed FROM private_vouchers WHERE operation_id=? ORDER BY rowid',(op['id'],)).fetchall()
        return {'operation':self.operation_view(op),'request':json.loads(op['request_json']),
                'vouchers':[{'id':r['id'],'batchId':r['batch_id']} for r in rows if r['confirmed']]}
    def get_issue(self, actor, *, key=None, op_id=None):
        if actor.role!='partner': raise ApiError(403,'FORBIDDEN','Partner required')
        with self.store.transaction() as db:
            if key is not None: row=db.execute("SELECT * FROM operations WHERE actor_id=? AND kind='issue' AND intent_key=?",(actor.actor_id,key)).fetchone()
            else: row=db.execute('SELECT * FROM operations WHERE id=?',(op_id,)).fetchone()
            if not row: raise ApiError(404,'NOT_FOUND','Original operation not found; not proof of non-submission')
            if row['kind']!='issue' or row['actor_id']!=actor.actor_id or row['partner_id']!=actor.partner_id: raise ApiError(403,'FORBIDDEN','Operation scope mismatch')
            return self.issuance_view_db(db,dict(row))
    @staticmethod
    def resolve_reservation(db, op_id, success):
        r=db.execute('SELECT * FROM reservations WHERE operation_id=?',(op_id,)).fetchone()
        if not r or r['state']!='PENDING': return
        db.execute('UPDATE qualifications SET reserved=reserved-?,used=used+? WHERE partner_id=? AND recipient_ref=?',
                   (r['quantity'],r['quantity'] if success else 0,r['partner_id'],r['recipient_ref']))
        db.execute('UPDATE reservations SET state=? WHERE operation_id=?',('USED' if success else 'RELEASED',op_id))
