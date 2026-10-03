"""Dynamic access token + local trusted mapping -> bounded work cookie/CSRF session."""
import hmac
import json
import secrets

from flask import jsonify, make_response, request

from server.auth import AuthService, _csrf, _digest
from server.contracts import ApiError, AuthContext, DynamicAuthorization, AUTH_ABSOLUTE_TTL, AUTH_IDLE_TTL
from server.dynamic_contracts import ALLOWED_ORIGINS, CP17_COOKIES
from server.dynamic_mapping import mapping_current, scope_allowed, subject_hash


class DynamicAuthService(AuthService):
    def __init__(self, store, *, profile, jwks, clock, verifier=None):
        from server.dynamic_jwt import verify_access_token
        self.store, self.profile, self.jwks, self.clock = store, profile, jwks, clock
        self.verifier = verifier or verify_access_token
        self.secure_cookie = False

    def _origin(self):
        expected = 'http://' + request.host
        if expected not in ALLOWED_ORIGINS or request.headers.get('Origin') != expected:
            raise ApiError(403, 'ORIGIN_DENIED', 'Request origin is not allowed')

    def host(self):
        if 'http://' + request.host not in ALLOWED_ORIGINS:
            raise ApiError(403, 'HOST_DENIED', 'Request host is not allowed')
        # Browser GET may omit Origin; if supplied it must match, never reflect it.
        if request.headers.get('Origin') is not None: self._origin()

    def identity(self):
        value = request.headers.get('Authorization', '')
        if not value.startswith('Bearer ') or len(value) > 16400 or not value[7:]:
            raise ApiError(401, 'DYNAMIC_TOKEN_REJECTED', 'Current access token required')
        identity = self.verifier(value[7:], profile=self.profile, clock=self.clock, jwks=self.jwks)
        if identity.expires_at <= int(self.clock()):
            raise ApiError(401, 'DYNAMIC_TOKEN_REJECTED', 'Current access token required')
        return identity

    @staticmethod
    def revoke(db, session_id):
        db.execute('UPDATE work_sessions SET revoked=1 WHERE token_hash=?', (session_id,))
        db.execute('UPDATE owner_wallet_sessions SET revoked=1 WHERE session_id=?', (session_id,))
        db.execute('UPDATE owner_wallet_challenges SET consumed=1 WHERE session_id=?', (session_id,))

    def login(self):
        raise ApiError(403, 'PASSWORD_LOGIN_DISABLED', 'Use the identity login for this entry')

    def exchange(self):
        self._origin()
        if not request.is_json or request.get_json(silent=True) != {}:
            raise ApiError(400, 'INVALID_REQUEST', 'Empty JSON object required')
        # Bound verification admission before network/signature work, without storing token.
        key = 'dynamic-exchange:' + (request.remote_addr or 'unknown')
        now = int(self.clock())
        with self.store.transaction() as db:
            count = db.execute('SELECT count(*) FROM auth_failures WHERE key=? AND occurred_at>?', (key, now-60)).fetchone()[0]
            if count >= 30: raise ApiError(429, 'RATE_LIMITED', 'Try later')
            db.execute('INSERT INTO auth_failures VALUES(?,?)', (key, now))
        identity = self.identity()
        token = secrets.token_urlsafe(32)
        session_id = _digest(token)
        now = int(self.clock()); expires = min(now + AUTH_ABSOLUTE_TTL, identity.expires_at)
        if expires <= now: raise ApiError(401, 'DYNAMIC_TOKEN_REJECTED', 'Current access token required')
        with self.store.transaction() as db:
            mapping = db.execute('SELECT * FROM dynamic_identity_mappings WHERE environment_id=? AND issuer=? AND subject=?',
                                 (identity.environment_id, identity.issuer, identity.subject)).fetchone()
            user = db.execute('SELECT * FROM users WHERE id=?', (mapping['actor_id'],)).fetchone() if mapping else None
            if not mapping or not mapping['enabled'] or not mapping['authority_source_version'] or not user or not user['enabled'] or not scope_allowed(user):
                raise ApiError(403, 'DYNAMIC_IDENTITY_UNMAPPED', 'No trusted work role is configured')
            old = request.cookies.get(CP17_COOKIES.work)
            if old: self.revoke(db, _digest(old))
            db.execute('INSERT INTO work_sessions VALUES(?,?,?,?,?,?,0)',
                       (session_id, user['id'], _digest(_csrf(token)), now, expires, now))
            db.execute('INSERT INTO dynamic_session_bindings VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
                       (session_id, mapping['id'], mapping['revision'], identity.environment_id, identity.issuer,
                        subject_hash(identity.subject), identity.expires_at, json.dumps(sorted(identity.scopes)),
                        identity.sid_hash, user['role'], user['partner_id'], user['shop_id']))
            context = AuthContext(user['id'], user['role'], user['partner_id'], user['shop_id'], session_id)
        response = self._response(context, expires, token)
        response.set_cookie(CP17_COOKIES.work, token, max_age=expires-now, httponly=True, secure=False,
                            samesite='Lax', path='/api/v1')
        return response

    def _authenticate(self, role=None, *, csrf=False):
        self.host()
        if csrf: self._origin()
        identity = self.identity()
        token = request.cookies.get(CP17_COOKIES.work, '')
        if not token or len(token) > 256:
            raise ApiError(401, 'DYNAMIC_SESSION_REJECTED', 'Current work session required')
        session_id = _digest(token); now = int(self.clock())
        with self.store.transaction() as db:
            session = db.execute('SELECT * FROM work_sessions WHERE token_hash=?', (session_id,)).fetchone()
            binding = db.execute('SELECT * FROM dynamic_session_bindings WHERE session_id=?', (session_id,)).fetchone()
            if (not session or not binding or session['revoked'] or session['expires_at'] <= now
                    or session['created_at'] + AUTH_ABSOLUTE_TTL <= now or session['last_seen_at'] + AUTH_IDLE_TTL <= now
                    or binding['access_expires_at'] <= now or identity.environment_id != binding['environment_id']
                    or identity.issuer != binding['issuer'] or subject_hash(identity.subject) != binding['subject_hash']
                    or identity.sid_hash != binding['sid_hash']
                    or not mapping_current(db, mapping_id=binding['mapping_id'], revision=binding['mapping_revision'],
                                           environment_id=binding['environment_id'], subject_digest=binding['subject_hash'],
                                           actor_id=session['user_id'], role=binding['actor_role'],
                                           partner_id=binding['partner_id'], shop_id=binding['shop_id'])):
                raise ApiError(401, 'DYNAMIC_SESSION_REJECTED', 'Current mapped work session required')
            if role is not None and role != binding['actor_role']:
                raise ApiError(403, 'FORBIDDEN', 'Work role is not allowed')
            if csrf:
                supplied = request.headers.get('X-CSRF-Token', '')
                if not supplied or not hmac.compare_digest(_digest(supplied), session['csrf_hash']):
                    raise ApiError(403, 'CSRF_DENIED', 'Request verification failed')
            db.execute('UPDATE work_sessions SET last_seen_at=? WHERE token_hash=?', (now, session_id))
            auth = DynamicAuthorization(binding['mapping_id'], binding['mapping_revision'], identity.environment_id,
                                        identity.issuer, binding['subject_hash'], identity.expires_at)
            context = AuthContext(session['user_id'], binding['actor_role'], binding['partner_id'], binding['shop_id'], session_id, auth)
            return context, dict(session), token

    def logout(self):
        self._origin()
        if not request.is_json or request.get_json(silent=True) != {}:
            raise ApiError(400, 'INVALID_REQUEST', 'Empty JSON object required')
        token = request.cookies.get(CP17_COOKIES.work, '')
        supplied = request.headers.get('X-CSRF-Token', '')
        if not token or len(token) > 256: raise ApiError(401, 'UNAUTHENTICATED', 'Work session required')
        session_id = _digest(token)
        with self.store.transaction() as db:
            session = db.execute('SELECT * FROM work_sessions WHERE token_hash=?', (session_id,)).fetchone()
            if not session or not supplied or not hmac.compare_digest(_digest(supplied), session['csrf_hash']):
                raise ApiError(403, 'CSRF_DENIED', 'Request verification failed')
            self.revoke(db, session_id)
        response = make_response('', 204)
        response.headers['Cache-Control'] = 'no-store'
        response.delete_cookie(CP17_COOKIES.work, path='/api/v1', httponly=True, samesite='Lax')
        return response


def register_dynamic_auth(app, store, *, profile, jwks, clock, verifier=None, capture_directory=None):
    service = DynamicAuthService(store, profile=profile, jwks=jwks, clock=clock, verifier=verifier)
    app.add_url_rule('/api/v1/auth/dynamic/exchange', 'dynamic_exchange', service.exchange, methods=['POST'])
    app.add_url_rule('/api/v1/auth/login', 'work_auth_login', service.login, methods=['POST'])
    app.add_url_rule('/api/v1/auth/session', 'work_auth_session', service.session, methods=['GET'])
    app.add_url_rule('/api/v1/auth/logout', 'work_auth_logout', service.logout, methods=['POST'])
    if capture_directory is not None:
        from server.dynamic_profile import ProfileCapture
        capture=ProfileCapture(capture_directory,clock=clock,jwks=jwks)
        @app.post('/api/v1/auth/dynamic/profile-check')
        def profile_check():
            service._origin()
            if not request.is_json or request.get_json(silent=True)!={}:
                raise ApiError(400,'INVALID_REQUEST','Empty JSON object required')
            key='profile-check:'+(request.remote_addr or 'unknown');now=int(clock())
            with store.transaction() as db:
                count=db.execute('SELECT count(*) FROM auth_failures WHERE key=? AND occurred_at>?',(key,now-60)).fetchone()[0]
                if count>=5: raise ApiError(429,'RATE_LIMITED','Try later')
                db.execute('INSERT INTO auth_failures VALUES(?,?)',(key,now))
            bearer=request.headers.get('Authorization','')
            if not bearer.startswith('Bearer ') or len(bearer)>16400:
                raise ApiError(401,'DYNAMIC_TOKEN_REJECTED','Current access token required')
            return jsonify(capture.inspect(bearer[7:]))
    return service
