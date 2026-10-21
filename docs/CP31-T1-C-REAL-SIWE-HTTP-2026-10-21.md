# MealForward T1-C — genuine G0 SIWE to durable funding-intent HTTP

Date: 2026-10-21 (UTC+8). Source-only staging candidate, not deployed as a financial service.

## Integration sources

This branch imports the EXACT audited Git blobs of existing CP31 G0 Auth Pilot:
- t1-intents/auth/core.mjs (blob ea6ebbecdf0c7580cdb4cbe27bfb79860443d8d7)
- t1-intents/auth/siwe.mjs (blob 54be9ab629df1307c725d334b0be5524f1d3627e)
- t1-intents/auth/db.mjs (blob 3fa2e4bd4aa2ee215a3cc12707e52e883c882f1a)

The same-origin gateway preserves real EIP-191 SIWE nonce, origin, chain 10143, session expiry/revocation, HttpOnly Secure SameSite Strict Cookie and stored CSRF digest. A testnet session does not become a principal in the frozen original CP30 Mac ledger.

The private GET /v1/t1/intents/:uuid derives wallet entitlement ONLY from an authenticated hashed cookie stored in G0 PostgreSQL, then uses a separate restricted Intent service PostgreSQL role. Caller-supplied wallet strings, duplicate cookies, cross-site origin, unexpected query/JSON fields, invalid CSRF, other wallets' UUIDs and revoked sessions are rejected. All private results have Cache-Control private/no-store.

The disposable-only POST /v1/t1/intents/prepare is constructed only with GitHub Actions, exact CI datasource, fixed CI-specific environment gates AND loopback HTTP origin. It exercises 24-way actual HTTP idempotency, but cannot exist on a public onrender.com origin. Approve, Fund, Quote signing, refund and settlement routes are absent.

## Real least-privilege PG17.11 roles

In the disposable test, G0 auth and funding-intents are contained in distinct schemas and accessed via **different restricted DB LOGIN users**:
- mf_t1c_ci_auth can operate the SIWE Challenges/Sessions but cannot SELECT funds Intents.
- mf_t1c_ci_intent can operate the immutable Intents and append audit rows, but cannot read auth Sessions.
- Both are nonsuperuser, no DDL, no BYPASSRLS, no CREATE, no DELETE/TRUNCATE, no cross-schema reads.

These are synthetic CI-only credentials and must never be used on Render or Supabase. This is app-role isolation, not protection from a privileged DB administrator, whole-instance restore or a malicious common hosting operator.

## Cold startup READ_ONLY_NO_FUNDS server

t1-intents/read-only-server.mjs starts with fixed PUBLIC_ORIGIN (HTTPS Render hostname only, or CI loopback), fixed PORT, distinct T1C_AUTH_DB_URL and T1C_INTENT_DB_URL, and T1C_SERVER_MODE=READ_ONLY_NO_FUNDS. No migrations run at startup. Boot validates non-superuser separate PG principals, both existing schemas and **actual permission denials** in the opposite schemas before opening an HTTP listener. Any dangerous mode, missing schema, unexpectedly broad DB credential or DB error fails closed without disclosing DSN or wallet cookies.

The only non-auth business APIs in this mode:
- GET /v1/t1/status — READY_NO_FUNDS if fresh independent storage is accessible; no funding-enabled claim.
- GET /v1/t1/intents/:id — original cookie-bound private state for the authenticated new testnet session.
- POST /v1/t1/intents/prepare — 503 FUNDING_DISABLED.
- Every Fund/Approve/Quote signature path — blocked.

## Evidence

Source/real SIWE HTTP PG17 role proof: https://github.com/3956ray/MealForward/actions/runs/39619459977 (9/9).
Full second Node process restart / existing cookie+Intent read: https://github.com/3956ray/MealForward/actions/runs/39620433047 (11/11).

Everything ran in disposable GitHub Actions PG17 with temporary EIP-191 wallets; not live Render database or Monad funds.

## What blocks deployment and actual user funding

Render has one active Free PostgreSQL allocated to the already-accepted Auth Pilot, and a second Free PG was rejected earlier. Supabase Free organization has two unrelated projects (FanPool and ButtonPost); neither may be repurposed. No separate T1-C cloud PG or independent durable signed Journal/high-watermark anchor has been provisioned. The Render Auth Pilot has not been modified or reconfigured; the old Mac CP30 PREPARED #3560 and all historical assets are frozen.

No real FundingQuote has been signed, no donor identity/wallet separated from Quote Authority, no actual fund transaction/receipt or money delta has been tested, and original StoreEscrow still does not enforce the on-chain 180-second settlement delay (Issue #17).

Next meaningful deployment requires a separately approved NEW dedicated PostgreSQL17 environment and immutable evidence/anchor under an agreed plan, after which the readonly HTTPS service and human two-wallet private read may be accepted. Do not expose funding operations from this draft.
