# CP15 interfaces / ownership

Only Anvil31337/loopback, new DB and explicit local fixtures. No original app,
contract or wallet changes. Core scope: support intent→fund finality→API issueN3→
reservation/outbox/raw broadcast→finalized projection/restart. Not full work UI,
lock/report/settle HTTP, real network or production deployment.

## Runtime and commands

Python3.12.14 found at `python3.12`; project `.venv` via `uv venv --python python3.12 .venv`.
Install exact hashed transitive lock: `uv pip sync requirements.lock --python .venv/bin/python`.
Auth tests: `.venv/bin/python -m unittest discover -s tests -p 'test_auth*.py' -v`.
Backend tests: same command `-p 'test_backend_chain*.py'`.
Do not run global Python expecting new dependencies. Existing stdlib simulation stays unchanged.
Manual reserved ports: CP15 Anvil18645, Flask HTTP8875, expected origin http://127.0.0.1:8875.
Automated tests create their own random loopback ports and temporary DB; never kill/reset peers.
Manual root `.localbackend/` ignored; DB, encryption key and ephemeral local issuer key separate,
owner-only permissions; no key values in docs/logs. Manifest carries only public deployment fields.

## Shared store / Auth owner

Auth agent writes only `server/auth.py`, `tests/test_auth*.py`. Main already implements
Store in `server/storage.py` and SQL migration; import AuthContext/ApiError/constants/
AuthStore from `server/contracts.py`. AuthService API must exactly match its contract.
`register_auth(app,store,*,origin,clock=time.time,secure_cookie=False)` registers three
/api/v1/auth routes and returns object with `require(role=None,*,csrf=False)->AuthContext`.
Export `hash_password(password)` for local seed. No source seed/demo password needed
in auth implementation. Tests seed temporary users via Store.create_user. Wrong roles
403, missing/expired/disabled/revoked sessions401. Login JSON username/password; session
and login return `{actorId,role,partnerId,shopId,expiresAt,csrfToken}`. Logout POST returns
204 and deletes cookie. Login requires allowed Origin; authenticated POSTs additionally
X-CSRF-Token. Cookie `work_session`, HttpOnly/SameSite=Lax/path=/api/v1, host-only;
Secure only for HTTPS (current explicit local loopback mode false). Do not trust X-Forwarded-For.

Store rows: user id/username/password_hash/role/partner_id/shop_id/enabled; session
token_hash/user_id/csrf_hash/created_at/expires_at/last_seen_at/revoked. get_session is
not joined: fetch current user separately on every require. Store persists only hashes
of random session/CSRF tokens. Session GET needs return a valid CSRF token: auth agent
may derive it with a deterministic secure HMAC keyed by the *presented high-entropy
session token*, and store/compare its hash (no extra secret/shared schema required).
Limits: absolute8h, idle30min, failure5/15min per normalized account and source IP;
Argon2id at least19MiB/2/1. Generic bad-login errors; revoke on logout. Clock injectable.
Store failures use arbitrary string keys (e.g. user:name/ip:127...); store does not hash
passwords or interpret roles. Main routes use service.require('partner',csrf=True).
Auth does not read/write support caps or outbox, does not create own migrations.
Store disables users and revokes all their sessions in the same transaction; enabling
again does not revive an old session. The local API is one process with threaded
requests. Auth's lock is process-local: multi-process/Gunicorn workers are unsupported
until throttle check-and-record is atomic in the shared store.

## Envio owner / ABI

Only `indexer/` incl own package+lock/config/schema/handlers/tests/README. Source ABI
is `shared/MealForward.abi.json` (generated full Solidity ABI, not a hand-authored fork);
manifest `shared/abi-manifest.json` pins source and SHA256. Copy/generate only with
hash assertion; never modify root ABI or root dependencies. CP13 contract remains local.
Event shape `shared/chain-event.schema.json`; args only ABI public fields (no ref,
qualification, cookie, invitation, raw transaction or group metadata). Money decimal
wei strings. Stable ID deploymentId:transactionHash:logIndex; Issued children append
voucherId/array index. Deterministic ordering blockNumber/transactionIndex/logIndex.

EventFeed.fetchRange(deploymentId,from,to,cursor?) returns events,indexedThrough,
observedAt,nextCursor,source. Envio is a public candidate read model, never finality
or write authority. No handlers calling external mutation APIs/files/private DB.
Reorg rollback cannot roll back external effects. Main directRPC+canonical/receipt/
finalized remains authority; Envio lag alone cannot stop finalized business progress.

Use actual HyperIndex local31337 RPC configuration and handlers. Docker absent: don't
install daemon. Report handler-tested vs real HyperIndex/GraphQL NOT_RUN separately.
Possible own future indexer service ports8085/5435 (never defaults against peers), root
Anvil18645 only by explicit coordination; tests own node. SDK source/type tests not bounty proof.

## Backend API / states (main owner)

Routes: GET /api/v1/config; POST /support-session; POST /support-intents;
GET /support-intents/:id; GET /public/fund-status; POST /work/issuances;
GET /work/issuances/by-intent/:key; GET /operations/:id (work only); GET /batches/:id.
Work POST JSON per CP14: intentKey,recipientRef,batchId,quantity,quotePriceWei,ruleVersion.
No arbitrary actor/reset/outcome route. API errors `{code,message}` use ApiError status.
202 issuance is queued, not confirmed. Server scope and payload binding on every write.

Support capability random256-bit HttpOnly `support_cap`, hash only,24h, path=/api/v1;
first establish unbound cap cookie, then atomically bind one stable clientRequestId to
one intent. Same key/snapshot returns original; different bound intent409. Query
requires exact cap/op binding; not address ownership and no work privileges. Cap
loss/expiry leaves public exact payer+intent read-only recovery, never auto-repay.
Origin required on all POST, strict JSON. No secrets in generic DTO/logs.

Worker persists nonce/raw/hash before broadcast, only retries same raw; signed unknown
keeps reservation. Finalized projection validates receipt/canonical/payload, event
unique key and cursor atomic. Pause comes from verified contract state. Outbox stores
private raw encrypted under separate local runtime key. Secrets created before issue
but confirmed flag only after finality; no sharing API in this slice.

Operational states: PREPARED (support), QUEUED/SIGNED (work), BROADCAST,
INCLUDED_SUCCESS/INCLUDED_REVERT, SUBMISSION_UNKNOWN, FINALIZED_SUCCESS/FINALIZED_REVERT.
NOT_SUBMITTED means preflight definitively rejected an unsigned work transaction;
its reservation is released. It never applies to a signed/broadcast unknown.
HALTED is global chain evidence conflict, not an on-chain result. Missing event/receipt
is not failure. quoteExpiresAt is UI review milliseconds, no chain deadline.
Existing final result does not regress on RPC/indexer outage; actual canonical conflict
halts dependent new writes and requires reconciliation. Envios public lag is informational.
