# CP25: repeatable local rehearsals

From this checkout, after the locked CP24 dependencies and contract build described in
[CP24-CONTRACT](CP24-CONTRACT.md) are installed, run:

```sh
.venv/bin/python scripts/cp24-local.py --new
```

The host must provide `lsof` (macOS system tool; install the operating-system package on Linux if absent). The launcher fails closed without it. Before any setup or resume RPC, the kernel LISTEN socket must belong to this exact live Anvil child PID on its assigned loopback port; chainId alone is not ownership evidence. The check is repeated immediately before setup and before READY.

Each command starts one foreground rehearsal with a unique private directory under
`.localbackend/rehearsal-*` and four automatically selected loopback ports. Keep that
terminal running and open the printed **URL**. `READY` is printed only after its UI
proxy reaches the matching instance. Each round has its own Anvil 31337 chain, database,
anchor and synthetic wallets. Repeated addresses across independent chains are normal.
Nothing scans, resets, stops or copies an older round.

Stop with Ctrl-C in that terminal. Wait for **Normal stop saved**, then run the exact
absolute **Resume** command printed by the launcher. It uses the original directory,
ports and saved evidence. The printed `kill -TERM` alternative is for the currently
running supervisor only: check `runtime.json` and the process identity before using a
PID from an old terminal transcript. Never kill a child to save a snapshot. A failed
or inconsistent stop is quarantined; preserve the files. A new independent round does
not resolve an UNKNOWN operation in the original round.

Existing explicit `--directory NEW_PATH` and port options remain available. Existing
folders are never overwritten. `--resume` requires `--directory ORIGINAL_PATH` and
uses saved ports, without overrides. `--new` cannot be combined with those options.
Ports are reserved until the associated service starts. Another process may still
win the final bind race: startup fails and retains the new directory; it never kills
or takes over the other process. Do not reuse the failed directory as a fresh round.
Normal stopped rounds retain their URL; resume that round to query it again. There
is no history web service or automatic cleanup.

## One minute flow

All accounts, amounts and food declarations are fictional; no real wallet or Monad.

1. 支持者: **审阅本地钱包支持** → **确认本次本地钱包操作**, then wait for confirmation.
2. 机构伙伴: `partner-a` / `local-only-password` → **发行本轮唯一餐券** →
   **生成私密领取链接** → **打开领取页**.
3. 领取者: **查看我的餐券** → **我已到店，生成展示码**. No account or wallet.
4. 餐馆老板: `owner-a` / `local-only-password` → **审阅本地钱包身份挑战** →
   confirm → enter six digits or **选择二维码图片** → **预检餐券** →
   **确认有餐，申请唯一处理权**.
5. After lock confirmation: **我已交餐，记录声明** → check the original declaration →
   **确认原声明并提交申报** → after H is confirmed, **审阅本地钱包结算** → confirm.
6. 公开餐账: F=S=0.001; A=R=H=0. Keep that round for inspection; use `--new` for another.

QR download is a request, not proof of a saved file. In the Codex in-app browser,
check the download list; if unavailable, place the whole QR and white margin on screen,
save a visible-area screenshot and upload it on the owner page. Avoid long full-page
screenshots. Images still expire after 120 seconds and refreshing invalidates old ones.
Six digits use the same server checks. Real camera and physical-phone access are not
verified; loopback URLs are for this computer. Refreshing the owner page loses write
capability: explicitly take over the original operation, never create a duplicate.

## Verification

```sh
.venv/bin/python -m unittest tests.test_cp25_launcher tests.test_cp24_local_e2e -v
node_modules/.bin/tsc --noEmit -p local-e2e-harness/tsconfig.json
node_modules/.bin/vite build --config local-e2e-harness/vite.config.ts
git diff --check
```

Release evidence must include two independent new rounds, one full browser settlement,
querying the first round after starting the second, normal stop/resume with unchanged
identity and accounting, and a fresh unfunded user round. Independent fixed-SHA review,
PM recheck and Leader browser acceptance remain separate gates.

## Next Monad checklist (planning only)

Real supporter/owner wallet and trusted identity bindings; separate 10143 adapter and
finality/event verification; fresh deployment and roles; frozen per-transaction and
aggregate principal/gas budget; UNKNOWN reconciliation with original hash/nonce;
one coherent issue/recipient/redemption/settlement flow. This stage adds no broadcast
runner, never reads production keys and never uses public Anvil keys on a public chain.
