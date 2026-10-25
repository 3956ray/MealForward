# MealForward（留膳）— Agent 一读即接手 · HANDOFF

> **本文件是当前项目唯一的高优先级跨 Agent 接手入口。** 从仓库根目录打开 `HANDOFF.md`，先核对实时 GitHub / Render / Supabase，再继续任何开发。此文件随每次开发、迁移、部署和用户验收更新。历史 `docs/agent-handoff-2026-10-16/` 与原 CP30 合同不得当作 2026-10-23 的实时云状态。
>
> **更新日期：2026-10-25（UTC+8）**。状态在新提交和链上交易后可能变化；引用的是当时已实际查到的资源，不能把未来状态当真。
>
> **当前最高优先级门槛：真实用户已预留唯一 T1-F Issue，Claim=ISSUE_UNKNOWN。必须核对链上原交易/过期/恢复，不得重新预留或自动重发。** 详见本文件 22:24 的 CRITICAL LIVE STATE。

## 2026-10-25 22:48（UTC+8）人类验收更新：Owner + Donor Phase 4 两项 SIWE 控制证明 PASS

**当前最新人工事实**：用户在正式 Phase 4 [Owner／Donor 钱包控制证明](https://mealforward-t1e-role-proof-laodao.onrender.com/t1f-phase4.html) 页面完成了两次真实 EIP-191 SIWE 格式 `personal_sign`，并回传以下**脱敏验收文字**：
- `PASS · OWNER 钱包控制权已验证 0xc4f8a468f10d5f98dcff3282516125e97f26433b`
- `PASS · DONOR 钱包控制权已验证 0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952`

这是**用户实时页面验收的陈述**，不是原始签名、服务器 Session 或数据库中的永久可重放密码学证据。此 Role Proof 服务设计为无 DB、无 Session 的一次性挑战，因此不能在后端用旧 Session 判断 Owner／Donor 今后已经批准恢复。两次 EIP-191 证明**不等于** Phase 3 EIP-712 `SuccessorIssueRelease` 的 Owner + Donor 真实批准，不能自动放行下一次 Issue、开启新数据库角色或 Settlement。

### 本轮核对的可复核真相

- 代码分支：[Draft PR #44](https://github.com/3956ray/MealForward/pull/44)，`codex/mealforward-t1f-phase4-owner-donor-proof-20261025`，验收前 HEAD `91a314a320b6ffb91f8ebd697a24cc7e2d5f481e`；独立 Role Proof 发布分支 `codex/mealforward-t1e-issuer-original-tx-verifier-20261023` 验收前 HEAD `63e776eb4c2b9101626c538147913852bc5ff9f2`。本 `HANDOFF.md` 的提交会令 HEAD 变化，**新 Agent 必须取实时最新 SHA，不能混淆源码 HEAD 与 Render 部署提交**。
- Render LaoDao 工作区 `tea-db7q3ou7bikc73bp2bt0`，Role Proof 服务 `srv-dbdeuft9fdbs73atbvh0`，URL 同上，实际 **Live Deploy `dep-dbf0ti9srm7s73bcm5j0`**，正在运行的代码 Commit **`c382884c0a22413acded671d2e2f292e7bd63aec`**。配置 `T1F_PHASE4_PROOF_ENABLED=true`，原 `ROLE_PROOF_ONLY` 启动日志显示 `noDatabaseConnected=true`、`noFinancialWrites=true`。无 EIP-712 恢复批准路由、无新 Issue、无资金转账或结算。
- 最新 exact-head Phase4 GitHub CI：[匿名公网负测 40202257853](https://github.com/3956ray/MealForward/actions/runs/40202257853) **PASS**、[钱包证明与老角色回归 40202257819](https://github.com/3956ray/MealForward/actions/runs/40202257819) **PASS**；真实公网签名并非在 CI 内完成。旧 T1-E Issuer/Recipient 公网兼容也通过。此时无需再次部署或要求用户重签两次 EIP-191。
- 实库只读复核：Supabase `ketfrukrcuosrqynnsay`，1 条原 `FUNDED` Intent、1 条 Claim、仅 1 条首次 `ISSUE_RESERVED` 审计，**013/014/015 三张恢复表均未安装**。既有 Claim `fbab3b22-965d-44e2-b144-d7307b7aa8ea` 仍应按冻结 `ISSUE_UNKNOWN` 对待；本轮针对完整 Claim 明细的只读工具查询遇到安全检查拒绝，因此不声称该查询已重新成功，之前最后确认细节为 revision2、原 nonce0、过期 deadline1792765625、无 Tx Hash。Supabase advisor 0 lints。没有改写 DB，也没有任何新交易。
- 另一个受资金保护的 Claim 服务 `srv-dbdgstivcj2c73fnqcc0` 仍为 Live `dep-dbdto63rjlhs738br1sg`，应用 Commit `c8723c2f280e4b72ff067e0be08f5bf1c4a15412`；Phase4 真人验收未涉及该服务、原 StoreEscrow、旧 Mac CP30 Journal `PREPARED #3560` 或原受助者 Consent。

### 下一位 Agent 必须继续完成的工程（用户尚未批准真实恢复动作）

1. **安全审阅 PR #41（013 immutable review）、PR #42（014 `REVIEW_HOLD`）、PR #43（015 Owner+Donor EIP712 / 继任链上 Issue）及 PR #44（两钱包 EIP191 证明）。** 检查恢复批准的原角色签名与新 Operation ID/Nonce/Deadline 的原子一致性、公共 RPC 并非全网 pending 证明、签名时效、DB 超级管理员与平台合谋风险。
2. 在**隔离分支和一次性 PG17** 设计真正的 EIP-712 双批准授权服务及最小权限单独 DB 角色、CSRF/origin/nonce/expiry/replay 与断线恢复，不得借用旧 `mf_t1e_claim_runtime`、让 Role Proof 服务器保存资金/DB secrets，或由后端自动广播 `issue()`。
3. 未经下一次用户**对具体 Supabase 013/014/015（及任何后续权限迁移）与真实 Owner/Donor EIP712 签名、Issuer 发券分别确认**，绝不能应用实库迁移、开放恢复写入、产生新交易、重置原 `ISSUE_UNKNOWN`、重做 Fund/Claim/Consent 或开启 Merchant Settle。Phase 4 的两次 PASS 是**钱包控制权门禁通过**，不构成上述授权。
4. 如尚未到真实授权环节，做源代码与 CI／合成 EIP712，完成后**再次更新根 `HANDOFF.md`**。不要再次要求用户重复已经通过的 EIP-191 测试，除非之后新一轮完整安全流程实际需要新的签名挑战。

## 2026-10-25 接续核验：Phase 4 已就绪，等待真人 Owner / Donor SIWE 控制证明

- **最新实际状态：** 不需要新的自动部署或实库写入。Owner／Donor Phase4 控制证明网页 `https://mealforward-t1e-role-proof-laodao.onrender.com/t1f-phase4.html` 已可测试，使用原 Owner `0xc4f8a468f10d5f98dcff3282516125e97f26433b` 与原 Donor／Quote `0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952`，两只不同钱包，Monad Testnet ChainId 10143。**只做两次 SIWE 格式 EIP-191 `personal_sign` 钱包控制证明，不签 EIP-712 Recovery Release，不进行任何链上交易。**
- **GitHub 源码：** [PR #44](https://github.com/3956ray/MealForward/pull/44) 开发分支 `codex/mealforward-t1f-phase4-owner-donor-proof-20261025`，核验前 HEAD `e35aa92f5c06175a226244da28ddf5b9b2d08788`；专用 Role Proof Render 发布分支 `codex/mealforward-t1e-issuer-original-tx-verifier-20261023`，核验前 HEAD `a332bc151ad500dcd3de416f0d2c960379bc6924`。Handoff 更新后 HEAD 会变化；下个 Agent 必须实时查分支 SHA，不要把文档 HEAD 当作部署 Commit。
- **已部署版本：** Render LaoDao `srv-dbdeuft9fdbs73atbvh0`，`dep-dbf0ti9srm7s73bcm5j0` **Live**，实际应用 Commit **`c382884c0a22413acded671d2e2f292e7bd63aec`**，公开 URL 同上。服务分支准确为 `codex/mealforward-t1e-issuer-original-tx-verifier-20261023`，`autoDeploy=no`，运行日志 `T1E_ROLE_PROOF_ONLY_READY`、`noDatabaseConnected=true`、`noFinancialWrites=true`。该服务 Phase4 已开启，但依然**无 Supabase 凭据、无持久登录、无 EIP-712 双人批准、无 Fund/Issue/Settle**。
- **最新与 HEAD 对齐的 CI：** [Phase4 公网 HTTPS #40201811694](https://github.com/3956ray/MealForward/actions/runs/40201811694) **PASS**，服务开启状态实际发出 **21 次 HTTP 请求**，返回 `T1F_PHASE4_OWNER_DONOR_PUBLIC_PROOF_NEGATIVE_PASS`，`nonceReservations=0`、`walletSignaturesCollected=0`、`onchainTransactions=0`、`liveRecoveryReleased=false`；[Phase4 Owner/Donor SIWE 回归 #40201811737](https://github.com/3956ray/MealForward/actions/runs/40201811737) **PASS**，原 Issuer/Recipient 兼容及接入协议另见本文件之前的 CI 链接。这些是合成签名与无 Session 匿名公网门禁，**不能替代真实 Owner/Donor 钱包操作**。
- **数据库只读实况：** Supabase `ketfrukrcuosrqynnsay` 仍只有 001–012 已上线迁移；013/014/015 未部署（相关表 `to_regclass` 均不存在）。原 7 Test USDC 只有一笔 `FUNDED`，唯一 Claim `fbab3b22-965d-44e2-b144-d7307b7aa8ea` 为 `ISSUE_UNKNOWN` revision2，原固定 Issuer Nonce 0、过期截止 `1792765625`、TxHash/Receipt 均 NULL，`ISSUE_RESERVED` 仍只有 1 条。Claim 发行与商家结算服务 `srv-dbdgstivcj2c73fnqcc0` 仍在原 `dep-dbdto63rjlhs738br1sg` Live；Phase4 没有触碰它。
- **唯一未完成的人类验收：** 用户本人先在固定 Owner 钱包点击“本人 SIWE 控制证明”，页面应显示 Owner `PASS`；再切换固定 Donor 钱包单独签同类 EIP-191，页面应显示 Donor `PASS` 和 `2/2`。要求只回传页面脱敏结果、失败代码和账户切换情况。**不要**发送 Cookie、签名、私钥、助记词、口令；如用户不能控制原任一钱包，应立即停住，不能代选别的钱包。
- **后续开发严格停点：** 真人两个 PASS 后才继续审查 EIP-712 恢复签署与独立授权服务。EIP-191 控制证明并非任何继任新 Issue 的授权。真实库 013–015 迁移、新角色凭据、新授权签名及真实 MetaMask `issue()` 必须分别审查并获新明确许可；禁止重置原 `ISSUE_UNKNOWN`、重用过期 nonce/op/deadline、重做 Fund 或开启商家 Lock/Report/Settle。原合约没有链上强制 Recipient Consent 和 180 秒 Settle 门槛，仍是安全阻塞。
- **接手规则：** 任一新的 Agent 接手先查 `HANDOFF.md` 本段，核对真实 Render/Supabase/Actions，再等待真人控制证明反馈；每次开发、部署、人工验收后必须再更新根 `HANDOFF.md`。旧 Mac CP30 Journal `PREPARED #3560` 冻结且与这项云试点分离。


## 2026-10-25（UTC+8）最新：Phase 4 已在独立 Role Proof 云端上线，等待两位真人钱包验收

**这是当前最高优先级的人工测试入口。** 已开发并上线原 Owner 与原 Donor 的**独立 SIWE 格式 EIP-191 钱包控制证明**，不是 Phase3 EIP-712 Recovery Release、不创建 Session/数据库记录、不能发新 Issue 或结算。旧 `recipient_claims.ISSUE_UNKNOWN` 的第一次过期预留仍保持冻结，所有旧 Fund、Nonce、Operation 和 CP30 Journal 均不变。后文 Phase 3「下一步要开发 Phase 4」是历史状态，以本段实时结果为准。

### GitHub 和部署真源

- 主开发分支：`codex/mealforward-t1f-phase4-owner-donor-proof-20261025`，**[Draft PR #44](https://github.com/3956ray/MealForward/pull/44)**，base Phase 3 [PR #43](https://github.com/3956ray/MealForward/pull/43)，继续承接 Phase 2 [#42](https://github.com/3956ray/MealForward/pull/42) / Review [#41](https://github.com/3956ray/MealForward/pull/41)。新增 `t1-intents/t1f-phase4-proof.mjs`（SIWE-format EIP191 challenge/verify）、`t1-intents/public/t1f-phase4.html`/`t1f-phase4.mjs`（Owner+Donor MetaMask 页面）、`t1f-phase4-proof.test.mjs`（HTTP + 钱包假 EOA 正负测）、`t1f-phase4-live-smoke.mjs`（真实 Render 匿名公网负测）、两条独立 Phase4 CI workflow。详细交接文件 `docs/CP31-T1F-PHASE4-OWNER-DONOR-PROOF-HANDOFF-2026-10-25.md` 在 PR #44 分支。
- **实际 Role Proof 专用发布分支**：`codex/mealforward-t1e-issuer-original-tx-verifier-20261023`，[Draft PR #37](https://github.com/3956ray/MealForward/pull/37)。仅选取 Phase4 Proof 服务/前端/测试文件，未将 Phase3 013–015 数据库和交易源码带入这条安全服务。旧代码备份为 `codex/mealforward-t1e-proof-before-phase4-20261025` @ `a35f97d3743d91424fa9b5a202e6ad20c831aaa6`。
- **真实 Render 已开启**：LaoDao workspace `tea-db7q3ou7bikc73bp2bt0`，**Role Proof** 服务 `srv-dbdeuft9fdbs73atbvh0`，URL **`https://mealforward-t1e-role-proof-laodao.onrender.com/t1f-phase4.html`**。部署 `dep-dbf0ti9srm7s73bcm5j0` **LIVE**，实际应用源码 Commit `c382884c0a22413acded671d2e2f292e7bd63aec`，`T1F_PHASE4_PROOF_ENABLED=true`。原先 flag=false 的灰度部署 `dep-dbf0sj0m7kps73fcbs70` 也已经过真实公网验收。Render Role Proof 启动日志明确 `T1E_ROLE_PROOF_ONLY_READY`、`noFinancialWrites:true`、`noDatabaseConnected:true`，且 `T1E_CLAIM_WRITES_ENABLED=false`、`T1E_WALLET_TX_ENABLED=false`、`T1E_SETTLEMENT_ENABLED=false`。
- T1-E 原 Claim/Issuer 云服务 **未变更**：`srv-dbdgstivcj2c73fnqcc0`，`dep-dbdto63rjlhs738br1sg` Live、部署 Commit `c8723c2f280e4b72ff067e0be08f5bf1c4a15412`，原过期 Issue 前端禁止重发逻辑保留。**这是不同 Render 服务，不可混用 URL 或环境变量。**
- **实际 Supabase 再次核验**：项目 `ketfrukrcuosrqynnsay`，只有 001–012 实库迁移；013 `expired_issue_reviews`、014 `issuer_issue_attempts` 和 015 `successor_issue_releases` **不存在**。仍 1 条 `FUNDED` 原资助、1 Claim `fbab3b22-965d-44e2-b144-d7307b7aa8ea` `ISSUE_UNKNOWN` revision2，首次 opId `0x2e709dee8113d2dac73cbea53d016d6629fc3730c6f85325a17c98bc4777445b`、Issuer nonce 0、过期截止 `1792765625`、原 TxHash=NULL、仅 1 `ISSUE_RESERVED`。Supabase Security Advisor 0 lints。**本 Phase4 从未连接/写入 Supabase 或在 Monad 上发交易**。
- **真实 CI 验收**：原 T1-E proof 源码、Phase4 新 SIWE + 账号切换/防重放 HTTP 正负测试 [Actions #40201405346](https://github.com/3956ray/MealForward/actions/runs/40201405346) **PASS**；开启后 [Phase4 真实公网负测 #40201405357](https://github.com/3956ray/MealForward/actions/runs/40201405357) **PASS，共 21 个真实 HTTPS 请求**，证据 `T1F_PHASE4_OWNER_DONOR_PUBLIC_PROOF_NEGATIVE_PASS`，检查无 cookie、无 DB、无 EIP712 Release/Issue/Fund/Settle、严格钱包/跨站/非法参数/错误签名拒绝，0 Claim 写、0 上链操作；此前默认关闭阶段 [#40201073953 attempt 2](https://github.com/3956ray/MealForward/actions/runs/40201073953/attempts/2) **PASS**。真实旧 T1-E RoleProof 兼容 CI 亦通过。文档后续提交不等于已重新部署应用，核验时必须区分 GitHub HEAD 和 Render 实际 Commit。

### 现阶段必须由用户亲自做的测试（这里停止自动开发）

1. 打开 **`https://mealforward-t1e-role-proof-laodao.onrender.com/t1f-phase4.html`**，检查右侧安全阶段和两个独立角色。请使用 MetaMask，Monad Testnet Chain ID **10143**。
2. 首先使用**原 Owner**：`0xc4f8a468f10d5f98dcff3282516125e97f26433b`，若网站显示其他账户则先点击「重新选择钱包」，本人点击「SIWE 控制证明」。MetaMask 弹窗是**非交易 EIP-191 `personal_sign`**，消息必须显示 `WALLET CONTROL PROOF ONLY`、`Not an EIP-712 release`、角色 OWNER、原 RoleProof 域；用户本人核对后再签。期望页面 `PASS`。
3. 然后切换到**原 Donor／Quote**：`0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952`，执行自己的独立控制证明；期待第二个 `PASS` 和汇总 `2/2`。两个角色是不同 EOA，不要拿 Issuer/Recipient 代替，也不要临时改固定地址绕过。
4. 用户只发送两个 PASS/错误的页面文字，不分享任何原始签名、Cookie、私钥、助记词或密码。若任一钱包不可控制，安全停止，报告角色不能验收；此时后续 Phase3 恢复不得放行。
5. **通过两个 EIP-191 证明≠两位用户已经签了 EIP-712 发券恢复批准**。当前没有 013/014/015，未授权新 Issue。不许点击此前过期的原 Issuer `issue()` 发送，不得重复 Fund/Claim/Consent、重新绑定原 nonce、Lock/Report/Settle。用户的人类验收完成后，Agent 继续审核/开发真正双人 EIP712 Release + 独立最小权限 DB 系统，再申请明确的实库迁移与真实钱包授权。

### 回退、下一位 Agent 操作

若 Phase4 真实验证有异常，在独立 RoleProof Render `srv-dbdeuft9fdbs73atbvh0` 仅设置 `T1F_PHASE4_PROOF_ENABLED=false`，Render 自动触发安全部署；复核 `/v1/t1f/phase4/status` 不开放而 `/v1/t1e/status` 仍工作。无需触动任何 Supabase、旧 CP30 或 T1-F Issuer Render；如源码回退参考备份分支 `codex/mealforward-t1e-proof-before-phase4-20261025`。需要进一步开发时先读此文件、`docs/CP31-T1F-PHASE4-OWNER-DONOR-PROOF-HANDOFF-2026-10-25.md` 和 PR #44 真 HEAD，精确审阅日志与测试，不自行签名或后台操作。

**用户永久要求：每一阶段开发、部署、回滚或人工验收结束，都必须再次更新根目录本 `HANDOFF.md`（代码 SHA、运行 Commit、实库、CI、人类已通过/未通过、下一步），不能仅留在聊天里。**

## 2026-10-24 当前最新：T1-F Phase 3 / 015 双人审批、独立发券状态机（仅源码，CI 通过）

> **优先读此节；下文 Phase 2「还没有开发 015」是历史记录，已被本节取代。** Phase 3 的审批和继任 Issue 代码已经建好并通过隔离测试，但**绝对没有启用真实钱包/数据库的第二次发券**。

- **GitHub 最新开发真源**：[Draft PR #43](https://github.com/3956ray/MealForward/pull/43)，分支 `codex/mealforward-t1f-phase3-dual-approved-issue-20261024`，base [Draft PR #42](https://github.com/3956ray/MealForward/pull/42)，上游 PR #41（013 审查）/ PR #40（原始 Issue）。PR #43 代码已测试提交 `b1049b9c56ace358b2f28b6a91bcfe4474d09c67`；后续文档提交会改变 HEAD，**每次接手先重新查询 PR HEAD 与 CI**。未 merge main、未合并到线上 staging。
- **独立 015 SQL 草案**：`t1-intents/supabase/015_t1f_dual_release_successor_issue.sql` 新增 3 张私有表：`successor_issue_releases`（独立 Owner + Donor 两个 EIP712 签名核验结果及哈希指纹，仅留永久记录）、`successor_issue_operations`（每 Claim/Slot/Release 最多一条新操作，事务性 `ISSUE_UNKNOWN → ISSUE_HASH_BOUND → ISSUED` 或终止 `BLOCKED`）、`successor_issue_events`（触发器自动追加，不能删除/覆盖）。015 没有给任何 T1-E、T1-D、T1-C 运行角色新增读写权限；不改变 013/014 的永久 `REVIEW_HOLD`，**更不修改首次 `recipient_claims.ISSUE_UNKNOWN`**。只有未来单独审批并建立独立最小权限运行身份后才能操作。
- **EIP-712 两人授权**：`t1-intents/t1f-successor-dual-approval.mjs` 固定原 Owner `0xc4f8a468f10d5f98dcff3282516125e97f26433b` 与原 Donor/Quote `0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952` 两个不同钱包，与后续原 Issuer `0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3` 交易钱包隔离。签名共同绑定 chain10143 / 原 StoreEscrow / 原 Claim / Review / Slot / 原 opId/nonce/deadline/dataHash / Voucher / 新 opId/nonce/deadline / 审批 nonce / 观察区块 hash / 短审批时效。只验证真实签名地址，仅存 digest 与签名指纹；**没有获得这两名真人的任何签名**。DB 自己无法验证 EIP712，未来授权服务必须先验签，这属于上线前风险门槛。
- **独立操作源码**：`t1-intents/t1f-successor-issuer-ledger.mjs` 未接公网、无 live DB 权限。未来需先以固定只读 Monad RPC 重新核实原 op 未执行、Issuer latest/pending nonce、Unit 0 Available 与 7 Test USDC Liability，双 EIP712 有效、Slot 行锁、原子插入 Release+Successor Operation，**COMMIT 后只对首次调用返回一次由本人 MetaMask 发送的交易内容**。再次调用仅恢复既有 op/nonce/TxHash、绝不返回可再次广播字节；Hash 绑定与独立 Receipt/Canonical Block/Voucher 验证单独记录，**原 Claim 不会伪装为新 Issued**。源中无后端 signer 或链写 RPC。
- **测试及可复核证据**：[Phase 3 CI PASS #40062881172](https://github.com/3956ray/MealForward/actions/runs/40062881172)，随后包含 Phase 3 合同文档的 [CI PASS #40063033832](https://github.com/3956ray/MealForward/actions/runs/40063033832)。通过双签名合成 EOA 正/负测试（冒充原 Owner/Donor 的假签名会被拒）、非 Issuer 角色拒绝、第二次预留仅恢复、Nonce 竞争、截止/签名/Receipt 篡改、Reorg 拒绝等；一次性 Docker PG17 **127.0.0.1:5439** 精确执行 **009–015** 全套迁移，报告 `T1F_SOURCE_ONLY_PG17_DUAL_RELEASE_SUCCESSOR_015_PASS`，原 Claim/Consent/Fund 不变、Role Release Grants=0、自动审计 3 条、Nonce/Hash/Deadline 不可改。**真实 SQL 015 的正例是模拟 Owner/Donor 已验签指纹，而非真 EOA 已在 DB 完成审批**；真实 Monad 上无新 Issue。
- **特殊测试前提**：CI 需要模拟 012 旧 Issue 截止时间过去；仅在全新且固定 loopback DSN、带多重一次性 GitHub Actions guard 的 PG17 Fixture 中暂时关闭两个 Claim immutability trigger 来模拟经过时间，随后立刻恢复并验证均启用，再执行 013–015。**绝不可把 fixture 的停 Trigger/time travel 指令对真实 Supabase 执行**。部署环境不包含这段 CI 行为。
- **最新实库只读核对（Source-only）**：项目 `ketfrukrcuosrqynnsay` 仍仅有 001–012 真实迁移，013/014/015 三张新表不存在。唯一资助 `FUNDED=1`，单一 Claim `fbab3b22-965d-44e2-b144-d7307b7aa8ea` 仍 `ISSUE_UNKNOWN`、revision 2、原 opId `0x2e709dee8113d2dac73cbea53d016d6629fc3730c6f85325a17c98bc4777445b`、Nonce 0、原截止 `1792765625` 已过期，原 Issuer TxHash NULL；单一 `ISSUE_RESERVED` 审计，Supabase Advisor 0 lints。Owner 报告的 MetaMask 未见交易 + 单节点 RPC 无 Pending 不是全球 mempool 不存在的形式化证明。
- **最新部署原样未动**：Render LaoDao workspace `tea-db7q3ou7bikc73bp2bt0`，T1-E/T1-F service `srv-dbdgstivcj2c73fnqcc0` **Live** @ `dep-dbdto63rjlhs738br1sg`，Commit `c8723c2f280e4b72ff067e0be08f5bf1c4a15412`。只运行过期防误发送版本，**没有 013/014/015，也没有新的继任发券界面/授权 API**。不得误把 GitHub PR #43 源码视为已发布。
- **下一步（未获正式链上/DB 发布许可）**：对 PR #41/#42/#43 进行独立安全审阅，开发专用最小权限的“Owner+Donor 双签 Release 服务”与分阶段钱包 UI，在隔离环境完成公网 SIWE/CSRF/403/429、跨角色、Nonce 并发、断线/重组/拒绝签名/Hash 丢失及回退验收。以后要在真库执行 013/014/015、激活新数据库 Login 或邀请真实 Owner/Donor/Issuer 签名，**必须获得用户对具体迁移与钱包操作的新明确批准**，绝不借“继续开发”自动开通。
- **安全红线**：不修改原旧 Claim/Nonce/Receipt、旧 Mac CP30 `PREPARED #3560` Journal、原 T0 合约；不重复 Fund/Claim/Consent/Issue；原 `issue()` 不链上校验受助者 Consent、180s 结算约束 #17 仍有缺口，商家 Lock/Report/Settle 持续关闭。禁止任何无人值守服务器广播。
- **更详细技术交接**：`docs/CP31-T1F-PHASE3-DUAL-RELEASE-GATE-2026-10-24.md`（在 PR #43 分支），精确项目 PR、服务、迁移/权限、可运行 CI 路径和后续发行 Gate 如本文件。**用户规则：每轮开发结束必须更新此根目录 `HANDOFF.md`**，不能只改历史 docs。

## 2026-10-24 最新工程里程碑：T1-F 第二阶段独立 Issue Attempt · REVIEW_HOLD 已完成

**当前下一位 Agent 的第一任务：继续审查 Source-only PR #42 的 Phase 2 安全合同，为未来 Phase 3/015 制作独立授权与钱包恢复设计。绝不能把已有 014 源码误当作已安装的真实数据库迁移，更不能对过期原 Issue 重新预留或直接广播。**

- **GitHub 真源**：Repository `3956ray/MealForward`；T1-F Phase 2 工作分支 `codex/mealforward-t1f-successor-attempt-hold-20261024`，[Draft PR #42](https://github.com/3956ray/MealForward/pull/42)，基于 Phase 1 [Draft PR #41](https://github.com/3956ray/MealForward/pull/41)，再基于原 T1-F [PR #40](https://github.com/3956ray/MealForward/pull/40)；对应 T1-E 部署基线仍为 [Draft PR #38](https://github.com/3956ray/MealForward/pull/38)。本文件提交后必须重新实时查 PR HEAD，不能假设历史 SHA 最新。
- **第二阶段具体代码**：
  - `t1-intents/supabase/014_t1f_successor_attempt_review_hold.sql` —— 单独、不可变且一条 Claim 最多一个的 `issuer_issue_attempts` 审查槽；FK 原 013 `expired_issue_reviews`，Stage 只允许 `REVIEW_HOLD`，所有继任 opId/nonce/deadline/calldataHash/TxHash/Receipt/Release ID 必须 NULL；全部可发送/改写权限位强制 false，现有 Auth / Claim / Fund 运行角色均无法读写。
  - `t1-intents/t1f-successor-issue-protocol.mjs` —— 经原 Claim + 013 Review + 014 Slot + 独立 Monad 只读证据校验后，只对**假设中的、不同于旧 opId 的新操作**产生 calldata Hash，返回 `T1F_SUCCESSOR_DESIGN_PREVIEW_NO_RELEASE`，不返回可发送交易字节，不修改 DB。
  - `verifySuccessorReceiptReadOnly()`（同文件）—— 源码层已验证的只读 Receipt 适配器，复用旧 T1-F 的严格 Transaction / Canonical Block / Issued / OperationExecuted / Voucher / 7 Test USDC 责任校验；只有未来独立批准、已记录 `ISSUE_HASH_BOUND` 和 `security_release_id` 的继任 Attempt 才能触发。当前 014 数据库**不可能生成这一状态**；旧 `recipient_claims` 永远保留首次 `ISSUE_UNKNOWN`，成功后不能伪造旧 TxHash。
  - `t1-intents/t1f-successor-issue-protocol.test.mjs`、`t1f-successor-attempt-hold.ci.mjs`、`.github/workflows/mealforward-t1f-successor-hold-014.yml` —— 模拟错误 signer/nonce/TxHash/calldata/reorg/重复/过期，PG17 精确 009–014 独立迁移与不可修改触发器。
  - 完整 Phase 2 合同与 Phase 3 门槛：`docs/CP31-T1F-PHASE2-SUCCESSOR-ATTEMPT-GATE-2026-10-24.md`；不要仅从聊天摘要猜测约束。
- **最新 CI 证据（源代码 + 一次性 PG17）**：[Actions 40054537423](https://github.com/3956ray/MealForward/actions/runs/40054537423) **两项 job PASS**：协议 6 项测试 + 历史守卫回归，通过；一次性 PostgreSQL 17.11 在仅 `127.0.0.1:5438` 运行准确 009–014 SQL，状态 `T1F_SUCCESSOR_PHASE2_014_DISPOSABLE_REVIEW_HOLD_PASS`，`originalClaimUnchanged=true`、`originalNoncePreserved=true`、`newOperationIdsCreated=0`、`newIssueAllowed=false`、`successorTransactionFieldsAllNull=true`、`runtimeReviewWritesDenied=true`。Receipt 正例是**合成 RPC**，不能替代真人 MetaMask 交易或真实已发券证据。
- **再次只读 Supabase（真实项目）**：`mealforward-t1-staging` `ketfrukrcuosrqynnsay`，仍只有 **012** 为止的 12 条真实迁移；`mf_t1e.expired_issue_reviews`（013）不存在、`mf_t1e.issuer_issue_attempts`（014）不存在。唯一 Claim `fbab3b22-965d-44e2-b144-d7307b7aa8ea` 仍 `ISSUE_UNKNOWN` revision2、原 Issuer opId `0x2e709dee8113d2dac73cbea53d016d6629fc3730c6f85325a17c98bc4777445b`、nonce 0、已过期 deadline `1792765625`、`issuer_tx_hash=NULL`；1 原 Fund、1 Claim、1 Issue Reserve；Supabase Security Advisor 无 lints。绝不可对该实库直接运行审查草案而声称“Phase 2 已激活”。
- **Render 原服务不变**：LaoDao `tea-db7q3ou7bikc73bp2bt0`，`srv-dbdgstivcj2c73fnqcc0`，最新真实 LIVE 部署 `dep-dbdto63rjlhs738br1sg` @ `c8723c2f280e4b72ff067e0be08f5bf1c4a15412`。这不是新 Phase 2 源码；T1-F 旧的过期发送 UX 拒绝逻辑已在线，但**没有继任发券入口或新 Attempt**。Render `T1E_WALLET_TX_ENABLED=false`、`T1E_SETTLEMENT_ENABLED=false` 边界不变。不得在本轮为 PR #42 改 Render/重启。
- **Owner 与真实链**：用户已经查验原 Issuer `0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3` 的 MetaMask Monad Testnet Activity，报告无交易；此前原 Issue 第二次点击也是预留，不是发送。此前只读 ChainId10143 / Unit 0 Available / issuer latest+pending Nonce 0 / 原 op 未执行，不能据单节点 pending 断言全网绝无未知 Tx。原 7 Test USDC Fund 仍唯一。原合约不链上强制 Recipient Consent、180 秒 Settlement Cooldown Issue #17 未修，结算绝不可放行。
- **下一阶段 Phase 3/015（尚未取得具体运行批准）**：提出*专门的权限放行*、原始证据保留、仅一个新 Attempt 的严格事务状态机（原子记录新的 opId/nonce/短时 deadline/Hash，并发双击只恢复旧候选）、双 RPC 与独立签名钱包新鲜核验、唯一 Voucher 的独立 Receipt 权威投影、未知交易只查原 Hash、单一人工 MetaMask 交易。完整回退和负测试、第三方代码审查均应就绪后，**单独请求用户批准真实 Supabase 013/014/015 和实际钱包操作**。当前仅有继续开发许可，不是 DB/广播许可。
- **交接强制规则**：本轮收尾必须再次更新根 `HANDOFF.md`，确保所有 Agent 开始先核对本段 PR42/CI 及真实 Render/Supabase。保留旧 CP30 Journal `PREPARED #3560` 冻结；禁止创建第二份 Claim、重新 Fund、覆盖原 Operation/Nonce 或开启商家 Settle。

## 2026-10-24（UTC+8）最新：原 Issuer 钱包无可见交易；T1-F 恢复 Review-only 已完成源码与隔离验收

**本节是新的接手起点，覆盖历史“仍未收到用户 MetaMask 结果”的等待说明，但不能把“没有可见交易”提升为“全部 mempool 被证明为空”。**

- **用户真实反馈：** Monad Testnet 原 Issuer `0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3` 在 MetaMask Activity **没有任何交易**。此前两次按钮点击都只涉及「一次性预留原始 Issue」，并非两次发送。
- **最新独立真实链上只读验收**：[Actions 40032638604 attempt 2](https://github.com/3956ray/MealForward/actions/runs/40032638604/attempts/2)，2026-10-24 09:53（UTC+8），Monad block `73688844`：原 Issuer `latestNonce=0` / `pendingNonce=0`，原 Operation 尚未执行，原 Unit 0 `Available`、`Issued=false`；结论 `T1F_EXPIRED_NO_ISSUE_OBSERVED_NOT_ABSENCE_PROOF`。**单一 RPC 的 pending 是节点本地视图，不是全球交易未广播的证明**。以太坊 JSON-RPC pending 语义参阅 https://ethereum.github.io/execution-apis/api/methods/eth_getTransactionCount/ 。
- **最近 Supabase 实库只读状态**：`mealforward-t1-staging` `ketfrukrcuosrqynnsay`；仍只有 12 个真实迁移（至 `20261023105932` 的 T1-F 012），1 条原 `FUNDED`，1 条 Claim `fbab3b22-965d-44e2-b144-d7307b7aa8ea`，`ISSUE_UNKNOWN` `revision=2`；原 opId `0x2e709dee8113d2dac73cbea53d016d6629fc3730c6f85325a17c98bc4777445b`、nonce 0、不可变截止时间 `1792765625`（2026-10-23 22:27:05 UTC+8）、数据 Hash `0x089cb2b0a35e81f31a9f9a658cd298ad7c9d3376ea01fac6fb77013451e1f0ed`，`issuer_tx_hash=NULL`，仅 1 条 `ISSUE_RESERVED`、合计 3 条原审计事件。无第二份 Claim/Fund/Issuer Attempt。
- **现有 Render 真部署（本次未改）**：LaoDao `tea-db7q3ou7bikc73bp2bt0`、T1-E/T1-F `srv-dbdgstivcj2c73fnqcc0`，`dep-dbdto63rjlhs738br1sg` LIVE，部署 Commit `c8723c2f280e4b72ff067e0be08f5bf1c4a15412`。旧过期发送 UX 已防误发送。未开启新的恢复/重发 API；Fund/Settle 仍关闭。
- **当前恢复工作分支**：`codex/mealforward-t1f-expired-review-ledger-20261024`，[Draft PR #41](https://github.com/3956ray/MealForward/pull/41)，base 旧 T1-F [PR #40](https://github.com/3956ray/MealForward/pull/40)，不可自动合并 main/staging。源文件 `t1-intents/supabase/013_t1f_expired_issue_review_only.sql`、`t1f-expired-recovery-review.mjs` + `.test.mjs`、`t1f-expired-recovery-review.ci.mjs`、`.github/workflows/mealforward-t1f-recovery-review-pg17.yml`；协议与后续阶段 Gate `docs/CP31-T1F-EXPIRED-ISSUE-RECOVERY-GATE-2026-10-24.md`。
- **最新 CI**：[Actions 40052180388](https://github.com/3956ray/MealForward/actions/runs/40052180388) PASS（源代码 + 11 个 Node.js 测试（4 项 policy + 3 项链只读假 RPC + 4 项钱包 UI）；隔离 PostgreSQL17 009–013 精确迁移、旧 Claim 不变、独立审计只可 Admin/独立审批写、运行角色无法写 Review、新 Issue 永久 NO）。迁移 013 在 CI 的一次性数据库通过，**从未在真实 Supabase 运行**。
- **严格边界**：新表 `mf_t1e.expired_issue_reviews` 只记录原 op、原 nonce、原 deadline、原 calldata hash 和可追溯的只读观察，全部恢复授权位硬锁 `false`。它不能让服务器签名、再发 Issue 或修改原 `ISSUE_UNKNOWN`。源代码纯策略 `T1F_REVIEWABLE_OFFLINE_SECURITY_REVIEW_ONLY` 只允许进入人类审查，绝非线上重试权限。
- **下一步工程与人工 Gate**：先独立审查 PR #41 的 013 迁移与隔离测试，明确 **Phase 2** 另建 append-only `issuer_issue_attempts` 与安全的权威状态投影，不能让原 Claim `ISSUE_UNKNOWN` 与第二条尝试混为一个原 Hash。用户需单独明确批准任何真实 DB 013/未来014、T1-F Wallet release 或真实 Issuer `issue()` 操作。在此之前不得修改真实 Claim、清除旧 nonce、重复预留/Consent/Fund/Settle 或自动交易。
- **重要缺口**：用户报告的 MetaMask 活动为空并非机器可重放的签名证据，网络监测不保证所有节点的 pending/mempool；不可把当前情况描述成“可直接重新发送”。需要继续人工审计并严格记录这层不确定性。


## 2026-10-24（UTC+8）最新：用户确认两次均为预留，过期发送已由新 UI 阻止

**这是当前最高优先级接手真相，覆盖下文 2026-10-23 的历史人工疑问。** 用户明确回复：**“第二次点击的是『一次性预留原始 Issue』”**，而非第二次点击发送。不能据此推断 MetaMask Activity 绝对没有任何先前单独发送，仍须核对本人钱包记录。

### 真实数据与链上结果

- 最新 Supabase 再次只读核验：唯一 Claim `fbab3b22-965d-44e2-b144-d7307b7aa8ea`，`ISSUE_UNKNOWN` / `revision=2`，一条 `ISSUE_RESERVED` 审计，唯一 opId `0x2e709dee8113d2dac73cbea53d016d6629fc3730c6f85325a17c98bc4777445b`、Issuer Nonce `0`、不可变截止时间 `1792765625`（2026-10-23 22:27:05 北京时间）、`issuer_tx_hash=NULL`、`receipt_block=NULL`。原 `FUNDED=1`、`Claims=1`、`Issue Reserves=1`，无第二笔数据库预留或新 Fund。
- 同一原 Issuer 真实链上只读验收：[Actions 40032357397](https://github.com/3956ray/MealForward/actions/runs/40032357397)，2026-10-23T22:15:21Z（2026-10-24 06:15 UTC+8），区块 `73645548`：Issuer `latestNonce=0`、`pendingNonce=0`、原 `getOperation(opId)` 未执行、Unit 0 `Available`、`unitIssued=false`。状态 `T1F_EXPIRED_NO_ISSUE_OBSERVED_NOT_ABSENCE_PROOF`；**公共 RPC 没有观察到原 Tx ≠ 可以证明所有节点 / MetaMask 均没有任何曾广播的 Tx。** 不可据此直接重置已冻结数据。
- Supabase Security Advisor 最新查询 0 lints。没有调用任何链写方法、变更真实 Claim 或触碰原 CP30 Journal。

### 已修复一个实际 UX 安全缺陷并部署

以前的 Issuer 浏览器页面即使临近或超过 Solidity `issue()` 截止时间，仍可能保持「本人 MetaMask 发送唯一 Issue」可点。新代码使用 `issueWindowOpen`（至少剩余 90 秒）、`serverTimeUnix` 服务端时钟和不可变原 opId/nonce/deadline/Hash 比对，**在准备打开 MetaMask 发送弹窗之前**拒绝过期、太接近截止或已变化的原操作，并清除内存中的可发送交易。第二次 Prepare 收到 `created:false` 时显示“恢复原交易”而不是误报新预留成功。真实钱包签名依然只能由用户点击，服务器不能广播。
- 开发真源：Draft PR [#40](https://github.com/3956ray/MealForward/pull/40)，安全代码曾验证的开发提交 `6aa9efc9e13e9c87c0123bc2f12e253e06697447`；后续更新仅增强公网验收和 Handoff，实时查 PR HEAD。
- Staging 应用代码提交 `c8723c2f280e4b72ff067e0be08f5bf1c4a15412`，**真实 Render Live** 服务 `srv-dbdgstivcj2c73fnqcc0`，Deploy `dep-dbdto63rjlhs738br1sg`。之后 staging HEAD `61cc60a6...` 的变化属于测试断言，须实时核对 HEAD，不能把 GitHub HEAD 冒充 Render 已部署 Commit。
- 已通过：最新 staging [T1-F PG17/Wallet/HTTP 安全测试 40032357425](https://github.com/3956ray/MealForward/actions/runs/40032357425) PASS；[T1-E Auth HTTP 40032357474](https://github.com/3956ray/MealForward/actions/runs/40032357474) PASS；[真实公网 HTTPS 40032357818](https://github.com/3956ray/MealForward/actions/runs/40032357818) PASS，22 请求，且新前端确实包含过期 guard 和 serverTimeUnix check；[链上过期预留诊断 40032357397](https://github.com/3956ray/MealForward/actions/runs/40032357397) PASS；[原单份资金只读校验 40032357496](https://github.com/3956ray/MealForward/actions/runs/40032357496) PASS。以上均无钱包广播。
- 新诊断脚本 `t1-intents/t1f-expired-issuer-readonly.mjs` 和对应 `.test.mjs`，仅允许链 ID、Latest/Pending nonce、`getOperation`、原 Unit 与同一固定区块一致性，只输出不可用于自助重发的风险评估。

### 新 Agent 的唯一安全下一步（非自动 Issue）

1. **让原 Issuer 本人查看 MetaMask Activity，确认该钱包在 Monad Testnet 上是否有 Nonce 0 的交易、交易 Hash 或待处理记录**；如有，基于**原 Hash**只读核实 Tx/Receipt 并继续原 `ISSUE_UNKNOWN` 的恢复，不创建新交易。无需提供私钥、Session Cookie 或原始签名。
2. 如果用户明确从未点击任何发送按钮、钱包 Activity 确认无相关 Tx、Nonce 仍是 0、原 Unit 仍 Available，则新 Agent 可**先写受审计的过期预留恢复设计/隔离测试**，包括原事件不可删改、区分首次过期与真正已广播的情况、原操作永久保留、所有新尝试必须另存 append-only 数据、模拟并发/链重组/钱包拒绝；**没有额外明确人工授权不得对真实数据库做任何恢复写入或发第二笔 Issue**。
3. 目前 `ISSUE_UNKNOWN` **仍存在且已过期**；绝不可点击旧页或新版页的「本人 MetaMask 发送唯一 Issue」，不可再次预留、重置 nonce/op/deadline、重复 Fund/Claim/Consent/Settle。刷新页面可取得新版禁发保护，但刷新不会取消 MetaMask 可能已经广播的 Tx，需先看钱包 Activity。
4. **每次开发结束必须继续更新本根目录 HANDOFF.md**，优先读此最新日期段；旧文“用户是否点击第二次发送？”已由用户本轮明确解释为第二次**预留**，不要重复问同一个问题。

## 2026-10-23 22:35+（UTC+8）：用户报告「这是第二次点击了」— 数据库无二次预留

- 用户在首次报告已点击「一次性预留原始 Issue」后，进一步回复「这是第二次点击了」。**已在 2026-10-24 由用户明确：第二次点击的是「一次性预留原始 Issue」，不是该次发送**，不要仅凭语句下结论。
- 随后实际只读查询 Supabase `mf_t1e.recipient_claims`：唯一 Claim `fbab3b22-965d-44e2-b144-d7307b7aa8ea` 仍 `ISSUE_UNKNOWN`、`revision=2`、原唯一 `issuer_op_id=0x2e709dee8113d2dac73cbea53d016d6629fc3730c6f85325a17c98bc4777445b`、nonce `0`、`issuer_issue_deadline=1792765625`、原 `issuer_tx_data_hash=0x089cb2b0a35e81f31a9f9a658cd298ad7c9d3376ea01fac6fb77013451e1f0ed`；仍未持久记录 `issuer_tx_hash` 或 Receipt。
- `mf_t1e.claim_events` 仍仅 **1 条** `ISSUE_RESERVED`（event id 3），另有 `CLAIM_PREPARED` 和 `CONSENT_VERIFIED`，总 3 条；原 `FUNDED=1`，Claim=1，Issuer Hash=0。**没有第二条预留的数据库证据**。
- 已检查实际部署所用 `t1-intents/t1f-issue-ledger.mjs`：当 Claim 不再是 `CONSENT_VERIFIED` 而是 `ISSUE_UNKNOWN`、`ISSUE_HASH_BOUND` 或 `ISSUED` 时，`reserve` 直接返回 `created:false`、`recoveryOnly:true`、`sendAgainPermitted:false`，不生成新的 opId、Nonce、Calldata 或可提交交易。
- **停止规则**：截止时间已经过期（22:27:05 北京时间），即使浏览器仍保有第一次的 pending transaction object，也不可以点击「本人 MetaMask 发送唯一 Issue」。用户如实际已发，先提供来自 MetaMask Activity 的同一原操作公开 Tx Hash，再做只读链上恢复；如未发，只能保留 `ISSUE_UNKNOWN`，另行审计设计和授权恢复路径。严禁自行重置原 Issuer opId、Nonce、签名截止时间或重复 Fund/Issue。
- 本条仅更新 Handoff；**未修改任何 Render、Supabase、旧 CP30 Journal 或 Monad 数据**。

## 2026-10-23 22:28（UTC+8）：原始 Issue 截止时间已过（最新硬停止）

- 原始 Issuer `ISSUE_UNKNOWN` 的不可变 `issuer_issue_deadline=1792765625`，即 **北京时间 2026-10-23 22:27:05**；在 UTC+8 22:27:07 工具核对当前时钟时已经过期，**绝对不能再点击 MetaMask 的「发送唯一 Issue」**。
- 截止之后，真实 Supabase 二次读取仍为 `ISSUE_UNKNOWN`、`revision=2`、原唯一 nonce `0`、`issuer_tx_hash=NULL`、`receipt_block=NULL`、只有三条审计事件（`CLAIM_PREPARED`、`CONSENT_VERIFIED`、`ISSUE_RESERVED`），不存在重复 Claim/Fund 记录。**NULL Hash 不足以证明浏览器/钱包绝对没有广播交易。**
- 截止以后触发的独立真实 Monad Testnet 只读 Actions：[`39961919635` attempt 3](https://github.com/3956ray/MealForward/actions/runs/39961919635/attempts/3) **PASS**；UTC `2026-10-23T14:28:17.971Z`，区块 `73552746`：原 Unit 0 `Available=1`，未见 Issued，7,000,000 USDC 基本单位余额与 Liability 相等，`rpcWriteMethodsCalled=0`。即截至该链上检查尚未观察到成功发券；不排除待打包的原交易，需要核对 MetaMask Activity/Nonce。
- **此刻唯一人工问题：用户是否已经在截止时间之前点过「本人 MetaMask 发送唯一 Issue」？** 若点过，必须从 MetaMask Activity 找回**该**公开 Transaction Hash 并只读调查原链交易；不能重发。如果仅点过预留按钮，则当前应停止，保留 DB 不变，进入人工审计的单笔过期恢复方案设计。
- 严禁重置/改写 `issuer_op_id`、`issuer_issue_deadline`、`issuer_tx_nonce`，也严禁从另一钱包重发/补发、重新 Consent/Claim、重复 Fund/Settle；代码未实现安全恢复过期预留的流程，必须先在隔离 PG17 设计和验证补救方案，经单独人工审核授权后才允许实际修改。此前给用户的“有效期内可一次发送”条件已经失效。
- 这是 **HANDOFF 文档更新，不是生产代码变更或 Render 重部署**。所有正式 T1-F 操作应保持不继续，等用户提供是否发送/原公开 Hash 的证据，切勿猜测钱包状态。

## 2026-10-23 22:24（UTC+8）：真人已点击「一次性预留原始 Issue」— CRITICAL LIVE STATE

**当前高优先级真相：原 Claim 已永久进入 `ISSUE_UNKNOWN`；后续所有“先预留一次”的旧步骤均被此状态覆盖。请先读本节，再看历史发布文档。**

- 用户报告已亲自点击 T1-F Issuer 页「一次性预留原始 Issue」。同一轮实时 Supabase 只读证实数据库 Commit 真正发生：
  - Claim `fbab3b22-965d-44e2-b144-d7307b7aa8ea`
  - `stage=ISSUE_UNKNOWN`, `revision=2`, Voucher `0x170f16ef9ea00697bcfad635e33d521159db5e852b8b5499ddf8db819278b605`, Unit 0 / Generation 1
  - 唯一 `issuer_op_id=0x2e709dee8113d2dac73cbea53d016d6629fc3730c6f85325a17c98bc4777445b`
  - `issuer_tx_nonce=0`
  - **单次 Issuer Issue 的不可变截止时间** `1792765625` Unix 秒，即 **2026-10-23 22:27:05 UTC+8** (`2026-10-23T14:27:05Z`)。
  - 不可变 Calldata Hash `0x089cb2b0a35e81f31a9f9a658cd298ad7c9d3376ea01fac6fb77013451e1f0ed`，`issuer_tx_hash=NULL`，`receipt_block=NULL`，DB 更新时间 2026-10-23T14:19:28.799469Z。
  - 追加唯一 `ISSUE_RESERVED` 审计（event ID 3，时间 2026-10-23T14:19:29.012135Z）；历史 `CLAIM_PREPARED` 与 `CONSENT_VERIFIED` 不变。数据库仍只 1 FUNDED、1 Claim、1 VERIFIED round、3 audit events。
- **重要：数据库 Hash=NULL 只表示没有持久记录 Hash，绝不能推断钱包一定没有广播**；必须检查用户本人 MetaMask Activity 与链上原 Issuer Nonce/Hash。不可自动重复提交。
- **同期真实链上只读证据**：[GitHub Actions `39961919635` attempt 2](https://github.com/3956ray/MealForward/actions/runs/39961919635/attempts/2) 成功；UTC 2026-10-23T14:24:22 输出 Monad Testnet ChainId 10143、`eth_call` 只读原 T0 Runtime、Unit 0 `Available=1`、资金及负债都 7,000,000 base units、`issuedOnchain:false`、`rpcWriteMethodsCalled:0`。这说明该检查时尚未观察到上链 Issue，但**不是**对 MetaMask pending 交易存在与否的证明。
- **当下人工操作边界**：绝对不可再按「一次性预留原始 Issue」、不可创建第二份餐券/Consent、不可自行改掉原 opId/nonce/deadline/hash、不可刷新或关闭仍持有一次性 transaction payload 的浏览器标签页（如果仍在发送决策期间）。
  1. 若用户**仅预留、确认 MetaMask Activity 没有同 Issuer EOA / nonce 0 的 pending 或已发送原 Issue**，且在原交易有效期内、本人钱包与链 10143 正确，原页面尚持有唯一 `reservedTransaction`，可以经用户显式核对后由本人**仅一次** `eth_sendTransaction`；任何同 op 再次预留、拒绝/超时重发都不允许。此操作不能由 Agent 代执行。
  2. 如果已经点击过发送，无论有没有收到 Hash，都只能以 MetaMask Activity / Explorer 找回**原交易**；用户提供公开 Tx Hash 后，后端 `/v1/t1f/issuer/bind` 只绑定实际匹配的 from/to/nonce/calldata/chainId 记录，并 `/reconcile` 只读原 Receipt。
  3. 如果超过 **22:27:05** 仍未有效发送或未知，**禁止继续发送或重新预留**；原截止时间不可更改，重发原 calldata 会过期。保持 `ISSUE_UNKNOWN`，进入独立人工安全恢复设计（先核查是否有原链 Tx / Nonce 使用，再审查原 009–012 immutability 与数据保全），不得直接更新 DB 或再发券。当前来源未授权修改原 DB/回滚/发第二笔。
- 该状态更新**仅更改 `HANDOFF.md` 文档，不推送代码到正在运行的 Render，不触碰原资金、Nonce/DB 或 T0 合约**。
- 上一章的“用户可先预留/尚未预留”属于 22:19 之前历史快照，**现已作废**。所有新 Agent 在读到这个文档时都必须先实时查询这条 Claim，识别更进一步的 `ISSUE_HASH_BOUND` / `ISSUED` 或新增公共 Hash，再定下一步。
- T1-F 原合约 `issue()` 不链上校验 Recipient Consent，180s 强制冷却仍缺失，**商家 Settle 严禁开放**；旧 CP30 PREPARED #3560 永久隔离。

## 2026-10-23 21:28（UTC+8）紧急修复：T1-F 链接附加参数导致 HTTP 403

**最新核验结论：已修复并部署，真实公网验证 PASS；用户仍需自行重新打开页面。**

- **症状**：用户点击 T1-F Issuer 入口，浏览器报 `HTTP ERROR 403`，尚未登录、预留或发送链上交易。Render 免费服务未返回此请求的细粒度 request log，不能断言每次用户浏览器带了什么参数。
- **可复现的源码原因**：原 `t1-intents/t1e-claim-server.mjs` 在静态资源路由检查 `(u.pathname!=='/'&&u.search)`，对 `/t1f-issuer.html?utm_source=chatgpt.com` 无条件返回 403；先前的 GitHub Actions 新公网回归检查在旧线上版本**FAIL**：[`39961238421` attempt 1](https://github.com/3956ray/MealForward/actions/runs/39961238421/attempts/1)。
- **修复范围**：新增纯函数 `safeStaticQuery`，只允许 Issuer **HTML 页面**携带有限 `utm_source / utm_medium / utm_campaign / utm_content / utm_term`、无重复、无危险值、总长度不超过 400；原首页行为不变；JS、API 和任意 `wallet / claimId / next` 等 query 继续被拒绝。绝不通过 URL 指定身份、用户钱包或资金动作。
- **开发与合入**：Draft PR #40 源码提交 `f4a38344a391664fb9e649034c5305cc1ba125ca`；Stage 分支补丁提交 `c30a07d9f641d189cfb3632d57361639328dbda5`。受影响文件：`t1-intents/t1e-claim-server.mjs`、`t1-intents/t1f-issuer-live-smoke.mjs`、`t1-intents/t1f-static-query.test.mjs`、`.github/workflows/mealforward-t1f-first-issue.yml`。同一核心源码通过源分支 T1-F 协议/PG 和 Monad 只读 CI。
- **实际 Render 部署**：`mealforward-t1e-claim-laodao`，服务 `srv-dbdgstivcj2c73fnqcc0`，Deploy `dep-dbdm1di9lscs73c7nc8g`，**Live**，exact deployed commit `c30a07d9f641d189cfb3632d57361639328dbda5`。启动日志 `CLAIM_CONSENT`、`issuerTransactionEnabled:true`、`fundingEnabled:false`、`merchantSettlementEnabled:false`、`databaseConnected:true`。
- **部署后真实 HTTPS 回归**：[`39961238421` attempt 2](https://github.com/3956ray/MealForward/actions/runs/39961238421/attempts/2) **PASS**，`T1F_ISSUER_HTTPS_RELEASE_NEGATIVE_PASS`，22 个真实公网请求；验证原 HTML、`?utm_source=chatgpt.com`、多 UTM 参数都返回 200 且 HTML 内容一致，非允许 query 和 JS query 返回 403，未授权 Issuer 401，资金/结算拒绝，0 Claim 写入/0 链上交易。此前失败的第一次执行只代表**部署前**的旧代码，不是当前 Live 故障。
- **数据库再次实核**：唯一 `fbab3b22-965d-44e2-b144-d7307b7aa8ea` 仍 `CONSENT_VERIFIED` / `revision=1`，原 opId/Nonce/issuerDeadline/TxHash 均 NULL；1 条原 `FUNDED`、1 条 Claim、2 条审计和 1 条 Verified Consent Round，Supabase Advisor 无告警。**本次修复没有发放餐券或改变资金**。
- **下一位 Agent / 当前用户操作**：用户重新打开 `https://mealforward-t1e-claim-laodao.onrender.com/t1f-issuer.html`（也已兼容 `?utm_source=chatgpt.com`），只用原 Issuer `0x9747...aA2B3` 在 Monad 10143 进行 **SIWE 登录 → 核对原 Claim**。请务必停在此步，不点击一次性预留或交易发送。若仍见 403，请记录浏览器地址栏的 URL（删去秘密）、究竟在页面导航还是 API 请求时返回，以及 DevTools Network 的 HTTP status；不要泄露 Cookie/签名。无需再 Fund/Claim/Consent。
- **原安全界限完全不变**：原 StoreEscrow 不链上强制 Recipient EIP-712 授权，商家 Lock/Report/Settle 不开放，原 180 秒 settle 链上门槛问题 #17 未解决；旧 CP30 Journal `PREPARED #3560` 不碰。

## 最新实时发布与人工门槛（2026-10-23 19:25 UTC+8）

| Gate | 已实际确认的结果 |
| --- | --- |
| GitHub T1-F 开发 | [Draft PR #40](https://github.com/3956ray/MealForward/pull/40)，原始实现提交树 `3efd4632`，后续更新了正式公网安全测试；**不得合并 main** |
| T1-E staging 发布真源 | `codex/mealforward-t1e-recipient-claim-http-20261023`，正式源码 Release Commit `065d0ee5d824dbd0283387462fd0927c70f1aa67`；之后又有 Handoff/CI-only 提交。读取仓库真实 HEAD |
| Render 已上线版本（最新见上文） | **LIVE：`dep-dbdm1di9lscs73c7nc8g`**，部署 Commit `c30a07d9f641d189cfb3632d57361639328dbda5`；旧 `dep-dbdk7kcs728c73c8u63g` 是本次 403 修复之前的历史记录 |
| Render 安全模式 | `T1E_DEPLOYMENT_STAGE=CLAIM_CONSENT`，`T1F_ISSUE_WALLET_ENABLED=true`，`T1E_WALLET_TX_ENABLED=false`，`T1E_SETTLEMENT_ENABLED=false`；启动日志 `issuerTransactionEnabled:true`、`fundingEnabled:false`、`merchantSettlementEnabled:false`、`databaseConnected:true` |
| 真实外部 HTTPS 门禁（最新见上文） | **PASS** [39961238421 attempt 2](https://github.com/3956ray/MealForward/actions/runs/39961238421/attempts/2)，22 次部署后真实 HTTPS 请求，包括 Issuer HTML 带 ChatGPT UTM 参数、非法查询参数拒绝及未认证/资金接口负测试；0 Claim 写入/0 链上交易 |
| T1-E 原功能回归 | **PASS** [Actions 39945930678](https://github.com/3956ray/MealForward/actions/runs/39945930678) Consent HTTPS；[39945930713](https://github.com/3956ray/MealForward/actions/runs/39945930713) HTTP + Wallet；[39945930712](https://github.com/3956ray/MealForward/actions/runs/39945930712) PG17；[39945930697](https://github.com/3956ray/MealForward/actions/runs/39945930697) 原单券真实 Monad RPC |
| T1-F 新发券协议/DB CI | **PASS** [Actions 39945232839](https://github.com/3956ray/MealForward/actions/runs/39945232839) 独立 PG17 009–012 + Issuer HTTP/UI；[39945232632](https://github.com/3956ray/MealForward/actions/runs/39945232632) Monad public readonly |
| 最后真实 Supabase 核验 | 1 条 `FUNDED` 原资助；1 条 `CONSENT_VERIFIED` 领取 Claim（`revision=1`）；1 条 `VERIFIED` Consent Round、2 条 Claim Events；原 Issuer `opId/nonce/issueDeadline/txHash/receipt` **全部 NULL**；安全 Advisor 无 lints |
| **真正用户测试** | Recipient SIWE/Consent、Issuer SIWE 已由用户早前完成；**T1-F Issuer 页面登录、页面核对及 MetaMask `issue()` 尚未执行**，下一步必须用户亲自操作 |

> 重要：自动 CI 在代码提交后可能再次运行；“已验证”仅限上述精确运行。Root Handoff 的文档提交若发生在上表测试之后，须重新查 HEAD/CI，不要称文档提交为原应用部署 Commit。

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

**当前 Render T1-E LIVE** 是 `CLAIM_CONSENT` 且 T1-F 独立 Issuer-only 功能已经开启，具体部署、Gate 和数据库状态以上方「最新实时发布与人工门槛」为准；原环境已有 **私有的** T1E 双角色 DB 连接，Agent 不得提取或跨服务复制。

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

## 4. 唯一 Claim → Issue 状态机及失败恢复

`FUNDED (A)` → 受助者持久申请 `PREPARED` → EIP-712 本人领取授权 `CONSENT_VERIFIED`（**现已完成**）→ Issuer `ISSUE_UNKNOWN`（先记录 **独立 Issuer 交易截止时间**、唯一 Operation ID/Nonce/数据 Hash、从此不能重发）→ `ISSUE_HASH_BOUND`（只能将原链哈希独立比对后绑定）→ `ISSUED`（在 RPC Receipt、唯一 Issued Event、OperationExecuted、原 voucher、Bucket A→R 和链上余额/liability 核查后）→ **再另行设计领取凭证/商家核销**，现绝不操作 Settle。

事务/异常：
- 首次 `POST /v1/t1f/issuer/prepare` 校验 Issuer SIWE/Session CSRF、链上 `eth_getTransactionCount('pending')` 与原链只读证明后，`reserve()` 在同一 SQL 事务内更新唯一 Claim 与追加 `ISSUE_RESERVED` event，COMMIT 后**仅一次**返回 tx。
- 再次 Prepare 时看到 `ISSUE_UNKNOWN`，只返回 recovery-only，不生成第二笔、不返回可重新广播 calldata。
- MetaMask 仅用户显式点击 “本人 MetaMask 发送唯一 Issue” 调用 `eth_sendTransaction`。弹出后清除前端唯一发送载荷；页面退出或钱包拒绝，也只能在 MetaMask Activity 找回原 Hash 与 Nonce，绝不可“重试发券”。HTTP Bind/Reconciling 是读原交易，不创建新链 tx。
- `POST /v1/t1f/issuer/bind` 核对链 ID、from、to、nonce、value=0、calldata hash（不接受仅凭用户填的 Hash）。`reconcile` 用只读 RPC 查 Receipt/canonical block/events/accounting，成功才 CAS 更新 `ISSUED`，失败返回 UNKNOWN/PENDING/REVERTED 无重发。需要数据库交易与事件双重持久化和严格原数据一致。
- 若任何服务接入失败，不得凭感觉撤销已预留 Nonce。对其他后台账户或相同合约重新发券是高风险操作。

## 5. 现在停止自动工作：由用户本人开始 T1-F Issuer 页面验收

**交给新 Agent 时的下一步已收敛到用户必须参与的真人 Gate。** 已完成原 T1-F 代码开发、PG17 exact-script CI、Supabase 012 迁移、T1-E 兼容验证、旧版备份、灰度关闭模式、正式 Issuer 开启和 17 次外部 HTTPS 安全测试。**任何 Agent 都不应自行准备/广播 `issue()`。**

1. **先仅测试登录与读取：** 用户打开 `https://mealforward-t1e-claim-laodao.onrender.com/t1f-issuer.html`，连接原 Issuer 钱包 `0x9747...aa2b3` 且 Monad 10143，点「本人 SIWE 登录」签 EIP-191 登录证明，点击「核对原 Claim」。预期 `CONSENT_VERIFIED`、唯一 Claim ID / Voucher ID、尚无原 Issue Nonce/Hash，且仍不开 Fund/Settle。把页面脱敏输出回传，不发私钥/签名/Cookie。
2. **请先在这一步停下**，不要轻率点击「一次性预留原始 Issue」或「本人 MetaMask 发送唯一 Issue」；必须在 Agent 核对真人只读结果与最新数据库、Pending Nonce、链上原 Unit still Available、钱包 Gas 余额足够之后，才开始不可逆的一次性预留。**预留即固定唯一 Nonce/Operation，MetaMask 拒绝或超时也不能再建第二次。**
3. 之后由用户本人点击一次预留与单次 MetaMask `issue()`；Agent 仅核对公链原交易 Hash + Receipt/Canonical Block/Issued/OperationExecuted + Bucket A→R + USDC escrow 责任；成功才标 `ISSUED`。若钱包没有返回 Hash，先去活动记录恢复，**不可再发**。
4. 领取者是否符合资格、商家物理交餐、二维码 Lock/Report 和资金 Settle 属于后续完全不同的工程阶段；原 StoreEscrow 180 秒链上冷却 Issue #17 未修，严禁以 Issued 代表已出餐/结算。
5. **每次用户验收或新代码、配置、部署结束后立刻更新根目录 `HANDOFF.md`，同步真实记录/阻塞/可恢复的唯一下一步**；不允许只在聊天里交接。

### 快速安全回退（仅在尚未预留 Issue 时）

如新 Issuer 入口有安全异常，首先在独立 T1-E Render 设置 `T1F_ISSUE_WALLET_ENABLED=false`（仅变更公开开关；**绝不读取或覆盖私有 DSN**），确认自动触发部署且公网状态返回 disabled；仍保留 Claim/Consent/原 Fund 不变。如须恢复旧前端分支，备份为 `codex/mealforward-t1e-prerelease-t1f-20261023` `f786d08521f092bea5c8cff355c316dcd5591c79`，旧部署参考 `dep-dbdj1sqvcj2c73fuq1pg` `d5e0adf5`。对已 `ISSUE_UNKNOWN`/已发 Tx 的情况禁止删除 DB/重跑迁移/重建操作，必须先恢复原事务。

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
### 文档版本落点与历史兼容（2026-10-23）

- 旧 `docs/CP31-T1F-ISSUER-ISSUE-READINESS-2026-10-23.md` 现已加注“上线前历史 HOLD”，因此新 Agent 不应据旧句子误判当前 T1-F Issue 页面未上线；应先核对本文件的“最新实时发布与人工门槛”及真实 Render。
- 最新应用实测部署来源 **`f0cb951742c52f03e0a734c2424ffb715a52108f`**；之后 staging 分支的工作主要是**只改变 Handoff / Actions 期望模式，不改变链上逻辑**。如再次触发部署，应精确比对 Git tree、启动日志和只读状态。
- 人工测试前，仅停在 **Issuer SIWE 登录 + 核对原 Claim**；切勿由 Agent 或无人值守自动访问 Issuer Prepare，也不要让用户无意识地触发永久 `ISSUE_UNKNOWN`。
- 每个新的交付阶段仍要更新**根目录此文件**作为该阶段最后的文档动作；只改历史文件不算完成交接。
