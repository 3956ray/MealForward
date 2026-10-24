> ⚠️ 此文件是 T1-F 上线前的历史记录，包含当时的 HOLD 和旧 Render Commit，**不能当作当前实时发布状态**。最新正式真源及对新 Agent 的完整交接见仓库根目录 [HANDOFF.md](../HANDOFF.md)。T1-F Issuer-only 已经通过公开 HTTPS 门禁并在独立 T1-E 服务上线；**但真正 `issue()` 交易尚未发出，用户需要先登录、读取 Claim，再另行确认不可逆的预留与 MetaMask 签名**。

# MealForward T1-F · First original Issuer Issue — implementation handoff

2026-10-23, staging / Monad Testnet 10143. Source of truth: Draft PR #40 (`codex/mealforward-t1f-original-issue-recovery-20261023`).

## Scope and actual results

- First real donor funding remains 1 original 7 Test USDC FUNDED Intent.
- Original Recipient Claim `fbab3b22-965d-44e2-b144-d7307b7aa8ea` remains `CONSENT_VERIFIED`, no issue transaction reserved or broadcast.
- Existing deployed StoreEscrow and its original role addresses remain immutable. No CP30 recovery, no new Fund, no settlement.
- T1-F wallet/chain issue protocol, receipt verification, independent issuer deadline, atomic issue reservation, read-only original-hash binding, E2E HTTP role restrictions, source-only human MetaMask Issue UI implemented.
- CI PASS: https://github.com/3956ray/MealForward/actions/runs/39942673908 (source + disposable PG17 009-012, no double issue), https://github.com/3956ray/MealForward/actions/runs/39942674074 (real original Monad public RPC read-only pre-Issue).
- Real Supabase migration 012 `mealforward_t1f_issuer_issue_deadline_immutable_v1` applied at version `20261023105932`. Readback confirms `issuer_issue_deadline` bigint column exists, security advisors no lints, Claim still `CONSENT_VERIFIED` with all issuer operation fields null.
- Render T1-E `srv-dbdgstivcj2c73fnqcc0` is still Live on source `d5e0adf5`, `CLAIM_CONSENT`, without T1-F Issue deployment or enabled route. Its public origin is https://mealforward-t1e-claim-laodao.onrender.com/.

## Why the original Recipient Consent deadline is not the Issue deadline

The Recipient's EIP-712 consent is valid only during its original signing/verification window. Once authentically verified, the claim ledger persists a durable Consent proof. The earlier original T1-F source mistakenly used this expired signature deadline as the later Solidity `issue()` deadline, which would make late issuance impossible. The new 012 column `issuer_issue_deadline` is separately committed with a unique operation ID, wallet nonce and calldata hash when `ISSUE_UNKNOWN` is atomically persisted. Original Recipient nonce/deadline/digest/fingerprint remain immutable; neither a new Claim nor another Consent is created.

## Reviewed first-Issue recovery contract

1. Issuer must be the registered original EOA via T1-E SIWE + CSRF; other wallets cannot reserve/bind/reconcile.
2. Read fresh original onchain Unit 0, Generation 1, original contract runtime, current available bucket, original receipt, and pending Issuer nonce using pinned read-only Monad RPC.
3. Atomically persist first `ISSUE_UNKNOWN`, unique `issuer_op_id`, nonce, new issuer deadline and exact calldata hash before returning one first-send payload. The server cannot sign/send.
4. Only on explicit human MetaMask click attempt `eth_sendTransaction` once; clear sendable memory *before* popup. Wallet rejection/timeout/UNKNOWN must never produce another Issue. If the initial hash is unknown, recover it from MetaMask Activity; do not reuse the nonce by issuing another transaction.
5. Bind only the original actual transaction hash whose origin, nonce, chain ID, target, value and calldata hash match the persisted record.
6. Read the original transaction receipt, check canonical block, expected Issued/OperationExecuted events, exact Voucher ID, A-to-R state, token balance and liability. Mark `ISSUED` only after independent verification.
7. Merchant Lock/Report/Settle are not part of this phase. Original deployed issue does not enforce beneficiary consent onchain, and the known 180s chain-level settlement cooldown gap remains a hard settlement blocker.

## Hold / next release gate

**Not authorized as live wallet-Issue release yet.** The new code is on a Draft branch; the T1-E Render service intentionally remains on its earlier deployed source. Do not silently update Render branch, enable `T1F_ISSUE_WALLET_ENABLED=true`, or ask the owner to send `issue()` until review confirms latest source tests, exact current chain state, rollback and UNKNOWN runbook, and a safe deployment. Never auto-merge PR #40.

Do not paste real database credentials, EIP-712 signature, session cookies or private keys. The owner must confirm any actual Monad transaction in MetaMask.
