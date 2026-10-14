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
## CP31 history: original direct-MetaMask implementation (superseded)

The first attempt removed MealForward's own account selector but incorrectly called `eth_requestAccounts` on every sign-in. This could still show MetaMask's native account picker and did not meet the desired one-signature experience for connected wallets. The **current** implementation is the active-account-first login below; keep this history only as a regression warning.

## CP31 login correction: sign with MetaMask's active account (2026-10-14)

**Actual UX:** On **Sign in**, first call non-prompting `eth_accounts`. When MetaMask has already authorized this site, use `accounts[0]` (its exposed active account), validate Monad Testnet chain 10143, fetch the server-owned login challenge, then call `personal_sign` with that same address. Do **not** call `eth_requestAccounts` on every sign-in: it may show MetaMask's native account chooser even when the user already connected. No website address selection step or permission re-request.

**First visit:** If and only if `eth_accounts` returns `[]`, perform the required `eth_requestAccounts` permission request once and then sign. Wallets do not expose an unauthorized active address to a website, so a genuine first connection cannot securely skip native permission. Do not use `selectedAddress`, saved address, localStorage, prior server cookie, or an arbitrary second account to bypass it.

**Security:** Keep all existing nonce/domain/origin/chain/signature checks, post-sign address and provider verification, account-change invalidation, same-wallet session validation, idempotency/recovery and logout behavior. No on-chain transaction is sent for login.

**Testing:** Node tests explicitly cover already-authorized one-signature login with zero `eth_requestAccounts`, first-time connection permission then signature, rejection without fallback, multi-authorized account selection from the current provider, incorrect-chain rejection and post-commit session mismatch. Native popup UI needs human testing in a real browser with the actual connected backend.

## CP31 follow-up: unavailable cloud backend must stop before MetaMask (2026-10-14)

The Vercel preview serves the static frontend only. It does not include the CP30 Python/PG runtime or same-origin `/v1/connection`, `/v1/identity/setup`, pre-session, challenge and login endpoints. A wallet prompt cannot create a verified server session here. The adapter now probes the login backend **before any MetaMask account request or signature**; a missing/HTML API response fails closed. The UI disables sign-in after detecting missing backend during startup and provides an explicit recovery action. No fake success, synthetic paid orders, or private credentials are introduced.

Cloud mode is a separate architectural task: CP30 `full_configuration.validate_origin` pins literal localhost TLS with matching port, `http.py` binds 127.0.0.1 and rejects forwarded headers. The owned Unix-socket PostgreSQL, six workers/services, signer journals, and per-origin wallet challenge/CSRF/cookies need a reviewed migration plan and persistent cloud service. Merely adding Vercel rewrites to localhost is neither feasible nor authorized. Keep the original live testnet run and production domain untouched until the cloud API passes security and E2E gates.
