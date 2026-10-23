# MealForward 留膳 · T1-D FIRST REAL 7 Test USDC Fund

Date: **2026-10-23** (UTC+8). Original T0 StoreEscrow was **not** redeployed. This is a successful **first original Testnet funding**, NOT complete donor-to-recipient-to-merchant fulfillment.

## Audited outcome

| Measure | Verified |
|---|---|
| Network | Monad **Testnet**, chain ID **10143** |
| Original immutable escrow | `0xcF0C8827C8610EEFF1ecbd9719E559d805FafE58` |
| Original Circle Test USDC | `0x534b2f3A21130d7a60830c2Df862319e593943A3` |
| Original donor and registered Quote Authority (self-funded pilot) | `0xcc5C1ce846c0302ab27a4811cf2e0E6FC7282952` |
| Test meal | `0x44f977bbf22112030199e42ccf232d08fe6e8223be9c274944c8a40671f6ae6b` (1 × 7 Test USDC) |
| Original PostgreSQL Intent ID | `2b9ae6f1-2bb7-4096-8136-70f30f302eea` |
| Immutable quote ID | `0xd19b6ca862dc452dd13246bac6faba2d024ba7c59add7e614c6d3b9b54421e12` |
| EIP-712 quote digest | `0xad03e29d0d3b8e97f73710822961c5162cde1cdcfc4b034b63c1a566fb14a31a` |
| Final persisted Intent stage | `FUNDED` |
| Real new ledger counts | Intents **1**, Wallet Attempts **2**, Signed Quotes **1**, Audit Events **8** |

### Original onchain transactions

| Step | Actual tx hash | Nonce | Block | Status |
|---|---|---:|---:|---|
| Approve, exact 7 Test USDC | `0x0b5ef56afe4e8ffcba6349b7893929231213a130896a7810d5f428723b4a218d` | 7 | 73410402 | CONFIRMED, receipt 1 |
| Fund, 1 original meal to StoreEscrow | `0x6d241844fc0edda40af1c30eceab11ac0b95057337218de21e0c4026954ce219` | 8 | 73410628 | CONFIRMED, receipt 1 |

Receipt block hashes:
- Approve: `0x65e25481798e882a51c96cd07457639566d4047d5c595c189c60419d67857dd3`
- Fund: `0xe90a0e084d9b83e6063c04a2e831158d53173c77c6cd2e240551257587c80b9e`

### Independently verified public Monad chain

[Read-only separate GitHub Actions attestation **PASS**](https://github.com/3956ray/MealForward/actions/runs/39890862194).

At chain observation block 73412359, the separate attestation used pinned Monad Testnet public RPC and independently checked actual tx bytes, sender/recipient, nonces 7/8, canonical pinned blocks, both successful receipts, ERC-20 `Approval` for 7 Test USDC, original `StoreEscrow.fund` calldata, recovered EIP-712 Quote Authority signature and quote digest, exact single `Funded` event, exact single Test USDC `Transfer`, onchain `quoteUses` for the original quote ID, read-back liability and ERC-20 escrow balance at receipt block, and fundedUnits = **1**.

At original Fund receipt block 73410628 (base units, 6 decimals):

- Original Escrow USDC balance: **7,000,000 = 7 Test USDC**
- Original Escrow liability: **7,000,000 = 7 Test USDC**
- Original donor Test USDC balance: **84,500,000 = 84.5 Test USDC**
- `lifetimeFundedUnits`: **1**
- `Funded` event: exactly 1; exact `Transfer`: exactly 1
- `Escrow balance >= Escrow liability`: **PASS**
- Programmatic wallet transactions from the attestation: **0**.

EIP-712 raw signature bytes were **never printed by the independent audit**. They were verified by deriving the digest/signer from the public *already executed* chain transaction; no private signer key was used.

### Actual Supabase persistence

Isolated project: `mealforward-t1-staging` (`ketfrukrcuosrqynnsay`), distinct T1-D private Auth and immutable financial ledger schemas. Direct read-only SQL verified:

1. One `mf_t1c.intents` row: payer pinned, `quote_id` and `quote_digest` pinned, amount 7,000,000, quantity 1, `stage=FUNDED`, revision 5.
2. Two `mf_t1c.wallet_attempts` rows (`approve` and `fund`), each `CONFIRMED`, exact hashes/nonces/receipt block numbers/block hashes/`receipt_status=1`.
3. One `mf_t1c.quote_authorizations` row, immutable original Quote ID/digest and recorded original Authority. **Do not export raw quote signature**.
4. Eight `mf_t1c.audit_events`, in sequence: `INTENT_PREPARED`, `QUOTE_BOUND`, `APPROVE_RESERVED`, `APPROVE_HASH_BOUND`, `APPROVE_CONFIRMED`, `FUND_RESERVED`, `FUND_HASH_BOUND`, `FUND_CONFIRMED`.
5. No duplicate or second original Intent/Wallet Attempt/Quote in this staging snapshot.

The original transaction recovered to an immutable original quote (not a simulated receipt). Wallet MetaMask separately confirmed the EIP-712 signature and Approve/Fund; the server independently reconciled confirmations.

### Actual isolated Render deployment

- New T1-D service `srv-dbd0nl67bikc73a5grh0`, `https://mealforward-t1d-funding-laodao.onrender.com`.
- Live deployed funding backend commit `4eae10780a94a328819a0d4f89abd3247cea7b8b`, deploy `dep-dbdc7kpsrm7s73b8d69g`, `T1D_FUNDING_WALLET_SERVICE_READY`.
- No automated broadcasting, no mainnet, no new escrow deployment or payout.
- Original T1-C readonly Render service, its existing DB roles, and old Mac CP30 `PREPARED #3560` are outside this pilot and were not modified.

## Release boundary and outstanding work

**Do NOT Approve or Fund this original quote again.** It is conclusively FUNDED and its original onchain `quoteUses` recorded. The first-fund pilot contract readiness endpoint explicitly rejects *additional* first-test prepares once `lifetimeFundedUnits` is nonzero, but this is **not** a generalized database-level/global funding cap for future users. No second wallet send or new Quote ID is authorized within this test.

This demonstrates **donor escrow funding only**, not beneficiary receiving a voucher, Issue/Claim, dynamic QR, Lock, merchant Report, or actual Settle/Release. Do not claim that any recipient received a meal or that 7 USDC was paid to a restaurant. Escrow currently **holds** the 7 Test USDC as contract liability, not as merchant proceeds.

Before the next product milestone:
- Freeze/protect the completed funding snapshot; monitor original events and DB against chain; verify no unexpected second Intent/Quote. Avoid private wallet secrets in logs.
- Implement and verify actual voucher issuance/recipient claims tied to this **one existing funded unit**, with time-window handling, replay protection and coherent chain/offchain indexer state.
- Design merchant QR redemption trust boundaries, `lock`, `report` and merchant `settle`, including real onchain 180-second cooldown limitation (Issue #17) and malicious platform/merchant collusion assumptions.
- Explicitly separate production donor and Quote Authority identities; the self-funded Quote Authority payer is **a bounded pilot**, not production trust separation.
- Eventually rotate previously exposed *old T1-C* credentials before opening real public production sign-in.
- Never import/replay frozen Mac CP30 Journal or overwrite the pilot ledger.

This is a **Testnet verification** only. Test USDC carries no mainnet redemption value.
