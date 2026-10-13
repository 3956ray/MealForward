# Detached StoreEscrow projection conversion

Source only. `projection.py` is pure Python conversion: no imports of observer,
model, source runtime, PG, provider, signing or cryptographic implementations;
no reads, writes, subprocesses, network calls or generated hashes. Main owns the
trusted caller, receipt provenance, original-record matching, SQL, controller
seal, permissions, CAS, projection watermark and deduplication.

## Inputs and exact calls

`observer_record(functionName, parameters, deployment, payloadHash)` returns the
observer's exact four-field dictionary, detached from the inputs.
Supported names are issue/lock/markHandover/report/settle/fund. Parameters use the
exact ABI names and canonical decimal-string integers documented in OBSERVER.md.
Deployment must already be the saved **six-field core**:
`{chainId, from, to, value:'0', data, callDataDigest}`. chainId is a positive safe
JSON integer; addresses, hashes and calldata are lowercase hex. Other descriptor
fields must be explicitly removed by Main before this call. Missing
callDataDigest is rejected; Main must obtain it from the existing viem codec,
never invent a SHA or substitute payloadHash. This helper validates shape only;
it does not verify a signature, calculate a digest or authenticate a caller.

`projection_rows(verifiedProof, intentId, storeAlias, mealAliases)` converts the
complete detached return of `StoreEscrowObserver.verify_original_operation`.
It accepts exactly that observer's fields, with authority
`VERIFIED_ORIGINAL_CHAIN_OPERATION`; a snapshot alone, missing original,
incomplete units, conflicting operation/event/block or unverified authority is
rejected. intentId is the original canonical lowercase UUID already saved by
Main. Store alias and the one-entry `mealAliases` dictionary are trusted local
bindings, with direction `{chainBytes32MealId: localMealAlias}`. Aliases are
bounded ASCII letters/digits/underscore/hyphen, beginning with a letter/digit.
They do not come from a browser or event-derived user identity.

`finalized_snapshot_rows(snapshot, storeAlias, mealAliases)` converts the complete
detached `read_finalized` return, with authority
`CANONICAL_FINALIZED_CHAIN_FACTS`. It returns no receipt, intentId, final success
or outbox completion. It can initialize actual funded counts/units/accounting;
these facts alone cannot confirm any pending original intent.

The authority string is a shape discriminator, not an authentication mechanism.
Only Main's private trusted observer path may invoke projection persistence.
A browser-created dictionary with that string never becomes verified evidence.

## Fixed output schema: CP30_CHAIN_PROJECTION_V1

Both functions return `{schema, authority, snapshot, units, vouchers, batches,
operations, absentVoucherIds, accounting, controls}`. Receipt conversion adds
`receipt` and changes authority to `VERIFIED_ORIGINAL_CHAIN_OPERATION`.

* snapshot: `chainId, escrow, blockNumber, blockHash, timestamp` copied verbatim;
* receipt: `intentId, store, functionName, opId, quoteId, payloadHash, original,
  event, operation, proof, chainId, escrow, transactionHash, blockHash,
  blockNumber, logIndex`. `proof` retains the entire observer return, including
  original complete same-block snapshot. Fund has `opId:null`, original quoteId,
  and `operation:null`; other operations have original opId and `quoteId:null`;
* unit: `store, seq, batch_id, local_index, payer, meal, meal_id, version,
  terms_hash, price, bucket, generation, voucher_id, issued_at, expires_at,
  lock_id, marker_id, marker_at, report_id, settle_id`;
* voucher: `id, store, seq, generation, terms_hash, issued_at, expires_at,
  issuer, lock_id, locked_at, operator, processor, marker_id, marker_at,
  handover_block, report_id, settle_id, expired`;
* batch: `id, store, payer, meal, meal_id, version, terms_hash, price, quantity,
  first_unit, refunded_mask`;
* operation: `op_id, kind, caller, payload_hash, result, executed_at, present`.
  `present` means actual `kind != '0'`, never `result != zero`. It is not an
  intent-success flag; unsupported related operation facts remain ordinary rows;
* accounting: `{store, totals:{F,A,R,H,S,X,liability,
  counts:{F,A,R,H,S,X}}}`; F comes from fundedAmount/fundedUnits. No token
  balance, solvency, surplus or physical delivery is inferred;
* controls: `store, paused, closed, control_revision, lifetime`, copied from
  actual controls and fundedUnits. No default listed/current catalog is made.

All ABI integers and block/log values remain canonical decimal **strings**.
chainId remains an integer. Bool values remain bools. IDs/addresses/hashes remain
lowercase hex. Lists have deterministic chain sequence/key ordering. Returns
are deep copies.

Unit bucket 0/1/2/3/4 maps exactly to A/R/H/S/X. unitPrice maps to price on both
unit and batch. Voucher handoverRecordedAt maps to marker_at and handoverBlock
to handover_block. Report/settle IDs are explicit original chain fields; no fake
intermediate bucket is inferred from an event. The receipt-block snapshot can
contain valid subsequent advancement within that block, including issue followed
by report/settle. Units retain the actual final same-block bucket.

Chain zero-word relationship IDs map to null; the entire raw snapshot in
receipt.proof preserves the original zeros. A unit with no chain voucher has
null issued/expiry/relationship fields, not a fabricated voucher. Requested
getVoucher absence (generation zero and complete actual zero tuple) is kept in
absentVoucherIds and produces no voucher row. Absence is not a deletion/revival
instruction. Operator/processor zero addresses in actual unlocked vouchers are
preserved. No UUID order_id or issue_op, email key, subject, recipient, access
credential or authority role is invented from a chain ID.

## Main's transaction boundary

Close preflight DB transaction; obtain original receipt proof through the trusted
observer outside transactions; perform this pure conversion; reopen the short
write transaction. Recheck session/intent/original calldata+params+payloadHash,
registered chain/escrow/roles, guard/controller floors, row versions and immutable
store/meal bindings. Compare `receipt.original` with the exact saved four-field
record and original transaction hash with the durable attempt. Store complete
receipt.proof and original locator before projecting.

SQL deduplication must bind original intent/opId or quoteId, chain, escrow,
transactionHash, blockHash, blockNumber and logIndex plus full original payload.
Same original repeats are idempotent; conflicts close projection. Main defines
the independently retained canonical watermark and same-block ordering rules;
blockNumber is not the old synthetic deployment.height. Same block does not
mean a fabricated before/after transition. Do not pass this object to old 009's
`apply_receipt` or synthesize model/source.dispatch envelopes. Existing 001's
unit/voucher rows also need Main's explicit chain mapping and private intent/FK
binding; this module intentionally supplies no old synthetic orders or identities.
The old rollup balance requirement cannot be satisfied by accounting liability;
Main must revise that projection or provide independently verified token facts.

## Evidence and limits

Shape/relationships derive from read-only StoreEscrow.sol structs/events,
business observer.py/OBSERVER.md and existing 001/009 schema naming. Three small
memory tests cover receipt/original preservation and same-block progression,
unverified/conflicting/incomplete rejection, fund plus empty finalized facts and
nonzero-kind zero-result preservation. They are serialization/conversion tests,
not live receipt or chain execution evidence. No existing observer test suite,
PG, RPC, keys, broad safety/fault matrix or old blocked runtime is exercised.

Run only this new leaf's checks from the project root:

```sh
python3 -B -m unittest discover -s cp30-backend/integrations/business -p 'test_projection.py' -v
```
