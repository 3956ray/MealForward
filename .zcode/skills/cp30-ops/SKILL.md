---
name: cp30-ops
description: MealForward CP30 业务后端运维与排障手册：六服务启停、PG 探针、publish/claim intent 诊断、已知地雷与红线。当用户提到 cp30、mealforward 后端、重启服务、intent 卡住、503、ORIGINAL_PRIVATE_UNKNOWN、DB_UNAVAILABLE、上链发布、查数据库、E2E 联调等问题时使用。
---

# CP30 运维排障手册（2026-10-14 接手时点）

## 布局（先读这个）

- **代码树**：`/Users/mili/Documents/Developer/mealforward-cp29-business`（git 根；React/Vite 前端在根目录 `src/`，Python 后端在 `cp30-backend/`）
- **运行时（live 状态，勿手改文件）**：`/Users/mili/.mf-cp30-20261013/`
  - 隔离 venv：`.mf-cp30-20261013/.venv`
  - 六服务：automatic-business / controller / application / identity / registrar / security
  - 前端入口：`https://localhost:16443`（必须精确此 Host，见排障剧本）
  - PG17：socket `~/.mf-cp30-20261013/socket`（**无 TCP**），库 `c1_connection`
  - 各 role 的签名 journal：`business-authority-originals.jsonl`（**独占锁**）
- **备份**：`/Users/mili/.mf-cp30-20261013-backups-20261014/`（pg_dump + 配置 + 基线 + 热修复记录 `HOTFIX-first-binding-material-grant.md`）
- **交接真源**：`cp30-backend/docs/WEB-GPT-HANDOFF-2026-10-14.md`（冲突时以它为准）
- **链**：EVM chainId 10143（Monad testnet），catalog/escrow 合约，USDC 定价

## 常用命令

```bash
# 服务启停（唯一入口，不要用别的方式杀进程）
env -i ~/.mf-cp30-20261013/.venv/bin/python -I -B cp30-backend/tools/isolated-entry.py \
  connection-bootstrap stop|start /Users/mili/.mf-cp30-20261013
# start 偶发 CONNECTION_SETUP_CLOSED，重试一次即可，不是故障

# psql（psql 二进制在 homebrew postgresql@17）
PGPASSWORD=$(cat ~/.mf-cp30-20261013/bootstrap-password) \
  /opt/homebrew/Cellar/postgresql@17/17.11/bin/psql \
  -h ~/.mf-cp30-20261013/socket -U c1_connection_bootstrap -d c1_connection

# 只读 Python 探针（-I 模式不支持其他 import hack；工作目录必须是 cp30-backend）
cd /Users/mili/Documents/Developer/mealforward-cp29-business/cp30-backend && \
env -i ~/.mf-cp30-20261013/.venv/bin/python -I -B -c \
  "import sys; sys.path.insert(0,'src'); <在这里写探针代码>"

# IPC 手动重试 intent（幂等，只对 UNKNOWN 恢复用）
# 通过探针调用 execute_original {'intentId': ...}
```

## 排障剧本

### 1. intent 卡 ORIGINAL_PRIVATE_UNKNOWN / FINAL 卡死（已解决案例：2026-10-14 04:25 打通）
闭环：`execute_original` 失败 → `ledger_abort` 回滚为 UNKNOWN → 后续只 lookup 返回空。当时的真实根因是**组合问题**（不是最初怀疑的 attempts 残留）：
- ② `ledger_reserve` 白名单缺 `catalogAuthority` / publish,setListed → CREATE OR REPLACE 补一行（归档 backups-20261014/HOTFIX-*.md）
- ③ `rpc_transport.py`（不在 pin 中，可直接改）SEND_ABI 缺 `0x5e88339b`(publish,12词) / `0x55e80d27`(setListed,4词)，operationPayloadHash kind 1/2 要归 catalogAuthority
- ④ worker observer 每请求 spawn python 子进程 ≈2s×25 次调用撞 45s 总预算（TOTAL_TIME_LIMIT）→ 竞速解法：离线验证 + 手工 live_result/live_projection（与 worker 同参数）替其收尾，setListed 投影由 worker 完成（撞 PROJECTION_CAS_CONFLICT 即证据）
- ⑤ `business_admit` 经 `c1_private.auth` 校验 intent 会话，**会话 30 分钟无活动即失效**——需要时可对 activity/expiry/wallet_principal 三处延期
同类卡点排查顺序：pg.log 权限错误 → ledger_reserve 白名单 → SEND_ABI method 覆盖 → worker 预算竞速 → 会话过期。attempts 残留行仍值得查（`\d c1_runtime_private.attempts` 后按 opId 查），但先验上面四项。

### 2. 503 DB_UNAVAILABLE / worker permission denied
- 已知根因：043 迁移重建 `first_binding_material` 漏 GRANT 给 `c1_auto_binding` → 已在生产库热修复，**但迁移文件本身未回填**（fresh-PG 检查以 bootstrap 跑，故不暴露此类缺权限）
- 新增类似问题排查法：查 pg.log 的 permission denied；`db.py` 把 42501 等非 P0001 错误统一映射为 DB_UNAVAILABLE，要看原始错误
- 注意：`c1_runtime_internal.first_binding_material` 不能直接 psql 调（需运行时票据）；绕过方式是跑 043 的激活 SQL

### 3. SIGNER_JOURNAL_UNAVAILABLE（手工只读探针 compose 服务失败）
journal 独占是预期行为。config 需带 `profile` 字段（由 `private_connection_config.load()` 注入）才能正确 compose；catalog 与 issuer 服务条目存在差异，待查。

### 4. 前端 4xx 类
- **ORIGIN_DENIED**：用了 `127.0.0.1` 或直接开 API 路径——必须精确 `https://localhost:16443/`（http.py 严格 Host/Origin/sec-fetch-site 校验）
- **422 STALE_REVIEW**：review 窗口仅 **300 秒**，开着对话框超 5 分钟即失效；发生在创建 intent 之前、无残留，重新点 Review & publish 并**立即确认**
- **"owner records could not be refreshed"**：会话 1h TTL 过期，重新钱包登录

### 5. 背景噪声（勿误判、勿去修）
- `BUSINESS_CODEC_UNAVAILABLE` / `LIVE_STEP_FAILED`（tasks 阶段）：7 个废弃 fund intent 轮转报错，真实 claim 成功时段也在发生，不阻塞新 intent

## 红线（任何操作前自检）

1. **UNKNOWN 只恢复原 intent，禁止重发/重签**（幂等键是原 intentId）
2. 180 秒等待是平台门禁设计，合约**不会**自动打款，不要试图绕过
3. 时间一律 UTC+8，**不做 ±8h 换算**
4. 原 7 USDC 条款不可覆盖
5. **实库不清不重建**；六服务直接从源码树加载，改 `src/` 前先停服务
6. 不向聊天/Git 输出私钥、JWT、短码、bootstrap-password 内容（引用路径可以）
7. CP30 冻结合同见 `cp30-backend/AGENTS.md`（SHA b402bcbc…）；**父目录与 cp30-contracts 字节不动**；迁移批次 042/043/044 pin = 7113f618 / c79e1e5d / cf82137d

## 监控要点

- pg.log 里的 permission denied（缺 GRANT 类问题的第一信号）
- `logs/automatic-business-*.log` 的 C1_DIAGNOSTIC 行
- 各 role journal 行数变化
- `select action,stage,transaction_hash from c1_live_private.intents where action in ('publish','setListed');`

## 剩余工作（2026-10-14 04:35 更新）

1. E2E 当前位置：fund intent `9a03db49-b74e-45c9-baf6-f8a28cf3f3bc`（1×0.5 USDC，quote 已签名，stage=WAIT_ACTOR）等支持者 B（0xcc5c…2952，独立浏览器身份）钱包 approve+fund 分开两笔 → 领券 → 老板核销 → 180s → 老板钱包结算；钱包签名全部由用户完成
2. 赛后：043 迁移文件回填 GRANT 并重 pin（走重 pin 审核流程；042/043/044 pin = 7113f618 / c79e1e5d / cf82137d）
3. 查明 catalog 与 issuer 服务条目差异
4. 全部 authority grant（quote/issuer/operator/registrar/catalog）**北京 2026-10-14 10:04:44 到期**，过期后签名需重新走授权审核，不自动延长

## 手工测试注意

- 手工构造 quote 测试必须补 `quoteId=opId`，否则 prepare_quote 快速失败会被误判为 codec 损坏
- 新 quote 由 worker 轮转签名，需等 1–2 分钟轮到，不是即时返回
