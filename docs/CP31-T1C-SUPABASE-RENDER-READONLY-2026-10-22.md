# MealForward · T1-C Supabase → Render READ_ONLY_NO_FUNDS handoff

Status: source-only candidate, real Supabase PostgreSQL 17 runtime NOLOGIN roles provisioned, no server public deployment. 2026-10-22 UTC+8.

## Real project / previous safely deployed state

- Supabase project: ketfrukrcuosrqynnsay / mealforward-t1-staging / PostgreSQL 17.11 / ap-southeast-2.
- Previously applied private mf_cp31_auth_pilot and mf_t1c schemas contain zero Sessions, zero Intents and zero financial wallet attempts.
- Original Mac CP30 Journal with PREPARED #3560, prior Render G0 Auth Pilot, historical Test USDC and T0 StoreEscrow are untouched.

## Actual new Supabase migration

- 005_service_runtime_roles_nologin.sql was applied to this authorized project. The new roles are mf_t1c_auth_runtime (Auth Session/Challenge SQL read/write only) and mf_t1c_intent_runtime (original Intent SELECT-only). Both are explicitly NOLOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOBYPASSRLS.
- Actual SQL permission probes proved auth_runtime has no Intent read/write, intent_runtime has no Session read/write and cannot INSERT or UPDATE Intents. No plaintext password, Data API grant, public financial endpoint or login-credential binding was created.

## Source changes / no-funds UI

- read-only-server.mjs pins production PUBLIC_ORIGIN to one exact onrender.com host, requires T1C_SERVER_MODE=READ_ONLY_NO_FUNDS and distinct Supabase Auth vs Intent PostgreSQL users ending with .ketfrukrcuosrqynnsay. It allows ONLY the correctly assigned ap-southeast-2 shared session pooler on port 5432, prohibits extra DSN query params or other DBs, requires verified TLS certificates and exact current_user names, and checks cross-Schema privilege denials plus refusal of financial INSERT/UPDATE before accepting HTTP.
- Same-origin static /, /ui.css and /ui.mjs are allowlisted with restrictive CSP and no-store cache. The page performs explicit EIP-191 SIWE MetaMask login and only GET /v1/t1/my-intents; no financial or EIP-712 FundingQuote methods exist.
- http-auth-gateway.mjs derives wallet exclusively from its signed-in HttpOnly cookie, then filters private Intent rows by the server Session wallet. No bearer header or client-supplied wallet can override the principal.
- The disposable CI-only 24-request Prepare capability remains impossible on a public onrender.com origin. Its separate read-only test account cannot change an Intent even if it reads the row.

## Evidence

- https://github.com/3956ray/MealForward/actions/runs/39637593816 : 12/12 fresh PG17 + HTTP tests PASS, including a real Node process restart, SIWE A/B, original Intent reads, locked-down static CSP, Supabase project/role/port negative tests and prohibition of broadcast/payment.
- Supabase 005 role SQL migration returned success; on the actual project, each role was verified NOLOGIN and with expected cross-schema grant denials. Prior migrations 001–004 stay unchanged.

## Cloud connection blocker: need project-assigned SESSION POOLER HOST

Supabase official docs, published in October 2026, explicitly warn that the aws-N cluster index cannot be calculated from region. aws-0 is NOT a safe default. Render cannot use Free-plan IPv6-only direct db.project.supabase.co, so this Node service must connect over IPv4 Supavisor session pooler (5432).

To finish without guessing a network endpoint, the user must provide ONLY the non-secret Host field displayed inside this project: Supabase dashboard > Connect > Session pooler > Host. Example format: aws-N-ap-southeast-2.pooler.supabase.com. Never request/share the password, project API secret or the full connection URI.

Once exact host is known, create strong randomly generated distinct PG credentials without printing/storing them in GitHub/chat, enable LOGIN only for these two restricted roles, put the DSNs directly into a NEW Render FREE web service secret environment, autoDeploy off, fixed PUBLIC_ORIGIN, PORT 10000, READ_ONLY_NO_FUNDS. Verify real HTTPS status, login A/B and per-wallet empty My Intents; no Quote signing, Approve, Fund, Issue or Settle.

Do not enable RLS for the seven private tables automatically: they remain outside the Supabase Data API and anon/authenticated table access was explicitly revoked and tested. A future RLS policy migration requires independent role compatibility review, since switching it on without policies would block runtime sessions. Original StoreEscrow Issue #17 onchain settle cooldown remains unresolved.