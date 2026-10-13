# Original approve receipt and finalized allowance

This independent source is a read-only prerequisite to **the original fund**.
It never declares `funded` / `paid`, submits transactions, or grants a signer or
identity role. Construction does not connect. Real HTTPS/RPC, wallet signatures,
database/controller integration and network finality have not been exercised.

## Main composition and precise API

Import this directory by the same explicit local-source mechanism as other wallet
leaves. `approval_observer.py` imports `approval_rpc.py`; no package installation
or changes to the existing wallet/registration/business transports are required.

```python
from approval_observer import ApprovalObserver
from approval_rpc import ApprovalRpcTransport

observer = ApprovalObserver(
    node_executable=approved_absolute_node_path,
    profile=profile,
    transport_factory=lambda scope: ApprovalRpcTransport(
        endpoint=approved_endpoint,
        allowed_endpoints=approved_exact_endpoints,
        allowed_hosts=approved_exact_hosts,
        python_executable=approved_absolute_python_path,
        profile=profile, scope=scope))
proof = observer.verify_original_approval(record)  # dict or None; outside DB txn
```

`profile` has exactly these trusted server-configured fields. There are no
defaults, endpoint discovery, latest/pending fallback, or client profile inputs:

```text
{
  chainId: positive safe integer,
  genesisHash: 0x + 64 hex,
  asset: nonzero 0x + 40 hex,
  escrow: nonzero 0x + 40 hex,
  assetCodeHash: approved keccak256(asset runtime code), 0x + 64 hex,
  finality: "rpc-finalized",
  eip1898: true,
  budget: {
    maxCalls: integer 1..12,
    maxTotalMs: integer 1..20000,
    maxCallMs: integer 1..3000 and <= maxTotalMs,
    maxResponseBytes: integer 1..1048576,
    maxTotalBytes: integer 1..1048576
  }
}
```

Normal successful reconciliation needs eleven RPC calls; a lower budget fails
closed. All RPC and codec work shares the observer's absolute monotonic deadline.
Each codec child is additionally limited to three seconds. Profile construction
errors raise fixed `ApprovalError`; any reconciliation failure returns `None`.

`record` is loaded from the **persisted original approve attempt**, never assembled
from a free caller-supplied hash. It has exactly these fields:

```text
{
  attemptId: string matching [A-Za-z0-9_-]{1,128},
  quoteId: 0x + 64 hex,
  payer: nonzero address,
  amount: positive canonical decimal uint256 string,
  transactionHash: original persisted attempt hash, 0x + 64 hex,
  deployment: {
    chainId: profile.chainId integer,
    from: payer address,
    to: profile.asset address,
    value: "0",
    data: exact lowercase approve(profile.escrow, amount) calldata,
    callDataDigest: keccak256(data), 0x + 64 hex
  }
}
```

Main supplies the original quote amount; this leaf cannot independently prove
database provenance or quote ownership. Addresses/hash words are normalized to
lowercase. Amount/value/calldata must be canonical. The installed viem static
ERC20 ABI independently rebuilds approve and allowance calldata; no arbitrary
contract ABI, selector, spender or allowance target can be supplied.

On success the return value contains exactly:

```text
{
  status: "READY_FOR_ORIGINAL_FUND",
  verification: "VERIFIED_ORIGINAL_APPROVAL",
  attemptId, quoteId, transactionHash, payer, amount,
  asset, escrow, assetCodeHash,
  allowance: canonical decimal uint256 string,
  receiptBlock: {number: decimal string, hash: bytes32},
  finalizedBlock: {number: decimal string, hash: bytes32}
}
```

This proof is a bounded observation, not permanent spend authority. Main must
perform network/crypto outside its transaction, then reload and check unchanged
original session, payer, quote, amount, quote deadline, attempt locator/record and
permissions before its own CAS allows only the original fund. Main owns SQL,
durable locator storage, DTO/controller status handling and replay/idempotency.
The allowance can change after this observation; the original escrow/fund receipt
must still be reconciled independently. Do not substitute allowance for funding.

## What is checked

1. Exact chain ID and fixed genesis; signature-bearing RPC transaction matches
   original chain/from/to/value-zero/input/hash. Installed viem serializes the
   standard legacy (EIP155 protected), EIP2930 or EIP1559 transaction, computes
   keccak and recovers sender; installed Noble enforces signature scalar/low-S.
   Unprotected legacy, blob and authorization-list transaction types fail closed.
2. Successful original receipt, transaction hash/from/to and matching transaction
   block hash/number/index; its number is at or below the RPC `finalized` header.
   The canonical header at the receipt number has the exact original block hash.
3. Actual asset runtime code and actual `allowance(payer, escrow)` are read at
   the **same finalized block hash**, with EIP1898 `requireCanonical: true`.
   Static allowance call uses gas 100000. Code must be nonempty and match the
   approved runtime code hash; returned allowance must be exactly one ABI uint256
   word and at least the original quote amount.
4. Receipt and finalized headers are reread by number, followed by the original
   receipt; any missing, reverted, nonfinalized or conflicting result discards
   the complete observation. There is no Approval-event or synthetic allowance
   shortcut. This is RPC trust with configured finality, not a Merkle/light-client
   proof or an asset suitability certification.

## Restricted transport

`ApprovalRpcTransport.request(method, params, *, deadline)` accepts only the six
methods `eth_chainId`, `eth_getTransactionByHash`, `eth_getTransactionReceipt`,
`eth_getBlockByNumber`, `eth_getCode`, `eth_call`. Hash queries are restricted to
the original hash. Code/call addresses are the configured asset. `eth_call`
accepts only the fixed allowance calldata for the original payer/escrow, exact
gas, and the previously observed finalized hash. Block queries allow only
`finalized` or canonical numeric block quantities, with transactions disabled.
No nonce, balance, logs, arbitrary calls, writes or sends exist.

The factory receives the observer-generated exact scope
`{transactionHash, payer, allowanceData}`. The transport independently verifies
the fixed selector and both ABI address words. A fresh transport is required for
each reconciliation; its own call/time/response counters supplement observer
budgets. Endpoint must match the explicit exact allowlist and approved host with
HTTPS port 443, ASCII syntax, no URL credentials or fragment. Query is permitted
only as part of the exact approved endpoint, never exposed in errors or logs.

The owned `approval_rpc_worker.py` receives bounded JSON on stdin, uses direct
`http.client.HTTPSConnection` with default certificate validation, empty process
environment, isolated Python and no proxy/redirect behavior. Parent enforces
the absolute deadline even during DNS/TLS. Worker applies the same absolute
deadline through connect/request/read, fixed response/header caps, identity
encoding, JSON content type and status 200. Duplicate JSON fields/errors are
rejected. It closes the connection; parent kills/waits only its own child.
Provider messages, raw transactions and signatures never enter errors/logs.

## Offline checks and gaps

```sh
env -i /Users/mili/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -I -B cp30-backend/integrations/wallet/test_approval_observer.py
```

Six tests pass: synthetic original/same-block reconciliation, missing/reverted/
nonfinalized/reorg/code/allowance rejection, record and budget mismatch, real
Node codec rejection of an unsigned RPC transaction, scoped method rejection and
empty-environment child contract, and fake HTTPS response/status/size checks.
Approve/allowance ABI and keccak code hashing run through the real installed
viem child. Only test-local `MemoryObserver` substitutes successful signature
verification for the synthetic reconciliation fixture; production has no such
injection. Successful signed-RPC reconstruction/recovery, real HTTP/DNS/TLS,
real chain/finality/EIP1898 behavior, provider deadlines and Main SQL/CAS are
**NOT_RUN**. No private key or signed fixture is created/read; no external network,
PG, wallet, old profile/configuration or old test matrix is used.

Only the five assigned files plus the explicitly permitted pure
`approval-codec.mjs` are added. Existing wallet and transport source stays intact.
