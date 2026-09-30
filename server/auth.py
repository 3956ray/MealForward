"""Personal work authentication for the isolated CP15 backend."""
import hashlib
import hmac
import secrets
import threading
import time

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from argon2.low_level import Type
from flask import jsonify, make_response, request

from server.contracts import (
    AUTH_ABSOLUTE_TTL, AUTH_FAILURE_LIMIT, AUTH_FAILURE_WINDOW, AUTH_IDLE_TTL,
    WORK_COOKIE, ApiError, AuthContext, AuthStore,
)

_PASSWORDS = PasswordHasher(time_cost=2, memory_cost=19 * 1024, parallelism=1, type=Type.ID)
# Serialize check/verify/record for the single-process local backend. Counters are
# durable; multi-process serving requires an atomic store admission interface.
_LOGIN_LOCK = threading.RLock()


def hash_password(password: str) -> str:
    return _PASSWORDS.hash(password)


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def _csrf(token: str) -> str:
    return hmac.new(token.encode('utf-8'), b'mealforward:work:csrf:v1', hashlib.sha256).hexdigest()


class AuthService:
    def __init__(self, store: AuthStore, *, origin, clock, secure_cookie):
        self.store = store
        self.origin = origin
        self.clock = clock
        self.secure_cookie = secure_cookie
        # Unknown usernames still incur the same password verification work.
        self._dummy_hash = hash_password(secrets.token_urlsafe(32))

    def _origin(self):
        if request.headers.get('Origin') != self.origin:
            raise ApiError(403, 'ORIGIN_DENIED', 'Request origin is not allowed')

    def _authenticate(self, role=None, *, csrf=False):
        token = request.cookies.get(WORK_COOKIE, '')
        if not token or len(token) > 256:
            raise ApiError(401, 'UNAUTHENTICATED', 'Work authentication required')
        session_id = _digest(token)
        session = self.store.get_session(session_id)
        now = int(self.clock())
        if not session or session['revoked']:
            raise ApiError(401, 'UNAUTHENTICATED', 'Work authentication required')
        user = self.store.get_user(session['user_id'])
        if (not user or not user['enabled'] or now >= session['expires_at']
                or now >= session['created_at'] + AUTH_ABSOLUTE_TTL
                or now >= session['last_seen_at'] + AUTH_IDLE_TTL):
            self.store.revoke_session(session_id)
            raise ApiError(401, 'UNAUTHENTICATED', 'Work authentication required')
        if role is not None and user['role'] != role:
            raise ApiError(403, 'FORBIDDEN', 'Work role is not allowed')
        if csrf:
            self._origin()
            supplied = request.headers.get('X-CSRF-Token', '')
            if not supplied or not hmac.compare_digest(_digest(supplied), session['csrf_hash']):
                raise ApiError(403, 'CSRF_DENIED', 'Request verification failed')
        self.store.touch_session(session_id, now)
        context = AuthContext(user['id'], user['role'], user['partner_id'], user['shop_id'], session_id)
        return context, session, token

    def require(self, role=None, *, csrf=False) -> AuthContext:
        return self._authenticate(role, csrf=csrf)[0]

    @staticmethod
    def _response(context, expires_at, token):
        response = jsonify(actorId=context.actor_id, role=context.role,
                           partnerId=context.partner_id, shopId=context.shop_id,
                           expiresAt=expires_at, csrfToken=_csrf(token))
        response.headers['Cache-Control'] = 'no-store'
        return response

    def login(self):
        self._origin()
        body = request.get_json(silent=True) if request.is_json else None
        if (not isinstance(body, dict) or set(body) != {'username', 'password'}
                or not isinstance(body['username'], str) or not isinstance(body['password'], str)
                or not 1 <= len(body['username']) <= 128 or not 1 <= len(body['password']) <= 1024):
            raise ApiError(400, 'INVALID_REQUEST', 'Expected username and password')
        username = body['username'].strip().casefold()
        account_key = 'user:' + username
        # The direct peer is authoritative; forwarding headers are untrusted.
        ip_key = 'ip:' + (request.remote_addr or 'unknown')
        with _LOGIN_LOCK:
            now = int(self.clock())
            if any(self.store.auth_failure_count(key, now, AUTH_FAILURE_WINDOW) >= AUTH_FAILURE_LIMIT
                   for key in (account_key, ip_key)):
                raise ApiError(429, 'LOGIN_LIMITED', 'Login temporarily unavailable')
            user = self.store.get_user_by_username(username)
            try:
                verified = _PASSWORDS.verify(user['password_hash'] if user else self._dummy_hash, body['password'])
            except (VerificationError, InvalidHashError):
                verified = False
            if not verified or not user or not user['enabled']:
                for key in (account_key, ip_key):
                    self.store.record_auth_failure(key, now)
                raise ApiError(401, 'INVALID_CREDENTIALS', 'Invalid username or password')
            self.store.clear_auth_failures(account_key)
            # Retain IP failures so one valid account cannot clear a spraying limit.
            token = secrets.token_urlsafe(32)
            session_id = _digest(token)
            expires_at = now + AUTH_ABSOLUTE_TTL
            self.store.create_session(session_id, user['id'], _digest(_csrf(token)), now, expires_at)
            old_token = request.cookies.get(WORK_COOKIE)
            if old_token:
                self.store.revoke_session(_digest(old_token))
        context = AuthContext(user['id'], user['role'], user['partner_id'], user['shop_id'], session_id)
        response = self._response(context, expires_at, token)
        response.set_cookie(WORK_COOKIE, token, max_age=AUTH_ABSOLUTE_TTL, httponly=True,
                            secure=self.secure_cookie, samesite='Lax', path='/api/v1')
        return response

    def session(self):
        context, session, token = self._authenticate()
        return self._response(context, session['expires_at'], token)

    def logout(self):
        context = self.require(csrf=True)
        self.store.revoke_session(context.session_id)
        response = make_response('', 204)
        response.headers['Cache-Control'] = 'no-store'
        response.delete_cookie(WORK_COOKIE, path='/api/v1', secure=self.secure_cookie,
                               httponly=True, samesite='Lax')
        return response


def register_auth(app, store, *, origin, clock=time.time, secure_cookie=False):
    service = AuthService(store, origin=origin, clock=clock, secure_cookie=secure_cookie)
    app.add_url_rule('/api/v1/auth/login', 'work_auth_login', service.login, methods=['POST'])
    app.add_url_rule('/api/v1/auth/session', 'work_auth_session', service.session, methods=['GET'])
    app.add_url_rule('/api/v1/auth/logout', 'work_auth_logout', service.logout, methods=['POST'])
    return service
