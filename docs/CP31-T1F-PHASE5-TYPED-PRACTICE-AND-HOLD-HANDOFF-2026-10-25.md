# MealForward / 留膳 · T1-F Phase 5 EIP-712 钱包练习与数据库 HOLD 门禁

> **状态：2026-10-25，源安全修复 PASS，Role Proof 练习页 LIVE；尚待真实 Owner、Donor 两只钱包本人完成新的 EIP-712 PRACTICE 签名。**
>
> 最优先完整交接入口：仓库根目录 [HANDOFF.md](../HANDOFF.md)。开发分支 [Draft PR #45](https://github.com/3956ray/MealForward/pull/45)，关联旧阶段 PR #44、#43、#42、#41、#40、#38。真正恢复 Issue 仍然冻结。

## 1. 数据库 015 安全问题与最终修复

发现 015 原来的 `successor_issue_releases` 唯一允许状态为 `HUMAN_REVIEW_HOLD`、`may_release_to_wallet=false`，但 `successor_operation_guard()` 未校验 HOLD，即使尚未授权，也可能由未来误授予写权限的服务创建后续 Issue 行。

**修复后的 015（仅源码、从未应用真实 Supabase）** 在创建 `successor_issue_operations` 的 INSERT Trigger 中要求：
- 独立 Release 必须是 **`RELEASED_FOR_ONE_ISSUE`**，且 `may_release_to_wallet=true`；
- 当前 015 的 CHECK 只能保存 `HUMAN_REVIEW_HOLD` / `false`，因此 015 无论拥有何种应用写权限，都**不可能发起后续 Issue**；
- 若以后实现真正恢复，必须经独立的 016+ 迁移、受审查的权限/双签授权流程后再改变这个模型。绝不能在 015 就修改旧 Claim/Nonce/Deadline/TxHash。
- 源 `t1f-successor-issuer-ledger.mjs` 同样在发放 MetaMask 交易之前检查 Release 的真实状态，并在 HOLD 下回滚，不向钱包返回可发交易。

**真实测试：** [Actions #40205800527](https://github.com/3956ray/MealForward/actions/runs/40205800527) — 一次性 PG17 在 127.0.0.1:5439 运行 009–015，使用 synthetic 管理员尝试插入后续 Operation 也失败，`T1F_SOURCE_ONLY_PG17_HOLD_DENIES_SUCCESSOR_INSERT_PASS`；`successorOperationRows=0`、`successorAuditRows=0`、原 Claim/Consent/Fund 完全不变。后来 Phase5 完整源代码 CI [#40207373725](https://github.com/3956ray/MealForward/actions/runs/40207373725) 继续 PASS。

**目前实时 Supabase** 项目 `ketfrukrcuosrqynnsay` 仍然只应用至 012：013 `expired_issue_reviews`、014 `issuer_issue_attempts`、015 `successor_issue_releases` 均不存在；唯一原资助 `FUNDED=1`，唯一 Claim `ISSUE_UNKNOWN=1`、原 `ISSUE_RESERVED=1`。原 Claim ID `fbab3b22-965d-44e2-b144-d7307b7aa8ea`，最初 Issuer Nonce `0`，过期截止 `1792765625`，无原 TxHash。Supabase Security Advisor 无 lints。**本阶段没有 DB 写入/迁移。**

## 2. 为什么 Phase 5 签名只能用于钱包练习

此前 Owner/Donor 两只原始 EOA 均在 Phase 4 真人验证通过 EIP-191 SIWE Control Proof，结果已记入根 `HANDOFF.md`。下一阶段的结构化 EIP-712 使用与真实 Recovery **完全不同的域与类型**：

| 字段 | Phase 5 EIP-712 练习 | 正式 Recovery Release（尚未开放） |
| --- | --- | --- |
| Domain Name | `MealForward Phase5 Typed Wallet Practice` | `MealForward T1F Recovery` |
| Version | `0` | `1` |
| Primary Type | `PracticeControl` | `SuccessorIssueRelease` |
| 目的 | 验证 MetaMask 结构化签名兼容性 | 未来由安全审查后的服务单独发起恢复批准 |
| 链上资金能力 | 无 | 正式恢复阶段仍需另获人类许可和 Issuer 确认 |

服务每次只为固定 Owner `0xc4f8a468f10d5f98dcff3282516125e97f26433b` 或固定 Donor `0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952` 生成唯一 32-byte nonce、UUID 和 120 秒有效的挑战，绑定 Monad ChainID 10143、原 StoreEscrow、角色及 `PRACTICE ONLY - NO RECOVERY RELEASE, NO ISSUE, NO FUNDS`。用 EIP-712 恢复地址校验签名者后立刻销毁挑战；错签/重复/超时拒绝，不保存签名、Session、Cookie 或 DB 状态。严格限制错账户、跨来源、非法 URL 钱包注入、频率；网页只有显式本人点击才调用 MetaMask `eth_signTypedData_v4`，没有任何资金转账或链上广播方法。

## 3. 真正的上线版本与 CI

- 主开发：`codex/mealforward-t1f-phase5-release-hold-hardening-20261025`，[PR #45](https://github.com/3956ray/MealForward/pull/45)。此分支包含 015 安全修复、PG17 测试、Phase5 typed practice 服务/网页、HTTP+MetaMask 模拟测试和完整外部 HTTPS gate。
- **实际 Render 发布只 cherry-pick 无 DB 文件**：发布分支 `codex/mealforward-t1e-issuer-original-tx-verifier-20261023`，应用 Commit **`7a5ee5e1f9d796e743f6b128e856f86473a2e856`**。Role Proof 服务 `srv-dbdeuft9fdbs73atbvh0`、LaoDao `tea-db7q3ou7bikc73bp2bt0`、公网址 https://mealforward-t1e-role-proof-laodao.onrender.com/t1f-phase5.html ，正式 `T1F_PHASE5_TYPED_PRACTICE_ENABLED=true`，**Live Deploy `dep-dbf2125g1s2s73e6r1u0`**。先关闭模式部署 `dep-dbf204m7bikc73bt2o8g` 已通过，随后单独开启。原 Phase 4 仍保持开启。回退代码参考 `codex/mealforward-roleproof-before-phase5-20261025`（备份时 HEAD `49fdcd99af2d39ea726cf8f7c9dd111b53351a88`）。
- 关键代码：`t1-intents/t1f-phase5-typed-practice.mjs`、`t1-intents/public/t1f-phase5.html`、`t1-intents/public/t1f-phase5.mjs`、`t1-intents/t1e-role-proof-server.mjs`、`t1-intents/t1f-phase5-typed-practice.test.mjs`、`t1-intents/t1f-phase5-live-smoke.mjs` 和 Phase5/Phase4 CI。发布分支 **没有** PR #45 的 SQL 015、后端新发券或存储读写权限。
- **开启后真实公网测试**：[Actions #40207354606](https://github.com/3956ray/MealForward/actions/runs/40207354606) **PASS**，`T1F_PHASE5_TYPED_PRACTICE_PUBLIC_NEGATIVE_PASS`，21 次实际 HTTPS 请求，`dbWrites=0`、`onchainTransactions=0`、`recoveryApproved=false`。检查权限、无 Session、安全 CSP、正确的练习签名域、旧 Phase4 兼容与非法查询参数拒绝。
- **Source CI**：[Actions #40207373717](https://github.com/3956ray/MealForward/actions/runs/40207373717) **PASS**，包括 Owner/Donor synthetic EIP-712 正例、伪造、跨域、过期、角色错误、重放、错误 Chain ID 和严格签名域隔离；[旧原 EIP-191 兼容](https://github.com/3956ray/MealForward/actions/runs/40207354573) PASS。以上不是两位真人签名结果。
- 原有 Claim/Issuer RoleProof 无退化：[Actions #40207354550](https://github.com/3956ray/MealForward/actions/runs/40207354550) PASS、RoleProof 在 Render 启动 `T1E_ROLE_PROOF_ONLY_READY`、`noFinancialWrites=true`、`noDatabaseConnected=true`。真实 Claim 服务 `srv-dbdgstivcj2c73fnqcc0` 仍为旧 Live `dep-dbdto63rjlhs738br1sg` @ `c8723c2f280e4b72ff067e0be08f5bf1c4a15412`，本阶段未触碰。

## 4. 现在停下，用户必须亲自测试

1. 用 MetaMask 打开 **https://mealforward-t1e-role-proof-laodao.onrender.com/t1f-phase5.html**，请核对页面反复显示 **PRACTICE ONLY / NO RECOVERY RELEASE / NO ISSUE**，网络 Monad Testnet **10143**。
2. 使用原 Owner 钱包 `0xc4f8a468f10d5f98dcff3282516125e97f26433b`，选择账户，点击 `本人 EIP-712 练习签名`。钱包弹窗里必须见到本阶段练习域名称 `MealForward Phase5 Typed Wallet Practice`、version0、类型 `PracticeControl`，并确认只练习、不授权发券。预期 `PASS · OWNER EIP-712 练习签名验证成功`。
3. 切换原 Donor `0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952`，重复练习签名，预期 `PASS · DONOR EIP-712 练习签名验证成功`，汇总 `2/2 PASS`。
4. 用户只需要回复两个 PASS 的页面脱敏结果和是否有钱包切换/签名错误。**不得回传原始签名、Cookie、私钥、助记词或密码**。若弹窗显示任何真正 Recovery Release 的签名域，停止签名并告知 Agent；本阶段不应该出现它。
5. 此测试成功后**仍不能放行 Issue**。实际恢复签名必须另外取得用户明确同意后、经 016+ 授权状态/最小权限 DB 独立审查，并按唯一新 Issuer 交易、人类确认、链上 Receipt 逐项验收。旧过期 `ISSUE_UNKNOWN` 记录永久保留；商家 Settle 被 #17 问题阻塞，不允许启用。

## 5. 回退与接手规范

发现任意安全异常先在 **Role Proof 这一个** Render 服务将 `T1F_PHASE5_TYPED_PRACTICE_ENABLED=false`；确认自动重部署、Phase5 URL 不再开放、原 Phase4 仍 PASS，保留原 Release branch 快照。不修改 Supabase、不清空原数据库或 Claim、不重放任何链上交易。请勿混淆用户的 Phase4 EIP-191 既有两次 PASS 与下一次 Phase5 EIP-712 PRACTICE 新验收。

**用户永久规则：每轮开发、迁移、部署、回滚或真人验收结束，先更新项目根目录 `HANDOFF.md`，记录准确最新 GitHub/Render/Supabase/Monad/CI、人类已通过与未完成测试，再报告完成。**
