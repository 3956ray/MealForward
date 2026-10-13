# Third source slice — 2026-10-13

WIP / NOT READY FOR USER TRIAL / NOT TESTNET CONNECTED / NOT ACCEPTED.
No PG, HTTP/RPC, JWT/JWKS, wallet, private signer worker, signing, broadcast or
deployment was executed. SQL privilege/type/locking semantics remain UNVERIFIED.

## Implemented source

`src/c1/live_gateway.py` now provides the concrete one-store business gateway,
actual Application call/security/HTTP routing and all three onboarding wallet
methods. Its construction requires trusted enabled configuration, the actual
single-ledger protocol, reviewed asset metadata and three scoped private authority
clients. Missing construction closes live business; unsupported refund/catalog/
controls remain explicitly closed. There is no old model/source/009 fallback.
Readiness additionally requires retained fresh finalized facts and successful
scoped setup replies from all three concrete private authorities.

The worker composes the finalized StoreEscrowObserver, concrete bounded business
HTTPS transport and pure projection leaf. It seeds a store only from a persisted
CONFIRMED registration with complete verified evidence and the original first
meal. Complete current snapshots, original receipts, calldata/parameter/digest,
registered binding, original intent, row revisions and canonical watermark are
retained. Older original receipt proofs cannot roll back newer facts; equal-height
forks or conflicting same-block common facts close projection. Same-block scoped
operation/historical-voucher reads can enrich compatible retained facts. Reads,
crypto and network are outside short serializable transactions.

Connection migrations 023–024 add separate live tables and fixed API/observer/
private admission methods. Their material and monotonic revisions extend the same
externally retained ledger; no success or epoch reset setter is public. Fresh
reviews/confirmations enforce session, CSRF, identity/wallet/store, original review
revision, candidate and per-unit/generation lease. Fresh authority reservations
recheck the original actual session and role/binding. Before broadcast, the actual
original raw/hash, approved grant revision/expiry and requesting owner/session are
rechecked. Compatibility schema-role grants and the new adapter e96804… pin are
explicit; the original 019 SQL bytes remain exact.

Support freezes the actual nine-field FundingQuote and private quote signature.
Approve/fund/settle each persist their original preparation before the personal
wallet is invoked. A hash is only a locator. The new dedicated approval observer
verifies the original approve transaction/receipt plus same-finalized-block asset
code and actual allowance; SQL rechecks full original attempt, payer, quote,
expiry, session, registered asset/escrow/code hash and CAS. Only then can fund be
prepared for sending. Only its own original finalized fund proof confirms meals.

Issue fixes the real candidate's unit sequence, next generation, meal/terms and
original deadline. Recipient ownership is inserted only from original finalized
issue proof. Access/display are hash-only, session/identity/credential/voucher-epoch
bound. Recover rotates the session while retaining signed JWT expiry. Display
expires at the earliest of 120 seconds, voucher expiry, UTC window end or signed
session expiry. Check is a preflight; lock consumes display and creates its one
original lease. Same-owner explicit handover creates markHandover; only its
original finalized marker creates the subsequent original report. Lock/marker/
report/use invalidate earlier credentials. Settlement remains pending until the
owner's original wallet settle receipt is independently verified; amounts/counts
come from actual accounting, not fabricated token balances or liability-as-balance.

`business_runtime_host.py` composes the finalized actual authority signer, signer
response journals, transaction crypto, original-only broadcaster and PgRuntime
admission/ledger/policy. A single bounded suite serves three disjoint capabilities,
profiles and journals. Quote has an explicit transaction-forbidden transport;
issuer/operator permit only issue/lock/markHandover/report. It has no owner
fund/settle key. UNKNOWN uses original lookup only; quote lookup cannot reserve or
sign an absent record. Dedicated key handles are future approved FD metadata,
never browser input, environment defaults or secret CLI arguments.

`tools/business-provision.py` is an independent internal source provisioning step
for new authority custody/profiles/budgets and gateway/observer logins. It performs
only sealed fresh provisioning, then initializes new role journals and writes
pinned suite/client fragments. It cannot refill/reset an existing profile/grant,
read key bytes or auto-adopt a missing journal. The connection bootstrap can start
this optional suite as one app. These actions were NOT_RUN.

## UI integration and focused checks

Consumer loads/clears a target collection fragment before requests and stores it
only in memory during login. On successful sign-in it fills the owner's check form;
there is no automatic check, lock or handover. QR and copied link contain only the
short display token plus store alias, on the current HTTPS origin. The same server
expiry/epochs govern text, QR and link. The new module is served same-origin.

Email/OTP forms and original wallet review are now accessible to supporter and
recipient as well as owner. Wallet review buttons use original intent references;
approve and fund have separate server-controlled eligibility and attempts. Real
prices/amounts use existing exact formatUnits with the reviewed decimals/symbol;
no Number money conversion or live DU labels. Unknown configuration shows amount
unavailable. Synthetic sign-in/result labels appear only for trusted synthetic
mode. Collection windows and review deadlines are explicitly UTC. Extra menu/
control/refund actions are hidden/closed for the first real flow.

Seven bounded shared tests pass: live dispatch/read-write fences, unsupported/body
injection closure, distinct approve/fund attempts, actual unsigned settle payload
agreement with the actual observer codec, fresh facts plus actual authority setup
readiness, unknown receipt no-write/network-outside-transaction behavior, all
three onboarding wallet routes, and Application live synthetic-verifier refusal
(some behaviors share one test). No actual signature is created. The QR/DOM memory
check decodes the exact short-lived URL and checks expiry/state clearing, original
store/case/handover and UNKNOWN presentation. Python AST/JS syntax checks pass.
Existing QR/wallet bundle entries were unchanged; the new URL/module and UI use
those existing exports, rather than replacing the approved dependency lock.
Helper-author approval/broadcaster/signer checks remain separate evidence; they
were not rerun as an old matrix or treated as live-chain verification.

## Third-slice remaining work (superseded by fourth source handoff)

The following was outstanding at third-slice handoff. FULL-APPLICATION-SOURCE.md
now records the implementation of full-app bootstrap and automatic first binding;
actual runtime/SQL/restore verification is still unverified. Original third-slice
list for context:

1. Full-app fresh API/identity/security-controller login provisioning, authority
   initial state, security journals/anchors, complete private config generation,
   fixed HTTPS origin/port/TLS matching, and owned start/stop. Current source
   bootstrap starts the ledger/registrar and optional business suite only.
2. Automatic first-store authority binding/provisioning after verified registration.
   Current internal business-provision requires a registrationId and prepared
   profiles. The user flow must instead consume preconfigured trusted custody/
   role/budget templates and automatically bind the first verified store, with no
   user/admin per-store broker/script step and no missing-journal reset.
3. Merge the generated business client DB/business fragment into that full API
   configuration and wire the actual reviewed identity setup into it.
4. Independent new-record epoch/restore orchestration and later complete frozen
   verification/independent review. Missing or conflicting retained state currently
   closes rather than silently adopting a restored DB.

Required new reviewed inputs: Dynamic ClaimProfile/signed-email policy, fresh HMAC
keys, wallet proof profile/kind RPC, fixed permitted HTTPS origin and TLS material,
actual chain/genesis/finality/provider/code pins and selected asset metadata,
dedicated new authority custody, explicit bounded grants/activation and owned
runtime dependencies. No old private configuration/key/runtime or disabled setting
was read, changed or enabled. These inputs do not substitute for source work above.

HEAD remains 3cb717ec6fca60b80106783631a1e22b8abaff18. No commit/push. Original
contracts/root manifests/locks and old runtime/services remain unchanged. Original
C1 stopped matrices remain stopped. This is source handoff, not acceptance.
