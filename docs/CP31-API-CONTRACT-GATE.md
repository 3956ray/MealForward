# CP31 Site × CP30 API — Contract Gate 1 (2026-10-15)

Source pinned:
- CP30 `cp30-backend/src/c1/application.py`, `live_gateway.py` on this branch.
- Frontend `sites-frontend/dist/live-api.mjs`, `app.js` copied exactly from `codex/mealforward-simple-flows-v1@0aeaaeb`.
- Cloud `codex/mealforward-cp31-auth-pilot@b845e72` is an **independent login pilot**, not a connected CP30 backend.

## Real contracts and read-only first

| Site page | Frontend calls | CP30 handler | Before releasing |
| --- | --- | --- | --- |
| Startup | `GET /v1/connection`, `/v1/identity/setup`, `/v1/me` | application setup, wallet principal/auth | Exact Origin and Chain ID 10143; 401 anonymous is acceptable; no fake logged-in |
| Kitchens | `GET /v1/stores`, `GET /v1/stores/{store}/meals` | public stores/meals | Only finalized LIVE/Listed menus; photo & version verified |
| Kitchen Overview | `GET /v1/stores/{store}/workbench` | workbench | Verify owner role; do not publicize private drafts |
| My Contributions | `GET /v1/my/orders`, `GET /v1/intents/{uuid}` | my_orders, intent_get | Only current wallet's real orders, count, amount and actual tx hashes |
| My Meals | `GET /v1/my/claims`, `GET /v1/my/vouchers`, `GET /v1/vouchers/{voucherId}` | my_claims, my_vouchers, voucher_get | Same-wallet private ownership, state & original version |
| Payouts | `GET /v1/stores/{store}/payouts` | payouts | Owner only; distinguish report vs actually settled |
| Public Ledger | `GET /v1/ledger` | public_ledger | **Backend implemented; Sites CP31 route still shows a not-connected placeholder** |
| Login | `POST /v1/auth/pre-session`, `POST /v1/identity/wallet/challenge`, `POST /v1/identity/wallet/login`, `POST /v1/auth/logout` | identity authority + Session + CSRF | User-tested on independent Render Auth Pilot only. Must revalidate when integrating with original CP30 roles & data |

## Explicitly blocked business mutations in Render Auth Pilot

| Stage | Routes | Required invariant |
| --- | --- | --- |
| Open Kitchen | store registration create/enable, image upload | Owner authorization, original Registration ID, onchain finalized |
| Meals | private draft PUT, image PUT, review POST, publish POST, list/unlist | Never edit funded past versions; publish != setListed |
| Fund | `POST /v1/support/reviews`, `/v1/support/intents`, original wallet attempts | One user confirmation UX; approve != fund; original fund finalized before success |
| Issue | `POST /v1/claims/reviews`, `/v1/claims/intents` | Original issue finalized and owner-bound voucher, no duplicate claim |
| Voucher | `POST /v1/vouchers/{id}/recover`, `/display` | Session-bound secret, 120s QR; no public access |
| Redeem | `POST /v1/stores/{store}/checks`, `/locks`, `/cases/{id}/handover-intents` | Check != Lock != physical handover; no double spend |
| Settle | `POST /v1/stores/{store}/payouts/{voucherId}/settle-reviews`, `/settle-intents`, original wallet transaction | 180s platform gate, owner wallet, finalized settle proof |

## Known mismatches / blockers (do not mask with 200 or empty mock data)

1. G1 currently merges **files only**: CP31 frontend now lives at `sites-frontend/dist/`, CP30 backend remains at `cp30-backend/`. The CP30 HTTP launcher has not been changed to serve it on a public cloud origin.
2. Render Auth Pilot uses `mf_cp31_auth_pilot` with no CP30 schemas, roles, ledger or original store records. It intentionally exposes `GET /v1/stores` as `items:[]` and rejects business writes 503; **not** proof that original historic business data is connected.
3. The CP30 state has session-bound pending intents that may be stranded after re-login. The newer frontend can display original IDs but backend recovery must be fixed before any real transaction traffic is allowed.
4. SQL 045 hotfix parity migration is on separate readiness branch, pending isolated real PostgreSQL 17 & role verification; the existing original PG with 042–044 and journals must never be reset.
5. CP30 180-second settlement is a platform control, not a currently independently enforced chain wait. No real `settle FINAL_SUCCEEDED` yet.
6. Current free Render web service has ephemeral disk and idle suspend; PG expires 2026-11-13T19:40:36Z. **Never** host custody signer & irreplaceable Journal there without verified durable storage, backup and recovery.
7. Auth Pilot SIWE with real MetaMask passed user test 2026-10-15; still need browser refresh, logout, account switch, unknown/expired challenge, and server session readback tests to close G0.

## Release gates

- **Read-only Gate:** exact origin, authenticated wallet, real backend, permission-filtered records, no cross-wallet leak, no synthetic success.
- **Schema Gate:** fresh PG migration+GRANT tests for 001–045; preserve original source pins and journal checkpoint.
- **Mutation Gate:** durable append-only signer/controller Journal, crash/restart recovery, no UNKNOWN resends; independently verify all grants and receipt finality.
- **Product Gate:** supporter 3 steps, recipient one tap, My Contributions real receipt, My Meals real QR, Kitchen publish/redemption, first owner settle & public ledger. Verify on mobile and desktop.

This document is a **source contract mapping**, not a deployment E2E report.
