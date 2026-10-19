# MealForward / 留膳 — G1-C Real SQL-to-HTTP Read Integration

Status: separate GitHub Actions disposable test; not a live Render service or approval to recover the frozen original CP30 runtime.

## Why

PR #22 separately proved original CP30 SQL wallet A/B private-read isolation and an HTTP adapter against a stub source. The new G1-C candidate tests the actual chain of trust in one run:

Original 44 pinned CP30 SQL migrations → two synthetic original wallet Sessions with exact SHA-256 hashed raw Cookie values → original fund/issue intents and voucher DTOs → the minimally privileged source's my_items() SQL function → loopback-only SQL transport → the actual Node private-http.mjs adapter → Sites public DTO validators for My Contributions, My Claims, and My Meals.

## Files and restrictions

- cp30-backend/tools/g1_private_http_sql_gate.py: ephemeral localhost-only DB transport, sharing the synthetic fixture's uncommitted PostgreSQL transaction and using the previously reviewed NOLOGIN role.
- cp30-backend/g1-export/live-sql-http-gate.mjs: Node 22 CI caller of the exact private HTTP source adapter; checks A/B isolation, no wallet override, 401/403/405/404 behavior, no business writes and no token reflection.
- cp30-backend/tools/g1_private_source_pg_probe.py: original source Session digests now derive from two disposable base64url cookie strings. Runs the combined HTTP proof while the original SQL fixtures are still visible, then rolls them all back.
- Workflow moves pinned Node 22 setup before the original migration probe. Source pins, migrations and original 045 remain untouched.

Python rejects non-GitHub-Actions, non-approved disposable database name, non-loopback PGHOST. Node rejects non-loopback transport. No real Session, Testnet key, wallet signature, Render database, old 7 USDC token or signed Journal is touched.

## Do not overstate the result

Passing this SQL-to-HTTP CI does not mean the original initialized Mac database has recovered from PREPARED #3560, that its entire signed Journal chain was verified, that Render Auth Pilot SIWE Sessions are original CP30 business principals, or that a genuine owner/recipient visited the website and read real data. A signed public cache is also not a private entitlement source.

## Next real release prerequisite

The latest owner terminal evidence said STOP_GATE PASS on the Mac, but completed protected backup, whole-Journal proof and COMMITTED-to-ACK recovery are still unverified. No operation on the original Mac is allowed from this isolated branch. To unlock original live My Contributions / My Meals, there must be a separately authorized read-only original source, real Session-to-principal binding, safe same-origin access and human wallet A/B browser checks. Unreviewed Render Free or Supabase databases must not be used to host the private financial Journal.

All three original business write authorities remain disabled. Do not deploy Fund, Issue, Lock, Report or Settle by reusing this private GET source candidate.
