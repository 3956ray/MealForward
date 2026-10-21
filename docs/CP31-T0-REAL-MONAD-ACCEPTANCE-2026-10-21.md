# MealForward（留膳）Monad Testnet T0 真实链上验收

**状态：T0 = PASS（用户本人钱包部署 + 独立公共 RPC 只读复核）**

日期：2026-10-21（UTC+8）。本文件只记录真实测试网的**公开资料**，不包含任何私钥、助记词、签名、Session、领取者身份或私人餐券码。

## 1. 真实合约和原始交易

| 字段 | 已验证值 |
| --- | --- |
| 网络 | Monad Testnet / Chain ID `10143` |
| Contract | `0xcF0C8827C8610EEFF1ecbd9719E559d805FafE58` |
| Deployment Tx | `0xa04240fd813a0a1a00ed72b67a689de050c58b64418e6e5ffa81303848510839` |
| Block | `72934128` |
| Token | Circle **测试** USDC `0x534b2f3A21130d7a60830c2Df862319e593943A3` |
| Test meal | 留膳社区厨房 / 暖心盖饭 / 7 Test USDC / version 1 |
| Source SHA-256 | `bd84f387a46428802a453f28306ad6f9de7317465ff48844619d550713ce0c66` |
| Creation bytecode SHA-256 | `9c2583ee25a9fc08aa2434efde455ee7fc0c945847d3ef7789dfd370735d7a8d` |
| Deployed runtime SHA-256 | `31417d9cdf4bd883f5a07d717cfeee368758f23190dc6d2ec41b30c3d676c6c8` |
| Terms Hash | `0x0ec28ec279f5a4b4321da6d4b1698fea8e57cd8a64743de02677c73cb86a9222` |
| Store ID | `0x2223042f7e703817452b19d4c11bd8fe08427ef8c4325f0e9cf798d78da5201a` |
| Meal ID | `0x44f977bbf22112030199e42ccf232d08fe6e8223be9c274944c8a40671f6ae6b` |

### 五个链上注册的地址（由原始构造交易的 ABI 输入解码）

| 权限 | 地址 |
| --- | --- |
| Owner / Deployer / Receiver | `0xC4F8a468f10d5f98DCfF3282516125E97F26433b` |
| Quote Authority | `0xcc5C1ce846c0302ab27a4811cf2e0E6FC7282952` |
| Catalog Authority | `0x41DCBFED391b79FAC7B2951dD136c6B7e1384259` |
| Issuer Authority | `0x9747D93d9F8C2e1202b4d922a4916fcF634aA2B3` |
| Operator Authority | `0x3Dc9d4509062cBa2cFCB8edd3A8D656839A50165` |

五个**地址互不相同**。这**不证明**五个私钥由独立主体保管，也未证明 Quote/Issuer/Operator 钱包持有人能够并愿意执行后续操作；未来 T1/T2 必须分别验收。

## 2. 真实证据与时间

1. 用户提供 T0 页面原文：`VERIFIED_NEW_ROLE_SEPARATED_ESCROW_T0`，交易区块 `72934128`，显示 167 个确认，原 Source/Bytecode/Runtime/Terms Hash 和资产、价格均符合上述值。页面显示 `onchainSettlementDelayEnforced: false`。
2. **独立 CI（真实 Monad Testnet RPC）**：GitHub Actions [39586282192](https://github.com/3956ray/MealForward/actions/runs/39586282192) 在 2026-10-21 10:40 UTC 左右，通过 Ankr 公共 Monad Testnet RPC 独立抓取原交易、解码构造参数，重新编译原 `StoreEscrow.sol` 并核对 receipt、区块、字节码、角色 getter、餐品条款和资产。输出 `T0_INDEPENDENT_PUBLIC_RPC_PASS`、当时深度 1837、`writesSent: 0`，固定回归测试 8/8 PASS。
3. **可下载的完整公共 Manifest**：GitHub Actions [39586604870](https://github.com/3956ray/MealForward/actions/runs/39586604870) 在该分支最终重新运行并成功，输出 `T0_INDEPENDENT_PUBLIC_RPC_PASS`，当时深度 2355，Artifact：`mealforward-t0-independent-public-proof`（内部 `T0-public-attestation.json`）。所有公开构造参数由原始链上交易解码，不依赖浏览器录入值。
4. 公共 RPC 曾返回 429；新的只读验证器已限定 Ankr / Monad 两个公开端点、降频、有限重试，并且**只允许 eth_chainId、eth_getTransactionByHash、eth_getTransactionReceipt、eth_blockNumber、eth_getBlockByNumber、eth_getCode、eth_call**，不得发送签名或交易。

## 3. 已接受与未接受的 Gate

**T0 已完成：** 全新隔离测试网合约的用户本人 Deploy、源码与构造参数一致、五个不同的链上权限地址、真实 Receipt、运行时字节码、餐品条款、确认深度和独立只读复核。

**未完成 / 不得声称通过：**

- Quote/Catalog/Issuer/Operator 的实际独立私钥控制与权限签名验收。
- 该合约的 Funded、Issued、Locked、HandoverMarked、Reported、Settled、Refunded 真实资金和餐券 E2E；本轮只验证部署。
- 真实受助者身份、动态 QR/领取授权、商家出餐事实。
- 原 `StoreEscrow.sol` 未在链上强制 180 秒结算延迟（Issue #17）；这不是前端提示能替代的强制规则。
- Render Auth Pilot 的 SIWE Session 不能等同于原 CP30 业务 Principal；G1 原 Mac 业务源未接入，原 `PREPARED #3560` 和旧资金依然冻结。
- GitHub Actions 使用的是公共 RPC 的区块深度与当时 canonical block Hash，**不是**跨独立共识节点的最终性证明。

## 4. 下一阶段执行原则

T1 前先只读校验：合约链上余额、测试资助者 USDC/MON、Allowance、五种 Authority 的控制与授权方法、原链上条款是否仍对应。不能凭部署成功就自动调用 Approve/Fund。优先为**全新测试网**建立独立持久 Operation/Intent 日志和 UNKNOWN 同一操作恢复，并处理/明确接受 180 秒链上结算限制。

只有上述门禁满足、明确使用测试资产且用户本人在钱包确认时，才能继续 T1 真实 Fund；不得把 T0 的 Deploy 成功当作完整 MealForward G4/G5 资金闭环。

**保持隔离：** 原 Mac CP30 数据、Journal、Source Pins、旧 7 USDC 和原订单未访问、未备份恢复、未迁移、更未重签或重发。
