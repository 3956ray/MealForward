# StoreEscrow readonly facts and original operation observer

Candidate source only. No RPC endpoint, provider, network request, wallet, signing,
PG/projection/role update or old runtime/configuration was accessed. The main
application owns durable original records, DB projection, roles and outbox gateway.
Every codec/transport/verification call here runs OUTSIDE a DB transaction. A caller
must close preflight, obtain detached facts, then reopen a transaction and compare
original record, permissions, guard and projection snapshot before any commit.

## Constructor and trusted profile

`StoreEscrowObserver(codec=BusinessCodec(ABSOLUTE_TRUSTED_NODE),
transport_factory=NEW_BOUNDED_SESSION, profile=REVIEWED_PROFILE)`.
Python import: `from integrations.business.observer import StoreEscrowObserver` with
cp30-backend on the application's module path. No existing codec/index/ABI is changed.

Profile must contain exactly:

- `binding:{chainId:number,escrow,asset,storeId,owner,receiver,quoteAuthority,
  catalogAuthority,issuerAuthority,operatorAuthority}`. Lowercase hex; all nonzero;
  owner==receiver. These fields must match retained registered evidence.
- `registrationState:'CONFIRMED'` and `registrationEvidence`: the persisted COMPLETE
  evidence from the independently VERIFIED registration observer, including original
  chainId (decimal string), store/asset/owner/receiver/authorities, escrow, configHash,
  parametersDigest, registrationId, original deployment/catalog and original
  transactionHash/blockHash. This is loaded through the main's trusted DB/config
  composition; accepting caller/browser evidence or a caller-set state is forbidden.
  Local shape checks cannot authenticate a dictionary's origin.
- `genesisHash`, `finality:'rpc-finalized'`, `eip1898:true` from the reviewed RPC/chain
  policy. No confirmation count, synthetic block or caller-final flag is supported.
- `runtimeTemplatePin:'0x2d6f320edd2627a18683f2fd37f45acd41f7fb4951c89b99e062650487ce191b'`.
  Same-build StoreEscrow immutable locations/template are checked by the existing
  pinned pure wallet helper; all actual public immutable getters are checked at the
  same canonical block. It is not an arbitrary user-provided runtime/template.
- `compilerPins`: explicit exact `observer.PINS` values after source review. Ten
  pinned business/accepted-wallet dependencies are read and SHA256 checked before
  observations. Missing, changed or unreviewed pins close construction.
- `budget:{maxCalls:96,maxTotalMs:20000,maxCallMs:3000,maxResponseBytes:1048576,
  maxTotalBytes:1048576,maxMealIds:1}` for the first one-meal scope. Positive explicit
  bounds only; maximum96 readonly RPCs/20s aggregate (including codec work)/3s per
  request/1MiB response AND aggregate/max3 meal IDs. Unit cap remains original10.
  Tightened budgets fail closed rather than return partial facts.

`transport_factory()` returns a fresh trusted session with
`request(method,params,deadline=ABSOLUTE_MONOTONIC_DEADLINE)->raw JSON-RPC result`.
The transport MUST enforce that deadline across DNS/TLS/response reading and raw
response limits; the observer additionally counts decoded result bytes/calls/time.
It is not a browser client. Only eth_chainId/getBlockByNumber/getCode/
getTransactionByHash/getTransactionReceipt/eth_call are emitted. Calls are sequential.
All state reads target binding.escrow and use
`{blockHash:CANONICAL_FINALIZED_HASH,requireCanonical:true}`. No getLogs, send/nonce,
latest/pending state read or fabricated fallback is emitted. The separate business
function whitelist is `observer.READS`; only named descriptors from prepareRead are
used. The old registration RPC transport rejects these additional selectors and
MUST NOT be loosened or silently reused. Main supplies a distinct reviewed business
transport/whitelist over these read descriptions.

## Finalized fact shape

`read_finalized(meal_ids=(),voucher_ids=(),op_ids=()) -> snapshot | None`.
Optional related IDs are trusted private lookup inputs, max4 voucher/max4 operation
IDs. Registered initial meals and observed units' meals are included automatically.
Only actual funded getUnit sequences are read: range0..fundedUnits-1, maximum0..9.
Reading nonexistent sequences is intentionally avoided because original getUnit
reverts. No placeholder unit, batch, balance, block, voucher or accounting is made.

Snapshot:

```text
{chainId,escrow,blockNumber,blockHash,timestamp,
 accounting:{fundedUnits,fundedAmount,counts:[A,R,H,S,X],amounts:[A,R,H,S,X],liability},
 units:[{seq,...actual Unit}],
 batches:{batchId:actual Batch}, vouchers:{voucherId:actual Voucher},
 operations:{opId:actual Operation},
 menu:{mealId:{currentVersion,listed,candidate:actual Candidate,terms:actual Terms|null}},
 controls:{paused,closed,revision}, terms:[{mealId,version,...actual Terms}],
 authority:'CANONICAL_FINALIZED_CHAIN_FACTS'}
```

All ABI integers, sequence/localIndex/bucket/generation, blockNumber/timestamp are
canonical unsigned decimal strings; chainId remains the configured safe integer.
Hashes/addresses are lowercase; original bools/tuple names/arrays are preserved.
A real currentVersion0 yields no existing current terms; Candidate.available=false
preserves the original all-zero candidate. Operation.kind0/result0 is preserved.
A zero result is NEVER an operation-presence/success test; e.g. original expiry of
unit0 can have a legitimate nonzero kind and zero result. This observer does not
confirm unsupported expiry operations, though related actual operation facts can be
read. No token balance/solvency or donation surplus is inferred from accounting.

Checks include actual F=A+R+H+S+X counts AND amounts, liability=A+R+H, every original
unit's counted price, batch/local/global sequence, original payer/meal/version/terms,
voucher generation/terms/unit linkage and retained issuer/lock/marker/report/settle
relationships. Terms for funded historical units are read separately from current
menu. Candidate available/expiry/nextGeneration is tied to actual units/vouchers and
canonical timestamp. paused/closed/listed flags come from the contract, not defaults.

## Original operation record and evidence

`verify_original_operation(record,tx_hash) -> evidence | None`.
Missing hash, pending/nonfinal/reverted receipt, mismatch, unavailable facts, budget
failure or unsupported function returns None. Main keeps UNKNOWN and queries the
SAME original locator; this leaf never sends/re-signs/renews a deadline/creates IDs.
Constructor configuration errors are fixed `BusinessObservationError` codes.

Record has exactly `{functionName,parameters,deployment,payloadHash}`. deployment
has exactly `{chainId:number,from,to,value:'0',data,callDataDigest}` copied from the
persisted original descriptor. parameters has the ORIGINAL named actual ABI inputs:

| functionName | parameters | permitted original sender |
|---|---|---|
| issue | opId,mealId,expectedUnitSeq,expectedNextGeneration,expectedTermsHash,deadline | issuerAuthority |
| lock | opId,voucherId,generation,deadline | operatorAuthority |
| markHandover | opId,voucherId,generation,lockId,deadline | operatorAuthority |
| report | opId,voucherId,generation,lockId,markerId | operatorAuthority |
| settle | opId,voucherId,generation | registered owner/receiver |
| fund | quote: ORIGINAL9-field FundingQuote, signature: ORIGINAL65-byte quote signature | original quote.payer |

Every uint input is a canonical decimal string (seq0 allowed); word/address/byte
inputs are lowercase hex. For the four business prepared descriptors, payloadHash
is EXACT prepared.paramsDigest (operationPayloadHash), not parametersHash or SHA
requestDigest. Main adapts it by copying the six deployment fields and saved
parameters. Settle payloadHash is the same original operationPayloadHash using
kind9/owner/original voucherId+generation; fund payloadHash is original FundingQuote
payloadHash from prepareFundingQuote, used in quoteUses. No crypto is handwritten:
fixed inline pure viem proof code in observer.py derives full payloads/calldata,
canonically decodes and reencodes the actual ABI. It launches empty-environment Node
with data only on stdin, 128-KiB input/1-MiB output/2s maximum; no temporary source
files, arbitrary module paths, signing or provider calls are involved.

Every original tx hash/chain/from/to/value/calldata and receipt hash/from/to/block
must match. Receipt block must be canonical and at/below the actual reviewed RPC
finalized block; canonical receipt block/chain are rechecked at the end. Logs bind
emitter, original transaction, block and logIndex; one deterministic business event
is required. Nonfund also requires the matching OperationExecuted event and actual
getOperation kind/caller/payloadHash/result/executedAt plus independent
operationPayloadHash view. Function-specific voucher/unit/result/event checks bind
generation, sequence, lock/marker/report/settle IDs, original terms and amount. Fund
binds Funded/quoteUses/getBatch/original allocated units to the quote payload. Final
same-block facts include legitimate subsequent advancement within that block,
rather than inventing an intermediate bucket from the event alone.

Evidence:

```text
{original:exact_record,transactionHash,chainId,escrow,blockHash,blockNumber,
 logIndex,event:{eventName,args,logIndex},operation:actual_Operation|null_for_fund,
 snapshot:complete_same_block_facts,authority:'VERIFIED_ORIGINAL_CHAIN_OPERATION'}
```

These are chain assertions, not physical delivery/meal consumption/identity proof.
Main must enforce its original saved caller/role/session/outbox, compare evidence
and current DB snapshot and only then project the allowed transition. Funds/events
are not browser-set success flags. No source in this leaf performs such projection.

## Offline checks and remaining dependencies

`python3 -B -m unittest discover -s cp30-backend/integrations/business -p 'test_observer.py' -v`.
Three focused tests use installed pure viem/BusinessCodec and only memory RPC/codec
values: full issue/fund/owner settle receipt proofs, real zero accounting/sequence0/
absent-operation result0 preservation, and nonfinal/wrong original/fork/unsupported
function/config mismatch closure. They are synthetic ABI/protocol checks, not real
contract execution or signature acceptance. No live provider/finality/runtime code,
physical flow, real token or identity has been verified. Lock/markHandover/report
code paths are implemented from original ABI but their full receipt paths have NOT
been exercised in these three checks; no broad matrix was run.

Main still supplies: trusted CONFIRMED evidence loader; independently bounded
business readonly HTTPS transport/selector policy; configured absolute Node;
reviewed genesis/finality/provider/token profile; original durable operation/funding
records and authenticated private issuer/operator gateway; owner/payer wallet
binding; canonical DB projection/CAS/recovery. Registration transport, shared
application, role rules, outbox and dependencies were not changed here.
