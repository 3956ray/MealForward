"""Server-bound EOA control challenge; no session/role creation or authority persistence."""
from dataclasses import dataclass
import json
import math
from pathlib import Path
import re
import secrets
import subprocess
from typing import Callable, Protocol

from .adapter import IdentityBinding


class WalletProofError(Exception):
    def __init__(self, code: str, status: int = 401):
        super().__init__(code)
        self.code, self.status = code, status


def _wallet(raw: str) -> str:
    if type(raw) is not str or not re.fullmatch(r"0x[0-9a-fA-F]{40}", raw) or int(raw[2:], 16) == 0:
        raise WalletProofError("WALLET_PROOF_REJECTED")
    return raw.lower()


def _word(raw: str) -> str:
    if type(raw) is not str or not re.fullmatch(r"(?:0x)?[0-9a-fA-F]{64}", raw):
        raise WalletProofError("WALLET_PROOF_NOT_CONFIGURED", 503)
    return "0x" + raw.removeprefix("0x").lower()


@dataclass(frozen=True)
class WalletProofDomain:
    name: str
    version: str
    chain_id: int
    verifying_contract: str
    backend_origin_hash: str
    namespace_hash: str
    ttl_seconds: int

    def __post_init__(self):
        if (any(type(v) is not str or not v or len(v) > 128 or v != v.strip()
                or any(ord(c) < 32 or ord(c) == 127 for c in v) for v in (self.name, self.version))
                or type(self.chain_id) is not int or not 0 < self.chain_id <= 2**53 - 1
                or type(self.ttl_seconds) is not int or not 1 <= self.ttl_seconds <= 300):
            raise WalletProofError("WALLET_PROOF_NOT_CONFIGURED", 503)
        try:
            object.__setattr__(self, "verifying_contract", _wallet(self.verifying_contract))
            object.__setattr__(self, "backend_origin_hash", _word(self.backend_origin_hash))
            object.__setattr__(self, "namespace_hash", _word(self.namespace_hash))
        except WalletProofError:
            raise WalletProofError("WALLET_PROOF_NOT_CONFIGURED", 503) from None


@dataclass(frozen=True)
class WalletProofSession:
    """Main constructs this from its current authoritative session, never browser subject input."""
    session_hash: str
    identity: IdentityBinding
    expires_at: int

    def __post_init__(self):
        object.__setattr__(self, "session_hash", _word(self.session_hash))
        if (not isinstance(self.identity, IdentityBinding) or type(self.expires_at) is not int
                or type(self.identity.expires_at) is not int
                or any(type(v) is not str or not re.fullmatch(r"[0-9a-f]{64}", v)
                       for v in (self.identity.subject_hash, self.identity.email_key))):
            raise WalletProofError("WALLET_SESSION_REJECTED")


@dataclass(frozen=True)
class WalletChallenge:
    challenge_id: str
    nonce: str
    wallet: str
    deadline: int
    domain: WalletProofDomain
    session: WalletProofSession

    def typed_data(self) -> dict:
        fields = [("challengeId", "bytes32"), ("nonce", "bytes32"), ("wallet", "address"),
                  ("backendOriginHash", "bytes32"), ("namespaceHash", "bytes32"),
                  ("sessionHash", "bytes32"), ("subjectHash", "bytes32"), ("deadline", "uint256")]
        return {
            "domain": {"name": self.domain.name, "version": self.domain.version,
                       "chainId": self.domain.chain_id, "verifyingContract": self.domain.verifying_contract},
            "primaryType": "WalletControl", "types": {"WalletControl": [{"name": n, "type": t} for n, t in fields]},
            "message": {"challengeId": self.challenge_id, "nonce": self.nonce, "wallet": self.wallet,
                        "backendOriginHash": self.domain.backend_origin_hash, "namespaceHash": self.domain.namespace_hash,
                        "sessionHash": self.session.session_hash, "subjectHash": _word(self.session.identity.subject_hash),
                        "deadline": self.deadline},
        }

    def public_projection(self) -> dict:
        return {"challenge_id": self.challenge_id, "wallet": self.wallet, "deadline": self.deadline,
                "typed_data": self.typed_data()}


class ChallengeStore(Protocol):
    def reserve(self, challenge: WalletChallenge) -> bool:
        """Atomic insert-if-absent; never overwrite or reuse challengeId/nonce."""
        ...

    def read(self, challenge_id: str) -> WalletChallenge | None:
        """Read the original, immutable challenge, not a client-supplied typed-data payload."""
        ...

    def consume_once(self, expected: WalletChallenge, session: WalletProofSession, now: int) -> bool:
        """Main must implement ONE transaction/CAS: unconsumed original record equals expected;
        session equals expected.session AND current authoritative nonrevoked session/identity;
        now < challenge.deadline/session.expires_at/identity.expires_at. Then consume once.
        Recheck expiry with the authoritative transaction-time clock, not only the supplied pretransaction now.
        This transaction also owns the final authority write if Main needs atomic proof+binding.
        No cryptographic recovery or external Node invocation inside the transaction.
        """
        ...


@dataclass(frozen=True)
class VerifiedWalletBinding:
    identity: IdentityBinding
    wallet: str

    def to_json(self) -> dict:
        return {"identity": self.identity.to_json(), "wallet": self.wallet}


class NodeEoaRecoverer:
    """Installed pure viem codec only. Signature goes through stdin; no secret-bearing argv/logs."""
    def __init__(self, node_executable: str = "/opt/homebrew/bin/node"):
        self._node = Path(node_executable)
        self._codec = Path(__file__).with_name("wallet-proof-codec.mjs")

    def recover(self, typed_data: dict, signature: str) -> str:
        if not self._node.is_file():
            raise WalletProofError("DEPENDENCY_NOT_CONFIGURED", 503)
        try:
            result = subprocess.run([str(self._node), str(self._codec)],
                input=json.dumps({"typed_data": typed_data, "signature": signature}),
                env={}, capture_output=True, text=True, timeout=5,
                cwd=self._codec.parent)
            if result.returncode or len(result.stdout) > 256:
                raise ValueError("Recovery rejected")
            output = json.loads(result.stdout)
            if set(output) != {"wallet"}:
                raise ValueError("Invalid codec result")
            return _wallet(output["wallet"])
        except (OSError, subprocess.TimeoutExpired):
            raise WalletProofError("DEPENDENCY_NOT_CONFIGURED", 503) from None
        except (ValueError, TypeError, WalletProofError):
            # Never propagate Node stderr/stack/input; a library error can contain the signature.
            raise WalletProofError("WALLET_PROOF_REJECTED") from None


class WalletProofService:
    def __init__(self, *, domain: WalletProofDomain, store: ChallengeStore, clock: Callable[[], float],
                 current_session: Callable[[str], WalletProofSession | None],
                 wallet_kind: Callable[[str], str] | None,
                 recoverer: NodeEoaRecoverer | None = None,
                 nonce: Callable[[], str] | None = None):
        if not isinstance(domain, WalletProofDomain):
            raise WalletProofError("WALLET_PROOF_NOT_CONFIGURED", 503)
        self._domain, self._store, self._clock = domain, store, clock
        self._current_session, self._wallet_kind = current_session, wallet_kind
        self._recoverer = recoverer if recoverer is not None else NodeEoaRecoverer()
        self._nonce = nonce if nonce is not None else lambda: "0x" + secrets.token_hex(32)

    def _now(self) -> int:
        value = self._clock()
        if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value < 2**53:
            raise WalletProofError("WALLET_PROOF_NOT_CONFIGURED", 503)
        return math.floor(value)

    def _session(self, session: WalletProofSession, now: int) -> None:
        if (not isinstance(session, WalletProofSession)
                or now >= min(session.expires_at, session.identity.expires_at)
                or self._current_session(session.session_hash) != session):
            raise WalletProofError("WALLET_SESSION_REJECTED")

    def _eoa(self, wallet: str) -> None:
        if not callable(self._wallet_kind):
            raise WalletProofError("WALLET_TYPE_NOT_CONFIGURED", 503)
        kind = self._wallet_kind(wallet)
        if kind in ("SMART", "MULTISIG"):
            raise WalletProofError("WALLET_KIND_NOT_SUPPORTED", 422)
        if kind != "EOA":
            raise WalletProofError("WALLET_TYPE_NOT_CONFIGURED", 503)

    def issue(self, wallet: str, *, session: WalletProofSession) -> WalletChallenge:
        now, wallet = self._now(), _wallet(wallet)
        self._session(session, now)
        self._eoa(wallet)
        challenge = WalletChallenge(_word(self._nonce()), _word(self._nonce()), wallet,
            min(now + self._domain.ttl_seconds, session.expires_at, session.identity.expires_at), self._domain, session)
        if not self._store.reserve(challenge):
            raise WalletProofError("WALLET_CHALLENGE_CONFLICT", 409)
        return challenge

    def verify(self, challenge_id: str, signature: str, *, session: WalletProofSession) -> VerifiedWalletBinding:
        try:
            challenge_id = _word(challenge_id)
        except WalletProofError:
            raise WalletProofError("WALLET_PROOF_REJECTED") from None
        challenge = self._store.read(challenge_id)
        now = self._now()
        self._session(session, now)
        if (challenge is None or challenge.domain != self._domain or challenge.session != session
                or now >= challenge.deadline):
            raise WalletProofError("WALLET_PROOF_REJECTED")
        self._eoa(challenge.wallet)
        if type(signature) is not str or not re.fullmatch(r"0x[0-9a-fA-F]{130}", signature):
            raise WalletProofError("WALLET_PROOF_REJECTED")
        # Read operations above are complete; Node recovery is outside any consume transaction.
        recovered = self._recoverer.recover(challenge.typed_data(), signature)
        if _wallet(recovered) != challenge.wallet:
            raise WalletProofError("WALLET_PROOF_REJECTED")
        now = self._now()
        self._session(session, now)
        self._eoa(challenge.wallet)
        if now >= challenge.deadline or self._store.read(challenge.challenge_id) != challenge:
            raise WalletProofError("WALLET_PROOF_REJECTED")
        # Store must recheck authoritative session in the same final transaction; callback above alone is insufficient.
        if not self._store.consume_once(challenge, session, now):
            raise WalletProofError("WALLET_PROOF_REJECTED")
        return VerifiedWalletBinding(session.identity, challenge.wallet)
