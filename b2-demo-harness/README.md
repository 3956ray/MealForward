# MealForward B2 frontend demo

CP29-UI04 kitchen-first React/TypeScript/Vite harness, retaining the accepted UI03 model and saved-state namespace. All identities, stores, funds, vouchers and results are synthetic. It does not import the existing business application or connect to auth, email, a wallet, an API, a database or a chain.

Live local preview: <http://127.0.0.1:15603/>. The default route is the three-kitchen catalog. Store details support `#/kitchen/meadow`, `#/kitchen/river` and `#/kitchen/lantern`; My meals separates `#/my/vouchers` and `#/my/orders`. Existing routes remain usable.

Run from this directory:

```sh
npm ci
npm run dev
npm run build
npm test
npm run test:browser
npm run test:ui04
```

`build` includes `tsc --noEmit`. The browser suite uses a fresh headless profile with the installed Google Chrome executable on macOS; it does not access the user's browser profile. Configure the explicit executable in `tests/browser.mjs` if that installation is unavailable. No browser was downloaded by this harness.

The synthetic clock starts at Oct 10, 2026, 12:08:30 Asia/Shanghai and advances while open. Demo controls can advance time or change the next result. The default next result creates a pending operation; **Check original operation** then finalizes it. UNKNOWN never authorizes a new original payment for the same payer. Browser runs use only independent synthetic profiles and write `evidence/ui04/` (the regression suite also accepts `UI04_EVIDENCE_DIR`); UI03 historical evidence remains untouched. Run new browser sessions only under the current browser authorization.

Only `mealforward:cp29-ui03:b2:v1` is persisted. Incompatible or inconsistent snapshots are blocked without overwriting them. Reset requires the in-page **Confirm demo-only reset** action; cancellation or Escape keeps the original data. The old services and their storage are unrelated.

See [UI04 demo guide](../docs/CP29-UI04-DEMO.md), [asset provenance](ASSETS.md), [UI03 historical design comparison](design-qa.md) and [UI04 regression evidence](evidence/ui04/browser-results.json). Real auth/wallet/email/chain/NFT and capacity validation are NOT_RUN. Developer completion remains subject to independent review and Leader acceptance.
