# MealForward / 留膳 — T1-B 真人 PASS 与 T1-C 资金 Intent 持久化交接

日期：2026-10-21（UTC+8）

## 1. 最新真人验收结果

用户在修复 EIP-712 Domain 后的独立 Render Static Site 上，已经亲自完成 **T1-B Quote Authority Control Proof PASS**。

- Monad Testnet Chain ID 10143、同一份 StoreEscrow：
  0xcF0C8827C8610EEFF1ecbd9719E559d805FafE58
- MetaMask Quote Authority（Account 2）：
  0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952
- 用户当时读取的测试钱包余额：9.83294520474 Test MON，91.5 Test USDC，对新 Escrow 已有 Allowance 0。
- 当前合约原餐品 7 Test USDC，上架、未暂停、未关闭，累计 0 份已资助，剩余上限 10。
- 用户的新 EIP-712 T1RoleControl 挑战返回：
  PASS：Quote Authority 的 EOA 控制证明。
- 挑战属于不同 Domain，**不是 FundingQuote 付款授权**；签名未保存、未上传、未重放。没有实际 Approve/Fund。
- T1-B 首轮 FAIL 是 MetaMask V4 缺少 EIP712Domain 的前端编码 Bug；已通过跨 MetaMask/ethers 测试修复。T1-B 第二轮真人通过，PR #27 已记录。

## 2. T1-C 交付范围

新增独立目录 t1-intents，只处理 **新 T0 Testnet escrow** 的不可变资金操作意图；与原 Mac CP30 的私有数据库、签名 Journal、PREPARED #3560、历史 7 USDC、Render Auth Pilot 和已部署链上资产完全隔离。

- schema.sql：PostgreSQL 17.11 中的新 mf_t1c Schema，精确锁定 Chain ID 10143、Escrow、Meal、Terms Hash、原单价 7000000 base units。数据库唯一约束绑定每个验证钱包的 idempotency_key、quote_id、原始 TX Hash、(chain,payer,nonce)，并以触发器拒绝任意 Quote 身份/数量/金额更改、跳阶段、覆盖原钱包 TX、重写或删除审计日志。
- core.mjs：必须由未来受审查的 HTTPS/SIWE Server 注入已验证钱包主体。客户端无法单纯提供钱包地址获得权限；**当前未提供任何对公网开放的 HTTP 入口**。同一 ID 的并发请求只生成一个随机 Quote ID，数量/金额不可换，EIP-712 FundingQuote 必须确实由链上 Quote Authority 签名。仅存签名指纹与 Digest，**不存裸签名与密钥**。
- 原状态机：
  PREPARED → QUOTE_BOUND → APPROVE_UNKNOWN → APPROVED → FUND_UNKNOWN → FUNDED / FAILED。
  第一次操作必须在弹出钱包之前插入 PG wallet_attempt 行；只允许一份原始钱包 nonce、原始 to 和 calldata 哈希。UNKNOWN / REVERTED 不会自动重签或换 nonce 付款。
- bindOriginalHash：只读链上原交易；必须逐项比对 from、to、nonce、value、data digest、chain ID 才能保存 Hash，Hash 只是 locator，不是支付成功。
- receipt.mjs：只有原交易 receipt 已确认并匹配区块 Hash / 原交易、真实 Approval 日志及 Allowance，才承认 Approve。只有确切 Funded 事件、ERC-20 Transfer、Quote Use、Escrow 余额和 Liability 成立，才承认 Fund。若 RPC pending、重组、日志不符或余额不符则留在 UNKNOWN，不标记成功；原交易 Revert 则进入 FAILED 并拒绝自动重发。
- recovery-second-process.ci.mjs：从全新 Node 进程重新连接同一数据库，读到已提交的 UNKNOWN，证明同一 nonce 不能再预留第二笔交易。此脚本只能运行在 GitHub Actions 的全新 Disposable PG17。
- core.test.mjs：真正的 PostgreSQL 17 数据库 CRUD/锁/并发/进程恢复测试；其 onchain tx/receipt 输入为**合成 RPC 证据**，不会广播。
- GitHub Workflow：单独生成全新 postgres:17.11 容器，固定本机数据库名称、连接串和强制环境门禁，安装独立锁定依赖并运行测试。不会触碰已有 Render PostgreSQL、原 Mac、本地用户钱包或任何真实链上资金。

## 3. 实际测试证据

[GitHub Actions：T1-C 真实 PostgreSQL 17.11 16/16 PASS](https://github.com/3956ray/MealForward/actions/runs/39600176281)

独立测试验证：
- 24 个并发 Prepare 请求只生成一个 Intent / Quote ID；
- 24 个并发 Approve 预留只允许一个原操作；
- A/B 钱包跨账户访问失败；
- EIP-712 原始 FundingQuote 签名和数据内容严格匹配；
- 测试钱包 nonce、spender、金额、calldata 哈希无法替换；
- UNKNOWN 在第二个 Node 进程真实重启后仍不允许重发；
- 过期 Quote 不能悄悄续期；
- Receipt 不完整、Approval 或 Funded/Transfer 事件缺失或账本不守恒不会转成功；
- 原已确认 Receipt 可重复读取而不会重复改变资金状态；
- PG 审计日志不能 UPDATE/DELETE/TRUNCATE；
- 服务无公共 HTTP listener、无私钥、无钱包发送接口。

## 4. NOT YET ACCEPTED / 真实出资限制

**T1-C 是隔离的资金 Intent 核心候选，不是已经部署的资金服务器。**

1. 目前还没有部署隔离持久 PG 服务到云上。Render 免费数据库配额已经被 Auth Pilot 使用，不得复用原 CP30 或现有生产 Auth 数据库、也不能自动产生付费资源。
2. 没有生产级最小权限数据库角色、独立不可回滚签名 Journal/Anchor、真实服务故障转移、跨容器持续可用测试。当前 Audit trigger 不等于对恶意 DBA 不可篡改的外部 Journal。
3. T1-C 正向 Quote 签名测试使用由 CI 生成的临时钱包地址（只用于合成证据）；真正的 Quote Authority 仅完成了无付款效力的 T1-B 真人签名。实际可执行 FundingQuote 及签名生命周期仍待权限审查。
4. 用户目前仅提供 Quote Authority 钱包余额，不等于独立资助者钱包已核实。真正 Fund 前需要独立 Donor、Quote 及商家角色隔离验收。
5. 没有在 Monad Testnet 广播任何 Approve 或 Fund，也没有真实 Funded Receipt / 7 Test USDC Delta / Issue / Settle 证据。
6. 现有 StoreEscrow 在链上没有强制 180 秒 Settle 冷却；Issue #17 未关闭。不能把平台延迟当作不可绕过链上规则。
7. G1 原 CP30 Mac PostgreSQL 和 Journal 仍保持冻结，未开展恢复、重启或迁移。Render SIWE Auth Pilot 会话不是原 CP30 的业务身份。

## 5. 下一门禁

继续 T1-C Server Integration：独立受审查的 Auth Principal Binding、HTTPS/CSRF、独立 PG 持久部署、角色/Quote 签发的最小权限和单写者、重启后的已广播交易只读恢复、真实只读 RPC 负面测试。完成后再请用户从独立测试资助者钱包亲自批准一份 7 Test USDC Approve/Fund；每笔有独立明确授权且先通过实际服务回执门禁。

不要要求用户重新做 T0 Deploy、重复无付款效力的 T1-B 签名，也不得因 16/16 测试通过就自动启用资产写入。
