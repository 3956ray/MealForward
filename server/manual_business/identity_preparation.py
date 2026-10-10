"""Non-authorizing Dynamic identity preparation. No business DB, wallet key or RPC.

Sessions and candidate declarations live only in bounded process memory. Restart
revokes them; the existing preparation identity and anchor are never rewritten.
"""
import hashlib
import ipaddress
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
    def __init__(self, origin, *, profile=None, jwks=None, clock=time.time, source_check=None, service_addresses=(), development_calibration=False, cp29_fingerprint_key=None, cp29_key_check=None):
        if type(development_calibration) is not bool: raise ValueError('Explicit development calibration flag required')
        if development_calibration and (profile is not None or not re.fullmatch(r'http://127\.0\.0\.1:[0-9]{4,5}', origin)):
            raise ValueError('Calibration requires isolated loopback preparation without an approved profile')
        self.development_calibration = development_calibration
        self.calibration_attempts = deque()
        if cp29_fingerprint_key is not None and (profile is None or development_calibration or
                type(cp29_fingerprint_key) is not bytes or len(cp29_fingerprint_key) != 32):
            raise ValueError('CP29 identity fingerprint requires exact reviewed profile and separate 256-bit key')
        self.cp29_fingerprint_key = cp29_fingerprint_key
        self.cp29_key_check = cp29_key_check
        self.cp29_attempts = deque()
        self.origin, self.profile, self.clock, self.source_check = origin, profile, clock, source_check
        self.jwks = jwks if jwks is not None else FixedJwksCache(clock=clock)
        self.service_addresses = {a.lower() for a in service_addresses}
        self.sessions = {}; self.attempts = deque(); self.lock = threading.RLock()

    def config(self):
        return {'environmentId': ENVIRONMENT_ID, 'serverVerificationConfigured': self.profile is not None,
                'authMode': 'dynamic-email', 'adminEqualsMerchant': True, 'businessAuthorized': False,
                'walletProof': False, 'addressPersistence': 'SESSION_ONLY',
                'developmentCalibrationEnabled': self.development_calibration,
                'cp29EnrollmentAvailable': self.cp29_fingerprint_key is not None,
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
            if request.path == PREFIX+'/calibrate':
                if not self.development_calibration:
                    raise ApiError(404, 'CALIBRATION_DISABLED', '开发校准未启用')
                try: local = ipaddress.ip_address(request.remote_addr or '').is_loopback
                except ValueError: local = False
                if (not local or request.host_url.rstrip('/') != self.origin or request.headers.get('Origin') != self.origin
                        or any(k.lower() == 'forwarded' or k.lower().startswith('x-forwarded-') or k.lower() == 'x-real-ip' for k in request.headers.keys())):
                    raise ApiError(403, 'CALIBRATION_ORIGIN_DENIED', '仅允许当前本机入口直接校准')
                if (request.method != 'POST' or request.content_length is None or request.content_length > 256
                        or len(request.headers.get('Authorization', '')) > 16400
                        or len(request.headers.get('X-CSRF-Token', '')) > 256):
                    raise ApiError(422, 'CALIBRATION_INPUT_REJECTED', '校准请求不符合限制')
            if request.path.startswith(PREFIX+'/') and request.headers.get('Origin') not in (None, self.origin):
                raise ApiError(403, 'ORIGIN_DENIED', '身份准备来源不符')

        @app.post(PREFIX+'/calibrate', endpoint='identity_calibrate')
        def calibrate():
            if request.get_json(silent=True) != {}:
                raise ApiError(422, 'CALIBRATION_INPUT_REJECTED', '校准仅接受空请求')
            with self.lock:
                row = self.row(csrf=True); now = self.clock()
                while self.calibration_attempts and self.calibration_attempts[0] <= now-60: self.calibration_attempts.popleft()
                if len(self.calibration_attempts) >= 5: raise ApiError(429, 'RATE_LIMITED', '校准次数已达限制，请稍后主动重试')
                self.calibration_attempts.append(now)
                auth = request.headers.get('Authorization', '')
                if not auth.startswith('Bearer '): raise ApiError(401, 'CALIBRATION_PENDING', '未通过固定预期验证；声明及配置仍待确认')
                # This object enables the pure verifier only; never assign it to self.profile,
                # persist it, or derive expectations from unverified JWT payloads.
                expected = ClaimProfile(ENVIRONMENT_ID, 'app.dynamicauth.com/'+ENVIRONMENT_ID, (self.origin,), verified=True)
                try:
                    identity = verify_access_token(auth[7:], profile=expected, clock=self.clock, jwks=self.jwks,
                                                   calibration_origin=self.origin)
                except ApiError as error:
                    if error.code == 'DYNAMIC_JWKS_UNAVAILABLE':
                        raise ApiError(503, 'CALIBRATION_KEYS_UNAVAILABLE', '验证公钥暂不可用；校准仍待确认') from None
                    raise ApiError(401, 'CALIBRATION_PENDING', '未通过固定预期验证；声明及配置仍待确认') from None
                expires = min(identity.expires_at, int(row['until']))
                if expires <= self.clock():
                    raise ApiError(401, 'CALIBRATION_PENDING', '会话或凭据已过期；校准仍待确认')
                return jsonify(status='VERIFIED_EXPECTATIONS_ONLY', audience=self.origin, issuer=expected.issuer,
                    environmentId=ENVIRONMENT_ID, sid={'present': True, 'type': 'string'}, scopes=['user:basic'],
                    tokenExpiresAt=identity.expires_at, remainingTokenSeconds=max(0, int(identity.expires_at-self.clock())), validUntil=expires,
                    serverIdentityVerified=False, businessAuthorized=False, profileCreated=False)

        @app.post(PREFIX+'/fingerprint', endpoint='cp29_identity_fingerprint')
        def cp29_identity_fingerprint():
            # Optional operator-authorized pairing aid. Never accepts a role,
            # stores a mapping, creates a business session, or enables Runtime.
            if self.cp29_fingerprint_key is None:
                raise ApiError(404, 'CP29_ENROLLMENT_DISABLED', 'CP29 identity pairing not enabled')
            try:
                local_peer = ipaddress.ip_address(request.remote_addr or '').is_loopback
            except ValueError:
                local_peer = False
            forwarded = any(k.lower() == 'forwarded' or k.lower().startswith('x-forwarded-') or
                            k.lower() == 'x-real-ip' for k in request.headers.keys())
            if (not local_peer or forwarded or request.host_url.rstrip('/') != self.origin or
                    request.headers.get('Origin') != self.origin or request.method != 'POST' or
                    request.get_json(silent=True) != {} or request.content_length is None or
                    request.content_length > 256 or len(request.headers.get('Authorization', '')) > 16400 or
                    len(request.headers.get('X-CSRF-Token', '')) > 256):
                raise ApiError(403, 'ORIGIN_DENIED', 'Local reviewed identity pairing only')
            with self.lock:
                row = self.authenticated(csrf=True)
                now = self.clock()
                while self.cp29_attempts and self.cp29_attempts[0] <= now - 60:
                    self.cp29_attempts.popleft()
                if len(self.cp29_attempts) >= 5:
                    raise ApiError(429, 'RATE_LIMITED', 'Too many identity pairing requests')
                self.cp29_attempts.append(now)
                if self.cp29_key_check: self.cp29_key_check()
                identity, token_hash = self.token_identity()
                if (token_hash != row['token_hash'] or
                        row['identity'] != (identity.environment_id, identity.issuer, digest(identity.subject), identity.sid_hash)):
                    raise ApiError(401, 'IDENTITY_CHANGED', 'Current Dynamic identity changed')
                from .cp29_identity import fingerprint
                return jsonify(subjectFingerprint=fingerprint(self.cp29_fingerprint_key,
                              identity.environment_id, identity.subject),
                              expiresAt=min(identity.expires_at, int(row['until'])),
                              actorMapped=False, businessAuthorized=False, profileCreated=False)

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
