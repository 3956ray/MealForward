# Registration receipt verifier candidate

Only offline source/synthetic transport checks have run. No RPC, real wallet,
identity, PG, signing, broadcasting or deployment was used. Keep IO outside database
transactions. This verifier is separate from the browser `MINED_UNVERIFIED` observer.

`observeRegistration({transport,profile,original,deployment,transactionHash})`
returns `{status,reason,evidence}`. Status is VERIFIED only after every check passes;
PENDING, UNKNOWN and UNVERIFIED always have `evidence:null`. No client-final flag,
confirmation count, wall-clock deadline renewal or browser receipt input is accepted.
`createReceiptVerifier({transport,profile}).verify_original(original,hash,deployment)`
returns only complete evidence or null, matching the onboarding protocol.

`transport.request(method,params)` is injected by the trusted backend. Only
eth_chainId/getCode/getTransactionByHash/getTransactionReceipt/getBlockByNumber/
eth_call are emitted. Requests are sequential and bounded; no getLogs is needed.

Trusted profile fields (never read from environment or a browser):

- `chainId`: safe positive integer; `genesisHash`: bytes32.
- `factory,registrar,asset,quoteAuthority,catalogAuthority,issuerAuthority,
  operatorAuthority`: exact nonzero original addresses.
- `escrowCreationCodeHash`: fixed wallet creation-code pin.
- `finality:'rpc-finalized'`, `eip1898:true`: reviewed provider/chain policy must
  support finalized block tags and blockHash/requireCanonical state reads. Unsupported
  policy returns UNVERIFIED. Unsupported/absent provider finalized data cannot pass.
- `runtimeTemplatePins:{factory,escrow}`: fixed normalized template hashes exported
  in `runtimeTemplates` by registration-observer.mjs. Current factory:
  `0xcc94e6dd8c3e594ed94ef9221e7b3c55e941321285afcd39966f04c36231fb1a`;
  escrow: `0x2d6f320edd2627a18683f2fd37f45acd41f7fb4951c89b99e062650487ce191b`.
  Missing template pins => UNVERIFIED; mismatched pins cannot return evidence.
- `budget:{maxCalls:48,maxTotalMs:20000,maxCallMs:3000,maxResponseBytes:262144,
  maxTotalBytes:1048576,maxCatalogEntries:1}` for the first one-meal path. The adapter
  rejects values above 48 calls, 20 seconds total, 3 seconds per request, 1 MiB per
  response/aggregate, or 3 catalog entries. Positive bounds must all be explicit.

`original` is the exact persisted onboarding object (chainId/deadline/version/prices
as decimal strings, catalog window fields may be integers). `deployment` is the exact
persisted `{chainId:number,from,to,value:'0',data,callDataDigest}` codec output. The
original calldata is re-created from its registration/catalog/signature and fixed
creation code; all bytes must match. Historic deadline remains part of the original
EIP712 digest; receipt refresh never issues new authorization.

The observer binds transaction hash/chain/sender/target/value/calldata, receipt and
StoreCreated provenance/config, canonical receipt block and actual finalized block,
then reads code and state at EIP1898 `{blockHash,requireCanonical:true}`. It rechecks
canonical receipt block/chain at the end. Event replay must have one matching event.
Factory creation-code hash, original registrationUses digest/escrow, escrowFor/slot,
all original business immutable getters, owner==receiver, current/listed initial
catalog/getTerms/computeTermsHash, Factory registrationDigest and a fixed synthetic
Escrow FundingQuote quoteDigest versus local viem EIP712 are checked. These view
probes do not fund or change contract state.

Runtime provenance: observer-artifacts.mjs copies deployedBytecode and all immutable
references from the same-build onboarding-contracts/out Factory and unchanged
StoreEscrow artifacts. Factory has 14 groups/26 slots, escrow 15 groups/43 slots, each
32 bytes. Only those frozen compiler locations are normalized; repeated occurrences
within a group must agree. Every remaining runtime byte matches the fixed template.
Unknown groups, offsets, overlapping or unsupported reference shapes return
UNVERIFIED. The known Factory runtime + exact codehash-bound creation arguments,
original event/mappings, public immutable getters and EIP712 probes complete this
candidate's immutable verification; no caller-defined template/mask is supported.
Recompilation requires an explicit reviewed artifact/pin/source update.

VERIFIED evidence is `{...original,configHash,parametersDigest,receiver,deployment,
escrow,transactionHash,blockHash,blockNumber,logIndex}`. All words/addresses are lower
hex, blockNumber/logIndex are safe JS integers. No intermediate evidence is returned.
The caller still owns trusted RPC selection, reviewed finality profile, persistence,
conflict/recovery checks and application readiness/publication transaction.

## Restricted JSON bridge

`node cp30-backend/integrations/wallet/registration-observer-runner.mjs` accepts no
arguments and no file paths. Start it with a clean environment. Send one stdin JSON
line `{op:'observe',profile,original,deployment,transactionHash}`. Its stdout emits
`{type:'rpc',id,method,params}`; trusted caller performs the readonly request outside
any DB transaction, then writes `{type:'rpc-result',id,result}` on stdin. No response
is accepted with a different ID/type or extra fields. Final stdout line is
`{type:'result',result:{status,reason,evidence}}`. This runner has no network client.

The bridge limits each line to 1 MiB, input/output aggregate to 2 MiB and total bridge
lifetime to 23 seconds (observer IO itself <=20 seconds). Do not expose this bridge
or private calldata/signatures to a browser or public logs. Main application should
return null to ReceiptVerifier for any non-VERIFIED result.

Offline validation:
`node --test cp30-backend/integrations/wallet/wallet.test.mjs cp30-backend/integrations/wallet/registration-observer.test.mjs`.
The one-meal complete synthetic path uses 37 readonly requests, including private
EIP712 cache probes. Four observer tests cover complete evidence, pending/absent
finality/template, wrong original/fork/code/private digest and the in-memory JSON
bridge; eight existing wallet tests remain unchanged. No live-network compatibility
or real contract receipt has been established by these synthetic checks.

## Python composition (candidate, no live RPC checks)

`registration_observer.py` supplies
`NodeReceiptVerifier(node_executable=ABSOLUTE_NODE, profile=FULL_PROFILE,
transport_factory=CALLABLE, compiler_pins=EXPLICIT_APPROVED_PINS)` and
`verify_original(original,transaction_hash,deployment) -> detached evidence | None`.
The full profile must contain exactly the fields listed above. Node must be an
existing absolute executable path. All seven fixed ESM source hashes must be
explicitly supplied and match `EXPECTED_COMPILER_PINS`; source bytes are checked
at construction and before each call. Missing or changed configuration closes the
adapter. Only VERIFIED evidence can return; pending/unknown/unverified return None.
Invalid bridge/config/transport responses raise a fixed `ObserverBridgeError` or
`ObserverTransportError` code without private input/provider error/endpoint text.

The Python bridge starts the fixed real Node runner with `env={}`, private pipes,
no child stderr, bounded initial input (256 KiB), individual lines (1 MiB), child
output aggregate (2 MiB), explicit total deadline and sequential RPC IDs. It repeats
readonly method, selector, EIP1898 snapshot and budget checks in Python. Owned
processes are killed/reaped on failure/timeout; no unrelated PID is touched. Each
verification creates a fresh transport session and independent counters, so callers
can share the immutable composition while reconciling independent registrations.

`rpc_transport.py` supplies `ReadOnlyJsonRpcTransport(endpoint=EXPLICIT_URL,
allowed_endpoints=EXACT_URL_ALLOWLIST, allowed_hosts=FIXED_HOST_ALLOWLIST,
python_executable=ABSOLUTE_PYTHON, profile=FULL_PROFILE)`. Construction makes no IO.
Its `request(method,params,deadline=MONOTONIC_DEADLINE)` is the injected transport
contract. A trusted custom transport must obey that absolute deadline; the supplied
HTTPS implementation enforces it with an owned short-lived empty-environment
`rpc_worker.py` process. No endpoint/default/RPC credentials are read from files,
command arguments or environment. HTTPS/443, exact URL and hostname allowlisting,
normal certificate/hostname verification, identity JSON responses, no redirects,
no retry, per-call/aggregate byte and elapsed-time limits are mandatory. Proxy
environment variables are ignored by the direct stdlib HTTPS connection.

Example for Lead Developer's trusted composition (place only in main-owned source):

```python
from integrations.wallet.registration_observer import NodeReceiptVerifier
from integrations.wallet.rpc_transport import ReadOnlyJsonRpcTransport

# Every variable below is an explicit reviewed server-side configuration value.
# Do not obtain them from browser bodies, caller receipt flags or ambient defaults.
def new_transport():
    return ReadOnlyJsonRpcTransport(
        endpoint=approved_rpc_endpoint,
        allowed_endpoints=approved_exact_endpoint_allowlist,
        allowed_hosts=approved_rpc_host_allowlist,
        python_executable=approved_absolute_python,
        profile=approved_full_profile,
    )

verifier = NodeReceiptVerifier(
    node_executable=approved_absolute_node,
    profile=approved_full_profile,
    transport_factory=new_transport,
    compiler_pins=approved_seven_esm_sha256_pins,
)
# Inject into OnboardingService(..., verifier=verifier, ...).
# Service's original/deployment snapshot must close its transaction BEFORE this IO:
evidence = verifier.verify_original(original_snapshot, original_tx_hash,
                                    deployment_snapshot)
# Domain commit opens a fresh transaction and compares the unchanged snapshot.
```

Compilation pins include registration-observer.mjs, registration-observer-runner.mjs,
observer-artifacts.mjs, index.mjs, factory-abi.mjs, escrow-abi.mjs and
escrow-creation-code.mjs. The explicit approved values are in the source's
`EXPECTED_COMPILER_PINS`; do not calculate/approve arbitrary current file hashes at
runtime. Root commit/review still determines whether these source pins are accepted.

Additional offline validation:
`python3 -m unittest discover -s cp30-backend/integrations/wallet -p 'test_python_observer.py' -v`.
Four tests run the real empty-environment Node runner against a pure-memory synthetic
RPC transcript, covering complete evidence (37 calls), pending/wrong original,
missing config/pins, fixed errors, endpoint validation and readonly request shapes.
Transport construction is checked without calling its network worker. HTTP/TLS,
DNS, redirect/timeouts and live-provider compatibility have NOT been exercised;
these source controls and synthetic protocol results are not live integration proof.
