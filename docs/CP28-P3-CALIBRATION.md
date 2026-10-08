# CP28-P3 development-only identity calibration

Stage A adds a default-off diagnostic to the accepted bcfe385 identity preparation. Stage B is the user's explicit SDK-memory-to-server check, not an agent credential inspection. Stage C (profile creation and activation) is not authorized by this implementation. The original15287 process, preparation files/anchor, active page and production static build must remain untouched until the user separately approves the specific restart/update.

## API and fixed expectations

Only an explicit process argument `--development-identity-calibration` enables `POST /api/cp28/identity/calibrate`; no environment variable, request field or persisted preparation setting enables it. It cannot be combined with `--identity-profile`, a non-loopback origin, or business backend composition. Without the flag it returns404 and the button is absent. The server listens on127.0.0.1; diagnostics require a loopback peer, exact fixed Host and Origin, and no Forwarded/X-Forwarded-*/X-Real-IP headers. Existing bounded preparation cookie/session and CSRF are required, but never upgraded to identity authority.

Empty JSON only, body at most256 bytes, Authorization at most16400 characters and CSRF at most256. Five admitted diagnostic attempts per process per minute, independent of session renewal. FixedJwksCache retains its fixed environment URL, RS256-only verification,3s fetch timeout,1MiB/32-key bounds,5-minute cache and30-second refresh cooldown. No CP17 capture or maintenance/mapping code is used.

The expected issuer is `app.dynamicauth.com/7fe95f70-e5cc-4c3c-beed-a133e81268dc`, environment is the same fixed ID, and aud must be a **single string exactly equal to the configured request Origin**. Even a single-element audience list is refused; there is no audience intersection. sub and sid must be bounded nonempty strings; scope's allowed set is only `user:basic`. Missing/unknown required claims fail closed. iat/exp are required integer times, exp>iat and exp>now, iat<=now. nbf is optional; when present it must be an integer <=now and <exp. There is no future-time grace for calibration. The optional stricter verifier mode leaves existing CP17 verification behavior unchanged.

The temporary ClaimProfile object is an adapter for the existing pure verifier, with fixed values only. Its `verified` field enables that verifier's guard; it is **not** an approved or persisted profile, is not assigned to the preparation service, and is never inferred from unverified claims. Actual server identity verification remains unconfigured.

Success returns only `VERIFIED_EXPECTATIONS_ONLY`, verified fixed audience/issuer/environment, sid existence/type, allowed scope, `tokenExpiresAt`/`remainingTokenSeconds`, and `validUntil=min(token.exp, preparation-session expiry)`. False flags explicitly state no server identity, business authorization or profile creation. No token, OTP, subject, sid value, full claims, hash/capture ID or new cookie is returned/stored. Invalid claims return a fixed pending message without revealing unverified values; JWKS unavailability has a separate fixed pending message. Responses are no-store; the launcher uses the existing quiet request handler.

## UI and lifetime

“校准当前登录（不授权）” appears only when explicitly enabled, and is usable after SDK login. Clicking reads the existing SDK memory bearer inside the client and sends it directly to the same-origin endpoint; there is no token/OTP paste, export or agent-read step. It never calls exchange/candidate. “校准诊断通过，待审核配置” is distinct from identity, wallet proof and business permissions. JWT remaining lifetime and diagnostic session lifetime have separate labels. Token/subject invalidation, logout, departure and validUntil expiry clear the visible conclusion; late responses cannot restore it. The recipient still does not load the identity card/SDK. No calibration result is persisted, so there is no server result to restore after session replacement.

## Verification without touching the active entry

Run from the project root with existing locked dependencies:

```sh
.venv/bin/python -m unittest tests.test_cp28_calibration tests.test_cp28_identity tests.test_dynamic_jwt tests.test_dynamic_auth tests.test_dynamic_profile tests.test_dynamic_contracts -v
node --experimental-strip-types --test tests/wallet/cp28-calibration.test.ts tests/wallet/cp28-identity.test.ts tests/wallet/cp28.test.ts tests/dynamic/*.test.ts
node_modules/.bin/tsc --noEmit -p manual-business-harness/tsconfig.json
node_modules/.bin/tsc --noEmit
node_modules/.bin/vite build --config manual-business-harness/vite.config.ts --outDir ../dist/cp28-p3-production
node_modules/.bin/vite build --config tests/cp28_identity_vite.config.ts
.venv/bin/python -m tests.cp28_identity_browser --calibration --port 0
```

The last command prints a new random loopback port, using synthetic SDK/JWT/provider and an ephemeral RSA key. Its token endpoint/test buttons exist only in the fixture. The production build above goes to a separate directory and does not replace the active entry's assets. Tests never send real emails, inspect the active browser, use real JWKS or call chain RPC. Browser evidence records only request paths/status and credential-presence booleans.

## Concrete activation/deactivation for later user review — not executed

After fixed-SHA review and **separate explicit approval of updating/restarting the original entry**, stop only the identified15287 preparation process with its normal Ctrl-C, build the reviewed UI into its served directory, then resume the original preparation directory/port with the development flag:

```sh
node_modules/.bin/tsc --noEmit -p manual-business-harness/tsconfig.json
node_modules/.bin/vite build --config manual-business-harness/vite.config.ts
.venv/bin/python -m server.manual_business resume --directory .localbackend/cp28-preparation-20261008 --port 15287 --development-identity-calibration
```

This preserves runId/anchor but revokes in-memory preparation sessions. The user must load the new page and may need to log in again because SDK credentials are memory-only. Do not reload the active page on the user's behalf before approval. The user then explicitly clicks the diagnostic button; the agent must not inspect/copy credentials. Expected startup: original runId, reviewed source SHA, identityProfileConfigured=false, developmentCalibrationEnabled=true, Runtime BLOCKED.

To close calibration, after approval for that restart, stop only that preparation process and resume without the flag:

```sh
.venv/bin/python -m server.manual_business resume --directory .localbackend/cp28-preparation-20261008 --port 15287
```

Expected developmentCalibrationEnabled=false; no profile is created by either command. Never use prepare to overwrite the existing round, add `--identity-profile`, widen aud/claims, or combine profile approval with this restart request. Stage B remains NOT_RUN until the user performs the actual diagnostic; real aud is unobserved even if SDK email login was reported successful. Stage C requires a separately approved exact-origin configuration source and explicit creation/activation approval. All chain Runtime/deployment/grant/signing/broadcast/budget boundaries remain closed.
