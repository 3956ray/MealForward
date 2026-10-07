# CP24 isolated local E2E

Scope: one fictional partner, restaurant, meal and voucher per new instance. P = 10^15 wei (0.001 **local test coin**). All chain activity is on a new loopback Anvil 31337. No Dynamic, browser wallet, Monad RPC, production key or old `.localbackend` is used. CP22/23 testnet readers and guards are unchanged.

## Run

Use this project's locked dependencies: `npm ci`, Python 3.12 virtual environment with `pip install --require-hashes -r requirements.lock`, and `node_modules/.bin/forge build`. The pinned Foundry native package must be installed for this machine. The integration uses the same project Python environment; it does not add a new Python dependency.

From the CP24 checkout:

```sh
.venv/bin/python scripts/cp24-local.py --directory .localbackend/my-new-cp24
```

Default URL: http://127.0.0.1:15247. API19115, Anvil19145, wallet simulator19146. All bind loopback; an occupied port is an error, never a reason to kill another process. Override the four `--*-port` options together for a separate instance. New mode refuses an existing directory. Data and logs remain private under that directory. Never serve that directory as static content.

Ctrl-C (or TERM to the recorded **supervisor**, not its children) stops new requests, finishes current service/worker work, then saves the native Anvil state. Genesis timestamp is pinned per instance; loading a dump must not introduce a second genesis identity. Anvil writes a separate next snapshot, promoted only on normal stop. On normal stop the launcher records node-launch/DB/anchor/config/chain hashes; failed resume does not overwrite the original saved chain snapshot. Resume:

```sh
.venv/bin/python scripts/cp24-local.py --directory .localbackend/my-new-cp24 --resume
```

Resume reuses saved ports, deployment and operations. Missing/inconsistent stop evidence refuses startup and preserves files. Runtime DB rollback/anchor mismatch rejects business writes; chain conflict halts reconciliation. No automatic reset, unlock, reissue, re-sign or replacement transaction. A hard power loss is not promised lossless. Start a **different new directory** for another round; retain the previous one.

## User steps

1. 支持者 → 审阅本地钱包支持 → explicitly confirm 0.001 local coin plus separate local gas. Wait for local finality.
2. 机构伙伴 → `partner-a` / `local-only-password` → issue the one voucher → generate and privately copy/open the link. First-open prevents rotation; unopened links can explicitly rotate.
3. 领取者 → original link → 查看我的餐券 → 到店生成展示码. No account/wallet. Request a download of its short-lived QR image or use its six digits. The page cannot confirm that the browser saved a file: check the download list. In the Codex in-app browser, if no file is available, bring the complete QR and its white margin into view, save a visible-area screenshot, then choose that image on the owner page. Avoid full-page long screenshots; the image remains subject to the original 120-second expiry.
4. 餐馆老板 → `owner-a` / `local-only-password` → explicitly review/confirm local wallet identity challenge → decode QR image or input six digits → precheck → explicitly acquire processing responsibility. Wait for finalized lock before declaring handoff.
5. Declare handoff → separately confirm the original statement and report → wait until H → review/confirm local settlement. Public ledger ends F=S=P, A=R=H=0.

Role navigation does not log out other roles. Each role's logout only revokes its session; owner logout also revokes the wallet proof. It does not release the business claim. Refresh loses the page's write capability: query the original state, prove identity if needed, explicitly confirm the old terminal has stopped, then take over. Pending/UNKNOWN transactions stay query-only. A note marks a statement for checking; it neither erases it nor authorizes report. Continuing report requires another explicit confirmation.

All identities and wallet accounts are fictional. These dedicated passwords are not production credentials. Loopback is reachable on this computer; a 390px viewport does not prove a physical phone can access it.

## Composition and persistence

`server/local_e2e` composes existing Backend, WorkCore, RedemptionService, OwnerWalletService, Worker and Projector. It does not register the older eight-digit recipient API or testnet endpoints. Shared changes are optional AuthService cookie name/path and Worker/OwnerWalletService receipt-finality sources; all defaults stay unchanged. CP24 uses one conservative finalized watermark per worker pass and makes the worker the only live projector writer. A node advancing after projection waits for the next pass instead of triggering a false missing-event halt.

CP24 credentials and business records use the **same SQLite acceptance transaction** via LocalStore. Invite72h/session8h/display120s. QR is `mealforward:local:v1:` plus an opaque random token; six digits represent the same current display. Only digests are saved. Exchange, rotation, display refresh, logout and lock serialize against each other. The external anchor is written before commit; a crash between them fails closed, rather than silently restoring an older secret or signing permission. The independent anchor covers business/signing/credential records, not merely the deployment name.

Lock revalidates and consumes the display and inserts the existing claim/outbox with terminal binding atomically. Terminal capability is random, hashed server-side, bound to owner session/shop/redemption/version and kept only in page memory. Takeover uses expected-version competition, atomically revokes old capability, records audit, and orders against the final handoff/report/settle acceptance transaction. Work accepted before takeover remains valid. New terminals cannot re-obtain an already consumed signing authorization. Software cannot verify a real device has physically stopped handing out food.

Guess failures: rolling60s owner-session10 / direct-peer-IP30, QR and manual paths shared. No trust in forwarded IP headers. Original intent recovery/details retain authorization checks but bypass guessing limits. Successful checks do not consume the voucher or move money. Finalized report moves R→H; finalized owner settlement H→S; lock/handoff do not move funds.

The independent wallet bridge derives only the public disposable Anvil account1/supporter and account5/owner. Backend has issuer/operator only. A UI confirmation durably consumes the exact ticket, and the bridge persists SIGNING_STARTED **before** signing, then encrypted original raw/hash/nonce before one send attempt. Repeated requests query saved results, never sign again. Crash with a signing marker but missing raw is UNKNOWN. The bridge does not expose arbitrary signing/RPC or user-triggered rebroadcast. Existing worker recovery may replay only its already persisted same raw/hash/nonce. Neither subsystem reconstructs a new transaction to resolve uncertainty.

Local finality comes from the existing projector and Anvil's finalized block, using one slot per epoch in this simulator for short waits. This is not a claim about Monad finality. Wallet review includes an estimated local gas fee; actual receipts remain authoritative and gas is separate from principal.

## API

All paths begin `/api/cp24/`; POST checks exact Origin. Partner/owner auth use separate HttpOnly same-site cookies and X-CSRF-Token. Recipient has its own cookie/CSRF. Owner writes additionally require X-Terminal-Cap after lock.

- public; support/state, support/prepare; wallet/confirm.
- partner/login, session, logout, state, issue, invite.
- recipient/exchange, session, display, logout.
- owner/login, session, logout, state, proof, precheck, lock, takeover, handoff, report, note, settle.

Only fixed local fixture parameters are accepted for support/issue. Per-instance persisted keys recover original operations across windows and refresh. Public responses exclude link secret, display token, recipient reference and private delivery relationship.

## Verification

```sh
.venv/bin/python -m unittest tests.test_cp24_local_e2e -v
.venv/bin/python -m unittest tests.test_auth tests.test_backend_chain_owner tests.test_testnet_voucher tests.test_testnet_issuance tests.test_testnet_issuance_admin -q
npm run test:wallet
npm run build
node_modules/.bin/tsc --noEmit -p local-e2e-harness/tsconfig.json
node_modules/.bin/vite build --config local-e2e-harness/vite.config.ts
```

`tests/test_cp24_local_e2e.py` owns a random-port native Anvil and fresh temp fixture per test. Browser driver `scripts/cp24-browser.mjs` requires a fresh running instance and externally supplied Playwright/Chrome executables via CP24_PLAYWRIGHT_MODULE / CP24_BROWSER_EXECUTABLE (CP24_URL/output optional). It performs all business actions through UI and only reads public API for assertions. QR decoding uses the real generated image and jsQR. Camera denial is exercised with browser permission policy and a BarcodeDetector availability shim if absent; **real camera capture remains NOT_RUN**. No test-only advancement endpoint ships in the application.

Independent fixed-SHA technical review and Leader browser acceptance are subsequent gates. Developer evidence is not ACCEPTED.
