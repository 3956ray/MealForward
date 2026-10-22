# MealForward T1-C — owner-only Supabase role activation and Render read-only go-live

**Status (2026-10-22):** user-approved Free Supabase project is ready; new FREE Render web service exists, but finance/auth role credentials are **NOT configured** and the process correctly refuses to listen. This is NOT a live business API or payment product.

## Existing fixed cloud resources

- Supabase: `mealforward-t1-staging`, project `ketfrukrcuosrqynnsay`, PostgreSQL 17.11.
- Supabase Session pooler CONFIRMED by the owner: `aws-0-ap-southeast-2.pooler.supabase.com:5432`, database `postgres`.
- Render NEW Web Service: `mealforward-t1c-readonly-laodao`, ID `srv-dbclmetg1s2s73dnl5h0`, region Singapore, FREE, autoDeploy disabled.
- Render URL: https://mealforward-t1c-readonly-laodao.onrender.com
- Fixed non-secret Render env already set: `PUBLIC_ORIGIN` is the Render URL, `T1C_SERVER_MODE=READ_ONLY_NO_FUNDS`, `T1C_FUNDING_ENABLED=false`, `T1C_QUOTE_SIGNER_ENABLED=false`, `PORT=10000`.
- Supabase schema and role grants: `mf_cp31_auth_pilot` for G0 EIP-191 Session, `mf_t1c` for isolated Testnet immutable Intent. `mf_t1c_auth_runtime` and `mf_t1c_intent_runtime` are distinct low-privilege **NOLOGIN** roles.
- NO real Sessions, Intents, Funded transactions, user Quote signatures or balances exist in the new cloud DB.

## Security block: do not share any DB credentials with ChatGPT

An attempted automatic service-to-service credential transfer was blocked by the platform security check. This is respected; it was not circumvented. Post-block Supabase roles were independently confirmed NOLOGIN. The new Render service's initial deploy fails closed (`T1_C_READONLY_BOOT_FAIL_CLOSED`) because its secret connection strings are not configured. The source code/Node 22 build itself was successful.

**Only the owner** should activate LOGIN and enter credentials directly in their own Supabase/Render environments, without pasting secrets into chat or GitHub. The committed local operator tool uses `crypto.randomBytes(40)` to generate 80-character random hexadecimal passwords; does NOT run in Render, CI, or noninteractive mode; checks exact approved pooler, admin role and DB grants; and prints credentials once to the owner's local interactive terminal. It does not store secrets in a file or Supabase SQL Editor history.

### Safe one-time operator procedure (Mac / zsh)

1. Clone/update repository and checkout `codex/mealforward-t1c-supabase-render-readonly-20261022`.
2. In `t1-intents/`, install dependencies with `npm install --ignore-scripts --no-audit --no-fund` (Node 22).
3. Go to the **same Supabase project's** Dashboard > Connect > Session pooler and copy the full **postgres ADMIN** connection URI locally. Expected username is `postgres.ketfrukrcuosrqynnsay`, host `aws-0-ap-southeast-2.pooler.supabase.com`, port `5432`, database `postgres`. Do NOT paste this URI in chat. If you previously selected Supabase's Vercel integration dialog, exit that dialog; this service uses Render, not Vercel.
4. In your Mac zsh terminal, execute the following command. It requests the URI with echo disabled, so the password is not written into shell history:

```zsh
read -s 'T1C_SUPABASE_ADMIN_DSN?Paste Supabase ADMIN Session pooler URL (hidden): '
echo
export T1C_SUPABASE_ADMIN_DSN
node operator-activate-readonly.mjs
unset T1C_SUPABASE_ADMIN_DSN
```

5. Type `ACTIVATE READONLY` at the script's explicit confirmation. If successful, it will print `T1C_TWO_ROLE_LOGIN_READY` and two private env strings: `T1C_AUTH_DB_URL` and `T1C_INTENT_DB_URL`. Copy **only** these strings directly into the new Render service's `Environment` dashboard. **Never** put them in a chat message, GitHub issue, screenshot, public Vercel project, or frontend build.
6. Verify the other already-fixed Render env keys are unchanged, set both new URLs as Secret values, and redeploy this **NEW** Render FREE service only. Render environment updates may trigger a deploy themselves.
7. Once Render reaches `live`, open the new Render URL and perform **read-only only**: `Check service` → MetaMask Monad Testnet 10143 Login (EIP-191) → My Intents. Expected real new database: `0` records; if not, stop and inspect source. Repeat with another disposable wallet for session/cross-wallet checks. The original T0/T1-B steps do not need repeating.
8. Never post the secret output or admin connection string. Report only non-secret success/failure status, HTTP error codes and stage label (e.g. `T1_C_READONLY_BOOT_FAIL_CLOSED_ROLE_CHECK`).

### Failure and key custody

If password activation succeeds but the terminal closes before copying both secrets, do not try to guess or expose them. The owner can revert only these two brand-new runtime roles to NOLOGIN in a privileged Supabase SQL Editor, verify revoked login, and rerun the local activation tool to regenerate fresh credentials. Do not modify `postgres` or unrelated Supabase auth keys. After successful Render config, rotate through a fresh owner-controlled process if credentials were ever exposed.

## Release gating / audit

- The test-only `POST /v1/t1/intents/prepare` is entirely inaccessible on a public Render origin; the new live server can only read authenticated Intents and run G0 SIWE login/logout. `eth_sendTransaction`, ERC-20 Approve, real FundingQuote, Fund, Issue, Lock, Settle and private Journal writes are all absent.
- Source CI: https://github.com/3956ray/MealForward/actions/runs/39702052648 (fresh PG17, 14+ tests with public no-credentials smoke, owner setup deny tests and real second-process restart; confirm exact check totals from the workflow log).
- The newly created Supabase project still has disabled RLS on private tables; anon/authenticated grants are revoked, schemas remain unexposed. Never expose these schemas via the Supabase Data API without an independently reviewed RLS policy and service-role compatibility review.
- Freeze original Mac CP30 `PREPARED #3560`, old 7 USDC, old Journal/keys, original Auth Pilot and all historical user data. Never merge this branch into main or switch on funding merely because the HTTP service is live.
- Original StoreEscrow lacks onchain forced 180-second settle cooldown (issue #17). No financial money workflow has been approved.

## Debug, with no secrets

- If Render build is successful but service exits `T1_C_READONLY_BOOT_FAIL_CLOSED`, this is the expected current condition before credentials.
- After configuring roles and Render env, use `node t1-intents/cloud-readonly-smoke.mjs` from a trusted computer to check exactly seven public endpoints: READY_NO_FUNDS, unauthenticated deny, financial POST deny and old original CP30 deny. This tool does not send credentials or sign a transaction.
- `T1C_ONLY_INTERACTIVE_OWNER_TERMINAL` means the credential setup tool refused a CI/headless/cloud process, which is correct.
- Check both custom PostgreSQL LOGIN roles remain neither SUPERUSER nor BYPASSRLS and have zero cross-Schema rights.

Handoff source: GitHub PR #32 (this branch).
## 2026-10-22 — TLS_CA_UNVERIFIED diagnosed and safely corrected

The owner successfully unpacked the V2 operator helper on macOS Node 24.21.0 and ran the read-only private database diagnostic. It returned `T1C_DIAGNOSTIC_FAILED_CONNECT_TLS_TLS_CA_UNVERIFIED` before authentication and before any credential role change. Live Supabase SQL confirmed both service roles remain NOLOGIN and business tables remain empty.

**Cause verified against current official Supabase docs:** Supavisor Session Pooler TLS is signed by Supabase's private 2021 CA, not a common public root. The original Node client had `ssl:{rejectUnauthorized:true,servername:HOST}` but did not add the Supabase root CA. This does not show the user's DB password is invalid. NEVER disable verification, skip hostname checks, set `NODE_TLS_REJECT_UNAUTHORIZED=0` or weaken sslmode.

Official documentation: https://supabase.com/docs/guides/database/psql ; https://supabase.com/docs/guides/platform/ssl-enforcement . Download the exact project's public trust certificate from Supabase Dashboard > Database Settings > SSL Configuration > Download Certificate. Normally it is `prod-ca-2021.crt`.

### Use existing Mac V2 diagnostic WITHOUT another ZIP

Run commands locally on the owner's Mac; never paste outputted secrets here:

```zsh
cd ~/Downloads/MealForward-T1C-readonly-operator
ls -lh "$HOME/Downloads/prod-ca-2021.crt"
NODE_EXTRA_CA_CERTS="$HOME/Downloads/prod-ca-2021.crt" node -e 'const n=require("node:tls").getCACertificates("extra").length; console.log("CA certificates loaded:",n); if(n<1)process.exit(1)'
```

Then re-enter the DB password without shell-history leakage and run V2:

```zsh
read -s 'DB_PASSWORD?Supabase database password (hidden): '
echo
ENCODED=$(DB_PASSWORD="$DB_PASSWORD" node -e 'process.stdout.write(encodeURIComponent(process.env.DB_PASSWORD).replace(/\*/g, "%2A"))')
unset DB_PASSWORD
export T1C_SUPABASE_ADMIN_DSN="postgresql://postgres.ketfrukrcuosrqynnsay:${ENCODED}@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres"
unset ENCODED
NODE_EXTRA_CA_CERTS="$HOME/Downloads/prod-ca-2021.crt" node operator-diagnose-readonly.mjs
unset T1C_SUPABASE_ADMIN_DSN
```

`NODE_EXTRA_CA_CERTS` is read at Node PROCESS START and extends default certificate trust. The V2 script does not set an explicit `ssl.ca`, so this verified CA is used without modifying/re-downloading the V2 files. Only after three PASS diagnostics should the owner rerun password entry and invoke `NODE_EXTRA_CA_CERTS="..." node operator-activate-readonly.mjs`.

### Render needs the same public CA trust anchor

New `t1-intents/supabase-tls.mjs` requires the **dashboard-download Supabase CA**, base64-encoded without newlines, under Render Environment variable `T1C_SUPABASE_CA_B64`. It validates PEM structure and certificate dates, keeps `rejectUnauthorized=true`, pins the verified pooler DNS hostname, and fails closed if missing/tampered. This file is PUBLIC TRUST data, not a password, but must only come from the project's official dashboard.

On the owner's Mac:

```zsh
base64 < "$HOME/Downloads/prod-ca-2021.crt" | tr -d '\n' | pbcopy
```

Paste the clipboard contents into **NEW Render Free service** `srv-dbclmetg1s2s73dnl5h0` > Environment > new variable `T1C_SUPABASE_CA_B64` (not into Vercel/ChatGPT/GitHub). The other two Render environment variables remain private credentials pasted owner-only. Do not configure the CA from arbitrary blog/GitHub snippets or submit it as a user input to the website.

The original Mac CP30, old Auth Pilot, existing Supabase unrelated projects and Testnet money remain untouched. There is still no enabled FundingQuote/Approve/Fund API.