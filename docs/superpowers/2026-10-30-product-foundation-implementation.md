# MealForward 新产品核心链路：实现与交接

日期：2026-10-30（UTC+8）。本文件接续[流程与接入方案](2026-10-30-product-flow-and-integration.md)，记录工作区中的实际实现。**这是独立的新产品候选版本，尚未上线，不是已部署的钱包测试版升级完成。** 本地基线 `1cddea335ea0de2b425af3d4af9e3721ff2604ba`，改动尚未提交、推送。

## 1. 已确认规则

用户已明确：**Claim 手续费由平台承担；领取人登录后点击领取即可。保存链接必须由领取时的钱包登录才能打开。** 因此保存链接只带餐券 ID，不是持有即可使用的凭证，也不是转让餐券的入口。

沿用已确认规则：内测领取间隔与券有效期均7200秒、正式均259200秒，按钱包跨商家计算；提前用餐不提前恢复领取资格；失败领取不消耗间隔。下架、资助截止、非营业时间和今日休息不阻断已资助餐食的领取。取餐受原券时段及有效期约束，过期未用份额回原池。改价改内容产生新版本，原付款、原用餐承诺保持不变。不设生命周期10份上限。

永久停业退款方向已确认；**长期未用退款期限、停业时有效券/锁定券/在途履约的处理仍未定案**，没有擅自采用半年或一年，也没有开放退款。

## 2. 实际交互及接口

所有接口位于独立 `/v1/product`，没有把原 `/v1/*` 或 `/v1/mvp/*` 转发到新模型。新入口为独立构建的 `/product-v2/index.html`。

| 用户动作 | 页面/弹窗与调用 | 结果及恢复 |
|---|---|---|
| 登录 | 先检查 `/identity/setup`，再 pre-session、SIWE challenge/login、`/me` | 商家归属由后台目录核验；账户变化清除私有内容；登录前选餐可恢复 |
| 商家登记 | 厨房设置 → `/registration-reviews` → `/registrations` → 本人钱包确认 | 最终回执确认后才具备厨房；登记本身不等于餐品上架 |
| 餐品管理 | 编辑弹窗保存 `/drafts/:id` → `/publication-reviews` → `/publications` | 草稿带revision；固定价格/内容摘要/时段/数量/期限；最终回执后公开新版本 |
| 补量/上下架 | 厨房设置 → `/merchant/supplements` 或 `/merchant/listing` | 明确钱包确认，仅改变新资助；原版本和已资助份额保留 |
| 资助 | 数量审核 `/support-reviews`；需要时单独 `/approvals`；再 `/support-intents` | 额度仅为本次金额，授权不等于付款；确认及发送前均核验实际allowance；后台原子预留库存 |
| 钱包写操作 | 原操作的 `/attempt` → 用户钱包 → `/hash` → `/reconcile` | 发起前持久化一次准入；返回hash先存原钱包恢复日志；UNKNOWN不重发；GET原操作也只核验原交易 |
| 我的支持 | `/orders` 与 `/approvals` | 原数量/金额/版本/交易状态；可查询、继续允许的原步骤，不能将授权成功显示为资助成功 |
| 自助领取 | `/claim-reviews` → `/claim-intents` → `/claims/:id` 或 `/claims/by-request/:requestId` | 明确确认才入队；平台worker承担Gas并签发；领取人无交易弹窗；成功券在 `/vouchers` 找回 |
| 保存及展示餐券 | `/vouchers/:id`、`/vouchers/:id/display` | 原钱包会话才可读取；保存链接不带秘密；短码最多120秒且不越过原时段/有效期，数据库存HMAC |
| 商家验券 | `/merchant/check` → `/merchant/locks` | 检查不消费；必须先取得唯一处理权，才能实际交餐；不同终端不能分别锁住同一份餐 |
| 交餐 | 锁定成功后明确已交餐 → `/merchant/handovers` → 商家钱包确认 | 同一操作从AWAITING_HANDOVER变PREPARED；签短时EIP712许可；确认后待结算，不重新发券 |
| 处理恢复 | `/merchant/operations`及原操作GET；必要时 `/:id/resume` | 原session才能继续交餐；原商家钱包换设备后须明确确认上一设备停止，转移原锁；不新建交餐操作 |
| 结算 | `/merchant/payouts` → `/merchant/settlement-reviews` → `/merchant/settlements` | 链上交餐后180秒才可结算；审核原金额/收款地址，商家本人确认；单次支付 |
| 营业信息 | GET/PUT `/kitchens/:id/settings` | 营业时间、纯文本公告、今日休息；按北京时间跨日自然恢复，不修改券时段或停掉领取 |

未发送的普通操作可明确取消；已发送或结果未知的操作只恢复原交易。商家处理锁不自动按时间释放：取消需要后台核验适用的最终链状态；已签许可还需证明过期。链上公开 `expire` 不受后台锁阻止，最终EXPIRED证明可用于显式清理未发送责任，不能用本机时间释放UNKNOWN。

商家历史、验券和结算 DTO 不返回领取钱包/长期秘密。私密接口依赖钱包会话，不信任请求正文或自定义钱包header。

## 3. 源码结构

- 合约：[ProductCatalog.sol](../../mvp-contracts/contracts/ProductCatalog.sol)、[ProductFunding.sol](../../mvp-contracts/contracts/ProductFunding.sol)、[ProductEscrow.sol](../../mvp-contracts/contracts/ProductEscrow.sol)。前两个是抽象模块，最后一个是本地候选生命周期合约。多商家、不可变餐品版本、多份资助、平台领取、唯一代次、过期返池、短时商家许可、180秒结算及金额守恒已有实现。旧合约未改动或迁移。
- 后台目录：[product-v2](../../t1-intents/product-v2/)。`service`负责草稿/目录/资助；`publication`负责登记/发布/补量；`approval`负责精确额度；`claims`负责平台发券/原钱包餐券；`redemption`负责处理锁/交餐/结算；`kitchen-settings`负责营业信息。各wire模块核对完整交易字段和固定目标。
- [runtime.mjs](../../t1-intents/product-v2/runtime.mjs)组合独立SIWE、权限、各业务及平台outbox；[host.mjs](../../t1-intents/product-v2/host.mjs)提供独立HTTP/static host工厂。默认关闭；导入不会监听端口、建表、加载密钥或启动worker。已有线上entrypoint没有切换到这个host。
- 新会话仅使用 `__Host-mf_product_v2_*` cookie、`x-mf-product-v2-*` header。共享 `auth/core.mjs`只增加这一组完整命名空间白名单，旧默认及旧两组MVP保持原样。新auth-store将固定查询限定在新schema。
- 新前端：[catalog-entry.jsx](../../t1-intents/mvp-client/catalog-entry.jsx)、[catalog-product.jsx](../../t1-intents/mvp-client/catalog-product.jsx)、[kitchen-product.jsx](../../t1-intents/mvp-client/kitchen-product.jsx)、[voucher-product.jsx](../../t1-intents/mvp-client/voucher-product.jsx)、[merchant-product.jsx](../../t1-intents/mvp-client/merchant-product.jsx)。编辑/金额审核/发布/原操作仍用弹窗，主要角色业务用页面内导航。`product-wallet.mjs`统一严格交易核验、唯一发送和原hash恢复。
- 继承原样式，新增仅作用于新入口的 `catalog.css`，手机导航可横向滚动；状态文案不显示原始券枚举。旧客户端源码、样式及构建产物保持独立。

继续复用锁定React、Wagmi/Viem、OpenZeppelin、Playwright；浏览器交易guard复用父项目已锁定Ethers 6.15.0，构建附其许可证。没有升级依赖、安装新技能或为了替换状态代码引入XState/TanStack。

## 4. 并发、权限与运行约束

`mf_product_v2`是独立结构。`schema.sql`仅已应用在一次性本地PostgreSQL，不是已执行的Supabase迁移。`mf_product_v2_runtime`为无登录/无管理员权限角色，只有新表所需SELECT/INSERT/UPDATE；RLS开启，无DELETE/TRUNCATE/DDL及旧schema访问。生产登录、角色关联和正式迁移尚未配置。

启动时 `permissions.mjs`实际检查角色flags、继承/成员关系、schema与表权限、RLS、列授权和可调用函数，不仅相信角色名称。`runtime`还要求经核验的新部署目标、Monad Testnet 10143、原测试USDC `0x534b2f3a21130d7a60830c2df862319e593943a3`、正确权限地址及链上policy与后台一致。领取预算必须明确；资金入口不能在必要领取/结算能力缺失时开放。

当前持久层用单行JSON状态与 `FOR UPDATE`保证跨进程原子性，验证了库存、领取资格、券责任和钱包未决操作的竞争。它是正确性基础，**尚未完成高并发容量、实体拆分/索引、保留清理和生产备份恢复验收**。

平台worker只消费用户已确认的QUEUED请求：先在数据库保存经严格核验的签名包/原hash，再提交SEND_UNKNOWN，之后最多广播一次。费用与总交易预算均受限；重启后查询UNKNOWN。原签名包仅在私有状态中，最终确认后删除，不出现在API、日志或交接。自动查询和用户签名/付款严格分开。

后台处理锁是持久的链下业务责任，不是新增链上锁。原钱包在不同session明确接管只改变原锁session；UNKNOWN不能接管、取消或返池。结算列表同时返回已验证链时间及可结算时间，前端倒计时不代替后台180秒判断。已确认本地券还能挡住落后链快照重新分配同unit；仅到期未用且无责任的下一代可排队。

## 5. 链适配与真实上线前尚缺

已经实现并在Anvil验证领域层接口；**生产链适配器仍未交付**。`chain.ci.mjs`中的同块目录、metadata摘要、完整交易、事件、canonical/finalized回执、allowance、券与权限查询是可参考的真实本地实现，不能直接把测试脚本当成生产worker。

需要先完成：

1. 新合约审查和部署规格、固定runtime/code/asset/authority/policy证据；正式长期退款规则落实前，当前候选不宜承接真实资金。没有自动部署或迁移许可。
2. 生产投影与可靠链适配：每份unit索引、版本/批次及履约汇总、回溯/reorg、超时和有界查询；不能只返回 `verified:true`。
3. 独立平台签名服务、Gas资金/预算、outbox轮询及监控/恢复；`tickClaims()`须由明确配置的worker调用，不能把GET查询改成重签重发。
4. 正式Supabase迁移与最少权限登录，实体索引/容量、备份/恢复；随后完成HTTP＋真实PG＋链的联合隔离验收。
5. 原Site其余产品表面：图片上传与摘要、商家正式审核、公共账与支持履约汇总、附属页面及完整视觉适配；NFT继续明确演示/真实能力区别。当前候选不是原Site所有页面的最终替换。
6. 受控发布、真实浏览器钱包验收。真实签名由用户本人明确点击；旧两笔SETTLED与旧CP30环境不需要重做或迁移。

工厂使用方式是先构建新前端，再将已审核的pool、chain、origin、policy、预算及图片摘要传给 `makeProductHost`；调用方显式监听独立端口并调度worker。此处不提供指向现有线上库/真实signer的可直接启动配置。

## 6. 验证与复现

以下命令从仓库根目录运行。使用既有锁定依赖；构建前需要父项目与mvp-client依赖均已安装。

```sh
/Users/mili/.foundry/bin/forge test --root mvp-contracts --summary
node --test t1-intents/mvp/http.test.mjs t1-intents/mvp-runtime.test.mjs t1-intents/product-v2/*.test.mjs
node t1-intents/product-v2/postgres.ci.mjs
node t1-intents/product-v2/chain.ci.mjs
npm --prefix t1-intents/mvp-client test
npm --prefix t1-intents/mvp-client run build:catalog
npm --prefix t1-intents/mvp-client run test:catalog:browser
```

最终验证：合约 **47/47**；后台及旧API/runtime回归 **101/101**（新产品84、旧17）；前端 **102/102**；独立构建通过。三种证据严格分开：HTTP测试使用真实SIWE签名与SQL double；PostgreSQL脚本使用真实受限角色/数据库和合成链证据；Anvil脚本使用真实合约/交易与内存领域存储。**没有冒称全栈联合或线上真人钱包验收。**

已确认通过：合约47项（39新、8旧，256轮fuzz）；真实临时PG权限漂移、会话一次性消费、库存/Claim竞争、回滚与持久outbox；真实临时Anvil注册/发布/补量/精确授权/18份资助/平台付Gas领取/原钱包查券/商家处理与180秒结算/下架后领取；390px和1440px隔离浏览器。旧API/runtime回归与新前端测试分别记录，不把测试模型当线上成果。

浏览器使用合成API、全新profile，覆盖12份审核、40份草稿、私有/公开分离、今日休息、Claim未知恢复、原钱包链接、短码和退出；零page error。最近证据 `/var/folders/9y/_gzp7rc975z1g51l_2mszz0m0000gn/T/mealforward-product-browser-s1j7tC`，临时证据可能被清理，可由测试再生成。

## 7. 云端边界、未决事项与回退

本轮起始只读核对：GitHub `3956ray/MealForward`，分支 `codex/mealforward-t1f-phase6-release-review-20261026`，PR47 open/draft，远端head `3d1486a73935c819ee5ff5ce0e95f2bf63f5f7c1`。Render service `srv-dbdgstivcj2c73fnqcc0` / workspace `tea-db7q3ou7bikc73bp2bt0`，live commit `a7f4c84dfa02aacd458dcd19cca0abddb8671aaa`，deploy `dep-dbhlh4mc6qcc73fo4nog`。原入口 https://mealforward-t1e-claim-laodao.onrender.com/mvp/product.html 。

Supabase `ketfrukrcuosrqynnsay` 的原 `mf_mvp_usdc.state` 两笔仍SETTLED，revision10/9，fingerprint `408e76f0c970880598786deeb7bfb39c` / `517254d2bdad4ef3dffc14ab23806c39`。没有第三笔业务、云写入、生产迁移、新部署或真实钱包操作。本轮没有重新进行线上完整钱包验收。

本批为工作区未提交源码，不影响当前线上服务；不需要回滚旧环境。移除新host/独立构建即可停用候选入口，不能删除用户旧工作或回退整个HANDOFF。若将来发布新合约，必须保留已部署合约和原债务/历史，新旧版本不能自动搬移。
