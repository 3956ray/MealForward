# Private business original-request runtime domain

`private_runtime.py` implements functional `PrivateBusinessRuntime`, rather than
a transport-only Protocol. It owns quote/operation admission, original comparison,
budget reservation orchestration, signing/broadcast order, retained results and
original-only recovery. It does not implement host crypto/key storage, RPC,
PostgreSQL, HTTP/IPC transport, controller, durable journal or actual grant policy.
No runtime process or actual signing/broadcast is started by importing it.

Main's current private runtime client/service can reuse this domain behind its
authenticated private transport. No browser endpoint may instantiate dependencies,
approve intents, supply a key/profile/grant/nonce, call ledger setters or assert a
success/finality flag. Main owns shared policy, schema, runtime composition and
real host adapters; this leaf supplies no approval bypass or production memory DB.

## Entry points and concrete dependency contract

Construct using keywords:
`PrivateBusinessRuntime(policy=...,ledger=...,signer=...,broadcaster=...,codec=...,
clock=...,expected_role='quoteAuthority'|'issuerAuthority'|'operatorAuthority')`.
Use three profile-bound instances if all three roles are needed, sharing the
reviewed durable ledger and budget/nonce authority. No private key constructor
argument exists. The local clock must be trusted and non-IO.

- `sign_original_quote(record) -> originalSignature`: only quoteAuthority instance.
- `send_original(record) -> originalTransactionHash`: only issuer/operator instance;
  fresh original signs/sends once after durable admission, replays return retained
  original hash or raise ORIGINAL_ATTEMPT_UNKNOWN. Returning a hash is not success.
- `lookup_original(record) -> originalTransactionHash | None`: original query only;
  may retrieve the original already-created raw from the durable signer and retain
  its verified hash. It never signs or broadcasts, even when the raw never reached
  the network. None never grants permission for a new send/nonce/id.
- `original_lookup_protocol` is exactly `CP30_ORIGINAL_OPERATION_V1`, compatible
  with the declared private operation client contract.

Missing durable capability/crypto/original-query adapters reject construction.
Required trusted pins are ledger.durability_protocol
`CP30_DURABLE_ORIGINAL_LEDGER_V1`, signer.original_signer_protocol
`CP30_ORIGINAL_SIGNER_V1`, broadcaster.original_lookup_protocol
`CP30_ORIGINAL_OPERATION_V1`, codec.transaction_codec_protocol
`CP30_CANONICAL_SIGNED_TRANSACTION_V1`. These are composition assertions, not
proof that implementations exist; main must review actual adapters before setting
them. The test stubs explicitly claim them only to test domain behavior.

Common original record fields are `namespace`, full trusted business `binding`,
`escrowCodeHash` and `chainProfileDigest` (both nonzero lowercase bytes32). Binding
is the exact approved immutable chainId/escrow/store/asset/owner==receiver/four
authority profile from the business codec. The two extra pins refer to main's
reviewed escrow runtime code and chain profile, not caller-chosen arbitrary hashes.
Immutable original records must remain byte-for-byte/field-for-field equivalent
across policy, ledger and signer; extra fields are also included in comparison.

Quote records additionally contain `quoteId`, complete original `quote`, exact
prepared JSON `typedData` and EIP712 `digest` from business.prepareFundingQuote.
Operation records additionally contain `opId`, `operation` (issue/lock/
markHandover/report only), original `parameters`, complete prepared `deployment`
descriptor from the business codec, and approved EIP1559 `transaction` with exactly
`nonce,gas,maxFeePerGas,maxPriorityFeePerGas` as canonical unsigned decimal strings.
Gas/max fee must be positive, priority<=max fee, nonce may be zero. Runtime reserves
the worst-case native gas amount `gas*maxFeePerGas`; value is always zero. Asset
decimals/gas price/nonce are never guessed. No fund, settle, owner signing or generic
call is permitted through this runtime. Already-retained originals can be queried
after their business deadline; new preparation still rejects expired deadlines.

## Trusted policy and short durable transaction interface

`policy.authorize(tx,record,action) -> approval` is DB-only and must resolve main's
actual approved original intent, current account/role/owner binding, controller/
restore guard and exact reviewed profile/nonce/fee plan. Actions are quote_lookup,
quote_sign, quote_result, operation_lookup, operation_sign, operation_result.
Lookup/result checks do not create a fresh grant or new intent. Same approval data
must be returned while valid; a revision/binding/profile/grant change between
preflight and final commit rejects before any broadcast.

Approval has `{original,revision,profile,grant}`. original equals the entire input
record; revision is a positive integer; profile is
`{binding,escrowCodeHash,chainProfileDigest}` matching the reviewed record exactly.
Fresh signing grant has `{id,revision,enabled:true,expiresAt,signatureUnits,gasUnits}`:
revision positive, expiry strictly in the future, integer signature/gas allowance
strings. The policy must derive this from actual authority rows, never browser
booleans. Fresh signing needs one signature allowance; operations also need the
full maximum gas reservation. Quotes reserve no gas. Missing/disabled/expired or
insufficient grants reject before signing. Replay/query never consumes another
reservation. Fresh broadcast rechecks original grant expiry after retaining raw.
The returned signatureUnits/gasUnits describe stable approved caps, not a mutable
remaining-balance snapshot. Actual spent/reserved amounts are locked and checked
inside ledger.reserve_original; ordinary reservation changes must not masquerade
as a different policy revision. Revocation/profile/intent/grant revision changes
must still reject result commit.

`ledger.transaction(*,read_only=False)` is a short serializable/lock-scoped context
manager. Its transaction supplies:

- `get(key) -> detachedRow | None` with original-row/absent-key write locks in a
  write transaction; read_only performs neither writes nor external IO.
- `insert(key,row)` / `save(key,row)` with immutable original fields and monotonic
  stages, verified integrity/floors, and no unrestricted public setters.
- `reserve_original(key,grant,original=record,signature_units=1,gas_units=int)`:
  atomically validate the actual enabled grant/revision, caps, prior reservations,
  role, chain/from/approved nonce ownership and signing/gas budgets against durable
  authority data. It must reject competing use of the same nonce by a different
  original request and never debit the same key twice. Reservation and attempt-row
  insert share one commit. Caller allowance fields are not a substitute for DB caps.

Keys are `(quote|operation,chainId,escrow,quoteId|opId)` across namespaces; the
entire original also contains namespace so another namespace cannot alias it.
Sign and result commits compare the actual current trusted policy with preflight
approval, plus retained exact original. All codec, signer, broadcaster and original
query calls occur with no ledger transaction held. Required host timeouts and
short-transaction budgets belong to reviewed composition, not blocking loops here.

## Internal crypto/signer/broadcaster interfaces still required

Runtime codec is a trusted wrapper around existing pure business helpers plus a
new actual signed-transaction verifier:

| Method | Required implementation |
|---|---|
| `prepare_quote(record,now)` | Existing BusinessCodec prepareFundingQuote with original binding/quote, trusted now; returns actual typedData/digest/quote |
| `verify_quote_signature(record,prepared,signature)->bool` | Pure installed viem recovery of prepared original typed-data, exact fixed quoteAuthority and original OZ 65-byte/v/low-s representation; never trust signer-reported success |
| `prepare_operation(record,method,now)` | Existing prepareIssue/Lock/MarkHandover/Report from the method selected by runtime; original profile/caller/parameters only; descriptor must equal the retained deployment |
| `verify_signed_transaction(record,raw)->dict` | Decode canonical signed EIP1559 bytes using installed viem, recover signer, compute actual keccak(raw), validate chain/signature/type and empty approved access list; return exact chainId/from/to/value/data/nonce/gas/maxFeePerGas/maxPriorityFeePerGas plus transactionHash |

`BusinessCodec` alone does NOT implement the final row in this table or the new
runtime wrapper methods. Main must provide it; do not add the protocol marker to
the old codec and claim raw verification works. Runtime independently compares
every returned transaction field to the fixed deployment + fee/nonce plan before
retaining or broadcasting, and requires a nonzero original hash. The verifier
must perform actual cryptography, not fabricate an expected result from input.
Quote signature recovery on a retained original must use its original typed-data
without refreshing id/deadline, including response-loss lookup after expiry.

Internal signer methods are `sign_original_quote(record,prepared) -> signature`,
`lookup_original_quote(record) -> signature | None`,
`sign_original_transaction(record) -> raw`, and
`lookup_original_transaction(record) -> raw | None`. The signer is a host-private
adapter and must journal exact original requests/results durably before returning.
Repeated original identifiers must never make another signature/nonce/raw;
different parameters must reject. Uncertain signing retains the runtime SIGNING
row and reservation; later requests only query the original signer journal. If
that journal cannot recover it, the row remains UNKNOWN and no automatic retry or
budget release is allowed. A host signer/backend service does not grant itself
business permission and must also enforce reviewed private caller capability.

Broadcaster methods are `broadcast_original(raw,transactionHash,record) -> hash`
and `lookup_original(record,transactionHash) -> hash | None`. The fresh path invokes
broadcast only after the original verified raw/hash are committed in ledger with
BROADCAST_UNKNOWN. A transport error or different returned hash never changes the
original or triggers another broadcast. If a response is lost, replay/query uses
the same retained original and hash. Lookup can recover signer raw into the ledger
but cannot broadcast it. The broadcaster must enforce the actual reviewed private
grant/role/guard/network profile and bounded original-only RPC queries; it must not
silently re-sign, change nonce/fee or retry broadcasts internally. A retained local
hash or matching RPC locator never becomes a final-success flag.

## Recovery and remaining main work

Quote stages are QUOTE_SIGNING -> QUOTE_RETAINED. Operation stages are
TRANSACTION_SIGNING -> BROADCAST_UNKNOWN with original raw/hash retained. A process
crash before an external call deliberately leaves a possibly-signed/submitted
record; it must not be interpreted as definitely unsent. Concurrent same-id callers
are serialized by the ledger; only the first fresh attempt signs, and only the
first result commit in the fresh send path can broadcast. Reservations are not
released for UNKNOWN. No failures are rewritten as synthetic success/balances.

Real durable ledger/schema/backup/journal/restore floors, actual account/role/guard/
grant policy, private capability transport, nonce reservation ownership, host
key/signer journal, canonical signed-tx crypto verifier and original-only network
broadcaster are NOT implemented/configured here. Runtime must halt on missing or
conflicting restore material rather than recreate a request/key/nonce/reservation.
Main's fact projection/original receipt verification still determines business
confirmation/readiness. These domain methods must be integrated into the actual
host service before any claim of live private execution or automatic business
completion. This task modifies only the three new files, not accepted codecs,
onboarding, wallet observer, shared API/SQL or dependency manifests.

Replay/recovery rechecks retained quote signature against its original typed-data
and fixed quoteAuthority outside transactions. Retained operation raw is decoded/
recovered/hashed again before returning its hash or querying RPC; changed stored
hash, sender, payload, gas/nonce or missing raw rejects rather than trusting a
restored success flag. Lookup may retrieve only original signer-journal material,
never recreate it. The stub test mutates the retained hash to confirm rejection.

## Observed bounded offline test

`env -i /usr/bin/python3 -B -m unittest discover -s cp30-backend/integrations/business -p 'test_private_runtime.py' -v`

Four tests use only inert stub raw/signature/hash values and memory ledger:
original quote retention and changed original rejection; one competing sign
winner and single budget debit with hash retained before broadcast stub; uncertain
sign/broadcast recovery querying originals only; grant/owner-operation/raw mismatch
rejection. No cryptography/private key generation, actual signing/broadcast/RPC,
PG, old blocked tests or host runtime is executed. Test protocol claims and stub
hashes are explicitly synthetic evidence, not production durability or crypto.
