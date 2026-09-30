"""CP16 shared transaction helpers. Caller owns transaction; no RPC, commit or signing."""
import hashlib
import hmac
import sqlite3
from server.actions import ACTIONS, action_transaction
from server.backend import canonical, digest, random_id, require_id
from server.contracts import ApiError, LOCAL_SHOP_ID, RECIPIENT_IDLE_TTL

class WorkCore:
    def __init__(self, backend, secret_key):
        self.b=backend
        self._code_key=hashlib.sha256(secret_key+b'/cp16/presentation').digest()
    def code_hash(self, code):
        return hmac.new(self._code_key,code.encode(),hashlib.sha256).hexdigest()
    def actor_role(self, kind):
        return 'owner' if self.b.owner_mode and kind!='issue' else ACTIONS[kind].actor_role
    def require_owner(self, db, actor):
        return self.b.owner_wallet.require(db,actor)
    def require_actor(self, db, actor, role=None):
        row=db.execute('SELECT * FROM users WHERE id=?',(actor.actor_id,)).fetchone()
        if not row or not row['enabled']: raise ApiError(401,'AUTH_REQUIRED','Current work account required')
        if (row['role']!=actor.role or row['partner_id']!=actor.partner_id or row['shop_id']!=actor.shop_id
                or (role and row['role']!=role)):
            raise ApiError(403,'FORBIDDEN','Current work scope required')
        if row['role'] in ('owner','staff','settler') and row['shop_id']!=LOCAL_SHOP_ID:
            raise ApiError(403,'FORBIDDEN','Current shop scope required')
        if row['role']=='partner' and not row['partner_id']: raise ApiError(403,'FORBIDDEN','Partner required')
        return dict(row)
    def writable(self, db, *, allow_paused=False):
        self.b._writable_in_transaction(db);self.b._healthy_in_transaction(db)
        if not allow_paused and db.execute("SELECT value FROM metadata WHERE key='paused'").fetchone()['value']=='1':
            raise ApiError(409,'PAUSED','New action paused')
    def voucher(self, db, voucher_id):
        row=db.execute('''SELECT v.*,o.partner_id,o.actor_id AS issuer_actor_id,o.status AS issue_status,
                          p.status AS chain_status,p.lock_id FROM private_vouchers v
                          JOIN operations o ON o.id=v.operation_id
                          LEFT JOIN public_vouchers p ON p.id=v.id WHERE v.id=?''',(voucher_id,)).fetchone()
        if not row: raise ApiError(404,'NOT_FOUND','Voucher unavailable')
        return dict(row)
    def available(self, db, voucher_id):
        row=self.voucher(db,voucher_id)
        return bool(row['confirmed'] and row['issue_status']=='FINALIZED_SUCCESS' and row['chain_status']==1
                    and not db.execute('SELECT 1 FROM voucher_claims WHERE voucher_id=?',(voucher_id,)).fetchone())
    def expire_codes(self, db, now=None):
        now=self.b.now() if now is None else now
        db.execute('''UPDATE presentation_codes SET active=0,code_cipher=NULL WHERE active=1 AND
                      (expires_at<=? OR session_hash IN
                       (SELECT token_hash FROM recipient_sessions WHERE revoked=1 OR expires_at<=? OR last_seen_at<=?))''',
                   (now,now,now-RECIPIENT_IDLE_TTL))
    def validate_code(self, db, actor, code, now=None):
        self.require_actor(db,actor,self.actor_role('lock'))
        if self.b.owner_mode: self.require_owner(db,actor)
        now=self.b.now() if now is None else now
        if not isinstance(code,str) or len(code)!=8 or not code.isascii() or not code.isdigit():
            raise ApiError(404,'CODE_UNAVAILABLE','Code unavailable')
        row=db.execute('''SELECT c.id,c.voucher_id FROM presentation_codes c
                          JOIN recipient_sessions s ON s.token_hash=c.session_hash
                          JOIN recipient_heads h ON h.voucher_id=c.voucher_id AND h.session_hash=s.token_hash
                          WHERE c.code_hash=? AND c.active=1 AND c.consumed_by IS NULL AND c.expires_at>?
                          AND s.revoked=0 AND s.expires_at>? AND s.last_seen_at>?''',
                       (self.code_hash(code),now,now,now-RECIPIENT_IDLE_TTL)).fetchone()
        if not row or not self.available(db,row['voucher_id']): raise ApiError(404,'CODE_UNAVAILABLE','Code unavailable')
        return {'codeId':row['id'],'voucherId':row['voucher_id'],'shopId':LOCAL_SHOP_ID}
    def validate_and_consume_code(self, db, actor, code, operation_id, now=None):
        self.writable(db)
        row=self.validate_code(db,actor,code,now)
        db.execute('UPDATE presentation_codes SET active=0,code_cipher=NULL,consumed_by=? WHERE id=?',
                   (operation_id,row['codeId']))
        return row
    def original(self, db, actor, kind, intent_key, request):
        self.require_actor(db,actor,self.actor_role(kind))
        if self.b.owner_mode and kind!='issue': self.require_owner(db,actor)
        row=db.execute('SELECT * FROM operations WHERE actor_id=? AND kind=? AND intent_key=?',
                       (actor.actor_id,kind,require_id(intent_key))).fetchone()
        if row:
            if row['partner_id']!=actor.partner_id or (kind!='issue' and row['shop_id']!=actor.shop_id):
                raise ApiError(403,'FORBIDDEN','Original operation scope changed')
            if row['request_json']!=canonical(request): raise ApiError(409,'INTENT_CONFLICT','Original parameters changed')
            return dict(row)
        return None
    def enqueue(self, db, actor, kind, intent_key, target, request, payload, *, redemption_id=None, operation_id=None):
        if self.b.owner_mode and kind=='settle':
            raise ApiError(409,'EXTERNAL_WALLET_REQUIRED','Settlement must use original owner wallet intent')
        self.writable(db,allow_paused=kind=='report')
        original=self.original(db,actor,kind,intent_key,request)
        if original: return original
        spec=ACTIONS[kind];signer=self.b.signers.get(spec.signer_role)
        if not signer: raise ApiError(503,'SIGNER_UNCONFIGURED','Local action signer unavailable')
        op_id=operation_id or random_id();now=self.b.now();snapshot=canonical(request)
        try:
            db.execute('''INSERT INTO operations(id,kind,actor_id,partner_id,shop_id,redemption_id,intent_key,
                          request_json,payload_hash,status,target,created_at,updated_at)
                          VALUES(?,?,?,?,?,?,?,?,?,'QUEUED',?,?,?)''',
                       (op_id,kind,actor.actor_id,actor.partner_id,actor.shop_id,redemption_id,intent_key,
                        snapshot,digest(snapshot),target,now,now))
        except sqlite3.IntegrityError:
            raise ApiError(409,'OPERATION_PENDING','Original action remains pending') from None
        tx=action_transaction(self.b.rpc.contract,kind,op_id,payload)
        db.execute('''INSERT INTO outbox(operation_id,signer,tx_json,state,signing_stage)
                      VALUES(?,?,?,'QUEUED','NEVER_SIGNED')''',(op_id,signer,canonical(tx)))
        db.execute('INSERT INTO work_audit(operation_id,event,created_at) VALUES(?,?,?)',(op_id,'ACCEPTED_NEVER_SIGNED',now))
        return dict(db.execute('SELECT * FROM operations WHERE id=?',(op_id,)).fetchone())
    def dispatch_authorized(self, db, op):
        spec=ACTIONS.get(op['kind'])
        user=db.execute('SELECT * FROM users WHERE id=?',(op['actor_id'],)).fetchone()
        if not spec or not user or not user['enabled'] or user['role']!=self.actor_role(op['kind']): return False
        if op['kind']=='issue': return bool(user['partner_id'] and user['partner_id']==op['partner_id'])
        if user['shop_id']!=LOCAL_SHOP_ID or user['shop_id']!=op['shop_id']: return False
        if self.b.owner_mode:
            if op['kind']=='settle': return False
            binding=db.execute('SELECT * FROM owner_wallet_bindings WHERE actor_id=?',(user['id'],)).fetchone()
            if not binding or not binding['enabled'] or binding['shop_id']!=user['shop_id'] or binding['deployment_id']!=self.b.deployment['deploymentId'] or binding['address'].lower()!=self.b.deployment['merchant'].lower(): return False
        r=db.execute('SELECT * FROM redemptions WHERE id=?',(op['redemption_id'],)).fetchone()
        if not r or r['voucher_id']!=op['target'] or r['shop_id']!=user['shop_id']: return False
        if op['kind'] in ('lock','report') and r['actor_id']!=user['id']: return False
        if op['kind']=='lock': return r['lock_operation_id']==op['id']
        handoff=db.execute('SELECT * FROM handoff_statements WHERE redemption_id=?',(r['id'],)).fetchone()
        lock=db.execute('SELECT status FROM operations WHERE id=?',(r['lock_operation_id'],)).fetchone()
        if not handoff or not lock or lock['status']!='FINALIZED_SUCCESS': return False
        if op['kind']=='report': return handoff['actor_id']==user['id']
        if handoff['actor_id']==user['id']: return False
        return bool(db.execute("SELECT 1 FROM operations WHERE redemption_id=? AND kind='report' AND status='FINALIZED_SUCCESS'",(r['id'],)).fetchone())
    def release_failed(self, db, op):
        from server.chain.client import ChainConflict
        if op['kind']=='issue':
            self.b.resolve_reservation(db,op['id'],False)
            return
        r=db.execute('SELECT * FROM redemptions WHERE id=?',(op['redemption_id'],)).fetchone()
        if not r: raise ChainConflict('Missing private action context')
        if op['kind']=='lock':
            db.execute('DELETE FROM voucher_claims WHERE voucher_id=? AND redemption_id=?',(op['target'],r['id']))
            state='LOCK_FAILED'
        elif op['kind']=='report': state='HANDED_OFF'
        else: state='REPORTED'
        db.execute('UPDATE redemptions SET state=? WHERE id=?',(state,r['id']))
