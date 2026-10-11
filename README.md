# MealForward · Three Stores

CP29-UI05 multi-meal merchant amendment for the selected English Three Stores Site. Static HTML, CSS and JavaScript modules; no installation or build. Public hero, three kitchen cards, bowl mark and approved local photographs remain. Merchant headings use system sans-serif, light meal rows and one prominent verification tool.

Run locally: `python3 -m http.server 4173 --bind 127.0.0.1 --directory dist`.

Verify: `node verify.mjs`; syntax: `node --check dist/app.js`, `node --check dist/model.mjs`, `node --check browser-verify.mjs`. The isolated workstation browser harness requires installed Chrome, bundled Playwright and an owned loopback server on 15615. It creates fresh temporary contexts, allows only loopback/data requests, and writes current evidence to the UI05 Developer `evidence-action-revision-1` directory. Its absolute runtime/evidence paths are QA-only, not Site dependencies.

Routes: `#home`, `#stores`, `#how`, `#store/{qinghe,shiguang,nuanxiang}`, `#ledger`, `#nft`, `#about`; private `#mine/coupons`, `#mine/orders`, `#coupon/<id>`, `#merchant/{overview,meals,verify,payouts}`. Original `#merchant` and `#mine` shortcuts still work.

Sign in selects fixed synthetic `.invalid` accounts. Visitor/neighbor can support and receive; each owner has a fixed invitation to only its kitchen. All operations are local simulations: no real email/OTP, wallet extension/provider, chain, NFT minting, camera, API or database. LocalStorage is user-editable; this demonstrates application consistency, not production authentication or financial security.

Overview and Verify share the same check/lock/report component and handlers. Checking is non-consuming. Unique lock, explicit handover/report and individual owner payout remain separate. Navigation retains original cases and unresolved operations. Sign-out/direct Sign in/restoration revoke current authority, wallet, displayed codes and transient approval without deleting history, locks, pending operations or cooldowns.

Meals has an independent `+ Add meal` blank form. Valid save creates a stable store-bound meal ID and draft; it creates no stock and is not publicly supportable/claimable. Confirmed first publication lists the meal. Editing/publishing later changes only that meal's future version and preserves its listing. Service windows are one or two ordered non-overlapping HH:MM ranges in Asia/Shanghai. Existing orders/vouchers retain original terms. Unlisting preserves the object and all obligations; store safety pause is separate. There is no manual inventory input or destructive meal deletion.

Each order contains one kitchen/meal and multiple portions of that same meal. Changing selection requires Keep current selection / Replace selection. Approval binds email, payer, store, meal ID, quantity, price, version and NFT choice, and is checked again at payment. A queued payment consumes transient approval. Direct account changes preserve cart intent but require a new connection/approval/confirmation.

Schema 3 separates store safety settings, independent meals/version history and original record associations. Support intents freeze original terms. Claims select only free/unreserved units of the chosen meal in original sequence and show those actual original version/price/windows before confirmation. The store lifetime cap of ten includes all meals, versions and open support reservations. Original-unit prices drive all counts/money; refunds/consumption never reopen the cap. Global email cooldown and original voucher expiry remain 72 hours; display code is at most 120 seconds and ends no later than the original expiry/service-window end. UNKNOWN retains the original operation/resources and never auto-resolves.

Schema-1 migration accepts the actual baseline field structure. Schema-2 migration accepts the known single-menu shape and preserves all original operations/resources, including UNKNOWN. Both map each store's original single menu and all its historical versions to `legacy-<store>`, without changing original IDs, prices, raw content, status, expiry or payer. Schema 1 lacks captured content/image/windows: only its actual baseline fixed store definitions supply those missing fields. Unknown/mixed schemas, conflicting original versions or unresolved references block and preserve original bytes; no silent reset or restored login. Legacy ownership that cannot be proved remains unassigned.

Model/static tests cover original safety and P1/P2 regressions plus independent drafts, A/B inventory, shared cap, original versions, unlisting, explicit schema migrations and same-price meal approval binding. Browser tests cover complete original/multi-meal flows, desktop/tablet/mobile first screens, forms/keyboard/focus/errors, legacy/mixed data, images/English/overflow and observed requests. Native publication, production auth/security, real wallet/chain/Gas/NFT and multi-client concurrency are not verified. Leader owns fixed-source review, official packaging and publication; old saved v2 remains blocked.

Meal names and content, including HTML-like characters, are displayed as literal text in menus, reviews, vouchers and activity. A demo-only reset requires the currently open reset dialog's original confirmation button; arbitrary, stale or wrong-dialog actions preserve saved records and UNKNOWN responsibilities. Window errors remain next to the field, with a separate form summary; use an English comma between two HH:MM-HH:MM windows.

Fonts are local system sans-serif and Georgia. QRCode.js 1.0.0 is bundled locally under MIT; no runtime CDN. Approved illustrative assets remain:

- `dist/assets/hero-meal.jpg`: generated meal photograph; prompt in `ASSET-PROMPT.md`.
- `dist/assets/vegetables.jpg`: original Unsplash source https://images.unsplash.com/photo-1512621776951-a57141f2eefd
- `dist/assets/bowl.jpg`: original Unsplash source https://images.unsplash.com/photo-1547592180-85f173990554

Photographs are illustrative and do not prove real restaurant offerings.
