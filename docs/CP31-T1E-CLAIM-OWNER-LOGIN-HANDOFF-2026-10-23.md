# T1-E 领取服务 · 2026-10-23 owner activation handoff

## Confirmed state

- Exact source branch: `codex/mealforward-t1e-recipient-claim-http-20261023`.
- Independent Render service: https://mealforward-t1e-claim-laodao.onrender.com/ ; dashboard https://dashboard.render.com/web/srv-dbdgstivcj2c73fnqcc0/env.
- Live deployment starts as `T1E_SAFE_SETUP_ONLY_READY`, **no DB credentials, login, Claim, Issue, Fund, Settle**.
- Separate earlier role proof: https://mealforward-t1e-role-proof-laodao.onrender.com ; the human wallet-proof tests have both passed:
  - Issuer `0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3`.
  - Recipient `0x2539fefe77a5ce4d09d2225c2e8a7517b22b9135`.
  These EIP-191 proofs are **not sessions or claims**.
- Supabase isolated staging project `ketfrukrcuosrqynnsay`: 009 Claim, 010 Auth and 011 bounded consent-recovery migrations applied; 1 original `FUNDED` 7 Test USDC intent, 0 recipient claims/sessions; `mf_t1e_auth_runtime` and `mf_t1e_claim_runtime` are each **NOLOGIN**, not superusers, without bypass RLS.
- CI tests: exact 009/010/011 on fresh PostgreSQL17, atomic first Claim, same UUID/nonces and capped 3 consent windows, isolated Auth and Claim roles, SIWE/CSRF HTTP, signed EIP-712 V4 parity, wrong-wallet and no-transaction negative tests.
- T1-D original funding remains **completed**, NOT to be repeated. T0 7 Test USDC remains escrowed. Frozen original Mac CP30 `PREPARED #3560` untouched.

## Action that ONLY the Mac owner can perform

After pulling the reviewed branch, from its `t1-intents` directory:

```zsh
git fetch origin
git switch codex/mealforward-t1e-recipient-claim-http-20261023
cd t1-intents
npm install --ignore-scripts --no-audit --no-fund
```

Only if the working copy is the same reviewed commit as the latest GitHub branch, and the original private Supabase staging administrator DSN is already available locally, assign it **privately in that shell** to `T1E_SUPABASE_ADMIN_DSN`. Never paste the DSN, its password, a generated `.env` file or signatures into a chat, GitHub issue, browser console or screenshot.

```zsh
node operator-activate-t1e.mjs
```

The program refuses Render, CI and non-macOS, requires the exact staging PG17 session-pooler admin principal, source-pinned certificate, empty original Claim and Auth schema, original 1 FUNDED / 2 confirmed attempts, distinct least-privilege NOLOGIN roles, and a typed owner confirmation:

`ACTIVATE T1E TWO ROLES`

It creates two unrelated 80-character random passwords stored only in an `0600` owner-private file at `~/Library/Application Support/MealForward/t1e-render-<random>.env`. The two resulting variables are `T1E_AUTH_DB_URL` and `T1E_CLAIM_DB_URL`.

**Never rerun if COMMIT may have occurred**, even if the terminal disconnected. Keep the private `0600` file and reconcile server roles first. Don't use the old T1-C or T1-D URLs.

Next, paste the two values privately into **the new separate T1-E Claim Render service only**, not into the role-proof or T1-D service:

https://dashboard.render.com/web/srv-dbdgstivcj2c73fnqcc0/env

Only after the two real T1-E roles become LOGIN, transition the *new Claim service* from `SETUP_ONLY` to **`CLAIM_SIWE_ONLY`** with:

```text
PUBLIC_ORIGIN=https://mealforward-t1e-claim-laodao.onrender.com
PORT=10000
T1E_DEPLOYMENT_STAGE=CLAIM_SIWE_ONLY
T1E_CLAIM_WRITES_ENABLED=false
T1E_WALLET_TX_ENABLED=false
T1E_SETTLEMENT_ENABLED=false
```

Do not enable `CLAIM_CONSENT` until the actual public same-origin SIWE login for both role wallets has been independently verified, including private session 401 denial, Issuer vs Recipient scope, CSRF, post-restart cookie, and no Claim writes. Never allow `issue()`, `fund()`, `settle()`, or `markHandover()` in either current stage.

**First human test after the SIWE_ONLY cutover:** open the *new Claim service* in Chrome, connect the already verified Recipient `0x2539...b9135`, sign a normal T1-E SIWE (EIP-191) login, read private `/v1/t1e/me` and empty `/v1/t1e/claim/me`. Then separately log in with the verified Issuer and check its own role and sanitized readiness. **No Claim or onchain transaction yet.**

### Review guard

This new staged work is not production-ready: original T0 `issue` does not enforce recipient authorization onchain, and `settle` still lacks an enforced 180-second cooldown. The first 7 Test USDC remains escrowed; no actual voucher or merchant payment may be claimed.
