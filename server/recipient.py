"""CP16 single-voucher invitations, recipient sessions and presentation codes.

Routes, exact Origin checks and HttpOnly cookie transport belong to the main web
module. Every DTO here uses an explicit allowlist; no internal voucher row escapes.
"""
import hmac
import hashlib
import secrets
import threading

from cryptography.fernet import InvalidToken
from server.backend import digest, random_id, require_id
from server.contracts import (
    ApiError, RECIPIENT_ABSOLUTE_TTL, RECIPIENT_IDLE_TTL, PRESENTATION_TTL,
)

_BOOTSTRAP_LOCK = threading.RLock()
_CODE_ATTEMPTS = 16


def _body(body, fields):
    if not isinstance(body, dict) or set(body) != set(fields):
        raise ApiError(422, 'INVALID_INPUT', 'Invalid recipient request')
    return body


def _csrf(token):
    return hmac.new(token.encode(), b'mealforward:recipient:csrf:v1', hashlib.sha256).hexdigest()


class RecipientService:
    def __init__(self, backend):
        self.b = backend

    def _maintenance(self):
        # Commit erasure separately: a following expired-session/intent error must
        # not roll the short-lived plaintext cleanup back.
        with self.b.store.transaction() as db:
            self.b.work.expire_codes(db)

    def _own(self, db, actor, voucher_id):
        self.b.work.require_actor(db, actor, 'partner')
        row = self.b.work.voucher(db, require_id(voucher_id, 'voucherId'))
        if row['partner_id'] != actor.partner_id:
            raise ApiError(403, 'FORBIDDEN', 'Current institutional scope required')
        return row

    def _available(self, db, voucher_id):
        if not self.b.work.available(db, voucher_id):
            raise ApiError(409, 'VOUCHER_UNAVAILABLE', 'Voucher is not available for presentation')

    def _voucher_dto(self, db, row):
        pending = bool(db.execute('SELECT 1 FROM voucher_claims WHERE voucher_id=?', (row['id'],)).fetchone())
        return {'voucherId': row['id'], 'status': row['chain_status'], 'processing': pending,
                'merchant': self.b.deployment['merchant'], 'priceWei': self.b.deployment['priceWei']}

    @staticmethod
    def _delivery_dto(row):
        return {'id': row['id'], 'voucherId': row['voucher_id'], 'actorId': row['actor_id'],
                'channel': row['channel'], 'result': row['result'], 'createdAt': row['created_at']}

    def list_vouchers(self, actor):
        with self.b.store.transaction() as db:
            self.b.work.require_actor(db, actor, 'partner')
            ids = db.execute('''SELECT v.id FROM private_vouchers v JOIN operations o ON o.id=v.operation_id
                                WHERE o.partner_id=? ORDER BY v.rowid''', (actor.partner_id,)).fetchall()
            vouchers = []
            for item in ids:
                row = self.b.work.voucher(db, item['id'])
                dto = self._voucher_dto(db, row)
                latest = db.execute('SELECT * FROM delivery_attempts WHERE voucher_id=? ORDER BY rowid DESC LIMIT 1',
                                    (row['id'],)).fetchone()
                dto['delivery'] = self._delivery_dto(latest) if latest else None
                vouchers.append(dto)
            return {'vouchers': vouchers}

    def invitation(self, actor, voucher_id, body):
        key = require_id(_body(body, ('intentKey',))['intentKey'], 'intentKey')
        with self.b.store.transaction() as db:
            self.b.work.writable(db)
            row = self._own(db, actor, voucher_id)
            self._available(db, voucher_id)
            old = db.execute('SELECT * FROM invitation_audits WHERE actor_id=? AND intent_key=?',
                             (actor.actor_id, key)).fetchone()
            if old and (old['voucher_id'] != voucher_id or old['partner_id'] != actor.partner_id):
                raise ApiError(409, 'INTENT_CONFLICT', 'Original invitation request changed')
            try:
                secret = self.b.decrypt(row['secret_cipher'])
            except (InvalidToken, ValueError, TypeError):
                raise ApiError(503, 'INVITATION_UNAVAILABLE', 'Invitation material unavailable') from None
            if not hmac.compare_digest(digest(secret), row['secret_hash']):
                raise ApiError(503, 'INVITATION_UNAVAILABLE', 'Invitation material unavailable')
            if not old:
                db.execute('''INSERT INTO invitation_audits(id,actor_id,partner_id,voucher_id,intent_key,created_at)
                              VALUES(?,?,?,?,?,?)''', (random_id(), actor.actor_id, actor.partner_id, voucher_id, key, self.b.now()))
            return {'voucherId': voucher_id, 'secret': secret}

    def deliver(self, actor, voucher_id, body):
        body = _body(body, ('intentKey', 'channel', 'result'))
        key = require_id(body['intentKey'], 'intentKey')
        if body['channel'] not in ('private_message', 'in_person') or body['result'] not in ('sent', 'failed'):
            raise ApiError(422, 'INVALID_INPUT', 'Invalid delivery record')
        with self.b.store.transaction() as db:
            self.b.work.writable(db)
            self._own(db, actor, voucher_id)
            old = db.execute('SELECT * FROM delivery_attempts WHERE actor_id=? AND intent_key=?',
                             (actor.actor_id, key)).fetchone()
            if old:
                if (old['voucher_id'], old['partner_id'], old['channel'], old['result']) != (
                        voucher_id, actor.partner_id, body['channel'], body['result']):
                    raise ApiError(409, 'INTENT_CONFLICT', 'Original delivery request changed')
                return {'delivery': self._delivery_dto(old)}
            self._available(db, voucher_id)
            delivery_id = random_id()
            db.execute('''INSERT INTO delivery_attempts(id,actor_id,partner_id,voucher_id,intent_key,channel,result,created_at)
                          VALUES(?,?,?,?,?,?,?,?)''', (delivery_id, actor.actor_id, actor.partner_id, voucher_id,
                                                     key, body['channel'], body['result'], self.b.now()))
            row = db.execute('SELECT * FROM delivery_attempts WHERE id=?', (delivery_id,)).fetchone()
            return {'delivery': self._delivery_dto(row)}

    def deliveries(self, actor, voucher_id):
        with self.b.store.transaction() as db:
            self._own(db, actor, voucher_id)
            rows = db.execute('SELECT * FROM delivery_attempts WHERE voucher_id=? ORDER BY rowid', (voucher_id,)).fetchall()
            return {'deliveries': [self._delivery_dto(row) for row in rows]}

    @staticmethod
    def _revoke(db, token_hash):
        db.execute('UPDATE recipient_sessions SET revoked=1 WHERE token_hash=?', (token_hash,))
        db.execute('UPDATE presentation_codes SET active=0,code_cipher=NULL WHERE session_hash=?', (token_hash,))

    def _session(self, db, token, csrf=None, *, check_csrf=False, touch=True):
        if not isinstance(token, str) or not token or len(token) > 256:
            raise ApiError(401, 'RECIPIENT_SESSION_REQUIRED', 'Reopen the original invitation')
        now = self.b.now()
        row = db.execute('''SELECT s.* FROM recipient_sessions s JOIN recipient_heads h
                            ON h.voucher_id=s.voucher_id AND h.session_hash=s.token_hash
                            WHERE s.token_hash=? AND s.revoked=0 AND s.expires_at>? AND s.last_seen_at>?''',
                         (digest(token), now, now - RECIPIENT_IDLE_TTL)).fetchone()
        if not row:
            raise ApiError(401, 'RECIPIENT_SESSION_REQUIRED', 'Reopen the original invitation')
        if check_csrf and (not isinstance(csrf, str) or not csrf or len(csrf) > 256
                           or not hmac.compare_digest(digest(csrf), row['csrf_hash'])):
            raise ApiError(403, 'CSRF_DENIED', 'Request verification failed')
        if touch:
            db.execute('UPDATE recipient_sessions SET last_seen_at=? WHERE token_hash=?', (now, row['token_hash']))
        return dict(row)

    def exchange(self, body, ip, previous_token=None):
        body = _body(body, ('secret',))
        secret = body['secret']
        if not isinstance(secret, str) or not 1 <= len(secret) <= 256:
            raise ApiError(422, 'INVALID_INPUT', 'Invalid invitation request')
        keys = ('recipient:bootstrap:ip:' + str(ip), 'recipient:bootstrap:secret:' + digest(secret))
        self._maintenance()
        with _BOOTSTRAP_LOCK:
            now = self.b.now()
            if any(self.b.store.auth_failure_count(key, now, 900) >= 5 for key in keys):
                raise ApiError(429, 'RECIPIENT_LIMITED', 'Recipient request temporarily unavailable')
            try:
                with self.b.store.transaction() as db:
                    self.b.work.writable(db)
                    row = db.execute('SELECT id FROM private_vouchers WHERE secret_hash=?', (digest(secret),)).fetchone()
                    if not row or not self.b.work.available(db, row['id']):
                        raise ApiError(401, 'INVITATION_UNAVAILABLE', 'Invitation unavailable')
                    voucher_id = row['id']
                    head = db.execute('SELECT session_hash FROM recipient_heads WHERE voucher_id=?', (voucher_id,)).fetchone()
                    if head:
                        self._revoke(db, head['session_hash'])
                    # Only possession of a currently valid session authorizes a
                    # voucher switch to revoke it; a supplied session ID is inert.
                    if previous_token:
                        try:
                            previous = self._session(db, previous_token, touch=False)
                        except ApiError:
                            previous = None
                        if previous:
                            self._revoke(db, previous['token_hash'])
                    token = secrets.token_urlsafe(32)
                    token_hash = digest(token)
                    session_id = random_id()
                    expires = now + RECIPIENT_ABSOLUTE_TTL
                    db.execute('''INSERT INTO recipient_sessions(token_hash,session_id,voucher_id,csrf_hash,
                                  created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?,?)''',
                               (token_hash, session_id, voucher_id, digest(_csrf(token)), now, expires, now))
                    db.execute('INSERT INTO recipient_heads(voucher_id,session_hash) VALUES(?,?) '
                               'ON CONFLICT(voucher_id) DO UPDATE SET session_hash=excluded.session_hash', (voucher_id, token_hash))
                    voucher = self._voucher_dto(db, self.b.work.voucher(db, voucher_id))
                    return {'sessionId': session_id, 'expiresAt': expires, 'csrfToken': _csrf(token), 'voucher': voucher}, token
            except ApiError as error:
                if error.code == 'INVITATION_UNAVAILABLE':
                    for key in keys:
                        self.b.store.record_auth_failure(key, now)
                raise

    def voucher(self, token):
        self._maintenance()
        with self.b.store.transaction() as db:
            self.b._writable_in_transaction(db)  # Restored capabilities grant no private reads.
            session = self._session(db, token)
            return {'sessionId': session['session_id'],
                    'voucher': self._voucher_dto(db, self.b.work.voucher(db, session['voucher_id']))}

    def present(self, token, csrf, body, ip):
        key = require_id(_body(body, ('intentKey',))['intentKey'], 'intentKey')
        self._maintenance()
        with self.b.store.transaction() as db:
            self.b.work.writable(db)
            session = self._session(db, token, csrf, check_csrf=True)
            self._available(db, session['voucher_id'])
            now = self.b.now()
            old = db.execute('SELECT * FROM presentation_codes WHERE session_hash=? AND intent_key=?',
                             (session['token_hash'], key)).fetchone()
            if old:
                if not old['active'] or old['consumed_by'] or old['expires_at'] <= now or not old['code_cipher']:
                    raise ApiError(409, 'PRESENTATION_EXPIRED', 'Actively request a new presentation')
                try:
                    code = self.b.decrypt(old['code_cipher'])
                except (InvalidToken, ValueError, TypeError):
                    raise ApiError(503, 'PRESENTATION_UNAVAILABLE', 'Presentation temporarily unavailable') from None
                if not hmac.compare_digest(self.b.work.code_hash(code), old['code_hash']):
                    raise ApiError(503, 'PRESENTATION_UNAVAILABLE', 'Presentation temporarily unavailable')
                return self._code_dto(session, code, old['expires_at'])
            rate_key = 'recipient:present:' + session['token_hash']
            count = db.execute('SELECT count(*) AS n FROM auth_failures WHERE key=? AND occurred_at>?',
                               (rate_key, now - 60)).fetchone()['n']
            if count >= 5:
                raise ApiError(429, 'RECIPIENT_LIMITED', 'Recipient request temporarily unavailable')
            for _ in range(_CODE_ATTEMPTS):
                code = f'{secrets.randbelow(100000000):08d}'
                code_hash = self.b.work.code_hash(code)
                if not db.execute('SELECT 1 FROM presentation_codes WHERE code_hash=? AND active=1', (code_hash,)).fetchone():
                    break
            else:
                raise ApiError(503, 'PRESENTATION_UNAVAILABLE', 'Presentation temporarily unavailable')
            db.execute('UPDATE presentation_codes SET active=0,code_cipher=NULL WHERE voucher_id=? AND active=1',
                       (session['voucher_id'],))
            expires = min(now + PRESENTATION_TTL, session['expires_at'])
            db.execute('''INSERT INTO presentation_codes(id,voucher_id,session_hash,intent_key,code_hash,
                          code_cipher,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)''',
                       (random_id(), session['voucher_id'], session['token_hash'], key, code_hash,
                        self.b.encrypt(code), now, expires))
            db.execute('INSERT INTO auth_failures(key,occurred_at) VALUES(?,?)', (rate_key, now))
            return self._code_dto(session, code, expires)

    @staticmethod
    def _code_dto(session, code, expires):
        return {'sessionId': session['session_id'], 'voucherId': session['voucher_id'], 'code': code, 'expiresAt': expires}

    def logout(self, token, csrf):
        self._maintenance()
        with self.b.store.transaction() as db:
            self.b._writable_in_transaction(db)
            session = self._session(db, token, csrf, check_csrf=True, touch=False)
            self._revoke(db, session['token_hash'])
