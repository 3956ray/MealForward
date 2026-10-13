# Canonical signed EIP1559 transaction inspection — crypto leaf

`transaction-crypto.mjs` uses installed viem2.57.1 parseTransaction,
serializeTransaction, recoverTransactionAddress and keccak256. Installed viem's
existing Noble dependency checks signature scalar ranges/low-S. There is no
hand-written RLP, curve arithmetic, key input, signing implementation, provider,
RPC, broadcaster, runtime service or persistence in production source.

Only the new crypto source/checks and this document were written. Existing
BusinessCodec, private_runtime.py, observer.py, exports, application, SQL,
contracts, dependencies and locks were not changed. This is a codec facet for
Main to compose, not the complete configured PrivateBusinessRuntime host.

## Exact API and value shape

Pure ESM functions exported directly from transaction-crypto.mjs:

```text
prepare_original_envelope(descriptor, approvedPlan) -> expected
await inspect_signed_transaction(raw, expected) -> observed
```

Python bridge from `business.transaction_crypto`:

```python
crypto = TransactionCrypto(absolute_installed_node_path)
expected = crypto.prepare_original_envelope(descriptor, approved_plan)
observed = crypto.inspect_signed_transaction(raw, expected)
```

descriptor's required core is `{chainId,from,to,value:'0',data}`. Existing
operation metadata can accompany it. If present, callDataDigest must equal
keccak256(data), and descriptor.type must be eip1559. Main must derive this
descriptor from the same approved original operation, fixed role/deployment and
existing business ABI codec, never browser authority.

approvedPlan is **exactly**:

```json
{"type":"eip1559","nonce":"0","gas":"50000","maxFeePerGas":"2","maxPriorityFeePerGas":"1","gasBudgetWei":"100000"}
```

These example values are synthetic only. Main supplies the original approved
nonce/gas/fees and an explicit approved native gas budget. No fee, nonce, type or
budget is inferred from a provider/browser. All unsigned integers in the plan
and output are canonical decimal strings; chainId is a positive safe JS integer.
Nonce is restricted to safe JS integer range because installed viem's transaction
parser uses a number. Fee/gas/budget integers are uint256; gas and max fee are
positive, priority fee can be zero and cannot exceed max fee. Worst-case native
gas cost `gas*maxFeePerGas` must be at most gasBudgetWei. Native gas wei is
separate from ERC20 base units. This check does not debit/reserve a grant.

prepare returns the descriptor core plus the full plan, with lowercase addresses
and hex data. It does **not** serialize/sign/send a transaction. inspect requires
exactly those expected keys, including explicit eip1559 type and gasBudgetWei.

Observed output is exactly:

```json
{"hash":"0x<actual keccak256 signed raw>","chainId":31337,"from":"0x<recovered sender>","to":"0x<original target>","value":"0","data":"0x<exact calldata>","nonce":"0","gas":"50000","maxFeePerGas":"2","maxPriorityFeePerGas":"1","type":"eip1559"}
```

Only fully signed type0x02 EIP1559 with an absent/empty access list is accepted.
Unsigned, legacy/EIP2930/blob/authorization-list, contract-creation, nonzero-value
or nonempty-access-list transactions reject. r/s must be valid low-S scalar
values and parity must be 0/1. The decoded signed transaction is reserialized
with viem and compared byte-for-byte; nonminimal RLP/integer encodings, trailing
bytes and truncation reject. Hex letter case is normalized because it does not
change bytes. Sender is recovered from the actual signed bytes, never copied
from expected. Every approved chain/from/to/value/data/nonce/gas/fee/type field
must match exactly; hash is actual keccak256(raw), not a request/audit hash.

## Private Runtime host facet

The optional convenience method is:

```python
result = crypto.verify_signed_transaction(record, raw, gas_budget_wei=approved_native_budget)
```

It takes record.deployment and the existing four record.transaction fields,
constructs the explicit eip1559 plan with the supplied budget, performs inspection,
then returns observed plus `transactionHash=observed['hash']` for the existing
Runtime comparison/retention convention. The budget parameter is mandatory and
trusted. Main's host wrapper must pass its approved original budget and keep its
live grant/reservation/approval rechecks; do not add budget to the existing
four-field transaction tuple silently or fetch it from browser input.

The class exposes `transaction_codec_protocol=CP30_CANONICAL_SIGNED_TRANSACTION_V1`,
but it does not implement prepare_quote, verify_quote_signature or prepare_operation.
Main must compose those existing BusinessCodec functions and this crypto facet
into its complete host. It is not a standalone authorization or signing host.
Invoke Node outside DB transactions, then revalidate original permission/approval
and retain the canonical original raw/hash durably before any separately
authorized broadcast. UNKNOWN only queries the retained original; successful
inspection never authorizes re-signing, changing nonce/fees, replacement or resend.

## Boundaries and actual offline checks

Python uses the fixed helper, empty child environment, 3-second timeout,
128-KiB input/output bounds, signature/raw only on stdin, and discarded stderr.
Neither production helper nor tests write a key, signature or raw transaction
to evidence/logs. Errors are fixed SIGNED_TRANSACTION_REJECTED or execution
TRANSACTION_CRYPTO_UNAVAILABLE, without library exception context or raw data.

From project root:

```sh
python3 cp30-backend/integrations/business/run-transaction-crypto-checks.py
```

Only installed Node and Python3.12.14 are used with empty child environments;
Python -I -B prevents external bytecode writes. This runner invokes only the new
crypto checks, not private Runtime's stub suite or any old C1/PG/security test.

Observed **3/3 Node + 1/1 Python passed**: actual ephemeral synthetic transaction
decoding/recovery/keccak; every approved payload-field mutation and budget mismatch;
unsigned/noncanonical/trailing/truncated/legacy/access-list/high-S rejection;
actual Python-to-Node inspection and Runtime hash alias. Fixture generation uses
a new temporary fictional memory key from the installed library, never a person,
profile, wallet/key file or retained private key. Signed raw exists only in the
test's private memory pipe. The production source has no signing API. This
independent crypto check is not actual Runtime signing or network broadcast.

NOT_RUN: complete host composition and durable approved nonce/grant/budget ledger;
PG/controller/HTTP; actual identity/key/signature or RPC/provider/broadcast/deployment;
on-chain nonce, balance, basefee, intrinsic gas, execution, receipt or finality.
Structural crypto validity does not establish any of those facts or independent
project acceptance. Main owns all shared integration and actual operation gates.
