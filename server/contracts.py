"""CP15 C0. Shared contracts; authentication implementation has a separate owner."""
from dataclasses import dataclass
from typing import Any, Protocol

WORK_COOKIE = "work_session"
SUPPORT_COOKIE = "support_cap"
AUTH_ABSOLUTE_TTL = 8 * 60 * 60
AUTH_IDLE_TTL = 30 * 60
SUPPORT_TTL = 24 * 60 * 60
AUTH_FAILURE_LIMIT = 5
AUTH_FAILURE_WINDOW = 15 * 60

class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message

@dataclass(frozen=True)
class AuthContext:
    actor_id: str
    role: str
    partner_id: str | None
    shop_id: str | None
    session_id: str  # hash identifier, never the browser cookie value

class AuthStore(Protocol):
    def create_user(self, user_id: str, username: str, password_hash: str, role: str,
                    partner_id: str | None = None, shop_id: str | None = None,
                    enabled: bool = True) -> None: ...
    def get_user_by_username(self, username: str) -> dict[str, Any] | None: ...
    def get_user(self, user_id: str) -> dict[str, Any] | None: ...
    def set_user_enabled(self, user_id: str, enabled: bool) -> None: ...
    def create_session(self, token_hash: str, user_id: str, csrf_hash: str,
                       created_at: int, expires_at: int) -> None: ...
    def get_session(self, token_hash: str) -> dict[str, Any] | None: ...
    def touch_session(self, token_hash: str, now: int) -> None: ...
    def revoke_session(self, token_hash: str) -> None: ...
    def auth_failure_count(self, key: str, now: int, window: int) -> int: ...
    def record_auth_failure(self, key: str, now: int) -> None: ...
    def clear_auth_failures(self, key: str) -> None: ...

# Auth agent exports register_auth(app, store, *, origin, clock=time.time,
# secure_cookie=False) -> AuthService. service.require(role=None, *, csrf=False)
# reads Flask request and returns AuthContext or raises ApiError.
# Also exports hash_password(password: str) -> str for main's explicit local seed.
# Routes owned by register_auth: POST /api/v1/auth/login, GET /api/v1/auth/session,
# POST /api/v1/auth/logout. Main supplies the common ApiError handler.
