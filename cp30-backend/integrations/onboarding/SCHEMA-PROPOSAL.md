# Bounded persistence proposal — not executable SQL

Only Lead Developer may integrate reviewed schema, privileges, session/controller,
journal and restoration rules. No DB is opened and no SQL is supplied or applied.

| Private record | Required fields and constraints |
|---|---|
| Verified owner binding | namespace + trusted identity subject; enabled owner address; binding revision and evidence reference; trusted binding workflow, never arbitrary browser insertion |
| Store registration | namespace, subject, bindingRevision, key, server registrationId/storeId; immutable original request + requestDigest; original chain/factory/registrar/asset/authorities/owner/deadline/catalog + trusted escrowCreationCodeHash; prepared configHash + parametersDigest + typedData; exact deployment chain/from/to/value/data/callDataDigest; DRAFT/PENDING/UNKNOWN/CONFIRMED; private signature; original transactionHash; escrow and full verifiedEvidence |
| Factory slot admission | scope by chainId+factory across namespaces sharing that factory; unique registrationId and storeId; locked capacity <=3 for pending/unknown/confirmed, consistent with already-created external factory stores |
| Deployment outbox | globally scoped original chainId+factory+registrationId unique; immutable complete original parameters/signature/digest; enqueue in PENDING commit; exclusive durable claim changes registration UNKNOWN before possible submission; never replay a send after UNKNOWN |
| Confirmed publication | original registrationId + exact escrow + verified original catalog/content references; publish atomically with confirmation; all public/menu/support quote reads require this confirmed relation |

`Storage.transaction(*,read_only=False)` must provide short read-only preflight
transactions and serializable/equivalently lock-scoped final transactions; roll back
all methods on exception. No subprocess, filesystem, RPC/network or controller IPC
is permitted inside either transaction. `by_id`/`by_key` return detached records;
write transactions hold original-row and logical absent-idempotency-key locks.
Read-only preflight performs no write locking. Insert/save enforce immutable original fields, registration/store
uniqueness, subject/owner binding and monotonic transitions. Unique idempotency key
is `(namespace,subject,key)` and requestDigest disagreement never replaces the
original. RegistrationId cannot alias another chain/factory deployment. StoreId
cannot duplicate an existing factory store. Slot/outbox uniqueness must span any
namespace pointed at the same factory, not just the current login namespace.

`reserve_slot(record,maximum=3)` must reconcile trusted already-created factory
capacity and lock admission. Do not release UNKNOWN reservations. DRAFT admission
does not reserve deployment capacity; no automatic assumption that the first three
drafts are the three eventually created stores. Final reverts or definitely-unsent
recovery need separately reviewed original evidence before any capacity release;
this module intentionally has no public failure/success override.

`enqueue_once`, registration state/signature save and slot reservation are one
commit. An outbox delivery retry must consult registration state: only a single
successful `begin_attempt` return authorizes the original private record to leave
the DB toward a separately reviewed registrar service. Even a crash before the
actual send leaves UNKNOWN for original lookup, not automatic resubmission.

Session authentication, CSRF, owner binding revision and guard/restore state must
be checked in both preflight and final commit for register/enable; get is read-only.
CatalogBuilder.build is pure DB snapshot/recheck of already-verified immutable
material with stable mealId/commitments, not a place to perform content IO/hashing.
Node codec/signature checker and receipt verifier run between closed transactions.
Final write rereads and compares original objects/digests/state while holding locks.
Reconcile uses DB-only IdentityAuthority.authorize_internal(tx,record) for current
registered account/binding/guard checks in both transactions; this is an internal
observer interface, not browser authentication or a permission override.
Session revocation or binding replacement must not be bypassed by earlier Python
objects. Internal worker/observer adapters need private capability routing and
guard integration; none of their operations are browser callable.

The new bounded dispatcher consumes `next_task()->{namespace,registrationId}|None`
from this same durable outbox, with source transaction closed before returning.
begin_attempt, observe_transaction and original_attempt each reauthorize current
internal owner binding/guard. Concurrent PENDING claims serialize on the original
row; only one commits UNKNOWN and receives permission for send_original. Registrar
must implement durable exact-original attempt retention/query across restarts,
with reviewed private transport and `CP30_ORIGINAL_REGISTRATION_V1` profile. After
any uncertain send, later dispatches only lookup_original, even when no tx hash is
retained yet. Outbox completion must follow persisted final confirmation, never
client/registrar success, a missing lookup result, expiry or temporary unavailability.
Registrar persistence, source/scheduler composition and restore integration remain
main-owned unimplemented adapters; no SQL change or runtime startup occurs here.

Persist original/private records, signature, first-meal content, jobs, tx locator,
canonical final event provenance and slot admissions in backups/journal/restore
floors appropriate to the current deployment. Restores must halt on conflicting
original objects or missing UNKNOWN evidence rather than recreate ids/deployments.
Current controller/journal integration and its security verification remain Lead
Developer work. Retain private subject/email/signature/artifact data outside public
DTOs, public menus and logs. A stable durable id generator and trusted clock are
explicit constructor dependencies; the module has no ambient DB/config defaults.
