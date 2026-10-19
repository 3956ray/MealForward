# MealForward · G1-A isolated PostgreSQL read / Render staging gate (2026-10-19)

**Scope:** independent synthetic-only integration verification behind the real G0 SIWE protocol. **Not original CP30 data; not a funds backend.**

## Exact source and branch

- Base: PR #19 `codex/mealforward-g1-render-readonly-20261019` at `cbd3972f11de0da8a4ced767e850c527dfe1abda`.
- Candidate: `codex/mealforward-g1a-isolated-pg-read-20261019`.
- Original integrated product baseline remains `codex/mealforward-integrated-mvp`; original Mac CP30 six-service runtime is still stopped, with `STOP_GATE: PASS` evidence but backup/full-Journal verification and `PREPARED #3560` recovery NOT completed.
- Existing Render Auth Pilot `mealforward-cp31-auth-laodao` remains on `26092a0b`, `mode=auth_only`, with the original G0 five wallet human tests already passed. Its existing PostgreSQL schema is not modified by this work.

## What is implemented

- `cp30-backend/g1-export/g1a-isolated-probe-schema.sql`: **one-transaction, fail-closed** separate `mf_g1_probe` namespace; refuses any DB except fresh GitHub Actions `mealforward_g1_read_ci_only` or the explicitly designated Render *test* DB `mealforward_cp31_test_pg`; refuses any original `c1_*` schema or reused staging schema; creates only test-only data tables and a NOLOGIN reader role. Role is restricted from login, superuser, CREATE DATABASE, CREATEROLE, replication and BYPASSRLS. The role receives SELECT-only on its own synthetic tables. The constraints forbid marking a synthetic record FINAL_SUCCEEDED, attaching real transaction hashes, or saving private display codes.
- `cloud-auth/g1a-isolated-probe-read.mjs`: separately configured dedicated DB login; same-connection database/role/CREATE/CP30 and Auth Pilot schema privilege attestation; transaction READ ONLY; server-verified SIWE Session cookie hash -> server-authoritative wallet lookup; parameterized owner filtering. Browser wallet address, Authorization or querystring overrides are forbidden; duplicate session cookies rejected.
- `cloud-auth/g1-readonly-gateway.mjs`: optional, **disabled by default** test-only paths `/__g1_probe/my/orders` and `/__g1_probe/my/vouchers`. No aliases to the original `/v1/my/*`, `/v1/stores`, original private data, blockchain wallets, or business mutations.
- `cloud-auth/server.mjs`: optional G1-A requires `MF_G1A_PROBE_MODE=isolated-synthetic-read-only` **AND** a separate `MF_G1A_READONLY_DATABASE_URL` that is not the normal Auth Pilot `DATABASE_URL`; absent configuration keeps behavior entirely G0 Auth-only.
- CI real PostgreSQL17 runs signed EIP-191 wallet A/B sessions, SQL role grants, no private G0 Session reads, cannot INSERT/UPDATE/DELETE, reject cross-wallet, forged headers, wrong/duplicate Cookie, original CP30 schema co-tenancy, accidental Auth Pilot privilege grant. Original G0 and G1 DTO/HTTP regressions are also run.

## Actual verified evidence

GitHub Actions: https://github.com/3956ray/MealForward/actions/runs/39257166777 — **PASS**:
- 8/8 real disposable PG17 + signed wallet/HTTP/probe cases (including newly added privilege-drift negative cases)
- 30/30 original G0 SIWE, Session/CSRF and optional route tests
- 12/12 public G1 source-to-Sites HTTP contract tests

No actual Render PostgreSQL SQL was executed. No original Postgres, Journals, user keys, browser wallet receipts, or chain funds were accessed. In CI only a dummy test DB/login and freshly generated temporary wallets are used.

## Real Render deployment conditions — NOT YET MET

Render's API refused a second Free PG with `cannot have more than one active free tier database`. Its read-only external SQL connector cannot query the existing free PG because external IP allowlist is empty; **do not expose the database or weaken the firewall** to work around this. Two unrelated Supabase projects are inactive; do not restore or repurpose them.

The alternative is an isolated schema in the existing **Render test-only** PG, with separate, minimally privileged login. This still would NOT establish the physically independent public-cache/anchor required by the original CP30 production trust model.

Safe Render staging procedure, when the requisite DB administration channel and secrets are available privately:

1. Verify the intended Render workspace/service/DB, database expiry, no existing `c1_*` schema and an authenticated backup/recovery point for the Auth Pilot. Do not alter actual Auth Pilot session tables or ownership.
2. Review the pinned SQL file at the exact approved branch SHA and run a dry preflight, checking database name and role creation permissions. If any mismatch, **stop with no mutation**.
3. In an authorized isolated DB administration session, apply only `g1a-isolated-probe-schema.sql` once. It starts with BEGIN and rolls back if the preflight fails. Never run migration 045 or any original CP30 migration against this database.
4. Create `mf_g1_probe_login` with a freshly generated credential, LOGIN and **no** special DB privileges; grant only `mf_g1_probe_reader` membership to it. Store its full connection string **privately in Render Staging environment secrets** as `MF_G1A_READONLY_DATABASE_URL`. Do not paste or print it into ChatGPT, GitHub or logs. Require a separate secret from the existing `DATABASE_URL`.
5. Deploy a **separate** Render G1 staging Web Service from the reviewed branch and bind its own exact HTTPS `PUBLIC_ORIGIN`, G0 auth DB connection, and opt-in synthetic probe environment flag. Do not overwrite the already accepted Auth Pilot service to make a staging test pass.
6. Test G0 wallet A/B and synthetic `/__g1_probe/my/*` routes, verify 401/403/503 guards and no A/B leakage, confirm the old Auth Pilot still authenticates and all old business routes remain 503.
7. On any failure: disable the probe flag or roll back the **separate** staging deployment. Do not delete or change the working G0 auth schema. A test schema cleanup requires a reviewed separate operation; it is not automatic.

If the free Render allocation cannot host the required separately authenticated test service, **keep cloud G1 blocked** and retain passing disposable CI rather than weakening the trust model, using a shared DB owner login, fabricating original business data, or paying without explicit consent.

## Product G1-B prerequisites

These test rows are deliberately synthetic and contain no original Fund, Issue, QR or Settle success. A real Sites integration is only accepted once an approved original CP30 **read-only source** exists, permission is checked against an original wallet principal, and `/v1/stores`, `/v1/ledger`, `/v1/my/orders`, `/v1/my/vouchers` show the authentic ledger, not probe data. That production data source and original Mac `PREPARED #3560` recovery remain separately gated. See existing PRs #18/#19 and Issue #17.

**No human wallet retest is needed for this code-only G1-A gate.**
