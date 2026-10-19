# CP31 G0 Authentic SIWE Pilot — Sites Integration Gate

2026-10-16 UTC+8. **Isolated Auth Pilot, not CP30 funds / vouchers.**

## Scope
This branch retains the existing `cloud-auth/` server and its PostgreSQL-only
wallet sessions. The Sites assets `dist/app.js`, `dist/live-api.mjs`, and
`dist/ledger-view.mjs` are copied as exact audited blob refs from
`codex/mealforward-g0-g1-readonly-20261016`.
The new frontend recognizes `mode=CP31_AUTH_PILOT_ONLY` and `authPilot=true`
and surfaces an identity-only banner. It does **not** treat `GET /v1/stores`
returning `items: []` as proof that the original CP30 business is empty.

## Non-negotiable restrictions
- Retain CP31 server-owned nonce, exact Render origin, chainId 10143,
  EIP-191 verification, PostgreSQL session, cookie/CSRF and logout checks.
- Only auth-related POST routes may reach the Auth Pilot.
- Open Kitchen, Fund, Issue, Lock, Report and Settle stay blocked. No original
  Testnet intent, Postgres/Journals, private key or contract was copied.
- This branch is source-only until an authorized preview deployment is verified.
- Render Auth Pilot database expires 2026-11-13T19:40:36Z per prior record.
  Recheck expiry before depending on it.

## Offline verification
`cd cloud-auth && npm install --ignore-scripts --no-audit --no-fund && npm test`
and check `dist/app.js`, `dist/live-api.mjs` syntax. CI does not start
the old CP30 controller or read customer transactions.

## Human G0 acceptance (still required)
At the exact origin of the existing Render Auth Pilot, on a real MetaMask
connected to Monad Testnet 10143: verify already-authorized account
sign-in (one signature), first-time permission, refresh /v1/me, logout,
account switch, challenge expiry/replay rejection and wrong-network refusal.
No signed data or cookies should be pasted into chat.

## G1 next gate
Replace the isolated Auth Pilot-only backend with a **separately audited**
same-origin read-only CP30 business data connector. Never mistake Auth Pilot
sessions for original CP30 principal. Real Kitchens, My Contributions,
My Meals and Public Ledger must come from the original authenticated
backend or a validated immutable snapshot; no synthetic success.
