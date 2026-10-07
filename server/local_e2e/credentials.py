"""CP23 lifecycle on the business DB; lock consumes in the existing claim transaction."""
import secrets
import re
from server.backend import digest, random_id
from server.contracts import ApiError, LOCAL_SHOP_ID
from server.work_core import WorkCore
from server.redemption import RedemptionService

PREFIX = 'mealforward:local:v1:'

def unavailable():
    raise ApiError(404,'CODE_UNAVAILABLE','餐券展示凭证不可用，请重新展示并检查')

class LocalWork(WorkCore):
    def writable(self,db,*,allow_paused=False):
        # At the outer transaction start the anchor covers the committed state.
        if not getattr(self.b.store.local,'anchor_valid',False): raise ApiError(503,'RESTORE_QUARANTINE','独立恢复记录缺失或不一致；仅查询原操作')
        super().writable(db,allow_paused=allow_paused)
    def validate_code(self, db, actor, code, now=None):
        self.require_actor(db,actor,'owner');self.require_owner(db,actor)
        now=self.b.now() if now is None else now
        if not isinstance(code,str) or not (re.fullmatch(r'[0-9]{6}',code) or re.fullmatch(re.escape(PREFIX)+r'[A-Za-z0-9_-]{32}',code)):
            unavailable()
        row=db.execute('''SELECT d.id,i.voucher_id FROM cp24_display d JOIN cp24_session s ON s.hash=d.session_hash
                         JOIN cp24_invite i ON i.version=s.version WHERE d.consumed IS NULL AND d.expires>?
                         AND s.revoked=0 AND s.expires>? AND (d.code_hash=? OR d.qr_hash=?)''',
                       (now,now,self.code_hash(code),self.code_hash(code))).fetchone()
        if not row or not self.available(db,row['voucher_id']): unavailable()
        return {'codeId':row['id'],'voucherId':row['voucher_id'],'shopId':LOCAL_SHOP_ID}
    def validate_and_consume_code(self, db, actor, code, operation_id, now=None):
        self.writable(db);row=self.validate_code(db,actor,code,now)
        db.execute('UPDATE cp24_display SET consumed=? WHERE id=?',(operation_id,row['codeId']))
        return row

class LocalRedemption(RedemptionService):
    def _code_request(self, body, group_id=None):
        code=body['code']
        if not isinstance(code,str) or len(code)>128: unavailable()
        return {'intentKey':body['intentKey'],'codeHash':self.w.code_hash(code),'groupId':group_id}
    def _coded(self, actor, ip, action):
        # API serializes acceptance and persists failures after its business rollback.
        with self.b.store.transaction() as db:
            self._write_actor(db,actor);self.w.writable(db)
            return action(db)

class Credentials:
    def __init__(self,b): self.b=b
    def invite(self,actor,rotate):
        b=self.b
        with b.store.transaction() as db:
            b.work.require_actor(db,actor,'partner');b.work.writable(db)
            row=db.execute('''SELECT v.id FROM private_vouchers v JOIN operations o ON o.id=v.operation_id
                             WHERE o.partner_id=? AND v.confirmed=1 AND o.status='FINALIZED_SUCCESS' ''',(actor.partner_id,)).fetchone()
            if not row: raise ApiError(409,'ISSUANCE_REQUIRED','请等待原发行确认')
            old=db.execute('SELECT * FROM cp24_invite').fetchone()
            if old and (not rotate or old['opened']): raise ApiError(409,'INVITE_EXISTS','链接已生成；首次查看后不能更换，请使用原链接')
            if not b.work.available(db,row['id']): raise ApiError(409,'READ_ONLY','餐券已在处理中')
            secret=secrets.token_urlsafe(32);expires=b.now()+72*3600
            version=old['version']+1 if old else 1
            db.execute('INSERT OR REPLACE INTO cp24_invite VALUES(1,?,?,?,?,?)',(row['id'],digest(secret),expires,0,version))
            db.execute('UPDATE cp24_session SET revoked=1');db.execute('DELETE FROM cp24_display')
            return {'secret':secret,'expiresAt':expires}
    def session(self,db,token,csrf=None):
        row=db.execute('SELECT * FROM cp24_session WHERE hash=?',(digest(token or ''),)).fetchone()
        if not row or row['revoked'] or row['expires']<=self.b.now(): raise ApiError(401,'RECIPIENT_SESSION_REQUIRED','请用原有效私密链接重新查看')
        if csrf is not None and digest(csrf)!=row['csrf']: raise ApiError(403,'CSRF_DENIED','请刷新页面后操作')
        return row
    def payload(self,db,row,token):
        invite=db.execute('SELECT * FROM cp24_invite').fetchone()
        red=db.execute('SELECT state FROM redemptions WHERE voucher_id=?',(invite['voucher_id'],)).fetchone()
        return {'state':red['state'] if red else 'ISSUED','expiresAt':row['expires'],
                'csrfToken':digest('cp24-csrf:'+token),'canDisplay':self.b.work.available(db,invite['voucher_id'])}
    def exchange(self,secret):
        with self.b.store.transaction() as db:
            self.b.work.writable(db,allow_paused=True)
            invite=db.execute('SELECT * FROM cp24_invite').fetchone()
            if not isinstance(secret,str) or not invite or invite['hash']!=digest(secret) or invite['expires']<=self.b.now():
                raise ApiError(404,'LINK_UNAVAILABLE','链接不可用或已过期，请联系发券机构')
            db.execute('UPDATE cp24_session SET revoked=1');db.execute('DELETE FROM cp24_display')
            db.execute('UPDATE cp24_invite SET opened=1')
            token=secrets.token_urlsafe(32);csrf=digest('cp24-csrf:'+token)
            db.execute('INSERT INTO cp24_session VALUES(?,?,?,0,?)',(digest(token),digest(csrf),self.b.now()+8*3600,invite['version']))
            return token,self.payload(db,self.session(db,token),token)
    def display(self,token,csrf):
        with self.b.store.transaction() as db:
            self.b.work.writable(db)
            row=self.session(db,token,csrf or '')
            if not self.payload(db,row,token)['canDisplay']: raise ApiError(409,'READ_ONLY','餐券已在处理中，只能查看原状态')
            qr=PREFIX+secrets.token_urlsafe(24);code=f'{secrets.randbelow(1000000):06d}';expires=self.b.now()+120
            db.execute('INSERT OR REPLACE INTO cp24_display VALUES(1,?,?,?,?,NULL)',(row['hash'],self.b.work.code_hash(qr),self.b.work.code_hash(code),expires))
            return {'qrPayload':qr,'manualCode':code,'expiresAt':expires}
