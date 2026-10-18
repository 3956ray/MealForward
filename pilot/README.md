# MealForward | Independent real Monad Testnet wallet pilot

**This pilot is an ISOLATED new smart contract and website**, not the original
CP30 six-service backend, 7 USDC escrow, pending Journal or old funded order.

## What it proves

It replaces browser-only fake state with actual signed transactions and
on-chain events. Users can deploy a fresh pilot escrow (wallet confirmation),
register a kitchen, mint **free mock mMEAL** (no real dollar value),
ERC20-approve and fund, claim a voucher with another wallet, sign a
short-lived EIP-191 authorization, have its designated merchant reserve
it, explicitly acknowledge physical handover, and settle after a
30-second on-chain delay. This is a **real Monad Testnet** prototype
with counterfeit-worthless testing credit, not production USDC.

There are no hosted private credentials, centralized operator, reused CP30
roles or automatic business transactions. Every change is signed
by the user's MetaMask account. The test explorer is
\`https://testnet.monadvision.com\`; chain ID is \`10143\`.

This is not evidence that the actual MealForward CP30 trust model,
original data, USDC finality or physical food delivery has been accepted.

## Deploy and cross-device use

The Vite frontend builds at \`pilot/dist\` from the \`pilot\` directory.
Solidity is compiled using solc 0.8.28 and explicitly imported reviewed
OpenZeppelin 5.6.1. The site embeds ABI and deployable bytecode; the merchant
can deploy it using MetaMask only after explicitly accepting the deployment
transaction. The new constructor on chain 10143 creates a separate
PilotMealCredit token. Nothing is deployed automatically by GitHub CI.

- Share link \`/?pilot=0xPilotAddress\` between browsers. URL contains
  only the public contract address, no cookie, key or voucher credential.
- The test network faucet \`https://faucet.monad.xyz\` provides MON for
  gas. A separate on-chain PilotMealCredit \`faucet()\` gives each
  test wallet 100 mMEAL once; real USDC addresses are not used.
- See \`/test-guide.html\` for the manual three-wallet acceptance steps.
- Compiled ABI/bytecode are generated during the Vercel build, never
  substituted with mock success or opaque backend states.

## Security limits

- Owner of each kitchen is immutable and is the only wallet able to
  reserve, confirm handover and settle that kitchen.
- Recipient must sign an EIP-191 message binding chain ID, contract,
  voucher ID, nonce, expiry (<=120 seconds), and merchant wallet.
- Reserve is not physical handover, and physical handover is a
  merchant-reported action, not cryptographic proof of food served.
- Settlement requires a HandedOver voucher and a 30-second *block-time*
  delay, pays exactly its original unit price in worthless test credit,
  and cannot repeat.
- Faucet only permits one free mint per address. This is NOT controlled
  issuance, and credit has no real-world value.
- One claim per wallet/kitchen and limited 1–5 meal funding per tx.
- No refunds, real charity entitlement, third-party witness, KYC,
  malicious-merchant dispute or real payment reconciliation. Do not send
  real money or use it as a real charity product.
- Public RPC may be rate-limited; transaction confirmation means a chain
  receipt was observed, not an independently verified long-horizon
  financial finality claim.
- The no-refund design is acceptable **only** because mMEAL is entirely
  worthless and directly faucet-mintable. Never migrate this escrow
  to real USDC without redesigning disputes, unused funding refunds and
  malicious-platform resistance.

## Engineering gate and test evidence

Run \`cd pilot && npm install && npm run build\` then
\`node tests/chain-e2e.mjs\` with local Anvil installed to test
non-custodial real EVM transactions on an isolated local 10143 node.
CI will execute the full four-wallet lifecycle, duplicate voucher,
incorrect-signature, incorrect merchant and delayed settlement
rejections. No RPC to the public testnet from CI, wallet seeds from
the user or old original PG is involved.

Only after on-chain CI and independent Vercel deployment are green should
a user perform the live Monad browser acceptance checklist.
