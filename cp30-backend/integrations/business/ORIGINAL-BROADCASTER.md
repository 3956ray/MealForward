# Private original broadcaster source

`DedicatedBusinessBroadcaster.original_lookup_protocol` is `CP30_ORIGINAL_OPERATION_V1`.
This leaf provides future HTTP source; delivery checks use only fake process/codec/RPC.
No production worker, HTTP, wallet, signing, configuration, key, PG or cloud is executed.

## Exact construction

```python
from business.codec import BusinessCodec
from business.transaction_crypto import TransactionCrypto
from business.original_broadcaster import DedicatedBusinessBroadcaster

broadcaster = DedicatedBusinessBroadcaster(
    role="issuerAuthority",  # or operatorAuthority; one fixed account per instance
    profile=approved_profile,
    business_codec=BusinessCodec(absolute_node_executable),
    transaction_crypto=TransactionCrypto(absolute_node_executable),
    rpc_config={
        "endpoint": approved_rpc_url,
        "allowedEndpoints": approved_complete_urls,
        "allowedHosts": approved_exact_hosts,
        "pythonExecutable": absolute_python_executable,
        "budget": {"maxCalls": 6, "maxCallMs": 3000, "maxTotalMs": 20000,
                   "maxResponseBytes": 262144, "maxTotalBytes": 1048576},
    },
    before_broadcast=trusted_main_recheck,
    node_executable=absolute_node_executable,
)
```

`approved_profile` has EXACTLY signer profile fields
`namespace, binding, escrowCodeHash, chainProfileDigest, registrar, maxGas,
maxFeePerGas, maxPriorityFeePerGas, maxTransactionCostWei`, plus `genesisHash`.
Pass the original nine-field subset to the signer; do not change its profile schema.
`binding` is EXACTLY `chainId` (safe integer), `escrow, asset, storeId, owner,
receiver, quoteAuthority, catalogAuthority, issuerAuthority, operatorAuthority`.
Addresses/hashes are lowercase nonzero hex; amount/gas/fees/cost are canonical decimal
strings. `owner == receiver`; dedicated account cannot alias owner/receiver/registrar.
`escrowCodeHash` is the trusted hash of the complete deployed runtime including its
immutables, from verified registration and Main approved profile. It is not a normalized
compiler template hash. Main supplies and approves genesis/code/profile binding;
no browser input can extend profiles/endpoints/budgets or authorize sends.
Construction performs no IO. Missing/extra profile or RPC fields close configuration.

## Methods and exact original

- `pending_nonce() -> decimal_string`: chain/genesis/canonical-finalized/code checks,
  then ONLY `[fixed_profile_account, "pending"]`. Main chooses/adopts its original nonce
  and admission under its durable DB constraints; this method never alters any plan.
- `broadcast_original(raw, transaction_hash, record) -> transaction_hash`: full original
  descriptor and canonical type-2 signed raw/hash checked independently, then fixed chain,
  genesis, finalized canonical header, EIP1898 runtime code checked; trusted Main callback
  runs immediately before its single send. Returned hash is a locator only.
- `lookup_original(record, transaction_hash) -> transaction_hash | None`: independently
  rebuild original; query only original retained hash. Null remains unknown. Non-null must
  match exact hash/chain/from/to/value/input/type/empty accessList/nonce/gas/fees. No receipt,
  funds, finality or business success is inferred. Original deadlines are not refreshed.

Original record matches PrivateBusinessRuntime/signing leaf: scope fields
`namespace, binding, escrowCodeHash, chainProfileDigest`; `operation, opId, parameters`,
complete original BusinessCodec `deployment`, and EXACT `transaction` fields
`nonce, gas, maxFeePerGas, maxPriorityFeePerGas`. Additional Main audit fields are retained
in the recheck copy, never treated as granting authority. If `grant` exists, its decimal
`gasUnits` is additionally enforced against the immutable local cost ceiling. Supported
operations are `issue` (issuer) and `lock, markHandover, report` (operator), with their
actual `prepareIssue/Lock/MarkHandover/Report` descriptors. Fund/settle/quote/owner/registrar
and other operations fail closed. Codec recomputation uses `now="0"` only to reconstruct
the immutable original for lookup; Main callback rechecks present authorization on send.

## Required Main composition

Inject this concrete object as PrivateBusinessRuntime's broadcaster, and use its
`pending_nonce()` in Main admission. All methods, including codec/HTTP/code hashing,
MUST run outside DB transactions. `trusted_main_recheck(record)` is a server-owned
callback that raises on rejection; its return value does not grant authority. Immediately
before send it must recheck approved original owner request, approval revision, guard,
role/profile, ledger budget/reservation, and that raw/hash plus the durable domain's
original broadcast winner are already retained. Main owns durable one-use broadcast
admission and restore fences across process restart. This leaf keeps an additional
in-process account+nonce attempt fence before send; uncertainty never clears that fence.
Main must not instantiate a replacement broadcaster to retry an uncertain send. Retained
original lookup is the only recovery path; no automatic retry/rebroadcast/fee bump exists.
A fresh original created by Main's normal admission is a distinct authorized operation.

## Bounded transport

Every fresh session permits at most six exact calls: chain, genesis, finalized header,
canonical header at that height, fixed escrow code (EIP1898 `requireCanonical:true`),
and one pending nonce / original lookup / verified raw send. No generic URL, address,
calldata, nonce mutation, eth_call, receipt, log, key, or signing methods exist. Raw send
session construction requires the broadcaster's private permit after independent crypto
verification; the worker accepts only that session's fixed raw and hash scope.

HTTPS port 443, complete approved URL and exact hostname allowlist, standard verified TLS;
no URL credentials, redirects, proxies or inherited environment. Owned empty-environment
Python `-I` worker isolates DNS/TLS under each absolute deadline; only that PID is killed
and reaped on timeout. Count/total time/response wire bytes are capped; response reader
counts status/headers/body/chunk framing, with 16KiB headers. Whole action deadline begins
before codec/crypto; fixed subprocess code hash uses installed viem and an empty environment.
Main callback/DB adapter must retain its own bounded timeout. Provider errors/worker
failures expose fixed errors, never endpoint/payload/provider text. Failed session closes;
send result uncertainty becomes `ORIGINAL_BROADCAST_UNKNOWN` without another send.

`python3 -B integrations/business/test_original_broadcaster.py` runs four focused fake
checks: supported roles, exact original/cap/hash/role rejection before RPC, uncertainty
with no resend, null and wrong-original lookup, fixed nonce, HTTPS/EIP1898/method scope,
chain/runtime pins, worker source parsing, and empty-environment owned process cleanup.
Production worker remains unexecuted; future real credentials/network/DB enabling,
source pinning and final observer reconciliation are Main/Leader responsibilities.
