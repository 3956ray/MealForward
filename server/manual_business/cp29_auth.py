"""JWT-bounded CP29 work sessions; no runtime or signer authority is created here."""
import secrets
from flask import request, jsonify
from server.auth import _csrf
from server.backend import canonical, digest
from server.contracts import ApiError, AuthContext, AUTH_ABSOLUTE_TTL
from .auth import TrustedAuthentication
from .cp29_mode import ACTORS, MODE, DISCLAIMER, validate_identity_mode


class CP29Authentication(TrustedAuthentication):
    def check_authority(self):
        if self.b.runtime.source_check is not None:
            self.b.runtime.source_check()
        if digest(canonical(self.b.runtime.config)) != self.b.runtime.config_digest:
            raise ApiError(403, 'IDENTITY_CHANGED', 'Original identity configuration required')
        self.verify.check_source()
        try:
            return validate_identity_mode(self.b.runtime.config, self.b.now())
        except ValueError:
            raise ApiError(403, 'IDENTITY_MODE_INVALID', 'Current approved identity mode required') from None

    def public_identity(self):
        limit = self.check_authority()
        return {'identityMode': MODE if limit is not None else 'two-subject',
                'identityNotice': DISCLAIMER if limit is not None else '两个独立的已验证工作身份',
                'identityModeExpiresAt': limit}

    @staticmethod
    def revoke(db, session_id):
        db.execute('UPDATE work_sessions SET revoked=1 WHERE token_hash=?', (session_id,))
        db.execute('UPDATE owner_wallet_sessions SET revoked=1 WHERE session_id=?', (session_id,))
        db.execute('UPDATE owner_wallet_challenges SET consumed=1 WHERE session_id=?', (session_id,))

    def audit(self, db, role, event, single):
        # No subject, fingerprint, session ID, credential or wallet data.
        db.execute('INSERT INTO cp24_audit(redemption_id,actor,event,created) VALUES(?,?,?,?)',
                   ('', role, canonical({'event': event, 'mode': MODE if single else 'two-subject',
                     'notice': DISCLAIMER if single else 'two verified subjects'}), self.b.now()))

    def login(self, role):
        if role not in self.services:
            raise ApiError(403, 'FORBIDDEN', 'Fixed work role required')
        identity = self.verify.verify_identity(request)
        with self.b.store.transaction() as db:
            limit = self.check_authority()
            configured = self.b.runtime.config['trustedSubjects'].get(identity.subject_fingerprint)
            if configured and limit is not None:
                configured = configured[role]
            if not configured:
                raise ApiError(403, 'TRUSTED_MAPPING_REQUIRED', 'Approved work mapping required')
            mapping = db.execute('SELECT * FROM cp28_mapping WHERE actor_id=?', (configured['actorId'],)).fetchone()
            user = db.execute('SELECT * FROM users WHERE id=?', (configured['actorId'],)).fetchone()
            if (not mapping or not mapping['enabled'] or mapping['revision'] != configured['revision'] or
                    not user or not user['enabled'] or user['role'] != role):
                raise ApiError(403, 'TRUSTED_MAPPING_REQUIRED', 'Current configured role mapping required')
            now = self.b.now()
            expires = min(now + AUTH_ABSOLUTE_TTL, identity.expires_at,
                          limit if limit is not None else now + AUTH_ABSOLUTE_TTL)
            if expires <= now:
                raise ApiError(401, 'AUTH_REQUIRED', 'Current verified identity required')
            token = secrets.token_urlsafe(32)
            sid = digest(token)
            self.b.store.create_session(sid, user['id'], digest(_csrf(token)), now, expires)
            db.execute('INSERT INTO cp28_sessions VALUES(?,?,?,?)',
                       (sid, user['id'], mapping['revision'], self.b.runtime.config_digest))
            actor = AuthContext(user['id'], role, user['partner_id'], user['shop_id'], sid)
            self.b.work.require_actor(db, actor, role)
            if limit is not None:
                old = db.execute('SELECT token_hash FROM work_sessions WHERE user_id IN (?,?) AND token_hash!=?',
                                 (*ACTORS.values(), sid)).fetchall()
                for row in old:
                    self.revoke(db, row['token_hash'])
            else:
                old_cookie = request.cookies.get('cp28_' + role)
                if old_cookie:
                    self.revoke(db, digest(old_cookie))
            self.audit(db, role, 'WORK_LOGIN', limit is not None)
            response = self.services[role]._response(actor, expires, token)
            response.set_cookie('cp28_' + role, token, httponly=True, samesite='Strict',
                                path='/api/cp28', max_age=expires - now)
            return response

    def require(self, role, csrf=False):
        with self.b.store.transaction():
            self.check_authority()
            return super().require(role, csrf)

    def logout(self, role):
        if role not in self.services or request.get_json(silent=True) != {}:
            raise ApiError(422, 'INVALID_INPUT', 'Fixed empty work logout required')
        # Revocation remains available when runtime/config mapping has expired.
        # Authenticate the cookie and its CSRF, without granting business rights.
        with self.b.store.transaction() as db:
            actor = self.services[role].require(role, csrf=True)
            self.revoke(db, actor.session_id)
            self.audit(db, role, 'WORK_LOGOUT', self.b.runtime.config.get('cp29IdentityMode') == MODE)
        response = jsonify(loggedOut=True)
        response.delete_cookie('cp28_' + role, path='/api/cp28', httponly=True, samesite='Strict')
        return response
