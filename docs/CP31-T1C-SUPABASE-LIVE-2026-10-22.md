# MealForward 留膳 · Supabase T1-C staging cloud deployment

Date: 2026-10-22 UTC+8. Owner-approved Supabase organization 3956ray's Org, project ref ketfrukrcuosrqynnsay, URL https://ketfrukrcuosrqynnsay.supabase.co.

## Confirmed live project

- Name: mealforward-t1-staging
- Region: ap-southeast-2 (Sydney)
- Status: ACTIVE_HEALTHY
- PostgreSQL: 17.11
- Project started with no MealForward tables or migrations.
- No old Mac CP30, PREPARED #3560, signed Journal, historical payment, existing Render G0 Auth Pilot records or other Supabase projects were read or mutated.

## Applied migrations — ACTUAL live Supabase database

1. 20261021161130, mealforward_t1c_auth_private_v1, t1-intents/supabase/001_auth_private.sql: private schema mf_cp31_auth_pilot, G0 SIWE challenge/session digests, Auth schema version=1; revoke public Data API roles.
2. 20261021161221, mealforward_t1c_intents_private_v1, t1-intents/supabase/002_intents_private.sql: original T1-C immutable financial Intent / attempt / audit tables, exact Monad Testnet escrow and meal, constraints and audit triggers; revoke public Data API roles.
3. 20261021161321, mealforward_t1c_readonly_nologin_roles_v1, t1-intents/supabase/003_readonly_roles.sql: two independent NOLOGIN database roles, mf_t1c_auth_reader and mf_t1c_intent_reader. The first has only SELECT in the G0 auth private namespace; second has only SELECT in the financial Intent private namespace. No fund/approve/quote-writing role, no DSN password or public identity was provisioned.
4. mealforward_t1c_audit_fk_index_v1, t1-intents/supabase/004_audit_fk_index.sql: index on (intent_id,event_id) for the audit FK query and advisor finding.

All migrations returned success; post-migration queries confirm:
- mf_cp31_auth_pilot.schema_version has exactly one version 1 row;
- user sessions, Intents, wallet attempts, audit events = 0;
- anon cannot select mf_t1c.intents;
- authenticated cannot select mf_cp31_auth_pilot.sessions;
- NOLOGIN auth role has its schema SELECT, but cannot SELECT financial Intents;
- NOLOGIN financial role can SELECT its Intent schema, but cannot SELECT auth sessions or INSERT/UPDATE Intent data;
- the two service roles are not superuser and do not bypass RLS;
- two append-only audit trigger objects exist.
- Supabase security linter reported no findings; performance linter identified an audit FK without index, which was fixed. The remaining unused-index informational notices are expected on zero-row tables and do not justify removal.

## Supabase table-list RLS warning (must not suppress)

Supabase's table enumeration warns **seven** tables have RLS disabled: schema_version, pre_sessions, challenges, sessions, intents, wallet_attempts and audit_events. This warning needs further explicit security review before any Data API exposure.

The present security model depends on unexposed private schemas + revoked anon/authenticated/service_role privileges; SQL permission probes explicitly show anon and authenticated lack access. This is not equivalent to claiming RLS protection. Do NOT automatically expose these schemas in Supabase Data API. Supabase recommended RLS enabling statements are reviewable at:
https://supabase.com/docs/guides/database/postgres/row-level-security

An additional RLS migration can be reviewed for service-account compatibility, but enabling RLS with no appropriate policies could break legitimate SQL access. No RLS change was applied during this turn.

## Deployment limitations

This is a **real durable database schema migration** but **not** a connected Render Node service. The current NOLOGIN reader roles cannot establish PostgreSQL connections. New actual LOGIN credentials, IP/pooler mode, secure database URL/secret custody and principal binding are still unprovisioned. DO NOT hardcode or send DB passwords in chat or GitHub; do not give the frontend access to a postgres password, JWT secret or service_role key. Supabase's direct DB connection on Free may be IPv6-only; review session pooler for IPv4 clients and SSL verification before configuring Render.

Do not create actual FundingQuotes, Approve, Fund, Issue, Lock, Settle or release any real Testnet funds from this schema. T1-B actual harmless Quote EOA control proof was already HUMAN PASS. T1-C simulated per-intent receipt testing remains CI only. Original StoreEscrow does not enforce 180-second onchain settle cooldown (Issue #17).

## Next operator acceptance

Securely establish a non-superuser, least-privilege **LOGIN** path to each private schema, ideally via separately provisioned secrets, then run verified Render/Supabase HTTPS read-only startup with actual database credential cross-scope denial tests. Complete independent durable Journal/high-watermark and failover policy separately. Public funding is still disabled.
