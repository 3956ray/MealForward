# Wallet V2 verification and human handoff

Source accepted: `75cdd9ce913b442a67a4674fc5e109d504c08d28`. Independent task reviews and final scoped review accepted all fixes. Local evidence: 59 client tests, 184 non-PG tests, typecheck and deterministic six-asset rebuild passed. Actual shipped bootstrap with a synthetic provider and the real HTTP handler passed Owner/Donor, wrong network/account, unauthorized, pending API independence and 390px checks; observation time invalidates on account change, no horizontal overflow or browser console errors. These are synthetic checks, not real extension acceptance. Exact CI [40336371458](https://github.com/3956ray/MealForward/actions/runs/40336371458) passed all four jobs (272 tests plus15 disposable PG groups). Render deploy `dep-dbflt5gu01pc73bodam0` is live at that same commit;33 public HTTPS checks passed and all six assets matched. Post-deploy original-record fingerprint stayed `01556b358764d9c262f96c90f75cafcc`, successor counts0/0/0. Public IAB navigation timed out, so public browser acceptance and real MetaMask acceptance remain NOT_RUN. See `HANDOFF.md` for current state.

Build identity: `wallet-v2-d1beddb91a74549b3cb3a2ce2e31c34a7c6c8d506be970c5d463da7fb0acbd98`. It hashes client source, templates, build/config and package lock, excluding Git HEAD, docs, tests and runtime data.

Implementation decision: API read/submit accept an optional caller AbortSignal, preserving prior no-option calls, to fulfill the approved cancellable-request requirement. The plan omitted this optional control; the cost of reversing the choice would be downstream interface and test rework, with no backend change.

## Engineering acceptance

1. Complete each implementation task and its independent spec/quality review, then the whole-change review. Record unresolved findings explicitly.
2. Verify the isolated client tests, typecheck and deterministic six-asset build. Exercise the actual HTML/bootstrap with delayed or failed dependencies and backend requests, not only controller methods.
3. Run the real HTTP handler with a loopback synthetic service and provider. Check desktop and 390px behavior: immediate button feedback, authorized Owner/Donor inspection, wrong account/chain, backend failure, no-round signing block, and no horizontal overflow. This is synthetic browser evidence, not real extension evidence.
4. Push the reviewed candidate and check its exact CI run, including the existing disposable PostgreSQL checks. Keep the Render runtime build and environment unchanged.
5. Deploy only the existing Phase6 collector after those checks. Verify the actual live commit, public asset identity, health/session/state and negative routes. Do not create a formal round.
6. Read the original-record fingerprint and successor counts after deployment. Compare against the baseline in HANDOFF; do not repair differences by modifying records.

## 真人只读验收（部署确认后才开始）

使用 HANDOFF 中已核验的同一公开地址。先确认页面有四个独立区域，诊断含 `build=wallet-v2`；若仍是旧页面，不把它当作新版验收。

1. 在页面“钱包提供方”中明确选择 MetaMask。在 MetaMask 中选中已授权的 Owner 账户与 Monad Testnet，然后点击“检查当前 MetaMask”。这一步只读取现有授权，不应出现签名或交易请求。
2. 核对页面显示的实际地址、角色和网络。正确 Owner 地址为 `0xc4f8a468f10d5f98dcff3282516125e97f26433b`，网络应为 `10143`。点击后应立即显示检查进度，最终显示结果或明确的等待/错误状态。
3. 点击后台状态刷新，确认钱包检查仍可用。当前没有正式轮次时，应显示没有正式轮次并禁用正式签名；钱包连接成功不等于批准已记录。
4. 在 MetaMask 中切换到已授权的 Donor，再点击检查。正确 Donor 地址为 `0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952`。页面应更新实际角色，不能继续沿用 Owner 确认。
5. 回报 Owner、Donor 的结果，以及出现问题时按钮旁的完整提示。可提供页面生成的安全诊断摘要；不要复制签名、Cookie 或会话数据。

若没有现有授权，页面应明确显示未授权并提供独立连接操作。这不构成要求用户忽略钱包风险警告。域名风险复核仍未完成，用户选择暂不提交官方复核；正式签名及轮次创建继续暂停。完成以上检查只代表钱包读取验收，不代表正式双签、发券或商家结算完成。

## Rollback

Keep the previous client assets and `/t1f-approval.html` available for explicit fallback. If the new client fails acceptance, revert only the reviewed client/static integration or deploy the previously verified collector commit. Preserve database records and runtime privileges. Never reset or retry the original UNKNOWN operation as part of a client rollback.
