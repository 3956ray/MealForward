"""SIWE login leaf. EOA-only; Main owns approved origin, random nonce and DB consume.

Never accepts browser-authored messages as authority. Build from trusted server
inputs, persist the exact nine-field challenge, then verify this stored challenge.
The recovered lower-case address is only a cryptographic result: Main must atomically
consume its original challenge and apply current policy before creating a session.
No nonce generation, datastore, identity roles, RPC, signer or private keys here.
Use both functions outside DB transactions; bridge executes installed pure viem.
"""

import json
from pathlib import Path
import re
import subprocess

_DIRECTORY = Path(__file__).parent
_CODEC = _DIRECTORY / "wallet-login-codec.mjs"
_KEYS = {"challengeId", "address", "chainId", "nonce", "domain", "uri", "issuedAt", "expiresAt", "message"}
_MAX_TIMESTAMP = 253402300799


class WalletLoginError(ValueError):
    def __init__(self, code="WALLET_LOGIN_REJECTED"):
        self.code = code if code in {"WALLET_LOGIN_REJECTED", "WALLET_LOGIN_CODEC_UNAVAILABLE"} else "WALLET_LOGIN_REJECTED"
        super().__init__(self.code)


def _timestamp(value):
    return type(value) is int and 0 < value <= _MAX_TIMESTAMP


def _parameters(wallet, origin, chain_id, nonce, challenge_id, issued_at, expires_at):
    match = re.fullmatch(r"https://(?:localhost|127\.0\.0\.1):([1-9][0-9]{3,4})", origin) if type(origin) is str else None
    if (not match or not 1024 <= int(match[1]) <= 65535
            or type(wallet) is not str or not re.fullmatch(r"0x[0-9a-fA-F]{40}", wallet)
            or type(chain_id) is not int or chain_id != 10143
            or type(nonce) is not str or not re.fullmatch(r"[0-9a-f]{64}", nonce)
            or type(challenge_id) is not str or not re.fullmatch(
                r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", challenge_id)
            or not _timestamp(issued_at) or not _timestamp(expires_at)
            or not 0 < expires_at - issued_at <= 300):
        raise WalletLoginError()
    return {"wallet": wallet, "origin": origin, "chainId": chain_id, "nonce": nonce,
            "challengeId": challenge_id, "issuedAt": issued_at, "expiresAt": expires_at}


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise WalletLoginError()
        result[key] = value
    return result


def _run(method, parameters, node_executable):
    if type(node_executable) is not str or not Path(node_executable).is_absolute() or len(node_executable) > 1024:
        raise WalletLoginError("WALLET_LOGIN_CODEC_UNAVAILABLE")
    try:
        wire = json.dumps({"method": method, "parameters": parameters}, ensure_ascii=True,
                          separators=(",", ":"), allow_nan=False).encode("ascii")
        if len(wire) > 32768:
            raise WalletLoginError()
        result = subprocess.run([node_executable, str(_CODEC)], input=wire, env={},
                                cwd=str(_DIRECTORY), stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, timeout=3, check=False)
        if len(result.stdout) > 32768:
            raise WalletLoginError("WALLET_LOGIN_CODEC_UNAVAILABLE")
        output = json.loads(result.stdout.decode("ascii"), object_pairs_hook=_pairs)
        if result.returncode != 0:
            raise WalletLoginError()
        if type(output) is not dict:
            raise WalletLoginError("WALLET_LOGIN_CODEC_UNAVAILABLE")
        return output
    except WalletLoginError:
        raise
    except Exception:
        raise WalletLoginError("WALLET_LOGIN_CODEC_UNAVAILABLE") from None


def build_wallet_login_challenge(*, wallet: str, origin: str, chain_id: int, nonce: str,
                                 challenge_id: str, issued_at: int, expires_at: int,
                                 node_executable: str) -> dict:
    """Return the exact nine-field server challenge; ints are epoch seconds.

    domain=approved host:port, uri=approved origin without slash; chain=10143,
    fixed statement, SIWE version=1 and requestId=challengeId. Main generates a
    fresh cryptographically random 64-lowerhex nonce and canonical UUID, persists
    the original DTO with one-use/idempotency rules; lifetime is at most 300s.
    """
    parameters = _parameters(wallet, origin, chain_id, nonce, challenge_id, issued_at, expires_at)
    output = _run("build", parameters, node_executable)
    challenge = output.get("challenge")
    if (set(output) != {"challenge"} or type(challenge) is not dict or set(challenge) != _KEYS
            or challenge.get("address") != wallet.lower()
            or any(challenge.get(key) != parameters[key] for key in
                   ("chainId", "nonce", "challengeId", "issuedAt", "expiresAt"))
            or challenge.get("domain") != origin[8:] or challenge.get("uri") != origin
            or type(challenge.get("message")) is not str or not 1 <= len(challenge["message"]) <= 4096
            or not challenge["message"].isascii()):
        raise WalletLoginError("WALLET_LOGIN_CODEC_UNAVAILABLE")
    return challenge


def verify_wallet_login_signature(challenge: dict, signature: str, *, now: int,
                                  node_executable: str) -> str:
    """Recover personal_sign/EIP-191 EOA address from exact stored challenge.

    now is Main's trusted epoch clock. No ERC-1271/provider/network fallback.
    A valid signature does not consume the nonce or grant a session/role here.
    """
    if (type(challenge) is not dict or set(challenge) != _KEYS
            or type(signature) is not str or not re.fullmatch(r"0x[0-9a-fA-F]{130}", signature)
            or not _timestamp(now)):
        raise WalletLoginError()
    _parameters(challenge["address"], challenge["uri"], challenge["chainId"], challenge["nonce"],
                challenge["challengeId"], challenge["issuedAt"], challenge["expiresAt"])
    if (not challenge["issuedAt"] <= now < challenge["expiresAt"]
            or type(challenge["message"]) is not str or not 1 <= len(challenge["message"]) <= 4096
            or not challenge["message"].isascii()):
        raise WalletLoginError()
    # Node rebuilds all fields with createSiweMessage and checks exact equality
    # before pure recoverMessageAddress. No caller-supplied replacement message.
    output = _run("verify", {"challenge": challenge, "signature": signature, "now": now}, node_executable)
    if set(output) != {"address"} or output["address"] != challenge["address"]:
        raise WalletLoginError()
    return output["address"]
