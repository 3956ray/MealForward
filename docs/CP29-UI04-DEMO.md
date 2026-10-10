# CP29-UI04 kitchen-first demo

Local preview: http://127.0.0.1:15603/#/meals. This is an isolated frontend with simulated kitchens, identities, payments and vouchers. No real wallet, email, camera, backend or chain is connected. Test assets have no real dollar value. UI04 developer delivery is not independent review or Leader acceptance.

## One-minute walkthrough

1. Choose **Meadow Kitchen → View kitchen**. Lunch and Dinner show their content, original price and service hours. Choose quantities and **Review support**; another kitchen requires **Keep current cart / Replace cart**. Claiming is a separate action.
2. **Connect demo wallet → Approve exact amount · Demo → Confirm payment · Demo → Check original operation**. Only final support adds meals. **View my orders** opens the original payer's support orders; the optional thank-you NFT has independent simulated progress.
3. **My meals → My vouchers** shows vouchers only after verifying a built-in `.invalid` email. Or choose **Claim a meal**, verify a demo identity and claim one Lunch. Check the original issuance, then open the voucher and **Show verification code**. Codes last at most two minutes, bounded by original expiry and service hours. Recovery keeps the original expiry.
4. **Kitchen workspace** requires explicit demo owner selection. The built-in Meadow example is already locked: confirm handoff and report only after the simulated handoff, then check the original report. New vouchers must first pass verification and acquire their unique processing right. **View settlements** opens separately confirmed individual owner payments; final report alone is not received money.
5. **Meal ledger** separates lifetime supported meals, available meals, currently claimed meals and final demo reported handoffs from awaiting/received/refunded test USDC. **Accounting details** retains the full F=A+R+H+S+X amounts and bucket counts. Every view uses the same model.

## Routes and saved data

Catalog `#/meals`; kitchen details `#/kitchen/meadow`, `#/kitchen/river`, `#/kitchen/lantern`; My vouchers `#/my/vouchers`; Support orders `#/my/orders` (legacy `#/orders`); claim, recovery, voucher, owner, menu, settings, settlements, records and ledger keep their existing hashes.

The initial cart is empty, so the first choice of any kitchen needs no replacement confirmation. Direct kitchen URLs select that kitchen after refresh. In-session cross-kitchen navigation asks before replacing a nonempty cart; catalog, public ledger and claim store selection do not change its kitchen or quantities. The cart is temporary UI state; a browser reload starts a fresh empty cart and does not replace paid orders or original operations.

Persistent business data keeps schema1 and the existing key `mealforward:cp29-ui03:b2:v1`. UI04 makes no migration or reset. Incompatible snapshots remain blocked without overwriting their bytes. Reset uses a labeled in-page dialog and explicit **Confirm demo-only reset**. Do not reset saved user state for screenshots.

## Pending and UNKNOWN

Use **Check original operation** for the existing intent. Never create a replacement payment, lock or voucher to resolve UNKNOWN. Original resources, original price/version, payer and owner responsibilities remain held across refresh. Source warnings remain visible; new business actions stay blocked when the source is uncertain. Demo controls choose the next synthetic result; there is no automatic successful transaction timer.

## Validation and limits

From `b2-demo-harness/`: `npm test`, `npm run typecheck`, `npm run build`; authorized isolated browser checks: `npm run test:browser` and `npm run test:ui04`. New evidence goes to `evidence/ui04/`; UI03 evidence is historical and is never presented as UI04 validation. Exact current run results are recorded in the separate UI04 developer TESTS report and JSON evidence.

All photos are the existing locally generated illustrative assets documented in `ASSETS.md`; typography is local system fonts. No reference source/model, external font or public Sites configuration is imported. Real authentication, OTP, wallet ownership, gas, chain transactions, NFTs, physical delivery, concurrent production capacity, real-device/screen-reader validation and public Sites deployment are NOT_RUN.
