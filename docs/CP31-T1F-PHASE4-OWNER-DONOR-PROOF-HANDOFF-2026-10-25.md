# CP31 / T1-F Phase 4 — Owner & Donor 独立 SIWE 钱包控制证明

> **状态（2026-10-25 UTC+8）：真实 Render Role Proof 入口已 LIVE，21 次公网匿名安全检查通过，等待 Owner 与 Donor 两名实际钱包的人为验收。仅 EIP-191 钱包控制证明，**不等于真实 EIP-712 恢复批准、不代表用户已经授权新 Issue，不能影响原始资金和旧 Claim。

## 工程真源、线上部署和隔离边界

- GitHub `3956ray/MealForward`，开发草案 [PR #44](https://github.com/3956ray/MealForward/pull/44)，分支 `codex/mealforward-t1f-phase4-owner-donor-proof-20261025`，基于 Phase 3 [PR #43](https://github.com/3956ray/MealForward/pull/43)。
- 最小范围上线分支 `codex/mealforward-t1e-issuer-original-tx-verifier-20261023`，只引入 Role Proof server 和 Phase4 HTML/JS/CI 文件，**不将 PR #43 的真实 013–015 发券恢复源码部署为运行时**。旧备份分支 `codex/mealforward-t1e-proof-before-phase4-20261025` @ `a35f97d3743d91424fa9b5a202e6ad20c831aaa6`。
- Render 工作区 **LaoDao** `tea-db7q3ou7bikc73bp2bt0`，服务 `srv-dbdeuft9fdbs73atbvh0`，公网 `https://mealforward-t1e-role-proof-laodao.onrender.com/t1f-phase4.html`。已 Live 的启用部署为 `dep-dbf0ti9srm7s73bcm5j0`，来源代码 Commit `c382884c0a22413acded671d2e2f292e7bd63aec`，`T1F_PHASE4_PROOF_ENABLED=true`。前一道 flag=false 灰度部署 `dep-dbf0sj0m7kps73fcbs70` 已安全通过。
- 该服务独立 `T1E_DEPLOYMENT_STAGE=ROLE_PROOF_ONLY`；`T1E_CLAIM_WRITES_ENABLED=false`、`T1E_WALLET_TX_ENABLED=false`、`T1E_SETTLEMENT_ENABLED=false`。启动状态 `T1E_ROLE_PROOF_ONLY_READY`、`noFinancialWrites=true`、`noDatabaseConnected=true`。无 Supabase、无 signer、无 Issue/Fund/Settle 路由；EIP-191 签名只在进程内短时验签，不产生 Session Cookie、不存原签名、无账户绑定持久化。
- Supabase **未触及**：项目 `ketfrukrcuosrqynnsay` 依然仅 012 个旧迁移；013 Review、014 Slot、015 双签 Release 的真实 DB 表均不存在。原唯一资助 `FUNDED=1`，Claim `fbab3b22-965d-44e2-b144-d7307b7aa8ea` 仍为 `ISSUE_UNKNOWN`、revision=2、issuer nonce=0，原首次过期截止 `1792765625`、TxHash=NULL。绝不修改旧 Claim、旧 CP30 Journal `PREPARED #3560` 或原 StoreEscrow。

## 安全设计与测试

- `t1-intents/t1f-phase4-proof.mjs`：基于 `viem/siwe` 构建 SIWE 格式个人消息，用 EIP-191 `verifyMessage` 检查签名者，严格绑定 Origin、Monad Testnet Chain 10143、固定 Owner/Donor、role statement、challenge UUID、唯一随机 Nonce、180 秒时间窗；挑战单次消耗（错误签名也销毁），全局每分钟 40 次、最大 32 个未完成，超出 429。角色测试替代仅允许显式 CI+localhost，生产由代码固定钱包地址。
- `t1-intents/t1e-role-proof-server.mjs`：服务端开启开关才暴露只读 Phase4 状态、一次性 challenge/verify 端点，以及独立静态页面；支持有限 UTM 的 HTML 链接，**不允许**钱包/Claim/redirect 参数注入，JS 和 API 查询参数始终被拒绝。旧 T1-E Issuer/Recipient 控制证明未改变。
- `t1-intents/public/t1f-phase4.html` / `t1f-phase4.mjs`：复用留膳原视觉体系，Owner/Donor 分开操作；用户先显式选择 MetaMask 钱包，再本人 `personal_sign`；签名前后独立核查 EOA 和 ChainID。钱包切换标记历史 PASS 而非声称当前账户仍登录。**没有 EIP-712 恢复签名、链上写 RPC、客户端持久 Session 或 token Approve**。
- `t1-intents/t1f-phase4-proof.test.mjs`：Node 22 真实合成钱包 EIP-191 / SIWE 消息验证、双角色独立控制、伪造、重复、超时、来源/查询篡改、429；旧 Issuer/Recipient 证明的回归也在 CI 通过。
- `t1-intents/t1f-phase4-live-smoke.mjs`：外部 HTTP，不收集任何真实签名；[开启后公网检查 40201405357](https://github.com/3956ray/MealForward/actions/runs/40201405357) **PASS，共 21 个请求**，确认新的 HTML/JS 和无 session／无数据库／无 EIP712／无 Fund/Settle/Issue。关闭阶段 [40201073953 attempt 2](https://github.com/3956ray/MealForward/actions/runs/40201073953/attempts/2) PASS。
- 源码及旧功能回归 [40201405346](https://github.com/3956ray/MealForward/actions/runs/40201405346) PASS。所有原 Role Proof 代码基线保留。

## 人类测试（本轮停止点）

1. 打开 `https://mealforward-t1e-role-proof-laodao.onrender.com/t1f-phase4.html`，确认服务标注 `PHASE4 PROOF ONLY`、无资金/发券/结算。
2. 切换 MetaMask 至 Monad Testnet（Chain ID 10143），选择 **原 Owner EOA** `0xc4f8a468f10d5f98dcff3282516125e97f26433b`，点击「本人 SIWE 控制证明」并核对仅为钱包控制消息，按本人判断确认 `personal_sign`。预期 `T1F_PHASE4_OWNER_CONTROL_PROVED`，页面 `PASS`。
3. 再切换到独立 **原 Donor／Quote EOA** `0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952`，重复同样的非交易 EIP-191 证明。预期 `T1F_PHASE4_DONOR_CONTROL_PROVED`，最后 `2/2`。
4. 用户只提供两项 `PASS` 的脱敏文本结果和是否遇到换账户问题。**不要发送原始签名、私钥、助记词、Session Cookie、数据库密码或真实个人信息**。如果无法控制任一 EOA，应安全停止并报告，不要为通过测试临时换地址或绕过密码学验证。

> 注意：这两次 EIP-191 是钱包控制证明，**不是** Phase3 的 Owner+Donor EIP-712 Recovery Release。这一步不启动任何新 Issue，也不证明第二笔交易授权已取得。用户 Phase4 通过后下一开发阶段仍需单独审查并授权 013/014/015 migration、独立双审批持久服务与 Issuer 单次发送 Gate。

## 故障与回退

若真实 EIP-191 钱包证明出现错误或角色混淆，立刻在**独立** `srv-dbdeuft9fdbs73atbvh0` 设置 `T1F_PHASE4_PROOF_ENABLED=false`（只更改本服务的环境开关）并核对 Render 自动部署、证明页面关闭、原 T1-E 仍正常。必要时使用旧备份分支 `codex/mealforward-t1e-proof-before-phase4-20261025` 作代码回退参考；绝不回滚 Supabase 迁移、不触碰资金。

完成任何开发、部署、实际人工验收或回退都必须更新仓库根目录 `HANDOFF.md`，注明准确 Source Commit、实际 Render Deploy/Env、CID、CI PASS/FAIL 和下一步新 Agent 能独立执行的操作。
