# CP30 offline wallet preparation

Candidate code only: no provider/RPC, connection, signing, broadcast or deployment.
Installed `viem` is reused without changing any dependencies. Owner registration,
funding and owner settlement are not connected to the product yet.

## Lead Developer interface

Import pure ESM exports from `index.mjs`. A trusted backend must supply the immutable
binding; caller-entered addresses are not authentication or configuration evidence.
All integer fields use `bigint` or canonical unsigned decimal strings (no decimals,
scientific notation, leading zeros or JS numeric amounts). `chainId` is a positive
safe JS integer. Amounts are token base units; native gas is separate and tx value is 0.

- Escrow `binding`: `{chainId, escrow, asset, owner, receiver, quoteAuthority}`;
  owner must equal receiver. Wallet: `{chainId, account}` from an explicit user action.
- `prepareApprove({binding,wallet,payer,amount})`: exact nonzero allowance to escrow.
  Supply the authenticated/backend quote payer and exact quote amount. Existing
  allowance/token-specific reset policies remain an integration responsibility.
- `prepareFund({binding,wallet,signedQuote,now})`: signedQuote has
  `{chainId,escrow,quoteAuthority,quote,signature}`; quote is the original nine-field
  `StoreEscrow.FundingQuote`, never regenerated here. Backend supplies and verifies
  the authority signature; this function checks syntax, payer, deadline and integer
  product, not cryptographic validity, live terms, cap or balances. `now` is seconds.
- `prepareSettle({binding,wallet,opId,voucherId,generation})`: only bound owner;
  IDs/generation are the persisted original backend operation, never new retry IDs.
- Factory binding: `{chainId,factory,registrar,asset,quoteAuthority,catalogAuthority,
  issuerAuthority,operatorAuthority,escrowCreationCodeHash}`. `registrationConfigHash({binding,storeId,owner,
  catalog})` is exactly keccak256(abi.encode(asset,quoteAuthority,catalogAuthority,
  issuerAuthority,operatorAuthority,storeId,owner,catalog)).
- `prepareRegistrationTypedData({binding,wallet,registration,catalog,now})` returns
  `{domain,types,primaryType,message}` for the owner's explicit EIP712 authorization.
  Registration: `{registrationId,storeId,owner,deadline,configHash?}`; a supplied hash
  must match. Domain is `MealForward Store Registration`, version `1`, current
  chainId and factory. Catalog uses original nested `CatalogEntry{terms,current}`
  ABI and must be nonempty, with unique/highest current versions and valid windows.
  Nonzero commitments do not establish that a real meal draft/content exists.
- `prepareCreateStore({binding,registrar,registration,catalog,ownerSignature,now})`
  prepares the four-argument platform registrar call; the owner does not pay
  deployment gas. The fourth argument is the fixed exported
  `compiledStoreEscrowCreationCode` constant from the same Factory build. Caller
  `escrowCreationCode` input is rejected. Its hash must equal the trusted backend
  `binding.escrowCreationCodeHash`; verify that pin against the factory immutable
  getter in the backend before enabling. Arbitrary code and constructor tails
  are never accepted. Factory itself appends the authorized constructor arguments.
  Arbitrary owner signature bytes permit the factory's SignatureChecker/ERC1271
  path. This function does not verify owner signatures. Same-registration retry
  after deadline must query the original transaction/registrationUses; this module
  deliberately refuses preparing a fresh expired deployment.

`registrationDigest(typedData)` returns the complete EIP712 digest of the prepared
registration authorization (including domain/deadline); no owner-signature verification
function is provided. Factory SignatureChecker and the trusted backend own that check.
`validateEscrowCreationCode` is an offline byte-for-byte/pin validation helper only.

Preparation returns `{chainId,from,to,value,data,functionName,args,correlation,
authority:'PREPARATION_ONLY'}`. These objects contain bigint; convert with a deliberate
JSON adapter at the shared HTTP boundary rather than silently using JS numbers.
Do not store owner signatures or quote signatures in public UI/history.

`decodeOriginalCall`, `decodeEscrowEvent`, `decodeRegistrationEvent` and
`decodeEscrowState` decode observations; state supports getOperation/getVoucher/
getUnit/getBatch/getAccounting. `matchOriginalTransaction` binds observed original
chain/from/to/value/calldata/hash. `observeOriginalReceipt` binds receipt hash/from/to
and yields PENDING, REVERTED_OBSERVED, UNKNOWN or MINED_UNVERIFIED. Even status1 and
matching events never yield final success; backendFinalVerification remains
NOT_CONNECTED. Logs may be decoded for display, never used to commit business state.

Shared consumer/provider action wiring, safe session/account binding, quote issuing,
backend original-transaction receipt/finality/config verification, durable journals,
registrar service, initial draft/readiness/publication gates and real token/network
configuration remain Lead Developer integration work. UNKNOWN only queries the
original transaction/registrationId. One initial store/meal/token is the first-run
product scope; three-store cap remains factory scope. No real wallet or testnet
operation has been run; no module or full-flow acceptance is claimed.

## Offline checks

From the project root: `node --test cp30-backend/integrations/wallet/wallet.test.mjs`.
Eight focused synthetic tests compare the copied ABI entries to the existing accepted
S0b compiled artifact, encode/decode transactions/events/state, reject binding and
amount errors, independently encode factory configHash, check typed-data order and
registrar caller, keep pending/mined observations distinct from final success, and reject altered
creation code, appended constructor tails, missing/wrong codehash pins and caller code.
Escrow ABI provenance: `cp30-contracts/out/s0b-final/StoreEscrow.sol/StoreEscrow.json`.
Factory four-argument ABI/getter also match the current compiled candidate
`cp30-backend/integrations/onboarding-contracts/abi/RegistrationFactory.json`
(createStore selector `0xed89c3b2`)
(copied actual ABI entries, including Solidity internalType and explicit output names).
Factory interface matches current candidate RegistrationFactory source and Leader's
2026-10-12 parallel brief; no other writer's files were changed.

Fixed creation-code provenance: same-build
`cp30-backend/integrations/onboarding-contracts/abi/StoreEscrow.creationCode.json`;
keccak256 = `0x3aed59967d18f9b80a436f1080f9b55b5ea9299f62eb1c7d8f612d7ed8d30b4e`.
The original StoreEscrow source is unchanged. Historical accepted S0b-final artifact
creation-code hash is `0x85b86f1b56b6a4494017ddc3945ca1ce562ca1078616326c808ddf4883dfc223`;
compiler remapping/metadata differ, so that historical code does not match the new
factory pin. Both creation codes are 25,501 bytes. Rebuilding/replacing the fixed
Factory requires an explicit artifact/hash update here, never a user-supplied code
override. Creation-code hash is not part of Registration/configHash; it is a separate
immutable factory/backend binding and transaction-preparation gate.
