# MealForward CP31 — Human-first flows (implementation, 2026-10-14)

## Purpose

Preserve the Sites visual identity and existing CP30 business/security protocols while reducing user-facing confirmations. The browser should explain **meal, quantity, amount, next action, result**, not force users to learn the internal `review / intent / approval / observer / journal` stages.

**Branch:** `codex/mealforward-simple-flows-v1` (forked from independent frontend `codex/mealforward-sites-integration` at `bb367028`). This branch is *not* the `main` repository's historical React simulator. The backend is on a different Git history; do not merge the two branch histories directly.

## Implemented in CP31 frontend

### Support → Review → Pay

- Support selection presents quantity and estimated amount.
- The server returns an authoritative review. It is displayed in a single price breakdown: meal name, **unit price**, quantity and **total**.
- One primary **Confirm & pay** action creates the original support intent and, if server-prepared, starts the wallet transaction sequence.
- Under ERC-20 USDC, `approve` is **not** a payment. The system may require two distinct wallet prompts: allowance approval **then** fund. `fund` is attempted only when the backend indicates the original approval is confirmed and fund is allowed. An uncertain send does not permit another send.
- The checkout polls original backend status for a bounded interval while the dialog is active; it can fall back to an explicit **Continue payment** action if preparation/finality takes longer. It never silently replays an unknown wallet attempt.
- The success state is based only on `FINAL_SUCCEEDED`, not the wallet returning a transaction hash. Where an original, validated transaction hash is available, a testnet Monadscan link is shown.
- Original operations, raw ID/hash, per-transaction recovery and debugging remain under a collapsed `<details>` panel, not removed.

### Claim → My Meals

- One primary **Claim this meal** action does claim review, creates the original issue intent, then checks its status, without a separate visible Review/Confirm pair.
- It does **not** mint a voucher locally and never reports claim success until original `FINAL_SUCCEEDED` plus the verified voucher object.
- The pending claim's **wallet-scoped reviewId and intentId only** are retained in sessionStorage. No QR code, voucher credential, wallet signature, cookie, JWT, or private secret is stored there by this feature.
- On re-entering a claim in the same browser session, the system recovers the original intent before allowing a new claim. For an uncertain confirmation with only a review ID, the UI can explicitly resume *that same original review*; it does not mint a replacement claim.
- **My Meals** shows vouchers as meal tickets first and keeps technical references in collapsed details. QR codes appear only after a separate **Show QRcode** action for an eligible, verified voucher, with the existing max 120-second display window.

### My Contributions

- Orders display meal name, quantity (if provided by the backend), formatted amount and a human-readable payment status first.
- Links to recover the **original** contribution remain available. If a validated original fund hash exists, the user can open the transaction in Monadscan.
- Raw IDs / exact status / hashes are preserved in collapsed technical details. The page does not invent recipient identities or claim to know real-world meal delivery.

### Design constraints

The established Sites visual language remains: warm off-white `--paper`, forest `--green`, warm `--orange`, meal photos and a restrained meal-ticket motif. New CSS uses only existing color tokens, native controls and responsive card layout; mobile buttons meet touch-target guidance.

## Verification done

- 130 inherited frontend tests still pass, plus **8 new CP31 tests** for combined checkout, exact original wallet sequencing, uncertain-send no-duplicate, simplified order card, one-tap claim, pending recovery and voucher success criteria.
- Test command from the frontend branch root:

```sh
node --test live-publish.test.mjs live-api.test.mjs live-support.test.mjs live-claim.test.mjs live-redemption.test.mjs live-settlement.test.mjs onboarding.test.mjs onboarding-wallet.test.mjs support-ui.test.mjs claim-ui.test.mjs verification-ui.test.mjs settlement-ui.test.mjs meal-publish-ui.test.mjs
```

**Result:** 138/138 PASS (Node 22.16.0, isolated adapter/handler tests). No real wallets were signed, no production database was touched, and these tests are **not** evidence of a successful new on-chain E2E run.

## Critical follow-up (not completed in this branch)

1. **Backend authorization / repeatability:** existing real CP30 runtime had session-bound pending intents that could become orphaned after re-login. Backend must support securely recovering an immutable original intent by the *same authenticated wallet principal*, while maintaining role, ownership and credential-epoch safeguards. Do not trade away isolation just to reduce login prompts.
2. **Issuer reliability:** fix slow per-RPC Python process spawning, bounded worker queues, and pre-signing expiry retirement; avoid an endless `UNKNOWN` caused by queuing past a short operation window. Never re-broadcast an original transaction because a request timed out.
3. **SQL source of truth:** migrate the 2026-10-14 live-only DB hotfixes into reviewed migration sources and integration tests executed with the actual non-privileged DB roles. Re-pin signed/configured material through the approved procedure, not by blindly modifying the original runtime state.
4. **Cloud backend:** Vercel is suited for this static frontend, but it has **no live `/v1/*` backend** here. Strict same-origin wallet/session/CSP require a reviewed API gateway or same-origin routing plan to a separate Python + PostgreSQL service. Do not expose the local socket/keys through Vercel or public GitHub.
5. **Real E2E:** record owner/recipient/supporter wallet identity checks, approve + fund finality, claim issue, private QR lock/report and owner settle on Monad testnet, including refresh, wallet switch, lost response and quote/QR expiry cases.
6. **UX browser audit:** run desktop/mobile browser checks with a trusted backend test environment; this branch's HTML/Node tests do not establish deployed browser compatibility or wallet pop-up behavior.
7. **Login return:** after login, restore the user's selected meal and intended action without automatically sending a transaction; this is not implemented in CP31's first slice.

## Release gates

- **Safe to review/test locally:** yes, with deterministic adapters.
- **Safe to use as a static Vercel preview:** yes, if clearly labeled not fully connected and not used for real funds.
- **Safe to switch public production URL:** **not yet**; requires same-origin `/v1`, private server config and end-to-end acceptance.
- **Safe to deploy a fresh production database:** **not yet**; source migrations don't reproduce all runtime SQL hotfixes.

## Owner-facing acceptance criteria

- A supporter only sees three high-level actions: **Support → Review amount → Pay**. A wallet may display two transaction confirmations; approval is not described as payment.
- After a confirmed payment, **My Contributions** shows a real original order, the actual amount and transaction link when present. An `UNKNOWN` result never becomes success or sends a replacement.
- A recipient clicks **Claim this meal** once. If issue remains pending, **My Meals** or same-wallet recovery shows that original claim. A voucher is displayed only after finalized issue + exact voucher verification.
- The owner can still manage drafts, publish/list, verify a private code, explicitly confirm physical handover and settle after the separate 180-second platform wait; no CP30 contract semantics are changed here.
## CP31 follow-up: direct MetaMask login (2026-10-14)

**User experience:** clicking **Sign in with MetaMask** (including the header and wallet-sensitive support/claim entry points) immediately invokes MetaMask's native `eth_requestAccounts` flow. The website does **not** display a custom Choose Account, Connect Another Account or Continue-with-selected-account screen. MetaMask may still show its own permission and login-signature prompts; those wallet confirmations cannot be suppressed safely.

**Integration:** `dist/live-api.mjs` resolves MetaMask from a multi-provider `window.ethereum.providers` environment, rejects other providers and uses the first account returned by `eth_requestAccounts`. It checks the active wallet and Monad Testnet chain 10143, validates the original server challenge, obtains the user's explicit login signature, and verifies that the server session matches that same account. Requests start from the user's click with no awaited network preflight before the wallet permission popup. A disconnected or rejected wallet is **never** silently substituted with an old cached account.

**Privacy and recovery:** login or wallet switching clears all existing private frontend state before authentication; account/chain changes invalidate pending requests. Concurrent clicks cannot create multiple wallet prompts. Any signed-but-invalid final session is revoked through the original backend logout path. No private key, signature, login token, or QR secret is persisted by this change. All original Intent and transaction recovery rules remain unchanged. Switching to another account is done inside MetaMask, then by signing in again; the website never chooses a different account for the user.

**Verification:** Node offline integration suites returned **142/142 PASS** after the change (previous CP31 baseline: 138/138). The direct login, native rejection, selected account, wrong chain, account-change race, server mismatch, multi-provider selection, double click, and stale-UI safeguards have explicit regression coverage. This does **not** claim live MetaMask browser/real backend acceptance or production deployment. A browser + native MetaMask smoke test on the genuine CP30 HTTPS runtime is still necessary before release.
