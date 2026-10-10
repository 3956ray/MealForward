# CP29-UI03 interactive B2 demo

Date: 2026-10-11 Asia/Shanghai. Developer result: COMPLETE_MOCK_FRONTEND_ONLY, pending independent review and Leader acceptance. This round adds only the independent `b2-demo-harness/` and this guide. The accepted baseline was `f22449746535f07fe0a2c582b8de36604d151f3f`; the final candidate SHA is recorded in Leader's UI03 Developer implementation report.

## Open and manage

Open <http://127.0.0.1:15603/>. The loopback Vite service is running as node PID **83469**, launched by `npm run dev` in persistent terminal session75043. PID83383 from the initial failed detached launch is obsolete; its stale PID file was removed. Confirm the current listener with `lsof -nP -iTCP:15603 -sTCP:LISTEN` before managing it. Keep this preview running for the review. To stop it later, use Ctrl-C in that dedicated terminal; do not stop any old services.

To start again:

```sh
cd /Users/mili/Documents/Developer/mealforward-cp29-business/b2-demo-harness
npm ci
npm run dev
```

The port is strict; an occupied15603 causes an error rather than replacing another service. Vite binds only127.0.0.1, does not read `.env`, and has no proxy. Dependencies, lockfile, TypeScript config and build output belong solely to this harness. Root package/lock and old app/server/contracts were not edited. Existing15287/15429/15430 services were preserved.

## Try the complete flow

1. **Support:** Meals → select Meadow Kitchen and Lunch quantity1 → optional thank-you NFT → Review payment → Connect demo wallet → Approve exact amount → Confirm payment → Check original operation. Only the final result increments supported8→9 and generates the original order. Open My orders to view original progress and optional NFT failure independently.
2. **Claim:** Claim a meal → choose built-in guest-c@mealforward.invalid → Simulate email verification → Claim one Lunch → Check original operation → Open original voucher. Only issue final starts this fictional email's global72h limit. Guest-a/b already have original fixture vouchers; guest-b can recover voucher2.
3. **At the counter:** Show verification code → Copy verification string. It starts with `mealforward:demo:` and lasts at most120 seconds, the serving window or the original voucher life, whichever ends first. Recovering invalidates the old display code without extending the voucher.
4. **Owner:** Store workspace → select Meadow Kitchen demo owner → Confirm demo owner identity → expand Check another demo voucher → paste the copied string → Check demo verification string → Obtain processing right → Check original operation. Checking alone does not consume the voucher. The default original voucher1 is already locked and is distinct from the recipient fixture voucher2.
5. **Handoff and payment:** Confirm handoff & report → Check original operation moves R→H. View settlements → settle the corresponding original item individually → Check original operation moves H→S. The fixture voucher1 report changes R6→3, H6→9, S3 unchanged; settling that new item changes H9→6 and S3→6.
6. **Check:** Public ledger displays all final buckets from the same mock state immediately. My orders and public records do not expose recipient emails or display codes. Records can open and return to the original row.

All wallet, email, owner, fund, approval and NFT actions are simulated. No extension, email delivery, real account, signature or transaction is involved.

## Useful scenarios

Expand Demo controls. Default **Final on original check** first submits as pending; the original check applies final. Keep pending and UNKNOWN preserve the original operation. Set Final on original check later to resolve that same intent. Pre-existing payment reviews also cannot submit around another UNKNOWN payment for the same payer.

Use +121 seconds to expire a displayed code, +2 hours for the Lunch window boundary and +72 hours for voucher/quota expiry. Time is the visible synthetic Asia/Shanghai clock, starting Oct10 at12:08:30; it does not copy host wall-clock time. Refunds apply only to free original payer units; consumption/refund does not restore the lifetime ten-meal-per-store cap.

Menu edits support saved drafts, preview, publish a future price/window/name version and list/unlist. Published changes do not rewrite existing orders, vouchers or unit prices. Store settings support description, a static `.invalid` website example, explicit incident pause and one optional welcome NFT per store. Incident pause and menu unlisting have different effects on old obligations.

Refresh preserves the synthetic original intentions and completed state. Invalid schema, enums, original references, duplicate records or missing original cooldowns block the UI without silently overwriting the saved snapshot. **Reset this demo only** opens an accessible page dialog; Keep demo data/Escape preserve it, and Confirm demo-only reset clears only `mealforward:cp29-ui03:b2:v1`. Old services/storage are untouched.

## Verification and limits

`npm run build` passed (includes typecheck), `npm test` passed31/31, `npm run test:browser` passed16/16 groups including network/console checks. Desktop1440 and phone390 full flows passed; additional320/768/1024/1600 layouts, long content, text enlargement, focus and reduced motion have captured evidence. Images and source/render comparisons are in `b2-demo-harness/evidence/`; details are in its `design-qa.md` and Leader UI03 TESTS report.

Independent WIP findings were reproduced with three failing state regressions before the fix (28 pass /3 fail), then31/31 passed after fixing submission/recovery validation. Browser regressions also verify the blocked second review and corrupted saved-state UI. Test-selector/disclosure-helper mistakes were corrected during the initial suite, separately from product defects.

The earlier native `window.confirm` reset was incompatible with IAB automation and was replaced by the page dialog. An already-open older native confirmation in another IAB tab may still block input until its owner dismisses/closes that old tab; the final dialog is tested in isolated Chromium. Developer did not access that other tab. IAB additionally confirmed explicit simulated connect/approve/payment/original final actions and restored the public screen; the comprehensive isolated browser suite is the main reproducible UI evidence.

Real auth/OTP/wallet/RPC/chain/payment/NFT, server/database, multi-process consistency, thousand-user capacity, real-device zoom and screen readers are **NOT_RUN**. Local storage is for this bounded synthetic demonstration, not a production authority. Developer COMPLETE is not ACCEPTED; no push or public deployment occurred.
