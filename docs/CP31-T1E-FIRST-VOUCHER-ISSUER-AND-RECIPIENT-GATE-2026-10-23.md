# 留膳 MealForward · T1-E 第一张餐券发行资格与领取授权

日期：2026-10-23（UTC+8）  
开发分支：`codex/mealforward-t1e-first-voucher-readonly-20261023`  
**实际状态：原 T0 已成功 Fund 1 份、首张餐券可以链上模拟 Issue；没有真实 Issue、Recipient Claim、Lock、Report 或 Settle。**

## 1. 真实 Monad Testnet 只读证明

原 StoreEscrow：`0xcF0C8827C8610EEFF1ecbd9719E559d805FafE58`（Chain 10143）  
原 Circle Test USDC：`0x534b2f3A21130d7a60830c2Df862319e593943A3`  
原 Meal：`0x44f977bbf22112030199e42ccf232d08fe6e8223be9c274944c8a40671f6ae6b`，version 1，7 Test USDC  
原 Funding Quote：`0xd19b6ca862dc452dd13246bac6faba2d024ba7c59add7e614c6d3b9b54421e12`  
原 Funding Intent：`2b9ae6f1-2bb7-4096-8136-70f30f302eea`

### 源码和角色事实

- 原合约 `cp30-contracts/contracts/StoreEscrow.sol` 有 `issue`、`lock`、`markHandover`、`report`、`settle`，但其 `issue` 只由 `issuerAuthority` 调用，原函数 **没有 recipient 地址、没有领取钱包签名、没有 beneficiary consent 强制验证**。
- 链上注册的独立 Issuer Address：`0x9747D93d9F8C2e1202b4d922a4916fcF634aA2B3`。
- Original Owner / Receiver：`0xC4F8a468f10d5f98DCfF3282516125E97F26433b`。
- Operator：`0x3Dc9d4509062cBa2cFCB8edd3A8D656839A50165`。
- Quote / first self-funded donor：`0xcc5C1ce846c0302ab27a4811cf2e0E6FC7282952`。
- 角色地址不同，但不能由此断言真实的控制人、是否独立保管密钥或是否存在串谋。
- `settle` 并无链上强制 180 秒结算延迟（[Issue #17](https://github.com/3956ray/MealForward/issues/17)），因此**不得称商家资金释放机制已通过安全验收**。

### 读取的真实链上候选 Unit

独立、固定目的地、只读 Monad RPC，pin 原运行时 Code SHA 和原 Fund Receipt、原 QuoteUse 后，**在同一高度**读取 Unit、Batch、五桶 Accounting、合同角色和候选值，并重新读取区块 Hash 防重组。

- Funded units: 1；第一次 funded batch 合法、数量 1。
- Unit index：**0**；`Bucket.A`（Available），`generation = 0`，尚无 Voucher ID。
- `nextCandidate`：`available=true`，`unitSeq=0`，`nextGeneration=1`，Terms Hash 与原 7 Test USDC 菜单一致，`needsExpiry=false`。
- Escrow USDC Balance = **7,000,000** base units；Liability = **7,000,000**。
- 对真实注册 Issuer 的假想 `issue` 进行 **eth_call** 无写入模拟，返回 Voucher ID 与 Solidity 的确定性公式一致；使用 Quote donor 角色模拟同一函数会拒绝。
- **eth_call 并未发行餐券**，也不能证明 Issuer 私钥受谁保管。

可复现源代码：`t1-intents/t1e-first-issue-readiness.mjs`。  
独立 CI：[真实 Monad 候选 + issuer eth_call 模拟及 9 个协议测试 PASS](https://github.com/3956ray/MealForward/actions/runs/39893292164)。

## 2. T1-E 领取许可的非链上边界

`t1-intents/t1e-recipient-consent.mjs` 是 **离线验证库**。它只构造和验证独立于 FundingQuote 的 EIP-712 `RecipientConsent`，其 Domain 明确写有 `OFFCHAIN ONLY`，与原 Fund/Quote 合约签名无法互换。字段绑定：
- 已成功 `FUNDED` 的唯一原始 Intent；
- 固定 Escrow、Meal、Terms Hash、候选的 Unit 0 / Generation 1 / VoucherId；
- 与 Quote/Owner/Issuer/Operator/Catalog 全部不同的 recipient wallet；
- 由未来受限私有数据库预留的一次性 32 字节 Nonce；最长 10 分钟有效期。

验证还要求被签钱包与**服务端独立 SIWE 身份**一致，并由调用端明确提供已持久预留 Nonce 的证据。**纯密码学验证不等于系统已经建立受助者资格；该代码目前没有外部签名 API 或真实领取者记录。** 原合约也不能防范恶意 Issuer/Operator/Owner 绕过离线许可直接操作链上状态。

## 3. T1-E 新 Supabase 第 009 号私有迁移

文件：`t1-intents/supabase/009_t1e_first_recipient_issue_ledger.sql`  
名称：`mealforward_t1e_one_original_funded_recipient_nologin_v1`。

该迁移仅在源 Supabase Postgres17 中**恰好有原始 1 个 FUNDED Intent 且 2 个 CONFIRMED Wallet Attempt**，旧 T1-C 权限仍隔离时才能应用。

- 建立新 **private schema** `mf_t1e`；
- `mf_t1e.recipient_claims`：单一原 Unit/Generation 的唯一受助者 wallet + voucher + 原始 Intent + Nonce + EIP-712 digest/指纹绑定；
- 固定、不可修改的身份/Unit/Nonce 字段，状态严格按 `PREPARED → CONSENT_VERIFIED → ISSUE_UNKNOWN → ISSUE_HASH_BOUND → ISSUED` 转移；Hash 和 Nonce 不可替换，`BLOCKED` 终止；
- `mf_t1e.claim_events`：追加式事件表；禁止 Update/Delete/Truncate；
- 新独立角色 `mf_t1e_claim_runtime`：**NOLOGIN**；只授予 private Claim/Events 有限 SELECT/INSERT 与特定字段 Update，不可进入 T1-D Auth、Funding Ledger 或 T1-C；
- 对真实原 `FUNDED` Intent 的引用采用固定 Schema 的 `SECURITY DEFINER` insert gate，避免给新的 Claim Role 读取捐赠者财务库的权限；
- 无真实 recipient wallet、无私钥、无原始签名、无 Issuer 交易、无数据库 Claim 行被创建。

首次在 Docker 全新 PostgreSQL17.11 运行 **精确迁移原文** 的审计证明：重复 Claim 被唯一键拒绝、不同领取钱包不可改写、错误阶段不能越过、原 Issuer Nonce/TxHash 不可替换、无读财务权限、Append-only 审计生效。  
[CI 源 SQL + 隔离 Role + 原 Monad 只读双 Job PASS](https://github.com/3956ray/MealForward/actions/runs/39894449512)。

隔离的 Supabase project `ketfrukrcuosrqynnsay` 上已执行实际迁移，随后重新只读核对：
- `mf_t1e.recipient_claims=0`，`mf_t1e.claim_events=0`；
- 原始 `mf_t1c.intents=1` / `FUNDED=1`，已确认 wallet attempts 2，已签 Quote 1；
- 新 T1-E Runtime 默认 `NOLOGIN`，无权限访问 T1-C/T1-D 私有 Schema；
- 未改变既有 T1-D Render 的 Funding 部署、账户密码、原合约或冻结的 Mac CP30 PREPARED #3560。

## 4. 明确尚未完成的真实业务验收

1. 单独证明 **Issuer Authority `0x9747D93d...A2B3` 的真实钱包控制权**；Quote 钱包不是 Issuer，不允许冒用。
2. 证明一个真正独立的受助者测试钱包控制权及资格核对，先建立受助者持久 Claim Intent 与防重放 Nonce，再获得本人 EIP712 同意；不要把单纯的钱包控制证明当作贫困身份或核销事实。
3. 使用固定 Unit 0/Generation 1，以拥有独立 Issuer 私钥的真人钱包确认最多一次原 `issue`，事前在 T1-E Ledger 原子持久化 Issuer opId/nonce/Calldata Hash，UNKNOWN 时只恢复同一交易。独立 receipt 验证 `Issued` event、canonical block、Unit Bucket 从 A→R、Voucher ID 与原 Claim 一致。
4. 在领取者安全取券之后实现动态 QR、店家见证与 `lock`，分开 Operator/Owner 信任域、读回 receipt，并明确无法单凭链上数据证明现实出餐。
5. 先解决或明确标注原合约缺失的链上 **180s settlement delay**，然后才能开启 Report/Settle 的真实资金释放验收。不能由单一 Owner 后台软延迟冒充合约级保证。

### 重要

**已资助的 7 Test USDC 不可重复 Fund，也没有商家收款**。这一阶段是新的**发行能力与私有领取授权工程基础**，并非已完成真正的餐券领取或核销。
