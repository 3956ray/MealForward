# CP31 / T1-F Phase 3 · 双人授权的唯一继任 Issue（源码开发交接）

> **发布状态：SOURCE-ONLY / Draft PR #43；009–015 一次性 PostgreSQL 17 CI PASS；真实 Supabase 只有 001–012；013/014/015 尚未上线；Render 无此功能；没有真实 MetaMask 签名和链上 Issue。**
>
> 更新：2026-10-24（UTC+8）。根目录 [HANDOFF.md](../HANDOFF.md) 是每位新 Agent 的第一接手入口；本文件解释 Phase 3 的关键实现、安全模型和后续审批。

## 背景与不能破坏的真相

原 Donor 使用 7 Test USDC 在 Monad Testnet 10143 资助单份暖心盖饭，原 Intent `2b9ae6f1-2bb7-4096-8136-70f30f302eea` 为唯一 `FUNDED`。Recipient 已完成唯一 `CONSENT_VERIFIED`。原 `recipient_claims` 的唯一 Claim `fbab3b22-965d-44e2-b144-d7307b7aa8ea` 因过期 Issue 预留处于 `ISSUE_UNKNOWN`、`revision=2`，保存了不可变原 opId `0x2e709dee8113d2dac73cbea53d016d6629fc3730c6f85325a17c98bc4777445b`、Nonce `0`、截止时间 2026-10-23 22:27:05 UTC+8 和原 calldata Hash `0x089cb2b0a35e81f31a9f9a658cd298ad7c9d3376ea01fac6fb77013451e1f0ed`。原 TxHash 仍 NULL；用户报告原 Issuer 的 Monad Testnet MetaMask Activity 无交易，公共链只读检查未观察到执行，仍不能证明全网 mempool 没有未知交易。

**本 Phase 3 不能改写旧 Claim、原 opId、Nonce、hash、Consent、fund 或原审计事件，也不能仅通过普通 Issuer SIWE 登录批准第二次发券。**

## GitHub 开发路径

Repo：`3956ray/MealForward`。[Draft PR #43](https://github.com/3956ray/MealForward/pull/43) 分支 `codex/mealforward-t1f-phase3-dual-approved-issue-20261024`，base [PR #42](https://github.com/3956ray/MealForward/pull/42)，其前置 [PR #41](https://github.com/3956ray/MealForward/pull/41)。这些 PR 均为草案，没有自动合并 `main` 或部署到 Render。

主要源码：

| 文件 | 功能 |
| --- | --- |
| `t1-intents/supabase/015_t1f_dual_release_successor_issue.sql` | **仅源码** 015：独立双签 Release、唯一 successor operation、独立自动追加审计事件、不可变状态机 |
| `t1-intents/t1f-successor-dual-approval.mjs` | EIP-712 Owner + Donor 双钱包专属签名验证、签名指纹和 Release typed digest |
| `t1-intents/t1f-successor-dual-approval.test.mjs` | 合成 EOA 对照测试、签名错配、顺序交换、跨链/Nonce/Op/时效更改拒绝 |
| `t1-intents/t1f-successor-issuer-ledger.mjs` | **未接公网路由**的源码：链只读预检、Slot 行锁、双签验真、独立后续 Attempt 原子预留、Hash 绑定、Receipt 校验、原 Claim 只读 |
| `t1-intents/t1f-successor-issuer-ledger.test.mjs` | 非 Issuer 角色拒绝、已预留重进恢复而非重发、原身份篡改拒绝 |
| `t1-intents/t1f-successor-phase3.ci.mjs` | 一次性 PG17 009–015 完整迁移、Release/Attempt 创建、CAS、自动审计和权限验证 |
| `.github/workflows/mealforward-t1f-phase3-015.yml` | GitHub Node22、一次性 Docker PG17 且仅回环端口5439，禁止服务端广播 |

## 威胁模型和双审批的含义

新增 Phase 3 Release 与普通钱包 SIWE 分离：

- 原 **Owner** 固定 `0xc4f8a468f10d5f98dcff3282516125e97f26433b`。
- 原 **Donor / Quote** 固定 `0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952`。
- 原链上 **Issuer** 固定 `0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3`，它只负责未来由人亲自签的链上 `issue()`，**不能取代 Owner + Donor 的恢复批准**。

EIP-712 域为 `MealForward T1F Recovery` / version1 / chainId10143 / verifyingContract 原 StoreEscrow。签名必须绑定同一个 Claim、Review、Slot、Voucher ID、首次 immutable op/nonce/deadline/calldataHash、不同的新 opId、新 nonce、新 deadline、独立 approval nonce、原链观察 block/Hash 和短时 approval expiry。每次预留前以链只读重新核查；两次本人签名必须验出固定 Owner/Donor EOA，且不同于 Issuer。

**非常重要：PostgreSQL 不会自行执行 secp256k1 EIP-712 验签。** `successor_issue_releases` 表存 digest 和两个签名 Fingerprint，只能作为“某个受审查服务已验签”之证据，不能当作密码学自证明。因此 015 **没有给任何运行角色 INSERT/UPDATE/SELECT 许可**，也没有发券 HTTP 入口，实际 Release 必须在未来独立审核的授权服务中验真后再显式开通。数据库管理员合谋或绕过触发器的系统级信任风险仍存在；这不是完全去信任方案。

## 015 双账本与约束

此前 013 `expired_issue_reviews`（仅审查）、014 `issuer_issue_attempts`（永久 `REVIEW_HOLD` Slot）保持完全不可变，015 添加两个全新而不是修改它们：

1. `successor_issue_releases`：每 Claim / Slot / Review 最多一个独立 Release，候选新 op / nonce / 120–600 秒 deadline、90–300 秒审批有效期、两个不同角色的钱包地址、审批 digest 和签名指纹均不可变。无运行角色 INSERT 或更改权限，审核字段默认 `HUMAN_REVIEW_HOLD`；**插入记录不自动开钱包**。
2. `successor_issue_operations`：每 Claim / Slot / Release 最多一个独立链交易。状态机 `ISSUE_UNKNOWN → ISSUE_HASH_BOUND → ISSUED` 或非 ISSUED 状态转终止 `BLOCKED`。一旦 COMMIT 原 op/nonce/deadline/calldataHash 不可变；绑定后 Hash 不能替换；只有 Receipt、Canonical Block、原 Voucher Event、7 Test USDC 托管账一致，才能独立标记 `ISSUED`。原 `recipient_claims.stage` **仍是 `ISSUE_UNKNOWN`，不能据新 attempt 成功伪造旧 TxHash**。
3. `successor_issue_events`：数据库触发器为首次预留、Hash 绑定、Receipt 确认及终止自动追加事件，禁止 UPDATE/DELETE/TRUNCATE。与原 `mf_t1e.claim_events` 分离。

源 `makeSuccessorIssuerLedger().reserve()` 的设计是在同一 PostgreSQL 事务内锁定 014 Slot、验证完整 EIP-712 双批准及新 Monad nonce/candidate Hash，INSERT Release + 新 Operation，**COMMIT 后才返回唯一一次由人确认的 wallet transaction**。重复请求必须返回 `created:false,recoveryOnly:true`，不返回交易字节。后端没有私钥，也不调用链写 RPC。

现阶段没有给此源码任何实际 PG 权限，也没有连接 Render 路由；源代码出现一个 future wallet transaction DTO **不意味着**用户目前可以发送。旧 T1-F 页发出原截止日期已过期的交易始终被禁止。

## 验收与时间模拟的限定

[GitHub Actions 40062881172](https://github.com/3956ray/MealForward/actions/runs/40062881172) 为本阶段初步核验；**最终 exact HEAD 需重新看本 PR 最新 Actions**。Node 测试用 CI 临时的非真实 EOA 生成 EIP-712 双签名，并确认合成签名不可能冒充固定 Owner/Donor；并不是说已经得到真人批准。

Docker 只启动 `127.0.0.1:5439` 的全新 PostgreSQL17，脚本明确同时要求多个一次性 CI 环境标志和该固定回环 DSN。准确执行旧 009–014 迁移后，在**该 disposable fixture 中**暂时禁用原数据库的两个不可变 Trigger，以模拟原 Issue 截止已过去数小时，然后立即全部开启原 Trigger 并检查 `tgenabled='O'`，才执行生产同款 013–015 逻辑。**这是 CI 对时间流逝的合成模拟，绝不能在真实 Supabase 复制此做法、关闭任何触发器或重写原截止时间**。测试中签名指纹是固定假样例，SQL 单独验证唯一性、CAS、事件和权限，不能宣称“真实双签名进入数据库已完成”。

SQL Test 验证误跳状态、Nonce/Deadline/Op/Hash 篡改、Hash 第二次绑定、重复 Release/Attempt、越权运行角色、DELETE/TRUNCATE，以及 original Claim/Consent/Fund 永远不变；自动 Audit 应有 3 条事件 `ISSUE_RESERVED,ISSUE_HASH_BOUND,ISSUED_CONFIRMED`。正例 Receipt 和签名均为**模拟**，不能将 CI 当作链上 Issued。

## 上线前未解决事项和下一步

1. 先做 PR #41/#42/#43 独立安全审查；确认系统可信/恶意平台威胁模型下谁真正控制 Owner、Donor/Quote、Issuer 三个私钥，是否能独立地批准。双签名只在原钱包独立可信时有效，仍防不住合谋或 DB 超级管理员。
2. **新授权服务及独立数据库角色尚未开发和激活**。未来必须在新的单独迁移中授予极小权限并完成两真人 EIP-712 签名、登录 Origin/Nonce/CSRF/Replay/Approval expiry 校验，永不借用 T1-E Claim 旧 Runtime writer。013/014/015 没有实库迁移，目前不能联调真人新 Issue。
3. 开发页面/接口时需分两段：先只读 Approval/签名验真，随后原 Issuer 单次 MetaMask `issue()`。真正发券应在**最新链只读预检**后生成短时签名窗口和不可变 op/nonce，并始终禁止二次发送。审批两钱包与 Issuer 钱包应各自独立。
4. 补独立网络环境集成验收：两个可验证的 Monad RPC、latest/pending nonce 差异、区块 Reorg、Receipt 回滚和只读再对账；软件钱包 Pending 不等于全网 mempool 缺失证明。
5. 交易最终成功时，新的 Receipt 状态只能写 015 独立 Successor 数据投影；将来 Recipient `My Meals` 显示时须同时引用“旧预留已过期”和“新 Issuer Attempt 已确认”，不能误显示商家已交餐。
6. 原合约未链上强制 Recipient Consent，180 秒 Settlement Cooldown Issue #17 仍有缺口；**商家 Lock/Report/Settle 永远不能因新 Issue 自动放行**。
7. 完成上述源测试和公网 401/403/Fund/Settle 负测后，才能另行请用户批准真实 Supabase 013/014/015、任何角色 LOGIN、更改 Render 环境及新链上交易。用户“继续开发”不等于授权新的真实签名或资金流动作。

本阶段**未触碰**真实 Supabase、Render、Testnet 钱包、旧 CP30 Journal `PREPARED #3560`。每轮开发结束后必须更新仓库根目录 `HANDOFF.md`，让任何 Agent 可从那里完整接手。
