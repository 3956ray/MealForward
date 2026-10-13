# Shared interface, implementation contract

Final freeze and incorporated complete Technical/Research/resolution documents
are normative. This file specifies integration, never weakens those requirements.

Python package `src/c1`, standard-library service transport. `db.Database(config,
role, database)` owns a bounded pool; `call(method, namespace, request)` invokes
only statically allowlisted `c1_api.METHOD(text,jsonb)` (business) or
`c1_authority.METHOD(text,jsonb)` functions, structured parameters, commits one
short transaction; returns JSON object. Errors are `{error: FIXED_CODE, status:N}`.
No arbitrary SQL or runtime direct private-table access. Producer config contains
only fresh owned role credentials and its own explicit capability, never another
role's secrets. Process CLI `--config <new owned config>`, empty environment.

Controller private IPC uses Unix newline JSON (<=64KiB), `{cap, namespace, method,
request}`. Role capabilities have static operation allowlists. API capability
can `security` for session/logout/reauth/recover/display and `query`; it cannot
fixture/create actors/execute. Worker can `source_dispatch`/`source_query`/
`cancel`; source alone can execution journal operations. Fixture test capability
can init/assertion/identity/grant/payer/clock/actor/fault/restore.

Controller security protocol: call business `security_reserve` for typed command,
permission+revision/fence CAS; journal PREPARED fsync; call controller-only
`security_prepare` registering actual sequence/digest; producer calls fixed
`security_apply` (immutable reserved command, no selectable fields), controller
independently reads `security_proof`; COMMITTED fsync; `security_finish` CAS clears
fence. On failed apply controller uses `security_abort` CAS fencing (late apply
denied), independently checks absence/proof then ABORTED fsync. A missing/torn
journal or lost proof quarantines; no guessing. Only hashed new credentials in
DB/reservations; raw values memory-only to authorized consumer after finish.

Execution protocol: worker `claim_job`, `stage_job` fixed original intent and
lease fencing; immutable stage ticket persisted before private source call.
Source uses `ticket_register` and `execution_view` to get original fixed payload
and authority snapshot; independent model computes S0b transition outside locks.
Controller `execution_prepare` reserves execution fence in authority, fsyncs
EXECUTION_PREPARED then registers sequence/digest. Source `execution_commit`
CAS validates ticket/revision/preparation, appends result/events/proof; controller
`execution_finish` independently verifies proof, fsyncs EXECUTION_COMMITTED,
clears fence; only then result is final. Original lookup never reexecutes.
Controller `cancel` uses business `cancel_begin`, authority `ticket_close`, then
business `cancel_finish` exact proof; no business locks across IPC/DB calls.

Source/reconciler private Unix sockets. Source `dispatch/query/close/actor` fixed
capabilities; fund/refund/settle require private actor confirmation. Workers cannot
actor-confirm. Reconciler loads original immutable authority receipts, verifies
scope/payload/events, source-ingest stores envelope then limited `apply_receipt`
applies trusted ID. Browser never supplies success/time/caller/receipt.

Authority snapshot JSON: manifest(scope and fixed addresses), catalog keyed
meal/version, heads and controls, units in global seq order, operations, balances,
height/parent/now/revision/source_epoch. Monetary fields canonical integer strings.
Each transition returns full before/after plus complete events and exact original
typed payload/caller/result/t0. Authority is synthetic, not EVM/finality evidence.

API `Application.handle(method,path,headers,cookies,body, origin)` returns
`(status, response_object_or_bytes, response_headers)`. HTTP worker owns strict
transport/input bounding and HTTPS; application owns route/request schema,
business function selection, security IPC, hash/image helper and cookie rotation.
HTTP must never log raw requests/errors. Consumer is child-only same-origin fetch.

Owned files: main all migrations/db/application/harness/tests/evidence/docs;
journal helper journal.py/ipc.py/controller.py and tests/test_journal.py;
authority helper model.py/source.py/worker.py/reconciler.py and tests/test_model.py;
transport helper codec.py/http.py/hash-helper.mjs/consumer/ and tests/test_codec.py.
These three helper turns are now terminal. Main has resumed integration ownership of their files; no concurrent helper writer is active. The user-approved temporary Developer model exception is gpt-6-astra/medium; historical helper records remain unchanged.
