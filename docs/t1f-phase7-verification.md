# Phase7 verification record

This record separates source acceptance from live activation and human-wallet acceptance. Current source work is not a claim of Issue execution.

## Verified source slices

| Slice | Revision | Evidence | Independent review |
|---|---|---|---|
| Atomic SQL capability/store | d1473a9 | FreshPG17.11 16 groups; main rerun EXIT0 | Full task plus exact-function-identity fix PASS |
| Execution service/HTTP/config | 1848a85 | 22 targeted tests; actualHTTP+freshPG8 groups | Full task plus timeout fix PASS |
| Collector history / Issuer client | 0938dfa | 214 nonPG / 61 WalletV2; typecheck and deterministic builds; synthetic browser PASS | Task review pending |
| Whole Phase7 change | d0fd6e6 | CI40401826273 all6 jobs PASS:304 tests +42 PG groups | Whole-phase review pending |

Database fixtures use synthetic verification attestations and RPC results. The HTTP lifecycle uses the actual gateway, capability store and exact009-017 migrations in a disposable database. It does not exercise a live SIWE session, real MetaMask or Monad transaction.

Key assertions: concurrent consumption creates one linked successor; failure rolls back all rows; only first committed prepare returns wallet bytes; lost response and expiry preserve recovery; bind verifies full transaction identity; reconcile verifies canonical receipt/events/operation/accounting; original Claim/Consent/Fund/events/review/slot remain byte-equivalent; collector reads survive while writes stay closed.

## Live baseline

At phase start Render collector remained6f4710c / dep-dbfnnc59el5s73fumd50. Formal round79e1b5e5-ba34-4387-805b-e2eb7d00300d has passed human Owner/Donor collection and durable2/2 verification, but is expired. This stage has not applied017, activated execution credentials, created a fresh live round, reserved a successor, or sent a transaction. Final read-only recheck and exact CI links will be added before delivery.

## Reproduction commands

From `t1-intents`, targeted execution checks:

```sh
node --test t1f-execution-service.test.mjs t1f-execution-http.test.mjs t1e-claim-http.test.mjs t1e-claim-setup.test.mjs
```

Database suites require a separately initialized empty PostgreSQL17.11 instance for EACH command, bound only to127.0.0.1:15439 with database/user postgres. Never point these scripts at a live database. The script guards require `MF_T1F_PHASE6_DISPOSABLE_ONLY=ack-fresh-phase6-pg17`, `PGHOST=127.0.0.1`, `PGPORT=15439`, `PGDATABASE=postgres`, `PGUSER=postgres`, and no DATABASE_URL. Run `node t1f-execution-phase7.ci.mjs`; then tear down that owned fixture. Initialize another empty fixture for `node t1f-execution-http-phase7.ci.mjs`, additionally setting `MF_T1F_EXECUTION_HTTP_DISPOSABLE_ONLY=ack-fresh-execution-http-pg17`. Each suite applies its exact migrations and uses only synthetic data.

Existing collector regression uses its own fresh instance and `node t1f-approval-phase6.ci.mjs`. The CI workflow provisions these separately, so migration fixtures never share populated state.

Read-only hosted preflight at2026-10-27 04:56 UTC+8: PostgreSQL17.11; rounds1, approvals2; successor release/operation/event0/0/0; no mf_t1f_execution schema or execution roles. Collector owner/runtime remain NOLOGIN/NOINHERIT and login remains NOINHERIT; none has superuser/CREATEROLE/BYPASSRLS. Original/successor tables owned bypostgres, collector tables bymf_t1f_approval_owner. No live mutation performed.

Additional source-phase baseline: six-table original fingerprint `c0dd34d6df6ad76a43f79bc435cd0b4f`, computed as MD5 of a JSONB object containing claims,consents,funds,events,reviews,slots, each array ordered by to_jsonb(row)::text. It includes the review/hold tables and is a different scope from the earlier four-table `01556b...` fingerprint; do not compare the two hashes. Only the hash was returned, not private row contents. Final same-query recheck pending.

Exact remote CI: https://github.com/3956ray/MealForward/actions/runs/40401826273 at d0fd6e6613facd1dca3131ca02dfe5a694d1ad1d, six jobs SUCCESS. Test totals61 WalletV2+214 nonPG+16 legacycore+13 legacyHTTP=304; separate freshPG groups18 collector+16 execution+8 executionHTTP=42. Typecheck and rebuild diff gatesPASS.

Main CUA browser on frozen0938dfa source: explicit fake SIWE/prepare/send-refusal/reload recovery; prepare/send disabled after refusal and after reload, originalUNKNOWN preserved;390px viewport client/scroll375/375; console errors/warnings empty. Pre-final cosmetic/connection addition, same controller path also traversed fake send, intentional bind failure, same-hashretry and canonicalISSUED; this is synthetic evidence only. Screenshots in docs/evidence/phase7-synthetic-desktop.png and phase7-synthetic-mobile.png.
