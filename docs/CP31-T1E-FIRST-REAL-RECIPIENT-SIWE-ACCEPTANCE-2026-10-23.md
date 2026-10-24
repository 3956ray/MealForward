# MealForward T1-E · First real Recipient SIWE acceptance (2026-10-23)

## Verified evidence — no claim or chain writes

- **User human/browser attestation:** the pinned Recipient's MetaMask SIWE login succeeded on the independent T1-E Claim site, and its private **My Claim** view displayed empty. This is a user-observed acceptance result, not a captured raw signature or an agent-operated wallet.
- **Independent real Supabase read after acceptance:** `mf_t1e_auth.sessions` has **1** session: role **recipient**, `revoked=false`, and not expired at the time of the query. There is **no Issuer session** yet. This query selected only role/expiry/revocation counts, not session or CSRF hashes.
- **Other staging database invariants:** `mf_t1e.recipient_claims = 0`, `mf_t1e.claim_events = 0`, and original `mf_t1c.intents WHERE stage='FUNDED' = 1`, `mf_t1c.wallet_attempts = 2`. Do not repeat the original Fund, create another original voucher, or replay original Mac CP30 PREPARED #3560.
- **Render LaoDao independent service:** `srv-dbdgstivcj2c73fnqcc0` at <https://mealforward-t1e-claim-laodao.onrender.com/>. Last independently checked deployment `dep-dbdif1qvcj2c73fsvc70`, source `39547fb9124c2af0e71fa9091987947a269227ca`, Live. Startup log records `T1E_PRIVATE_SIWE_STAGE_READY` and `CLAIM_SIWE_ONLY`, `databaseConnected:true`, `fundingEnabled:false`, `issuerTransactionEnabled:false`, `merchantSettlementEnabled:false`.
- **Exact deployed source public HTTP and negative tests:** <https://github.com/3956ray/MealForward/actions/runs/39931388058> succeeded on attempt 2. PostgreSQL/Claim isolation, wallet/CSRF and original Unit read-only suites passed at exact deployed source (Actions runs 39931388007, 39931388020, 39931388003).
- **Separate UX safety patch:** Draft PR #39 `codex/mealforward-t1e-siwe-wallet-ux-20261023` @ `5910099782717c4f90c99059bca7175349cc1987` adds explicit user-click wallet re-selection, stale-account rejection, and account-change tests. <https://github.com/3956ray/MealForward/actions/runs/39932898091> passed, including the new browser-VM tests. **NOT deployed** to Render, not merged to source PR #38 or main.

## Strict hold before promoting `CLAIM_CONSENT`

The owner has proved **Recipient** SIWE only. Do not infer that Issuer login, role isolation, cross-user session visibility, or post-restart browser behavior were human-tested. The lone live session is not a pair of role proofs.

1. Owner selects the **original onchain Issuer** account `0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3` on the **same isolated T1-E Claim origin**, explicitly signs only the **SIWE EIP-191** login, and confirms `/v1/t1e/me` shows `role:issuer`.
2. Issuer confirms `/v1/t1e/issuer/readiness` is accessible and that it **cannot** access Recipient-only `/v1/t1e/claim/me` (403). Recipient should be denied Issuer readiness (403), including after switching the connected wallet. Test logout and a fresh new-login session, with browser restart as needed. Never copy cookies/CSRF/signatures.
3. Reconfirm real private T1-E DB contains zero Claims/Claim Events, original one `FUNDED` Intent unchanged, both independent roles least-privileged, and original Monad Unit 0 still Available via read-only RPC.
4. Review PR #39 for UX release; keep both source changes and environment changes in the **T1-E Claim service only**. Run exact deployed-commit safe public HTTP checks again after any deployment, and independently verify live Render stage.
5. Only after completing (1)-(4), separately review changing `T1E_DEPLOYMENT_STAGE` from `CLAIM_SIWE_ONLY` to `CLAIM_CONSENT` and `T1E_CLAIM_WRITES_ENABLED` to `true` on **the isolated Claim service**. `T1E_WALLET_TX_ENABLED=false`, `T1E_SETTLEMENT_ENABLED=false` MUST remain. The first real Claim/Consent remains **offchain**, recipient-only, and original one Unit only.

Do not issue a voucher, broadcast any transaction, claim real-world eligibility, or authorize merchant settlement. The original deployed StoreEscrow still lacks the chain-enforced 180-second settlement cooldown (Issue #17), and offchain Consent is not enforced by the original issue() function.

**No credentials, wallet signatures, cookies, raw session tokens, private keys, or funding transactions are included in this evidence record.**
