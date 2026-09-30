# CP16 C0 frozen module contract

> Role correction: the user confirmed supporter / institutional partner / recipient /
> restaurant owner and option A. The owner handles lock, handoff and report in the
> application (operator broadcasts lock/report), then directly wallet-signs settle.
> Separate staff/settler identities and the no-self-settlement rule below are
> superseded. Backend settlement signing is not owner authorization. Preserve old
> code/data as historical work; do not accept it as the corrected wallet flow.
> Revised shared interface proposal: Leader research/cp16/developer/C0-OWNER-A.md,
> pending targeted PM readback before implementation. The simulated P06 change is
> separate and does not connect a real wallet.

Scope: Anvil31337/loopback only. CP15 baseline00d23d1. C0 provides shared schema,
transaction helpers, encodings, signer configuration and backup compatibility;
it is not a claim that lock/report/settle HTTP or their worker is already complete.
Product truth: Leader research/cp16/developer/READINESS.md + pm/ANSWERS.md.

## Ownership / runtime

Main only: migrations, storage, contracts, backend, actions.py, work_core.py,
web.py, chain/, outbox/projection/recovery/local, all shared docs/dependencies,
tests/test_backend_chain*. Recipient owner only server/recipient.py and
tests/test_recipient.py. Redemption owner only server/redemption.py and
tests/test_redemption.py. Do not edit the other module/shared files; request
changes from main. Leader dispatches after C0 SHA, main cherry-picks fixed commits.
Python3.12 .venv and existing pinned packages; no new dependencies required.
Test commands: `.venv/bin/python -m unittest tests.test_backend_chain_contracts -v`,
then module unittest files and main integration. Own random ports/temp DB only.

## Shared backend / schema v2

Read server/migrations/002_redemption.sql for exact column order/defaults/constraints.
Use explicit column lists in inserts. Store.transaction uses BEGIN IMMEDIATE;
callers own commit/rollback. Store upgrade from1→2 preserves prior data/quarantine,
marks old raw-less jobs LEGACY_UNKNOWN, never fabricates NEVER_SIGNED audit.

Backend b exposes store, now(), encrypt/decrypt(str), rpc.contract (ABI encoding
only in transactions), operation_view(op), recovery_view(), signers role→address,
and `b.work` (WorkCore). `b.signer` remains legacy issuer. Actor is AuthContext with
actor_id/role/partner_id/shop_id/session_id. Main web calls real auth.require.
WorkCore.require_actor rechecks users inside the mutation transaction; callers must
also enforce operation/group/redemption ownership and no self-settlement.
Only shop-local maps to the fixed contract merchant. Other-shop test users deny.

Shared helpers, with caller's same sqlite3 connection:

- work.writable(db,allow_paused=False): restore/halted/pause checks. Only legitimate
  old-lock handoff/report may allow_paused=True; never bypass restore quarantine.
- work.require_actor(db,actor,role): current user enabled/current full context/role
  and local shop. Raises ApiError. Work session auth remains main's responsibility.
- work.voucher(db,id): **internal private row**, includes secret_cipher/hash,
  partner_id, issuer_actor_id, issue_status, confirmed, chain_status, lock_id.
  Never jsonify this row. All DTOs use explicit allowlists.
- work.available(db,id): finalized issue+confirmed+public status1+no voucher_claim.
- work.code_hash(code): keyed HMAC. work.expire_codes(db,now=None) invalidates expired
  codes/sessions' codes and erases code_cipher. It does not renew any TTL.
- work.validate_code(db,actor,code,now=None): current staff/shop + active code,
  current recipient head/session/expiry/idle + available voucher. Returns only
  `{codeId,voucherId,shopId}`. No consumption, no RPC, no commit.
- work.validate_and_consume_code(db,actor,code,operation_id,now=None): same validation
  plus writable gate, consumes/erases original code, returns same minimal mapping.
  Caller MUST create claim/redemption/op/outbox in **this exact transaction**.
- work.original(db,actor,kind,intent_key,request): scope+snapshot check, dict or None;
  different snapshot409, changed scope403. Call before re-consuming an old code on
  idempotent retry, but still enforce quarantine and current resource scope.
- work.enqueue(db,actor,kind,intent_key,target,request,payload,
  redemption_id=None,operation_id=None): idempotent scoped operation/outbox/audit;
  **no business predecessor/claim/handoff checks**, these are module responsibility.
  Current actor/action role, writable/pause, configured signer and unique pending
  kind/target checked here. Returns internal op dict. No RPC or signing.

kind target: issue=batchId; lock/report/settle=voucherId. Stable redemptionId per
lock attempt links later report/settle. Public payable id=redemptionId. On acceptance
choose opId/redemptionId/lockId via backend.random_id; lock: enqueue first, insert
redemptions (references op), insert voucher_claims; transaction rolls back together.
Sanitized canonical request never stores the raw code: replace it with codeHash
and include groupId/intentKey as appropriate. No secret/CSRF/cookie in request_json.
Canonical payload is chain-only fields: issue batchId/voucherIds; lock/report
voucherId/lockId; settle voucherId. No to/amount/actor/signer/nonce supplied by client.

Redemption states: LOCK_PENDING→LOCKED→HANDED_OFF→REPORT_PENDING→REPORTED→
SETTLE_PENDING→SETTLED. Main projector changes only after matching finalized event.
Failed lock attempt→LOCK_FAILED; report failure returns HANDED_OFF, settle failure
returns REPORTED. Main failure handling safely releases **local failed claim** only;
never chain unlocks, clears handoff, decrements H on failure or revives consumed codes.
Modules must consult original op/public state, not infer finality just from state label.

Each pending work kind/target is DB-unique. Processing_items active=1 has unique
(actor_id,voucher_id); same employee cannot duplicate a voucher in another active
group. Group item/claim rows do not grant permission. Default group reads never
return code/secret/ref/issue or unpresented sibling vouchers. No group/claim transfer.
Handoff/delivery/work audit immutable triggers prohibit rewriting/deleting facts.

## Recipient owner export (no Flask routes)

`class RecipientService: __init__(self,backend)`; methods below return JSON-safe dicts
or raise shared ApiError. Main registers routes and global Origin/JSON/headers.

- list_vouchers(actor) -> {vouchers:[minimal own-partner voucher DTOs]}
- invitation(actor,voucher_id,body) -> {voucherId,secret}; body exactly intentKey,
  same institutional scope allowed, log disclosure audit per actual actor.
- deliver(actor,voucher_id,body) -> {delivery:...}; exact intentKey/channel/result.
- deliveries(actor,voucher_id) -> {deliveries:[...]}.
- exchange(body,ip,previous_token=None) -> (dto,token); exact secret, bootstrap rate
  protection; dto sessionId/expiresAt/csrfToken/voucher. Main sets HttpOnly cookie;
  returned token is never added to JSON. Active previous cookie on explicit voucher
  switch may be revoked; cannot use a forged previous_token to revoke another session.
- voucher(token) -> {sessionId,voucher:...}; no code creation/return.
- present(token,csrf,body,ip) -> {sessionId,voucherId,code,expiresAt}; exact intentKey.
- logout(token,csrf) -> None; revoke current session and code. Main does not blindly
  emit delete-cookie on old401/late response; leave invalid token inert until replace.

Cookie/constants from server.contracts: recipient_session, path/api/v1/recipient;
30m absolute/15m idle; code120s. Session hashes via backend.digest; CSRF can derive
HMAC from presented high-entropy session token like work auth, hash at rest.
One head per voucher. All recipient writes gate restore; exchange/present additionally
require available voucher and no pending claim. Valid old session for locked voucher
may read status, never issue new code. New exchange cannot grant a locked voucher.
Repeated disclosure returns the SAME existing secret, never rotates or creates one.

Bootstrap strict Origin/JSON main handles; service handles exact body/length, failures
5/15min per IP and secret digest. Code creation5/min/session; use durable auth_failures
keys with own prefix and process lock for concurrent check+record (single API process).
Code random digits8, leading zeros, active global HMAC unique. Bounded collision retry;
same session/intent before expiry can decrypt existing code, not extend it; expired,
rotated, consumed intents cannot re-mint. Erase code_cipher on invalidation/expiry.
No actual clipboard or external-message send claims; sent/failed is employee record.

## Redemption owner export (no Flask routes)

`class RedemptionService: __init__(self,backend)`; dict returns/ApiError:

- precheck(actor,body,ip): exact code; minimal {voucherId,shopId,status}, no lock.
- create_group(actor,body): exact intentKey -> {group:{id,...}}.
- group(actor,group_id): {group:{id,items:[...]}}; unclaimed items needs_code.
- add(actor,group_id,body,ip): exact intentKey/code, validate fresh, no consumption.
- lock(actor,body,ip): exact intentKey/code + optional groupId ->
  {operation:b.operation_view(op),redemptionId}. Normalize missing groupId to None
  in canonical request. Replay original key without consuming a code again.
- get(actor,redemption_id): {redemption:...} original staff/shop only.
- handoff(actor,redemption_id,body): exact intentKey -> {handoff:...}; duplicate
  other key returns existing statement, never creates a second claim of fact.
- report(actor,redemption_id,body): exact intentKey -> {operation,redemptionId}.
- payables(actor) -> {payables:[...]}; payable(actor,redemption_id) -> {payable:...}.
- settle(actor,redemption_id,body): exact intentKey -> {operation,redemptionId}.
- operation(actor,op_id=None,kind=None,key=None): {operation,redemptionId}; scoped
  lock/report original staff, settle actor+shop; no arbitrary request_json in DTO.

Code validation error/rate guard shared across precheck/add/lock in this single service:
serialize check/validation/failure record via process lock, durable actor+IP prefixes,
5 failed/min/staff and30 failed/min/IP across accounts; 429 generic. Record failures
outside rolled-back business transaction, do not lose throttle updates on ApiError.
Never copy code into operations/request_json/group DTO/audit. For group_add intent
idempotence use processing_item_requests with sanitized request snapshot (codeHash,
groupId,intentKey), never invent a chain operation/receipt for a group change.
Return item/group DTO, not chain operation DTO.
create_group has its own actor/intent unique key; compare input strictly.

Roles: staff actor+shop ownership for group/redemption/lock/handoff/report; settler
shop scope for payables and settlement, deny actor==handoff.actor_id even after role
change. Partner-specific delivery service stays recipient owner. Main handles
auth.require(role,csrf=POST) and projectors before chain-dependent acceptance;
service still rechecks current actor and persisted predecessors within transaction.
For handoff/report allow ordinary pause only on original finalized lock; restore
blocks both. report requires immutable handoff and original employee; settle needs
matching finalized report and public status3/H, no pending settle, no pause.

## Worker / compatibility main owner

actions.py is pure registry with action_fingerprint and action_transaction. Three
distinct public signer addresses b.signers; only issuer in legacy configs is valid,
unconfigured new action503. New local.fixture keys config operatorKeyFile/settlerKeyFile,
public workSigners at config top level (not modifying existing deployment binding).
API load reads only encryption key; worker later explicitly loads signer keys.
seed partner-a/b, staff-a/b, staff-other, settler-a/other; fixture-only password
local-only-password, local shop or shop-other negative control.

Signing audit states: new shared enqueues NEVER_SIGNED + ACCEPTED_NEVER_SIGNED;
issuer worker persists SIGNING_STARTED before possible signature then RAW_SAVED
before RPC broadcast. Stage without raw after possible signing is UNKNOWN; old
LEGACY_UNKNOWN never upgraded by guessing. Trusted preflight rejection only normal
continuous ACTIVE, NEVER_SIGNED audited task with no possibility of broadcast.
Per-signer serial queues, current actor/scope before new signing/dispatch, original
raw immutable. C0 does not yet advertise these complete worker/HTTP capabilities.

Backup writes v2 bundle containing present signer keys. Restore accepts actual v1
and v2, migrates DB, preserves quarantine, revokes recipient sessions/codes along
with work/support. Legacy missing signer is unavailable, not auto-granted/replaced.
No unquarantine endpoint or compatibility shortcut changes this gate.
