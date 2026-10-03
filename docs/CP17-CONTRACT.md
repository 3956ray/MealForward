# CP17 C0 shared contract

Status: BUILD authorized by Leader after Q1–Q12/PM alignment. C0 freezes module boundaries, dependencies and the independent entry. Full backend integration follows C0; C0 is not a working authentication release. Do not relax verification to unblock the unknown real claim profile.

Post-C0 shared backend: migration4, bounded session/CSRF, explicit activate_mappings authority, operation sidecars and locked first-sign check are implemented. Restore writes use the existing 503 RESTORE_QUARANTINED code (state QUARANTINED). `create_app(..., dynamic_auth_config=...)` selects this policy explicitly; absence keeps legacy password mode. Entry/runtime wiring and real profile remain separate integration work. Controlled checks: `tests.test_dynamic_auth`, `tests.test_backend_chain_dynamic`; no real user token is used by those tests.

## Ownership and integration

| Owner | Exclusive write scope | Output / checks |
| --- | --- | --- |
| Leader JWT worker | `server/dynamic_jwt.py`, `tests/test_dynamic_jwt.py` | Pure verifier plus fixed-endpoint JWKS cache; `.venv/bin/python -m unittest tests.test_dynamic_jwt tests.test_dynamic_contracts -v` |
| Leader frontend worker | `src/dynamic/client.ts`, `src/dynamic/auth.ts`, `src/dynamic/Login.tsx`, `tests/dynamic/` | SDK adapter, HTTP AuthApi and email/OTP component; `node --experimental-strip-types --test tests/dynamic/*.test.ts`, `npm run build:dynamic` |
| Main developer | All shared contracts, deps/locks, harness, docs, backend session/mapping/web/storage/migrations/dispatch/recovery and integration tests | Integrate both modules and verify authorization/restore/dispatch and browser flows |

Workers must not edit shared contracts/dependencies or old owner controller. Request contract changes from Main. No agent redelegation. No external network transaction or actual login/OTP without the later user-driven verification step. Existing services/data remain intact.

Pinned JS SDK client/react-hooks/evm 1.38.0; TanStack Query 5.104.1; existing React 19.3.0 and viem 2.57.1. Python PyJWT[crypto] is in requirements.lock with existing cryptography. Main owns installs. React hooks require QueryClientProvider. No WaaS/embedded-wallet extension.

Installation audit (2026-10-03): npm reports 17 affected packages (6 high, 11 moderate), including transitive axios/ably/got/http-cache-semantics/uuid in the SDK graph. No compatible automatic fix is reported; react-hooks' suggested 0.0.0 downgrade is not an acceptable fix. This is an open dependency risk for independent review, not a passed security audit. C0 does not mount SDK. Do not run audit fix --force or silently override the frozen dependency graph. Deprecated qr/uuid warnings also remain. Python lock resolves PyJWT 2.15.1.

## Python JWT module

Imports/types are in `server/dynamic_contracts.py`. Export exactly:

```python
verify_access_token(raw: str, *, profile: ClaimProfile, clock: Clock,
                    jwks: JwksProvider) -> VerifiedIdentity
```

Also export `FixedJwksCache(*, clock: Clock)` implementing `get_keys(kid: str) -> list[dict[str, Any]]`. Constructor performs no I/O. Optional test-only injected transport may be added as a keyword; it must not alter the production endpoint. Main injects this cache into the verifier. Verification has no Flask/request/DB access and cannot grant roles. Result contains environment_id, issuer, subject, expires_at, scopes (frozenset), optional sid_hash. Never return/store raw JWT or raw sid. Errors use shared ApiError with sanitized messages: 503 DYNAMIC_PROFILE_UNVERIFIED for unverified/incomplete profile, 503 DYNAMIC_JWKS_UNAVAILABLE for unavailable fresh keys, 401 DYNAMIC_TOKEN_REJECTED for invalid tokens. An unverified profile must fail before parsing or I/O.

Strict RS256, nonempty bounded kid, reject jku/x5u/none/HS; signature against fixed Sandbox HTTPS JWKS only. No redirects, timeout 3s, response max 1 MiB, token max 16 KiB; key cache max age 300s, missing kid refresh once with global 30s refresh cooldown, stale cache fails closed. Bound key count and identifier lengths. A cached still-fresh key can verify while offline; no claim of immediate remote revocation.

Require nonempty bounded sub, strict integer (not bool) exp and iat, exp > iat; reject expired, future iat beyond 30s and invalid optional nbf. No 30s extension of exp: sessions and private work stop at exp. Scope must be a string whose whitespace-separated set contains user:basic. Verify exact profile issuer/environment; missing environment_id only if explicit reviewed profile permits issuer binding. Require audience exact profile allowlist (string or list per JWT); absent aud accepted only with explicit reviewed allow_absent_audience. Never silently disable audience verification. Present wrong audience remains rejected even when absent is allowed. Optional missing sid requires explicit profile flag; hash a present valid sid. No invented token_type claim.

The real issuer/audience/environment/sid profile is NOT verified yet. Default verified=False. Synthetic fixtures may use explicitly verified fixture profiles; report them as controlled tests. SDK client.token is minified/access token; legacyToken is ID token. Identical signed claims may make ID vs access token cryptographically indistinguishable: do not claim universal ID-token rejection from fixtures alone.

## Frontend module

Shared types in `src/dynamic/contracts.ts` are authoritative. Export `createDynamicAuthClient(): DynamicAuthClient` from client.ts, `createAuthApi(options: AuthApiOptions): AuthApi` from auth.ts, named `Login` component from Login.tsx with LoginProps. Client factory must be lazy: no network at module import. Root mounts/initializes only for support optional identity or explicit partner/owner login. Never mount SDK for recipient route; do not pass invite/code/returnTo into SDK. Main owns routing and provider/work-panel integration.

Client uses public environmentId constant. Email entry starts only on user submission; verifyOtp only on explicit submission, no automatic resend/retry. Handle intermediate auth/device states as denied/pending, never fake success. Memory-only StorageAdapter for both tiers; no local/session storage token, OTP or extra user payload; no raw token in logs/events/broadcast. Cross-tab signals only invalidate, never carry credentials. Refresh can require login again. SDK network transformer may configure Anvil31337 later through Main; throw/fallback must never authorize143/10143. No initialization eth_requestAccounts, personal_sign or transaction. getWalletProvider is invoked only by explicit owner UI and returns a provider, without signing.

AuthApi uses same-origin relative `/api/v1`, credentials same-origin, no custom caller role/email/userId. exchange POST `/auth/dynamic/exchange` JSON `{}` with current Bearer; session GET `/auth/session` Bearer+cookie; all private request reads and writes include current Bearer+cookie, writes also X-CSRF-Token. Cache session/CSRF in memory only. Reject nonrelative/absolute paths; never redirect tokens or retry a mutation. Parse sanitized server error code, never echo JWT/body. onSession can occur only after backend-authorized mapping, never from SDK identity alone. Login role is UI intent only: refuse wrong mapped work role rather than promoting it.

logout POST `/auth/logout` with cookie+CSRF, allowed without fresh Bearer; clear local auth/proof/review state and SDK even if server fails. Return serverRevoked=false on failure and display server logout unconfirmed; no auto exchange afterward. Server logout does not touch support/recipient cookies. Valid still-unexpired Bearer may explicitly exchange again to a new session if trusted mapping remains valid.

Token/subject/account/chain change emits onInvalidate and clears review/code/proof eligibility before any send. Token refresh never copies old proof or retries old business operations. Main invalidates existing owner controller and may re-login/recover UNKNOWN using same actor, original op/intent only. AuthApi request matches existing OwnerApi structurally; no worker edits to owner-controller.ts.

## Shared backend policy (Main's post-C0 integration)

CP17 cookies: cp17_work_session, cp17_support_cap, cp17_recipient_session, all HttpOnly/SameSite=Lax/path=/api/v1; old defaults unchanged. Cookies are not port-isolated; namespace avoids collision, not confidentiality between local services. Allow only matching Host/Origin pairs 127.0.0.1:15207 or localhost:15207, no arbitrary redirect/origin reflection. New entry never accepts password login; existing deployment retains password auth.

Exchange trusts only explicit local mapping of (environment_id, issuer, sub) to existing enabled partner/owner actor. No mapping means 403 DYNAMIC_IDENTITY_UNMAPPED, no work cookie. No email-based privilege or account/payment linking. Session expiry=min(now+8h,access.exp); idle30m, no renewal beyond original cap. Check valid Bearer identity and current mapping revision, user, role and scope on every private read/write; writes require CSRF. Reject token/session subject/env mismatches. Logout revokes local session/challenges/proofs without bearer validation and never cancels legitimately accepted queues.

Schema4 frozen table/column contract (Main writes migration and activates together with restore):

* dynamic_identity_mappings: id TEXT PK, environment_id TEXT, issuer TEXT, subject TEXT, actor_id TEXT FK users.id, revision INTEGER positive, enabled INTEGER boolean, authority_source_version TEXT; UNIQUE(environment_id,issuer,subject).
* dynamic_session_bindings: session_id TEXT PK/FK work_sessions.token_hash, mapping_id TEXT FK mapping.id, mapping_revision INTEGER, environment_id TEXT, issuer TEXT, subject_hash TEXT, access_expires_at INTEGER, scopes TEXT (canonical JSON array), sid_hash TEXT nullable, actor_role TEXT, partner_id TEXT nullable, shop_id TEXT nullable.
* operation_auth_bindings: operation_id TEXT PK/FK operations.id, auth_source TEXT ('dynamic'), mapping_id TEXT FK mapping.id, mapping_revision INTEGER, environment_id TEXT, subject_hash TEXT, actor_id TEXT, role TEXT, partner_id TEXT nullable, shop_id TEXT nullable.

Bindings are created from verified AuthContext server-side, never from request JSON. Operation + authorization sidecar are atomically accepted. Immediately before first NEVER_SIGNED signing, transaction/dispatch critical section rechecks current trusted mapping/revision/user/scope; revocation blocks unstarted signing. Signed/UNKNOWN stays on existing observation path; no second transaction. Owner settle still uses bound merchant + deployment/session/shop proof and explicit one-time review/start; sidecar is audit, not operator settlement queue. Dynamic wallet metadata never substitutes for proof.

Backup format mealforward-cp17-quarantined-backup-v4; schemaVersion4. Restore accepts prior v1–v3 and migrates, revokes all work/recipient/support abilities and owner proofs/challenges. Restored mapping rows are historical, not trusted authority. New explicit current trusted mapping config must be supplied outside bundle. Fresh exchange may read only authorized scope; all business writes remain503 QUARANTINED and allocate no op/nonce. No JWT/OTP in DB/backup. C0 defines this policy but does not yet claim schema migration or backend enforcement is implemented.

## Independent entry / checks

`npm run dev:dynamic` reserves loopback15207 with strictPort and no old API proxy. In C0 all /api/ requests return503 DYNAMIC_PROFILE_UNVERIFIED; no wallet/provider/SDK mount. Main replaces this gate with dedicated backend only after auth integration. `npm run build:dynamic` typechecks shared frontend plus harness and emits ignored dist-dynamic. `npm run build` checks original build. `.venv/bin/python -m unittest tests.test_dynamic_contracts -v` checks unverified profile denial without network and cookie namespace. No existing service restart or real DB migration is needed for C0.
