"""JWT worker replacement point. C0 deliberately authenticates nobody."""
from server.dynamic_contracts import ClaimProfile, Clock, JwksProvider, VerifiedIdentity, unavailable


def verify_access_token(raw: str, *, profile: ClaimProfile, clock: Clock,
                        jwks: JwksProvider) -> VerifiedIdentity:
    raise unavailable()
