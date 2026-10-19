# MealForward CP31 G1-B — Original-CP30 Wallet A/B Private Read Bridge

**Status: isolated source-only review candidate. NOT installed into old CP30 Mac, existing Render Auth Pilot, Cloudflare D1, Monad Testnet or a production website.**

## Why this is necessary

G0 Render SIWE proves a real wallet owns its current auth-only Session. That Session is **not** the CP30 original subject/recipient_key authority. The original CP30 private records (My Contributions, My Claims, My Meals) must be read through the original `c1_private.auth` wallet/session principal and original PostgreSQL 17 schema. Simply joining on a wallet address from a browser or borrowing the Render Auth Pilot cookie would create a cross-trust-domain security hole.

## What this branch implemented

1. `cp30-backend/g1-export/disposable-private-read-facade.sql`: new **NOLOGIN** owner/client source roles, a fixed disabled-by-default namespace binding and a single `STABLE SECURITY DEFINER c1_g1_private_read.my_items(text,text)` endpoint. Supported sections are exactly `orders`, `claims` and `vouchers`. It calls the reviewed `c1_private.auth(...,mutation=false)` against a server-owned **original CP30 Session hash**. It refuses HALT, Runtime Ledger PENDING, pending security/execution, stale deployment clock and stale store snapshot, before revealing any data. Orders filter by source subject; Claim Intents by source subject AND source recipient_key; vouchers by both and original Store, returning the **original 044 `voucher_dto`**, not a hand-built demo ticket. SQL does not accept asserted wallet address or recipient key.
2. `cp30-backend/tools/g1_private_source_pg_probe.py`: use real original SQL migrations **001–045 (44 files)** in disposable PostgreSQL 17.11; instantiate two **synthetic** original wallet principal/Session/recipient-key pairs, two original-format fund + issue intents and two voucher rows, with isolated identities. Query with the NOLOGIN client role and verify wallet A cannot retrieve B's records. Test invalid session, revocation, mismatched recipient, wrong method, stale/HALT/PENDING source and schema/function ACL. Roll back all synthetic rows and the new candidate SQL. The original migration hashes remain pinned and unchanged.
3. `cp30-backend/g1-export/private-http.mjs`: separate, **unmounted** HTTP adapter for the future original CP30 source host. It accepts only a pinned HTTPS Host, exact GET routes `/v1/my/orders`, `/v1/my/claims`, `/v1/my/vouchers`, an existing original CP30 `__Host-mcpay_c1_session` HTTP-only Cookie, and validates against the existing Sites frontend DTO functions. It hashes the session token with SHA-256 using the exact original `c1.application.digest` contract; it never reads client-provided wallet, recipient key, SQL, credentials or arbitrary routes. Missing, duplicated, expired or unrecognized session fails closed. It never generates payment/voucher success.
4. `private-http.test.mjs`: HTTP fixture tests for wallet A/B routing, no cross-access, strict Origin/Host, no POST/SQL/router fallback, malformed DTO rejection and no raw token reflection. This tests the adapter over local HTTP against a scoped stub, while the independent Python test exercises the genuine original PostgreSQL permissions.

## What is deliberately *not* integrated

- **No** Render Auth Pilot Cookie is accepted as proof of an original CP30 principal.
- **No** private business endpoint has been enabled on the existing Render service; it remains `auth_only`.
- **No** direct DB credentials, public login grants, signer keys, additional Render plan or Auth Pilot schema mutation were introduced.
- **No** original Mac database/Journals, past 7 USDC funds, `PREPARED #3560`, SOURCE pins, wallet signatures or transactions were accessed. Owner-reported `STOP_GATE: PASS` remains the last physical machine evidence; successful backup/full Journal verification and approved recovery are still missing.
- **No** source-only SQL or HTTP fixture can prove actual chain receipt finality, real delivery or safe settlement. G3/G4/G5 remain separate.

## Deployment blocker

The actual original runtime is not accessible to Render. Deploying the private facade to the frozen Mac or copying original beneficiary records to Render would violate recovery and credential custody gates. A safe original-read source host, approved runtime recovery and same-origin principal binding must be verified before live private data is exposed. The separate signed-public-cache and independent-anchor system is not a substitute for original private wallet auth.

## Reproduction

The GitHub Action workflow `.github/workflows/cp31-g2-postgres17.yml` sets fixed local CI-only PGHOST/PGUSER/PGDATABASE and starts a new `postgres:17.11` Docker instance. It runs `g2-disposable-pg17-ci.py` with the integrated source-wallet A/B and source export probes; this candidate adds the new private data source probe. After original 44 SQL migrations and PostgreSQL proof, Node checks exercise signed public envelope and private HTTP adapters. No original data persists; success must include `G2_FRESH_PG17_MIGRATIONS_PASS`, `originalCp30WalletScope=true`, `scopedOriginalOrders=true`, `scopedOriginalClaimIntents=true`, `scopedOriginalVouchers=true`, and `syntheticRowsPersisted=false`.

A successful isolated CI run means **engineering readiness of the private-source interface**, NOT G1 live Render E2E or financial release. Do not merge or deploy this source until independent authorization has reviewed the source/binding lifecycle and live wallet A/B ingress.
