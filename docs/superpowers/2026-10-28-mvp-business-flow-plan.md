# MVP business flow implementation

Approved by user 2026-10-28. Goal: isolated Monad Testnet donation -> issue -> private recipient link -> merchant scan -> atomic handover -> on-chain 180-second wait -> settlement with receipt/balance verification. Old contract, Phase8 issued child, and all UNKNOWN history stay untouched. No automatic signing/broadcast; user controls every real wallet action. Minimize human tests to initialization plus one full acceptance session.

## Global constraints
- New contract and new data namespace only. Preserve frozen cp30-contracts and old services/data. New chain10143 deployment by Owner wallet; local synthetic Anvil31337 allowed for engineering tests.
- Owner 0xc4f8a468f10d5f98dcff3282516125e97f26433b is merchant/operator/catalog/quote authority; Donor 0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952 funds; Issuer 0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3 issues. Recipient no wallet.
- One store, meal, test voucher, 7 test-token units (6 decimals), whole-day serving, existing three-day voucher lifetime. Isolated new demo ERC20, clearly test-only, no old funds touched.
- Reuse OpenZeppelin, existing viem/wagmi and QR libraries. Keep license/provenance. No new framework migration.
- All backend responses/progress truthful; no secret URLs, sessions, credentials, signatures in logs/docs. Same-origin HTTP-only recipient session; private fragment token removed immediately; hashed credentials only.
- Every real transaction explicit, no automatic retry/resend. Known-hash recovery after reload. Pending/unknown blocks new send. Receipt and accounting must agree before success.
- Need implementation and independent review, targeted automated tests, public deployment check, HANDOFF update before requesting user testing. No merge authorized.

### Task 1: isolated contract and local contract tests
Create mvp-contracts independently from frozen StoreEscrow source. Maintain accounting/pause/close/refund/expiry/replay semantics; new atomic redeem combines lock/mark/report. Every path into H sets settlementAvailableAt = block.timestamp + 180. settle enforces it, idempotent replay cannot reset time or pay twice. Export ABI and creation bytecode reproducibly; add isolated test asset with constructor mint of exactly 7e6 to Donor. Foundry focused tests include unauthorized roles, 179/180 boundary, duplicate redemption/settlement, pause/close/refund compatibility. Document funding/issuance ABI for subsequent tasks.

### Task 2: durable MVP service
Independent mf_mvp namespace + least-privilege login, migration through Supabase CLI. Backend handles role-auth, durable operations, pinned deployment verification, recipient invitation/session/display hashes, merchant code checks and chain reconciliation. Retain same Node/Postgres/Render stack. Expose /v1/mvp endpoints and state including operation/hash/receipt/settlementAvailableAt; no server signer. New contract initialization UI allowed to construct deployment only from reviewed artifact and fixed roles. Read-only RPC paced; events and target/account/calldata/receipt/canonical state validated. Recipient URL fragment 72h, session8h, display2min; refresh invalidates prior display; six-digit code rate limited. Local isolated PG/Anvil end-to-end evidence required.

### Task 3: continuous frontend
New setup, recipient, merchant pages with explicit wallet actions, EIP6963 provider choice and viem/wagmi reuse. Setup deploys isolated token/escrow then donor approve/fund and issuer issue; owner signs quote when needed. Recipient opens secret fragment, sees QR/code and outcome. Merchant authenticates, scans/checks, confirms handover once, waits180s, explicitly settles. Clear disabled reasons, auto read-only refresh, persist pending/hash state and recover same hash. Use current QR components and existing interaction lessons, no short recovery rounds. Desktop/mobile checks and focused DOM/provider tests.

### Task 4: integration, review, rollout
Integrate service into current Render entrypoint behind explicit MVP flag, preserve old routes and no old settlement. Configure isolated schema/runtime, build fixed artifacts/client, CI scoped tests, one local full E2E, public read-only/authnegative smoke. Independent final review, resolve material findings. Deploy only reviewed/tested commit, verify actual commit and database permissions. Update HANDOFF with exact evidence, links, remaining user initialization/acceptance and disable-write rollback retaining facts. Stop at real wallet actions needed from user, never claim real MVP completion beforehand.
