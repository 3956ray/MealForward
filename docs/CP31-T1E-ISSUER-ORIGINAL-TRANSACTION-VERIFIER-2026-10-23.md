# T1-E — Issuer 原始 issue() 交易构建与只读 Receipt 证据

Date: 2026-10-23 (UTC+8). This code is a **non-deployed source-only continuation** from [T1-E PR #36](https://github.com/3956ray/MealForward/pull/36).

## Real funded unit — unchanged

- Network: Monad Testnet 10143.
- Original contract: `0xcF0C8827C8610EEFF1ecbd9719E559d805FafE58`.
- Exactly one funded original Unit 0, first generation 1, 7 Test USDC held by escrow.
- Original `issuerAuthority`: `0x9747D93d9F8C2e1202b4d922a4916fcF634aA2B3`.
- Recipient Claim table: `mf_t1e.recipient_claims` with a separate `mf_t1e_claim_runtime` **NOLOGIN** role.
- Original 7 Test USDC funds remain in the escrow; no new recipient, no Issue, Lock, Report, or Settle.

## New verified code

- `t1-intents/t1e-issuer-original.mjs`: `exactIssuerCall` builds reviewed `issue(opId, mealId, 0, 1, termsHash, deadline)` calldata only for a frozen CONSENT_VERIFIED original claim and pinned Issuer, fixed Monad Testnet 10143, a unique operation ID, bounded deadline and explicit nonce. No wallet action is performed; the caller would first persist an original `ISSUE_UNKNOWN` record in the separate ledger.
- `attestIssuerReceipt`: reads original onchain tx, receipt, canonical block and read-back Unit/Voucher/Accounting via allowlisted read-only RPC. It verifies issuer address, nonce, calldata hash, op ID, original first-unit args, exactly one Issued event and bucket A→R with unchanged 7 USDC liability.
- Missing receipt is `UNKNOWN` with `mustNotRetry=true`. A failed receipt is terminal `REVERTED`, also `mustNotRetry=true`. No chain writes, no wallet signing.
- `t1-intents/t1e-issuer-original.test.mjs` includes wrong-wallet/nonces, state transitions, missing/mismatched Receipt, forged Issued events and hash collision/alteration rejection.

## Important hard boundaries

The original StoreEscrow contract **does not** enforce consent against a malicious Issuer: independent recipient EIP-712 consent currently provides only **offchain** assurances, not chain-level binding. This verifier does not establish beneficiary eligibility or proof of meal delivery, and **cannot be called a release-ready Claim/Issue API**.

Before one genuine first `issue()`, still required:

1. Prove possession of the distinct registered Issuer wallet by user-controlled harmless signature; no private keys in any backend or CI.
2. Enroll one distinct recipient SIWE wallet with a genuinely independent eligibility rule and durable nonce, then cryptographically verify its EIP-712 consent and database principal.
3. Build a dedicated, same-origin recipient/Issuer HTTP flow using T1-E **own** least-privilege login role; all T1-D Auth and Fund private principals remain separate.
4. Atomically reserve `ISSUE_UNKNOWN` opId/nonce/calldata hash before the human MetaMask popup. If hash or reply is lost, **recover only the original tx, never auto-send a replacement**.
5. Verify the exact original receipt and event before changing status to `ISSUED`; release private voucher details only to the authenticated recipient.
6. Do not call `markHandover`, `report` or `settle` to close payment until separate Operator/Owner authorization and Issue #17's missing onchain 180-second delay receive explicit security signoff.

Original Mac CP30 PREPARED #3560, historical journal and old credentials untouched. T1-D Funding Render remains deployed to a separate branch; no deployment from this PR.

## Quality gate

The workflow `.github/workflows/mealforward-t1e-issuer-original-tests.yml` runs source checks and unit-negative tests on GitHub Actions; it never connects to your wallet or submits a transaction.
