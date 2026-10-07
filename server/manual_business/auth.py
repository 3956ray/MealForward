"""Trusted authenticator boundary, without selecting a credential product in BUILD."""
import secrets
from flask import request, jsonify
from server.auth import AuthService, _csrf
from server.backend import digest
from server.contracts import ApiError, AuthContext, AUTH_ABSOLUTE_TTL


class TrustedAuthentication:
    def __init__(self, backend, origin, verified_subject):
        if not callable(verified_subject): raise ValueError('Configured trusted authenticator required')
        self.b, self.verify = backend, verified_subject
        self.services = {role: AuthService(backend.store, origin=origin, clock=backend.clock,
                         secure_cookie=False, cookie_name='cp28_'+role, cookie_path='/api/cp28') for role in ('partner', 'owner')}

    def login(self, role):
        if role not in self.services: raise ApiError(403, 'FORBIDDEN', 'Work role required')
        # The callback verifies the selected real auth mechanism. It must never trust a submitted subject.
        subject = self.verify(request)
        if not isinstance(subject, str) or not subject: raise ApiError(401, 'AUTH_REQUIRED', 'Verified identity required')
        configured = self.b.runtime.config.get('trustedSubjects', {}).get(subject)
        if not configured: raise ApiError(403, 'TRUSTED_MAPPING_REQUIRED', 'Subject is not mapped to this deployment')
        with self.b.store.transaction() as db:
            mapping = db.execute('SELECT * FROM cp28_mapping WHERE actor_id=?', (configured['actorId'],)).fetchone()
            user = db.execute('SELECT * FROM users WHERE id=?', (configured['actorId'],)).fetchone()
            if not mapping or not mapping['enabled'] or mapping['revision'] != configured['revision'] or not user or user['role'] != role:
                raise ApiError(403, 'TRUSTED_MAPPING_REQUIRED', 'Current configured role mapping required')
            token = secrets.token_urlsafe(32); sid = digest(token); now = self.b.now(); expires = now+AUTH_ABSOLUTE_TTL
            self.b.store.create_session(sid, user['id'], digest(_csrf(token)), now, expires)
            old = request.cookies.get('cp28_'+role)
            if old: self.b.store.revoke_session(digest(old))
            db.execute('INSERT INTO cp28_sessions VALUES(?,?,?,?)', (sid, user['id'], mapping['revision'], self.b.runtime.config_digest))
            actor = AuthContext(user['id'], role, user['partner_id'], user['shop_id'], sid)
            self.b.work.require_actor(db, actor, role)
            result = self.services[role]._response(actor, expires, token)
            result.set_cookie('cp28_'+role, token, httponly=True, samesite='Strict', path='/api/cp28', max_age=AUTH_ABSOLUTE_TTL)
            return result

    def require(self, role, csrf=False):
        if role not in self.services: raise ApiError(403, 'FORBIDDEN', 'Work role required')
        actor = self.services[role].require(role, csrf=csrf)
        with self.b.store.transaction() as db: self.b.work.require_actor(db, actor, role)
        return actor

    def session(self, role):
        self.require(role)
        return self.services[role].session()

    def logout(self, role):
        actor = self.require(role, csrf=True)
        with self.b.store.transaction() as db:
            self.b.store.revoke_session(actor.session_id)
            db.execute('UPDATE owner_wallet_sessions SET revoked=1 WHERE session_id=?', (actor.session_id,))
            db.execute('UPDATE owner_wallet_challenges SET consumed=1 WHERE session_id=?', (actor.session_id,))
        response = jsonify(loggedOut=True)
        response.delete_cookie('cp28_'+role, path='/api/cp28', httponly=True, samesite='Strict')
        return response
