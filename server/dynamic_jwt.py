"""Fixed-environment identity verification; no local role or session authority.

An offline verifier cannot distinguish access and ID tokens with identical signed
claims, or observe remote revocation before token expiry / cached key expiry.
"""
import base64
import copy
import hashlib
import json
import math
import re
import threading
import urllib.request
from typing import Any

import jwt

from server.contracts import ApiError
from server.dynamic_contracts import (
    ENVIRONMENT_ID, JWKS_URL, ClaimProfile, Clock, JwksProvider,
    VerifiedIdentity, unavailable,
)

_MAX_TOKEN = 16384
_MAX_RESPONSE = 1048576
_MAX_KEYS = 32
_TTL = 300
_COOLDOWN = 30


def _rejected():
    return ApiError(401, 'DYNAMIC_TOKEN_REJECTED', 'Dynamic credential rejected')


def _keys_unavailable():
    return ApiError(503, 'DYNAMIC_JWKS_UNAVAILABLE', 'Dynamic verification keys unavailable')


def _identifier(value, limit=256):
    return (isinstance(value, str) and 0 < len(value) <= limit
            and value == value.strip() and all(ord(c) >= 32 and ord(c) != 127 for c in value))


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate JSON field')
        result[key] = value
    return result


def _json(raw):
    return json.loads(raw, object_pairs_hook=_unique_object,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Invalid JSON number')))


def _public_key(key):
    if (not isinstance(key, dict) or key.get('kty') != 'RSA'
            or key.get('alg', 'RS256') != 'RS256' or key.get('use', 'sig') != 'sig'
            or ('key_ops' in key and key['key_ops'] != ['verify'])
            or any(field in key for field in ('d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'))
            or not _identifier(key.get('kid'))):
        raise ValueError('Invalid signing key')
    public = jwt.algorithms.RSAAlgorithm.from_jwk(key)
    if public.key_size < 2048:
        raise ValueError('Weak signing key')
    return public


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('JWKS redirects forbidden')


def _fetch():
    # No caller URL and no redirect traversal, including same-origin redirects.
    opener = urllib.request.build_opener(_NoRedirect())
    request = urllib.request.Request(JWKS_URL, headers={'Accept': 'application/json'})
    with opener.open(request, timeout=3) as response:
        if response.status != 200 or response.geturl() != JWKS_URL:
            raise ValueError('Unexpected JWKS response')
        return response.read(_MAX_RESPONSE + 1)


class FixedJwksCache:
    """Thread-safe 5-minute cache. transport is a no-argument test seam only."""

    def __init__(self, *, clock: Clock, transport=None):
        self._clock = clock
        self._transport = _fetch if transport is None else transport
        self._keys = []
        self._fetched_at = None
        self._attempted_at = None
        self._lock = threading.Lock()

    def get_keys(self, kid: str) -> list[dict[str, Any]]:
        if not _identifier(kid):
            raise _rejected()
        with self._lock:
            now = self._clock()
            if not math.isfinite(now):
                raise _keys_unavailable()
            fresh = self._fetched_at is not None and 0 <= now - self._fetched_at < _TTL
            matching = [key for key in self._keys if key['kid'] == kid]
            if fresh and matching:
                return [copy.deepcopy(key) for key in matching]
            if self._attempted_at is not None and now - self._attempted_at < _COOLDOWN:
                if fresh:
                    return []
                raise _keys_unavailable()
            self._attempted_at = now
            try:
                raw = self._transport()
                if not isinstance(raw, bytes) or len(raw) > _MAX_RESPONSE:
                    raise ValueError('Invalid JWKS body')
                document = _json(raw)
                keys = document.get('keys') if isinstance(document, dict) else None
                if not isinstance(keys, list) or not 0 < len(keys) <= _MAX_KEYS:
                    raise ValueError('Invalid JWKS key count')
                kids = set()
                for key in keys:
                    _public_key(key)
                    if key['kid'] in kids:
                        raise ValueError('Duplicate key identifier')
                    kids.add(key['kid'])
                self._keys = keys
                self._fetched_at = now
            except Exception:
                raise _keys_unavailable() from None
            return [copy.deepcopy(key) for key in self._keys if key['kid'] == kid]


def _profile_ready(profile):
    return (profile.verified is True and profile.environment_id == ENVIRONMENT_ID
            and _identifier(profile.issuer, 1024)
            and isinstance(profile.audiences, tuple)
            and all(_identifier(aud, 1024) for aud in profile.audiences)
            and all(type(flag) is bool for flag in (
                profile.allow_absent_audience, profile.allow_absent_environment_id, profile.allow_absent_sid))
            and (bool(profile.audiences) or profile.allow_absent_audience))


def verify_access_token(raw: str, *, profile: ClaimProfile, clock: Clock,
                        jwks: JwksProvider) -> VerifiedIdentity:
    if not _profile_ready(profile):
        raise unavailable()
    try:
        if not isinstance(raw, str) or len(raw) > _MAX_TOKEN:
            raise ValueError('Invalid token size')
        parts = raw.split('.')
        if len(parts) != 3 or any(not re.fullmatch(r'[A-Za-z0-9_-]+', part) for part in parts):
            raise ValueError('Invalid compact token')
        header = _json(base64.urlsafe_b64decode(parts[0] + '=' * (-len(parts[0]) % 4)))
        if (not isinstance(header, dict) or header.get('alg') != 'RS256'
                or not _identifier(header.get('kid'))
                or any(field in header for field in ('jku', 'x5u', 'crit', 'b64'))):
            raise ValueError('Invalid protected header')
    except (ValueError, TypeError, UnicodeError, RecursionError):
        raise _rejected() from None
    # Provider errors are availability failures, not credential diagnostics.
    try:
        keys = jwks.get_keys(header['kid'])
    except Exception:
        raise _keys_unavailable() from None
    try:
        if not isinstance(keys, list) or not 0 < len(keys) <= _MAX_KEYS:
            raise ValueError('No signing key')
        matching = [key for key in keys if isinstance(key, dict) and key.get('kid') == header['kid']]
        if len(matching) != 1:
            raise ValueError('Ambiguous signing key')
        # JWT library verifies the signature. Claim checks below use injected time
        # and strict types, with no expiry grace or implicit audience policy.
        jwt.decode(raw, _public_key(matching[0]), algorithms=['RS256'], options={
            'verify_exp': False, 'verify_iat': False, 'verify_nbf': False,
            'verify_aud': False, 'verify_iss': False, 'verify_sub': False, 'verify_jti': False,
        })
        claims = _json(base64.urlsafe_b64decode(parts[1] + '=' * (-len(parts[1]) % 4)))
        if not isinstance(claims, dict) or claims.get('iss') != profile.issuer:
            raise ValueError('Invalid issuer')
        if 'environment_id' in claims:
            if claims['environment_id'] != profile.environment_id:
                raise ValueError('Invalid environment')
        elif not profile.allow_absent_environment_id:
            raise ValueError('Missing environment')
        if 'aud' in claims:
            audiences = claims['aud']
            if isinstance(audiences, str):
                audiences = [audiences]
            if (not isinstance(audiences, list) or not audiences
                    or not all(_identifier(aud, 1024) for aud in audiences)
                    or not set(audiences).intersection(profile.audiences)):
                raise ValueError('Invalid audience')
        elif not profile.allow_absent_audience:
            raise ValueError('Missing audience')
        now = clock()
        exp, iat = claims.get('exp'), claims.get('iat')
        if (not math.isfinite(now) or type(exp) is not int or type(iat) is not int
                or exp <= iat or now >= exp or iat > now + 30):
            raise ValueError('Invalid token time')
        if 'nbf' in claims and (type(claims['nbf']) is not int or claims['nbf'] > now + 30
                                or claims['nbf'] >= exp):
            raise ValueError('Invalid not-before')
        if not _identifier(claims.get('sub'), 1024):
            raise ValueError('Invalid subject')
        if not isinstance(claims.get('scope'), str):
            raise ValueError('Invalid scope')
        scopes = frozenset(claims['scope'].split())
        if 'user:basic' not in scopes:
            raise ValueError('Incomplete authentication')
        sid_hash = None
        if 'sid' in claims:
            if not _identifier(claims['sid']):
                raise ValueError('Invalid session identifier')
            sid_hash = hashlib.sha256(claims['sid'].encode()).hexdigest()
        elif not profile.allow_absent_sid:
            raise ValueError('Missing session identifier')
        return VerifiedIdentity(profile.environment_id, profile.issuer, claims['sub'], exp, scopes, sid_hash)
    except (ValueError, TypeError, KeyError, jwt.PyJWTError, UnicodeError, RecursionError, OverflowError):
        raise _rejected() from None
