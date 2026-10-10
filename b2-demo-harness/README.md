# MealForward B2 frontend demo

CP29-UI03 independent React/TypeScript/Vite harness. All identities, stores, funds, vouchers and results are synthetic. It does not import the existing business application or connect to auth, email, a wallet, an API, a database or a chain.

Live local preview: <http://127.0.0.1:15603/>. The default route is the public meal list.

Run from this directory:

```sh
npm ci
npm run dev
npm run build
npm test
npm run test:browser
```

`build` includes `tsc --noEmit`. The browser suite uses a fresh headless profile with the installed Google Chrome executable on macOS; it does not access the user's browser profile. Configure the explicit executable in `tests/browser.mjs` if that installation is unavailable. No browser was downloaded by this harness.

The synthetic clock starts at Oct 10, 2026, 12:08:30 Asia/Shanghai and advances while open. Demo controls can advance time or change the next result. The default next result creates a pending operation; **Check original operation** then finalizes it. UNKNOWN never authorizes a new original payment for the same payer.

Only `mealforward:cp29-ui03:b2:v1` is persisted. Incompatible or inconsistent snapshots are blocked without overwriting them. Reset requires the in-page **Confirm demo-only reset** action; cancellation or Escape keeps the original data. The old services and their storage are unrelated.

See [demo guide](../docs/CP29-UI03-DEMO.md), [asset provenance](ASSETS.md), [design comparison](design-qa.md) and [browser evidence](evidence/browser-results.json). Real auth/wallet/email/chain/NFT and capacity validation are NOT_RUN. Developer completion remains subject to independent review and Leader acceptance.
