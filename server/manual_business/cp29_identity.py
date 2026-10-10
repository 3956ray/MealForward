"""CP29 two-persona Dynamic identity adapter.

No user-submitted actor, email, wallet or role is trusted. The only stable
mapping key is a keyed fingerprint of a *signed and validated* Dynamic JWT
subject, subsequently approved by the operator in trustedSubjects.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import re
import stat
import time
from dataclasses import dataclass
from pathlib import Path

from server.contracts import ApiError

FP_RE = re.compile(r'^cp29:[0-9a-f]{64}$')
_ENV_RE = re.compile(r'^[a-zA-Z0-9-]{8,96}$')


@dataclass(frozen=True)
class VerifiedWorkIdentity:
    subject_fingerprint: str
    expires_at: int


def read_private_bytes(path: str | Path, *, min_length: int = 1, max_length: int = 16384) -> bytes:
    """Follow neither symlinks nor other users' readable operator files."""
    # Check the opened descriptor, not an lstat followed by a raceable second open.
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError as error:
        raise PermissionError('Operator-owned non-symlink mode-0600 file required') from error
    with os.fdopen(fd, 'rb') as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o600:
            raise PermissionError('Operator-owned non-symlink mode-0600 file required')
        data = source.read(max_length + 1)
    if not min_length <= len(data) <= max_length:
        raise ValueError('Invalid private file size')
    return data


def fingerprint(key: bytes, environment: str, subject: str) -> str:
    """A role-neutral pseudonym, not proof of an actor's work authorization."""
    if not isinstance(key, bytes) or len(key) != 32:
        raise ValueError('Exactly 256-bit identity binding key required')
    if not isinstance(environment, str) or not _ENV_RE.fullmatch(environment):
        raise ValueError('Fixed Dynamic environment required')
    if not isinstance(subject, str) or not 1 <= len(subject) <= 1024:
        raise ValueError('Verified Dynamic subject required')
    payload = b'mealforward-cp29-identity\x00' + environment.encode() + b'\x00' + subject.encode()
    return 'cp29:' + hmac.new(key, payload, hashlib.sha256).hexdigest()


def validate_mappings(trusted_subjects: dict, *, partner_actor: str, owner_actor: str):
    """Validate a manually reviewed config, never synthesize a role from an email."""
    if (not isinstance(trusted_subjects, dict) or len(trusted_subjects) != 2 or
            not isinstance(partner_actor, str) or not partner_actor or
            not isinstance(owner_actor, str) or not owner_actor or partner_actor == owner_actor):
        raise ValueError('Exactly two distinct, operator-assigned work actors required')
    if any(not isinstance(k, str) or not FP_RE.fullmatch(k) for k in trusted_subjects):
        raise ValueError('Only verified keyed subject fingerprints may be mapped')
    entries = list(trusted_subjects.values())
    if any(not isinstance(v, dict) or set(v) != {'actorId', 'revision'} or
           not isinstance(v['actorId'], str) or not v['actorId'] or
           type(v['revision']) is not int or v['revision'] < 1 for v in entries):
        raise ValueError('Explicit current actor and revision required')
    if {v['actorId'] for v in entries} != {partner_actor, owner_actor}:
        raise ValueError('Exactly one issuer partner and one restaurant owner required')
    return True


class DynamicWorkVerifier:
    """Callable verified_subject argument for composition.web_application().

    Constructor requires an already reviewed, exact-origin profile and a
    separate operator-owned fingerprint key. Only HTTPS JWKS verifies tokens;
    the work user mapping is independently checked by TrustedAuthentication.
    """
    def __init__(self, *, profile_path, fingerprint_key_path, origin, clock=time.time,
                 jwks=None, verifier=None):
        from .identity_preparation import load_profile
        from server.dynamic_jwt import FixedJwksCache, verify_access_token
        self.profile, self.source_check = load_profile(profile_path, origin)
        self._key_path = Path(fingerprint_key_path)
        self._key = read_private_bytes(self._key_path, min_length=32, max_length=32)
        self.origin = origin
        self.clock = clock
        self.jwks = jwks if jwks is not None else FixedJwksCache(clock=clock)
        self.verifier = verifier if verifier is not None else verify_access_token

    def __call__(self, request):
        return self.verify_identity(request).subject_fingerprint

    def check_source(self):
        self.source_check()
        if read_private_bytes(self._key_path, min_length=32, max_length=32) != self._key:
            raise ApiError(503, 'IDENTITY_KEY_CHANGED', 'Work identity authority changed')

    def verify_identity(self, request):
        # The existing web_app guard also validates Origin/Host/JSON. Retain
        # these checks here because this adapter is a separate authority.
        if request.method != 'POST' or request.headers.get('Origin') != self.origin or \
                request.host_url.rstrip('/') != self.origin:
            raise ApiError(403, 'ORIGIN_DENIED', 'Work login requires approved local origin')
        if request.get_json(silent=True) != {}:
            raise ApiError(422, 'INVALID_INPUT', 'Work login accepts no role, wallet or subject input')
        value = request.headers.get('Authorization', '')
        if not value.startswith('Bearer ') or len(value) > 16400:
            raise ApiError(401, 'AUTH_REQUIRED', 'Current Dynamic access token required')
        self.check_source()
        identity = self.verifier(value[7:], profile=self.profile, clock=self.clock, jwks=self.jwks,
                                 calibration_origin=self.origin)
        if (identity.sid_hash is None or identity.expires_at <= self.clock() or
                identity.scopes != frozenset({'user:basic'})):
            raise ApiError(401, 'AUTH_REQUIRED', 'Completed current Dynamic login required')
        return VerifiedWorkIdentity(fingerprint(self._key, identity.environment_id, identity.subject), identity.expires_at)
