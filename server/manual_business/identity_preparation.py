"""Non-authorizing Dynamic identity preparation. No business DB, wallet key or RPC.

Sessions and candidate declarations live only in bounded process memory. Restart
revokes them; the existing preparation identity and anchor are never rewritten.
"""
import hashlib
import hmac
import json
import re
import secrets
import threading
import time
from collections import deque
from flask import jsonify, request
from server.contracts import ApiError
from server.dynamic_contracts import ClaimProfile, ENVIRONMENT_ID
from server.dynamic_jwt import FixedJwksCache, verify_access_token
from .signer import private_file

COOKIE = 'cp28_identity_preparation'
PREFIX = '/api/cp28/identity'


def digest(value): return hashlib.sha256(value.encode()).hexdigest()


def load_profile(path, origin):
    if path is None: return None, None
    file = private_file(path)
    raw = file.read_bytes()
    if len(raw) > 16384: raise ValueError('Identity profile too large')
    data = json.loads(raw)
    if set(data) != {'sourceVersion', 'claimProfile'} or not isinstance(data['sourceVersion'], str) or not data['sourceVersion']:
        raise ValueError('Explicit reviewed profile source required')
    fields = dict(data['claimProfile']); fields['audiences'] = tuple(fields.get('audiences', ()))
    profile = ClaimProfile(**fields)
    if (profile.verified is not True or profile.environment_id != ENVIRONMENT_ID or
            profile.issuer != 'app.dynamicauth.com/'+ENVIRONMENT_ID or profile.audiences != (origin,) or
            any(v is not False for v in (profile.allow_absent_audience, profile.allow_absent_environment_id, profile.allow_absent_sid))):
        raise ValueError('Reviewed exact-origin Dynamic profile required; no inherited audience or absent claims')
    def unchanged():
        if private_file(path).read_bytes() != raw: raise ApiError(503, 'IDENTITY_CONFIG_CHANGED', '身份校验配置已变化，请由维护者核对并重启')
    return profile, unchanged


class IdentityPreparation:
    def __init__(self, origin, *, profile=None, jwks=None, clock=time.time, source_check=None, service_addresses=()):
        self.origin, self.profile, self.clock, self.source_check = origin, profile, clock, source_check
        self.jwks = jwks if jwks is not None else FixedJwksCache(clock=clock)
        self.service_addresses = {a.lower() for a in service_addresses}
        self.sessions = {}; self.attempts = deque(); self.lock = threading.RLock()

    def config(self):
        return {'environmentId': ENVIRONMENT_ID, 'serverVerificationConfigured': self.profile is not None,
                'authMode': 'dynamic-email', 'adminEqualsMerchant': True, 'businessAuthorized': False,
                'walletProof': False, 'addressPersistence': 'SESSION_ONLY',
                'originConfiguration': 'NOT_VERIFIED'}

    def row(self, *, csrf=False):
        token = request.cookies.get(COOKIE, '')
        row = self.sessions.get(digest(token)) if token and len(token) <= 256 else None
        if not row or row['until'] <= self.clock(): raise ApiError(401, 'IDENTITY_SESSION_REQUIRED', '请重新准备身份会话')
        if csrf and not hmac.compare_digest(request.headers.get('X-CSRF-Token', ''), row['csrf']):
            raise ApiError(403, 'CSRF_DENIED', '请求验证失败')
        return row

    def token_identity(self):
        if self.profile is None: raise ApiError(503, 'IDENTITY_PROFILE_UNCONFIGURED', 'SDK登录可单独进行；服务端身份校验尚未配置')
        if self.source_check: self.source_check()
        auth = request.headers.get('Authorization', '')
        if not auth.startswith('Bearer ') or len(auth) > 16400:
            raise ApiError(401, 'DYNAMIC_TOKEN_REJECTED', '需要当前Dynamic登录')
        identity = verify_access_token(auth[7:], profile=self.profile, clock=self.clock, jwks=self.jwks)
        if any(re.search(r'requires|pending|device|step.?up', s, re.I) for s in identity.scopes):
            raise ApiError(401, 'DYNAMIC_TOKEN_REJECTED', '登录尚需额外验证')
        return identity, digest(auth[7:])

    def authenticated(self, *, csrf=False):
        row = self.row(csrf=csrf)
        try:
            identity, token_hash = self.token_identity()
            if (not row.get('identity') or row['token_hash'] != token_hash or
                    row['identity'] != (identity.environment_id, identity.issuer, digest(identity.subject), identity.sid_hash) or
                    row['expires'] <= self.clock() or identity.expires_at != row['expires']):
                raise ApiError(401, 'IDENTITY_CHANGED', '登录已变化，请重新核验身份与候选地址')
        except Exception:
            row.pop('identity', None); row.pop('candidate', None)
            raise
        return row

    def response(self, row):
        return jsonify(serverIdentityVerified=True, workPermission='NOT_CONFIGURED', businessAuthorized=False,
                       csrfToken=row['csrf'], expiresAt=min(row['expires'], int(row['until'])), candidate=row.get('candidate'))

    def register(self, app):
        @app.before_request
        def origin():
            if request.path.startswith(PREFIX+'/') and request.headers.get('Origin') not in (None, self.origin):
                raise ApiError(403, 'ORIGIN_DENIED', '身份准备来源不符')

        @app.get(PREFIX+'/config', endpoint='identity_config')
        def config(): return jsonify(self.config())

        @app.get(PREFIX+'/bootstrap', endpoint='identity_bootstrap')
        def bootstrap():
            with self.lock:
                now = self.clock()
                self.sessions = {k: v for k, v in self.sessions.items() if v['until'] > now}
                old = request.cookies.get(COOKIE, '')
                if old: self.sessions.pop(digest(old), None)
                if len(self.sessions) >= 128: raise ApiError(429, 'RATE_LIMITED', '请稍后重试')
                token = secrets.token_urlsafe(32); csrf = secrets.token_urlsafe(32)
                self.sessions[digest(token)] = {'csrf': csrf, 'until': now+3600}
                response = jsonify(csrfToken=csrf, **self.config())
                response.set_cookie(COOKIE, token, httponly=True, samesite='Strict', path=PREFIX, max_age=3600)
                return response

        @app.post(PREFIX+'/exchange', endpoint='identity_exchange')
        def exchange():
            if request.get_json() != {}: raise ApiError(422, 'INVALID_INPUT', '需要空请求，不接受角色或subject')
            with self.lock:
                row = self.row(csrf=True); now = self.clock()
                while self.attempts and self.attempts[0] <= now-60: self.attempts.popleft()
                if len(self.attempts) >= 20: raise ApiError(429, 'RATE_LIMITED', '请稍后重试')
                self.attempts.append(now)
                # An attempted new identity can never retain the previous confirmation.
                row.pop('identity', None); row.pop('candidate', None)
                identity, token_hash = self.token_identity()
                row.update(identity=(identity.environment_id, identity.issuer, digest(identity.subject), identity.sid_hash),
                           token_hash=token_hash, expires=identity.expires_at)
                return self.response(row)

        @app.get(PREFIX+'/session', endpoint='identity_session')
        def session():
            with self.lock: return self.response(self.authenticated())

        @app.post(PREFIX+'/candidate', endpoint='identity_candidate')
        def candidate():
            with self.lock:
                row = self.authenticated(csrf=True); body = request.get_json()
                if (set(body) != {'address', 'chainId'} or type(body['chainId']) is not int or body['chainId'] != 10143 or
                        not isinstance(body['address'], str) or not re.fullmatch('0x[0-9a-fA-F]{40}', body['address']) or
                        int(body['address'][2:], 16) == 0):
                    raise ApiError(422, 'INVALID_CANDIDATE', '请核对本人连接的Monad10143候选地址')
                if body['address'].lower() in self.service_addresses:
                    raise ApiError(409, 'SERVICE_ADDRESS_CONFLICT', '后台服务与管理员/老板候选地址必须分离')
                row['candidate'] = {'adminAddress': body['address'], 'merchantAddress': body['address'],
                                    'chainId': 10143, 'confirmedAt': int(self.clock()), 'controlVerified': False,
                                    'chainPermissionsVerified': False, 'serviceIsolation': 'CHECKED_CONFIGURED_ADDRESSES' if self.service_addresses else 'NOT_CONFIGURED'}
                return self.response(row)

        @app.post(PREFIX+'/invalidate', endpoint='identity_invalidate')
        def invalidate():
            if request.get_json() != {}: raise ApiError(422, 'INVALID_INPUT', '需要空请求')
            with self.lock:
                row = self.row(csrf=True)
                row.pop('identity', None); row.pop('candidate', None)
                return jsonify(invalidated=True)

        @app.post(PREFIX+'/logout', endpoint='identity_logout')
        def logout():
            if request.get_json() != {}: raise ApiError(422, 'INVALID_INPUT', '需要空请求')
            with self.lock:
                self.row(csrf=True)
                self.sessions.pop(digest(request.cookies.get(COOKIE, '')), None)
                response = jsonify(loggedOut=True)
                response.delete_cookie(COOKIE, path=PREFIX, httponly=True, samesite='Strict')
                return response
