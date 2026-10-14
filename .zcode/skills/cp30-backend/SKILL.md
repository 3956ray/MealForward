---
name: cp30-backend
description: MealForward 后端轨（cp30-backend/，Python 六服务 + PG17）的开发边界、迁移纪律与接口广播义务。当任务涉及 cp30 后端源码、迁移、IPC、数据库、服务逻辑时使用；排障细节先查 cp30-ops skill。
---

# CP30 后端轨

## 本轨身份与文件边界（并行开发的纪律）

- **拥有（可写）**：`cp30-backend/**`（src/、integrations/、connection-migrations/、migrations/、tools/、tests/、config/、docs/）
- **不碰**：仓库根 `src/`（前端轨）、`cp30-contracts/**`（合约轨，冻结）、根 `server/`、`contracts/`、`indexer/abis/`、`shared/`；运行时目录 `~/.mf-cp30-20261013/` 只按 cp30-ops 的命令操作，不手改文件
- 排障、启停、探针、红线的完整手册在 **cp30-ops** skill —— 本 skill 只补「作为并行轨之一的开发纪律」

## 开发纪律

1. **改 `src/` 前停服务**（六服务直接从源码树加载），改完走「重启 → /cp30-status → 探针验证」
2. **迁移三步铁律**：改迁移文件 → 更新 pin → fresh-PG 验证。**禁止只热修生产库不回填文件**（043 GRANT 教训：fresh-PG 检查以 bootstrap 跑，缺权限类问题会漏检）
3. **API 是对前端的契约**：错误码语义、状态机阶段名、字段名变了 → 必须在交接文档写「接口变更通告」（改了什么、旧行为、新行为、生效时间），前端轨依赖这个同步
4. **链上参数以 profile 为准**：地址、asset、chainId 从 `chain-profile-public.json` 读，不硬编码；profile digest 变了说明合约轨有动作，先对齐
5. authority grant 已于北京 2026-10-14 10:04:44 到期：涉及 authority 签名的功能开发，把「需重新授权」标为前置条件，不绕过

## 与联调的关系

后端通常是联调的第一站：`/cp30-integrate` 会先跑 `/cp30-status` 确认本轨就绪，再拉前端做 E2E。后端改动单独验证用：
- 只读探针（cp30-ops 有模板）
- `select action,stage,transaction_hash from c1_live_private.intents where action in ('publish','setListed');` 看状态机走向
- 日志无新增真实异常（背景噪声除外，见 cp30-ops）
