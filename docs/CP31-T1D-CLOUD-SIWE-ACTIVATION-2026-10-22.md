# MealForward 留膳 — T1-D isolated cloud handoff

As of 2026-10-22 (UTC+8). Testnet only. Source of truth: GitHub branch codex/mealforward-t1d-render-isolated-20261022.

## Release stages

| Stage | Stage env | Database | SIWE wallet login | Approve / Fund |
|---|---|---|---|---|
| SETUP_ONLY | T1D_DEPLOYMENT_STAGE=SETUP_ONLY | None | Disabled | Disabled |
| SIWE_ONLY | T1D_DEPLOYMENT_STAGE=SIWE_ONLY | Two NEW isolated T1-D roles | New private T1-D schema only | Disabled |
| FUNDING | T1D_DEPLOYMENT_STAGE=FUNDING | Two NEW isolated T1-D roles | New private T1-D schema only | Human wallet confirmed, one 7 Test USDC, not yet accepted |

SETUP_ONLY uses T1C_SERVER_MODE=SETUP_ONLY_NO_FUNDS. SIWE_ONLY uses T1C_SERVER_MODE=T1D_SIWE_READ_ONLY. FUNDING uses T1C_SERVER_MODE=TESTNET_SINGLE_SEVEN_USDC_FUND and is deliberately a later release gate. The latter is NOT approved merely because setup or the CI is green.

## Immutable scope

- Monad Testnet 10143; original T0 escrow 0xcF0C8827C8610EEFF1ecbd9719E559d805FafE58.
- Circle Test USDC 0x534b2f3A21130d7a60830c2Df862319e593943A3, one 7 Test USDC meal.
- Quote Authority / one first-test payer: 0xcc5C1ce846c0302ab27a4811cf2e0e6fc7282952.
- Original T1-C live Render stays separate; Mac CP30 PREPARED #3560 is frozen.
- NEW T1-D Supabase roles: mf_t1d_auth_runtime and mf_t1d_fund_runtime.
- Staging project ketfrukrcuosrqynnsay, private migrations 001–008 already applied.
- NEW T1-D Render Free, Singapore, autoDeploy OFF: https://mealforward-t1d-funding-laodao.onrender.com
- Render dashboard: https://dashboard.render.com/web/srv-dbd0nl67bikc73a5grh0/env

## Mac-only role activation, after source review

This is a gated **owner action**, not a ChatGPT/CI/Render action. The original Supabase admin database password stays ONLY on your Mac. Do not post the full DSN/password, screenshots or private env file in chat.

Use macOS Terminal (zsh); if this clone directory already exists, update it to the exact reviewed branch instead of cloning over it:

    cd ~/Downloads
    git clone --single-branch --branch codex/mealforward-t1d-render-isolated-20261022 https://github.com/3956ray/MealForward.git MealForward-T1D-owner
    cd ~/Downloads/MealForward-T1D-owner/t1-intents
    npm install --ignore-scripts --no-audit --no-fund
    node --check operator-activate-t1d.mjs

Then:

    read -s 'DB_PASSWORD?输入 Supabase Admin 数据库密码: '
    echo
    ENCODED=$(DB_PASSWORD="$DB_PASSWORD" node -e 'process.stdout.write(encodeURIComponent(process.env.DB_PASSWORD).replace(/\*/g,"%2A").replace(/!/g,"%21"))')
    unset DB_PASSWORD
    export T1D_SUPABASE_ADMIN_DSN="postgresql://postgres.ketfrukrcuosrqynnsay:$ENCODED@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres"
    unset ENCODED
    node operator-activate-t1d.mjs
    unset T1D_SUPABASE_ADMIN_DSN

Type exactly ACTIVATE T1D TWO ROLES into the local prompt.

The tool verifies CA-pinned full TLS/host identity, exact project/admin user, both new roles NOLOGIN and non-superuser, denied cross-schema access, limited Intent/Quote grants and empty Sessions/Intents/Attempts/Quotes. It then generates two different 80-character random hex passwords and applies a single PostgreSQL transaction to these TWO new roles only.

The output success marker is T1D_OWNER_TWO_ROLE_LOGIN_READY. The tool NEVER prints credentials in terminal; they are saved for short-lived handoff in a private chmod 0600 file under:

    ~/Library/Application Support/MealForward/t1d-render-<random>.env

The local file contains ONLY T1C_AUTH_DB_URL and T1C_INTENT_DB_URL for the NEW T1-D role identities. Copy these values into the NEW Render Environment manually. NEVER use the old T1-C credentials.

If the tool reports T1D_COMMIT_OUTCOME_UNKNOWN_DO_NOT_RETRY, **do not rerun it**. Keep the private local file and check role state before any repair; the database commit outcome may be uncertain.

## After local activation: staged Render environment

Use the original NEW Render service above. Set the two private DSNs from the local file and these public config flags:

    PUBLIC_ORIGIN=https://mealforward-t1d-funding-laodao.onrender.com
    PORT=10000
    T1D_DEPLOYMENT_STAGE=SIWE_ONLY
    T1C_SERVER_MODE=T1D_SIWE_READ_ONLY
    T1C_FUNDING_ENABLED=false
    T1C_TESTNET_FUND_SCOPE=DISABLED
    T1C_QUOTE_SIGNER_ENABLED=false

The inherited env key prefix T1C_ is historical; its database usernames MUST be mf_t1d_auth_runtime and mf_t1d_fund_runtime. Do not set any admin DB secret or signing private key on Render.

The source-pinned Supabase Root CA in t1-intents/trust/supabase-root-2021-ca.pem validates the exact session pooler hostname and certificate. NEVER disable TLS verification.

Deployment must fail closed if new roles, permissions or immutable signed Quote store are missing. In SIWE_ONLY the public authenticated HTTP status must be READY_NO_FUNDS with mode T1D_ISOLATED_SIWE_READ_ONLY_GATE. The human may verify SIWE / Logout / private My Intents (initially empty). No financial POST is routed.

After the two DSNs are configured and CI + public HTTP + actual wallet A/B acceptance are independently proven, review a separate one-meal funding release. No automatic wallet transaction, no re-signing an UNKNOWN operation, no settlement before StoreEscrow Issue #17 is addressed.

After successful Render secret entry and role acceptance, remove the one-time private env file from the Mac. Never share its contents with an assistant or commit it to GitHub.

## Acceptance evidence checklist

- Exact source and local-only operator script CI (including bad-host/extra-privilege/CI-deny negative tests).
- New staging database roles still NOLOGIN until owner action.
- 14 public GET/HEAD/POST setup-only checks all require funds and Auth closed.
- Disposable Postgres17.11 original 006/007/008 SQL + wallet A/B SIWE test, CSRF and private Intent reads, fund/quote/reserve all blocked in SIWE_ONLY.
- New Render source head + pinned origin + no unexpected T1-C deployment.
- Real user SIWE identity only after owner credentials; testnet Approve/Fund strictly separate explicit MetaMask confirmations, exact original nonce/Tx receipt and USDC delta proof.
