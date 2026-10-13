# Offline StoreEscrow business codec

This leaf implements encoding, quote signature recovery and canonical ABI decoding
for the accepted original StoreEscrow. No HTTP/API/SQL/projection, signer runtime,
provider/network, durable authority ledger, deployment or background worker is
configured or started here. First-run one store/one meal/one test token is a main
product scope; this codec requires explicit facts and never chooses them or
fabricates balances, voucher state, hashes, identities or approval outcomes.
Wallet fund/settle code is reused from `../wallet/index.mjs`, not reimplemented.

## ABI and trusted profile

Import pure ESM functions from `index.mjs`, or use the bounded Python adapter
`BusinessCodec(node_executable).call(method,parameters)` from `codec.py`. Node path
must be absolute and trusted. Each Python call uses the fixed bridge.mjs, empty
environment, 2-second timeout, maximum 128-KiB JSON input/1-MiB output. The helper
has bounded stdin reads and rejects unsupported methods. Call it outside all DB
transactions; use preflight + final commit revalidation for any persistence.
Node has no signing implementation; only the synthetic ESM test creates a new
temporary in-memory EOA key to exercise permitted quote signature interoperability.
No real secret/configuration is read and no key/signature fixture is saved.

`binding` is supplied by reviewed backend composition:
`{chainId,escrow,storeId,asset,owner,receiver,quoteAuthority,catalogAuthority,
issuerAuthority,operatorAuthority}`. chainId is a positive safe JS integer; every
address is nonzero; storeId is nonzero bytes32; owner==receiver. Syntax checks are
not authentication or verification of a deployed escrow. Main must pin and verify
chain/genesis/runtime code/original confirmed registration and same-block immutable
getters. Never use browser-provided profile or addresses as authority.

`escrow-abi.mjs` reuses wallet's accepted ABI and adds exact missing entries copied
read-only from `cp30-contracts/out/s0b-final/StoreEscrow.sol/StoreEscrow.json`.
Offline tests compare every entry to that artifact. Source contract remains
`cp30-contracts/contracts/StoreEscrow.sol`, unchanged. No dependencies or compiled
contracts were modified/generated. Integers in JSON parameters/results are
canonical unsigned decimal strings, including uint8 seq/count fields. Native gas
is separate from integer asset base units; no token decimals or balance default
is inferred. Raw ESM return typed-data message integers are bigint; bridge JSON
converts bigint to decimal strings. Descriptor chainId stays a safe integer.

## Quote preparation and private authority signature

`prepareFundingQuote({binding,quote,now})` requires exact original nine quote
fields: `{quoteId,payer,mealId,currentVersion,termsHash,quantity,unitPrice,amount,
deadline}`. IDs/hashes are nonzero bytes32; quantity 1..10; amount must equal
quantity*unitPrice; price, version and deadline positive; deadline>trusted now.
Amounts already use the explicitly configured token's base units. Public browser
input cannot supply current terms, authority, quoteId or business permissions.
Main derives these from trusted confirmed content/catalog, bound payer and a
durably created original quote review.

Return: `{typedData,digest,payloadHash,quote,authority:'PREPARATION_ONLY'}`.
Domain is exactly `MealForward C0 Funding`, version `1`, original chainId/escrow.
FundingQuote fields/order/types derive from original fund ABI. digest is installed
viem hashTypedData, matching quoteDigest; payloadHash is exactly the original
quotePayloadHash `keccak256(abi.encode(QUOTE_TYPEHASH,quote))` used by quoteUses.
These fields bind the complete original quote, including deadline/payer/id.

Inject a reviewed private EOA quoteAuthority signature, then call
`await attachFundingSignature({binding,quote,signature,now})`. This uses pure viem
recoverTypedDataAddress against fixed quoteAuthority and the original OZ bytes
signature shape/v/low-s rules. The original escrow uses ECDSA.recover, so smart
quote-authority signatures/ERC1271 are unsupported here. Result is the existing
wallet's exact signedQuote envelope:
`{chainId,escrow,quoteAuthority,quote,signature}`. Feed it unchanged to
`prepareFund({binding,wallet,signedQuote,now})` from the wallet leaf. That still
requires the trusted payer/account binding and explicit user wallet action.
Wallet prepareSettle remains the owner/receiver wallet path.

`interfaces.py` declares, but does not implement,
`PrivateQuoteAuthorityClient.sign_original_quote(record)->signature`. Main must
provide authenticated private transport and a durable quoteId/full typed-data/
digest ledger. Response loss must query/return the same retained authorization,
not create a new quote/id/deadline. No key enters this codec, public server body,
public records or logs. Successful signature recovery is not proof of live menu,
balance, budget, solvency or permission to support.

## Issuer/operator fixed original transaction descriptors

Each method receives `{binding,caller,parameters,now}`. Main supplies the caller
from the authenticated private authority profile; it must equal the fixed role.

| Method | Exact parameters | Fixed caller/kind |
|---|---|---|
| `prepareIssue` | `{opId,mealId,expectedUnitSeq,expectedNextGeneration,expectedTermsHash,deadline}` | issuerAuthority / 5 |
| `prepareLock` | `{opId,voucherId,generation,deadline}` | operatorAuthority / 6 |
| `prepareMarkHandover` | `{opId,voucherId,generation,lockId,deadline}` | operatorAuthority / 7 |
| `prepareReport` | `{opId,voucherId,generation,lockId,markerId}` | operatorAuthority / 8 |

The seq range is 0..9 (original lifetime cap10); generation must be positive; ids
nonzero; fresh deadline-bearing preparation rejects expiry. Report deliberately
has no deadline: original contract validates retained lock/marker/window facts.
These methods check serialization, not live Candidate/Voucher/Unit semantics.
Issuing/locking/reporting does not prove physical delivery or any natural person's
receipt; markHandover/report are retained declarations under the original rules.

Each result has onboarding-compatible core
`{chainId,from,to,value:'0',data,callDataDigest}` plus
`{opId,parametersHash,paramsDigest,functionName,expectedRole,args,
authority:'PREPARATION_ONLY'}`. from is fixed issuer/operator, to fixed escrow.
parametersHash equals `keccak256(abi.encode(originalArgsExceptOpId))`.
paramsDigest equals original operationPayloadHash:
`keccak256(abi.encode(keccak256('MealForwardOperationV1'),uint256(1),chainId,
escrow,kind,caller,opId,parametersHash))`. It is the exact payloadHash expected in
getOperation/OperationExecuted, not an invented SHA audit digest. Persist full
original parameters/deployment/digests; same opId different data must reject.

The unimplemented private operation client contract in interfaces.py is
`send_original(record)->transactionHash` and
`lookup_original(record)->transactionHash|None`, with trusted expected_role and
reviewed original_lookup_protocol exactly `CP30_ORIGINAL_OPERATION_V1`. This
protocol is only declared here; main must enforce its configured capability and
actual durable behavior before enabling any submission. Main needs one issuer and one operator client
bound to those real profiles, each with durable immutable attempt retention
before any possible signing/submission. Main's outbox must commit UNKNOWN first
and allow only its original claim winner to send. UNKNOWN only looks up original
opId/escrow/chain/paramsDigest/full calldata, even after deadline; None never
authorizes a resend/new nonce/new opId/re-signature. Missing durable lookup or
private client configuration must fail closed. Descriptors contain no success
flag and no execute/broadcast behavior. Final on-chain original transaction/
event/operation/state verification and restore/conflict fencing remain main-owned.

## Block-pinned read descriptions and canonical decoding

`prepareRead({binding,functionName,args:[],block:{number,hash}})` returns
`{chainId,to,data,functionName,args,block,blockTag:{blockHash,requireCanonical:true},
authority:'READ_DESCRIPTION_ONLY'}`. Requires explicit numeric block and nonzero
hash, never latest. Main's reviewed RPC adapter uses that EIP1898 blockHash selector
or another reviewed equally strict binding, verifies chain/header/canonical/finality
policy and observed target code/config, then performs all reads at the same block.
This module describes no network call and does not invent finality or a timeout.

Allowed reads: getAccounting, availableUnits/availableAmount, nextCandidate,
getVoucher/getOperation/getUnit/getBatch/getTerms, currentVersion/listed/quoteUses,
asset/storeId/owner/receiver/four authorities, paused/closed/controlRevision,
quoteDigest/operationPayloadHash. ABI arguments are normalized and width checked.

`decodeRead({binding,read,result})` revalidates the exact pinned descriptor,
decodes installed viem ABI and reencodes it to reject noncanonical/trailing result
bytes. Returns `{chainId,escrow,blockNumber,blockHash,functionName,value,
authority:'OBSERVATION_ONLY'}`; every ABI integer (including uint8) is a canonical
decimal string, addresses/hashes lowercase, tuple names/bool/arrays preserved.
It checks byte serialization only. A browser result or claimed blockHash is not
trusted RPC evidence and cannot commit accounting/public readiness.

## Actual integration gaps and checks

Main must connect a real same-block fact projection: current/listed terms and
content commitments; funded original batch/unit/accounting; candidate seq/
generation/terms + expiry; voucher generation/lock/marker/report; original
OperationExecuted/getOperation kind/caller/payload/result and transaction finality.
Decode results alone do not establish these relationships or pending/final status.
Bucket counts/amounts are ordered A,R,H,S,X; real accounting invariants and final
projection permissions need validation in main, not synthesized balances here.

Also missing: trusted login/payer/owner/partner scopes; original quote review and
quote signer client; issuer/operator authenticated durable clients; original-only
outbox/dispatch/restore journal; public readiness/confirmed-registration gate;
reviewed testnet/token/decimals/gas configuration and provider/runtime composition.
No shared application/API/SQL, existing wallet/identity/onboarding leaf, accepted
contract, root dependency/lock, PG or prior blocked security tests were changed.

Observed offline checks: four ESM tests pass (ABI provenance, permitted ephemeral
EOA quote signature + existing wallet fund, exact four-operation payload/caller,
pinned canonical read decoding), and one Python JSON subprocess check passes.
Commands from project root:

`env -i /Users/mili/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test cp30-backend/integrations/business/business.test.mjs`

`env -i /usr/bin/python3 -B -m unittest discover -s cp30-backend/integrations/business -p 'test_bridge.py' -v`

Tests use explicit synthetic ABI values and an ephemeral test-only memory key;
no network, real identity/key, live balances, actual chain or business acceptance
is claimed. The client interfaces are requirements, not configured placeholder
success implementations. Code is ready for main integration, not a live flow.
