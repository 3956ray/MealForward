# MealForward / 留膳 — Monad isolated E2E development status (2026-10-19)

Scope of this report: **new isolated Monad Testnet proof and Vercel read-only pilot** only. The user's 12 Off-chain Staging manual actions were reported as executed; individual negative-test UI results, D1 order/voucher reconciliation and browser receipts were not furnished, so full human acceptance is NOT independently marked PASS.

## Engineering branch and PR

- Working branch: `codex/mealforward-monad-deployment-proof-20261019`
- Draft PR: https://github.com/3956ray/MealForward/pull/16
- BASE: `codex/mealforward-real-monad-e2e-preflight-20261018`. No merge to `main` or original `codex/mealforward-integrated-mvp`.
- Source: original `cp30-contracts/contracts/StoreEscrow.sol` unchanged.
- `staging-monad/compile-escrow.mjs` now includes compiler-declared immutable positions; original Solidity SHA-256 `bd84f387a46428802a453f28306ad6f9de7317465ff48844619d550713ce0c66` and creation bytecode SHA-256 `9c2583ee25a9fc08aa2434efde455ee7fc0c945847d3ef7789dfd370735d7a8d`.
- `staging-monad/runtime-proof.mjs`, `verify-deployment.mjs` and their tests enforce strict 10143 Testnet chain, Circle test USDC, creation tx input+ABI constructor, canonical matching receipt/block, independent role and catalog getters, immutable-aware runtime code, two-block minimum depth (not finality), negative tamper / reorg / price tests.
- Test suite executes against **mocked independent JSON-RPC fixture**; public RPC readiness is verified by a separate job. There has been NO new contract deployment or public funds transfer.

## Verified remote checks

- Source build + deployment verifier unit suite: GitHub Actions **Success** at https://github.com/3956ray/MealForward/actions/runs/39204459230 (and earlier https://github.com/3956ray/MealForward/actions/runs/39203759202).
- Real Monad public RPC + testnet USDC decimals/code, read-only: GitHub Actions **Success** at https://github.com/3956ray/MealForward/actions/runs/39204459366 ; no wallet keys, no transactions.
- Independent static Vercel preview build and no-wallet-write CI: https://github.com/3956ray/MealForward/actions/runs/39204459295 — **Success**.
- Vercel project: `mealforward-real-testnet-pilot`; preview for source SHA `437011a07c72fbf3e2f3ff58d1ddd0506fbae3c4` reported `READY` at https://mealforward-real-testnet-pilot-ib2q5j6ni-mangsengs-projects.vercel.app/ .
- Vercel Preview has SSO protection enabled; the owner may need to authenticate to access the URL. This preview is `pilot/index.html` read-only only. It intentionally has **no** approve, transaction-signing, Fund, Issue, or Settle calls. Not a production release.
- The older Cloudflare D1 Worker endpoint `/chain-check` **is not confirmed deployed**: legacy `staging-d1/smoke-live.mjs` failed with `chain preflight page should be public` on action https://github.com/3956ray/MealForward/actions/runs/39204271485. Its RPC substep PASS is independent of the failed D1 route. Do not direct wallet-preflight human acceptance to that unverified Worker URL.

## Explicit blockers

- NEW escrow has not been deployed to public Monad; there is no new contract address, receipt, confirmed Funded/Issued/Locked/HandoverMarked/Reported/Settled event or real Circle test USDC owner balance delta.
- Role-separated E2E needs distinct real test wallets, a safe quote EIP-712 signer policy, isolated durable intent/operation storage and secure beneficiary voucher delivery. Existing `staging-monad/chain-e2e.html` is single-wallet developer smoke only and does NOT satisfy production trust boundaries.
- Chain-level 180s delay is NOT enforced by frozen original `StoreEscrow.settle`; see Issue https://github.com/3956ray/MealForward/issues/17. Avoid exposing unrestricted owner-settlement as if the cooldown were enforced on chain.
- Original Mac CP30 `PREPARED #3560`, unsettled committed checkpoint, private PostgreSQL and signed Journal are **frozen**. We did not run `start`, `stop`, SQL, resume/replay, migrations, or any change to original keys/pins.
- No Render/Supabase durable signer services were provisioned. Stateless Vercel is used only for read-only preview; it is not a safe substitute for durable money-intent storage.

## Handoff: next human-only acceptance

Read-only wallet gate on Vercel Preview: open from phone or desktop MetaMask, verify chain 10143, connect **disposable** test wallet, query MON and Circle test USDC balances; paste only a safe summary (network, success/errors, numeric test balances) into the conversation. Do **not** submit a wallet transaction, transaction signing, token allowance or funds yet. Vercel SSO login may be required. On success, next engineering step is to prepare a fresh isolated escrow deploy transaction reviewed against the full public manifest and to run `node staging-monad/verify-deployment.mjs <manifest> <artifact>` read-only after owner-approved deploy.

No testnet token or mainnet USDC is needed for this first browser gate. Never send a private key, seed phrase, signature, raw Journal, authorization token, private QR, or sensitive cookie.
