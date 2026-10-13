# Business readonly HTTPS transport source

This leaf completes the concrete future HTTP transport for StoreEscrowObserver.
Only rpc_transport.py, rpc_worker.py, TRANSPORT.md and test_transport.py are added.
Existing business observer/codec/ABI, wallet registration transport and shared
application remain untouched. No HTTP, DNS, TLS, RPC, wallet, key, PG, old profile/
runtime/config, cloud or signing operation was run. Source/protocol checks do not
establish live-provider compatibility or authorize enabling the transport.

## Exact constructor and configuration

```python
from integrations.business.rpc_transport import ReadOnlyBusinessRpcTransport

transport = ReadOnlyBusinessRpcTransport(
    endpoint=approved_exact_https_url,
    allowed_endpoints=approved_exact_url_allowlist,
    allowed_hosts=approved_fixed_hostname_allowlist,
    python_executable=approved_existing_absolute_python,
    profile=approved_business_observer_profile,
    original_transaction_hash=saved_original_hash,     # None for state-only reads
    original_deployment=saved_original_deployment,    # None for state-only reads
)
# transport.request(method, params, deadline=absolute_time_monotonic_deadline)
```

Every constructor value is trusted composition, never browser input or ambient
configuration. endpoint is HTTPS/443, no URL credentials/fragment/control characters,
exactly in allowed_endpoints and with hostname in allowed_hosts. Path/query are the
approved URL's exact values (private API-key query must stay private). No default
endpoint, broad user URL, redirect, proxy environment or provider error logging is
supported. Python path must be absolute and exist. Constructor does no network IO.

profile is exactly the existing StoreEscrowObserver profile described in OBSERVER.md:
binding with safe chainId and fixed escrow/storeId/asset/owner==receiver/all authorities;
trusted persisted CONFIRMED complete VERIFIED registrationEvidence; reviewed genesis/
rpc-finalized/EIP1898 policy; fixed runtime template/compiler pins; explicit budget.
All registered fields must match, all ten pinned existing business/wallet sources
must match their reviewed SHA256. Missing or changed configuration closes construction.
A dictionary's shape does not authenticate its origin; Main loads it from the durable
verified-registration authority and never trusts caller-set CONFIRMED or final flags.

Positive budget maxima remain96 calls/20 seconds aggregate/3 seconds per request/
1 MiB per response AND aggregate/max3 meal IDs, identical to business observer.
Example first-meal budget:
`{maxCalls:96,maxTotalMs:20000,maxCallMs:3000,maxResponseBytes:1048576,
maxTotalBytes:1048576,maxMealIds:1}`. There is no retry. Any worker/protocol/canonical result failure permanently closes
that session (failed bytes cannot be silently forgiven by reusing it). A fresh session owns independent
start time, counter and byte budget; do not share one session across reconciliations.

Original transaction scope is optional only for read_finalized. If supplied, BOTH
original_transaction_hash and original_deployment are required. deployment is the
persisted exact six-field core `{chainId,from,to,value:'0',data,callDataDigest}`.
Only the six supported original business transaction selectors/role-bound senders
are accepted (issue,lock,markHandover,report,owner settle,quote payer fund). Original
data is lookup material, never submitted by this transport. Its complete encoding/
payload digest is independently re-created by the existing observer before receipt
verification. Without this configured locator, transaction/receipt lookups are rejected.
A provided lookup hash must equal the retained original hash, never another tx.

## Independent exact read and block scope

Only eth_chainId/getBlockByNumber/getCode/getTransactionByHash/
getTransactionReceipt/eth_call are emitted. READ_ABI exactly matches observer.READS
and the accepted StoreEscrow actual ABI; selector scope is separate from registration
transport. Main does not have to implement this missing transport or widen a previous
allowlist. Tests compare this entire map to the installed codec's actual ABI.

eth_call accepts only `{to:fixed_escrow,data:exact_static_ABI_read}` and exact
`{blockHash:known_canonical_hash,requireCanonical:true}`. It rejects from/value/gas,
unknown selectors, trailing calldata, wrong static word count, malformed ABI address
padding, out-of-width uint8, getUnit outside0..9, zero locator IDs, and unsupported
operationPayloadHash kind/caller bindings. Only original kinds5..9 with fixed
issuer/operator/owner are accepted for that payload read. This does not restrict
returned Operation.result: actual zero results remain legal. getCode targets ONLY
that escrow, never a caller address/asset/factory.

Allowed block lookups are genesis0, finalized tag, and only heights obtained from
that session's actual finalized block or retained original receipt. All explicit
canonical block results must match the corresponding pinned genesis/observed hash.
State reads start only after such canonical header verification and finalized height
is known. The state hash must be the finalized height or original receipt height,
not beyond finalized. First state read locks the hash for the entire session.
End-of-observation canonical/chain rechecks from StoreEscrowObserver use the same
scope and detect changed blocks. latest/pending state, arbitrary block lookups,
getLogs/getBalance, send/nonce, mint or receipt-success setters are rejected.

Returned raw transaction fields hash/chain/from/to/value/input must match the saved
original deployment. Receipt transactionHash/from/to must match and block locator
is retained only from that original receipt. These checks do not declare readiness;
actual status/event/payload/state/finality checks remain the existing observer's job.

## Owned empty-environment HTTP worker

Each request launches only its fixed sibling rpc_worker.py using
`[approved_python,'-I',fixed_worker]`, `env={}`, private stdin/stdout and discarded
stderr. The approved endpoint/scope/data travel in bounded private stdin (16 KiB).
Parent's absolute monotonic deadline includes process startup, DNS, TLS, request,
response parsing and bounded cleanup. A stuck DNS/TLS worker is killed/reaped by its
owned PID; no system/global process is touched. Worker also uses the same absolute
deadline and socket timeouts. Exceptions return fixed BusinessTransportError codes
without raw input/endpoint/provider errors; observer retains unknown/None.

Direct stdlib HTTPS verifies certificate/hostname with the normal trust store and
ignores proxy environment. It never follows redirects and rejects all non-200,
non-JSON or non-identity-encoded responses. A bounded HTTP reader counts status,
headers, JSON body and chunk framing before parsing; headers additionally cap16 KiB.
Per-response and aggregate raw HTTP consumed bytes stay inside the configured1 MiB
budgets. JSON rejects duplicate keys, NaN and RPC errors/unknown top-level fields.
JSON-RPC id must equal this original session request id. Worker returns private
`{response,responseBytes}` to the parent; metadata overhead is separately bounded
(512 bytes), not deducted from raw HTTP limits. The transport returns only result.

## Main-owned composition

Use one fresh transport per observer session. For an original operation, create the
observer/factory over that operation's immutable snapshot so the closure cannot
reuse another operation's hash/deployment. The existing observer API stays intact:

```python
from copy import deepcopy
from integrations.business.codec import BusinessCodec
from integrations.business.observer import StoreEscrowObserver
from integrations.business.rpc_transport import ReadOnlyBusinessRpcTransport

# Main has already closed the read-only DB transaction and detached these values.
profile_snapshot = deepcopy(approved_business_profile)
record_snapshot = deepcopy(saved_original_record)
hash_snapshot = saved_original_transaction_hash

def new_transport():
    return ReadOnlyBusinessRpcTransport(
        endpoint=approved_rpc_endpoint,
        allowed_endpoints=approved_exact_endpoint_allowlist,
        allowed_hosts=approved_rpc_host_allowlist,
        python_executable=approved_absolute_python,
        profile=profile_snapshot,
        original_transaction_hash=hash_snapshot,
        original_deployment=record_snapshot['deployment'],
    )

observer = StoreEscrowObserver(
    codec=BusinessCodec(approved_absolute_node),
    transport_factory=new_transport,
    profile=profile_snapshot,
)
evidence = observer.verify_original_operation(record_snapshot, hash_snapshot)
# None/error keeps UNKNOWN. Only Main reopens DB transaction, rechecks the unchanged
# original/role/guard/snapshot, then projects complete verified evidence atomically.
```

For state-only observer composition, use the same factory without both optional
original arguments, then call read_finalized. No transport configuration belongs in
browser routes, no DB transaction encloses IO, and no code here sends a transaction.

## Offline validation

`python3 -B -m unittest discover -s cp30-backend/integrations/business -p 'test_transport.py' -v`.
Four focused checks passed: actual ABI/BusinessCodec exact read descriptors; pure
memory subprocess protocol/canonical session/original locator; fake-socket memory
HTTP parser200/redirect/header/body-limit behavior; invalid endpoint/profile/budget/
readonly requests. Popen and HTTPSConnection are replaced with memory-only stubs;
no worker/network request is performed. No whole observer suite or old blocked suite
was repeated. Real DNS/TLS/timeouts/HTTP provider/finality compatibility remains
NOT_RUN. Main still supplies reviewed endpoint/profile/resource/authority decisions
and commits verified facts; this source does not grant actual runtime/network use.
