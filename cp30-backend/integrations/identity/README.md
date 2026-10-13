# Dynamic signed-email identity adapter — leaf module

This module provides an explicit production adapter for the existing Dynamic access-token verifier. It creates no role, work grant, session, database record, recovery channel or wallet entitlement. Owner work permission must separately follow approved onboarding and wallet proof. Main owns composition and integration; app, onboarding_adapter, SQL and the frozen onboarding-contracts module were not changed.

## Exact interface

With the project root and `cp30-backend/integrations` on the application's Python source path:

```python
from identity import DynamicIdentityAdapter, SignedEmailClaimProfile, compose_dynamic_identity

# All inputs are trusted server configuration/functions, never browser DTO fields.
adapter = compose_dynamic_identity(
    profile=reviewed_claim_profile,
    clock=server_clock,
    email_profile=reviewed_signed_email_profile,
    canonical_email=existing_canonical_email,
    email_key=server_email_hmac,
    subject_key=server_subject_hmac,
)
verified = adapter.verify_bearer(authorization_header)
binding = adapter.normalize_binding(verified)
```

`DynamicIdentityAdapter` accepts the same inputs plus a required trusted `jwks` provider. `compose_dynamic_identity` uses existing `server.dynamic_jwt.FixedJwksCache(clock=clock)` when `jwks` is omitted; its construction does not fetch keys. The existing provider fetches only its fixed public endpoint and preserves its cache/redirect/limits policy. The adapter does not accept a verifier replacement, JWKS URL or calibration settings in its production API.

`verify_bearer` accepts one `Bearer <compact-access-token>` string (scheme case-insensitive). It calls the existing `server.dynamic_jwt.verify_access_token(raw, profile=..., clock=..., jwks=...)` before decoding any email claims. It does not change RS256/JWKS, issuer/audience/environment, scope, clock or sid checks. It decodes the same immutable token payload with duplicate-field/non-JSON-number rejection, then checks payload sub/iss/exp against the verified subject/issuer/expiry. Only configured signed claim paths can supply email and its verification evidence. SDK/browser email and caller roles are not inputs.

`VerifiedEmailIdentity` is a **private transient** result with environment_id, issuer, subject, canonical email, expires_at, scopes and sid_hash. `private_projection()` returns only environment_id/issuer/subject/email/expires_at for immediate trusted-server use; it must not be persisted, sent to browser or logged. Its repr excludes those fields, and no result retains the original token. `normalize_binding` accepts only the transient result issued by this adapter instance. The flow calls canonical_email during verify_bearer and the two HMAC callbacks during normalize_binding:

- `canonical_email(raw_email) -> str`: main's existing approved canonicalization policy, without a replacement/default in this module.
- `email_key(canonical_email) -> lowercase 64-character hex`: main's existing namespaced email-HMAC closure using its newly configured server HMAC key.
- `subject_key(environment_id, issuer, subject) -> lowercase 64-character hex`: main's subject-HMAC closure, binding environment/issuer/subject and its chosen namespace with the new server key.

The module does not read/generate/store HMAC keys. Main must supply actual HMAC functions rather than unhashed identifiers. `IdentityBinding.to_json()` is the persistence-safe shape:

```json
{"environment_id":"…","issuer":"…","subject_hash":"64 lowercase hex","email_key":"64 lowercase hex","expires_at":0}
```

Both result types provide `public_projection()` with only `{"status":"IDENTITY_VERIFIED","expires_at":...}`. That status means identity/email mapping succeeded; it grants no owner/merchant permission or business session. Errors use fixed codes, never claim/token/email details; existing verifier errors retain their existing status/code policy.

## Required reviewed public configuration

Existing `server.dynamic_contracts.ClaimProfile` fields are exactly:

```text
environment_id: str
issuer: str
audiences: tuple[str, ...]
verified: bool
allow_absent_audience: bool
allow_absent_environment_id: bool
allow_absent_sid: bool
```

The known public frontend environmentId is `7fe95f70-e5cc-4c3c-beed-a133e81268dc`. Existing provider endpoint is `https://app.dynamicauth.com/api/v0/sdk/7fe95f70-e5cc-4c3c-beed-a133e81268dc/.well-known/jwks`. Knowing these public values does not approve issuer/audience/absence flags or token content. Main must inject an already reviewed ClaimProfile; this module does not read an old private profile/JWT/cookie/key or calibrate/discover a new profile.

`SignedEmailClaimProfile` now has two **explicit** modes. `mode=None` is the default and always fails closed. All profiles require `approved=True` and `email_type="string"`; no claim-path, spelling or mode is inferred.

The retained boolean evidence mode requires:

```python
SignedEmailClaimProfile(
    mode="signed_boolean", approved=True, email_type="string",
    email_path=("<reviewed signed email key>",),
    verified_path=("<reviewed signed boolean proof key>",), verified_type="boolean",
)
```

Its verification claim must be exactly boolean `True`; false/string/number/absent evidence rejects. It must not configure verified-credential fields at the same time.

The verified-credentials evidence mode requires:

```python
SignedEmailClaimProfile(
    mode="signed_verified_credentials", approved=True, email_type="string",
    credentials_path=("<reviewed signed credential collection key>",),
    format_key="<reviewed exact format key>",
    credential_email_key="<reviewed exact email or public_identifier key>",
    email_path=("<reviewed target email key>",),  # optional: None means select the only email credential
)
```

`credentials_path` is an explicit object-key path to a **list** in the already verified payload. Every entry must be an object with its configured format key containing a nonempty string. Only entries whose configured format is exactly `"email"` can supply email evidence. Every email entry must contain a nonempty string under the explicitly selected credential_email_key; the adapter does not fall back between email/public_identifier or camel/snake spellings. `verified_path`/`verified_type` must be absent in this mode; the signed verified-credential collection is the evidence, not a new guessed boolean.

With email_path configured, the signed target and email-credential values use main's same approved canonicalization policy; exactly **one matching** email credential is required. Other valid nonmatching email credentials do not become the target. Duplicate matching credentials, no match, missing fields, non-string values or malformed collection entries reject. With email_path=None, the collection must contain exactly one email credential, which directly supplies the mailbox; multiple email credentials reject even if they contain the same email. Non-email formats are ignored after their object/format checks. Top-level email alone can never satisfy this mode, and a browser-supplied email is never an input.

This matches the distinction in Leader-supplied official references: [Dynamic-specific token claims](https://www.dynamic.xyz/docs/auth/tokens#dynamic-specific-claims) and [Verified Credential object](https://www.dynamic.xyz/docs/react/reference/objects/verified-credential). Those references were not fetched during this strictly offline leaf task. No real Dynamic claim sample/schema was inspected, so the real approved collection path, format key, email identifier spelling and optional target path remain **unconfigured/unconfirmed**. These are configuration templates, not assertions about which fields a real current token contains.

Missing, unapproved, unsupported or mode-less configuration returns **EMAIL_PROFILE_NOT_CONFIGURED (503)** before any import/fetch. Do not set approved=True merely because a top-level email appears in SDK data. Test paths and credentials are fictional in-memory mapping fixtures only.

`server.dynamic_jwt` depends on PyJWT. Production loading is lazy and returns **DEPENDENCY_NOT_CONFIGURED (503)** when its imports are unavailable. The installed test interpreter lacks PyJWT; none was installed, no signature verification was bypassed, and a test verifier is never part of production composition. Invalid signed evidence yields EMAIL_CLAIM_REJECTED; inconsistent sub/iss/exp or a non-adapter private result yields IDENTITY_BINDING_REJECTED.

## Bounded offline evidence

From project root run `python3 cp30-backend/integrations/identity/run-offline.py`. The runner invokes existing bundled Python3.12.14 with an empty environment and `-I -B`, adding only the explicit project/integrations source paths. It runs **five** mapping tests: the original approved boolean mapping/private/public/HMAC shape; absent/unapproved/mode-less/type and dependency failure; subject mismatch and strict boolean evidence; unique matching/direct verified-credential email; ambiguity/malformed/missing/type/identifier spelling/target mismatch/top-level-only rejection and subject binding before credential inspection. The fake verification seam exists only in the test file and cannot be supplied to production constructors. Results are `mapping-tests.json` and `mapping-tests.stderr.txt`: **5/5 passed**.

NOT_RUN: real JWT cryptographic verification/JWKS fetching (PyJWT unavailable); actual signed-email schema validation; real Dynamic login, credential exchange, logout/revocation; application/session/database/onboarding/owner-wallet integration; HTTP/PG and all old C1 identity/security suites. No network, secret reading, identity calibration, runtime service, blockchain, deployment or push was performed. No complete login or independent acceptance claim is made.
