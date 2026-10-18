# MealForward · Monad Testnet 真人钱包预检与真实 E2E 阶段清单

**当前测试入口：** https://mealforward-d1-offchain-staging.mealforward-lab-3956ray.workers.dev/wallet-preflight

**正式状态：** Monad Testnet **只读钱包预检**，不代表智能合约交易闭环已经接通。这页没有钱包签名、发送交易、Approve、合约部署或旧 CP30 操作。之前已通过的 Off-chain 三角色 D1 验收记录继续有效，不能视为 USDC 成功。

## 本轮请用户亲测

| 编号 | 测试 | 预期结果 | 可分享的证据 |
|---|---|---|---|
| M0 | 手机打开网址，确认标题为“Monad Testnet 钱包预检” | 页面可正常加载，不显示模拟 Fund 成功 | 设备、浏览器、截图 |
| M1 | 点击“连接测试钱包” | MetaMask 请求连接账号权限；显示当前公开钱包地址；**无需签名或支付** | 钱包地址前后 6 位 |
| M2 | 点击“检查 Chain ID” | 已切换时显示 0x279f / Monad Testnet | Chain ID |
| M3 | 若在别的网络，点击“切换到 Monad Testnet” | 钱包确认切换；不会发送交易 | 成功／错误代码 |
| M4 | 点击“查询当前钱包 Gas 余额” | 非负 MON 余额，足够与否由部署/交易 Gas 预算另行确定 | 余额数值 |
| M5 | 填入**经过审核的 Monad Testnet 测试 USDC 合约地址**，点击 ERC20 验证 | 合约确有字节码、decimals=6、显示余额；**合约存在与符号并不足以验证是否为可信 USDC** | Token 地址／余额／错误 |
| M6 | 点击“复制预检结果”并回到 ChatGPT | 可粘贴非敏感 JSON，不包含私钥、签名或会话 Cookie | 预检结果 |

**注意：** M5 必须确认准确的测试资产地址。不要自行转账买币，不要向陌生合约 Approve，不要输入助记词或私钥。如果钱包余额为零，只记录该事实，不影响完成只读验收。

## 后续真实链上 E2E 必须另设实际验收阶段

| Gate | 实际证明 | 当前是否完成 |
|---|---|---|
| T0 | Monad RPC 10143、用户钱包 Gas/ERC20 准备 | RPC CI PASS，真人钱包待测 |
| T1 | **全新** S0b 合约与独立后台权限/Quote Signer，合约地址 + code hash + immutable constructor/资产检查 | BLOCKED：尚未部署 |
| T2 | 用户真实测试钱包 Approve（必要时）并调用 Fund，核对 Tx/Receipt 和订单 | BLOCKED |
| T3 | 不同领取者身份的 Issue 真券；全链 Ticket 不重用；My Meals 与真实交易一致 | BLOCKED |
| T4 | 商家 Check/Lock/MarkHandover/Report 和链上各阶段收据 | BLOCKED |
| T5 | 商家 Owner 真实 Settle 交易，链上原资产精确到账、前后余额/Tx Hash 对账 | BLOCKED |
| T6 | 钱包 A/B 私密业务隔离、刷新/断网/UNKNOWN 幂等恢复、异常窗口重试 | BLOCKED |

### 对合约的特别限制

原 `cp30-contracts/ThreeStoreFactory.sol` 会**一次性创建三个不可新增的固定商家合约**；不是与 D1 Mock 页面上的“建店按钮”直接兼容的动态商户注册。原 `StoreEscrow.sol` 的 Fund 还要求独立 Quote Authority 签名和 EIP-712 参数，后续 Issue、Lock、Report、Settle 依赖其它独立角色与原始期限/条款。不能简单将 D1 的模拟订单替换成 `eth_sendTransaction`，也不能随意把原商家或 operator 的钥匙放到 Cloudflare Worker。

正式 E2E 必须为新测试环境建立*真实独立部署 manifest*、全新权限主体、非公开的签名密钥保管、持久化业务 Intent/Journal 及可验证的链上完成证据。原本机 CP30 尚未完成的 Ledger COMMITTED→ACK 操作依然冻结，不可重启/迁移/重放。

本轮用到的开源代码：
- `monad-e2e/wallet-preflight.html`：钱包交互，仅 `eth_requestAccounts`、切链、`eth_chainId`、`eth_getBalance`、`eth_getCode`、`eth_call`；
- `monad-e2e/preflight.mjs`：无凭证网络只读 CI 检查，验证链 ID 10143 与实时区块高度；
- `staging-d1/worker.mjs`：在同一独立 Cloudflare staging Worker 暴露 `/wallet-preflight`，Offchain D1 流程保持不变。

测试期间只要遇到链 ID 143 (Monad Mainnet)、要求真实转账/代币授权、未经审核的合约地址或要求复制私钥，立即停止。
