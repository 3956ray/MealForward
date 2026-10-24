# CP31 / T1-F · 原始 Issue 预留超时恢复设计与安全门禁

> **状态：SOURCE-ONLY DESIGN / PG17 CI PASS；实库 013 未执行；没有任何新链上 Issue；不得据此重新发送原交易。**
>
> 2026-10-24（UTC+8），关联 [Draft PR #41](https://github.com/3956ray/MealForward/pull/41)、[恢复审查 PG17 CI](https://github.com/3956ray/MealForward/actions/runs/40052013889)，单一接手入口是仓库根目录 [HANDOFF.md](../HANDOFF.md)。

## 事故的精确证据，而不是推断

用户确认原 Issuer `0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3` 的 **MetaMask Monad Testnet 活动没有任何交易**。这代表用户本人看到的 Wallet Activity，不是所有节点 mempool 的全局否定证明。

唯一受助者 Claim `fbab3b22-965d-44e2-b144-d7307b7aa8ea`：

- 资金：原 Intent `2b9ae6f1-2bb7-4096-8136-70f30f302eea`，唯一 7 Test USDC `FUNDED`，不得重复转账。
- EIP-712 Consent：已由受助者本人签署，原 nonce/digest/fingerprint 持久化 `CONSENT_VERIFIED`；此时间窗与后续 Issue 不同。
- 第一次 Issue 预留：`stage=ISSUE_UNKNOWN`、`revision=2`、`issuer_op_id=0x2e709dee8113d2dac73cbea53d016d6629fc3730c6f85325a17c98bc4777445b`、`issuer_tx_nonce=0`、`issuer_issue_deadline=1792765625`（2026-10-23 22:27:05 UTC+8）、`issuer_tx_data_hash=0x089cb2b0a35e81f31a9f9a658cd298ad7c9d3376ea01fac6fb77013451e1f0ed`。原 `issuer_tx_hash` 及 Receipt 仍为 NULL。
- 用户曾第二次点击「一次性预留」，Postgres 仍只有 **一条** `ISSUE_RESERVED` 审计。没有新 Claim、没有第二笔资金。
- 最新复核链上证据：[2026-10-24 09:53 UTC+8，Actions 40032638604 attempt 2](https://github.com/3956ray/MealForward/actions/runs/40032638604/attempts/2)，Monad block `73688844`，账户 `latestNonce=0` / `pendingNonce=0`、原 `getOperation` 未执行、原 Unit 0 `Available`，结果 `T1F_EXPIRED_NO_ISSUE_OBSERVED_NOT_ABSENCE_PROOF`。
- **不能把一次公共 RPC 或用户观察当成“绝不可能有未知原交易”**；只读数据未证明所有 mempool 均无缓存交易。源 `issue()` calldata 的截止时间确已过期；旧交易也不可被重新发送。

## 为什么不能把旧 Claim 直接改回 CONSENT_VERIFIED

实库 009 和 012 PostgreSQL 触发器固定 Claim 身份、Consent 和首次 Issuer Operation ID/Nonce/Calldata Hash/Deadline；状态机不允许 `ISSUE_UNKNOWN -> CONSENT_VERIFIED`，不允许 DELETE/TRUNCATE，不允许覆盖原 Issuer op 或原资金账。

直接绕过触发器改表、重置 Nonce、复制 Claim、另建原 Unit 或再次 Fund，会破坏幂等性和审计证据。错误重试需要显式区别：
1. 仅服务器已预留、用户从未点击发送。
2. MetaMask 拒绝/超时，可能存在未知 Hash。
3. 已广播未被单一 RPC 看见。
4. 原交易被确认但失败、Nonce 已占用。
5. 原合约真正已 Issued —— 不能第二次 Issue。

## 第一阶段（本 PR）：只创建 **review-only** 追加证据能力

源码 `t1-intents/supabase/013_t1f_expired_issue_review_only.sql`（**未应用到真实 Supabase**）：

- 在隔离 `mf_t1e` 下拟创建 `expired_issue_reviews`，只能关联当前唯一 Claim，并复制其原 opId、原 Nonce、原 deadline、原 calldata hash。不覆盖 `recipient_claims`。
- 每个 Claim 最多一条 Review；review 自身不可更新、删除或清空。存链上观察区块、区块 Hash、Latest/Pending Nonce、原 Operation / Unit 状态，并明确标记用户的 MetaMask 报告只是自述。
- 所有许可字段强制 `may_create_second_operation=false`、`may_broadcast_transaction=false`、`may_modify_original_claim=false`、`wallet_observation_is_mempool_proof=false`，没有任何新的发券授权。
- **当前 Auth / Claim / Fund 运行角色都没有新表访问或写入权限**；此层没有 HTTP API，也没有新的钱包按钮。
- `t1f-expired-recovery-review.mjs` 是纯函数，将用户自述 + 原 Claim 快照 + Monad 链只读证据分类为“可进入线下安全审查”“原链活动需要调查”或“等待钱包证据”，**所有结果的交易授权都为 false**。

**隔离真实 PG17 验收**：精确重放 009–013 DDL，使用完全合成钱包/Nonce/交易数据测试，覆盖新表 INSERT 权限拒绝、唯一 Claim Review、防篡改触发器、旧 Claim 不变、原单份资助未改变、原事件与 Consent 未删除、0 广播，见 [Actions 40052013889](https://github.com/3956ray/MealForward/actions/runs/40052013889)。真实测试数据库没有执行第 013 条。

## 第二阶段（尚未开发 / 尚未授权）：新的 *attempt*，不是“重新跑首次预留”

若以后取得独立审计批准：

1. 先在两个独立且正确 ChainId 的 Monad RPC 重新检查同一原 Issuer latest/pending Nonce、原 opId、唯一 Unit 0 和余额/liability，核对最新区块 Hash 不重组，并让用户独立确认 MetaMask 无原 Hash/待处理；即使如此，仍必须记录 mempool 无法被绝对证明。
2. 原 `recipient_claims` 不重置：保留 `ISSUE_UNKNOWN`、原 opId、Nonce、Calldata Hash、已过期 Deadline 和唯一 Audit Event。
3. 需另设计 **追加式 `issuer_issue_attempts` 账本**、对一次原 Claim/Unit 的一条新尝试的唯一性约束、独立 Fresh Operation ID + 新截止时间 + 受审计的 Nonce 检查。若公链账户 Nonce 仍为 `0`，说明可能有链上第一个可用 Nonce，但**不能直接沿用旧 calldata/opId，更不能未经审查便自动再次发送**。
4. 在新状态机中，必须明确如何使“新的 attempt 已链上发行”的结果与永久冻结的原 Claim 兼容。不能伪造 `recipient_claims.stage=ISSUED`，也不能让旧原 `issuer_tx_hash` 指向新 calldata 的交易。新 attempt 的 Hash、receipt/canonical block、OperationExecuted、Issued、原 Unit 0 Bucket A→R 和资金 liability 必须独立核实。
5. 拒签、掉线、链重组、Nonce 竞争、未知 pending、并发双击、超过截止时间等负测试必须 **fail closed**。依然由原 Issuer 自己 MetaMask 确认一次，服务器不可持签名密钥或代发。
6. 经过代码独立评审、PostgreSQL17 精确 E2E、公链只读 Gate、部署后的匿名/跨域/角色隔离负测试之后，**再次取得用户对具体 DB 013/014 与真实钱包操作的明确批准**，才可考虑 live 迁移和新 Issuer 测试。

## 明确禁止的动作

- 不重做 Fund、Claim、Recipient Consent，不触碰原 T0 StoreEscrow、不向原 Mac CP30 Journal `PREPARED #3560` 写入数据。
- 不在当前线上 Render 将任何“自动重发”开关打开。商家 Lock/Report/Settle 仍关闭，原 `issue()` 不链上验证 Recipient Consent，原 StoreEscrow 强制 180 秒结算冷却不足的问题仍在。
- 对这条已经过期的第一次 `ISSUE_UNKNOWN`，不可以点击「发送唯一 Issue」，不要从前端再提交同一 calldata 或新钱包 nonce。
- 不要让没有完成独立安全审查的文档、单一 RPC 或 CI 自行放行钱包操作。

**每次开发、CI、部署、真人验收或状态迁移结束，均需同步更新根 `HANDOFF.md`，附精确分支、Commit、部署、迁移、链读和下一步，确保新 Agent 不依赖聊天接手。**
