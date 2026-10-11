# MealForward · Three Stores

CP29-UI05 candidate for the selected Three Stores Site. Static HTML, CSS and JavaScript modules; no installation or build step. Public pages retain the paper background, forest green, meal photography and three kitchen cards. The invited merchant workspace has Overview, Meals, Verify & hand over, and Payouts.

Run locally: `python3 -m http.server 4173 --bind 127.0.0.1 --directory dist`.

Verify: `node verify.mjs`. Syntax checks: `node --check dist/app.js`, `node --check dist/model.mjs`, `node --check browser-verify.mjs`.

`browser-verify.mjs` is the explicitly authorized isolated QA harness for this workstation. It uses installed Chrome and bundled Playwright, requires the owned loopback server on port 15615, and writes evidence to the UI05 Developer report directory. Fresh temporary contexts permit only loopback/data requests; no existing browser profile is used. Harness runtime and evidence paths are workstation-specific; the Site runtime has no such dependency.

Public routes: `#home`, `#stores`, `#how`, `#store/qinghe`, `#store/shiguang`, `#store/nuanxiang`, `#ledger`, `#nft`, `#about`. Private routes: `#mine/coupons`, `#mine/orders`, `#coupon/<local-id>`, `#merchant/{overview,meals,verify,payouts}`. Original `#merchant` and `#mine` entries remain usable.

All operations are browser-local simulations. No real wallet, chain, email, authentication backend, NFT minting, camera or server database is connected. Sign in selects fixed synthetic `.invalid` accounts. Visitor and neighbor accounts can support and receive; each owner account has a fixed invitation to its own kitchen. Sign-in or wallet connection does not grant another kitchen's authority. These checks illustrate application behavior; they are not production security against local storage manipulation.

Initial illustrative support is 6, 4 and 3 meals, with one settled and one reported meal per kitchen. One model drives original-price accounting, the lifetime cap of ten per kitchen, global 72-hour recipient cooldown, original voucher expiry, service-window-bound codes of at most 120 seconds, non-consuming checks, unique locks, explicit handover reports, individual owner payouts and safe original-payer refunds. Operations start pending and become final only through an explicit original-operation check. UNKNOWN retains the original operation and reservations; timers do not settle funds or release locks. NFT failure is independent of payment.

Meals support drafts, confirmed publishing of future terms, and confirmed listing changes. Safety pause is separate. Existing orders/vouchers keep original terms. Sign-out and restoration clear active identity, wallet and display tokens while preserving history, locks and the 72-hour gate. Schema-1 migration preserves raw legacy terms and history but grants no unproven ownership. Bad/incompatible snapshots are blocked and preserved until explicit reset.

Browser checks cover desktop/mobile complete flows, invitation denial, sign-out/restoration, drafts/publishing/unlisting, recovery/expiry, UNKNOWN, malformed snapshots, four merchant views, keyboard/dialog behavior, local images, English and overflow. Real email/OTP, wallet/chain/Gas, contracts, production security and multi-client concurrency are not verified. Leader owns fixed-source review, packaging and Site publication.

Fonts are system sans-serif and Georgia. QRCode.js 1.0.0 is bundled locally under MIT; no CDN is called at runtime. Approved illustrative assets are retained:

- `dist/assets/hero-meal.jpg`: generated meal photograph; prompt in `ASSET-PROMPT.md`.
- `dist/assets/vegetables.jpg`: original Unsplash source https://images.unsplash.com/photo-1512621776951-a57141f2eefd
- `dist/assets/bowl.jpg`: original Unsplash source https://images.unsplash.com/photo-1547592180-85f173990554

Photographs are illustrative and do not prove real restaurant offerings.
