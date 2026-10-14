# MealForward — Render 免费方案部署前核查（2026-10-14）

## 结论（2026-10-14，依据 GitHub 源码和 Render 官方文档）

- **目标：零付费、隔离的云端集成测试。** Vercel CP31 前端分支是 `codex/mealforward-simple-flows-v1`；后端源自 `main` / `codex/mealforward-cp30-handoff` 当前 `83ccc99`。两条前端/后端开发历史不同，不直接合并。
- **目前绝不能声称云端已可登录或可安全付款。** Vercel 仅部署静态前端，`/v1/*` Python API 与服务器 Session 未部署。
- **免费 Render 不能直接安全运行当前 CP30 链上全流程。** 先改造代码、隔离测试、证明持久状态与身份协议，再决定是否开启任何受控测试网业务操作。
- 不改动 `main`、现有 Vercel Production、用户本机 `~/.mf-cp30-20261013/`、已有测试网 escrow/old 7 USDC 记录；不复制签名私钥、JWT、数据库密码或原 journals 到 Render。
- **Render Workspace**: 插件读取到唯一可见工作区 **LaoDao**（ID 由连接工具返回）。未获用户确认其为本次部署目标之前，**不创建任何 Render 资源**。用户只授权免费套餐，不得创建付费 worker/private service/disk/DB 或升级套餐。

## 实际代码阻塞（需要源码改造，不能直接套普通 Flask 模板）

| 部分 | 源码证据 | 阻塞 |
|---|---|---|
| HTTPS 与 Origin | `cp30-backend/src/c1/full_configuration.py` 的 `validate_origin()` | 只接受 `https://localhost:<本机端口>` 或本机 IP，且 Wallet proof 绑定精确 Origin |
| HTTP Listener | `cp30-backend/src/c1/http.py` | 固定绑定 `127.0.0.1`，进程内部自己终止 TLS；拒绝 `Forwarded` / `X-Forwarded-*`。Render 公网服务要求 `0.0.0.0:$PORT`，HTTPS 在 Render 入口终止 |
| 数据库 | `cp30-backend/tools/connection-bootstrap.py` | 运行本机 PostgreSQL 17.11 `initdb`，配置仅 Unix socket、创建大量角色和独立 database；不能将现有 bootstrap 直接对 Render 托管 PostgreSQL 执行 |
| 事务日志 | `cp30-backend/src/c1/runtime_ledger_controller.py`、各个 signer journal | 本地独占文件+同步落盘+校验 checkpoint 与材料摘要；Render 免费 Web Service 的容器文件不持久，睡眠、重启与 redeploy 后可能丢失 |
| 长期任务 | 六个独立业务/身份/控制/注册/安全服务和 signer/observer | Render 免费 Web Service 15 分钟无流量即休眠，常驻签名/观察 Worker 会中断 |
| 数据库源码一致性 | `cp30-backend/docs/RUNTIME-HOTFIXES-2026-10-14.md` | 本机直接热修的 SQL 权限、catalog role、CAPACITY、僵尸 lock 等尚未全部回填到迁移源文件，fresh DB 不能保证与本机行为一致 |
| 部署权限 | Render Managed PostgreSQL 非超级用户环境 | 需验证角色创建、ownership、GRANT、函数 ownership/RLS 的实际兼容性；不得自称已验证 |

## Render 免费层限制（以 Render 官网实时说明为准）

1. **Free Web Service**：闲置约 15 分钟后休眠；重启和重新部署会丢失本地写入的文件，不能挂持久磁盘，不适合保管签名 journal / 未完成 Intent；单个免费实例内存/CPU 有限。
2. **Free Postgres**：每个工作区最多 1 个，容量 **1 GB**，创建后 **30 天到期**；14 天升级宽限期后会被删除，不能作为真正的捐餐历史长期存储。
3. **后台 Worker / Private Services**：不能假定有免费的常驻版本；免费 Key Value 无持久化，同样不能取代交易 Journal。
4. 即便实例是 Free，如果账号绑定了付款方式，超出包含的出站流量或构建分钟数仍可能产生账单。开始前应检查 Render Billing 消耗上限，避免违背用户“零付费”要求。

官方文档：
- https://render.com/docs/free
- https://render.com/docs/web-services
- https://render.com/docs/postgresql
- https://render.com/docs/disks

## 推荐落地阶段（严格按顺序）

### Stage 0 — 工作区与零费用门

- 请用户确认使用 **LaoDao** 工作区。
- 用 Render 插件只读列举现有服务和数据库，查看可用免费容量，避免重复占用唯一 Free PostgreSQL 配额。
- 无任何付费资源授权；记录 `plan=free`，创建前复查计费和取消机制。

### Stage 1 — 代码适配，不公开真实资金操作

- 在**独立代码分支**实现 Cloud Preview 模式：不改本机来源验证语义，云环境独立配置 allowlist、TLS edge 代理的受信边界与 Host/Origin 校验。限制代理头只接受 Render 内部可信链路，拒绝任意外部伪造。
- 接入只读 `/health` 与明确的登录 `/v1/connection`、`/v1/identity/setup` 健康检查；未就绪时返回结构化 503，前端禁止钱包签名。绝不能伪造 `session`、`issue` 或 `fund` 成功。
- 将云端 DB 的角色/迁移/权限加入独立初始化计划和隔离的真实角色回归；先修 043 GRANT 与其他未回填热修，重算准确的文件 pin。
- 在安全设计得到明确批准之前，所有链上签名、fund、issue、lock、report、settle 和新店部署保持关闭。

### Stage 2 — 免费预览环境基础资源（用户确认工作区之后）

- 使用 `plan: free` 创建 1 个独立 Render PostgreSQL（测试数据库）及 1 个 Free Web Service（经过评审、可只读/测试的单入口）。二者必须在同一个 workspace 和 region。
- Vercel CP31 仍作为前端；经确认的 HTTPS API 通过同源 `/v1/*` 代理访问 Render，严格测试 Origin/Cookie/CSRF/SIWE nonce/签名与当前 MetaMask account。
- 仅当两端真实连接并完成匿名接口、登陆、登出、钱包切换的集成测试，才宣称云端登录可用。

### Stage 3 — 资金功能放行门（免费架构目前未满足）

**默认 BLOCKED**：必须证明不可丢失的外部原操作 Journal、事务状态一致性、Worker 冷启动恢复、数据库备份与过期退出方案、Nonce/授权与有限 Gas 风险控制；否则不得使用 Render 免费服务托管真实 Testnet 资金/餐券操作。

## 最终验收

- 开启无痕浏览器，API `/v1/connection` 返回经过校验的 JSON，不再把静态 HTML 当 JSON。
- 已授权 MetaMask 账户点击 Sign in，仅发生**服务端随机 Challenge 对应的一次登录签名**（首次连接允许钱包原生授权），签名后由服务器创建 Session、`/v1/me` 返回**同一个**账户。
- 不同 MetaMask 钱包不可看到别人的私人店铺、订单或餐券；刷新后在受控会话内恢复。
- 断网、403、JWT 不匹配、API 503 时从未出现虚假登录成功，且用户不会反复被要求无效签名。
- 未通过持久化/业务状态门之前，资助/领券/核销/结算应明确关闭，不展示模拟成功。

## 实际状态

**本文件仅为可执行前置评估，不是 Render 部署完成证据。**
