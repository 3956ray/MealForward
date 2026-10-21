# MealForward 留膳 — Monad Testnet T0 Role-Separated Escrow

Date 2026-10-21 UTC+8. Source-only isolated T0. NOT production StoreEscrow or old Mac CP30.

## Delivered

The existing Vercel read-only wallet-preflight page remains read-only. The new /deploy-t0.html page adds exactly ONE user-click initiated MetaMask eth_sendTransaction: deployment of a completely new role-separated StoreEscrow on Monad Testnet 10143. It cannot Approve, Fund, Issue, Lock, Report or Settle.

Original audited Solidity source SHA-256: bd84f387a46428802a453f28306ad6f9de7317465ff48844619d550713ce0c66
Original creation bytecode SHA-256: 9c2583ee25a9fc08aa2434efde455ee7fc0c945847d3ef7789dfd370735d7a8d
Pinned solc 0.8.28+, OpenZeppelin 5.6.1, optimizer 200, Cancun.
Token: Circle TEST USDC 0x534b2f3A21130d7a60830c2Df862319e593943A3 (6 decimals).
Menu: 留膳社区厨房 / 暖心盖饭 / 7 Test USDC / 1 all-day UTC+8 service window with explicitly labeled test digests.

Five original authorities MUST all have separate addresses: Owner/Deployer, Quote, Catalog, Issuer, Operator. Owner alone signs this T0 deployment. Owner must be a new disposable test wallet with TEST MON gas. No old CP30 contract, payment or key is used.

Before prompting MetaMask the page validates reviewed bytecode+ABI hash, chain ID, Circle test USDC code/decimals, current Owner, roles and gas estimate. It saves the pending original manifest BEFORE opening the wallet popup. A response loss is UNKNOWN and **blocks additional deployments**; a pasted historical MetaMask TX Hash may be recovered only after an exact owner+constructor byte-for-byte match.

Read-only verification after actual owner deployment must match deployment TX input/constructor args, receipt/block, at least 2 confirmation blocks, runtime except compiler immutable offsets, immutable role getters, USDC decimals, catalog, listed/open status, version and fixed Terms hash. It exports a public manifest/report without any private key, seed, signature or cookie. Two confirmations are depth evidence, not cross-RPC economic finality.

## CI evidence

- Role-separated browser proof and static Vite page CI: https://github.com/3956ray/MealForward/actions/runs/39579020914 (SUCCESS on an earlier source commit; latest branch head must also be checked).
- Original StoreEscrow reproducible ABI/bytecode artifact: https://github.com/3956ray/MealForward/actions/runs/39579021015
- The Vercel preview is automatically built from the isolated branch by the existing mealforward-real-testnet-pilot project. It may require Vercel SSO. Not connected to the original CP30 server, Render Auth Pilot DB or final product domain.

## Owner-only acceptance

1. Open the latest isolated Vercel Preview; complete read-only Monad network and test wallet balance checks.
2. Download the StoreEscrow.json artifact from the current original-compiler GitHub Actions workflow; upload it to /deploy-t0.html.
3. Enter four additional DISTINCT test wallet addresses for Quote, Catalog, Issuer and Operator; current MetaMask address is Owner.
4. Click readonly Prepare and review exact chain ID 10143, role addresses, new Store ID, new Meal ID, fixed test USDC price and gas estimate.
5. Only if proceeding with a real TESTNET deployment, personally approve the sole Deploy transaction in MetaMask. No USDC allowance or funds transaction is permitted here.
6. Verify the original deployment receipt, live code and roles. If TX status is UNKNOWN after reload, DO NOT deploy again; recover the exact original Hash.
7. Copy the public Manifest/verification report (never share a private key, secret, wallet sign-in cookie or beneficiary voucher).

## Other gates remain blocked

The old Mac CP30 signed Journal PREPARED #3560 has not undergone full safe backup/chain audit/recovery; its existing funded 7 USDC/old vouchers are frozen. The Render Auth Pilot SIWE cookie is NOT the original CP30 principal. Original StoreEscrow directly lacks an on-chain 180-second settlement cooldown (issue #17). No money writes are enabled in this Vercel T0 branch; successful deployment is NOT full G4/G5 funding, redemption or settlement.

Do not merge this isolated branch to main or enable live money/role operations merely because T0 verification succeeds.
