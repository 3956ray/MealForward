# MealForward CP31 G1: Auth Pilot source-truth hard gate

Date: 2026-10-17 (UTC+8). Deployment track:
`codex/mealforward-cp31-auth-pilot`, not the original CP30 runtime.

## Purpose

The owner personally accepted the five G0 wallet UX checks (correct account
sign-in, refresh, logout, account switch, wrong-network rejection). The
existing Render Auth Pilot uses its own isolated PostgreSQL for SIWE sessions;
it has **no original CP30 business data**.

A successful `GET /v1/stores => {"items":[]}` is misleading: it could mean
"zero kitchens" even though the original data source was never connected.

## New behavior

| Source route | Result | Reason |
|---|---|---|
| `GET /health` | 200 when isolated auth PG is ready | Auth infrastructure only |
| `GET /v1/connection` | 200, `authPilot=true`, `businessSourceConnected=false`, `originalPrincipalCompatible=false` | Explicit source provenance |
| `GET /v1/identity/setup`, `GET /v1/me` | Existing origin-locked auth behavior | No change to real MetaMask |
| `GET /v1/stores` | 503, `ORIGINAL_BUSINESS_NOT_CONNECTED` | Not an empty original kitchen catalog |
| `GET /v1/ledger`, `GET /v1/my/orders`, `GET /v1/my/claims`, `GET /v1/my/vouchers` | 503, `ORIGINAL_BUSINESS_NOT_CONNECTED` | No fake private read model |
| Other business POST/PUT | 503, `AUTH_PILOT_NO_BUSINESS_WRITES` | No funds, issue, report, settle or signer |
| `POST /v1/auth/pre-session`, challenge, login, logout | Existing authenticated behavior | Keeps SIWE nonce, Origin, CSRF and session semantics |

The Sites UI now waits for the same-origin connection/auth-mode handshake
**before** deciding whether to fetch business rows. In Auth Pilot mode it
returns the verified `/v1/me` wallet, with no fabricated ownership, store,
contributions or vouchers. Public menus and ledger are explicitly unavailable,
not reported as empty. All original CP30 write operations remain disabled.

## Evidence

GitHub Actions (Node 22) tests authenticate via a deliberately isolated
in-memory store, validate real ephemeral SIWE signing protocol, and reject
absent business reads. **They do not replace user wallet/browser evidence or
a live original CP30 data-source connection.**

This does NOT mark G1 as accepted. To pass G1, separately authorize a
read-only original CP30 source and prove that original CP30 subject and
recipient_key ownership checks match current live wallet principal under
the same trusted origin. Never copy historical Journals or wallet secrets
to Render's short-lived free filesystem.

## Boundaries

- Do not touch original Mac `~/.mf-cp30-20261013/`, PostgreSQL, original
  pending journal, source pins, earlier vouchers or existing Testnet funds.
- Do not alter Render managed PostgreSQL schema except normal Auth Pilot
  session/pre-session behavior.
- Auth Pilot session is NOT original CP30 wallet principal.
- No user signature, Cookie, challenge response, wallet secret or database
  connection string should be included in a GitHub issue or chat.
