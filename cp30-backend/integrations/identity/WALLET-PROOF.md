# Server-bound wallet control proof — EOA leaf candidate

Only new wallet files in this identity directory implement this slice. The email adapter, its existing checks/README, the Factory freeze and all shared application/SQL/controller code remain unchanged. This module does not create a session, register a store, grant a role, persist authority, start a service or connect a wallet/provider/network.

## Backend API and trusted ports

Import `identity.wallet_proof` with the same explicit project/integrations source paths as the email adapter:

```python
domain = WalletProofDomain(
    name=reviewed_domain_name, version=reviewed_domain_version,
    chain_id=reviewed_chain_id, verifying_contract=reviewed_contract,
    backend_origin_hash=reviewed_origin_hash, namespace_hash=reviewed_namespace_hash,
    ttl_seconds=reviewed_ttl,
)
session = WalletProofSession(
    session_hash=server_session_hash, identity=current_identity_binding,
    expires_at=server_session_expiry,
)
service = WalletProofService(
    domain=domain, store=main_challenge_store, clock=server_clock,
    current_session=main_current_session_lookup,
    wallet_kind=main_trusted_wallet_type_lookup,
)
challenge = service.issue(wallet, session=session)
public_challenge = challenge.public_projection()
verified = service.verify(challenge_id, signature, session=session)
# Only verified.identity (existing normalized IdentityBinding) and verified.wallet are the successful result.
```

Client issuance input is **wallet only**. `session`, `domain`, subject, chain, origin, namespace, lifetime, nonce source, store, classification and recovery implementation are trusted backend configuration/context, not request-body fields. Completion input is the original challenge_id and signature plus the current trusted server session. The service reads the original stored challenge and reconstructs its typed data; it never accepts client-supplied typed data, subject or roles.

`current_session(session_hash)` must return the current authoritative `WalletProofSession` or None when expired, revoked, unavailable or changed. `WalletProofSession.identity` must be the normalized identity from the real verified-email/session flow, not a client JSON/assertion. Comparison includes the full original IdentityBinding, so subject/email binding or expiry changes reject. Session/identity expiry also bounds challenge expiry.

`wallet_kind(wallet)` is a **trusted server classifier**, not a browser flag. Only exact `EOA` is supported. Missing/unknown classification yields WALLET_TYPE_NOT_CONFIGURED (503); SMART or MULTISIG yields WALLET_KIND_NOT_SUPPORTED (422). Recovery alone is not used as proof that an address has no smart/delegated code. Live code/type observation is **not implemented or run** here; Main must provide approved classification evidence. There is no ERC1271, EIP6492, multisig, smart-account or delegated-account fallback.

Production defaults to `NodeEoaRecoverer(node_executable="/opt/homebrew/bin/node")`, using installed pure viem `recoverTypedDataAddress`. The optional trusted recoverer/nonce constructor ports exist for backend configuration/testing and must never be selectable by a client. Memory recovery stubs live only in tests. Default production nonces are independent 32-byte cryptographic random challengeId and nonce; Main's store must reject reuse, and the service does not silently retry a reservation conflict.

## Fixed signed schema

```text
domain: {name, version, chainId, verifyingContract}  # every value server-configured
primaryType: WalletControl

WalletControl(
  bytes32 challengeId,
  bytes32 nonce,
  address wallet,
  bytes32 backendOriginHash,
  bytes32 namespaceHash,
  bytes32 sessionHash,
  bytes32 subjectHash,
  uint256 deadline
)
```

The canonical ordered type array is shared by Python challenge construction and `wallet-proof-codec.mjs`. The message carries server HMAC session/subject hashes, not raw subject, email, cookie or JWT. Wallet/address output is lowercase canonical hex. Domain chainId is a positive safe integer; TTL is explicitly configured from 1–300 seconds, with deadline=min(now+TTL, session expiry, identity expiry), exclusive. First version accepts only a 65-byte hex EOA signature. The codec rejects changed schemas/extra domain/message fields and unsupported lengths.

The pure JS `proofContextHashes(approvedBackendOrigin, approvedNamespace)` returns keccak256 of the exact UTF-8 origin and namespace strings. Main supplies already approved/canonical server strings; neither request Host nor client origin can select them. Python accepts those explicit bytes32 hashes. Domain/verifyingContract and all context hashes are immutable per stored challenge; a different configured service rejects the old challenge. These configured values are not approved or discovered by this module.

## Transaction boundary Main must implement

`ChallengeStore` defines exactly:

```text
reserve(challenge: WalletChallenge) -> bool
read(challenge_id: str) -> WalletChallenge | None
consume_once(expected: WalletChallenge, session: WalletProofSession, now: int) -> bool
```

reserve atomically inserts an immutable original record only if challengeId and nonce are unused. read returns that original record. External Node recovery occurs after read and **outside** any consume transaction. The service then rechecks current session/identity, server wallet type, original record and expiry before calling consume_once.

consume_once must be a **single authoritative transaction/CAS** checking original record equality, not consumed, same session and subject binding, current nonrevoked session/identity, and all expiries using its fresh transaction-time clock. It must not trust only the service's pretransaction timestamp or earlier lookup. It atomically marks consumed once. Main owns PG schema, session joins, locking, clock policy, rollback and authority persistence. If proof consumption and authority persistence must be atomic, Main must include that write in the same transaction/guard; this boolean protocol alone does not implement that integration. No Node/signature recovery belongs inside the transaction.

Only after successful recovery, matching wallet and successful CAS does verify return `VerifiedWalletBinding(identity=IdentityBinding, wallet=canonical_wallet)`; `to_json()` has only identity's existing normalized fields and wallet. This result is not an owner/merchant grant. Main still checks its onboarding/wallet association policy before creating persistent authority. Failure or UNKNOWN must use the original challenge/session; no client-subject fallback or silent replacement nonce is provided.

## Signature handling and bounded offline checks

The production subprocess uses an empty environment, bounded stdin JSON, five-second timeout and no signature in argv. Signature/recovery library stderr or stack is discarded; only a recovered address or fixed error is returned. No signature, JWT, email or key is stored/logged by this module. Missing installed runtime returns DEPENDENCY_NOT_CONFIGURED (503); other recovery/nonce/session/CAS failures reject with fixed codes.

Run from the project root:

```sh
python3 cp30-backend/integrations/identity/run-wallet-proof-offline.py
```

Only the already installed Python3.12.14 and Node/viem are used. Children have empty environments; Python runs -I -B and explicit project/integrations paths. Four Python cases pass: single-use memory binding and exact challenge fields; post-recovery/transaction expiry, session revocation and record mutation; missing/SMART/MULTISIG classification, wrong session and two-thread single-CAS outcome; actual Python-to-Node viem recovery with a public synthetic fixture plus wrong-wallet rejection. Two Node cases pass: actual EOA recovery and mutations of every domain/message field; schema additions and unsupported signature length rejection. Public fixture signing occurs only inside the test and its in-memory pipe, never evidence/log/key files or production composition. No person/provider/wallet/signing service is used.

`wallet-proof-checks.json` records results and SHA256 preservation of all eight frozen email leaf files. Results are **4/4 Python + 2/2 Node passed**. The memory store/stub does not stand in for completed PG/session authority integration; the actual viem roundtrip is separately tested.

NOT_RUN: live EOA classification, actual session/revocation/controller/PG/authority transactions, real identity/wallet/provider/signatures, HTTP/RPC/network/broadcast/deployment, smart/multisig proofs, real domain/profile approvals, or any old C1/identity/security tests. No permission or full login/onboarding acceptance is claimed.
