# Concrete original-registration registrar runtime domain

`registrar_runtime.py` implements a functional server domain for the required
automatic deployment path. It is not a Protocol-only broker placeholder. Main can
place this instance behind the existing authenticated PrivateRegistrarClient host
service and use it directly as OnboardingDispatcher's registrar dependency.
This source owns original validation, budget/nonce admission orchestration,
signing/retention/broadcast ordering and original-only lookup. Actual host keys,
durable DB/journal, policy, private transport and RPC composition remain main-owned.
No real service/signature/network process starts on import.

## Public Python surface, private host only

`RegistrarRuntime(policy,ledger,signer,broadcaster,registration_codec,
transaction_crypto,clock)` exposes:

- `send_original(record) -> originalTransactionHash`
- `lookup_original(record) -> originalTransactionHash | None`
- `original_lookup_protocol = 'CP30_ORIGINAL_REGISTRATION_V1'`

No owner-signing or arbitrary transaction entry point exists. Runtime validates
only original factory createStore: approved registrar, original chain/factory,
value0, original catalog/config/owner signature and fixed wallet-owned accepted
creation code. The only signer call is the platform registrar's original EIP1559
transaction; it never uses an owner's key. Hash return remains a locator, never
deployment confirmation/readiness or client success.

Register/enable and persistent queue remain existing onboarding domain methods;
after begin_attempt commits UNKNOWN, dispatcher calls send_original once. Further
UNKNOWN passes call lookup_original only. Main must connect the actual domain
instance/server, not ask the user to write another broker. There is no fake fallback
when the approved host policy/ledger/signer/query adapters are absent.

## Exact incoming original fields and normalization

Input is the existing private onboarding record. These required immutable fields
are retained and compared across all attempts:
`namespace,subject,owner,bindingRevision,key,request,requestDigest,registrationId,
storeId,original,prepared,ownerSignature,deployment`.

`original` contains chainId (canonical positive decimal string), factory, registrar,
asset, quoteAuthority, catalogAuthority, issuerAuthority, operatorAuthority,
escrowCreationCodeHash, registrationId, storeId, owner, deadline and real initial
catalog. `prepared` is NodeRegistrationCodec's exact
`{configHash,parametersDigest,typedData}`. `deployment` is its exact
`{chainId:int,from,to,value:'0',data,callDataDigest}`. Nonzero ids/hash fields and
lowercase addresses bind the top-level owner/store/id to the nested original;
bindingRevision is the trusted account-to-wallet revision, not browser evidence.
Owner signature stays private and is never regenerated.

Mutable onboarding state/transactionHash/escrow/readiness/evidence fields are not
part of the registrar's immutable request comparison. If input carries a
transactionHash, it MUST match the registrar's retained original hash; a missing
or different registrar attempt causes ORIGINAL_REGISTRAR_LOCATOR_CONFLICT, never
fresh signing. Main's policy independently queries the current server original
registration/outbox state and authority; it must not trust omitted/mutable input.
Scope key is `(registration,chainId,factory,registrationId)` across namespaces, so
the same contract id cannot alias another account/namespace/configuration.

Nonce/gas fields are deliberately not accepted from the incoming onboarding
record. The trusted current policy supplies the exact approved original plan and
pins described below. Runtime builds the private signer record as immutable
registration fields plus `transaction`, `profile`, `grant` from that policy.
Signer/broadcaster/ledger must compare this full private envelope consistently.
The approved plan must be durably bound to the original registration before it
can be supplied; policy cannot generate a new plan/nonce on each request.

## DB-only policy and actual grant/profile

`policy.authorize(tx,immutable_record,action) -> approval` executes only DB reads
inside a short ledger transaction. Actions: registrar_lookup, registrar_sign,
registrar_result. It must authorize the actual private caller/system registrar,
current registered account+owner wallet binding revision, approved persisted
original request/signature/digests/catalog, controller/restore guard, live factory/
chain profile pins and already-approved original nonce/gas plan. Fresh registrar_sign
requires the actual onboarding UNKNOWN original claim and durable task; a caller
supplied state/subject/owner/approval flag is never sufficient.

Approval has:
`{original,revision,systemRole:'registrar',profile,transaction,grant}`.
original is the entire normalized immutable record, revision a positive integer.
profile has original chainId/factory/registrar/asset/four authorities/
escrowCreationCodeHash plus trusted nonzero bytes32 factoryCodeHash and
chainProfileDigest. All original profile fields must match, not just factory
address. Main must populate these from its reviewed deployed profile/config and
verified same-chain code/immutable getter facts before policy can approve.

transaction has exactly `nonce,gas,maxFeePerGas,maxPriorityFeePerGas` as canonical
unsigned decimal strings; gas/max fee positive and priority<=max fee. grant has
`{id,revision,enabled:true,expiresAt,signatureUnits,gasUnits}` with approved caps,
not a mutable remaining-balance snapshot. Fresh signing requires one signature
unit and maximum gas amount gas*maxFeePerGas, unexpired owner authorization and
unexpired grant. The original grant/plan/revision/profile must remain unchanged
through preflight and result commit; policy revocation/binding/restore changes
reject before possible broadcast. Fresh broadcast also checks both expiries after
raw retention. Original retained transaction lookup does not renew deadline or
consume a second grant, and may occur after owner/grant expiry subject to current
policy guard/identity permission. Policy must distinguish lookup from fresh signing.

## Durable ledger and exactly-original state transitions

Use the existing private business durable host contract, imported read-only:
`ledger.durability_protocol = CP30_DURABLE_ORIGINAL_LEDGER_V1`.
`ledger.transaction(*,read_only=False)` yields detached, verified rows via
`get(key)` and mutation via `insert(key,row)` / `save(key,row)`.
Writes serialize original row and absent key; preflight read_only takes no write
locks, changes no state, and performs no external IO.

`reserve_original(key,grant,original=privateSignerRecord,signature_units=1,
gas_units=int)` must atomically validate actual grant revision/enabled caps and
remaining budgets, reserve this key once, and enforce exclusive approved
chain/registrar/nonce ownership across all original requests. No budget is inferred
from client data or debited twice. Reservation and TRANSACTION_SIGNING row insertion
share one durable commit. Unknown reservations cannot be automatically released.

Ledger row retains `original`, complete `approval`, exact crypto `expected`
envelope, reservation, stage, and eventually canonical original `raw` and
`transactionHash`. State flow is TRANSACTION_SIGNING -> BROADCAST_UNKNOWN.
The latter is saved BEFORE any possible broadcast. It does not claim sent/mined.
Only one fresh result-commit winner may invoke broadcaster once; simultaneous
replays get the original hash or ORIGINAL_REGISTRAR_ATTEMPT_UNKNOWN, never a new
signature. A recovery lookup may retain original raw/hash but never broadcast it.

Durability markers are assertions requiring real reviewed implementations; the
test memory ledger's marker is explicitly a stub. Actual ledger must enforce
immutable original/profile/plan fields, journal/backup/restore floors and reject
conflicting/missing retained material. An absent row after an unverified restore
must not become permission to sign again. A runtime crash before external signing
or before broadcast conservatively leaves possibly-executed UNKNOWN material.

## Existing registration codec and actual transaction crypto

`registration_codec` must be the actual reviewed NodeRegistrationCodec or an
equivalent trusted adapter with prepare(original), verify_owner_signature(original,
signature), prepare_deployment(original,signature). Fresh runtime calls all three
outside DB transactions; prepared configHash/parametersDigest/typedData and full
deployment must exactly match the saved original. This reuses wallet's frozen
Registration five fields/domain and fixed creation code; callers cannot add code
or constructor tails. For smart owners, the existing trusted server checker is
required; missing checker rejects. Runtime never creates a new owner signature.

`transaction_crypto` can be the existing actual `TransactionCrypto` class from
`business/transaction_crypto.py`, read-only imported/constructed by Main. Required
marker is CP30_CANONICAL_SIGNED_TRANSACTION_V1, with:

- `prepare_original_envelope(deployment,approved_plan)` where approved_plan is
  `{type:'eip1559',nonce,gas,maxFeePerGas,maxPriorityFeePerGas,
  gasBudgetWei:grant.gasUnits}`.
- `inspect_signed_transaction(raw,expected)` performing real canonical signed
  EIP1559 parsing, sender recovery and keccak(raw), returning `hash` and exact
  chainId/from/to/value/data/nonce/gas/maxFeePerGas/maxPriorityFeePerGas/type.

Runtime independently compares every returned transaction field and hash before
retaining/broadcasting. Replays and lookups recalculate the original envelope and
inspect retained raw/hash again; a changed hash, raw, sender, payload or fee/nonce
raises rather than trusting a restored success field. No synthetic hash method or
unsigned/signature-unverified fallback is supplied. These helpers run outside all
DB transactions. This task does not execute the actual crypto module or signing.

## Host-private signer/broadcaster and real composition gaps

Signer must expose original_signer_protocol CP30_ORIGINAL_SIGNER_V1 and
`sign_original_transaction(privateSignerRecord)->raw`,
`lookup_original_transaction(privateSignerRecord)->raw|None`.
It must journal this exact original registry/domain/digest/codepin/owner signature/
registrar transaction plan durably, bind approved private caller/role, and persist
its original raw result before returning. It holds only reviewed platform signer
material; the domain receives no key. Repeated identifiers cannot cause new
signature/nonce/fee/calldata. Lost response recovery queries only that original
journal. Missing signer result stays UNKNOWN, not definitely unsigned.

Broadcaster must expose original_lookup_protocol CP30_ORIGINAL_REGISTRATION_V1
and `broadcast_original(raw,transactionHash,privateSignerRecord)->originalHash`,
`lookup_original(privateSignerRecord,transactionHash)->originalHash|None`.
It must enforce actual private transport/current guard/grant/chain profile and
only transmit the retained raw once; no implicit retry, re-sign or replacement.
Mismatched response/RPC hash rejects. Missing original RPC observation still
returns a known locally verified hash as a locator, not a success/finality claim.

The new service domain is ready for Main's private registrar host to reuse. Still
required in actual composition: policy approved-original resolver and system role
authorization; durable ledger/nonce/gas grant/journal/restore implementation;
actual persistent platform signer and original response lookup; reviewed private
client/server transport; guarded broadcaster/original RPC lookup; configured
NodeRegistrationCodec and actual TransactionCrypto; owner-binding workflow;
persistent task scheduler/outbox; finalized factory/event/config/catalog verifier
and public readiness gate. No user-authored broker is part of this contract.
These adapters must be real and enabled before claiming automatic deployment is
connected. This source alone does not deploy or confirm a store, and its hash
response cannot bypass the existing onboarding final verifier.

## Independent bounded tests run

`env -i /usr/bin/python3 -B -m unittest discover -s cp30-backend/integrations/onboarding -p 'test_registrar_runtime.py' -v`

Four pure-stub tests cover one competing send/sign winner and one reservation;
raw/hash retention before broadcast stub; response-loss original-only recovery;
retained hash tampering; expiry/disabled grant/changed owner signature rejection;
wrong registration digest, changed policy revision and mismatched signed sender.
Stub signature/bytecode/raw/hash/catalog are explicitly inert test values, not a
deployable or cryptographically valid request. No real key/new key, Node crypto,
actual signer, broadcast/RPC, PG, old matrix or host runtime was executed.
Only registrar_runtime.py, this document and test_registrar_runtime.py are new;
existing service/dispatcher/business/wallet/shared sources are unchanged.
