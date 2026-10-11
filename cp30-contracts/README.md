# CP30-C0 local financial foundation

BUILD_LOCAL_ONLY / NOT_ACCEPTED. This slice is a synthetic financial contract test project inside the existing repository. It does not modify or connect the historical runtime.

The factory's constructor atomically creates exactly three fixed store escrows. Its deployer chooses those three constructor configurations; there is no later registration, admin, fourth slot or setter. All use one fixed token and quote authority; each store's owner is also its immutable receiver. Independently deployed lookalike escrows are not entries in this factory. Deployment/configuration trust remains a later approval gate.

Escrows expose funding and original-payer batch-local-mask refunds only. Synthetic catalog/current pointers are constructor-only; there is no publication, listing, pause/close, issue, voucher, R/H/S, settlement, DB/API, identity or provider integration. All units are A/X. Amounts and unit counts are separate, F=A+X, liability=A. Ten lifetime funded units per store never reopen after refund. Sequence is zero-based globally within one escrow; refund masks are local to one batch, not that global sequence.

Funding quote: EIP-712 name `MealForward C0 Funding`, version `1`, actual chain ID and exact escrow address. Type is `FundingQuote(bytes32 quoteId,address payer,bytes32 mealId,uint256 currentVersion,bytes32 termsHash,uint256 quantity,uint256 unitPrice,uint256 amount,uint256 deadline)`. No identity or email is in the payload. Quote validation is permission for this fixed financial schema, not business authentication. Only the original payer may submit, including a replay. New execution requires timestamp < deadline. Same quote ID/payload plus valid authority signature returns the original batch even after expiry/cap exhaustion/full refund, without another transfer. A different signed payload with that ID conflicts.

Transfers use installed OpenZeppelin SafeERC20 plus CEI/nonReentrant. Exact incoming escrow increment and payer decrement, outgoing escrow decrement and original-payer increment are required. Donation surplus does not create units/F. No-return standard tokens work; tested false-return, revert, tax, extra debit/credit, changed sender balance and no-movement behaviors fail atomically. This cannot certify any arbitrary malicious token or future rebasing behavior: real asset allowlisting/code/decimals/proxy/behavior proof remains required. A synthetic external negative rebase test deliberately creates a deficit and checks writes fail closed without erasing liability. There is no rescue/withdrawal function.

## Reproduction with installed tools only

From repository root use the installed native binary; no downloads, RPC/fork, Anvil, scripts, keys or services are used:

```sh
node_modules/@foundry-rs/forge-darwin-arm64/bin/forge test --root cp30-contracts --offline --no-match-test 'testFuzz|invariant' -vv
node_modules/@foundry-rs/forge-darwin-arm64/bin/forge test --root cp30-contracts --offline --match-test testFuzz --fuzz-seed 0xc030 --fuzz-runs 2500 -vv
node_modules/@foundry-rs/forge-darwin-arm64/bin/forge test --root cp30-contracts --offline --match-test invariant --fuzz-seed 0xc030 -vv
node_modules/@foundry-rs/forge-darwin-arm64/bin/forge test --root cp30-contracts --offline --no-match-test 'testFuzz|invariant' --gas-report
node_modules/@foundry-rs/forge-darwin-arm64/bin/forge test --offline
node_modules/@foundry-rs/forge-darwin-arm64/bin/forge test --root testnet --offline
git diff --check
```

Independent configuration pins solc 0.8.28/cancun, optimization 200, chain 31337, OpenZeppelin import from installed root 5.6.1, FFI disabled/offline. Four fuzz methods x2,500 =10,000 requested cases. Stateful gate is 64 runs x256 depth; targeted handler has six action selectors and an independent original-unit/payer-debit-credit reference model. `afterInvariant` asserts random successful actions beyond deterministic A/X/surplus bootstrap and writes each hook's actual distribution. Historical testnet-named tests are also in-process generic EVM logic, not network transactions.

`afterInvariant` writes only scoped `evidence/invariant-actions.jsonl`; the installed runner invokes the final verification hook once again, so the observed 64 random runs produce 65 raw rows. The last row must match row64 and is not counted as extra random work. Before reproducing that suite, truncate this evidence file explicitly (it contains only synthetic counters). `test/collect-evidence.py` validates captured JSON results and reconciles the first64 rows, subtracting the three-per-run bootstrap fund/refund/donation actions, to the runner's exact selector attempts. It rejects missing rows, mismatches or vacuous distributions. Optional invariant discovery lists are explicitly empty; targets are only the six financial handler selectors.

`node cp30-contracts/test/write-vectors.mjs` regenerates the fixed public quote vector using installed viem2.57.1. `Vectors.t.sol` checks its constants independently in Solidity; the example verifying address0x3000 is not deployed. `Gas.t.sol` captures specified input/state calls; `gas-report.txt` is a separate aggregate report including negative/replay paths. Gas values are not production fees.

Evidence will record actual results, tool versions, seed, distribution, local EVM Gas and hash vectors. NOT_RUN: Monad fees/finality, real token/wallet/auth/OTP, indexer/DB/API, NFT/Mera, full DApp E2E and capacity/track qualification. Source freeze requires a clean local commit and independent review; no acceptance is asserted by tests alone.
