# Private registrar source slice — 2026-10-13

WIP / source only / NOT READY / NOT TESTNET CONNECTED / NOT ACCEPTED. No
PostgreSQL, private service, key loader, signer worker, RPC or deployment was run.

The actual private service is `c1.registration_runtime_host`. Its reviewed,
explicitly enabled composition uses the finalized `RegistrarRuntime`,
`NodeRegistrationCodec`, `TransactionCrypto`, `PgRuntimeLedger` and
`PgRuntimePolicy`; the API has only the existing private client. It accepts
`setup`, `registration_send_original` and `registration_lookup_original` with a
separate registrar-client capability. Public request fields cannot provide an
approval, nonce plan, grant, raw transaction, arbitrary signer role or endpoint.

Before first reservation, the private admission helper loads the durable original
registration, current verified owner binding, registrar principal and bounded
signature/gas grant. Outside the database transaction the host verifies the owner
signature/createStore payload and the finalized factory template, actual complete
runtime code hash and fixed factory getters, chain/genesis and available capacity.
It fixes the pending nonce and fees, then seals the exact approval in the one
ledger. The fresh reservation trigger rechecks the current owner binding under
locks in the same budget/nonce transaction. No new owner key is available here.

The signer has an append-only response journal in a new owned 0700 directory.
SIGNING is fsynced before the dedicated registrar handle is opened; the installed
viem signer receives key bytes through an inherited private file descriptor,
with an empty environment. It restricts chain, registrar, factory, zero value and
createStore selector, then independently decodes/recovers/checks its signed raw.
RETAINED is fsynced before returning. An interrupted SIGNING frame without a raw
response remains UNKNOWN and cannot be signed again. Key metadata is checked at
composition; source checks never execute this worker or read a real handle.

The runtime durably reserves signature/gas/nonce and retains raw/hash before its
single broadcast. The broadcaster rechecks current binding and chain/genesis;
provider failure cannot authorize a second send. Lookup can recover the original
retained raw/hash, including after binding/owner authorization expiry, and queries
only that hash. It cannot sign or broadcast. The hash is a locator; only the
existing finalized registration observer can confirm or publish the store/meal.

`c1.runtime_ledger_controller` is an independent private controller process. Its
external journal retains head, material hash, all object/budget floors, epochs,
original ticket and committed/aborted proof. It independently rereads SQL proof,
fsyncs terminal evidence, acknowledges the matching SQL fence, rereads status and
returns the complete commit acknowledgement. Cross-namespace nonce floors are a
union of **external retained journals**, never an adoption of current restored DB
values. Missing/unlisted namespaces, torn/missing journals, changed configuration,
material/epoch/floor mismatch and unknown original signing all close the service.
The private clock helper can advance only time/heartbeat with exact retained
checkpoint checks; it cannot clear halt or adopt an epoch.

## Independent setup source

`tools/connection-bootstrap.py` is separate from the old setup-runtime/local-run
modes. It was not executed except its disabled `prepare` function in an ephemeral
offline test directory. Its four source actions are:

- `prepare`: a completely new external directory, ownership marker, disabled plan,
  separate socket/ledger/registrar/log directories and an empty dedicated key slot.
- `initialize --plan <reviewed-private-plan>`: explicit activation, the pinned new
  Python dependency versions, PG17.11, a fresh Unix-only PG cluster/database,
  NOLOGIN owners/groups and two separate private logins. It installs migrations
  001–019 plus connection migrations 021–022; 019 is the exact finalized **single**
  ledger replacement, never coinstalled with the removed older ledger. No fixture
  is initialized; no identity, store, balance or success is fabricated. It seeds
  the reviewed registrar principal/grant, fresh namespace/guard, exact initial
  material/head/floors/epochs and matching fsynced external HEADER cursor.
- `start`: reviewed config digest checks, retained journals and independent startup
  status match, then only the two private services with empty environments. It
  sends no deployment request. Failed startup closes owned resources. Owned PID
  manifests and separate launch logs are retained; no journal recreation occurs.
- `stop`: signals only recorded PIDs with matching process birth and command.
  The database, original journals, key handle and config are retained for restart.

This source does not install Python wheels or provision a real registrar key.
Those are explicit internal configuration prerequisites using the new connection
lock and new dedicated custody, not requests for user-authored broker code. A
partial initialization is permanently closed: it has no retry/reset action and
stops its own new PG process on failure. Normal private-service restart reuses
original journal files. No snapshot import, new namespace adoption, epoch adoption
or restoration reset is implemented. These remain source work before recovery
acceptance; higher DB revisions alone are never adopted.

The installer creates only the private registrar/controller logins. Compatibility
API/worker/controller groups required by foundational DDL are NOLOGIN with no
application membership. Full API/identity service provisioning is a later
integration step; this bootstrap does not claim an end-to-end usable application.

## Verification

13 focused shared checks pass using temporary private files and fake DB/process/RPC
objects. They cover default closure, signing-marker restart and conflict, detached
retained response and torn frame, missing/symlink journal, independently verified
full finish acknowledgement, forged proposed proof rejection, sealed absence,
foreign pending recovery/global rollback, restore refusal, fixed RPC methods and
budgets, disabled fresh setup/config pinning and scope rejection before key access.
The finalized persistence adapter's 5 memory tests and registrar domain's 4 inert
stub tests also pass. Python AST and the two private Node entry syntax checks pass.
No real signed transaction was created. No SQL was installed/executed, so DDL,
privilege/locking semantics and actual startup are **UNVERIFIED**.

Next shared slice: actual business gateway and guarded real-chain projection,
quote/issuer/operator host composition, distinct approve/fund/settle wallet
attempts, short-lived fragment QR integration and the one-store/one-meal user
flow. Extra refund/catalog/admin actions remain explicitly closed. Original C1
blocked matrices remain stopped. Independent review and Leader acceptance remain
outstanding.
