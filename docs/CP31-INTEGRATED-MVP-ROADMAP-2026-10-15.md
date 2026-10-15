# MealForward / 留膳 — CP31 统一 MVP 路线图

**日期**：2026-10-15 (UTC+8)
**目的**：把已验证的 MetaMask 签名登录、Sites 风格前端与成熟 CP30 链上业务后端整合成安全、可恢复、可部署的产品。
**约束**：用户只允许零付费 Render 资源；所有链上签名均由用户本人授权；保留原本真实 PostgreSQL、资金、餐券、交易日志和智能合约；未获授权不得切换生产域名。

## 1. 三条现存开发线

| 轨道 | GitHub 来源 | 当前事实 |
| --- | --- | --- |
| CP30 业务后端/合约 | main → cp30-backend/ 与 cp30-contracts/，HEAD 83ccc99 | 本机 PostgreSQL 17.11 + 独占 Journal，已有 publish/list、approve/fund、issue、lock/handover/report 的链上验证记录；实际 settle 最终成功仍缺证据 |
| CP31 用户体验 | codex/mealforward-simple-flows-v1，HEAD 0aeaaeb | 保留 Sites 风格；资助三步 UX、一键领券、My Contributions、My Meals、动态 QR 与恢复交互已写入前端，尚未完成真实公网资金/领券 E2E |
| CP31 Auth Pilot | codex/mealforward-cp31-auth-pilot，HEAD b845e72 | Render 免费 Web Service + PostgreSQL 17；2026-10-15 用户反馈真实 MetaMask 登录成功；这是独立 Auth Pilot，不含真实订单、餐券和合约写操作 |

**禁止混淆：** Auth Pilot 的用户 Session 与 CP30 原始钱包 principal 不自动等价。Vercel main 当前仍是历史 React 模拟站点；不能假定静态 Preview 已接通完整 CP30 API。CP30 后端与 Sites 前端来自不同 Git 历史，不直接合并不同根历史。

**原数据库最近只读快照（用户 2026-10-15 提供）：** 042/043/044 对象存在，Catalog binding GRANT 通过；餐品版本 LIVE 1 / PENDING 1；Fund FINAL_SUCCEEDED 2、ACCEPTED 3、WAIT_ACTOR 5、UNKNOWN 4；Issue FINAL_SUCCEEDED 3；Lock FINAL_SUCCEEDED 1、FINAL_REVERT 2；MarkHandover 和 Report 各 1 个 FINAL_SUCCEEDED；Publish 与 SetListed 各至少 1 个 FINAL_SUCCEEDED；Settle 尚无完成记录。该快照不是永久真值。

## 2. 业务模块及目标

| 页面/模块 | 最终用户体验 | 必须证明 |
| --- | --- | --- |
| 登录 | 点击登录，优先用 MetaMask 当前已授权账号一次签名；初次连接可出现钱包授权 | Origin / chainId 10143 / nonce / CSRF / Session 同地址；刷新、登出、换钱包隔离 |
| Kitchens | 浏览商家、图片、餐品单价、服务时段、可领取数量 | 只显示原版本经确认上架的餐品和真实业务库存 |
| Open Kitchen | 填写店铺和第一餐、签署授权、自动部署合约并发布 | 部署真实 finalized，可查原 Registration ID，不能复制旧店 |
| Kitchen Meals | 草稿、编辑、图片上传重试、发布、上/下架、餐品新版本 | 历史资助条款、价格及已发行 Voucher 不被覆盖 |
| Support | 点击资助与选数量 → 审核餐品/单价/数量/合计 → 钱包付款 | ERC-20 Approve 是授权不是付款；Fund FINAL_SUCCEEDED 后产生订单和链上交易链接 |
| My Contributions | 本人订单卡片、金额、付款状态、原交易 Hash、资助进展 | 查询真实后端，钱包隔离，刷新/超时可找回原 Intent |
| Claim | 一键领取、后台创建原 Issue、等待链上确认 | Issue FINAL_SUCCEEDED 后才出现私人餐券，UNKNOWN 不重签不重发 |
| My Meals | 本人 Voucher、餐品版本/有效期/使用状态、动态 QR | 仅可使用券展示短时 QR（最多 120 秒），已用券不可再核销 |
| Kitchen Verify | Check→Lock→实际交餐确认→MarkHandover/Report | 商家真实确认交餐，扫码本身不代表完成核销或实际交餐证明 |
| Payouts | 待结算/可结算/处理中/已到账 | Report finalized 后按平台 180 秒门禁由老板签 Settle，最终收到独立链上完成证据 |
| Public Ledger | 聚合公开餐食进展及真实链上证据 | 隐藏领取者身份和所有私人券码 |
| 失败恢复 | 人类可读状态，不反复让用户确认技术细节 | 断网/刷新/Session 失效/Worker 重启/UNKNOWN 全程有原操作恢复与审计证据 |

## 3. 按依赖顺序执行的 Gate

### G0. 公网身份验收（当前已部分通过）

- Render Auth Pilot 实际 MetaMask 已可登录：此处已由用户人工确认。
- 尚需真人测试：刷新仍可读 /v1/me；登出后无权限；切换账号清理旧角色数据；错误网络拒绝；挑战重放拒绝；首连/已授权账户不发生无谓二次选账户。
- 记录非敏感证据；绝不要求上传签名、Cookie、私钥。
- **通过标志**：登录/登出/换钱包/刷新和重放拒绝形成完整实测记录。

### G1. 统一源码和 API 契约（待做）

- 从 CP30 backend/contract 源码建立独立整合分支，导入 CP31 Sites dist 静态文件（复制受控内容，非直接 merge 独立 Git 历史）。
- 整理页面 → API → PostgreSQL → Contract / Intent 映射，保留原角色和资金状态机。
- 核对 Auth Pilot 和 CP30 钱包 Principal/Session 兼容性；不要直接把 Pilot Session 当成资金操作鉴权。
- **通过标志**：统一测试站点上的真实 Kitchens、My Contributions、My Meals 的只读 API 与身份正确，不返回模拟订单或私人记录。

### G2. PostgreSQL / 迁移可复现（待真实 PG17 执行）

- 在独立、全新 PG17 执行原完整 migrations + connection-migrations 到 044 与新 045 前向迁移；检查所有角色、函数所有权、GRANT、Catalog 预约、过期 Fund Quote 的容量规则。
- 045 只用于尚无运行账本状态的全新环境，不得直接执行在现有本机 c1_connection 数据库。
- 校验旧热修是否正确回填、Source Pin、权限回归；旧本机数据不迁移不清空不重启。
- **通过标志**：真实 Postgres 17 最小权限/失败案例/迁移/数据一致性测试有可审计 PASS 报告。

### G3. 云端后端 + 可靠持久化（链上写权限门）

- CP30 原后端本机 TLS / localhost Origin、Unix Socket PG、六服务进程及独占 Journal 不可直接原样部署 Render；需明确 Host/Origin/Session/可信代理边界。
- 解决 Session 过期引发的原 Intent 孤儿、RPC Worker 执行预算过慢、超时前未签名过期操作退休，以及 Journal 恢复与备份。
- Render 免费 Web Service 休眠、没有持久磁盘；免费 PG 于 2026-11-13T19:40:36Z 到期。长生命周期签名日志与真实测试网资金不能依赖该临时环境。
- **禁止放行 Fund/Issue/Lock/Report/Settle**，直到独立审查与重启/丢包/UNKNOWN 原 Intent 恢复通过。无法在免费平台满足时，云端继续只做 Auth+ReadOnly；本机隔离环境受控执行资金 E2E。
- **通过标志**：真实私有 Journal 防丢失、Nonce 与 PG checkpoint 一致、崩溃恢复和安全备份可验证。

### G4. 支持者和领取者闭环（待 G2/G3）

- 资助三步：餐品和数量 → 单价与总额确认 → 钱包授权及 Fund；状态以链上 finalized 为准；成功生成 My Contributions 原订单和交易浏览器链接。
- Issue 一次点击；后台持久排队和幂等完成；My Meals 显示真实已核验 Voucher、有效期和短码。
- 原钱包重新登录后可按原身份追踪待处理 Intent，不能因为超时自动生成第二笔资金或第二张餐券。
- **通过标志**：支持者 1 笔 Approve/Fund 真正 finalized；领取者 1 笔 Issue finalized；订单/券在登录恢复、断线和刷新后保持正确。

### G5. 商家与资金结算闭环（待 G4）

- 商家创建草稿、图片、发布、上/下架；扫码 Check、Lock、现实交餐、Report；180 秒后由老板钱包独立 Settle。
- Public Ledger 接真实聚合记录，Payouts 与链上金额一致；不公开私人凭证；原已资助餐品版本不变。
- **通过标志**：第一笔真实 Settle FINAL_SUCCEEDED，包含交易 Hash/Receipt、支付钱包、链上金额、数据库业务状态和商家 UI 的一致证据。

### G6. 发布验收（待 G0–G5）

- Sites 原设计语言保留，手机/桌面响应式；主要交互三步化，错误/恢复清晰。
- 三种角色 E2E、跨钱包/刷新/过期负面用例、单元/集成/浏览器回归通过；链上每一步有独立 Tx 证据。
- 完整产品 URL 不展示历史模拟数据；公网开放只在安全门通过后执行；旧生产配置不自动改变。
- 确保 Render 免费数据库到期前有测试资料保留/清理计划，禁止将它作为长期唯一业务数据源。

## 4. 下一次具体开发任务

1. **先做 G0**：验证 Auth Pilot 登出、刷新、换钱包和重放/无效挑战；固定安全基线。
2. **接着做 G1**：建立统一整合开发分支和 API/DB/合约矩阵，将 Sites CP31 体验加入 CP30 技术基座，不修改本机实际数据库。
3. **并行准备 G2 的隔离 SQL 验证**：校验新增 045 迁移在 PostgreSQL 17 上真正可运行，修复尚未回填的热修差异。
4. 优先让 Kitchens / My Contributions / My Meals 的只读数据可见，之后解决资金/Issue 的真正持久化问题。
5. 最后开放商家 Settle 与完整业务 E2E。零付费要求和非持久化限制可能使云端资金业务无法安全上线，不能假装该门槛不存在。

**分工**：ChatGPT 负责仓库、代码、API/SQL 测试、免费 Render 与 Vercel 非敏感配置；用户仅负责浏览器真人钱包签名、不能远程执行的本地只读探针，以及在各平台私下配置 Secret。不得把数据库 URL、签名或私钥贴进聊天。
