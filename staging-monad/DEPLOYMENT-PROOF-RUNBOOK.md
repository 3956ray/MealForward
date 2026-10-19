# MealForward Monad Testnet — independent deployment proof gate

**Scope:** NEW disposable `StoreEscrow.sol` only. This is not the historic CP30 Mac instance, its 7 USDC funded terms, original PostgreSQL 17, signed Journal, CP31 Render Auth Pilot, or Cloudflare D1 mock staging. This gate does **not deploy** any contract and **never signs or sends a transaction**.

## What is verified

`verify-deployment.mjs` uses only public Monad Testnet RPC methods:
`eth_chainId`, `eth_blockNumber`, `eth_getTransactionByHash`, `eth_getTransactionReceipt`, `eth_getBlockByNumber`, `eth_getCode`, `eth_call`.

Every PASS requires all of:

1. Explicit public manifest: **Chain ID 10143**, pinned Circle test USDC `0x534b2f3A21130d7a60830c2Df862319e593943A3`, exactly 7,000,000 six-decimal base units, fresh contract, separate signer roles for role-separated E2E or an explicitly *insecure* single-wallet developer smoke mode.
2. Locally rebuilt pinned `cp30-contracts/contracts/StoreEscrow.sol` source SHA-256, pinned `solc 0.8.28`, OpenZeppelin `5.6.1`, compiler settings, creation bytecode SHA-256, original ABI and compiler immutable reference ranges.
3. Real deployment transaction from the declared deployer, `to=null`, exact **creation bytecode plus ABI-encoded constructor arguments**, receipt status success, matching contract address, transaction/block identity and canonical block hash.
4. At least 2 blocks of depth as requested by the manifest. **This is not independently proven economic or Byzantine finality.**
5. Deployed runtime bytecode matches byte-for-byte except compiler-declared immutable offsets. Every immutable owner/authority/asset/store getter is checked separately against the manifest.
6. Onchain terms include the exact original meal ID, price `7000000`, version 1, content and image digests, daily UTC+8 [00:00,24:00) window, `computeTermsHash`, `catalog`, `getTerms`, `listed=true`, `paused=false`, `closed=false`.
7. USDC testnet token code exists and `decimals() == 6`.

Tests deliberately reject wrong chain/token/deployer/owner/bytecode, tampered constructor calldata, reverts, reorg-mismatched block hash, under-confirmation, incorrect catalog pricing, and closed/unlisted contracts.

## Reproduce the isolated read-only proof

Use a *public-only* manifest based on `deployment-manifest.TEMPLATE.json`. The example has intentionally invalid placeholders; **never** replace with historic CP30 addresses or post a real secret. This step only makes sense once a **new** testnet escrow deployment has been approved by the wallet owner and its transaction hash is available.

```bash
cd staging-monad
npm install --ignore-scripts --no-audit --no-fund
npm run build
npm run test:proof
node verify-deployment.mjs path/to/public-manifest.json artifacts/StoreEscrow.json
```

The last command emits `VERIFIED_ISOLATED_DEPLOYMENT` only on success, otherwise `DEPLOYMENT_PROOF_BLOCKED`. The manifest is **public-only**: addresses, test transaction hash, store/meal IDs and hashes; it must never contain a private key, seed phrase, signature, QR secret, auth token, cookie, D1 identity token or old CP30 proof.

**Manual wallet test can begin with the isolated static Vercel Preview** (separate `pilot/`), which supports MetaMask account connection, network selection and RPC balance reads, but has **no transfer, signature or approval functions**.

## Release decisions not waived by a proof PASS

- Proof validates that an exact source snapshot was deployed, **not** that the contract is safe, a voucher's real recipient was authenticated, or physical food changed hands.
- Original `StoreEscrow.sol` supports `Issue → Lock → MarkHandover → Report → Settle` but does not itself enforce the product's historical 180-second settlement delay; current onchain `settle()` accepts a lawful H bucket without that waiting condition. External durable delay enforcement or reviewed source upgrade is a separate release gate.
- Browser single-wallet smoke intentionally holds *all* five authorities and cannot count as role-separated acceptance; a later E2E requires distinct issuer, operator, quote, catalog, owner, donor, recipient identities and independent transaction event reconciliation.
- Before true USDC Fund: human approval of the new deployment / signer role model; read-only proof must PASS; donor wallet must have enough test MON and Circle test USDC; sign only on Chain ID 10143.
- A successful receipt is neither a human voucher issuance acceptance nor a chain-to-DB finality proof. Require confirmed `Funded/Issued/Locked/HandoverMarked/Reported/Settled` events, separate wallet/USDC deltas and a durable same-intent UNKNOWN recovery plan.
- Do **not** expose live business write APIs from Render Free, Vercel serverless or Supabase until signer/Journal ownership, replay protection, durable write storage and rollback are independently proven. Existing CP30 source pins, Journal and signed ticket are frozen.
