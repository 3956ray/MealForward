# Independent identity calibration source

This source creates no server, listener, business session, role, DB row, config or
capture file. It has not been installed into the owned preparation server.

The existing browser bundle `consumer/assets/identity.js` exports
`createDynamicAuthClient()` from `consumer/identity-entry.js`. Its API includes
`startEmail`, `verifyOtp`, `getAccessToken` and `logout`. The underlying SDK uses
memory storage and suppressed logs. The business page's OTP flow subsequently
creates a pre-session and identity session; do not use that flow for calibration.

Root may explicitly load `tools/identity-calibration.py` by file path and create
`Routes('https://localhost:16443', jwks=fixed_public_key_provider)`. A provider has
`get_keys(kid)` and must use only the public Dynamic environment
`7fe95f70-e5cc-4c3c-beed-a133e81268dc` JWKS, never URLs from a JWT. The existing
pure `server.dynamic_jwt.FixedJwksCache(clock=time.time)` is one possible provider;
its constructor performs no fetch. PyJWT/cryptography come from the new pinned
runtime. No reviewed old ClaimProfile is read or reused.

Delegate only these routes from the preparation server to `Routes.handle`:
GET `/identity-calibration`, `/identity-calibration.js`, `/assets/identity.js`, and
POST `/identity-calibration/inspect`. Pass lowercase headers; enforce18432-byte
body maximum before buffering, exact owned TLS origin, and suppress request-body
logs. Other preparation routes remain the caller's responsibility. This module
has no automatic start or prep-server modification entry.

The page takes email/OTP from the human. Email stays visible through sending and
verification until the human selects Clear; OTP is cleared when submitted.
the raw token is sent only to the same-origin diagnostic route without cookies,
then the SDK memory session is logged out. No business login/pre-session endpoint
is called. The diagnostic reuses the existing public-key verifier for protected
header, signature, issuer/environment, audience, time and complete user identity
checks. No role mapper, identity service or session authority is composed.

The diagnostic supports the fixed environment issuer
`app.dynamicauth.com/7fe95f70-e5cc-4c3c-beed-a133e81268dc`; another issuer closes.
Signed issuer/audience/absence evidence is a candidate only: returned policy is
always `verified:false`, with `profileApproved:false`. Known public audience
values may be returned; unknown audience values are redacted for separate review.
The output contains fixed allowlisted claim names/types, signed email evidence
booleans/counts and credential field types, never email/sub/sid/credential values,
raw token, OTP, token hashes or private keys. No result is saved server-side.

`uniqueEmailCredentialStructure` contains only the fixed selected field names and
types from a single credential with `format=email`. Wallet credential fields are
excluded from this selected schema. Zero or multiple matching credentials return
null. Use this evidence for email-field review rather than the union of fields
across every credential; it still does not approve an email claim policy.

Explicit human review is still required for ClaimProfile absence policies,
audience semantics, signed-email paths/format and complete authentication scopes.
A signed sample alone must never auto-approve a full-app identity config.

Root's actual minified access-token sample lacks signed email_verified and
verified_credentials. Normal login may explicitly select dynamic_verified_profile
instead: the production adapter verifies JWT first, then the fixed official SDK
user-profile helper checks verified email against the same subject/environment
and canonical signed email. Calibration still creates no business session and
does not perform this authenticated profile GET or auto-approve its result.

Memory boundary checks pass; actual SDK login, JWKS crypto verification and route
composition still require Root's separate new-origin runtime validation.
