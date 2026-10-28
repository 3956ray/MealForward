# 留膳 MealForward T1-E — 独立 Issuer／受助者钱包验收服务

日期：2026-10-23 UTC+8。此文件是截至本分支最新状态的验收和交接说明。**新的 T1-E 站点只验证钱包控制权，不会领取、发券、锁券、划款或结算**。

## 真实资金背景（已完成，不要重复转账）

原 Monad Testnet Chain 10143，原 StoreEscrow `0xcF0C8827C8610EEFF1ecbd9719E559d805FafE58`，已经有 1 份真实 7 Test USDC FUNDED（Intent `2b9ae6f1-2bb7-4096-8136-70f30f302eea`）。独立链上／数据库验收：[T1-D 第一次 Funded 证据 PR #35](https://github.com/3956ray/MealForward/pull/35)。

原 Issue candidate：Unit 0、nextGeneration 1；独立 `eth_call` 证明注册的 Issuer `0x9747D93d9F8C2e1202b4d922a4916fcF634aA2B3` 在当前条件下可调用原 `issue`；这**并不**表示用户掌握 Issuer 钱包，也不表示已经发生 Issued Event。

## 新的公网 ROLE_PROOF_ONLY 服务

- 网址：**https://mealforward-t1e-role-proof-laodao.onrender.com/**
- Render service：`srv-dbdeuft9fdbs73atbvh0`，workspace `tea-db7q3ou7bikc73bp2bt0`。
- 独立 Free 计划、Singapore、AutoDeploy OFF；初次部署 `dep-dbdeugd9fdbs73atc1bg` **LIVE**，Render 应用启动日志 `T1E_ROLE_PROOF_ONLY_READY`。
- 公开 UI：`t1-intents/public/t1e-role-proof.html`, `.css`, `.mjs`；独立 server：`t1-intents/t1e-role-proof-server.mjs`。
- 固定 Origin，不反射追踪参数，支持 ChatGPT 入口追加的 `?utm_source=chatgpt.com`，保留 CSP frame-ancestors、no-store、X-Frame-Options。
- 角色证据是**一次性 EIP-191 personal_sign，180s 有效，仅当前进程内存保存挑战**。Server 验证签名是否恢复至链上注册的 Issuer 或独立受助者测试钱包；验证后删除 challenge，同一 challenge 重放 409；错误人冒充 Issuer 返回 403/401；Origin 欺骗返回 403。
- 用户完成签名会得到 `ISSUER_WALLET_CONTROL_PROVED` 或 `RECIPIENT_WALLET_CONTROL_PROVED`，这**只证明签名时持有相应钱包**；没有创建登录 Session、Claim 或 Voucher，也没有给私人领取资格。
- 服务启动时严禁任何数据库 DSN、管理员 DSN、旧 T1-D 数据库连接或资金签名私钥；严格限定 `T1E_DEPLOYMENT_STAGE=ROLE_PROOF_ONLY`，`T1E_CLAIM_WRITES_ENABLED=false`、`T1E_WALLET_TX_ENABLED=false`、`T1E_SETTLEMENT_ENABLED=false`。
- 绝不会调用 `eth_sendTransaction`、`eth_signTypedData_v4`、`approve`、`issue`、`fund` 或 `settle`。

### 独立复测证据

- [本地模拟 EIP-191 端到端 6/6 PASS](https://github.com/3956ray/MealForward/actions/runs/39905334836)。验证签名一次性、Issuer 冒充拒绝、跨站请求拒绝、钱包切换以及所有资助／领取／结算路由拒绝。
- [真实 Render 公网 HTTPS EIP-191／禁止资助 16 路由 PASS](https://github.com/3956ray/MealForward/actions/runs/39905766867)。CI 使用一次性**合成钱包**做受助者签名，没使用真实 Issuer 私钥；所以真实 Issuer 的控制权仍需真人测试。
- [原资助 Unit 真实 Monad 只读发行条件、受助者 EIP-712 与独立 PG17 双 Job PASS](https://github.com/3956ray/MealForward/actions/runs/39905766887)。

## Supabase T1-E 新的独立 Auth Schema 已准备

原隔离 Supabase project：`mealforward-t1-staging`（`ketfrukrcuosrqynnsay`）。此前第 009 条迁移已创建 `mf_t1e.recipient_claims`、`mf_t1e.claim_events` 和 `mf_t1e_claim_runtime NOLOGIN`。

本轮通过真实 PostgreSQL 17 CI 后，**应用第 010 条迁移** `mealforward_t1e_independent_issuer_recipient_siwe_nologin_v1`，源文件 `t1-intents/supabase/010_t1e_auth_nologin.sql`。它只新增：
- 私有 `mf_t1e_auth.schema_version`, `pre_sessions`, `challenges`, `sessions`；
- 独立 `mf_t1e_auth_runtime NOLOGIN`；
- 禁止 T1-C、T1-D 和 T1-E Claim 用户角色的跨 Schema 访问、暴露 Data API。

实测角色 `mf_t1e_auth_runtime` 和 `mf_t1e_claim_runtime` 都是 **NOLOGIN、NO SUPERUSER、NO BYPASSRLS**，前者无法进入 Claim/原金融库，后者无法进入 Auth；旧 T1-D Auth/Fund 也无法读取 T1-E。第 010 条迁移后数据：T1-E Session **0**、Claim **0**、Claim Events **0**，原 T1-D FUNDED Intent **1**、CONFIRMED Wallet Attempts **2**，不修改任何余额或签名。

**下一段不是立即开资金写入：** 两个新角色必须由 Mac Owner 本地授权激活并私密配置。未经该操作，不应以 T1-D 旧连接字符串冒用新的 Auth/Claim 身份。须单独开发和部署经过登录／审计验收的领取服务。

## 现在需要 Owner 做的两只钱包真人验收（不需要数据库密码）

1. 直接打开 `https://mealforward-t1e-role-proof-laodao.onrender.com/`，确认状态 `ROLE_PROOF_ONLY`。测试网 Chain ID **10143**。
2. MetaMask 选择**原链上注册 Issuer** `0x9747D93d9F8C2e1202b4d922a4916fcF634aA2B3`，点击「连接并证明 Issuer」。仅签署写有 `NOT A LOGIN. NOT A FUNDING QUOTE` 的一次性 `personal_sign`。PASS 为 `ISSUER_WALLET_CONTROL_PROVED`。
3. MetaMask 切到一只与 Issuer/Owner/Quote/Operator/Catalog **完全不同**的受助者测试钱包，点击「连接并证明受助者」，签署另一条钱包控制消息。PASS 为 `RECIPIENT_WALLET_CONTROL_PROVED`。如页面提示切换账户后重新证明属正常：每次证明是独立的一次性验收。
4. 可以将两次 PASS/FAIL 的简短状态和公开测试钱包地址发给工程 agent；**不要发送私钥、助记词、原始签名、Challenge、Cookie 或任何真实受助者身份信息**。
5. 如确实没有独立 Issuer 钱包私钥或控制权，不要尝试换用 Quote 或 Owner 钱包，直接回复「Issuer 无法控制」。后续必须处理真正的角色 custody，而不能为了让测试 PASS 在服务端放宽地址限制。

## 为什么还不能真实发券／结算

当前 T1-E 已有独立受助者 EIP-712 Consent 验证库、私有 Claim SQL、Issuer 原始交易的只读 Receipt 验证器，但还没有将新 Auth／Claim Role 激活、将领取业务 HTTP 融合与真实钱包写入 UI 上线。这一阶段的真人测试**不会移动那 7 Test USDC**。

原 StoreEscrow 的 `issue()` 函数没有接收 beneficiary 钱包或 Consent 签名，系统只能在额外信任域提供离线授权，恶意 Issuer 可能绕过；不能误称受助者身份链上强制。原 `settle()` 同样缺少链上 180 秒 cooldown（[Issue #17](https://github.com/3956ray/MealForward/issues/17)），因此仍然禁止商家真实结算、出款。

**T1-D Render `srv-dbd0nl67bikc73a5grh0`、原 T0 合约、旧 T1-C、Mac CP30 PREPARED #3560 和测试 USDC 历史均未被这个独立 T1-E 服务改动。**
