# MealForward 留膳 — G1-D 原始 CP30 SQL → 签名公开数据 → Sites 端到端联调

**日期：2026-10-21 (UTC+8)**

## 验收结果（仅隔离 CI）

**PASS：** GitHub Actions https://github.com/3956ray/MealForward/actions/runs/39563290420

本次不再把原 CP30 的 SQL 检查、发布者 Outbox、独立防回滚锚点、缓存和 Sites HTTP 分开算成功，而是在**一次 GitHub Actions 实际运行**中完成：

1. 在全新 disposable PostgreSQL 17.11 中应用未经更改的 CP30 原始 44 个 migrations（001–045）、原角色和权限限制，并执行原有 G2 验收。
2. 以原 SQL `c1_g1_export.public_snapshot()` 在开放的临时测试事务中投影真实数据库查询结果：一家 synthetic 测试餐馆，两种经确认上架的测试餐品（旧 7 USDC、新 0.5 USDC），测试资助聚合 14.5 USDC；真实领取者私有记录不会传输到公开链路。
3. Python 只在 CI 本机 `127.0.0.1` 暴露该 SQL 查询结果（GET）。没有 DB 客户端从 Render 或公网读取原始私有 SQL。
4. Node.js 使用 `G1_PUBLIC_DATA_ONLY_V1` 限定的 **临时 Ed25519** 密钥，验证及签署原 SQL 返回的严格公开 DTO；在源 PostgreSQL 中先持久化 Pending Outbox，然后执行 HTTP 提交。
5. 公共数据 Cache 和 High-watermark Anchor 位于 GitHub Runner 上另外两个**不同 PostgreSQL 系统 ID**的 17.11 容器；独立执行签名、序号及防回滚验证。Cache 和 Anchor 各自更新后，通过独立回读才能提交源 Outbox ACK。
6. 从真实 HTTP `GET /v1/stores`、`GET /v1/stores/{id}/meals` 和 `GET /v1/ledger` 返回原投影数据，再由原 Sites `verifiedPublicStores`、`verifiedPublicMeals` 与 `verifiedPublicLedger` 校验，确认 7 USDC / 0.5 USDC 餐品版本、`F = 14,500,000` base units、资助三份和真实币种精度。
7. 验证重复签名信封和篡改名称的请求返回 409；私有 Voucher、CSRF、Email、Session 等原测试保密字段绝不出现在 HTTP 响应；公共链上终局证明明确标为 `UNVERIFIED`，不能把真实餐食交付或最终结算冒充已验证。
8. 运行之前已通过的 G1-C 私人查询链路：两种钱包 Session、My Contributions、My Claims、My Meals、跨钱包拒绝、原始来源和权限约束；临时 SQL 记录全部回滚，原 CI 数据库随后被销毁。

CI 输出中必须存在：

- `G2_FRESH_PG17_MIGRATIONS_PASS`
- `g1RealSqlPublicPipeline: PASS`
- `g1LiveOriginalSqlHttp: true`
- `originalMacOrRenderDbTouched: false`
- `syntheticRowsPersisted: false`
- 公开签名 12/12、私有 HTTP 5/5 通过

## GitHub 工件

- `cp30-backend/tools/g1_public_http_sql_gate.py`：只允许在原 G2 严格 CI 条件下运行，提供当前未提交临时 PG 投影的本机只读桥。
- `cp30-backend/g1-export/live-public-sql-pipeline.ci.mjs`：真实来源 → Ed25519 签名 → Outbox → Cache/Anchor → HTTP Sites DTO 校验。
- `cp30-backend/tools/g1_public_source_pg_probe.py`：将新完整公开管线插入原 PostgreSQL 事务验收，确保测试与独立 G1 私人数据验证同一轮运行。
- `.github/workflows/cp31-g2-postgres17.yml`：在 G2 原 PG17 之外再启动两个完全独立的 PG17 测试容器、固定 Node 22 和唯一批准 CI 配置。

## 不能据此宣称通过的门槛

**原始业务数据没有被复制或读取。** 当前所有业务值都由 disposable 测试数据构成，金额只是测试账本守恒。GitHub Runner 上的三个 PostgreSQL 容器虽然系统标识符不同，但仍由同一 CI 拥有者管理，**不具备生产独立运维机构的抗合谋保证**。

- 原 CP30 Mac `PREPARED #3560` 尚未取得完整受保护备份、Journal 全链核验及受控恢复证据，不允许重启、升级或迁移该原数据库。
- 现有 Render 服务只具备 Auth Pilot 的独立 SIWE Session；不可因为同名 Cookie 就等同于原 CP30 钱包 Principal。
- 真实 G1 公网公开数据服务仍缺：由原来源只读授权、公钥固定、独立持久锚点及原 CP30 数据源接入；必须重新审查密钥托管和来源最终性。
- 真实 My Contributions/My Meals 不得使用公开 Cache 代替私有授权读取。
- 原智能合约未链上强制 180 秒结算窗口，公网资金写入仍被禁止。即使 G1 发布成功，G3–G5 和真实 Settle 仍是单独门禁。

## 下一项关键工作

并非继续增加人工演示：现在 G1 代码已经有完整端到端、互相兼容的隔离 PostgreSQL/HTTP 证据。**下一处真正缺失的证据是原用户本机的受保护账本核验和安全原始数据源**。在尚未证实这一门槛之前，不能启用任何可能展示旧资产为新数据的云端业务连接。

所有 CI 密钥、来源 URL、测试券码为 ephemeral 且不属于原用户资产。
