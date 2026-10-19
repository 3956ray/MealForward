# MealForward CP31 G0 → G1 — data truth gate (2026-10-17, UTC+8)

## Scope and verified facts

**G0 browser sign-in:** The project owner personally reported PASS for five cases:
MetaMask current account, refresh, logout, wallet switch (no prior role leakage),
and rejection on incorrect network. This is user-reported acceptance, not an
independently recorded browser trace. The separate Render Auth Pilot remains
**identity-only**, without historical CP30 stores, funds, claims or vouchers.

**G0 nonce/security:** The existing `cloud-auth/core.test.mjs` suite separately
exercises one-use SIWE challenge, replay refusal, expiration, CSRF and forged
cookie rejection using an in-memory store; `siwe.test.mjs` covers real
ephemeral EIP-191 signatures. These are automated tests, not live public
browser replay attacks. Never ask for the user's signed SIWE payload or cookies.

**G1 read contracts:** CP30 `application.py` dispatches confirmed live
business calls into `LiveGateway.handle` and its `READS` set. Current
`044-live-multi-meal.sql` provides source definitions for `public_stores`,
`public_meals`, `public_ledger`, `my_orders`, `my_claims`, and
`my_vouchers`. `045` hotfix parity exists on a **separate** readiness
branch and is not authorized for the original live PG.

## Completed code gate (not a live integration acceptance)

- `sites-frontend/dist/g1-read-contract.mjs`: fail-closed shape, immutable
  store/meal IDs, menu versions, time windows, zero/nonzero base-unit monetary
  fields, bucket conservation, ownership-related intent types, voucher states,
  unique record IDs and public-private field separation. No invented data.
- `sites-frontend/dist/live-api.mjs`: production reads must pass the G1 DTO
  assertions **before** rendering; no external wallets, funding, issue,
  handover or settlement call is initiated by these assertions.
- Existing incomplete mock DTOs can be used only in explicitly marked,
  isolated Node tests. The shipped browser `liveApi=createLiveApi()` has
  strict read validation by default.
- `sites-frontend/dist/app.js`: a failed partial menu refresh clears earlier
  store listings and quantities; a stale public meal must not remain actionable.
- `cp30-backend/src/c1/g1_read_contract_checks.py`: offline route →
  read-only ledger flag checks and source predicates for wallet subject /
  recipient-key read scope. Static SQL predicates do **not** replace a live
  PostgreSQL role/RLS proof.

## Remaining release gates

| Gate | Evidence still needed | Current release |
|---|---|---|
| G0 | Optional live expired-challenge / replay denial capture; five browser UX checks user-reported PASS | Identity pilot only |
| G1 | Approved private read-only source, original CP30 identity binding, true /v1/stores, /v1/ledger, /v1/my/orders, /v1/my/vouchers responses; wallet A/B isolation and refreshed views | **NOT CONNECTED** |
| G2 | Fresh, independently disposable PostgreSQL 17, source migrations 001–045, role and SQL parity tests | **NOT VERIFIED** |
| G3 | Immutable/durable journal/PG recovery, wallet signer isolation, source pins and explicit restart approval | **BLOCKED** |
| G4 | One real finalized fund and issue, original order/claim recovery | **BLOCKED** |
| G5 | Real Check→Lock→Report→Settle with owner payout/receipt | **BLOCKED** |
| G6 | All security/browser/real E2E and production review | **BLOCKED** |

**No** copy, reset, migration, restart, replay or signing against the original
CP30 runtime `~/.mf-cp30-20261013`; do not infer that G0 sessions directly
confer original CP30 spender, recipient, issuer or merchant authority. The
isolated Free Render PG is for G0 only, not a replica of the original records.

## Exact next action after this PR

1. Review G1 source validation in isolation and keep the Auth Pilot unchanged.
2. Once the original CP30 runtime is independently safe/readable, obtain
   sanitized *read-only* route status/count/fingerprint evidence from the
   approved environment. Do not send cookies, signatures, private voucher
   codes, raw Journal frames or database credentials.
3. Before the first real /v1/my/* test, prove same-wallet principal and
   different-wallet denial at the server. Never forge a Session from the
   independent Auth Pilot.
4. Only then open any real transactional business endpoint, after G2/G3.
