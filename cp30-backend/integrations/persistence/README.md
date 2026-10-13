# Private original ledger integration (source only)

`PgRuntimeLedger(database, namespace, controller)` is a concrete fixed-function
PostgreSQL adapter for the existing `PrivateBusinessRuntime` and
`RegistrarRuntime`. `PgRuntimePolicy()` reads the same ledger's approved original
through `tx.authorization(key)`. No connection, credentials, external journal,
approved profile or gas grant is fabricated here. Missing database capability,
controller or retained floor closes the adapter. No PostgreSQL was started and
the SQL has **not been installed or executed**.

## One ledger, one budget

`runtime-ledger.sql` is a **full replacement candidate for the currently
uninstalled `migrations/019-private-original-ledger.sql`**. Main must replace
that installation entry, not install both. The replacement's
`c1_runtime_private.grants/reservations/nonces/attempts/authorizations` are the
sole private signature, gas, nonce and original-request authority. The older
`c1_private.private_*` ledger/grant tables and their `private_ledger_*` functions
must not be installed alongside them or used by either host. This is not a live
data migration. If 019 has actually been applied, stop and design independently
verified material migration before adoption; no drop/import script is supplied.

Compared with the existing source 019, this adds an externally retained head,
per-object restoration floors, cross-namespace nonce floors, revision/row CAS,
exact approved reservation material and initial row, monotonic budget counters,
original-only replay and controller-sealed absence. It also handles Registrar's
enriched signer record separately from its immutable domain original.

Main replaces both host ledger/policy constructors:

```python
ledger = PgRuntimeLedger(runtime_database, namespace, runtime_controller_client)
policy = PgRuntimePolicy()
# Inject these into PrivateBusinessRuntime or RegistrarRuntime unchanged.
```

The database has `database == 'runtime_internal'`,
`runtime_ledger_protocol == 'CP30_RUNTIME_LEDGER_DB_V1'` and existing
`transaction(namespace, *, read_only=False)` yielding a fixed `.call`. Write
transactions must use SERIALIZABLE; SQL checks this itself. No automatic
serialization/timeout retry is allowed after an uncertain commit. Main has
started adding this mode; its old `PgOriginalLedger/PgOriginalPolicy` still
target 019 and must be replaced together.

## Exact fixed-function interface

All functions are `(namespace text, request jsonb) -> jsonb` in
`c1_runtime_internal`. Every runtime request carries the controller `ticket`.
The adapter exposes `.fixed` for compatibility, but policy uses the fenced
`authorization()` function, not `private_policy_authorize` from old 019.

| Runtime-only method | Remaining request fields | Response |
| --- | --- | --- |
| `ledger_open` | none | `opened` |
| `ledger_get` | `key` | `row` or null, `revision` or null |
| `ledger_authorization` | `key` | `authorization`, `approval` |
| `ledger_reserve` | `key, grant, original, signatureUnits, gasUnits` | `reserved, replay` |
| `ledger_insert` | `key, row` | `inserted, revision` |
| `ledger_save` | `key, row, expectedRevision, expectedRow` | `saved, revision` |
| `ledger_seal` | `changed` (advisory; SQL measures material itself) | exact commit proof |

Python transaction methods match existing domains:
`get(key)`, `insert(key,row)`, `save(key,row)`,
`reserve_original(key,grant, *, original,signature_units,gas_units)` and
`authorization(key)`. A prior absent `get` is required for insert; a prior
present `get` supplies immutable row/revision CAS for save. Keys are global
`(kind, decimalChainId, lowercaseTargetAddress, bytes32OriginalId)`, where kind
is quote/operation/registration. Namespace is also pinned in every stored row.
Numbers crossing JSON that represent gas/signature money/nonce are canonical
decimal strings; metadata revisions/sequences are JSON integers.

| Controller-only method | Request |
| --- | --- |
| `ledger_status` | `{}` |
| `ledger_proof` | `mutation_id, sequence, digest` |
| `ledger_finish` | original reference plus `proof, journal_sequence, journal_digest` |
| `ledger_abort` | original reference plus `ticket` |
| `ledger_abort_finish` | original reference plus `proof, journal_sequence, journal_digest` |

Controller proof/finish functions never sign, mark chain success, reset grants
or release reservations. Abort locks the same state row as admission, proves
exact absent committed material and seals the original mutation id. A late
transaction using that id is rejected after the abort fence is cleared too.
If a transaction has already committed, abort refuses and original proof must
be finished. A failure leaves the request unknown until independent resolution.

## Approved material (Main's private policy writer)

The only approved-intent/grant provisioning path belongs to Main's private
policy owner. It is not provided to browser/API users. Table definitions pin:

* principal: `ns, login_name, role, chain_id, system_account`; `login_name` is
  PostgreSQL `session_user`, not a request field or mutable GUC;
* grant: `id, ns, revision, chain_id, system_account, role, enabled, expires_at,
  signature_cap, gas_cap`; spent counters/budget_revision belong only to reserve;
* authorization: global key fields plus `ns, revision, enabled, role,
  system_account, nonce, grant_id, grant_revision, reservation_original,
  initial_row, approval`.

`approval` is the exact existing runtime policy return: original, positive
revision, trusted profile, and grant `{id, revision, enabled, expiresAt,
signatureUnits, gasUnits}`. Registrar additionally requires `systemRole:
'registrar'` and the exact approved transaction plan `{nonce, gas, maxFeePerGas,
maxPriorityFeePerGas}`. `ledger_authorization` verifies stored approval revision
and grant against the current single grant table. Changed or revoked policy
closes signing and never authorizes replacement originals.

`initial_row` is exact domain insert material, produced only from independently
approved immutable preflight results:

* quote: `{original, prepared, stage:'QUOTE_SIGNING', reservation:grant}`;
* business operation: `{original, stage:'TRANSACTION_SIGNING', reservation:grant}`;
* registrar: `{original, approval, expected, reservation:grant,
  stage:'TRANSACTION_SIGNING'}`.

Quote/business `reservation_original` is the original domain record. Registrar
uses `{...originalRecord, transaction:approval.transaction,
profile:approval.profile, grant:approval.grant}`, exactly as RegistrarRuntime's
signer record. The row's original remains the normalized original domain record;
it is never compared with the enriched signer record as if they were equal.
The approved registration record retains owner binding/signature, prepared
paramsDigest, fixed factory/profile/codeHash and original transaction calldata.
The existing registration/business codecs verify these outside the transaction.
SQL pins the entire approved originals and initial rows, and also independently
checks role/from/to/chain/value0, approved nonce and gas*maxFee plan. Allowed
business roles/kinds are issuer/issue and operator/lock,markHandover,report;
fund/settle are excluded. Quote reserves exactly one signature and zero gas.

Codec/hash/signature preparation and raw validation remain outside SQL. A
policy writer must persist immutable preflight material using a private,
controller-fenced short DB transaction and seal it before use. Direct policy
table changes after bootstrap without a corresponding seal intentionally cause
material/head mismatch. **Main still owns this approved-intent writer integration;
no function here grants approval or makes a browser an authority.**

## External controller and restoration contract

Controller marker: `CP30_RUNTIME_LEDGER_CONTROLLER_V1`. Its calls run outside
the PostgreSQL transaction:

1. `begin(namespace, *, read_only)` independently compares durable DB status
   with retained external state and, for a write, fsyncs original PREPARED.
2. Return `{protocol, namespace, readOnly, checkpoint, mutation?}`. Checkpoint
   includes `ledgerRevision, ledgerHead, materialHash, epochs, floors,
   globalFloors, journalSequence, journalDigest`. Epochs are source_epoch,
   credential_epoch, restore_generation. Mutation has `id` UUID, `sequence`
   and 64-lowercase-hex `digest` from the retained PREPARED frame.
3. Adapter opens the short transaction, reserves+inserts or CAS-saves, seals
   proof and commits. Controller `finish(namespace,ticket,proposedProof)` must
   independently reread exact `ledger_proof`, fsync COMMITTED with proof/floors,
   acknowledge original `ledger_finish`, then independently match status.
4. Return `{finished:true, mutation_id, ledgerRevision, ledgerHead,
   journalSequence, journalDigest}` from the verified terminal checkpoint.
   `{finished:true}` alone does not authorize continuation to signing/broadcast.
5. `resolve(namespace,ticket)` uses independent committed proof or locked
   `ledger_abort` absence, fsyncs the corresponding original terminal frame,
   acknowledges finish/abort_finish and matches status. It cannot accept a
   caller's assertion that rollback occurred.

Floors domains: runtime_attempt (row revision), runtime_reservation (1),
runtime_budget (monotonic budget revision), runtime_authorization (approval
revision), runtime_nonce (1). Object keys are SQL SHA256 of the canonical JSONB
key's UTF-8 text; controller retains returned opaque keys, never recomputes them
using JavaScript/Python JSON formatting. Head/material hashes are restoration
commitments, not EVM crypto or synthetic chain transaction hashes.

`globalFloors` is `{runtime_nonce: {...}}` independently merged from every
retained namespace's external nonce floors. It must never be populated from
current restored DB rows. This prevents an old whole-DB snapshot from allowing
a system nonce retained under another namespace to be reused. Main's initial
runtime controller source currently lacks this field/merge and must add it.

Fresh bootstrap is a Main-controlled offline setup: provision trusted approved
material, independently retain its initial head/material hash/floors/epochs,
then seed matching DB state with that exact HEADER cursor. No runtime bootstrap
or recovery-reset setter exists. Restored epochs/material cannot be adopted
just because revisions are higher; every original reservation, signed raw,
nonce, counters and retained terminal proof must survive independent restore
verification. Missing external state or original proof fails closed. This leaf
does not claim to implement Main's epoch-adoption/restore orchestration.

## Install and grants (Main only)

Provision NOLOGIN owners/groups listed at the SQL header. Runtime executor
logins receive only seven runtime fixed functions; controller logins only the
five controller fixed functions. API, public, fixture and browser roles receive
none. Grant no membership in owner roles to application logins. No public
EXECUTE on either schema, no direct runtime table writes to executors. Existing
C1 guard reuse is confined to a narrow helper owned by c1_auth_code_owner.
Main's trusted policy owner can seed approvals/plans, but cannot update spent
counters, raw/hash or clear fences. Grant disable is final, counters never
decrease, and reservation/nonce rows are never deleted or released.

The shared function allowlists and controller IPC role are Main-owned. A
private controller finish response, global nonce-floor union, fresh bootstrap,
approved-intent sealed writer and independently verified epoch restoration
remain actual host integration work. This leaf creates no private signer, RPC,
receipt authority, profile, approvals, running service or installed database.

Offline verification only:

```sh
python3 -B -m unittest discover -s cp30-backend/integrations/persistence -p 'test_*.py'
```
