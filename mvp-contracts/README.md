# Isolated MealForward MVP contracts

New deployments only. Nothing upgrades or moves funds from frozen CP30/T0 contracts. No deployments or real signatures were performed in this task. Test token has no monetary value. Merchant declaration is not proof of physical delivery. Recipient has no onchain wallet/consent requirement; private credential authentication is the service's responsibility.

## Reproduce

From this directory: `npm ci --ignore-scripts --no-audit --no-fund`, `forge test -vv`, `forge build`, `python3 scripts/export-artifacts.py`. Check exporter invariants with `python3 scripts/test-export-artifacts.py`. Immutable-reference keys are stable range-ordered labels (`immutable_0`, etc.), not compiler AST IDs; consumers iterate their values. Export also refreshes artifact checksums. Foundry needs Solidity 0.8.28 installed (offline configuration). OpenZeppelin is pinned to 5.6.1. Exported JSON has `abi` and `bytecode` ready for viem encodeDeployData, plus compiler metadata, source SHA-256, placeholder runtime and immutable references. Do not compare placeholder runtime directly to deployed runtime (see PROVENANCE.md).

## Deployment and fixed roles

Monad testnet chain 10143; synthetic local tests use 31337. Every real transaction is explicitly sent by the human wallet. Deploy MvpTestToken first with constructor `(address donor)` = `0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952`. It immediately mints exactly 7,000,000 base units (6 decimals) to Donor, so no faucet transaction is needed. Constructor explicitly mints 7e6 at user deployment instead of a separate faucet transaction, per coordinator ruling for the one-voucher MVP. No further mint/faucet method exists.

Deploy MvpStoreEscrow with these six constructor arguments, in ABI order:

1. asset: newly deployed token address.
2. storeId: service's fixed nonzero bytes32 store ID.
3. owner: `0xc4f8a468f10d5f98dcff3282516125e97f26433b` (also immutable receiver).
4. quoteAuthority: same Owner.
5. authorities tuple `{catalog: Owner, issuer: 0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3, operator: Owner}`.
6. entries: one `{terms, current:true}`. Terms tuple: `{mealId: nonzero service-fixed bytes32, version:1, unitPrice:7000000, bodyDigest: nonzero bytes32 digest of fixed meal description, imageDigest: nonzero bytes32 digest of fixed image description, windowCount:1, startMinute0:0, endMinute0:1440, startMinute1:0, endMinute1:0}`.

Use the exact constructor inputs retained by service when checking deployment transaction input. Owner must be transaction sender under application policy; contract construction itself allows any deployer with these fixed arguments. Store and meal IDs and content digests are selected once by service before deployment and cannot silently vary. Whole-day serving uses the inherited UTC+8 terms semantics.

## Funding quote and issuance

Read `computeTermsHash(terms)` from new escrow (commitment includes chain, escrow, store and asset). Owner signs EIP-712 domain `{name:"MealForward C0 Funding",version:"1",chainId:10143,verifyingContract:newEscrow}` with primary type `FundingQuote` and these fields **in order**:

```
bytes32 quoteId
address payer
bytes32 mealId
uint256 currentVersion
bytes32 termsHash
uint256 quantity
uint256 unitPrice
uint256 amount
uint256 deadline
```

Quote uses unique nonzero quoteId, fixed Donor payer, meal/version/hash above, quantity=1, unitPrice=amount=7000000, future UNIX seconds deadline. `quoteDigest(quote)` exposes the exact signing digest. Donor explicitly sends token `approve(newEscrow,7000000)` then escrow `fund(quote,ownerSignature)`. Signature must not be logged. Fund returns batchId and emits Funded; batchId = keccak256(abi.encode(uint256 chainId,address escrow,bytes32 quoteId)). Exact quote replay returns original batch without another transfer; conflicting quoteId payload reverts. On initial success accounting is A=1 unit/7000000, R/H/S/X=0, token balance=liability=7000000.

Read `nextCandidate(mealId)` → `(available,unitSeq,nextGeneration,termsHash,needsExpiry)`. Issuer sends `issue(bytes32 opId,bytes32 mealId,uint8 expectedUnitSeq,uint256 expectedNextGeneration,bytes32 expectedTermsHash,uint256 deadline)` once with exact candidate (first unit 0/generation 1). On success A→R, Issued event and getVoucher agree, expiresAt=issuedAt+259200 (three days). Voucher ID is keccak256(abi.encode(bytes32 keccak256("MealForwardVoucherV1"),uint256 chainId,address escrow,uint8 unitSeq,uint256 generation)). ABI encoding uses 32-byte slots, not packed encoding. There is no recipient address argument.

## Merchant and settlement

Owner sends `redeem(bytes32 opId,bytes32 voucherId,uint256 generation,uint256 deadline)`. New operation kind=12 atomically performs lock/handover/report and R→H, emits all three inherited events followed by OperationExecuted. lockId=markerId=reportId=opId. `getVoucher(voucherId).settlementAvailableAt` is appended after `expired` and equals block.timestamp+180. Exact replay returns opId with no events or state change. Changed payload for same opId conflicts. Different opId for same redeemed voucher fails. Legacy lock/markHandover/report are retained; report also sets the full 180 seconds at H entry, even if handover was much earlier.

Owner sends `settle(bytes32 opId,bytes32 voucherId,uint256 generation)` only at chain timestamp >= settlementAvailableAt. At 179 seconds reverts; at 180 succeeds H→S and pays immutable Owner exactly 7000000. Exact successful replay returns amount without paying again. Service must independently confirm receipt, events, bucket/accounting and fixed receiver balance before success. An on-screen countdown is advisory only.

Accounting preserves F=A+R+H+S+X, liability=A+R+H. Pause blocks new lock/handover/atomic redeem, fund and issue. Close blocks new fund/issue but allows preexisting obligations to complete; pause and close do not block lawful report or settlement. Original available-unit refunds remain available even paused/closed. Unlocked unmarked R expires back to A; locked vouchers cannot expire. Unit generations and immutable original terms are preserved. This is inherited behavior, not an emergency settlement freeze.

Persist one operation ID/input and transaction hash before offering recovery; UNKNOWN must not produce a new send. Contract replay guards do not authorize automatic wallet retries. Public runtime checks must verify role getters as well as bytecode normalized over constructor immutables. Artifacts do not prove deployment, third-party audit, or human acceptance.
