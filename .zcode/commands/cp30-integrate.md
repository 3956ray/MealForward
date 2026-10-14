---
description: 三轨（前端/后端/合约）并行开发后的联调入口：就绪检查 → 接口同步校验 → 服务重启 → E2E 全链路 → 结果归档
---

# CP30 三轨联调

三轨并行改动后的统一联调流程。按阶段顺序执行，**任一阶段失败先报告，不要带病进下一阶段**。钱包签名步骤由用户完成，明确告知操作窗口。

## Phase 0：三轨就绪检查（只读）

1. **后端轨**：跑 `/cp30-status`，要求六服务在跑、前端 200、无真实异常（背景噪声 `BUSINESS_CODEC_UNAVAILABLE` / `LIVE_STEP_FAILED` 除外）
2. **合约轨**：`git -C /Users/mili/Documents/Developer/mealforward-cp29-business status --short cp30-contracts/ contracts/` —— 预期干净（冻结）；有未提交改动则先停下问明来源
3. **前端轨**：`npm run build`（仓库根，或 README 已验证命令）通过
4. **授权状态**：authority grant 北京 2026-10-14 10:04:44 已到期——涉及 authority 签名的 E2E 前提醒用户重新走授权审核，不要试图绕过

## Phase 1：接口同步校验（三轨之间的契约没被单方面改掉）

1. ABI 副本一致性：`diff shared/MealForward.abi.json indexer/abis/MealForward.abi.json`，且与 `cp30-contracts/out/` 产物对齐
2. 链上登记册：`~/.mf-cp30-20261013/chain-profile-public.json` 的 `chainProfileDigest` 与交接文档记录一致；不一致 = 合约/部署层有变更，先对齐三轨认知
3. 查交接文档里有没有未消化的「接口变更通告/请求」（后端→前端、合约→全轨）；有则先确认各轨已适配

## Phase 2：服务重启（后端轨改动过才需要）

```bash
env -i ~/.mf-cp30-20261013/.venv/bin/python -I -B cp30-backend/tools/isolated-entry.py \
  connection-bootstrap stop /Users/mili/.mf-cp30-20261013
# 确认停干净后再 start；start 偶发 CONNECTION_SETUP_CLOSED 重试一次
env -i ~/.mf-cp30-20261013/.venv/bin/python -I -B cp30-backend/tools/isolated-entry.py \
  connection-bootstrap start /Users/mili/.mf-cp30-20261013
```

（重启后重跑 `/cp30-status` 确认六服务、catalog_available。）

## Phase 3：E2E 全链路（浏览器 + 用户签名）

在 `https://localhost:16443`（精确此 Host）走完整业务流，每步在数据库确认状态机：

1. 老板登录 → 存草稿 → Review & publish（**300 秒内确认**）
2. psql 查 `c1_live_private.intents`：publish intent 到 ACCEPTED / Listed（有 transaction_hash）
3. 支持者 B：approve → fund（用户钱包签名）
4. 领取者：领券（私密链接，免注册）
5. 老板：核销（验券/锁）
6. **等待 180 秒**（平台门禁，合约不自动打款，不要试图绕过）
7. 老板钱包结算到账确认
8. 全程 `select action,stage,transaction_hash from c1_live_private.intents where action in ('publish','setListed');` 与 `c1_runtime_private.attempts` 残留监控

任一步失败：按 `.zcode/skills/cp30-ops/SKILL.md` 对应剧本定位，判明属于哪一轨的问题，记录后停止（不要在联调中途顺手改另一轨的代码）。

## Phase 4：结果归档（交接闭环）

- 交接文档新增当日联调记录：通过到第几步、涉及 intentId/opId、发现的跨轨问题清单（标注责任轨）
- git 提交各轨源码改动（分开提交，按轨归因）；运行时目录与密钥不入库
- 提醒 agent 更新跨会话记忆
