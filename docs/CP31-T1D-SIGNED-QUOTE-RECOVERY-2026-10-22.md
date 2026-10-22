# MealForward · T1-D Real Test USDC Funding · Original FundingQuote Recovery

Date: 2026-10-22 (UTC+8). Branch: `codex/mealforward-t1d-real-test-usdc-funding-20261022`.
**Status: Source+CI+isolated Supabase migrations accepted; real Fund service is NOT deployed or enabled.**

## Immutable Testnet scope

- Original already-deployed StoreEscrow: `0xcF0C8827C8610EEFF1ecbd9719E559d805FafE58`, Monad Testnet Chain 10143.
- Original Circle Test USDC: `0x534b2f3A21130d7a60830c2Df862319e593943A3`; original Quote Authority: `0xcc5C1ce846c0302ab27a4811cf2e0e6fc7282952`.
- Original meal ID `0x44f977bbf22112030199e42ccf232d08fe6e8223be9c274944c8a40671f6ae6b`; one 7 Test USDC meal, version 1, pinned Terms Hash.
- No re-deploy of T0, no Mac CP30 imports, no Settlement, no real mainnet assets.

## Integration: reviewed PR #32 + original immutable Intent

The original T1-D branch already had wallet-owned testnet Prepare, MetaMask V4 FundingQuote signing, exact Approve/Fund, durable UNKNOWN transaction reservation, bind-original-Hash and read-only receipt verification. PR #32 was a distinct draft branch providing independently reviewed FundingQuote semantics and a SQL signed-authorisation handoff; it was **not blindly merged**.

We integrated the PR #32 **pure, exact FundingQuote protocol and EIP-712 tests** into `t1-intents/quote-protocol.mjs` and `quote-protocol.test.mjs` with corrected same-package imports (no undeclared cross-directory `ethers` dependency).

- `POST /v1/t1/fund/quote` now verifies the exact immutable frozen payer/meal/version/chain/amount, exact registered Quote EOA and unexpired genuine FundingQuote *before* the original SQL transaction binds the quote.
- The original `createT1IntentLedger` has opt-in `persistSignedQuotes`, **enabled only in T1-D funding mode**, never in the public T1-C read-only mode. The original Intent UPDATE to `QUOTE_BOUND`, private `quote_authorizations` INSERT, and audit append all COMMIT or ROLLBACK together. No partially-bound quote after a DB failure.
- `GET /v1/t1/fund/quote/:originalIntentId` is funding-mode-only, authenticated by the G0-style HttpOnly SIWE Session, bound by the *server's* original payer principal and fixed Quote wallet for this first test, guarded by same-origin checks and no-store. The raw original signed FundingQuote remains private, checked against the stored keccak fingerprint, EIP-712 digest and true registered authority on recovery. No public receipt/status DTO exposes it.
- Reopening the page can recover the original signature from PostgreSQL; no browser local storage or new Quote ID is generated. After `FUND_UNKNOWN` the API refuses re-exposure for a new send; only original transaction Hash/Receipt reconciliation continues.
- `POST /v1/t1/fund/approve-call` and `POST /v1/t1/fund/build-call` construct the original exact ERC20 Approve and StoreEscrow Fund using the reviewed PR #32 code. Both accept one pending wallet nonce, enforce original T0 and testnet-only constraints, and require the browser to reserve that *same nonce* durably before a **human** MetaMask `eth_sendTransaction`. No backend signer, private key or automatic broadcaster exists.

## Database migrations / actual project

Supabase `mealforward-t1-staging` / `ketfrukrcuosrqynnsay` PG17.11 remains separate from original Mac CP30 and original Render G0 data.

- Migration 006 `mealforward_t1d_isolated_funding_writer_nologin_v1`: dedicated `mf_t1d_fund_runtime`, NOLOGIN and minimal field-level INSERT/UPDATE permissions. Existing T1-C Auth + Intent runtime roles untouched.
- Migration 007 `mealforward_t1d_funding_quote_handoff_append_only_v1`: `mf_t1c.quote_authorizations`, immutable Quote ID/digest/fingerprint, original payer Intent trigger, no UPDATE/DELETE/TRUNCATE, SELECT/INSERT only to the new T1-D role.
- Applied only after exact-source disposable PG17 migration+permissions+atomic-recovery CI passed and live project baseline (zero original Intents/Attempts/Audit) was independently rechecked.
- Post-migration actual Supabase: signed Quotes 0, Intents 0, Attempts 0; writer LOGIN=false; writer SELECT/INSERT true, DELETE false; original T1-C read-only role and Auth role cannot read signed quotes.
- Security Advisor returned no reported findings at time of check. Private schemas are not exposed via Supabase Data API; no RLS policy migration was attempted.

## Independent CI evidence, full exact SHA

Commit `13cec335f19e225ff9b50e321b7f7422524ce901`:
1. Real Monad read-only T0 bytecode, Terms/price and Quote wallet preflight + 15 MetaMask V4/protocol tests: PASS
   https://github.com/3956ray/MealForward/actions/runs/39767913974
2. Genuine disposable PostgreSQL17.11, G0-style EIP-191 SIWE A/B and CSRF; byte-exact 006 + 007 migrations; role isolation; signed-authorisation append-only; deliberately failed quote insert rolls back original Intent stage; signed quote survives new ledger instance; foreign wallet rejected: PASS
   https://github.com/3956ray/MealForward/actions/runs/39767913996
3. Real unchanged Render T1-C `READY_NO_FUNDS`, unauthenticated privacy 401, money routes denied and original CP30 isolated (7/7 HTTP): PASS
   https://github.com/3956ray/MealForward/actions/runs/39767914006

The Render Free service cold-started during the first short probe; first-request timeout was extended on this T1-D branch to allow cold-start, with all original 7 exact assertions preserved. **Existing deployed T1-C binary, service and repo branch were NOT changed.**

## Release blockers; do NOT call the whole funding E2E complete

- The new T1-D writer is still NOLOGIN. No owner-generated database writer password/DSN exists in the new Render service.
- No independent T1-D funding Render web service is deployed or accepted. Keep the original T1-C service on `READ_ONLY_NO_FUNDS` and preserve its tested commit.
- The original T1-C credentials appeared previously in chat. Rotate before relying on public SIWE or accepting any real user funds, even if this is only a testnet pilot.
- Require fresh isolated T1-D Render Free service with exact origin/verified Supabase CA, independently validated roles, startup rejects any missing grants/T0 changed state; keep autoDeploy OFF.
- Add and pass an external authenticated wallet A/B HTTP trial on the new service (different payer denied, original Quote only, no wrong-domain or replay, UNKNOWN sticky). No real wallet signature or on-chain transfer occurred during this development phase.
- First real Testnet user-run: one Quote Authority self-funded 7 Test USDC (two separate explicit MetaMask approvals), saved immutable original Intent and one Quote ID, **Approve Receipt + allowance**, then **Fund Receipt + Funded/Transfer + quoteUses + token deltas** and safe UNKNOWN original-Hash recovery. Never automatically retry any wallet transaction.
- Original StoreEscrow lacks an onchain 180-second settlement cooldown (Issue #17). Keep Issue/Lock/Report/Settle outside this limited first Fund authorization, and avoid turning this pilot into production.

**Never paste credentials, real EIP-712 signatures, raw DSNs, tokens, recovered secrets, historical CP30 payloads, or wallet private keys into chat, GitHub or logs.**
