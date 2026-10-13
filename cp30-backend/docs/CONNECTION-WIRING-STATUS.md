# Connection source integration status

2026-10-13 Asia/Shanghai. WIP / FOURTH SOURCE SLICE HANDED OFF / NOT READY FOR
USER TRIAL / NOT TESTNET CONNECTED / NOT ACCEPTED. HEAD remains
`3cb717ec6fca60b80106783631a1e22b8abaff18`; no commit/push.

## Implemented shared source

- Same-origin QR and text use the same short display token; replacement, auth
  transition, expiry and observed voucher lock/use/epoch change clear display.
- Registration/first real meal UI, SDK email/OTP (no token-paste form), explicit
  wallet control and registration authorization, original registration lookup,
  wallet preparation/attempt/transaction routes. SDK/QR/wallet bundles are offline.
- Explicit composition builder imports finalized helper codecs, pinned registration
  observer and dispatcher. Activation is server-side, scoped and time-limited;
  defaults closed. Automatic dispatcher steps are present in the runtime source.
- Fixed PostgreSQL transaction/method adapters, private registration/image/outbox,
  cross-namespace slots, immutable 64-hex public IDs mapped losslessly to chain
  bytes32 IDs, confirmed menu relation and exact 5 MB raw-image upload route.
- Private JWT/proof authority source and narrow controller capability. Signed
  identity normalization precedes session creation. Wallet challenge consumption
  and binding share the existing journal prepare/apply/proof/finish path; final SQL
  rechecks current session/identity/epoch/clock and exact challenge. Crypto stays
  outside transactions. JWT expiry follows recovery rotation; journal.py unchanged.
- New migration fixes publish/settle review-route-original-store binding at the
  accepted functions. These source changes are not a database/security acceptance.
- Private business policy/ledger/nonce/gas reservation and real BusinessCodec +
  TransactionCrypto facets. Private signer transport and concrete host source composition are authored;
  runtime execution and verification remain incomplete.
- Actual private registrar IPC host now composes the finalized RegistrarRuntime,
  registration codec and transaction crypto with the single approved PG ledger,
  external controller journal, dedicated FD-only viem signer response journal,
  bounded factory/profile/nonce RPC, single broadcaster and original-only lookup.
  Independent source bootstrap, config pinning, private clock and startup match
  are authored. All runtime paths remain unexecuted; see REGISTRAR-SOURCE.md.
- Testnet mode explicitly refuses synthetic auth/business fallback.
  `businessReady` additionally requires a real datasource's readiness gate.
- New child requirements-connection.lock copies complete PyJWT/cryptography/cffi/
  pycparser pinned/hash blocks from root lock plus child dependencies. No install,
  root lock change or original C1 five-wheel freeze change.
- Prices use exact viem parseUnits/formatUnits, not floating-point amounts.
- Concrete live gateway/worker, independent actual facts/original receipts, sealed
  PG live protocol, all wallet entry routes, three scoped authority suite/admission
  and signer/broadcaster composition are now authored. Fragment URL QR, memory-only
  login handoff, reviewed amount formatting and public email login are integrated.
  Detailed source/evidence boundaries: LIVE-BUSINESS-SOURCE.md.

## Actual validation

Third slice: seven focused live protocol tests, exact short-link QR decode/DOM memory
checks, Python AST and JS syntax pass. All chain/PG/wallet/signing runtime paths remain
NOT_RUN. See LIVE-BUSINESS-SOURCE.md for precise shared versus helper-author scope.


13 new registrar/controller/bootstrap offline checks, 5 finalized persistence
adapter memory checks and 4 registrar domain inert stub checks passed. Seven
prior focused offline shared-adapter checks passed (including inactive composition,
actual unsigned Node codec, stable first-meal catalog, private atomic proof source
contract and testnet synthetic-fallback refusal). QR decode/DOM/route/expiry/original
lock/pending/UNKNOWN in-memory checks passed. Shared Python AST and JS syntax pass;
three offline Vite builds pass. Exact decimal conversion passes 0.01 -> 10000 at six
places, reverse formatting, over-safe-integer values, precision/unknown-decimal
rejection. Original requirement pin/hash block copies are exact. No live HTTP/PG,
wallet/identity/JWKS/RPC, signing, broadcasting, deployment or old blocked suite run.
SQL is authored but NOT applied or semantically verified by PostgreSQL.

## Current fourth-slice source boundary

Full-app fresh role/config/security journal/anchor provisioning, fixed HTTPS
origin/port/TLS validation, merged identity/business configuration, six-app owned
start/stop, private clock/worker lifecycle and automatic first VERIFIED store
binding are now authored. Details and exact input checklist are in
FULL-APPLICATION-SOURCE.md and FRESH-INPUTS.md. No first required user-path method
is intentionally left as a missing broker or permanent False.

Seven new bounded full-app checks plus seven existing focused live checks pass;
source AST/disabled-template JSON pass. No PG/HTTPS/identity/RPC/wallet/key/signer
runtime path was executed. Actual privileges, SQL semantics, positive startup,
complete first-run execution and independent acceptance remain unverified. Formal
new-record epoch/restore verification remains later; missing/conflicting state
continues to close without reset/adoption. Old stopped matrices remain stopped.

## Required external configuration

- Actual reviewed new-origin Dynamic ClaimProfile (all issuer/audiences/absence
  policies), exact signed-email verified-credentials or signed-boolean mapping,
  allowed HTTPS origin, fresh server email/subject HMAC keys. Public reusable
  environmentId: 7fe95f70-e5cc-4c3c-beed-a133e81268dc only; no old private profile,
  token, key or runtime was read/calibrated. Current Python lacks PyJWT; fail closed
  DEPENDENCY_NOT_CONFIGURED until a new explicitly provisioned environment exists.
- Reviewed Monad chain/genesis/finality/EIP1898 profile, selected test asset code/
  decimals, exact Factory/authority addresses, same-build creation pin and runtime
  template/compiler pins, allowed RPC endpoint/hosts and bounded budgets.
- Fresh private roles/IPC capabilities, registrar/quote/issuer/operator signer
  custody and original journals, approved nonce/gas limits and explicit activation.
  No asset candidate, old secrets/configuration, signer or disabled setting is enabled.

Existing source patches/helper directories/frozen cp30-contracts/root dependencies
and historical evidence are preserved. Complete C1 freeze/matrices, L8 independent
verification and final acceptance remain outstanding; original platform stop stands.
