"""CP17 shared boundary. Claims verify identity; only server mapping grants a role."""
from dataclasses import dataclass
from typing import Any, Callable, Protocol

from server.contracts import ApiError

ENVIRONMENT_ID = '7fe95f70-e5cc-4c3c-beed-a133e81268dc'
JWKS_URL = f'https://app.dynamicauth.com/api/v0/sdk/{ENVIRONMENT_ID}/.well-known/jwks'
ALLOWED_ORIGINS = ('http://127.0.0.1:15207', 'http://localhost:15207')
SCHEMA_VERSION = 4
BACKUP_FORMAT = 'mealforward-cp17-quarantined-backup-v4'


@dataclass(frozen=True)
class CookieNames:
    work: str = 'work_session'
    support: str = 'support_cap'
    recipient: str = 'recipient_session'


CP17_COOKIES = CookieNames('cp17_work_session', 'cp17_support_cap', 'cp17_recipient_session')


@dataclass(frozen=True)
class ClaimProfile:
    environment_id: str
    issuer: str
    audiences: tuple[str, ...] = ()
    # Neither unknown audience nor unknown environment binding is permissive.
    verified: bool = False
    allow_absent_audience: bool = False
    allow_absent_environment_id: bool = False
    allow_absent_sid: bool = False


@dataclass(frozen=True)
class VerifiedIdentity:
    environment_id: str
    issuer: str
    subject: str
    expires_at: int
    scopes: frozenset[str]
    sid_hash: str | None


class JwksProvider(Protocol):
    def get_keys(self, kid: str) -> list[dict[str, Any]]:
        """Fresh fixed-endpoint keys; refresh at most once on a missing kid."""
        ...


Clock = Callable[[], float]


def unavailable() -> ApiError:
    return ApiError(503, 'DYNAMIC_PROFILE_UNVERIFIED', 'Dynamic identity verification is not configured')
