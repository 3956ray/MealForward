# MealForward（留膳）— Agent 一读即接手 · HANDOFF

> **本文件是当前项目唯一的高优先级跨 Agent 接手入口。** 从仓库根目录打开 `HANDOFF.md`，先核对实时 GitHub / Render / Supabase，再继续任何开发。此文件随每次开发、迁移、部署和用户验收更新。历史 `docs/agent-handoff-2026-10-16/` 与原 CP30 合同不得当作 2026-10-23 的实时云状态。
>
> **更新日期：2026-10-23（UTC+8）**。状态在新提交和链上交易后可能变化；引用的是当时已实际查到的资源，不能把未来状态当真。
>
> **当前唯一待完成里程碑：T1-F 原始唯一餐券由真正 Issuer 的 MetaMask 亲自调用 `issue()`。** 下一位 Agent 先执行本文的核验与公网安全 Gate；未经通过不可让人发交易。

## 0. 接手即读 / 不可犯的错误

1. **不能重复资助（Fund）**：仅一份真正已经付款的 7 Test USDC 暖心盖饭，原 Intent `2b9ae6f1-2bb7-4096-8136-70f30f302eea` 为 `FUNDED`。Approve/Fund 已上链，下面记录 Hash。其他所谓“再次资助”都不是本任务。
2. **不能重复 Claim / Consent**：唯一真实 Recipient Claim `fbab3b22-965d-44e2-b144-d7307b7aa8ea` 为 `CONSENT_VERIFIED`，一次 EIP-712 Consent 已被本人签署并落到隔离 PG，**不要**再发一个 Claim/Nonce 或要求重签。原 Consent 的签名时间窗可能已过；“签署时限”不是后续 Issuer `issue()` 的交易时限，012 迁移已分离。
3. **不能自动 Issue**：先必须由 Issuer 的 T1-E SIWE+CSRF Session 获准，基于最新 Monad 只读 RPC/数据库的一份记录预留唯一 `ISSUE_UNKNOWN` / opId / nonce / calldata hash / 新 issuer deadline，数据库 COMMIT 成功后，**只能用户在 MetaMask 明确点一次发送**。拒绝、超时、Hash 丢失或重启：只能查原始交易，**绝不再广播/重建同一 Unit**。
4. **不得开放商家结算**：原 T0 合约的 Recipient Consent 仅链下验证，原链上 `issue()` 不验证受助者签名；`settle()` 未链上强制 180 秒冷却（Issue #17）。不可将同意 Claim/Issue 解释为“已经出餐”或资金已结算。旧 Mac CP30 Journal `PREPARED #3560` 仍冻结、禁止自动启动/恢复/重建。
5. **保密**：绝不检索、显示、复制或写入完整数据库 DSN、密码、私钥、原始 SIWE/EIP-712 签名、Session Cookie/CSRF、旧 Journal。公共地址、公共 Testnet Hash 可以出现。认证凭据由用户在自己 Render Dashboard / Mac 上持有。

## 1. 产品和角色

留膳（MealForward）：捐赠者预付一顿饭，困难人士领取，商家验券/出餐，合约链上托管最终结算。中文主张“留一膳，待一人，是为善。”，视觉避免渲染贫困。目标 UX：资助者三步支付并回显钱包/Hash，受助者 My Meals 单券，商家核验、动态 QR/短码、Lock、MarkHandover、Report、Settle；历史 CP23 领取链接优先、QR 到店短时显示。本次 T1 测试仅走**一个 Monad Testnet 原始 7 Test USDC Unit**，并非完整业务产品已经可对公众运营。

角色：Donor (Quote/Payer)、Issuer、Recipient、Owner、Operator、Catalog、Merchant Settler、Admin。安全模式同时考虑可信平台与恶意平台，最小权限与独立密钥、EIP-712 Consent、数据库/链上账对照、慢结算和紧急暂停是基础，但现实交餐不能靠区块链自动证明，平台/商家合谋仍是未解决威胁。

## 2. GitHub 分支、CI 和最新代码

仓库：**https://github.com/3956ray/MealForward** （公开；不存秘密）。

- 目前**开发真源**：`codex/mealforward-t1f-original-issue-recovery-20261023`，**Draft PR [#40](https://github.com/3956ray/MealForward/pull/40)**。在开始任何写入前先实时查看 GitHub 的**最新 HEAD**，不要用本文静态 Commit 值覆盖其他 Agent 的最新提交。
- T1-F 基线 `codex/mealforward-t1e-recipient-claim-http-20261023`，源 HEAD 在本轮接管时为 `f786d08521f092bea5c8cff355c316dcd5591c79`，Draft PR #38；T1-F 源码承接此分支。禁止与旧 CP30 不同 Git 历史的分支 blind merge。
- 原 T1-F 原型（独立分支）`codex/mealforward-t1f-issuer-control-and-issuance-20261023` `de1f346d`，只作为代码来源；曾将 Recipient 的 Consent 截止时间错当后续 onchain Issue 截止时间，现已有明确区分，不能重新拷入旧版本。
- T1-F 最近测试通过（源代码、钱包 UI、独立 PostgreSQL17 009–012、无钱包广播）：[Actions 39943102604](https://github.com/3956ray/MealForward/actions/runs/39943102604)；原 Monad RPC eth_call 真实只读第一券预检：[39943102454](https://github.com/3956ray/MealForward/actions/runs/39943102454)。上述运行针对旧提交 `77fe0e95`。**本文件/新功能更新后，必须重新确认 exact-head CI，不得沿用旧 PASS。**
- 历史首次真实支付独立回执：[PR #35](https://github.com/3956ray/MealForward/pull/35)，上链 Approve `0x0b5ef56afe4e8ffcba6349b7893929231213a130896a7810d5f428723b4a218d` 和 Fund `0x6d241844fc0edda40af1c30eceab11ac0b95057337218de21e0c4026954ce219`，两者成功；7,000,000 个 6 位小数 USDC 基本单位，原合约 escrow liability 相等。参考 [PR #35](https://github.com/3956ray/MealForward/pull/35)。

### 主要源码路径

| 路径 | 用途 |
| --- | --- |
| `t1-intents/core.mjs` | Chain 10143、原 StoreEscrow、Test USDC、Meal/Terms/Quote 常量 pin |
| `t1-intents/testnet-readonly-rpc.mjs` | 两个固定 Monad Testnet 只读 RPC，白名单包括 eth_call/receipt/nonce，不得加广播 |
| `t1-intents/t1e-first-issue-readiness.mjs` | 原资金、单 Unit Available / 候选 Voucher、issuer eth_call 只读证明 |
| `t1-intents/t1e-claim-store.mjs` | 隔离持久 Recipient Claim + Verified Consent / Nonce rounds |
| `t1-intents/t1f-issue-operation.mjs` | 只构造原 `issue()` calldata、验证原 Hash/Receipt/Canonical Block/Bucket/账，不签名不发送 |
| `t1-intents/t1f-issue-ledger.mjs` | 原唯一 Issue `reserve()`、`bind()`、`reconcile()` 及事务 CAS、事件审计 |
| `t1-intents/t1f-issuer-http.mjs` | Issuer-only status/prepare/bind/reconcile HTTP 入口 |
| `t1-intents/t1e-claim-http.mjs` / `t1e-claim-server.mjs` / `t1e-claim-entrypoint.mjs` | 同源 Session/CSRF、身份角色、环境开关和云端启动的唯一集成点 |
| `t1-intents/public/t1f-issuer.html`、`t1f-issuer.mjs` | 真实用户自己登录/预留/点击发送/同 Hash 对账的 MetaMask UI |
| `t1-intents/supabase/012_t1f_separate_immutable_issuer_deadline.sql` | 单条追加迁移：独立不可修改 Issue 截止时间，不触碰原 Consent |
| `t1-intents/t1f-issue-ledger.ci.mjs` / `t1f-issuer-http.test.mjs` / `t1f-issuer-page.test.mjs` | 独立 PG17 和 HTTP/钱包界面负测试 |
| `t1-intents/t1f-issuer-live-smoke.mjs` | 实际公网服务两种阶段的无 Session、无链上写入负测试 |

## 3. 公网云端与真实数据库映射（经用户授权 LaoDao）

Render 连接器工作空间 **LaoDao**：`tea-db7q3ou7bikc73bp2bt0`（已获用户明确授权）。

| 独立 Render 服务 | ID | 原则 |
| --- | --- | --- |
| T1-E Claim/未来 T1-F 原始 Issue | `srv-dbdgstivcj2c73fnqcc0` | `https://mealforward-t1e-claim-laodao.onrender.com/`；仅此处允许按受控 Gate 更新源码、模式 |
| T1-E Role Proof | `srv-dbdeuft9fdbs73atbvh0` | 仅 EIP-191 角色身份证明 |
| T1-D 资助服务 | `srv-dbd0nl67bikc73a5grh0` | 原第一笔 Fund 已成功，不重复 |
| T1-C Read-only | `srv-dbclmetg1s2s73dnl5h0` | 完全独立、只读 |

**T1-F 第一道发布门禁已通过**：Render T1-E 仍是 `CLAIM_CONSENT`，已将测试过的 T1-F 代码以上线 staging release Commit `065d0ee5d824dbd0283387462fd0927c70f1aa67`、部署 `dep-dbdk657b9u1s73a00320` 在 **`T1F_ISSUE_WALLET_ENABLED=false`** 下真实 LIVE（Render 日志 `issuerTransactionEnabled:false`, `databaseConnected:true`），新 Issuer 页面及 API 仍关闭；原环境已有 **私有的** T1E 双角色 DB 连接，Agent 不得提取或跨服务复制。

**T1-F 开关 `T1F_ISSUE_WALLET_ENABLED` 默认 `false`**：当 `false` 时不能暴露 Issuer 页面和接口；当 `true` 时必须仍满足 `T1E_DEPLOYMENT_STAGE=CLAIM_CONSENT`、`T1E_CLAIM_WRITES_ENABLED=true`、`T1E_WALLET_TX_ENABLED=false`、`T1E_SETTLEMENT_ENABLED=false`。后两项永远不允许变 true。Render autoDeploy OFF，每次推分支还须显式 trigger deploy。部署之前备份旧 Git commit、保留旧部署可回退。**切换前先证实最新提交、CI、安全网关和实库都合格。**

Supabase 隔离 Staging 项目 **`mealforward-t1-staging` / `ketfrukrcuosrqynnsay`**（ap-southeast-2，PG17）。已应用 001–012 共 **12 条迁移**，最新 `20261023105932 mealforward_t1f_issuer_issue_deadline_immutable_v1`。仅 `mf_t1e_auth_runtime`、`mf_t1e_claim_runtime` 可接 T1-E 独立服务，LOGIN=true、非 superuser、非 BYPASSRLS：Auth 与 Claim 不跨域，Claim 无旧 `mf_t1c` 财务权限；资金/资助角色无新 Claim 权限。Admin secret 禁入服务。

**此文件建立时数据库状态（必须在发券前重新查询）**：

- `mf_t1c.intents`：1 条 `FUNDED` 原订单、已确认 Approve+Fund 两次钱包交易。
- `mf_t1e.recipient_claims`：1 条 Claim，`claim_id=fbab3b22-965d-44e2-b144-d7307b7aa8ea`、`stage=CONSENT_VERIFIED`、`revision=1`，Voucher `0x170f16ef9ea00697bcfad635e33d521159db5e852b8b5499ddf8db819278b605`，Unit 0 / Generation 1；`consent_digest` 和 signature fingerprint 均已保存；`issuer_op_id/issuer_tx_nonce/issuer_issue_deadline/issuer_tx_hash/receipt_block` **全部 NULL**。
- `mf_t1e.consent_rounds`：第一次签署状态 `VERIFIED`；`mf_t1e.claim_events`：`CLAIM_PREPARED` + `CONSENT_VERIFIED` 两条审计。不可更改原记录。
- Auth：真实用户已完成 Recipient 与 Issuer 两种独立 SIWE 登录，证据是各角色独立 DB Session 和用户页面回传；不要把 EIP-191 当作已经上链。
- Supabase Security Advisors：已查无 lints；这不等于正式第三方安全审计。

### 固定 Testnet 公开标识（不是私钥）

- Monad Testnet Chain ID **10143**，链上 StoreEscrow **`0xcf0c8827c8610eeff1ecbd9719e559d805fafe58`**，6 位小数 Test USDC `0x534b2f3a21130d7a60830c2df862319e593943a3`。
- 原 Issuer（自己持有签名权）：`0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3`；原 Recipient（独立 Testnet 钱包）：`0x2539fefe77a5ce4d09d2225c2e8a7517b22b9135`。
- 原 Quote/Donor：`0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952`；原 Owner/Operator/Catalog 等均不同于 Issuer 和 Recipient。原 7 USDC voucherId 如上，不能换币、合约或重计价。
- 任何真实链上操作都必须检查原 StoreEscrow Runtime SHA / Issuer authority / Unit 0 Available / 资金责任、白名单 RPC；不可凭页面余额发交易。

**最近 live 发行入口负测（模式关闭）：**由 GitHub Actions [39945388495](https://github.com/3956ray/MealForward/actions/runs/39945388495) 执行且 PASS，但该 CI 开始时 Render 可能仍处于前一个版本，故不能取代部署后 exact SHA 的外部重跑。此次文档提交会再次触发本分支 CI。

## 4. 唯一 Claim → Issue 状态机及失败恢复

`FUNDED (A)` → 受助者持久申请 `PREPARED` → EIP-712 本人领取授权 `CONSENT_VERIFIED`（**现已完成**）→ Issuer `ISSUE_UNKNOWN`（先记录 **独立 Issuer 交易截止时间**、唯一 Operation ID/Nonce/数据 Hash、从此不能重发）→ `ISSUE_HASH_BOUND`（只能将原链哈希独立比对后绑定）→ `ISSUED`（在 RPC Receipt、唯一 Issued Event、OperationExecuted、原 voucher、Bucket A→R 和链上余额/liability 核查后）→ **再另行设计领取凭证/商家核销**，现绝不操作 Settle。

事务/异常：
- 首次 `POST /v1/t1f/issuer/prepare` 校验 Issuer SIWE/Session CSRF、链上 `eth_getTransactionCount('pending')` 与原链只读证明后，`reserve()` 在同一 SQL 事务内更新唯一 Claim 与追加 `ISSUE_RESERVED` event，COMMIT 后**仅一次**返回 tx。
- 再次 Prepare 时看到 `ISSUE_UNKNOWN`，只返回 recovery-only，不生成第二笔、不返回可重新广播 calldata。
- MetaMask 仅用户显式点击 “本人 MetaMask 发送唯一 Issue” 调用 `eth_sendTransaction`。弹出后清除前端唯一发送载荷；页面退出或钱包拒绝，也只能在 MetaMask Activity 找回原 Hash 与 Nonce，绝不可“重试发券”。HTTP Bind/Reconciling 是读原交易，不创建新链 tx。
- `POST /v1/t1f/issuer/bind` 核对链 ID、from、to、nonce、value=0、calldata hash（不接受仅凭用户填的 Hash）。`reconcile` 用只读 RPC 查 Receipt/canonical block/events/accounting，成功才 CAS 更新 `ISSUED`，失败返回 UNKNOWN/PENDING/REVERTED 无重发。需要数据库交易与事件双重持久化和严格原数据一致。
- 若任何服务接入失败，不得凭感觉撤销已预留 Nonce。对其他后台账户或相同合约重新发券是高风险操作。

## 5. 当前开发 / 发布与验收操作序列

当前目标是**在不触碰历史 CP30、不换钱包和不发任何交易的前提下**完成 T1-F 独立云发布。已完成 step 1–3（含禁用状态部署）；**仍待外部本版本负测及 step 4–6**。下个 Agent 应：

1. GitHub 获取 PR #40 最新 HEAD，审查 `t1f-issuer-http`、SQL012、`t1f-issue-ledger`、钱包 UI、公开负测脚本和当前 Handoff；跑 T1-F GitHub Actions exact-head，严格区分通过的 source/PG/RPC 与未测试的真实人的钱包。
2. 只读 Supabase 检查 012 存在、唯一 Claim 仍 `CONSENT_VERIFIED` 且没有原 Issue Nonce、Hash、审计事件异常；确认最小权限、原 `FUNDED` 单份和安全 Advisor。出现未知已预留就**停止新 Issue**转恢复。
3. T1-E Render 现有服务预先保留旧 Live commit/部署，先部署新代码且 **`T1F_ISSUE_WALLET_ENABLED=false`**，确保 T1-E 原领取页面和私有隔离仍健康。不得动 T1-D/T1-C 服务。
4. 在本次 T1-E Release 通过默认关闭门禁及公网 GET/POST 负测试后，再 **仅**在 T1-E Render 将 `T1F_ISSUE_WALLET_ENABLED=true`，由 Render 自动构建新部署；重复核验 exact source SHA、Live、启动日志、私有 Session 401、Issuer API 未登录 401、跨站 403、旧 settle/fund 405/不可写；再次核对数据库 Claim/资金没有被自动修改。
5. **停在真人 MetaMask Gate**：用户自己打开 `https://mealforward-t1e-claim-laodao.onrender.com/t1f-issuer.html`，Issuer 登录→检查状态→一次性预留→本人检查 MetaMask `issue()` tx→绑定同一原交易→Receipt 核对。不要机器人替用户签或广播。用户可先仅验登录/状态，之后再单独点击预留，**一旦预留不能重新发券**。
6. 用户送回页面的 Claim 状态/公开 Tx Hash 后，只读链/DB 对账，并更新本文；按约每轮开发结束都要更新 root Handoff。

## 6. GitHub CI / 环境安全和调试

- `t1-intents` 依赖 Node 22，`pg@8.16.3`、`ethers@6.15.0`、`viem@2.57.1`；`npm install --ignore-scripts --no-audit --no-fund` 避免 lifecycle hooks。
- 源码单测：在 `t1-intents/` 执行 `node --test t1f-issue-operation.test.mjs t1f-issuer-http.test.mjs t1f-issuer-page.test.mjs`；PG17 集成测试由 `.github/workflows/mealforward-t1f-first-issue.yml` 使用一次性 Docker PostgreSQL:17.11 和**假**凭据，绝不可指向实库。真实 Monad RPC 只读 pre-Issue：`.github/workflows/mealforward-t1f-monad-preissue-readonly.yml`。
- Render 发布前后只读 HTTP 安全检查：`t1-intents/t1f-issuer-live-smoke.mjs`，用环境变量 `T1F_EXPECT_ENABLED=false|true` 显式要求期望模式。**没有 Cookie 或私钥**，只发匿名请求以及必须拒绝的 POST。
- 若 CI 编码/fixture PASS，但真人 MetaMask 未签名、未收到 Hash，**不可写“已链上发券”**。若自有 HTTP 证据超时，仅报告未确认。
- 用精确 HEAD/Release Commit 对齐 Render 部署；`autoDeploy` 关闭，仅在审批后手动 `trigger_deploy`。持续检查 Render 失败事件和日志中的脱敏错误类别，不打印敏感环境。
- 本次还需验证已上线服务的回退手册（恢复到 `d5e0adf5` + `T1F_ISSUE_WALLET_ENABLED=false` 时，保留现有真实 Claim，绝不重放迁移或退回数据库）。

## 7. 强制每轮交接更新规范（永久）

**用户明确要求：每次开发结束后，必须更新根目录这一个 `HANDOFF.md`**，这样任何 Agent 只读 Markdown 即可立即接手开发；见根 `AGENTS.md`。更新时依次完成：最新代码/PR/分支与 SHA、实际部署 commit 和状态、Supabase 迁移/权限/数据只读真相、链上的实际 vs 推测、CI/人工验收精确链接、已知 bug/保留风险、下一步最小执行计划、需要用户亲自做的操作。未验证标明 `PENDING` 或 `NOT_RUN`，禁止拿合成 fixture 充当真人结果。每次开发和部署后再检查并提交 Handoff，向用户说明 GitHub 文件的可打开链接。

优先级：**用户最新明确授权与安全边界 > 当前真源代码 + 真实运行时只读证据 > 本文件最新提交 > 过去交接与聊天摘要**。新的 Agent 不得用旧 `main` 或 `codex/mealforward-integrated-mvp` 猜测 T1-F 当前交易记录。