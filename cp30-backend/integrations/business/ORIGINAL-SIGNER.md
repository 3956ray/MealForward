# Dedicated original-only private business authority signer source

Source-only candidate. No private key file/old configuration/environment, real
identity, wallet, network/RPC, signer worker, PG or cloud was accessed/executed.
Tests use fake signer/codec and new owned synthetic response journal only. Parsing
production worker source is not actual EOA signing or live integration evidence.
Only these four new files are added; no registrar signer/journal, runtime, existing
business codec/crypto/index/ABI or Main src was modified.

## Exact private runtime interface

`DedicatedBusinessSigner.original_signer_protocol = 'CP30_ORIGINAL_SIGNER_V1'`.
Methods match PrivateBusinessRuntime/PrivateOriginalSignerClient:

- `sign_original_quote(record,prepared) -> signature string`
- `lookup_original_quote(record) -> retained signature | None`
- `sign_original_transaction(record) -> canonical signed raw string`
- `lookup_original_transaction(record) -> retained canonical raw | None`

Permitted: quoteAuthority FundingQuote typed-data only; issuerAuthority issue;
operatorAuthority lock/markHandover/report. No fund/settle/owner/registrar transaction,
ERC20 approve, grant, mint, control/admin operation, arbitrary message/typed-data,
nonce selection, signing retry, RPC or broadcast exists. Owner/receiver or registrar
account alias is rejected even if configured as this authority account.

## Trusted composition and record shape

Constructor:

```python
DedicatedBusinessSigner(
    role=approved_role,
    profile=approved_authority_profile,
    journal=owned_authority_journal,
    business_codec=BusinessCodec(approved_absolute_node),
    transaction_crypto=TransactionCrypto(approved_absolute_node),
    worker=dedicated_eoa_worker,
    clock=trusted_integer_seconds_clock,
)
```

Profile contains exactly `{namespace,binding,escrowCodeHash,chainProfileDigest,
registrar,maxGas,maxFeePerGas,maxPriorityFeePerGas,maxTransactionCostWei}`.
binding is the existing exact ten-field business binding: safe integer chainId,
fixed nonzero lowercase escrow/asset/storeId/owner==receiver/all four authorities.
The selected single account is binding[role], immutable for that journal/service.
namespace is the private authority namespace. escrowCodeHash/chainProfileDigest are
approved nonzero bytes32, not caller assertions. registrar is the separately
approved registrar address. Integer caps are canonical decimal strings, gas/fee/
transaction-cost maxima positive, priority may be0. They are local profile ceilings,
NOT grant consumption, budget admission or permission to sign/broadcast.

Main's existing PgRuntimePolicy/PgRuntimeLedger remains the sole trusted original
approval, current guard/profile/revision, nonce reservation, grant, signature/gas
budget and admission authority. Main's authenticated private IPC host must execute
that control before calling this signer. Method name/profile shape is not authority;
no signer/key/journal object is exposed to public browser routes or arbitrary callers.
This leaf supplies the missing concrete signer, not a substitute private host/policy.

Quote record retains the actual private runtime shape: namespace, binding,
escrowCodeHash, chainProfileDigest, quoteId, ORIGINAL nine-field quote, ORIGINAL
typedData and digest (other retained audit fields are fingerprinted too). The supplied
prepared object must equal independent BusinessCodec.prepareFundingQuote(now0)
including full FundingQuote domain/types/message, quote/payload/digest/authority.
Same quoteId with altered deadline/amount/domain/caller/profile is never reauthorized.

Transaction record retains namespace/binding/code/profile hashes plus operation,
opId, parameters, complete original BusinessCodec deployment descriptor and exactly
`transaction:{nonce,gas,maxFeePerGas,maxPriorityFeePerGas}`. No partial six-field
replacement descriptor is accepted: independent prepareIssue/Lock/MarkHandover/
Report output must exactly equal the full saved descriptor, including role/caller/
chain/escrow/value/calldata/opId/parameter/operation/call digests. TransactionCrypto
independently prepares the approved canonical EIP1559 envelope and validates each
nonce/gas/fee/cost; returned raw is decoded/recovered/round-tripped by that existing
crypto module before retaining/returning. Same nonce cannot belong to another opId
within this dedicated account/profile journal, including uncertain intents.

Fresh deadline-bearing signatures additionally require original deadline>trusted
clock; report retains its original no-deadline semantics. Lookup/replay of an already
retained result intentionally ignores elapsed deadline and returns the SAME old
signature/raw; it neither renews authorization nor authorizes broadcast.

## Dedicated durable response journal

`AuthorityOriginalJournal(directory,role=ROLE,profile=PROFILE,initialize=False)`.
Main allocates a new absolute owned0700 directory for EACH authority service; it
must not use a registrar directory/file or shared budget. initialize=True is an
explicit first-create action using O_EXCL; resume=False initialization never creates
missing journal. Fixed file is `business-authority-originals.jsonl`, owned0600,
regular/single-link/no symlink. Directory FD pins owner/mode/device/inode and child
opens use that FD. Exclusive lifetime flock prevents another host sharing the file.
RLock serializes in-process journal mutations. close is idempotent.

Header binds protocol/role/full profile. Append-only rows have sequence, parent and
SHA256 audit chain; maximum262KiB row/8MiB file. Header/file and directory are fsynced.
SIGNING stores full original record AND independently prepared material; it is
fsynced before any worker invocation/key opening. Only independently verified
signature or raw/hash is appended as RETAINED, fsynced BEFORE return. Every lookup
rechecks exact original and returned signature/raw with the existing pure codecs.

Any worker/verification/retention uncertainty leaves SIGNING without result; lookup
returns None or a closed/conflict error. Calling sign on that original raises
ORIGINAL_SIGNING_UNKNOWN; no worker retry/key read/new nonce/raw/broadcast occurs.
No caller can reset an intent or release its nonce/signature reservation here.
Modified originals, nonce reuse, changed profile/header, missing/damaged journals
fail closed. A hash chain is not an independent anti-rollback anchor: Main's existing
ledger/controller/restore fences must detect stale/altered original retention and
halt, never reconstruct missing possibly-signed material or reset budget.

## Future key FD worker (NOT executed in this delivery)

`DedicatedEOAWorker(journal=JOURNAL,key_handle=APPROVED_HANDLE,
node_executable=APPROVED_ABSOLUTE_NODE)`.
key_handle is exactly `{name,device,inode}` from Main's provisioner, naming a NEW
approved dedicated `.key` file inside this journal directory. No absolute/user path,
registrar key, env var, browser key or runtime secret default is accepted. Device/
inode are trusted resource metadata; this delivery did not obtain any real handle.

The worker opens that single owned0600 regular/single-link/no-symlink66..67-byte file
through the already pinned directory FD only AFTER checking durable SIGNING intent.
It checks exact handle device/inode, passes only readonly FD in pass_fds to the fixed
original-signer-worker.mjs with empty env, no stderr, bounded128KiB public stdin/
output and5-second child timeout. Secret bytes never appear in argv/env/stdin/journal/
logs. Node reads at most68 bytes from the FD and clears its temporary byte buffer on
exit. Its private account object/strings live only in that short-lived process.

Node independently rebuilds original quote/operation/transaction against approved
role/account/binding/caps before FD read. It uses installed viem/accounts only:
quote signTypedData followed by attachFundingSignature authority recovery, or
EIP1559 signTransaction followed by TransactionCrypto canonical inspection. No
handwritten cryptography, client/provider or network is used. Python validates its
signature/raw/hash again before journal retention. Production entry was NOT invoked
by tests and no key was created/read. Existing libraries are reused without install.

## Main private host wiring

```python
from integrations.business.codec import BusinessCodec
from integrations.business.transaction_crypto import TransactionCrypto
from integrations.business.original_signer import (
    AuthorityOriginalJournal, DedicatedEOAWorker, DedicatedBusinessSigner,
)

# Main approval/resource provisioning supplies every value; no ambient defaults.
journal = AuthorityOriginalJournal(
    newly_approved_owned_directory,
    role=approved_private_role,
    profile=approved_authority_profile,
    initialize=explicit_first_create,
)
key_worker = DedicatedEOAWorker(
    journal=journal,
    key_handle=approved_new_dedicated_handle,
    node_executable=approved_absolute_node,
)
signer = DedicatedBusinessSigner(
    role=approved_private_role, profile=approved_authority_profile, journal=journal,
    business_codec=BusinessCodec(approved_absolute_node),
    transaction_crypto=TransactionCrypto(approved_absolute_node),
    worker=key_worker, clock=trusted_clock,
)
# Inject signer into build_private_runtime(..., signer=signer, ...), OR expose only
# its four exact methods through Main's authenticated/admitted original-signer IPC.
# IPC replies match existing PrivateOriginalSignerClient:
# quote: {signature: str|None}; transaction: {raw: str|None}; failures: fixed error.
# Main owns host/capability/profile/grant/admission checks and shutdown journal.close().
```

One immutable approved binding is the current first-store signer lane. This does
not alter the retained three-store factory architecture. Expanding approved service
bindings/key/nonce scope requires Main's reviewed profile/ledger design; do not copy
an authority key/journal into separate per-store nonce ledgers or silently change
this header. Existing registrar signer resources/budgets remain separate.

## Observed checks

`python3 -B -m unittest discover -s cp30-backend/integrations/business -p 'test_original_signer.py' -v`:
four small checks pass: fake quote intent/retained/restart/expired lookup; fake
transaction raw/nonce-original retention; unknown never signs again and prohibited
roles/functions reject; Python AST/private worker source protocol checks.
`node --check .../original-signer-worker.mjs` parses syntax only and passes.

No real EOA key/signature/raw, full operator receipt, actual signer subprocess, IPC
service, PgRuntimeLedger budget, chain, broadcaster or deployment was validated by
these fake/source tests. Current host still needs Main's approved configuration,
resource provisioning, protected IPC/composition and runtime enablement gate.
No acceptance, live signing readiness or physical meal delivery claim is made.
