# MealForward 留膳 · T1-D real Monad Testnet FundingQuote protocol acceptance candidate

Date 2026-10-22 (UTC+8). **Source/test only, NOT deployed as a funding service**. No new financial transaction has been sent.

## Scope / real fixed on-chain facts

- Chain 10143 (Monad Testnet).
- Existing original T0 StoreEscrow: `0xcF0C8827C8610EEFF1ecbd9719E559d805FafE58`.
- Circle test USDC: `0x534b2f3A21130d7a60830c2Df862319e593943A3` (6 decimals).
- Existing original Quote Authority EOA: `0xcc5C1ce846c0302ab27a4811cf2e0E6FC7282952` (prior T1-B harmless control challenge HUMAN PASS, but NOT a FundingQuote).
- Existing fixed meal: `0x44f977bbf22112030199e42ccf232d08fe6e8223be9c274944c8a40671f6ae6b`, version 1, Terms Hash `0x0ec28ec279f5a4b4321da6d4b1698fea8e57cd8a64743de02677c73cb86a9222`.
- One real test payment only: **one meal, 7 Test USDC (7,000,000 base units)**. Max T0 funded-capacity 10 lifetime units; no repeated/parallel test funding before verified original receipt.

## This PR delivers

- `t1-funding/quote-protocol.mjs` builds a complete EIP-712 V4 `FundingQuote` using the **exact original StoreEscrow domain** `MealForward C0 Funding` / version `1` / chain `10143` / original verifyingContract. It includes explicit `types.EIP712Domain`, preventing the real MetaMask empty-domain signature bug that caused first T1-B human failure.
- Only a persisted original Intent with exact payer, immutable Quote ID, T0 meal/version/terms, one 7 USDC quantity, and a live short expiry can be converted into a funding quote.
- `verifyOriginalFundingQuote` recovers the original on-chain Quote Authority from ECDSA; no arbitrary signer may authorize a production quote. CI-only ephemeral signing override is gated by an exact GitHub Actions disposable flag, never available to live Render.
- `exactApproveTransaction` constructs **only** ERC20 approve(new StoreEscrow, 7,000,000), on Monad chain 10143, with the exact pending nonce supplied by the payer wallet.
- `exactFundTransaction` only constructs StoreEscrow `fund(originalQuote, signedFundingQuote)` after original `APPROVED` stage and valid signed quote, preserving exact payer, amount, deadline and Quote ID. It does not sign, estimate gas silently, submit, broadcast or listen to any wallet provider.
- `t1-funding/006_quote_authorizations.sql` is a **proposal**, not applied: an append-only signed FundingQuote record bound to the immutable Intent, with the real Quote EOA address enforced at PostgreSQL level. Signed `FundingQuote` is a payer-scoped authorization capability, unlike the harmless T1-B role-control signature. Never expose raw signatures publicly or copy into logs.

## Test evidence

[GitHub Actions T1-D MetaMask V4 + exact EIP712 + transaction encoding 9/9 PASS](https://github.com/3956ray/MealForward/actions/runs/39751454640).

Nine tests assert immutable T0 parameters; reject 2-unit/wrong-price/wrong wallet/origin/chain/terms/expired Quote; cross-check actual pinned MetaMask EIP-712 V4 hashing with ethers.js; reproduce T1-B's missing `EIP712Domain` bug; ensure real Quote EOA is immutable in production; reject tampered signed quote; parse exact ERC20 spender/value/nonce; parse exact `StoreEscrow.fund` tuple/signature; and block synthetic authority override without disposable CI.

## Live cloud status (separate existing T1-C)

- The NEW free Render server at https://mealforward-t1c-readonly-laodao.onrender.com is **LIVE**. Actual GitHub Actions HTTP smoke **7/7 PASS**: https://github.com/3956ray/MealForward/actions/runs/39739268066 .
- The current public UI is **SIWE + read-only My Intents**. It does NOT yet request `eth_sendTransaction`, approve or fund. That is intentional until transaction durability is wired into the REAL newly-isolated Supabase PG17.
- The user supplied the NEW Supabase app account credentials in chat. Because they are exposed, rotate them before public paid/production usage; user specifically approves staging-only Testnet continuation, but the trust model remains weakened by those credentials. No private keys were disclosed.
- No real Funded receipt, Test USDC escrow delta or chain-funded voucher has been demonstrated.

## Next T1-D code gate (before the first wallet prompt)

1. Migrate a reviewed T1-D signature-handoff table to the NEW `mf_t1c` schema, with append-only and restricted donor access. Add a narrow new funding-write PostgreSQL LOGIN or restricted grant (currently Intent role is strictly SELECT-only) with the signer independent from the server.
2. Add authenticated `POST Prepare` for original payer SIWE; prepare must be durable with idempotency, one meal, one Quote ID.
3. Add Quote Authority SIWE-only `GET quote-request` / MetaMask EIP-712 `eth_signTypedData_v4` / POST original quote signature. Only actual chain-registered Quote EOA can authorize it; persist original signed authorization atomically to the same intent. No server private key.
4. Add donor-only retrieval of its unique signed Quote. Require exact original Approve transaction reservation **committed in PostgreSQL BEFORE displaying the MetaMask approval prompt**; UNKNOWN never retries or fabricates a new nonce.
5. For each original approved wallet operation, bind its returned on-chain tx hash after verifying payer/nonce/to/calldata and receipt; confirm ERC20 Approval/allowance first, then repeat original-reservation process for Fund and verify the real onchain `Funded` + `Transfer` + quoteUses + escrow solvency. Never infer success solely from a tx hash.
6. Reuse only user-owned wallet clicks. Never auto-broadcast, never call withdraw/settle. Existing StoreEscrow does NOT enforce on-chain 180s settlement delay (Issue #17), so payout remains closed.

Do NOT enable an unsafe browser-localStorage-only funding path, migrate the frozen Mac CP30 PG/Journal/old USDC, rebuild the original T0 contract or merge unreviewed PRs.
