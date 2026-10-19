# CP31 Cloud Auth Pilot (isolated, no business operations)

This is a **real cryptographic wallet-signature test**, *not* the CP30 funds/voucher backend. It exists solely to validate active MetaMask account -> server-owned SIWE/EIP-191 nonce -> PostgreSQL-backed Session -> authenticated `/v1/me` -> logout/replay rejection, while leaving the original Monad Testnet escrow, CP30 database and signing journals untouched.

## Runtime

- Node.js >=22, `pg` and `viem` pinned exactly in `package.json`.
- Serves the **same CP31 Sites `dist/` frontend** and `/v1/*` API at one Render HTTPS origin. No CORS or Vercel forwarding necessary to test authentication.
- Before web startup, the `DATABASE_URL` must be the **internal** Render PostgreSQL 17 URL for `mealforward-cp31-test-pg` (user configures privately in Render Dashboard). Do **not** paste credentials into ChatGPT or commit them to GitHub.
- `PUBLIC_ORIGIN=https://<exact-service>.onrender.com` must exactly match Render's assigned hostname; HTTPS only. `CP31_EMPTY_TEST_DB_INIT=yes` is an explicit approval to initialize **only** the dedicated fresh test DB schema. Refuses databases containing any legacy CP30 `c1_*` schema.
- `PORT` is set by Render; server binds to `0.0.0.0`. Render terminates TLS; cookies are `Secure`, `HttpOnly`, `SameSite=Strict`, no Domain.
- Data persisted: only token **SHA-256 hashes**, used flags, wallet addresses and server-authored SIWE challenges. No private keys, JWT or user-signed messages in logs.
- Original SIWE statement, field schema and EIP-191 address recovery use the same construction as `cp30-backend/integrations/identity/wallet-login-codec.mjs`. Chain ID 10143 and exact Origin are pinned. Challenges are one-use; sessions live 3600 seconds.

## Endpoints

`/health` returns status from PostgreSQL, `GET /v1/connection` / `/v1/identity/setup` return real auth-pilot metadata, `POST /v1/auth/pre-session` creates server pre-session, `POST /v1/identity/wallet/challenge` stores the unique SIWE message, `POST /v1/identity/wallet/login` verifies signature and atomically establishes DB Session, `GET /v1/me` reads Session, and `POST /v1/auth/logout` revokes it. `/v1/stores`, `/v1/ledger`, `/v1/my/*` and other business GET routes return **503 `ORIGINAL_BUSINESS_NOT_CONNECTED`**; this is not an empty original catalog. Even authenticated wallets receive no original CP30 business records or roles. **Every unsupported `/v1/*` business endpoint returns 503 `AUTH_PILOT_NO_BUSINESS_WRITES`**. No fake contribution, claim, QR, escrow settlement, session or chain receipt is generated.

## Local tests and release restrictions

```
cd cloud-auth
npm install --ignore-scripts --no-audit --no-fund
npm test
```

Pure Node tests mock the SIWE verifier and DB and **do not count as real MetaMask E2E**. Render build must install pinned dependencies and real cryptographic signatures must be user-signed in a real browser. Check `GET /health` first; only call login after ready. Public deployments must display *auth pilot* warning and must not claim to expose historical orders or vouchers. No automatic migration/import from local CP30.

## Render free constraints

Free Web Services sleep when idle, and Free PostgreSQL expires after ~30 days. This pilot keeps authentication data in Render managed PG so service redeploy does not silently authenticate a different wallet. **It is not a production auth deployment or full funds system.** This mode must never be used as a replacement for original CP30 business principal and original-Intent recovery semantics without formal migration and independent security review.
