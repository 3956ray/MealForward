# Store onboarding domain candidate

This directory implements an offline, dependency-injected domain module plus a
tested concrete pure viem/wallet subprocess adapter. It is not
connected to application routes, durable PostgreSQL, real sessions, wallets,
registrar execution, or chain finality. The memory store and identity/crypto/receipt
fakes exist exclusively in `test_service.py`. No SQL or current security tests were
changed or run. Empty-store instant deployment is unsupported: the accepted escrow
requires a nonempty real catalog, so the owner supplies a real first-meal draft and
explicitly enables deployment. No placeholder meal is generated.

## API boundary for Lead Developer

Load `service.py` as an internal module. Only the Lead Developer owns shared routes,
Database allowlists, session/storage/guard/outbox adapters and public projections.
Suggested HTTP mapping (not installed):

| Route | Domain operation | Browser body |
|---|---|---|
| `POST /v1/store-registrations` | `register(context, Idempotency-Key, request)` | `{name,deadline,firstMeal:{name,description,unitPrice,imageRef,windows}}` |
| `GET /v1/store-registrations/{registrationId}` | `get(context,id)` | none |
| `POST /v1/store-registrations/{registrationId}/enable` | `enable(context,id,ownerSignature)` | `{ownerSignature}` |

`deadline` and `unitPrice` are positive canonical decimal strings, not floats.
Price is already in the explicitly configured asset's base units. Asset identity,
decimals, price for the first test token, time source and allowed deadline policy
must be configured/reviewed by the shared backend; this module infers none.
Windows are one or two ordered, nonoverlapping pairs in `[0,1440]`, matching the
original escrow. No subject/email/wallet/chain/authority/config hashes from the
browser are accepted as identity or backend configuration. The application uses
its existing origin, cookie hashing, CSRF, rate limit and controller/restore guard
conventions; it must not expose worker operations as HTTP success setters.

`SessionContext(namespace,session_hash,csrf_hash)` carries only server-hashed cookie
and header references. `IdentityAuthority.authorize(tx,context,action)` must invoke
the existing session/CSRF authority and current guard using DB-only calls inside
each preflight/commit transaction, then return `OwnerIdentity(subject,owner,binding_revision)` from a
verified, enabled owner-wallet binding. Mutations require CSRF and wallet binding
revalidation. `read` requires ownership but not CSRF. All bindings are rechecked on
replay; stale/revoked identities fail closed. Browser addresses and current
`auth_me` responses cannot provide this identity. Signature authorization alone is
not a replacement for the trusted account-to-wallet binding.

`register` saves immutable original browser parameters, SHA256 canonical audit
digest, server-generated nonzero bytes32 registrationId/storeId, verified identity
binding revision, exact real draft and initial CatalogEntry, immutable factory
configuration, chain signing digest and owner typed data. Same scoped key and same
request return the original record; changed parameters reject. A draft is private.
Draft editing is outside this minimal module: a different reviewed request needs
a new key; never mutate an already enabled registration.

`CatalogBuilder.build(tx,identity,draft)` is strictly a DB-only snapshot/revalidation
adapter. It reads already normalized, verified, immutable owned draft/image
material and commitments computed beforehand with the existing content encoding.
It must not read a file, launch a hash subprocess or contact an external service.
The same durable draft must have a stable server-assigned mealId on every read.
It returns one `CatalogEntry{terms,current:true}`, with `version:'1'`, the exact
validated unitPrice/windows, and nonzero body/image digests. Service validation
checks this shape and equality, but the injected builder is responsible for actual
content verification/ownership before onboarding preflight. Commit reads the same
material again and compares the full catalog; changed/unavailable material rejects
with `CONTENT_SNAPSHOT_CHANGED`. It must never trust browser-supplied hashes. If the
real content pipeline has not prepared such immutable verified material, the
adapter is missing and registration must fail closed instead of doing IO in a DB
transaction or manufacturing commitments.

## Short transaction and external-IO boundary

`Storage.transaction(*,read_only=False)` now accepts a mandatory-supported optional
read_only flag. `register`, `enable`, `reconcile` begin with short read-only
preflight transactions. Every Node codec call, EOA/server signature check and
ReceiptVerifier call runs after preflight closes and before commit opens. Local
id generation is also outside transactions. The clock must be a trusted local
pure value source, not network/subprocess IO. Identity, catalog and storage
operations in transactions are DB-only, including slot admission against already
verified persisted capacity; no controller IPC or chain call may hide inside them.

- Register commit reauthenticates session/CSRF/owner revision, rechecks scoped key,
  deadline/config/content snapshot, then inserts. A concurrent same-key/same-input
  winner returns its original ids/typed data; different input rejects. The storage
  writer must serialize the logical `(namespace,subject,key)` scope even when no
  row exists; final by_key + insert cannot be an unlocked check-then-write race.
- Enable commit reauthenticates, locks original record and compares every immutable
  request/config/typed-data/digest field plus DRAFT snapshot/state/deadline. A
  matching concurrent enabled result returns without a second queue entry. Changed
  permission, binding revision, record, digest or state rejects before writes.
- Reconcile preflight and commit call the new
  `IdentityAuthority.authorize_internal(tx,record) -> OwnerIdentity`: an internal
  observer capability/guard + current trusted account/owner-binding check. Observer
  has no browser session context and must not invent one. This DB-only authority
  method must fail on disabled account/binding or controller/restore guard state.
  Commit locks and compares full original/deployment/tx/state snapshot before
  atomically confirming and publishing. Concurrent equivalent confirmation
  returns without publishing again; other changes raise `SNAPSHOT_CHANGED`.

Original public/worker/codec/verifier method signatures are unchanged by this
transaction repair. Both new adapter contracts above must be implemented by the
shared backend; existing permissive placeholders do not satisfy them.

## Concrete wallet/factory codec

`codec.py` supplies `NodeRegistrationCodec(node_executable,clock,
owner_kind_resolver,smart_wallet_checker=None)`. The executable must be an absolute
trusted installed Node path. Each call starts the fixed `registration-codec.mjs`
helper with an empty environment, 2-second timeout, maximum 256-KiB JSON input and
1-MiB output. There is no inherited NODE_OPTIONS, signer, provider or network client.
The smart-wallet checker is an injected server interface, not a bundled RPC call.
`prepare(original)` returns the real wallet/viem hashes and JSON typed data;
`verify_owner_signature(original,signature)` uses pure viem EOA recovery when a
trusted resolver classifies the bound owner as EOA. Unknown type rejects. A
SMART_WALLET requires the separately reviewed
`smart_wallet_checker(original,parametersDigest,signature) -> bool`; no checker
means `OWNER_SIGNATURE_CHECKER_REQUIRED`. The resolver must derive owner type from
trusted binding/code evidence, not a browser flag. These interfaces do not create
or authenticate a session or a wallet binding.

`prepare_deployment(original,signature)` returns exactly
`{chainId:int,from:lowercaseAddress,to:lowercaseAddress,value:'0',data:hex,
callDataDigest:bytes32}`. It calls sibling wallet `prepareCreateStore`, whose fourth
bytes argument is its fixed `compiledStoreEscrowCreationCode`. The backend
FactoryConfig additionally requires `escrow_creation_code_hash`; current same-build
pin is `0x3aed59967d18f9b80a436f1080f9b55b5ea9299f62eb1c7d8f612d7ed8d30b4e`.
Old S0b bytecode metadata has a different hash and must not replace this pin.
`validateEscrowCreationCode` checks the trusted profile against that constant on
every codec operation. Neither Python constructor, public route nor JSON protocol
accepts caller bytecode/constructor tails. The pin is a trusted profile field,
not an extra signed Registration field: the original five fields/domain/configHash
remain unchanged. Actual deployed immutable code hash must also be checked by the
future final receipt verifier.

One-shot JSON protocol is `{op:'prepare'|'verifyEOA'|'deployment',original,now:'...'
,signature?:'0x...'}` on stdin and one JSON object on stdout. `original` is the
persisted server object with chainId, factory, registrar, asset, all four named
authorities, escrowCreationCodeHash, registrationId, storeId, owner, deadline and
catalog. ChainId/uint256 fields use canonical decimal strings; minute/count fields
are validated integer values that the bridge converts to strings for wallet ABI
validation. Typed-data output converts bigint to decimal strings; chainId stays a
safe JS integer. `verifyEOA` returns `{valid,mode:'EOA_RECOVERY',recoveredAddress?}`.
Errors return `{error:'REGISTRATION_CODEC_REJECTED'}` plus nonzero exit status;
Python raises `CODEC_UNAVAILABLE`. No original signature/private input is logged.

Run a single synthetic fixture without signing:
`env -i /Users/mili/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node cp30-backend/integrations/onboarding/registration-codec.mjs < cp30-backend/integrations/onboarding/codec-fixture.json`

Observed fixture configHash is
`0xa990329c556e2facea499445db3123dd3b3f934bdae0d38ab1679205c7119218`;
parametersDigest is
`0xc0d49762c015d70965a3ec158468cf680e32eade44321a670c63a2bfd58ac3da`.
These synthetic numbers are interoperability evidence, not deployment/identity
configuration. The fixture has fake content commitments and cannot pass a real
CatalogBuilder or authorization workflow.

`RegistrationCodec.prepare(original)` must return exactly
`{configHash,parametersDigest,typedData}` using the sibling wallet module:

1. Build trusted `binding` from original `chainId` converted to a positive safe JS
   integer plus factory/registrar/asset/quoteAuthority/catalogAuthority/
   issuerAuthority/operatorAuthority; all addresses are lowercase in this domain.
2. Call `registrationConfigHash({binding,storeId,owner,catalog})` from
   `../wallet/index.mjs`. It is exactly
   `keccak256(abi.encode(asset,quoteAuthority,catalogAuthority,issuerAuthority,operatorAuthority,storeId,owner,catalog))`.
3. Call `prepareRegistrationTypedData({binding,wallet:{chainId:binding.chainId,
   account:original.owner},registration:{registrationId,storeId,owner,deadline,
   configHash},catalog,now:trustedCurrentTime})`. This wallet descriptor is only
   offline preparation; it does not prove a wallet connection or identity.
4. Compute `parametersDigest` with installed viem `hashTypedData(typedData)`.
   This matches the candidate factory's `registrationDigest`/registrationUses
   digest: the five Registration fields in their frozen order, including deadline,
   plus domain `MealForward Store Registration`, version `1`, original chainId and
   factory. Catalog/all five authorities are committed by configHash. Serialize
   all bigint fields deliberately to canonical decimal strings at the Python/JSON
   boundary. The SHA256 requestDigest is exclusively audit/idempotency, not a
   signing digest. There is no home-grown EIP712 fallback here.

The wallet module itself only prepares typed data; the concrete onboarding codec
uses installed viem `recoverTypedDataAddress` for the EOA branch and checks the
factory's 65-byte/v/low-s signature shape. No cryptographic primitives are
reimplemented. ERC1271 remains the trusted server checker integration above.
Signature bytes remain private. No signatures are made or secrets loaded here.

## Deployment and original-receipt binding

`enable` verifies the original owner authorization and unexpired deadline, reserves
one of the three immutable factory slots, and saves PENDING plus unique outbox job
in one transaction, together with the codec-generated exact deployment calldata
and its keccak digest. Same signature retries return original state, including after
deadline; a changed signature rejects. This is queue admission, not deployment.

Internal authenticated worker calls `begin_attempt(namespace,originalId)` before
any possibly submitted action. The durable transition PENDING -> UNKNOWN commits
before returning the original private record. Every subsequent begin returns None.
An unattempted PENDING job whose deadline already expired is rejected before it
can leave the database; the module does not refresh its deadline or authorization.
Worker uses exactly the saved Registration/catalog/signature and registrar. It
calls `observe_transaction` to retain a single original hash; replacement hashes
reject. If interrupted or submission is uncertain, UNKNOWN queries only that hash
and/or original registrationId. It must not create a replacement registration,
resign, enqueue a second deployment, or treat a missing hash as definitely unsent.
The domain does not broadcast. The dispatcher below invokes only an injected,
separately configured trusted registrar client. Definite failure/revert recovery is outside
this minimal candidate; such evidence never publishes the draft.

Internal observer calls `reconcile(namespace,originalId)`. Its injected
`ReceiptVerifier.verify_original(original,originalTxHash,deployment)` receives the
stored exact deployment payload and no arbitrary
client receipt and returns None unless independently final/canonical. Success
must check original transaction chain/from registrar/to factory/value/calldata;
original `StoreCreated(registrationId,storeId,escrow,owner,configHash,slot)` from the
original factory; registrationUses digest+escrow and escrowFor mapping; accepted
factory/escrow code and immutable escrowCreationCodeHash; exact fourth bytes argument
from original calldata; escrow asset/storeId/owner==receiver/all four authority getters;
and exact current/listed initial catalog. Verify finality according to reviewed
chain policy, not elapsed time, a client boolean, or the wallet module's
MINED_UNVERIFIED result. Include original immutable parameters, configHash,
parametersDigest, receiver, escrow, transactionHash, blockHash, integer blockNumber
and logIndex plus exact `deployment` in the detached evidence object. Service compares every original
parameter/catalog/hash plus retained tx locator before committing CONFIRMED.

`save(CONFIRMED)` and `publish_confirmed(record)` are one transaction. The public
store/menu projection and funding quote/support paths must join the persisted
CONFIRMED registration gate; otherwise the accepted escrow's constructor-listed
catalog could appear prematurely. The returned ready flag describes this domain
gate, not real integration health or permission to bypass other guards. Replays
preserve original escrow and evidence even after authorization expires.

## Automatic deployment dispatcher and required original-only registrar

`dispatcher.py` now provides `OnboardingDispatcher(domain,registrar,tasks).step()`.
It is a concrete bounded consumer adapter, not a running worker or registrar
implementation. The shared application/runtime must start and own the scheduler,
shutdown, guarded error reporting and backoff; this leaf starts no process, thread,
server, RPC client or key loader. Its only new domain accessor is
`original_attempt(namespace,registrationId) -> detached private record`, using a
read-only transaction with current internal owner/guard authorization. Do not
expose that record, signature or accessor through the public API.

The required task-source interface is
`PersistentTaskSource.next_task() -> {namespace,registrationId} | None`. Implement
it over the same durable outbox committed by enable; close its DB transaction
before returning. Select PENDING/UNKNOWN jobs and revisit UNKNOWN with bounded
backoff until the persisted original record is confirmed. Duplicate delivery is
allowed: domain.begin_attempt locks original state and gives just one PENDING
winner the private UNKNOWN record. Other competing dispatchers get None and may
only query the original. Do not use memory queue examples as a durable adapter.

The required registrar-client interface is:

| Member | Exact contract |
|---|---|
| `original_lookup_protocol` | Trusted composition pin exactly `CP30_ORIGINAL_REGISTRATION_V1`; absent/mismatched profile rejects dispatcher construction with `REGISTRAR_ORIGINAL_LOOKUP_REQUIRED` |
| `send_original(record) -> transactionHash` | Use only saved deployment, registration signature and fixed creation-code/config/profile; server persists the immutable original attempt before any possibly signed/submitted action; no new owner authorization/signature or replacement calldata |
| `lookup_original(record) -> transactionHash \| None` | Original-only read/query of that durable server attempt; independently verify original registrationId, factory, chain, parametersDigest, codehash and full deployment equality; never send, sign, choose another nonce or return success |

The trusted profile pin is not proof that a registrar exists. Main must only
configure it after the actual private registrar implements this contract. Client
and registrar requests must be authenticated by reviewed private capability/
identity transport; no browser origin can call send/lookup or assert this pin.
The server ledger must scope original attempts by chainId+factory+registrationId
across namespaces, retain exact chain/from/to/value/calldata+callDataDigest,
authorization parametersDigest/codehash and an immutable original tx locator,
and survive response loss/restarts. Its restore rules must reject altered originals
or missing possibly-submitted material. Repeated sends of an already-known id must
return/reject the original without signing another transaction. A signer/private
key never enters this domain, dispatcher, task source or public DTO.

`step` sends only after begin_attempt has durably committed UNKNOWN and rechecked
current internal identity/binding/guard. Registrar calls happen with no DB
transaction held. Hash return is only a locator: observe_transaction reauthorizes
internally and retains one original hash, then reconcile performs the already
defined independent finality/event/config/calldata verification outside its DB
transactions. No registrar/browser success flag can make the store ready.

Any send/lookup exception yields `UNKNOWN/REGISTRAR_UNAVAILABLE` without exposing
raw errors or private records. The next step only calls lookup_original, even if
the exception occurred before a hash/attempt response. A None lookup is unknown,
not a claim that nothing was sent and never permission to resubmit. A concurrent
observer snapshot change returns `UNKNOWN/ORIGINAL_SNAPSHOT_CHANGED` for the next
original-only query; permission/binding or original hash conflicts still reject.
Expired unattempted PENDING remains PENDING with `AUTHORIZATION_EXPIRED` and no
send; main may park that job for reviewed recovery, but must not refresh its
deadline, release UNKNOWN capacity, or manufacture a replacement id. An already
UNKNOWN registration continues querying the original even after deadline passes.
Only persisted final confirmation permits outbox completion/public readiness.
Client methods need bounded reviewed transport timeouts and cancellation; a
method must not poll indefinitely or retry a send internally.

Actual persistent task source, authenticated registrar with durable original
attempt lookup, scheduler composition and final chain verifier remain missing
shared adapters. A missing registrar rejects configuration; this directory does
not provide a fake-success fallback or claim a deployed/live automatic flow.

## Actual missing shared integrations

- `src/c1/application.py` currently hashes the existing cookie/CSRF into request
  references and dispatches fixed DB methods. None of the three onboarding routes
  above exist there. The existing controller guard must also protect onboarding.
- `src/c1/db.py` has fixed `BUSINESS`/`READ_MODELS` allowlists; no onboarding methods
  exist. `Storage`, slots, original outbox admission/claim and atomic confirmed
  publication remain unimplemented durable adapters, not this test memory store.
- `migrations/002-common.sql` provides `c1_private.auth` and existing-store
  `owner_auth`; `003-security.sql auth_me` returns authenticated/stores, not a
  subject/verified wallet binding. `001-business.sql` has payer bindings and
  store grants, but no self-registration owner-wallet binding. A trusted binding
  workflow/storage adapter is necessary before registration can work for owners.
- Current real login claim profile, owner identity, content adapter, registrar
  service/outbox, smart-wallet checker, trusted EOA classification/real owner binding,
  RPC/chain/factory profile, finality verifier,
  public/support gates and deployment/gas policy are NOT connected here.
- No migrations, current SQL/controller/journal code or original safety tests were
  edited or executed. No PostgreSQL, browser, Anvil, network, identity, signer,
  deployment, broadcast, cloud/push or existing runtime was accessed.

## Offline test command and observed result

From the project root:
`env -i /usr/bin/python3 -B -m unittest discover -s cp30-backend/integrations/onboarding -p 'test_service.py' -v`

Twelve Python synthetic tests passed: same-key replay, changed-parameter rejection, UNKNOWN
cannot enqueue/start twice, wrong original receipt object rejected, and readiness
only after verified-original confirmation; plus real subprocess JSON prepare/deploy
interoperability and missing smart checker closure. Run these with `-p 'test_*.py'`.
The two transaction-specific tests assert depth==0 for all codec/verifier calls,
read-only transactions reject writes, a concurrent registration winner is retained,
confirmation replay publishes once, and preflight permission/original-digest changes
prevent queue admission.
Four dispatcher tests add: two competing workers have one send winner; response
loss remains UNKNOWN then lookup-only; expired/missing lookup configuration never
sends; begin_attempt/observe_transaction reject changed internal owner bindings.
The registrar and locked queue are test-only memory fakes, not persistence or
real signing/broadcast evidence.
Three ESM interoperability tests passed with
`env -i /Users/mili/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test cp30-backend/integrations/onboarding/registration-codec.test.mjs`:
wallet/config/EIP712 digest equality, fixed four-argument bytecode payload/pin
rejection, and pure EOA recovery/wrong-owner rejection without keys or signing.
These checks prove offline encoding and domain transitions,
not real identity/crypto/finality/persistence or full product acceptance.
