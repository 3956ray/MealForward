"""Approved Dynamic access-token verification plus explicit signed-email mapping.

No roles, sessions, persistence, token logging, claim-profile discovery or email defaults.
"""
import base64
from dataclasses import dataclass, field
import json
import re
from typing import Callable
from urllib.parse import urlsplit

from server.dynamic_contracts import ClaimProfile, Clock, JwksProvider, ENVIRONMENT_ID


class IdentityAdapterError(Exception):
    def __init__(self, code: str, *, status: int = 401):
        super().__init__(code)
        self.code = code
        self.status = status


@dataclass(frozen=True)
class SignedEmailClaimProfile:
    """Trusted server configuration, set only after review of the actual signed claim schema."""
    email_path: tuple[str, ...] | None = None
    verified_path: tuple[str, ...] | None = None
    email_type: str | None = None
    verified_type: str | None = None
    approved: bool = False
    mode: str | None = None
    credentials_path: tuple[str, ...] | None = None
    format_key: str | None = None
    credential_email_key: str | None = None

    def ready(self) -> bool:
        def path_ok(path):
            return (type(path) is tuple and 0 < len(path) <= 16
                    and all(type(p) is str and 0 < len(p) <= 256 for p in path))
        if self.approved is not True or self.email_type != "string":
            return False
        if self.mode == "signed_boolean":
            return (self.verified_type == "boolean" and path_ok(self.email_path) and path_ok(self.verified_path)
                    and self.credentials_path is None and self.format_key is None and self.credential_email_key is None)
        if self.mode == "signed_verified_credentials":
            key_ok = lambda key: type(key) is str and 0 < len(key) <= 256
            return (path_ok(self.credentials_path) and key_ok(self.format_key) and key_ok(self.credential_email_key)
                    and (self.email_path is None or path_ok(self.email_path))
                    and self.verified_path is None and self.verified_type is None)
        if self.mode == "dynamic_verified_profile":
            return (self.email_path == ("email",) and self.verified_path is None
                    and self.verified_type is None and self.credentials_path is None
                    and self.format_key is None and self.credential_email_key is None)
        return False


@dataclass(frozen=True, repr=False)
class VerifiedEmailIdentity:
    """Private transient result. Never serialize this object for logs, browser or storage."""
    environment_id: str
    issuer: str
    subject: str
    email: str
    expires_at: int
    scopes: frozenset[str]
    sid_hash: str | None
    _verified_by: object = field(repr=False, compare=False)

    def private_projection(self) -> dict:
        """Explicit transient server-only view; not a persistence or public DTO."""
        return {"environment_id": self.environment_id, "issuer": self.issuer,
                "subject": self.subject, "email": self.email, "expires_at": self.expires_at}

    def public_projection(self) -> dict:
        return {"status": "IDENTITY_VERIFIED", "expires_at": self.expires_at}


@dataclass(frozen=True)
class IdentityBinding:
    environment_id: str
    issuer: str
    subject_hash: str
    email_key: str
    expires_at: int

    def to_json(self) -> dict:
        return {"environment_id": self.environment_id, "issuer": self.issuer,
                "subject_hash": self.subject_hash, "email_key": self.email_key, "expires_at": self.expires_at}

    def public_projection(self) -> dict:
        return {"status": "IDENTITY_VERIFIED", "expires_at": self.expires_at}


def _load_verifier():
    try:
        from server.dynamic_jwt import verify_access_token
    except ImportError:
        raise IdentityAdapterError("DEPENDENCY_NOT_CONFIGURED", status=503) from None
    return verify_access_token


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON field")
        result[key] = value
    return result


def _reject_constant(_):
    raise ValueError("Invalid JSON number")


def _verified_payload(raw: str) -> dict:
    """Call only after the existing verifier accepted this exact immutable compact-token string."""
    try:
        part = raw.split(".")[1]
        payload = json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)),
                             object_pairs_hook=_unique_object, parse_constant=_reject_constant)
        if type(payload) is not dict:
            raise ValueError("Invalid payload")
        return payload
    except (ValueError, TypeError, UnicodeError, RecursionError, IndexError):
        raise IdentityAdapterError("EMAIL_CLAIM_REJECTED") from None


def _claim(payload: dict, path: tuple[str, ...]):
    value = payload
    for part in path:
        if type(value) is not dict or part not in value:
            raise IdentityAdapterError("EMAIL_CLAIM_REJECTED")
        value = value[part]
    return value


def _dynamic_profile_origin(profile: ClaimProfile) -> str:
    if (not isinstance(profile, ClaimProfile) or profile.verified is not True
            or profile.environment_id != ENVIRONMENT_ID
            or profile.issuer != 'app.dynamicauth.com/' + ENVIRONMENT_ID
            or type(profile.audiences) is not tuple or len(profile.audiences) != 1
            or any(flag is not False for flag in (profile.allow_absent_audience,
                profile.allow_absent_environment_id, profile.allow_absent_sid))):
        raise IdentityAdapterError('VERIFIED_EMAIL_ORIGIN_NOT_CONFIGURED', status=503)
    origin = profile.audiences[0]
    if type(origin) is not str:
        raise IdentityAdapterError('VERIFIED_EMAIL_ORIGIN_NOT_CONFIGURED', status=503)
    try:
        parsed = urlsplit(origin)
        if (parsed.scheme != 'https'
                or parsed.hostname not in {'localhost', '127.0.0.1'}
                or parsed.port is None or not 1024 <= parsed.port <= 65535
                or origin != f'https://{parsed.hostname}:{parsed.port}'):
            raise ValueError()
    except (ValueError, TypeError):
        raise IdentityAdapterError('VERIFIED_EMAIL_ORIGIN_NOT_CONFIGURED', status=503) from None
    return origin


class DynamicIdentityAdapter:
    def __init__(self, *, profile: ClaimProfile, jwks: JwksProvider, clock: Clock,
                 email_profile: SignedEmailClaimProfile | None,
                 canonical_email: Callable[[str], str], email_key: Callable[[str], str],
                 subject_key: Callable[[str, str, str], str], verified_email_provider=None):
        self._profile, self._jwks, self._clock = profile, jwks, clock
        self._email_profile = email_profile
        self._canonical_email, self._email_key, self._subject_key = canonical_email, email_key, subject_key
        self._verified_email_provider = verified_email_provider
        self._verified_marker = object()

    def verify_bearer(self, authorization: str) -> VerifiedEmailIdentity:
        if not isinstance(self._email_profile, SignedEmailClaimProfile) or not self._email_profile.ready():
            raise IdentityAdapterError("EMAIL_PROFILE_NOT_CONFIGURED", status=503)
        if not isinstance(self._profile, ClaimProfile):
            raise IdentityAdapterError("DYNAMIC_PROFILE_UNVERIFIED", status=503)
        if self._email_profile.mode == "dynamic_verified_profile":
            _dynamic_profile_origin(self._profile)
        if (type(authorization) is not str or len(authorization) > 16391
                or not re.fullmatch(r"(?i:Bearer) [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", authorization)):
            raise IdentityAdapterError("DYNAMIC_TOKEN_REJECTED")
        raw = authorization[7:]
        # This is the production verifier; no SDK/browser email, caller role or replacement verifier input.
        identity = _load_verifier()(raw, profile=self._profile, clock=self._clock, jwks=self._jwks)
        payload = _verified_payload(raw)
        if (payload.get("sub") != identity.subject or payload.get("iss") != identity.issuer
                or type(payload.get("exp")) is not int or payload["exp"] != identity.expires_at):
            raise IdentityAdapterError("IDENTITY_BINDING_REJECTED")
        if self._email_profile.mode == "signed_boolean":
            email = _claim(payload, self._email_profile.email_path)
            verified = _claim(payload, self._email_profile.verified_path)
            if type(verified) is not bool or verified is not True:
                raise IdentityAdapterError("EMAIL_CLAIM_REJECTED")
            canonical = self._canonical(email)
        elif self._email_profile.mode == "signed_verified_credentials":
            canonical = self._credential_email(payload)
        else:
            signed_email = self._canonical(_claim(payload, self._email_profile.email_path))
            session_public_key = None
            for field in ("sessionPublicKey", "session_public_key"):
                if field not in payload:
                    continue
                value = payload[field]
                if (type(value) is not str or not re.fullmatch(r"(?:0[23][0-9a-f]{64}|04[0-9a-f]{128})", value)
                        or (session_public_key is not None and value != session_public_key)):
                    raise IdentityAdapterError("DYNAMIC_PROFILE_SESSION_PUBLIC_KEY_INVALID")
                session_public_key = value
            provider = self._verified_email_provider
            if not callable(provider):
                raise IdentityAdapterError("VERIFIED_EMAIL_PROVIDER_NOT_CONFIGURED", status=503)
            try:
                checked = provider(raw, identity.subject, identity.environment_id,
                    signed_email, expected_origin=self._profile.audiences[0], canonical_email=self._canonical,
                    verified_session_public_key=session_public_key)
                if checked is not True:
                    raise ValueError()
                canonical = signed_email
            except Exception as exc:
                from .dynamic_verified_email import PROFILE_ERROR_CODES, PROFILE_TRANSPORT_ERROR_CODES
                code = getattr(exc, 'code', None)
                if type(code) is str and code in PROFILE_ERROR_CODES:
                    raise IdentityAdapterError(code, status=503 if code in PROFILE_TRANSPORT_ERROR_CODES else 401) from None
                raise IdentityAdapterError("EMAIL_CLAIM_REJECTED") from None
        return VerifiedEmailIdentity(identity.environment_id, identity.issuer, identity.subject, canonical,
                                     identity.expires_at, identity.scopes, identity.sid_hash, self._verified_marker)

    def _canonical(self, email: str) -> str:
        if type(email) is not str or not email:
            raise IdentityAdapterError("EMAIL_CLAIM_REJECTED")
        try:
            canonical = self._canonical_email(email)
            if type(canonical) is not str or not canonical:
                raise ValueError("Invalid canonical email")
        except Exception:
            raise IdentityAdapterError("EMAIL_CLAIM_REJECTED") from None
        return canonical

    def _credential_email(self, payload: dict) -> str:
        profile = self._email_profile
        target = self._canonical(_claim(payload, profile.email_path)) if profile.email_path is not None else None
        credentials = _claim(payload, profile.credentials_path)
        if type(credentials) is not list:
            raise IdentityAdapterError("EMAIL_CLAIM_REJECTED")
        matches = []
        for credential in credentials:
            if (type(credential) is not dict or type(credential.get(profile.format_key)) is not str
                    or not credential[profile.format_key]):
                raise IdentityAdapterError("EMAIL_CLAIM_REJECTED")
            if credential[profile.format_key] != "email":
                continue
            email = self._canonical(credential.get(profile.credential_email_key))
            if target is None or email == target:
                matches.append(email)
        if len(matches) != 1:
            raise IdentityAdapterError("EMAIL_CLAIM_REJECTED")
        return matches[0]

    def normalize_binding(self, identity: VerifiedEmailIdentity) -> IdentityBinding:
        if not isinstance(identity, VerifiedEmailIdentity) or identity._verified_by is not self._verified_marker:
            raise IdentityAdapterError("IDENTITY_BINDING_REJECTED")
        if not callable(self._email_key) or not callable(self._subject_key):
            raise IdentityAdapterError("IDENTITY_BINDING_NOT_CONFIGURED", status=503)
        try:
            # Main supplies existing canonical-email semantics and namespaced server-HMAC closures.
            email_key = self._email_key(identity.email)
            subject_hash = self._subject_key(identity.environment_id, identity.issuer, identity.subject)
            if any(type(v) is not str or not re.fullmatch(r"[0-9a-f]{64}", v) for v in (email_key, subject_hash)):
                raise ValueError("Invalid HMAC binding")
        except Exception:
            raise IdentityAdapterError("IDENTITY_BINDING_REJECTED") from None
        return IdentityBinding(identity.environment_id, identity.issuer, subject_hash, email_key, identity.expires_at)


def compose_dynamic_identity(*, profile: ClaimProfile, clock: Clock,
                             email_profile: SignedEmailClaimProfile | None,
                             canonical_email: Callable[[str], str], email_key: Callable[[str], str],
                             subject_key: Callable[[str, str, str], str],
                             jwks: JwksProvider | None = None) -> DynamicIdentityAdapter:
    """Real fixed-endpoint JWKS composition. Construction never fetches keys or discovers profile/claims."""
    if not isinstance(email_profile, SignedEmailClaimProfile) or not email_profile.ready():
        raise IdentityAdapterError("EMAIL_PROFILE_NOT_CONFIGURED", status=503)
    if email_profile.mode == "dynamic_verified_profile":
        _dynamic_profile_origin(profile)
    if jwks is None:
        try:
            from server.dynamic_jwt import FixedJwksCache
        except ImportError:
            raise IdentityAdapterError("DEPENDENCY_NOT_CONFIGURED", status=503) from None
        jwks = FixedJwksCache(clock=clock)
    verified_email_provider = None
    if email_profile.mode == "dynamic_verified_profile":
        try:
            from .dynamic_verified_email import verify_dynamic_verified_email
        except ImportError:
            raise IdentityAdapterError("DEPENDENCY_NOT_CONFIGURED", status=503) from None
        verified_email_provider = verify_dynamic_verified_email
    return DynamicIdentityAdapter(profile=profile, jwks=jwks, clock=clock, email_profile=email_profile,
                                  canonical_email=canonical_email, email_key=email_key, subject_key=subject_key,
                                  verified_email_provider=verified_email_provider)
