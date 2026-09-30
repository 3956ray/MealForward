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
    def require_actor(self, db, actor, role=None):
        row=db.execute('SELECT * FROM users WHERE id=?',(actor.actor_id,)).fetchone()
        if not row or not row['enabled']: raise ApiError(401,'AUTH_REQUIRED','Current work account required')
        if (row['role']!=actor.role or row['partner_id']!=actor.partner_id or row['shop_id']!=actor.shop_id
                or (role and row['role']!=role)):
            raise ApiError(403,'FORBIDDEN','Current work scope required')
        if row['role'] in ('staff','settler') and row['shop_id']!=LOCAL_SHOP_ID:
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
        self.require_actor(db,actor,'staff')
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
        self.require_actor(db,actor,ACTIONS[kind].actor_role)
        row=db.execute('SELECT * FROM operations WHERE actor_id=? AND kind=? AND intent_key=?',
                       (actor.actor_id,kind,require_id(intent_key))).fetchone()
        if row:
            if row['partner_id']!=actor.partner_id or (kind!='issue' and row['shop_id']!=actor.shop_id):
                raise ApiError(403,'FORBIDDEN','Original operation scope changed')
            if row['request_json']!=canonical(request): raise ApiError(409,'INTENT_CONFLICT','Original parameters changed')
            return dict(row)
        return None
    def enqueue(self, db, actor, kind, intent_key, target, request, payload, *, redemption_id=None, operation_id=None):
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
