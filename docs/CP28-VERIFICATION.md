# CP28 safe-build candidate

The complete domain flow is executable with the CP28 service/runtime/HTTP composition in an isolated **Anvil31337** fixture. It is not a real Monad or human-wallet acceptance. The persistent user entry deliberately remains **BLOCKED** until identity choice, public participant mapping, verified new deployment, operator-controlled signer and exact Runtime authority are configured and independently accepted.

## Implementation

- `server/manual_business`: complete role-scoped business HTTP; trusted authenticator interface with no selected login product; private link/short code reuse; owner proof; deterministic ABI intents; finite persistent budget and sender nonce; one-shot signer IPC; bounded original observation and same-block batch/global accounting.
- `identity.py` / `deployment.py` / `rpc.py`: unchanged pinned artifact, new deployment registration by original creation transaction and canonical receipt, immutable merchant runtime verification, no old CP19 target, fixed10143 genesis, read allowlist, bounded pages and total time. Production web adapter has no exposed signing/broadcast HTTP route.
- `composition.py`: explicit production wiring, operator-owned mode0600 configuration, immutable source checks, injected trusted authenticator and restricted Unix signer client. Preparation launcher does not call it or load any wallet key. Real authenticator/key-provider integration is awaiting the user's configuration decision.
- `manual-business-harness`: four-role flow, original-operation recovery, precise transaction review, MetaMask fund/proof/settle, one-use start handshake, account/network invalidation, QR generation and local image decoding. Service issue/lock/report are separate explicit actions.

Shared injection points: Backend policy (chain/rule/quantity/wallet kind), WorkCore fixed action encoding, OwnerWallet challenge/settle chain, and credential display prefix. Exact policy object identity is required. Default remains LOCAL_POLICY; original ChainRpc, outbox, contracts and historical manifests are unchanged. The dedicated test adapter is defined only in tests and is never selected from an HTTP request or environment.

## Repeatable validation

From this project root:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run chain:test
.venv/bin/python -m unittest tests.test_cp28_runtime tests.test_cp28_rpc tests.test_cp28_ipc tests.test_cp28_local_flow -q
.venv/bin/python -m unittest tests.test_cp24_local_e2e tests.test_backend_chain_contracts tests.test_backend_chain_owner tests.test_auth tests.test_cp27_readiness tests.test_cp26_readiness tests.test_cp26_startup -q
node --experimental-strip-types --test tests/wallet/cp28.test.ts tests/wallet-readiness/*.test.ts
node_modules/.bin/tsc --noEmit -p manual-business-harness/tsconfig.json
node_modules/.bin/vite build --config manual-business-harness/vite.config.ts
npm run build
```

The Python environment is the project's existing locked Python3.12 environment. New worktree dependencies were installed from the existing unchanged lockfile; the initial shared node_modules lacked the CP24 `jsqr` dependency. No root-workspace or other-project dependency files were changed.

The actual local flow checks: support → issue → invite → exchange → short code → one-use owner proof → lock → handoff → report → owner settlement; F=S=10^15 and A=R=H=0, exactly three service signatures, duplicate dispatch query-only, consumed code rejected, public ledger excludes recipient reference. Additional failures cover missing/expired authority, altered review, revoked mapping, same operation concurrency, nonce reservation, timeout/restart UNKNOWN, actual fee/transaction mismatch, data/anchor rollback and all security tables.

Protocol-only10143 tests cover exact genesis/chain/runtime, original deployment creation/nonce/receipt/finality, eight-call registration, unauthorized selectors/hashes/IDs, call/page/size limits and a dribbling response under absolute timeout. These do not prove real Monad finality, RPC availability or fees.

Unix socket tests run on the actual local OS: mode0700 parent/0600 socket, OS peer UID (macOS getpeereid through libc), second writer refused, oversized message and wrong UID rejected before dispatch, capability file symlinks/public modes refused. Same-UID compromise is outside this boundary; it is not an HSM or OS-account sandbox.

Browser fixture: `node scripts/cp28-browser-fixture.mjs 15288`; use Codex in-app browser on its printed URL and click Run. It imports the actual Wallet controller and uses browser native fetch against bounded synthetic HTTP: success, runtime denial, 4001, no hash, lost start response, account change. No real provider or RPC. `/mobile` is an explicit 390px iframe of the built app with synthetic BLOCKED status; desktop browser viewport override was ineffective, so this is labeled responsive-layout evidence, not a physical phone test.

## Preparation and recovery

```sh
.venv/bin/python -m server.manual_business prepare --directory .localbackend/cp28-preparation-20261008 --port 15287
```

`prepare` is exclusive and refuses an existing directory. After a normal Ctrl-C stop, use the same directory/port with `resume` instead. The persisted preparation runId and independent anchor must match; missing files are not recreated. This preparation identity is not a chain/DB backup and does not resurrect CP24–27 temporary runtimes.

Actual business persistence keeps the original database (including WAL when active), its independent external anchor, original configuration identity, encryption material and operator signer continuity. Restart at the original path only; relocated/missing/rollback state fails closed. No automatic writable restore, plan/budget reset, resign, re-broadcast or nonce replacement is provided. Preserve UNKNOWN and original sender/nonce/hash for read-only reconciliation. Real deployment/grant/admin operations remain a separate later Runtime Gate, never triggered by preparation.

Not run: real Monad calls or transactions, human wallet signatures, actual selected login mechanism, physical phone/camera. These require the user/Leader configuration and later Runtime authorization. Fixed-SHA independent review, PM verification and Leader acceptance remain separate.
