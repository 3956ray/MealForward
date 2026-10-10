# 留膳 MealForward

Buildless responsive website based on the user's three-store MVP brief. Uses static HTML, CSS and JavaScript ES modules; no installation or build required.

Run locally: `python3 -m http.server 4173 --directory dist`

Verify: `node verify.mjs` and `node --check dist/app.js`.

Routes: `#home`, `#stores`, `#store/qinghe`, `#store/shiguang`, `#store/nuanxiang`, `#mine/coupons`, `#mine/orders`, `#coupon/<local-id>`, `#merchant`, `#ledger`, `#nft`, `#about`.

All business operations are browser-local demonstrations. No real wallet, chain, mail service, authentication backend, NFT minting, or server database is connected. Local state is isolated per browser and resettable. No real emails are transmitted. Email digests and verification secrets in localStorage are demonstration data, not production security. Merchant permissions in frontend state demonstrate the flow, not enforce a security boundary.

Initial illustrative sales are 6, 4, 3 portions; each store has one settled and one reported portion. The remaining portions are free. The same local model drives support, ownership, old menu versions, global 72-hour cooldown, coupon expiry, 120-second credentials, lock, report, settlement and refund. Maximum per-store lifetime count is ten and refunds do not reopen capacity. Locked responsibility is retained after expiry. The UI has an explicit optional demo clock for trying lunch-window verification outside actual hours.

QA: Node assertions cover cap, attribution, immutable old prices, cross-store cooldown, safe refunds, short credentials, owner role, single lock, report/settle, expiry and ledger conservation. In-app browser verifies support, claim, QR, check, lock, report, settle and ledger. Desktop and 390px mobile views reviewed. Real network/contract/Gas/OTP/NFT/security/concurrency checks are not run.

Third-party dependency: QRCode.js 1.0.0, bundled from npm via jsDelivr; MIT license. Noto Sans/Serif SC are loaded from Google Fonts with system fallbacks.

Assets:
- `dist/assets/hero-meal.jpg`: generated with the built-in Imagegen tool, compressed to JPEG for this project.
- `dist/assets/vegetables.jpg`: Unsplash source https://images.unsplash.com/photo-1512621776951-a57141f2eefd
- `dist/assets/bowl.jpg`: Unsplash source https://images.unsplash.com/photo-1547592180-85f173990554

All imagery is marked illustrative; it is not evidence of real restaurant meals. Final generated asset path: `/Users/mili/Documents/Monad/sites/mealforward/dist/assets/hero-meal.jpg`. Full generation prompt is in `ASSET-PROMPT.md`.
