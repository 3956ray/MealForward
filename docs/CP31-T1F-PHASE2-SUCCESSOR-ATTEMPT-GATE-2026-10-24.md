# CP31 / T1-F Phase 2 — 独立 Issue Attempt 的安全设计与交接门槛

> 状态：**SOURCE-ONLY · REVIEW_HOLD · 009–014 disposable PG17 PASS**。关联 [Draft PR #42](https://github.com/3956ray/MealForward/pull/42)，基于 [PR #41](https://github.com/3956ray/MealForward/pull/41)。**真实 Supabase 仅到 012；013 / 014 没有执行；Render 没有本阶段部署；新 Issue 未获发送钱包许可。**

更新：2026-10-24（北京时间）。整个项目最新接手入口是根目录 [HANDOFF.md](../HANDOFF.md)；本文件提供 Phase 2 技术细节。

## 1. 为什么不能重用旧 Claim / 同一个 Issue Operation

原唯一的 7 Test USDC 已经 Fund，Recipient 已在私人 Supabase 里签过 EIP-712 Consent。Issuer 本人在 2026-10-23 第一次永久预留 `ISSUE_UNKNOWN`，直到 22:27:05 截止时间过去未被观察到链上执行，且两次点击「预留」只保留了一条原始 Operation/Nonce/事件。用户在 2026-10-24 表示原 Issuer 的 MetaMask 活动中看不到 Monad Testnet 交易。

最新本阶段接手时实时 Supabase 仅有 1 `FUNDED`、1 Claim `ISSUE_UNKNOWN`（`revision=2`）、1 `ISSUE_RESERVED` event，原 issuer nonce `0`、opId `0x2e709dee8113d2dac73cbea53d016d6629fc3730c6f85325a17c98bc4777445b`、截止时间 `1792765625`、calldata hash `0x089cb2b0a35e81f31a9f9a658cd298ad7c9d3376ea01fac6fb77013451e1f0ed`，TX Hash / Receipt 为空。旧 CP30 日志 `PREPARED #3560` 与此独立，不得触碰。

[最近一组真实 Monad 只读证据（PR41 Phase1）](https://github.com/3956ray/MealForward/actions/runs/40032638604/attempts/2)：原 Issuer latest / pending nonce 均 `0`、原 Operation 没有执行、Unit 0 Available；**这是观察到的链状态而非“证明全球 mempool 没有 pending tx”**。所有恢复须先持续独立只读核验同一账户、合约、Unit、区块与资金负债。

## 2. 方案：原 Claim 不变，附加一条继任 slot

`013_t1f_expired_issue_review_only.sql`：仅构建**不可修改的审查证据**，每个 Claim 最多 1 份；人工 MetaMask 报告明确标记为非链上证明；没有新发券权限。

`014_t1f_successor_attempt_review_hold.sql`（本 PR 新增，真实库未执行）在相同私有 `mf_t1e` schema 新建 `issuer_issue_attempts`：

| 约束 | 确切含义 |
| --- | --- |
| 一条原 Claim → 一个 `review_id` → 最多一个继任 `attempt_id` | `claim_id`、`review_id` UNIQUE / FK，`attempt_sequence=2` |
| `stage='REVIEW_HOLD'`（014 中唯一允许状态） | **不**代表授权、创建交易、已发行或已确认 |
| 原始 Issuer op/nonce/deadline/calldataHash 快照 | Insert 触发器与 **原 Claim 永久记录**及 013 Review 严格逐字段绑定 |
| 继任 op、Nonce、截止时间、calldataHash、txHash、Receipt、Release ID | **全部必须 NULL**，直到另一个经过审批的独立 migration |
| 所有 `may_* ` 权限位 | `false`，无法开启钱包、后端广播、标记 Issued 或改写原 Claim |
| 运行角色权限 | T1-E Auth、T1-E Claim、T1-D/T1-C 服务 **无读写权限**；也没有任何新的公网 HTTP 路由 |
| Undo / Update / Delete / TRUNCATE | 触发器拒绝，原 Claim 的 `ISSUE_UNKNOWN`、Recipient Consent、原 Fund/事件始终保留 |

该表是**审批槽位**，不是可发送的 Issue Attempt。后续如果新增 015 必须另外审计状态/权限迁移，且禁止先把一个很快会过期的预览 Nonce 或截止时间持久化为可发送交易。

## 3. 纯粹非交易的 Candidate 预览与将来 Receipt 投影

`t1-intents/t1f-successor-issue-protocol.mjs` 包含：

- `previewSuccessorIssue()` 验证真实**原始 Claim**、013 Review、014 `REVIEW_HOLD` Slot、独立钱包自述/Monad 只读状态、Nonce 对照、不同于原始 opId 的新 Operation ID，以及基于审计调用时间的 120–600 秒候选截止窗口。用当前 ABI 计算 `issue()` 的 **calldata hash**，只返回 `T1F_SUCCESSOR_DESIGN_PREVIEW_NO_RELEASE` 与散列。**不返回完整 calldata/交易对象、不能写数据库、不能发起 MetaMask。**
- `verifySuccessorReceiptReadOnly()` 只能在**未来独立批准**、并持久化出 `ISSUE_HASH_BOUND` 且带非空 `security_release_id` 的后续 Attempt 后被调用；013+014 的真实表无法产生这种状态。它临时构造后续 Attempt 的只读投影，并复用 T1-F 已有的强制链 ID、from/to、nonce、calldataHash、canonical block、Issued/OperationExecuted、原 Voucher 与 7 Test USDC liability 验证。结果独立于旧 `recipient_claims.stage`，**绝不把原 Claim 或原 TxHash 偷改成第二笔**。
- 源代码不含数据库写调用、私钥、后台广播或钱包 UI。Receipt 校验并不等于允许 Settle，仍必须关闭商家核销/结算及遵守 T0 原 180 秒强制冷却安全缺口。

## 4. 独立验收证据

[GitHub Actions 40054537423](https://github.com/3956ray/MealForward/actions/runs/40054537423)：两项 job 均 PASS。

- Node 22 单测覆盖：同 Voucher 新 opId 模拟预览、新 Hash/新短时截止、原 opId/nonce 复用拒绝、跨身份与 Review 改写拒绝、链上有活动拒绝、候选过期拒绝；合成链上 Receipt 的严格独立校验，错误 signer/nonce/calldata/reorg/事件失败，Receipt pending 不重发。
- 新的 PostgreSQL 17.11 环境监听仅 `127.0.0.1:5438`，完全是 CI 的一次性 DB，使用固定**虚构**凭据。准确执行 **009–014** SQL；测试无权限运行角色、唯一后续 slot、候选字段均空、原 Claim/Nonce/Fund/事件未改变、两次创建被拒绝、UPDATE/DELETE/TRUNCATE 被拒绝。审计输出 `T1F_SUCCESSOR_PHASE2_014_DISPOSABLE_REVIEW_HOLD_PASS`、`newOperationIdsCreated=0`、`newIssueAllowed=false`。
- 上述 Receipt 正例是**合成 RPC**，不代表曾在 Monad Testnet 上执行后续真实 Issue。用户钱包/MetaMask 没有在这一步签署任何东西。

## 5. Phase 3/015 必须单独批准的发布规范

下一阶段的实现尚**未获准写入真实数据库或执行真实链交易**。建议前置门槛如下：

1. 两个独立正确的 Monad RPC 重新核验链 ID、原 StoreEscrow bytecode/issuer authority、原 Operation、原 Unit A、Voucher generation 1、token liability、latest+pending nonce及最新区块哈希，并人工再核对原 MetaMask Activity。记录无法全局证明 mempool 无 pending 的限制。
2. 独立安全审阅 013/014 的快照、私有角色权限、T1-E 发券实现、链下 EIP-712 Consent 的范围（链上合约不强制检查受助者签名）。
3. 设计独立 `015`，定义唯一 Phase 3 安全 Release 证据、最小授权的继任 Attempt 提交接口、原子写入新 opId/nonce/fresh deadline/calldataHash（一次性）、Hash 恢复与超时 UNKNOWN，只由原 Issuer **显式** MetaMask 确认一笔交易；绝不可重发老 op 或偷偷沿用老 deadline。
4. 将继任 Receipt 的确认权威投影接入 Recipient `My Meals` 时，必须区分 `Original Claim=ISSUE_UNKNOWN` 和 `Successor Issue=ISSUED`，杜绝重复发券/错误的已发券/可结算显示。**Settlement 严禁随该迁移开放。**
5. 负测包括 nonce 竞争、双击、钱包拒绝、Hash 丢失、重组、超时、反向改写角色、过期旧 Tx 混入；对每种 UNKNOWN 都只查原操作，不补发。
6. 准备独立 Code Review、PG17 精确 migration+E2E、真实 HTTPS 未认证/CSRF/跨域 Gate、钱包人工验收步骤、回退手册。最后**请求用户明确批准具体 013/014/015 live 安装和钱包签名**，不是“已经授权继续开发”就自动启用。

**本 PR 不向当前 [Render T1-E/T1-F Claim staging](https://mealforward-t1e-claim-laodao.onrender.com/) 推任何 Source 或环境变更。原 `ISSUE_UNKNOWN` 唯一预留保持不变。**
