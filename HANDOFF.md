# MealForward（留膳）— Agent 一读即接手 · HANDOFF

> **本文件是当前项目唯一的高优先级跨 Agent 接手入口。** 从仓库根目录打开 `HANDOFF.md`，先核对实时 GitHub / Render / Supabase，再继续任何开发。此文件随每次开发、迁移、部署和用户验收更新。历史 `docs/agent-handoff-2026-10-16/` 与原 CP30 合同不得当作 2026-10-23 的实时云状态。
>
> **更新日期：2026-10-29（UTC+8）**。状态在新提交和链上交易后可能变化；引用的是当时已实际查到的资源，不能把未来状态当真。
>
> **当前状态：已按用户指定的 Three Stores Sites v8 前端修正并发布到 /mvp/product.html，等待一次第二张券真人验收。原站作为视觉来源保持不变；当前仅清禾测试厨房接通，另外两家明确未开放。第一笔SETTLED及6操作记录保留；同一既有USDC/合约，不新部署。** 以下最新记录优先于历史阶段。







## 2026-10-29 钱包优先登录（源码候选，未发布）

最终源码 `78345f223cc594b6e236a5043cec2c45733f785d` 已独立复审通过；27 客户端、5 runtime 本地检查通过，构建 `352203334c9e32785dc0`。修复共用身份路径下倒计时冻结、延迟退出清除新会话，以及等待登录时退出按钮的误导状态。CI / 部署 / 真人钱包验收仍 pending。完整证据见 [钱包登录验证记录](docs/superpowers/2026-10-29-wallet-first-verification.md)，操作见 [第二张券验收](docs/superpowers/2026-10-29-second-voucher-acceptance.md)。下段为实施过程记录，最终候选以本段为准。

产品入口新增显式钱包选择、连接和 SIWE 登录，Product 持有唯一会话；按服务端角色进入对应工作台，切业务时隔离工作状态。账户、网络或断开变化清除身份及操作状态；领取页仍无需钱包。原 Three Stores CSS 与图片未变。修复产品工作台计时与退出登录并发，退出响应完成前禁止新登录。钱包操作中退出按钮显示等待并禁用，防止误以为退出已执行。构建 352203334c9e32785dc0；客户端 27 项、runtime 5 项本地通过，含显式登录、拒签重试、角色门禁、旧响应及跨业务隔离测试。独立审查、当前 SHA CI、发布及真实钱包验收均 PENDING；线上仍为下述 d5d4b23 部署，不代表此候选已上线。未操作云、数据库、钱包或链。下一步独立复核、通过 CI 和发布门禁后再安排用户本人测试。

## 2026-10-29 10:41 正确 Three Stores 前端已发布

- 用户指定原站 https://mealforward-three-stores.ochre-jelly-7528.chatgpt.site/ ，Sites project appgprj_6aca52912fa0819182f9619176eac3e5 v8，源码 e412ae14d6b92453634a0036f9aac986dcc821ac。此前仓库src/App.tsx不是用户意指的原始前端，本次纠正。直接复用原CSS、三张照片、碗标与首页/店铺视觉；原Sites未改动，模拟业务状态未迁入。
- 正式测试入口：https://mealforward-t1e-claim-laodao.onrender.com/mvp/product.html 。私密领取仍/mvp/product-recipient.html。产品与API同源。仅清禾厨房连接固定Owner，另两店未开放。
- 部署commit d5d4b233f9c5e5dedf0a977f7bcb73089197528f（应用d69fc87532fc6cedf75e0f081487b8b8d3837c52）；build f4a26c2e103256e1eb9d。Render dep-dbhb44afngtc73b5lst0，2026-10-29 10:41:12 UTC+8 live；service srv-dbdgstivcj2c73fnqcc0 / workspace tea-db7q3ou7bikc73bp2bt0，autoDeploy off，writesEnabled=true。后续文档commit不改变运行版本。PR47仍draft未合并。
- 本地22客户端+5runtime PASS，构建与生成资源一致；独立审查/修复复审PASS。修复首页滚动重置业务编号、原图映射，补全3JPEG线上精确校验。桌面首页/卡片/商家及390px商家/领取页面浏览器检查通过；本机静态预览无后台，不能当真人登录成功证据。
- 同SHA CI：MVP https://github.com/3956ray/MealForward/actions/runs/40807604982 PASS（含双券PG+Anvil完整流程），兼容 https://github.com/3956ray/MealForward/actions/runs/40807605002 PASS。公网smoke16资源含3JPEG精确字节/类型、网络10143、既有USDC、权限拒绝及旧Phase8 ISSUED均PASS。内置浏览器公网导航工具超时；未声称公网浏览器MetaMask验收通过。
- 发布后只读实库仍只有business1 SETTLED/revision10/data指纹408e76f0c970880598786deeb7bfb39c，6原操作。没有创建business2，没有数据库迁移/配置变化/合约改动/钱包签名或交易。
- 下一步用户仅做一次第二券测试：Owner商家工作台登录→业务记录确认第一笔→创建下一笔并签报价→Donor授权/捐赠7→Issuer发券/私密链接→Owner验码交餐→180秒→结算。每步核对第2笔，正常5笔交易及登录/报价签名。验收第二券SETTLED、商家+7USDC和第一笔保留。详细docs/superpowers/2026-10-29-second-voucher-acceptance.md。无需重新部署代币或合约。
- 回退：该次仅呈现与固定静态资源allowlist变更；有资金/状态异常关闭MVP_WALLET_ACTIONS_ENABLED，保留查询与原hash恢复，不能重置记录/重发UNKNOWN。仍单商家/7USDC/串行/10份上限。


## 2026-10-29 Three Stores 前端修正（源码完成，未发布）

本地产品入口复用 Sites v8（git e412ae14d6b92453634a0036f9aac986dcc821ac）的 CSS、餐食照片、碗标、首页及三厨房卡片视觉；第一家连接既有单商家流程，其余两家未开放。业务控制器及后端未改，领取保持无需钱包。来源图片为 Sites 原始示意图，三张照片已加入公网 smoke 字节及 JPEG 类型核验。构建 f4a26c2e103256e1eb9d；本地客户端 22 项及 runtime 5 项通过，真实钱包验收、CI、部署均未运行。公网仍是下节所述旧部署；需独立视觉和安全复核、CI 后才能发布。无数据库、合约或钱包操作。

## 2026-10-29 02:50 原始产品入口已上线，等待第二张券本人测试

### 入口与版本
- 产品入口：https://mealforward-t1e-claim-laodao.onrender.com/mvp/product.html 。复用原始品牌、首页餐盘、导航及src/styles.css；原src旧模拟入口未替换，真实流程在同源产品入口。
- 私密领取页：/mvp/product-recipient.html（由Issuer生成带业务编号的私密链接）；旧/mvp/setup.html、merchant.html、recipient.html及无scope API固定第1笔，不能用于新业务。
- 应用commit **5c7b21451d75d103a3445de1641c96d73ee9e7c4**（功能c3d1d6e+测试清理修复），client build **6d05e07775e6a859901e**。
- Render **dep-dbh47dflk1mc73evolhg**，2026-10-29 02:50:17 UTC+8 live；service srv-dbdgstivcj2c73fnqcc0、workspace tea-db7q3ou7bikc73bp2bt0，原分支，autoDeploy off。MVP_WALLET_ACTIONS_ENABLED=true，公网核验已生效。
- Draft PR47：https://github.com/3956ray/MealForward/pull/47 ，未合并。本文档后续commit不改变上述实际应用部署。

### 已完成验证
- MVP CI https://github.com/3956ray/MealForward/actions/runs/40748486255 PASS（含合约既有门禁、21客户端、后台/运行时/旧入口20检查及PG+Anvil连续双券和清理）；兼容CI https://github.com/3956ray/MealForward/actions/runs/40748486591 PASS。
- 独立审查和修复闭环完成；原重复/me CSRF竞争已移除。运行时+客户端+链上接口对齐。详细证据docs/superpowers/2026-10-29-second-voucher-verification.md。
- 公网 mvp-live-smoke PASS：13静态资源精确一致、10143/固定USDC、writesEnabled=true、未登录及跨域拒绝、新业务接口未登录401、旧Phase8 ISSUED保留，0钱包动作。
- 本机IAB原始首页和商家入口视觉检查已完成；IAB打开公网及重新绑定均工具超时，因此不声称公网浏览器钱包验收通过。直接公网HTTP完整检查通过，最终真人操作待用户。
- 云迁移20261028184428_mvp_sequential_businesses、schema2，runtime TLS/最少权限及安全advisors PASS。发布后只有第1笔，SETTLED/revision10/data指纹408e76f0c970880598786deeb7bfb39c；原6操作指纹48457edd692dc32b55527297715b430c（排除新增business_id列）保持。没有创建第2笔，没有代签或代发。

### 用户下一步（只需一次）
新入口进入商家工作台，以Owner登录；进入业务记录→创建下一笔业务→第2笔签报价；再切Donor登录第2笔授权及捐赠7USDC，Issuer登录发券并生成私密领取链接，领取人打开后生成码，Owner商家验码、本人发送确认交餐，链上180秒后本人结算。无需新部署，初始支持者余额77.5USDC。每次切角色后核对第2笔及钱包身份。正常5笔交易，另有消息签名。详细步骤docs/superpowers/2026-10-29-second-voucher-acceptance.md。最终以第二券SETTLED、商家余额增加7和第一笔不变为准；尚未验证真实第二笔。

### 回退与范围
单商家、单份7USDC、同一时刻一笔未完成业务，合约生命周期10份上限；到顶拒绝新建。数据写入异常关闭MVP_WALLET_ACTIONS_ENABLED，保留查询与原hash恢复；不得回退旧无business scope写程序、删除记录或另发替代交易。旧合约/Phase8结算限制不变。现有工作树保留继续处理验收反馈。

## 2026-10-29 发布门禁：迁移已完成，等待CI清理修复

应用提交c3d1d6e已推送。云迁移mvp_sequential_businesses实际版本20261028184428已应用，schema2；专用最少权限runtime通过TLS连接和verifyRuntime核验，Supabase安全advisors无lints。第一笔data指纹408e76f0c970880598786deeb7bfb39c/revision10、原6条operation排除新增business_id列后的指纹48457edd692dc32b55527297715b430c完全一致，没有第2笔业务或待发送操作。

Render关写部署dep-dbh43rnlk1mc73evg000已live，公网writesEnabled=false确认。GitHub旧兼容40747874011 PASS；MVP40747874892的合约/前端/后台/双券业务断言均PASS，但测试清理DROP DATABASE WITH FORCE触发Linux Node22闲置连接error，因此整个CI必须记FAIL，不能发布。修复仅测试脚本：先关闭HTTP与连接池、非强制删除临时库，对database-in-use做有限重试，保留业务及清理错误。公网仍旧程序且关写，等待新CI全绿后发布产品入口。

## 2026-10-29 原始前端与第二笔业务开发完成，发布验证进行中

已实现独立businessId、Owner显式创建下一笔、全局单一未完成业务和合约10份上限；旧无编号路由永久对应第1笔。新API /v1/mvp/businesses及/businesses/:id/*，操作/领取凭证隔离。动态读取候选券与捐赠批次绑定，核验累计账目和每一历史已结算券，不移除资金检查。新入口 /mvp/product.html，私密领取入口 /mvp/product-recipient.html；原始src/styles.css逐字复用及原首页/导航/餐盘组件视觉复用，旧接口/模拟登录未迁入。既有钱包单次发送逻辑复用，准备摘要自动滚入视图。

本地当前验证：20项后台/运行时/旧入口检查、21项客户端测试、一次双业务PG+Anvil完整流程PASS；第一笔记录不变，第二笔seq1，跨业务凭证拒绝，并发创建200/409，旧路由不能读取第2笔操作，180秒前拒绝结算。receipt最多20 RPC（第10笔上界44，预算80）。原始首页真实浏览器视觉检查完成，但MetaMask真人测试未开始。独立backend/chain/frontend接口审查通过；审查发现重复/me导致CSRF竞争，已修复并加单一/me测试。client build 6d05e07775e6a859901e。

预发布实库第一笔SETTLED/revision10，data指纹408e76f0c970880598786deeb7bfb39c；原6条operation完整行指纹48457edd692dc32b55527297715b430c；Phase8原operation指纹0fa8942bd38048d9274cfdabefadea85（按row文本排序）。迁移只新增business_id=1及新约束，验证原operation需排除新增列再比较。计划migration mvp_sequential_businesses将schema_version升为2，必须先确认MVP写入关闭。已请求Render关闭MVP_WALLET_ACTIONS_ENABLED并触发dep-dbh43rnlk1mc73evg000，当前仍需确认live。尚未应用云迁移、推送本轮应用或部署产品入口，GitHub CI与公网验证PENDING。不要据本节提前要求用户操作。无新业务创建/签名/广播。后续写入只使用v2程序；出现问题关闭写入，不能把支持新业务的数据交回旧无scope写程序。

## 2026-10-29 完整MVP真人验收通过

用户商家页面显示“测试餐款已结算”。只读实库 mf_mvp_usdc.state=SETTLED，redeem和settle均CONFIRMED，Owner nonce15、16。公开RPC独立检查两笔receipt status=0x1，from固定Owner、to新USDC escrow 0x2ab15b22860323c02c90664fb8c39406a93eab54，区块hash匹配canonical，观察finalized 0x4785e84超过两笔回执区块。

- 交餐tx：`0x5b377bf926302eb095c8b021095201a9617834731b5cdc464839a115ac3abb8b`；block0x47842fa，timestamp1793203626。
- 结算tx：`0xea19dba1abaaca02e0509ce65f356c9605ef9945fe3da6fbc7855b8ae0421b4a`；block0x47846c0，timestamp1793203921。
- 两笔区块时间间隔295秒，满足180秒要求。固定已有USDC 0x534b2f3a21130d7a60830c2df862319e593943a3 的Transfer事件：新escrow→Owner商家，7000000最小单位=7 USDC。独立历史balanceOf读取结算前一块40000000、结算所在块47000000，即40→47 USDC。

本次范围的一笔测试网完整业务验收完成，无需重跑初始化、捐赠、发券。领取/验码根据用户实际页面与已完成交餐流程；交餐为商家声明，不声称独立证明现实用餐。保留此SETTLED记录，不重置或发替代交易。后续产品扩展另定范围；旧合约结算限制继续保留。应用仍6a05bf7、部署dep-dbh0afon74is73dhpdt0，本轮只读核验及交接文档，无签名、广播、迁移或重新部署。

## 2026-10-29 商家交餐已准备，待本人发送

用户已核对取餐码，页面显示确认交餐摘要，Owner nonce15。只读实库确认 redeem=PREPARED、tx_hash=null，无settle。源码 app.jsx 的发送按钮紧接摘要 Nonce 下方，与摘要共用 PREPARED && transaction 条件；应向下滚动寻找“本人打开钱包，发送这笔确认交餐交易”。尚未检查用户实际浏览器，不能认定按钮确实已显示；若滚到底仍无按钮，需要截图定位。不要重新准备或发券。用户本人发送并核验后才开始180秒等待，再结算。本轮无应用变更、无代发、无部署。

## 2026-10-28 真人捐赠与发券完成，进入领取及商家验收

用户准备页显示餐券已签发、Donor余额77.5 USDC。只读查询实库 mf_mvp_usdc.state 为 ISSUED，escrow 为 0x2ab15b22860323c02c90664fb8c39406a93eab54；operations 中 escrow、approve、fund、issue 均 CONFIRMED，无 redeem/settle 记录。本轮依据后台已核验记录及用户页面回报，没有另行独立查询链上回执。

- approve: `0x7a798cf84fbe7fa0a9e547599cfdf45aa025d04ecb416b3830b65a261f63d6b2`
- fund: `0xe2000ec5e9a0125ecac056a4a590be3e708b625e259f8ec965b3f77f6c171cd9`
- issue: `0x8c5101fb19a98f4261fdb25dd7679796d21978821e7477c751a4988eb837e611`

下一步保持 Issuer 登录生成私密领取链接，由另一个浏览器或手机打开并领取；Owner 登录商家工作台后，再生成有效期最多120秒的取餐码，扫码或输入六位码检查。Owner 本人准备并发送确认交餐，核验后等待链上180秒，再准备并发送结算。无需重复捐赠或发券；不记录私密链接或取餐码。完整MVP仍待交餐、结算回执和商家USDC到账验收。本轮仅只读查询与交接更新，应用仍为6a05bf7，不重新部署。

## 2026-10-28 23:44 USDC餐券合约真人部署成功，进入Donor测试

用户回报tx `0x5f92ce86e23abf40b9f34e1be3186b1f9463e1f20ce5d269f873bbda7138e92f`。公开RPC独立核对chain10143、from固定Owner、to=null、nonce14、receipt status0x1；创建合约 **0x2ab15b22860323c02c90664fb8c39406a93eab54**，回执block0x4782f4c，观察finalized0x478311d已超过。浏览器网页抓取不可用，结论来自RPC及后台，不是用户报告单独推断。

实库mf_mvp_usdc只有escrow操作CONFIRMED，tx匹配，state=READY、token固定旧测试USDC0x534b2f3a21130d7a60830c2df862319e593943a3、escrow匹配上述地址。Owner报价signature存在（不读取/记录原始签名），deadline1793203913，即北京时间2026-10-29 00:11:53；当前仍有效。没有approve/fund/issue/redeem/settle操作，尚不能称为全MVP验收成功。

下一步用户在原准备页切换Donor0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952并重新登录，准备并本人发送授权7 USDC，等CONFIRMED，再准备并本人发送捐赠7 USDC。达到FUNDED后Issuer发券；无需重部署或重签已有效报价。Agent本轮仅只读核验与文档更新，无预留/签名/广播。应用仍6a05bf7、部署dep-dbh0afon74is73dhpdt0，不因本文档重新部署。

## 2026-10-28 22:25 USDC修复版已上线，下一步仅需本人测试

### 具体修复与使用入口

- 自动状态更新从全局busy中分离：不插入“正在处理”横条、不禁用所有按钮、不清除错误或已输入哈希；串行后台请求、失败退避、隐藏页面暂停。钱包/会话变化及明确操作会使旧查询响应失效，保留单次attempt与原哈希恢复。
- 固定沿用已有测试USDC `0x534b2f3a21130d7a60830c2df862319e593943a3`（Monad10143、6小数）。界面显示“测试USDC”、Donor余额及不足提示；不再有部署代币操作/路由。每次准备/发送前核对固定代码hash、精度及所需余额，后台余额查询缓存30秒。
- [准备与发券](https://mealforward-t1e-claim-laodao.onrender.com/mvp/setup.html) 和 [商家工作台](https://mealforward-t1e-claim-laodao.onrender.com/mvp/merchant.html) 地址不变。用户关闭旧页或刷新一次、选MetaMask并重新登录Owner；新会话与旧MVP隔离，不能复用旧登录Cookie。无需重开旧双签轮次。

### 版本、独审和验收边界

- 应用commit **6a05bf79506cfab6a59469f3c24164a84a80a3fb**，客户端build **c4faf613472bc740512c**。分支codex/mealforward-t1f-phase6-release-review-20261026、PR47仍draft未合并，之后仅交接文档提交。
- Render服务srv-dbdgstivcj2c73fnqcc0，部署 **dep-dbh0afon74is73dhpdt0**，22:23:47（UTC+8）live，commit精确匹配。仅更新MVP专用DB/pepper和写入开关，旧服务变量未替换。MVP_ENABLED=true、MVP_WALLET_ACTIONS_ENABLED=true，角色地址不变。
- [MVP CI40705015291](https://github.com/3956ray/MealForward/actions/runs/40705015291) **PASS**；[旧流程兼容CI40705015510](https://github.com/3956ray/MealForward/actions/runs/40705015510) **PASS**，全部7组。客户端15项、HTTP8项、runtime5项及已有币PG+Anvil全流程通过；原合约180秒测试保留、Solidity源码未变。
- 独立源码/迁移/权限/轮询复核通过。唯一P2为公开smoke仍检查已删除token路由，已改为escrow鉴权+单独token404并复核通过。
- 真实公网smoke **PASS**：7个资源逐字节一致、USDC地址/精度/币种标识正确、匿名与跨域拒绝、token prepare404、旧Phase8仍ISSUED。Agent钱包动作0。
- 浏览器本地合成Owner场景跨33次setup查询，前后抽样的两个面板位置均为521.09375/524.09375，按钮状态相同、无busy条；这验证录屏所报跳动修复，不是真实钱包签名。线上基本页面已渲染“测试USDC”，后续内嵌浏览器工具读取超时，未据此声称真人登录/完整浏览器验收通过。

### 新旧数据和权限

- Supabase项目ketfrukrcuosrqynnsay；新迁移 **20261028142019_mvp_existing_usdc**（源20261028140155_mvp_existing_usdc.sql）、**20261028142025_mvp_usdc_runtime_login**。新schema **mf_mvp_usdc**、新专用角色 **mf_mvp_usdc_runtime**，非owner、无旧schema权限、RLS、无DELETE/TRUNCATE、审计仅追加。真实TLS运行时加载验证PASS，security advisors无lints。
- 新state TOKEN_READY、token固定已有USDC，发布后operations=0。**新的USDC餐券合约尚未由用户部署**，因此没有新USDC escrow地址；不能拿旧0x59d95…当作USDC escrow。
- 旧mf_mvp的READY/两笔CONFIRMED部署与报价原样保留：state摘要e37fc8a183f0bea3ab2c9af245d2ef27、operations摘要9445b9c26c49001c61282c0471d603d5；Phase8摘要945836426c0db60aff0ddadbd929a32b，发布前后相同。
- 新私密运行时配置仅在`/Users/mili/.mealforward-mvp-usdc-20261028/`（0700/0600）和Render秘密变量；不输出/提交秘密。旧私有配置保留供历史恢复，不串用。新Cookie __Host-mf_mvp_usdc_*、请求头x-mvp-usdc-*、本地恢复key mf-mvp-usdc-recovery-v2与旧值隔离。

### 本人下一步与回退

1. Owner只部署**一份使用已有USDC的新餐券合约**并签该合约报价；无需再部署/领取新代币。先前escrow币种不可改，所以不能复用它来结算USDC，这是保留历史事实的代价。
2. Donor授权/捐赠7 USDC（观察余额84.5，以现场为准）→ Issuer发券并创建私密领取链接 → 领取人出示短期码 → Owner商家检查、确认交餐 → 链上等待180秒 → 结算。新流程共六笔交易，另有登录与报价消息签名。详见docs/superpowers/2026-10-28-mvp-acceptance.md。
3. 本阶段真实新USDC部署/发券/结算 **NOT_RUN**，等待用户测试；Agent未代签/发送。保留原30分钟准备期限、UNKNOWN只恢复原哈希限制；失败只补测受影响步骤，不从头重跑或重置库。
4. 回退优先仅设MVP_WALLET_ACTIONS_ENABLED=false并等待部署/public确认，保留新旧数据及已上链交易；必要时MVP_ENABLED=false隐藏新入口。不得把新数据写入旧mf_mvp或将旧代币escrow改称USDC。旧结算及Phase8恢复规则保持不变。

## 2026-10-28 USDC修正独审完成，公开检查脚本同步

独立复核确认新币种校验、新schema最小权限、静默刷新/动作epoch和原交易恢复逻辑无新增阻塞项；发现公开smoke仍用已移除token准备路由检查401/503，已修正为escrow准备路由并单独断言token404。只改变核验脚本，不增加业务动作。待限定复核和最终CI/部署，旧入口写入仍关闭。

## 2026-10-28 USDC与静默刷新源码完成，独立复核/发布待完成

新固定USDC流程源代码完成，TOKEN_READY从已有token开始、无token创建路由；新mf_mvp_usdc schema/专用角色和独立cookie隔离旧两笔部署。背景轮询不进入全局busy，不清除错误/输入，失败退避、隐藏页暂停，动作epoch与账户上下文阻止旧响应覆盖。

本地HTTP8项、客户端15项（含三项静默轮询/旧响应回归）、全新PG+Anvil完整已有币业务流程PASS；Root13项HTTP/runtime/命名空间检查PASS。构建c4faf613472bc740512c。真实USDC公开链只读证据已核对；新namespace迁移尚未应用，独立审查/CI/新发布PENDING，暂不可让用户按新入口测试。

## 2026-10-28 22:03 用户反馈刷新跳动，改为已有测试USDC（实施中）

用户录屏14.75秒显示8秒后台轮询调用全局busy，插入提示造成布局位移并禁用按钮；将改为静默、保留输入和错误、避免旧查询覆盖前台动作。用户明确取消新测试代币部署，改用原测试USDC。修正计划docs/superpowers/2026-10-28-mvp-usdc-stability-plan.md。

**真实状态更新：用户已完成上一版token及escrow部署，并签报价**。mf_mvp phaseREADY revision4，token0xda4c890b12856dc4c6415c6aac5a7807f5e1f4b5（tx0xceb69f00763c668ba4c703e38523c49c66d874810bcf17b61e4e5a39ccf6b0fd）、escrow0x59d95b10a31abaca3de93c4c70c9218622ed7d6b（tx0x31447fb169e36980249d0330546e1d6a989668291a3ab258ccdc0811d0451848）；两操作CONFIRMED，nonce12/13，无approve/fund。此前“未部署”已成为历史。

写入已暂停MVP_WALLET_ACTIONS_ENABLED=false，Render dep-dbgvvr0ae00c73dh0gn0已live，应用30a7874，公网writesEnabled=false确认。旧记录不删除/重置；旧新合约币种immutable，切USDC需要一份新escrow，不再部署token。使用新mf_mvp_usdc schema及专用角色，旧两笔交易保留。

原测试USDC0x534b2f3a21130d7a60830c2df862319e593943a3，链10143；finalized block0x477e1b7只读验证symbolUSDC、decimals6、runtime codeHash0x96215e6049ed615cdc22fea7701e85458a8e51a2df3e7d45e8f9fa1d521b5a78；Donor余额84.5。未mint/approve/fund/发送任何交易。新迁移CLI生成20261028140155_mvp_existing_usdc.sql，尚未应用；实现/测试/独审/新发布待完成。

旧mf_mvp.state摘要e37fc8a183f0bea3ab2c9af245d2ef27、operations摘要9445b9c26c49001c61282c0471d603d5，Phase8摘要945836426c0db60aff0ddadbd929a32b；后续对照不修改历史事实。

## 2026-10-28 20:59 MVP已发布，停在本人初始化与一次完整验收

### 当前真源与实际发布

- 仓库3956ray/MealForward，分支`codex/mealforward-t1f-phase6-release-review-20261026`；应用源码固定`b054aef65b247b2e60ae52cbd483d6afd7a01c7d`，之后交接提交仅文档。PR47仍draft，未合并：https://github.com/3956ray/MealForward/pull/47 。
- Render服务`srv-dbdgstivcj2c73fnqcc0`，工作区`tea-db7q3ou7bikc73bp2bt0`；部署`dep-dbgv22ec6qcc73cmf74g`，20:57:32（UTC+8）live，commit精确匹配b054aef。自动代码部署off；本次合并新增4个MVP环境键后自动触发了部署，未重复trigger。
- 新配置MVP_ENABLED=true、MVP_WALLET_ACTIONS_ENABLED=true；独立MVP_DB_URL/MVP_CODE_PEPPER通过服务秘密环境配置，旧环境不替换。服务只构造、验证交易，所有签名/发送由本人钱包明确确认。
- 客户端构建`ccc79f153121bd9a9cce`；使用已审自包含bundle，无第三方运行时CDN。源码`mvp-contracts/`、`t1-intents/mvp/`、`t1-intents/mvp-client/`，入口集成`mvp-runtime.mjs`与`t1e-claim-server.mjs`。

### 本次验证结果（不等于真人验收）

- [MVP完整云端CI40691783883](https://github.com/3956ray/MealForward/actions/runs/40691783883) **PASS**：8项合约、2项导出不变性、可重复artifact及客户端构建、后端与runtime检查、12项客户端测试、全新PG17+Anvil31337+HTTP完整业务闭环。
- [兼容CI40691783978](https://github.com/3956ray/MealForward/actions/runs/40691783978) **PASS**，全部7组旧会话、批准、执行及Postgres用例。两次此前发布检查失败及修正保留在后面记录，未冒称PASS。
- 合约、后台、前端、整体独立审查及扫码/构建修正复核PASS，详见`docs/superpowers/2026-10-28-mvp-verification.md`。
- 实际公网`node t1-intents/mvp-live-smoke.mjs` **PASS**：7个资源与本地逐字节一致；状态10143/testOnly/写入口启用；匿名业务访问拒绝；外站Origin拒绝；商家相机权限正确；旧Phase8 operation.stage=ISSUED。Agent钱包动作0。
- 本地桌面及375px视觉检查通过；最后线上内嵌浏览器工具超时，未声称线上真实浏览器/相机/MetaMask验收。HTTP发布核对已独立完成。
- Supabase项目`ketfrukrcuosrqynnsay`，新mf_mvp schema及专用非owner角色mf_mvp_runtime；迁移20261028121458/20261028121519。启动权限验证通过，RLS已启用、security advisors无lints。发布后新operations=0、events=0；旧Phase8 operations=1，摘要仍`945836426c0db60aff0ddadbd929a32b`，历史事实未改变。

### 真实链上边界和下一步

**新代币/新escrow尚未由用户部署，因此没有新真实合约地址。** 旧已发券交易0x231eb45af33fa58e6b8ad2b1932983a1b0e23d5019ba4504db4cf539b2398327保留，不迁移、不重复发券；原合约180秒缺陷没有被原地修补，旧结算继续关闭。新链10143，Owner `0xc4f8a468f10d5f98dcff3282516125e97f26433b`兼商家，Donor `0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952`，Issuer `0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3`。公网状态已核对以上角色和7e6金额。

入口与一次验收：
1. [准备与发券](https://mealforward-t1e-claim-laodao.onrender.com/mvp/setup.html)：Owner登录，依次部署测试代币、餐券合约，签单份报价；Donor登录，授权并捐赠7个测试代币；Issuer登录，发券并生成私密领取链接。每次先准备，再本人发送，等待服务核验成功后继续。三钱包需测试MON支付gas。
2. 领取人用完整私密链接打开并领取，无钱包；到店生成二维码或六位码。不要把私密链接提交GitHub或聊天。刷新展示码会让旧码失效。
3. [商家工作台](https://mealforward-t1e-claim-laodao.onrender.com/mvp/merchant.html)：Owner登录，扫码或数字码检查，准备并发送确认交餐；链上等待180秒后，准备并发送结算。商家正常两笔交易；初次从部署到结算总计七笔交易，另有登录/报价消息签名。
4. 最终以券状态、交餐回执、结算回执及商家测试代币余额增加7核验；用户还未执行本阶段任何真实动作，整体MVP真人验收 **NOT_RUN**。无需再批准开发，也不重开旧短时双签轮次。详细按钮顺序、异常恢复见`docs/superpowers/2026-10-28-mvp-acceptance.md`。

### 已知限制、实施裁定与回退

- 独立一券7单位代币避免复用旧资金；构造时一次铸给Donor替代faucet，代价是新初始化且不能任意加量。错误金额/角色须明确重新设计新隔离部署，不能后台偷偷改账。
- PREPARED在首次attempt之前允许恢复相同准备内容；atomic attempt后仅恢复原哈希，不自动重发。钱包拒绝/超时而没有哈希可能停留UNKNOWN，需要排查，不默认重跑整个流程。报价/部分准备有效期30分钟，请准备后连续发送；过期PREPARED或外部nonce变化不能自动改写替代交易。
- 物理交餐是商家声明；本次仅单商家Testnet、代币无货币价值。原pause/close/refund语义保留，pause不等于冻结已发生的结算义务。
- 若新入口有缺陷，合并设置`MVP_WALLET_ACTIONS_ENABLED=false`并核对部署及公网writesEnabled=false。这样阻止新准备/attempt/凭证写入，仍可登录、读状态、绑定/核验原交易；不删除mf_mvp记录、不重发、不改历史已上链事实。必要时MVP_ENABLED=false隐藏全部新入口；旧服务仍独立运行。保留新数据库角色/凭据、已产生链上事实供恢复，禁止通过删库“重测”。

## 2026-10-28 MVP云端安装步骤对齐

3cc6608的云端合约8项+导出2项及artifact一致性检查已PASS；MVP工作流40691206117随后在安装依赖失败，因为现有t1-intents没有追踪package-lock，不能用npm ci。已对齐旧流水线/Render的npm install方式（固定package版本、ignore-scripts）；新合约和新客户端仍保留locked npm ci。旧兼容工作流40691206230再次全部PASS。新完整云端闭环仍待复跑，未发布新入口，未请用户重测。

## 2026-10-28 MVP独审通过，云端构建一致性修正

合约、后台、前端独审和整体交叉审查通过；摄像头修复复核通过，Root复跑12项前端测试及可重复构建通过。已推送b853ef6，旧兼容CI40690157690七项全部PASS。新CI40690157805八项合约测试PASS，但artifact导出检查FAIL：编译器AST内部编号随构建输入顺序改变。修正为按不可变字段实际runtime偏移范围生成稳定标识，ABI/字节码/范围完全不变，2项针对性导出测试通过；待云端复跑，不能把该轮标PASS。

真人步骤见docs/superpowers/2026-10-28-mvp-acceptance.md；新实际合约尚未部署，用户测试NOT_RUN。当前Render仍旧edcbc4；新库operations/events均0，旧Phase8摘要保持945836426c0db60aff0ddadbd929a32b。

## 2026-10-28 MVP扫码审查修复完成，发布前复核中

前端独审发现摄像头首次识别/状态刷新期间可能丢弃扫码结果；已改成按会话与钱包上下文保留并单次处理，切换账户则丢弃旧结果。新增首帧、刷新中识别、上下文失效三场景回归，12/12合成测试PASS，构建ccc79f153121bd9a9cce。独审复核和全阶段审查尚在进行，CI/公开部署仍未完成。实际隔离生产数据库配置加载完整MVP运行时通过（writes=false验证），无新业务操作和链上广播。

## 2026-10-28 MVP三页面源码完成，独审与发布核对中

新增准备、领取、商家三个中文入口，前端构建f3928b75050020e64bc9。Root复跑11/11合成浏览器/钱包守卫测试PASS、构建PASS；本地桌面及375px页面视觉检查无横向溢出。领取入口不含钱包发现依赖，长期链接fragment立即清除，展示码过期隐藏。商家扫码/数字码检查后才可明确交餐，后台链时间决定结算按钮。准备内容可在首次attempt之前恢复，attempt之后仅恢复原交易哈希。

静态资源已接入隔离mvp-runtime，路由/权限及旧claim相关19项针对性测试PASS。独立前端/整体审查、GitHub CI和Render发布仍PENDING；真实相机及真实钱包初始化、完整业务验收NOT_RUN。新链合约地址尚不存在，旧发券成功事实不变。

## 2026-10-28 MVP后台独审通过；隔离实库已建，入口仍未发布

后台提交7fe377a独立审查spec/quality PASS。Supabase项目ketfrukrcuosrqynnsay已应用新独立迁移`20261028121458_mvp_business_flow`（源码文件20261028114053_mvp_business_flow.sql）和`20261028121519_mvp_runtime_login`。仅新mf_mvp schema及专用mf_mvp_runtime角色；直接TLS登录通过运行时最小权限核对：当前phase=EMPTY、operations=0，无旧schema访问、无owner/superuser/DELETE/TRUNCATE/audit UPDATE。security advisors无告警。旧Phase8唯一operation摘要前后相同945836426c0db60aff0ddadbd929a32b。

新凭据只在本机私有目录`/Users/mili/.mealforward-mvp-20261028/`，权限0700/0600，不进Git/日志/聊天。Render尚未配置新凭据/开启新入口；实际线上版本保持edcbc4。Root新集成模块mvp-runtime.mjs默认关闭，失效时仅MVP返回503、保留旧服务。前端实施中，CI/公开发布/用户初始化仍未完成。公共链10143只读token部署eth_call模拟通过，无Agent广播、无新真实合约。

## 2026-10-28 MVP合约独审通过、后台本地闭环完成，公开发布未执行

合约提交4ef6ab4独立审查PASS，根agent复跑8/8 Foundry通过。新后台`t1-intents/mvp/`与CLI生成迁移`20261028114053_mvp_business_flow.sql`源码完成，独立后台审查待执行。根agent在全新本地PG17+Anvil31337复跑部署→报价签名→approve/fund/issue→私密链接→过期展示码拒绝→商家redeem→180秒settle通过，包含真实HTTP SIWE/CSRF与凭证流程；13项离线/路由/旧setup针对性测试PASS。均为合成验证，不是用户真实钱包验收。

PREPARED允许恢复同一准备内容；原子attempt之后只允许原哈希恢复，不重复发送。凭证轮询不再改变业务revision；未核验候选哈希可更正，核验绑定后不可替换。报价过期且没有fund操作时，Owner可以显式重新生成；已PREPARED的交易若过期仍禁止重写/重发，须明确恢复设计而非让用户盲试。旧Phase8 operations基线1条、摘要945836426c0db60aff0ddadbd929a32b。新mf_mvp还未在实库创建，安全advisors无告警；新Runtime、UI、部署和最终用户步骤仍在实施。没有新公链交易。

## 2026-10-28 MVP完整业务流程已批准，实施中（尚未部署）

用户确认以跑通单商家Monad Testnet MVP为优先，减少人工重复测试。已选新隔离合约链上180秒结算等待、Owner兼商家/operator/catalog/quote，Donor与Issuer沿用；旧合约和已ISSUED child保持不变，不迁券、不挪旧资金。计划：`docs/superpowers/2026-10-28-mvp-business-flow-plan.md`。新测试代币在用户部署时向Donor铸造7e6（6位小数），无额外faucet；之后捐赠→发券→私密领取链接→扫码→一次确认交餐→180秒后独立结算。

源码`mvp-contracts/`已完成首轮8项本地Foundry测试，包括两条H入账路径179/180秒、重复操作、防重复支付、权限、pause/close/refund/expiry；85个冻结cp30-contracts文件与HEAD逐字节一致。仅本地合成证据，独立审查/后端/前端/CI/公开部署/真人钱包仍未完成。现网仍edcbc4b3a2fd7badf1ce4536557a890eba6ca151，服务srv-dbdgstivcj2c73fnqcc0，旧settlement保持false。没有新公链部署、签名、广播或业务数据变更。继续实现至需要本人初始化新合约及一次完整验收，不重新开启Phase8。

## 2026-10-28 下一阶段建议：Phase9已发券展示与领取/核销设计

用户询问下一阶段流程和目的。本轮核对现有交接及GitHub Issue17仍OPEN：原StoreEscrow settle不强制180秒链上等待。建议先把已ISSUED child的权威回执映射到用户可理解的券状态和领取凭证（保留旧UNKNOWN），完成领取页面/权限/恢复测试；商家扫码、锁券、交餐及结算先设计并用隔离测试验证，不直接打开旧合约settle。链上强制等待若采用须新审合约及明确现有券处置方案，不能前端倒计时冒充链约束。此为阶段规划建议，未声称Phase9设计已批准、已实现或部署；未新增交易/轮次。


## 2026-10-28 Phase8 真人完整钱包流程PASS，child已ISSUED

本人回报交易哈希及“链上发券已核验通过”。独立公网/链只读核对确认：轮次617f877a-0709-4b8f-9323-8a7ff94d0369，Owner=true、Donor=true；child f165d689-6d2b-4e5b-909b-81c3cf4d487c，stage=ISSUED、revision2、nonce0，operationId=0x46cc1cf6f86f1b8b881c40bfac6819e26309d00e869da688fc6b4ed3befd222e。

交易：`0x231eb45af33fa58e6b8ad2b1932983a1b0e23d5019ba4504db4cf539b2398327`，https://testnet.monadvision.com/tx/0x231eb45af33fa58e6b8ad2b1932983a1b0e23d5019ba4504db4cf539b2398327 。chain10143、from固定Issuer0x9747…aA2B3、to固定合约0xcf0c…fe58、nonce0、value0；解码方法issue且operationId匹配，calldataHash0x8eed3d0755b9ce15f7597d02a50b214fcb97c524f502aea24c8498f7886d11fa与后台一致。回执status0x1，block74923731，hash0x5d7ab9cce31a4d04f8ed0217f11bec5c1efbaff09ca3d8fe2ed539e9ae396718，独立区块查询hash一致、2条日志；finalized观察高度74924111已超过回执高度。

因此真人Owner/Donor批准、Issuer登录、prepare、本人Send、哈希绑定和服务回执核验完整流程PASS。public顶层RECOVERY_ONLY表示已消费、禁止再次准备，不是失败；operation.stage=ISSUED为结果。不得重新开轮/预留/重发，不删除旧轮次或将原Claim/旧predecessor的UNKNOWN改写为这笔成功。结算settlementEnabled=false，#17仍未解决；本验收不覆盖商家核销/结算或整个产品上线。

实际应用edcbc4b3a2fd7badf1ce4536557a890eba6ca151、部署dep-dbgsq2ks728c73ca7kp0；CI40671509207成功。此前RPC429已由共享限速修复，登录后状态自动刷新已上线，本人此次完成验收。Agent只进行了只读核验和文档更新，没有代签或广播。原始登录nonce、RequestID及签名不记录。后续开发应从已发券事实继续设计领取/核销闭环，并先处理结算缺陷；不可继续把测试入口当作需要再次Send的待办。


## 2026-10-28 18:28 登录刷新修复已上线，创建真人重测轮次

登录后自动只读刷新提交edcbc4b3a2fd7badf1ce4536557a890eba6ca151，CI40671509207成功，部署dep-dbgsq2ks728c73ca7kp0于18:24:05 live。公网页面200且源码逐字节一致；Render启动探测42次/10795ms PASS。此前8baf8b59轮次双角色true、operation=null，已过期；只证明双签入库和本人报告登录，不证明prepare/send。

本人于18:28:09（1793183289）明确确认Issuer活动无交易、立即开始。operator预检通过创建617f877a-0709-4b8f-9323-8a7ff94d0369，digest0xf30bc11433a4810eac9e71071a9b11982f949e3cf05b95d9c9d3a9c38f413ab9，AWAIT_APPROVALS；prepare/send截止18:31:53（1793183513），批准截止18:33:23（1793183603）。已立即交付轮次及连续操作步骤，要求加载新页面，Issuer登录自动刷新后prepare/单独Send。无Agent签名/预留/发送，真人结果待回报。


## 2026-10-28 18:20 双签真实记录PASS；Issuer登录后按钮关闭反馈

本人回报Issuer已登录但后续按钮无法点击。公网serverTime1793182797（18:19:57）确认轮次8baf8b59-0e64-4c37-9b63-67d5848d7d69，Owner=true、Donor=true、operation=null，PREPARE_WINDOW_CLOSED；prepareBefore1793182786（18:19:46）。因此限流修复后的真人双签入库已通过，未有新prepare/send。用户提供登录消息签发18:18:40，不等于登录完成时刻；不能仅凭现在过期推定最初按钮关闭原因。

源码确认页面登录成功不会自动读轮次，批准响应更新wrapper状态而Issuer控制器可能仍持有旧AWAIT_APPROVALS，需手动刷新才能更新canPrepare。补充Phase8登录完成后的自动只读刷新，不自动prepare或send，不修改登录、签名、时限或后台规则。实际DOM完整流程改为不手动刷新也能在有效窗口内启用prepare，11项相关测试PASS。发布证据另补，真人Issuer prepare/send仍未验收。原始SIWE nonce/RequestID/签名不进入交接。


## 2026-10-28 18:16 上轮无操作，按本人报告重新开轮

本人明确“上一轮没有任何动作，重新启动测试”，接收18:15:45（1793182545）；沿用此前Issuer无交易报告及本次无操作更新。公网确认a49e7722已过期、双方false、operation=null。operator链/库预检通过后创建8baf8b59-0e64-4c37-9b63-67d5848d7d69，digest0x046eaf10d0c83e3a784b291f016fd6aa947dc30f8966ed210c8a886e662ca460，AWAIT_APPROVALS，prepare/send截止18:19:46（1793182786）、批准截止18:21:16（1793182876）。结果立即告知本人，无Agent签名/prepare/send，transactionSent=false，真人结果待回报。


## 2026-10-28 18:06 限流修复后真人重测轮次已创建

本人于18:05:57（1793181957）确认可以开始且Issuer活动无交易。先暖机公网200，旧轮过期且operation=null；随后使用新鲜报告执行operator与限速后的链/库预检，创建a49e7722-34cc-45d0-a704-1f7a2c185ecd，digest0xbfe5d248b5fe0ec6c2e95726f552fa3451a50493d116a11d8f71203e2c32fcd8，AWAIT_APPROVALS。prepare/send截止18:10:25（1793182225），批准截止18:11:55（1793182315），transactionSent=false。已立即告知完整顺序及每次签署等待后台十几秒记录成功再换角色；无Agent签名/prepare/send。本轮真人结果仍待回报，不把创建成功标作双签或发送PASS。


## 2026-10-28 17:23 RPC429限流修复已上线，Render完整只读核验PASS

已确认根因：Render对公共Monad RPC的42次链观察查询未限速，实际启动探测在34次/2738ms时遭HTTP429；签名已通过、record_approval尚未执行，所以双角色未记录。源码2f7cc36b69a4a1fb34dd51fc7ac8cfed8f3912c4加入进程共享250ms间隔、8项有界FIFO、取消移除和BUSY明确错误；不重试签名/交易，不切换RPC、不放宽安全核验。本地279/279、独立复核通过；CI40663410258全部7项成功。本机真实公共链观察42次/12976ms PASS，不能代替Render结果。

Render部署dep-dbgrt8on74is73d961kg于17:22:30 live，commit与上述一致；真实运行日志17:22:34.620Z+8（UTC09:22:34.620）为PHASE8_RPC_BOOT_PROBE ok=true calls42 elapsedMs10720。与此前同环境429失败对照，限速后完整观察已通过；这不是真人批准记录或交易验收PASS。未创建新轮次，未代签/预留/发送，未修改数据库权限或历史记录。

下一步本人准备好后，重新取得新鲜Issuer MetaMask无待处理/已发送交易报告，先确认服务已响应，再建轮并立即给出截止。Owner批准记录成功才继续Donor；双记录后Issuer重新登录、prepare并立即独立Send。若出现错误立即停下回传错误码，不盲目重签或重发。旧3b2a0834轮次已过期，不能刷新续期；真人双签入库与Send仍待验收。回退可禁用Phase8，保留全部记录。


## 2026-10-28 17:15 Render运行时复现RPC HTTP429

只读探测提交12ef519271f7ee06bc4449fd4d80397b52404516，CI40662434415成功，部署dep-dbgrpn49v7es73b8favg于17:15:06 live。真实Render日志17:14:59返回PHASE8_RPC_BOOT_PROBE ok=false、calls34、method eth_call、elapsed2738ms、rpcHttpStatus429。此证据确认Render出口对公共Monad RPC的当前观察查询被限流，不是钱包连接故障或批准表已写而UI未刷新。未运行签名/轮次/批准/交易写入。

开始修复进程共享的RPC请求频率：固定250ms最小发起间隔（最多4次/秒）、FIFO有界8项等待、排队取消和BUSY明确拒绝；保持单次/总预算、全部链核验、固定端点，不自动重试签名或广播，不放宽截止时间。修复完成仍需Render同样42次完整只读探测PASS才安排真人测试。上线及最终测试证据另补。


## 2026-10-28 17:07 重测定位：签名通过后链上观察HTTP失败

用户回报本轮3b2a0834双签仍未记录。公网serverTime1793178418显示AWAIT_APPROVALS、双方false、operation=null。Render真实日志在09:05:24.153Z、09:05:52.336Z、09:06:27.370Z均为PHASE8_REQUEST_FAILED /503 /T1F_PHASE8_RPC_HTTP /observe_chain。服务submit先验证签名再进入此阶段，故这三次请求已越过签名门禁，但RPC HTTP错误使其未到record_approval。不能据此认定每条日志对应哪个角色；HTTP具体码此前未保留，不能断言限流或封禁。

为避免再次让本人签署定位，新增Phase8开启时启动一次的只读RPC探测，读取已有context/round并执行同一42调用观察；最多45秒，不能建轮/记录批准/prepare/send，无公开探测接口。失败不阻断监听或引起重启。只记录固定事件、允许错误码、整数HTTP状态、方法和耗时；不输出上游响应体。源码272项PASS，后续独审/CI/部署证据另补。本轮没有新预留或交易，暂停真人重测。


## 2026-10-28 17:04 已创建诊断重测轮次，等待本人操作

本人于17:03:43（1793178223）确认Issuer MetaMask无待处理/已发送交易且可连续测试。operator新鲜报告及链/库预检通过，创建3b2a0834-eca0-457c-ae84-82730c9bed69，digest0xe4d5a9ebdb1fbf2c2239555b5ecb6198c56a6048c8ea02467bfe1e66ccf4fca1，AWAIT_APPROVALS；prepare/send截止17:07:28（1793178448），批准截止17:08:58（1793178538）。结果已立即通知本人，先Owner签署，有错误停止回传诊断；成功再Donor，双记录后Issuer重新登录/prepare/立即独立Send。未代签、prepare或发送，transactionSent=false，不声称真人已通过。沿用072d3c6诊断部署；前次503根因仍未确认。


## 2026-10-28 重测准备：服务读取成功，等待新鲜钱包活动报告

用户要求再次重启测试。公网status返回HTTP200，serverTime1793177896，仍为旧轮b55789fd-76ac-47c4-bf80-5a1ea5e74b40 / PREPARE_WINDOW_CLOSED，Owner=false、Donor=false、operation=null。未创建计时轮次，未执行钱包操作。已询问Issuer当前MetaMask活动；昨日无交易报告不用于今天新建轮次。收到新鲜确认后执行预检和建轮，保留503根因尚未确认的限制。


## 2026-10-27 16:07 旧轮次按钮禁用核验

用户报告Owner/Donor连接并刷新后签署按钮不可点击。附件与实时公网200状态一致：仍是b55789fd-76ac-47c4-bf80-5a1ea5e74b40，PREPARE_WINDOW_CLOSED，prepareBefore1793085817（15:23:37），serverTime1793088460（16:07:40），双方批准false、operation=null。因此本次禁用符合过期门禁；不是新的钱包连接失败证据，亦不解决前次503。Agent尚未创建新轮次；刷新不会延长旧轮次。下一步等待新鲜Issuer无交易报告及测试就绪，再暖机/核验/建轮。此次仅只读核验及文档记录，无新签名、预留、交易或部署。

## 2026-10-27 15:37 批准故障诊断增强已上线；503原始根因仍待定位

应用提交 `072d3c6b3e6b680882962a84370346a0bfe49b0a`；独立审查完成，本地270/270 PASS，远程CI https://github.com/3956ray/MealForward/actions/runs/40467867486 全部7项成功。新增4项隔离submit组合测试：双角色记录/回读成功、RPC超时未写、PG权限失败未写、回读失败保留已记录批准；签名恢复使用真实合成签名，授权角色映射仅在隔离测试进程mock，不代表真人E2E通过。

Render部署 `dep-dbg58h6c6qcc73ecrok0` 于15:36:27 UTC+8 live，实际提交与上述一致。新页面返回200且逐字节匹配；状态仍PREPARE_WINDOW_CLOSED、Owner=false、Donor=false、operation=null。用全零合成无效签名探测已过期轮次，返回409/T1F_PHASE8_EXPIRED/stage=request，未提交真人签名、未创建批准。没有数据库迁移/权限/环境变化，也没有新轮次或钱包动作。

新增严格脱敏的阶段和错误分类：read_round / verify_signature / observe_chain / recheck_round / record_approval / readback；仅允许明确RPC/数据库错误码进入响应和日志，不记录原始错误文本、签名、请求体或凭据。页面例如PHASE8_RPC_TIMEOUT_AT_OBSERVE_CHAIN；未知仍UNAVAILABLE。独审指出的对象继承属性分类风险已修正。此发布改善诊断，**尚未证明并修复本次503的根因**。不能让用户在旧过期轮次继续签署。下一步需要新鲜本人钱包无交易与可连续操作报告，先暖机检查服务，再创建限定新轮次用于定位；若Owner签署后出现错误，立即提供新错误码，停止后续签署/prepare/Send。只有Owner/Donor均已记录及READY_TO_PREPARE才继续Issuer。保留失败轮次与旧UNKNOWN，禁止自动重试交易。

## 2026-10-27 15:24 Phase8 真人批准提交失败，暂停完整 Send 验收

收到本人15:19:40 UTC+8新鲜报告：Issuer已登录、MetaMask活动无交易、可开始。operator核验后创建轮次 `b55789fd-76ac-47c4-bf80-5a1ea5e74b40`，digest `0xef115f9bc083a5a3ee691db96e211dae8fe134a51ca64645e53350de5dc300fd`；准备发送截止15:23:37，批准截止15:25:07。已立即交付连续Owner→Donor→Issuer→prepare→Send步骤，无Agent签名/交易。

用户回报两钱包已签署但均未记录，附件显示 `PHASE8_HTTP_503`。15:24公网状态及随后真实collector/execution只读get确认双角色批准0、operation=null，旧predecessor保持UNKNOWN/hashNULL，窗口关闭。故不是单纯页面刷新问题，尚无新预留或发送证据。本轮不重开、不代签、不重复提交用户签名。

独立审查确认：生产执行读取/collector写入接线与权限正确；根agent与独审在本机对同一轮次完整只读链观察均42次RPC PASS。这不能证明Render当时RPC正常。Render应用日志显示15:20:22启动、15:20:35服务ready，无失败细节，请求日志未返回记录。实际503根因仍未确定，不能归因钱包、RPC或数据库。此前服务测试只覆盖无效签名，PG直接record与DOM模拟响应未覆盖有效submit组合路径，记录此验收缺口。

正在增加严格脱敏错误类别/submit阶段诊断和隔离成功路径回归；未降低签名、角色、时限或链核验门禁。原始错误消息、SQL、DSN、会话及签名不进入日志/公开响应。诊断修复不等于批准503根因已解决；发布与测试结果另补，真人完整Send仍未通过。

## 2026-10-27 14:33 Phase8 已上线，等待本人完整 Send 测试

本节覆盖下方历史发布状态。用户已批准自主推进至本人测试；Phase8 限定过期未发送恢复路径已实现、独立审查并上线。真实钱包 Send、绑定哈希与链上回执尚未验收，不能称为发券成功。

- 应用提交：`8314157fb8ca19e553a3679680c4258add263927`。CI run https://github.com/3956ray/MealForward/actions/runs/40460811122 全部7项成功；本地源码264/264 PASS、独立PG17迁移及能力/并发/回滚10组PASS、合成DOM完整流程通过。
- Render `srv-dbdgstivcj2c73fnqcc0` / deploy `dep-dbg48d59fdbs73cnrerg` 于14:27:52 UTC+8 live，固定上述应用提交。文档后续提交不部署。入口：https://mealforward-t1e-claim-laodao.onrender.com/t1f-phase8.html 。Owner、Donor、Issuer 均使用这一新页面。
- Supabase 已应用 `20261027061724_t1f_phase8_recovery.sql`（SHA256 `9f67d713bc384c4d84251d2c420701ed547898296de4906edaf9aef5b8ba00ab`）及独立运行角色激活。operator/collector/execution 三种实际登录能力核验通过，security advisors无告警、临时owner成员关系0。旧successor表前后指纹均 `3c687c4f7ab9cdc3b701fe188df09604`，旧记录未改变。
- Phase8 开启，旧 successor/issue wallet 路径关闭，fund/settle关闭。14:33 公网六个静态资源200且逐字节与源码一致；Phase8状态200/NO_ROUND，round=null、operation=null，predecessor仍ISSUE_UNKNOWN/hash=null；匿名prepare401、跨站approval403。尚未创建新轮次、批准或child，未执行Agent钱包操作。
- Chrome创建测试页超时，系统曾报告Mac锁定；未声称真实Chrome视觉或MetaMask验证通过。公共HTTP和合成DOM验证不能替代本人验收。

下一步：本人打开新入口，确认Issuer 0x9747…aA2B3 / Monad Testnet10143，完成页面登录检查，确认MetaMask活动无待处理或已发送交易，并可连续操作约5分钟。必须收到新鲜报告再建轮，不复用13:36或更早报告。operator私有配置 `/Users/mili/.mealforward-phase8-20261027/operator.json`（0600，不提交凭据）；命令 `node t1f-phase8-operator.mjs create-round <配置路径> <实际报告epoch秒> ISSUER_REPORTED_NO_PENDING_OR_SENT_TRANSACTIONS`，在t1-intents执行，报告时效120秒。

建轮前先交付完整步骤，建轮后立即公布轮次与截止：Owner显式批准→Donor显式批准→切回Issuer检查并重新登录→刷新READY_TO_PREPARE→prepare一次→立即单独点击Send once并本人确认MetaMask→保留原交易哈希→绑定/核验回执。prepare/send窗口210秒、批准300秒；不要在prepare后要求暂停聊天，不刷新以免丢失一次性字节。账户切换可能清除登录，不能假定预登录持续有效。超时/拒绝/不确定时不自动续轮或重发；已有哈希只恢复同一交易。若需关闭入口，设置T1F_PHASE8_ENABLED=false并保留全部审计数据。

## 2026-10-27 Phase8 修复源码完成，正在验证发布

用户确认继续修复并要求完整钱包流程包含 Send；沿用自主推进至本人测试的授权。新增独立 Phase8 version2 批准和一笔限定 child：保留旧原 Claim/017 successor/消费/审计不变，明确绑定已过期 predecessor8872119f-8c4c-4f0d-8c3a-10c841f1018f。新的签名不能使用 V1；合约 replay 在 deadline 检查之前，故必须同时核对 finalized/head 两个锚点旧操作不存在、Unit0 generation0可用、固定代码/角色/账务及 latest/pending nonce0。新轮次须有新鲜本人报告，不提前创建。此时尚未应用迁移、创建新轮次或发送交易。

实现文件 `t1-intents/t1f-phase8-{protocol,observe,service,store,http,operator}.mjs`，客户端 `/t1f-phase8.html` 及相关controller/page/crypto；现有 SIWE网关独立 `T1F_PHASE8_ENABLED` 默认false，独立collector/execution登录凭据，Web禁止operator凭据/建轮接口。新迁移由Supabase CLI生成 `20261027061724_t1f_phase8_recovery.sql`，内容SHA256 `9f67d713bc384c4d84251d2c420701ed547898296de4906edaf9aef5b8ba00ab`。迁移不创建LOGIN，角色激活另做受控发布步骤。旧界面已修复截止时间、计时刷新与误导Ready提示。

独立协议/后端/客户端审查完成，发现的状态归属/回执/SQL NULL检查/同块锚点/迟到响应问题已修正。根agent独立PG17运行10组PASS（精确009–018、能力分离、并发唯一、审计失败回滚、原记录不变）；客户端合成DOM完整双批准→登录→prepare→单独Send→哈希→回执通过，非真人钱包。全量分组CI正在发布验证，不提前写远程PASS。裸npm test需要专用PG与合成Quote环境，先前32项环境门禁失败已记录；工作流分开运行这些专用环境。

公网只读观察：finalized74589436 / hash0xd61bffa13c997e19319ee33f374e45da5bb50426ec69393c105c41974bca659b，head74589438 / hash0x36f104c249e77346f87b21452f8d74e3b64b4206550e94997207b9032d904595，timestamp1793081260；两旧操作未观察到、Unit可用gen0、nonce latest/pending0。不是全网无交易证明或新的本人活动报告。实库复查旧successor仍UNKNOWN/hashNULL/revision0，Phase8 schema不存在；security advisors无告警。设计/计划见docs/superpowers。后续固定已审查提交跑CI，再应用迁移与最小权限、部署并核对公网；只有部署门禁通过后才交给本人测试。

## 2026-10-27 13:46 本人确认未点击发送；独立审查确认预留后未发送的恢复缺口

用户明确回复：**“没有点击发送，也没有交易确认窗口”**。这是本人操作报告；结合上一节实库 tx_hash NULL，当前没有交易发送或上链成功证据，不把 NULL 哈希当作全网未广播证明。双签和 prepare 已通过；send / bind / reconcile 尚未完成。轮次与唯一 successor 沿用13:40节，不新建、不重置。13:46:36 UTC+8 的时钟核对已晚于客户端截止13:39:57与候选交易deadline13:44:27；该时间核对不是新的链上状态查询。

独立只读 agent reserved_successor_review 完成源码审查：现有 prepare 消费后不会再次返回交易字节；刷新/账户变化会丢弃内存字节；无原哈希时 reconcile 无法推进。017 的批准消费唯一约束及不可变记录禁止直接重新预留，数据库 BLOCKED 状态也没有可用的客户端/API恢复协议。**当前版本缺少“已预留、本人未发送、窗口已过”的完整恢复路径，不能靠重新双签或开轮解决。**

同时确认界面缺陷：snapshot.canSend 只检查内存payload与recovery，未检查截止时间；send执行时却检查prepareBefore，并先清除payload。因此页面可能过期仍显示Ready/发送按钮可用。此前Agent要求prepare后暂停回传，消耗了仅剩34秒的发送窗口，是测试指引错误，不归因于用户操作或MetaMask。

用户目前无需继续测试。下一步工程应先修正时间/状态提示和边界测试，再设计并独立审查过期未发送操作的恢复协议；保留旧审计记录、核验合约过期与链状态，并明确新授权和唯一性约束。不删除消费记录，不重建旧交易字节，不延长旧签名有效期。本次仅记录新证据与独立审查结论，未声称修复已实现，未改应用源码、部署或线上数据，未执行钱包动作。

## 2026-10-27 13:40 CRITICAL：唯一 successor 已预留，禁止重新开轮或重复发送

本轮 `cb9ca0dc-d466-4a6f-83e1-53b0d50f07c0` 已完成本人双签和prepare。只读实库确认 Owner13:37:41（1793079461）、Donor13:38:10（1793079490），批准消费/唯一预留于 **13:39:23**（1793079563）。successor_id=`8872119f-8c4c-4f0d-8c3a-10c841f1018f`，operation_id=`0xa26a490285c09acf65c4970a05c69574bc1502e6d92e8e1538b7da84ef21443b`，stage=ISSUE_UNKNOWN、nonce0、revision0、tx_hash NULL，原Claim仍ISSUE_UNKNOWN。**双签与真实prepare PASS；交易是否请求/广播尚未由用户确认，NULL哈希不是未广播证明。**

Agent此前让用户prepare后停下回传，却遗漏当前客户端send也要求clock<prepareBefore（13:39:57）。13:39:23预留后仅剩34秒，13:40:50已超过客户端发送截止。候选合约deadline为1793079867（13:44:27），不能把这个更晚时间当成客户端发送许可。用户最后截图仍显示笼统Ready，无法从文本判断按钮状态或钱包是否已收到请求。已明确要求保持页面、不要发送/重新准备/开轮，并询问是否点过Send、出现交易确认或已确认。该回答仍待收集；不得猜测。

按Superpowers systematic-debugging核对源码并派独立只读恢复边界审查。现有一次性交易字节仅内存持有，刷新/账户变化/失败会清除；prepare已消费后不重新返回字节，reconcile仅在已绑定原哈希后执行回执核验。任何后续工作先恢复同一操作事实；不得删除/重置consumption或operation，不擅自扩大有效期、重建交易字节或创建另一操作。本轮只有只读核验与文档更新，没有Agent prepare/send或新部署。后续需修正真人操作指引、时间/状态显示，并审查未发送或不确定预留的恢复方案；目前未宣称这些修复已实现。

## 2026-10-27 13:36 已按新鲜本人报告创建重测轮次，等待本人连续双签与prepare

用户再次明确确认 Issuer MetaMask 无待处理/已发送交易、两个页面准备且已登录、现在开始。实际报告接收时间13:36:05 UTC+8。现有 operator 在120秒内通过链上/原记录门禁并返回 COLLECTING；新轮次 `cb9ca0dc-d466-4a6f-83e1-53b0d50f07c0`，摘要 `0xebcf24ea5e1738f09e0093881e7058b55e660c45a815d597c9b16a7dde72ad58`，批准到期 **13:41:27**（1793079687），prepare 必须早于 **13:39:57**。创建结果已立即在 commentary 连同完整操作顺序交给用户，明确不等待文档、不在双签与prepare之间回传截图。

本人执行 Owner→Donor 双签，再切回 Issuer，Read/check wallet→Refresh status→仅 READY_TO_PREPARE 时明确 prepare一次。请用户在准备后回传结果，暂不发送。当前只确认轮次创建，尚无本轮真人双签/prepare/交易结果，不能标PASS或已发券。未自动签名/预留/广播，不复用旧轮次或放宽90秒门槛。未来读取本节须检查时效；超时停止，不自动续轮。应用/部署沿用a527fef，文档更新不触发部署。

## 2026-10-27 13:33 新轮次双签真人测试与实库核验 PASS；准备窗口已关闭

用户回传新轮次 `97bc0a06-274f-4219-823c-ae376cb6ce3f` 的 Owner/Donor 页面，最终 COLLECTED_NO_RELEASE，以及 Issuer 的 PREPARE_WINDOW_CLOSED。只读实库独立确认同一摘要 `0xea5d60d9352dc786fe261ca37ac66d39ec2efcc0e81a6cd4c936620b4ca660db`：Owner 在13:29:15（1793078955）、Donor 在13:30:48（1793079048）验证记录，均早于批准截止13:31:14。**双签收集 PASS；真人 prepare/send/reconcile 尚未运行，不是发券成功。**

Issuer prepare 截止为13:29:44（比批准到期早90秒），Donor 服务记录晚于该截止64秒，因此没有可以准备的有效双签窗口。13:32:42只读检查时 consumption/release/operation均0，原Claim仍ISSUE_UNKNOWN。未新建轮次、绕过有效期、预留 successor、代签或广播。本轮无应用源码/部署变化。

操作安排问题：Agent 创建轮次后仍同步文档，并要求中途回传，挤占300秒轮次中的210秒准备窗口。下次必须先给完整步骤、预先打开两个页面并确认Issuer登录/钱包活动及本人连续操作准备完毕，才创建新轮次；创建后立即提供轮次和两个截止时间，避免在双签与prepare之间再安排聊天等待。不得把本次双签重测为未通过，也不得为赶时间降低90秒门槛或自动续轮。下一轮仍需新鲜本人活动报告，保留此次历史通过证据。当前请求仅回报测试，已完成结果记录，未擅自启动另一倒计时。

## 2026-10-27 13:26 新鲜报告后创建 Phase7 测试轮次；等待本人双签

用户明确确认“MetaMask 活动也没有交易，现在开始”。实际报告接收观察时间2026-10-27 13:25:51 UTC+8，现有 operator 在120秒时效内完成独立链/原记录预检并返回 COLLECTING。不是 Agent 全网无交易证明。新轮次 `97bc0a06-274f-4219-823c-ae376cb6ce3f`，摘要 `0xea5d60d9352dc786fe261ca37ac66d39ec2efcc0e81a6cd4c936620b4ca660db`，批准截止 **2026-10-27 13:31:14 UTC+8**（1793079074），Issuer prepare 必须早于 **13:29:44**（保留90秒门槛）。超时不自动续轮，不复用旧报告。

已通知本人在 collector 刷新，Owner/Donor 对同一新轮次显式双签，再回 Issuer 刷新状态。本轮只创建批准轮次，未代签、prepare、发送或发券；上线代码不变。上节历史“未收到报告”已由本节新报告覆盖；若读到本节时窗口已过，按过期处理，不能照抄当作当前有效授权。

## 2026-10-27 Phase7 Issuer 真人登录与状态读取通过（用户回报）

用户回传本站 SIWE 登录消息和登录后的受保护状态：Issuer 为固定 0x9747…aA2B3，chain10143、本站 URI 正确；页面 Original Claim=ISSUE_UNKNOWN、Successor=PREPARE_WINDOW_CLOSED，历史 round79e1b5e5-ba34-4387-805b-e2eb7d00300d / digest0x83c97ca5e3cb5ffebc934406773ef4246159a7e1117f059ad470515f8473ba9c，Transaction hash=—。据此记录本人登录与读取验收 PASS（用户提供页面证据，非 Agent 直接操作或观察钱包）。原始登录 nonce、Request ID、签名及会话凭据不录入交接。

PREPARE_WINDOW_CLOSED 是过期历史轮次的预期状态；Prepare before 的20:06:35Z对应北京时间2026-10-27 04:06:35，不是新轮次。此次没有发券成功证据，也不能用该页面代替钱包活动报告。尚未收到新的 Issuer 待处理/已发送交易报告及立即测试准备状态，已向用户询问；收到后才按既有时效门禁进行新轮次链上/数据库预检，不给旧报告换时间。此轮仅记录人工回报与文档，无部署、数据库写入、新轮次或钱包动作；上线版本与上一节验证证据沿用，不声称本轮重验实库或 CI。

## 2026-10-27 10:22 Phase7 已批准激活并上线；等待 Issuer 本人登录与只读验收

用户明确回复“批准”后，本轮完成已审查的线上激活包。**新入口已上线，但尚未进行真人 Issuer 登录、准备或发送，也未发券。** 历史 Owner/Donor 双签测试仍为已通过且过期，不能复用。

- **源码与服务**：固定审核提交 `a527feff5e5ff89a5dd4c83964bd5713e8288829`，沿用 [CI 40404621279](https://github.com/3956ray/MealForward/actions/runs/40404621279) 六作业 SUCCESS / 311 测试＋42 隔离 PG 组；本轮无应用源码变更，不冒称重跑 CI。Collector `srv-dbfflq5g1s2s73fl05fg` / `dep-dbg0h7ec6qcc73dubi7g` 于 10:13:27 live；Claim `srv-dbdgstivcj2c73fnqcc0` / `dep-dbg0k9uc6qcc73dulhm0` 于 10:20:11 live，两者均为该固定提交。Claim 保存分支已改为 `codex/mealforward-t1f-phase6-release-review-20261026`，autoDeploy 仍 off，避免配置更新重部署旧分支。
- **配置与顺序**：先更新 collector，再关闭 successor 与旧 Issue 部署 Claim，后应用017/专用权限，最后启用 successor。Render 环境更新实际会触发保存分支部署；中间产生 ba1a76e（旧 Issue 已关闭）与纯文档22f3400版本，最终已用固定 a527fef 覆盖并核对 live。现 `successorEnabled=true`、`issuerIssueEnabled=false`、fund/settle=false；启动日志数据库连接正常。仅现有 Claim 服务持有专用 execution DSN。
- **数据库**：Supabase `ketfrukrcuosrqynnsay` 已应用逻辑017，文件 SHA256 `9c9f5abf9980e4164d6e526f6824788e150cfb51b668615c4a8ade7875092100`。专用 `mf_t1f_execution_login` 为 LOGIN/NOINHERIT，仅 runtime 成员资格（SET true、INHERIT/ADMIN false）；owner/runtime 为 NOLOGIN。真实 pinned-TLS `verifyExecutionRuntime`、context 读取 PASS；独立 agent 复核 collector 实际连接权限审计与 context/current_round PASS，临时迁移自授已撤销。安全 advisors 无告警。私密连接仅保存在服务配置和本机权限0600的独立运行配置，不写入仓库或日志。
- **状态不变**：独立实库核对原六表指纹仍 `c0dd34d6df6ad76a43f79bc435cd0b4f`；原 Claim=ISSUE_UNKNOWN。consumption/release/operation/event 均0，历史 rounds1/approvals2。未新建轮次、预留 successor、代签或广播。
- **公网与界面**：Collector 六个资源与源码相同，真实 session/state 显示 EXPIRED、Owner/Donor true、NO RELEASE。Claim 五个新资源逐字节相同；四个 successor 路由未登录均401；跨源 POST403、跨源未登录 GET401（先认证，未冒称已测到认证后的403）。真实 Chrome 页面可见 MetaMask provider、登录操作及禁用的 prepare/send；未点击钱包按钮。认证后的 origin/method/CSRF 检查沿用隔离 CI 证据，真人会话尚待本人测试。

**现在需要本人测试（只登录与读取）**：打开 [Phase7 Issuer 页面](https://mealforward-t1e-claim-laodao.onrender.com/t1f-execution.html)，使用 Issuer `0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3`、Monad Testnet10143。选 MetaMask → Read / check wallet；若未授权再 Explicitly connect wallet → Prepare login message → 核对本站登录消息 → Explicitly sign login → Refresh status。预期 `PREPARE_WINDOW_CLOSED`、原 `ISSUE_UNKNOWN`、operation=null；prepare/send 不可用。本次签名仅用于 SIWE 登录，不是发券交易。请用户回报页面状态及钱包当前是否存在待处理/已发送交易，勿提供原始签名或凭据。

下一步：真人 Issuer 读取通过后，取得新鲜钱包活动报告，按既有 operator 门禁创建新的短时双签轮次；再让 Owner/Donor 批准、Issuer 明确准备与发送一次。现在不提前创建。丢响应/拒绝/刷新后不能重发，只恢复原哈希。回退关闭执行入口/权限并保留记录；旧 CP30 与商家结算 #17 不动。域名分类不再阻塞，不提交 MetaMask 外部复核。继续保留 [Draft PR #47](https://github.com/3956ray/MealForward/pull/47)，未合并。

## 2026-10-27 05:30 Phase7 源码与隔离验收完成，等待线上执行权限激活确认

用户已授权自主开发到本人测试。本轮完成受控恢复执行：017 原子消费批准并只预留一个 successor；独立执行权限及现有 Issuer SIWE 登录接入；一次性 prepare/send、原哈希绑定和链上回执核验；批准消费后的历史展示；刷新后从钱包记录找回原交易哈希。原 Claim 始终 ISSUE_UNKNOWN，不自动广播，不开放商家结算。**这是源码与隔离测试完成，Phase7 尚未上线启用，也未发券。**

- **确切源码**：`a527feff5e5ff89a5dd4c83964bd5713e8288829`，仓库 `3956ray/MealForward`，分支 `codex/mealforward-t1f-phase6-release-review-20261026`，继续使用 [Draft PR #47](https://github.com/3956ray/MealForward/pull/47)。后续纯交接文档提交使用[skip ci]，不冒称文档HEAD另跑应用CI。
- **验收**：[CI 40404621279](https://github.com/3956ray/MealForward/actions/runs/40404621279) 对该源码六个作业全部SUCCESS：311项测试（61钱包客户端、221非PG、16旧core、13旧HTTP）及42组隔离PG17.11检查（18收集、16执行、8真实HTTP+PG）。类型检查、重建逐字节一致通过。三任务独审、整阶段审查及最终修复范围复审全部PASS，无遗留重要发现。修复了函数重载权限漏检、HTTP超时无响应、登录前错误误锁恢复、刷新丢失哈希后无恢复入口、能力日志漏报。
- **浏览器**：最终a527fef本地真实gateway/service＋合成钱包走通“发送→绑定故障→刷新→重新登录→无关哈希拒绝→原哈希恢复→canonical ISSUED”；原UNKNOWN不变，发送始终禁止重试。390px下client/scroll=375/375，无console error/warn。测试服务/标签页已关闭、视口复原。该结果不是用户真实钱包或公网交易验收。
- **线上实况（本轮收尾只读复核）**：Supabase `ketfrukrcuosrqynnsay` PG17.11，轮次1、批准2，successor release/operation/event=0/0/0，尚无017执行schema/角色。原六表指纹 `c0dd34d6df6ad76a43f79bc435cd0b4f` 前后相同（含review/slot，口径不同于旧四表01556b指纹）。Collector `srv-dbfflq5g1s2s73fl05fg` 仍live `6f4710c` / `dep-dbfnnc59el5s73fumd50`；Claim/SIWE `srv-dbdgstivcj2c73fnqcc0` 仍live `c8723c2` / `dep-dbdto63rjlhs738br1sg`。本轮未迁移、授权登录角色、改环境、部署、新建正式轮次、预留真实successor或交易。
- **迁移与复现**：逻辑017路径 `t1-intents/supabase/migrations/20261026201810_t1f_controlled_successor_execution.sql`；SHA256 `9c9f5abf9980e4164d6e526f6824788e150cfb51b668615c4a8ade7875092100`。固定源码的[验证记录](https://github.com/3956ray/MealForward/blob/codex/mealforward-t1f-phase6-release-review-20261026/docs/t1f-phase7-verification.md)与[具体激活包/回退步骤](https://github.com/3956ray/MealForward/blob/codex/mealforward-t1f-phase6-release-review-20261026/docs/t1f-phase7-activation-review.md)是下一步入口。

**下一步需要确认具体的线上权限变化**：按激活包部署消费感知collector与默认关闭的Claim源码，应用已审查017，配置只有执行runtime成员资格的专用登录，再启用 `T1F_SUCCESSOR_EXECUTION_ENABLED` 并关闭旧original Issue入口；完成权限/公网门禁后，请本人先测试Issuer登录与读取，再依据新鲜钱包活动报告创建新轮次，让Owner/Donor批准、Issuer本人明确准备并发送一次。未来入口为 `https://mealforward-t1e-claim-laodao.onrender.com/t1f-execution.html`，目前尚未部署，勿把现有页面当作Phase7验收入口。Superpowers SDD把security-sensitive action列为暂停确认点；新增执行能力属于该点，源码开发的自主授权未被当作真实执行授权。

已通过的 `79e1b5e5-ba34-4387-805b-e2eb7d00300d` 双签收集测试保持PASS，但批准已过期不可复用；不要求重复已完成的历史验收。域名风险不再作为阻塞，不向MetaMask外部提交材料。回退只关闭执行入口/权限，保留全部回执和操作；有预留后仅恢复同一操作，不删除、重置、重新预留或发送。旧CP30与商家结算#17保持原边界。

## 2026-10-27 Phase7 source implementation complete; independent review / exact CI pending

User authorized autonomous next-stage development until human testing. Source candidate0938dfa adds atomic017 consumption, separate execution role/store, existing SIWE-authenticated successor service, default-disabled production source mounting, consumed collector history and explicit one-shot Issuer UI. Original UNKNOWN is preserved; no server broadcast/merchant settlement. Task1 andTask2 full/scoped reviewsPASS; Task3 and whole-phase reviews pending. Exact remoteCI not yet run: do not mark overall acceptancePASS.

Local evidence: Task1 freshPG17.11 16groupsPASS (main independently reran), Task2 actualHTTP+freshPG8groupsPASS; latest214nonPG and61WalletV2 tests/typecheck/deterministicbuildPASS. Main final-source browser synthetic rejection/reload recovery and390px layoutPASS, noerrors; earlier samecontroller success/bind-retry flowPASS. These are synthetic fixtures, not realwallet/publicIssue acceptance.

Read-only hosted check2026-10-27 04:56+08: PG17.11, rounds1/approvals2, successor release/operation/event0/0/0; noPhase7schema orroles. Live collector remains6f4710c; no017application, executioncredentials/flags, freshround, realreservation ortransaction. Passed79e1b5e5formal dualsign remains historical andexpired. Activation package andverification draft: docs/t1f-phase7-activation-review.md, docs/t1f-phase7-verification.md. Next: finish independentreviews/CI and concreteactivation review before realtesting.

## 2026-10-27 Phase7受控恢复执行源码阶段开工

用户批准下一阶段开发到本人测试。设计/计划已形成并经独立可实现性审查：使用016不可变验证回执，新增独立执行权限、一次性消费与预留、Issuer身份后的prepare/bind/reconcile及钱包演练。保留原UNKNOWN、历史批准和NO自动广播。已过期的79e1b5e5轮次不可复用；域名分类不再阻塞。

逻辑017由Supabase CLI生成，路径`t1-intents/supabase/migrations/20261026201810_t1f_controlled_successor_execution.sql`，仅源码未应用。Task1实施中，尚无Phase7通过证据。设计/计划在`docs/superpowers/`下2026-10-27-phase7-controlled-successor文件。

启动只读核对源HEAD8e56805，Render仍6f4710c/dep-dbfnnc59el5s73fumd50 live；实库轮次1、批准2、successor操作0。真实017迁移、执行权限、生产SIWE挂载和钱包交易在完整激活包审查后另行处理。不接触旧CP30或开放商家结算。

## 2026-10-27 04:07 正式Recovery双钱包测试通过：用户回报＋实库2/2核验 · NO RELEASE

用户回传Owner已记录与Donor最终COLLECTED_NO_RELEASE页面，均为构建wallet-v2-517b10f150aa4b8939162ef6939d22369a25c529c2159432c78b8f6a84aafcb2。Agent只读实库独立确认同一轮次`79e1b5e5-ba34-4387-805b-e2eb7d00300d`、同一摘要`0x83c97ca5e3cb5ffebc934406773ef4246159a7e1117f059ad470515f8473ba9c`的两个固定角色均已由服务验证记录：Owner于04:06:26、Donor于04:06:55（UTC+8），均早于04:08:05截止。审计事件共3条（轮次＋两角色）。

本次可记录为正式Recovery收集流程**真人测试PASS、持久记录2/2核验PASS**，不同于此前只读检查或Phase5练习签名。真人钱包动作由用户完成并回报，Agent没有直接观看扩展签名，也未读取/公开原始签名。无需重复此次已通过测试。

收尾只读原Claim/Fund/Consent/Event指纹仍`01556b358764d9c262f96c90f75cafcc`，successor release/operation/event仍0/0/0。原ISSUE_UNKNOWN、015 HUMAN_REVIEW_HOLD和NO RELEASE不变；没有发券或链交易。此次只有只读核验与文档更新，无代码、部署、迁移或数据库写入；应用仍沿用6f4710c及既有CI/部署证据，不称本轮重跑。

轮次在04:08:05后应显示EXPIRED，历史双签记录及本次测试结果仍保留；不能把过期批准用于未来发券。下一工程阶段是审查并设计从收集证明到受控恢复执行的协议：现有collector只持久化指纹，而未挂载的successor ledger要求原始双签且015拒绝reserve。不得绕开这些检查或把2/2当作自动授权发券。未来执行若需要有效批准，应由完整协议重新获得新鲜授权；不要现在为了延长本次通过状态自动新建轮次。域名不再作为项目阻塞条件，用户暂不提交外部复核的决定保持。

## 2026-10-27 04:03 正式批准轮次已创建，等待本人双签 · NO RELEASE

用户刚报告Issuer `0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3`“没有任何活动”；本轮接收观察时间2026-10-27 04:02:41 UTC+8，按新鲜用户报告记录，不是Agent观察钱包或全网无交易证明。在此前明确授权的测试流程中运行现有operator，其链上与原始记录检查通过并返回COLLECTING。未代操作钱包。

- 轮次：`79e1b5e5-ba34-4387-805b-e2eb7d00300d`。
- 摘要：`0x83c97ca5e3cb5ffebc934406773ef4246159a7e1117f059ad470515f8473ba9c`。
- 截止：**2026-10-27 04:08:05 UTC+8**（epoch1793045285）。过期后不得重用或自动续轮。
- 创建后只读实库：rounds1、approvals0；successor release/operation/event仍0/0/0。正式真人签名尚待测试，不标PASS。
- 本轮核对Render dep-dbfnnc59el5s73fumd50仍live，应用6f4710c，入口与构建ID沿用上节已验证版本；本轮无应用改动或部署。

本人操作：打开 https://mealforward-t1f-approval-laodao.onrender.com/ 并刷新服务状态；选MetaMask，先Owner后Donor，在同一有效轮次分别“检查当前 MetaMask”→“明确签署当前轮次”。目标两角色已记录、COLLECTED_NO_RELEASE。若超时先刷新读回；若过期停止，下一轮仍需要新鲜Issuer报告，不能沿用此次时间。原UNKNOWN与015 HOLD保留，不发券、不广播交易。

## 2026-10-27 正式批准能力已上线，等待本人新鲜Issuer观察与双签测试

用户明确要求“继续开发，域名风险……不需要管”，已覆盖此前域名风险必须先解除的项目门槛。本轮不再扫描或催促域名复核，也未提交此前被拒绝的外部复核；不宣称官方分类已解除。生产bootstrap已启用既有明确签署能力，controller默认仍关闭，账户/网络10143/摘要/有效期/提供方及实际请求前检查全部保留。无后台或迁移变更，无自动签名、创建轮次或发券。

- **源码/独审**：应用`6f4710c86cff1db806f71c4a0cc616dab70ea042`，同一源码分支和[Draft PR47](https://github.com/3956ray/MealForward/pull/47)。新默认bootstrap回归观察RED→GREEN；有效合成轮次加载/检查不自动签名，明确点击仅一次签名/提交，NO_ROUND禁签。独立最终审查无重要发现；生成资产核对仅启用标志/构建ID改变。
- **验证**：[CI40356359749](https://github.com/3956ray/MealForward/actions/runs/40356359749)对该应用提交四作业success：273项测试（60客户端+184非PG+16core+13HTTP）、18组隔离PG检查、typecheck和六资产可重复构建PASS。本轮客户端交互新增证据为JSDOM合成测试；没有宣称真实扩展签名或公网浏览器验收。
- **部署**：Render`srv-dbfflq5g1s2s73fl05fg`，`dep-dbfnnc59el5s73fumd50`，实际应用提交6f4710c，2026-10-27 00:12:21 UTC+8 live。原URL https://mealforward-t1f-approval-laodao.onrender.com/ ，autoDeploy仍off，构建命令、环境和权限未改。旧服务未操作。
- **公网**：`node t1f-wallet-v2-live-smoke.mjs`33项HTTPS检查PASS、NO_ROUND/noRelease=true、六资产与源码一致、真实签名/链交易/持久业务写请求均0。HTML SHA256 `3fc4c0704322e4d70a7c55cb05df156610c70e1ed5e5bad4bb2d402b9fd2cfe6`；bootstrap `16e1ae7fb14f4557da90d898b5e47ab2c97f07311600992c87c18c41135dad77`。构建ID `wallet-v2-517b10f150aa4b8939162ef6939d22369a25c529c2159432c78b8f6a84aafcb2`。
- **部署后实库**：原Claim/Fund/Consent/Event指纹仍`01556b358764d9c262f96c90f75cafcc`；successor release/operation/event=0/0/0，approval_rounds/role_approvals=0/0。原ISSUE_UNKNOWN、015 HUMAN_REVIEW_HOLD、NO RELEASE及商家结算#17限制保持。

**下一步需本人参与**：无需重复已通过的Owner/Donor只读验收。本人在Monad Testnet核对Issuer `0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3` 当前活动，报告是否有待处理/已发送交易，并表示已准备好测试。只在真实报告≤120秒内调用现有operator；不得给旧报告换时间。工具会重新核对链与原记录，再建立300秒正式轮次；建立结果不确定先读回，不盲重试。此时才让本人按同一摘要先Owner后Donor点击“检查当前 MetaMask”与“明确签署当前轮次”。目标COLLECTED_NO_RELEASE，两角色已记录；这不自动发券。具体步骤及私密配置的不回显调用见`docs/t1f-phase6-approval-runbook.md`。当前正式签名NOT_RUN。

计划`docs/superpowers/plans/2026-10-27-formal-signing-enable.md`。回退仅恢复前一客户端应用75cdd9c或关闭显式签名能力；保留全部业务/批准历史，不重置UNKNOWN。后续交接文档使用[skip ci]，不把文档HEAD当作另跑应用CI。

## 2026-10-27 历史轮次防重放回归完成：CI PASS · NO RELEASE

用户批准继续开发至需要本人测试。独立差距审查确认现有Phase6收集器已实现；本轮补齐先前遗漏的跨轮次nonceDomain、newOpId与签名fingerprint复用回归，仅修改`t1-intents/t1f-approval-phase6.ci.mjs`。每例使用有效新轮次输入、要求准确的23505唯一约束错误，并逐字比较全部轮次/批准/事件快照不变。

全新本机隔离PostgreSQL17.11执行精确009–016迁移，18组检查PASS；旧数据快照不变、successor release/operation/event为0/0/0。另用三个独立临时库分别移除对应唯一约束，新测试均因缺少预期拒绝而失败，证明能捕获防重放约束退化。临时数据库均已停止并清理，未使用云数据库或真实签名。独立只读复查无重要发现。提交`374d2e2e1c7653a11422158256f8ed964f3d66bc`的[CI run40354717215](https://github.com/3956ray/MealForward/actions/runs/40354717215)四作业全部success：272项测试（59客户端+184非PG+16core+13HTTP）和18组隔离PG检查PASS，typecheck与六资产重建diff通过。源码保留既有Draft PR #47。后续纯文档提交使用[skip ci]，不冒称另跑应用CI。

启动时核对源HEAD0ceca5e，推送后确认远端为374d2e2；再次只读核对Render仍为75cdd9c/dep-dbflt5gu01pc73bodam0；实库原业务指纹01556b358764d9c262f96c90f75cafcc，successor三表0/0/0。本轮无应用改动、部署、云迁移或持久业务写入。域名扫描重查连接超时，不能视为风险解除，也不能当作钱包无响应根因。用户暂不提交官方复核的决定保持。

下一实际人类阶段是正式Recovery双钱包签名，不是重复已通过的Owner/Donor读取。其前置仍为域名/签名暂停解除、审查后显式启用签名、本人提供新鲜Issuer活动观察、建立同一有效轮次。当前不具备这些条件，不创建轮次或要求忽略警告。还须明确：successor ledger未挂载且015 HUMAN_REVIEW_HOLD仍拒绝reserve；Phase6仅保存签名指纹，不能直接满足ledger所需原始双签。即使未来批准2/2，也不能自动进入发券；真实恢复需要另行设计审查的执行协议。原UNKNOWN、NO RELEASE及商家结算#17限制保持。

## 2026-10-26 23:37:50 Wallet V2 双钱包只读验收：USER-REPORTED 2/2 PASS · NO RELEASE

用户随后回传Donor完整页面：账户 `0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952`、角色Donor、Monad Testnet10143、观察时间2026/10/26 23:37:50；“已读取当前钱包”“服务已响应”，诊断 `phase=ready/ready/NO_ROUND elapsed=404s code=NONE`。构建ID `wallet-v2-d1beddb91a74549b3cb3a2ce2e31c34a7c6c8d506be970c5d463da7fb0acbd98` 与部署版本相同。elapsed是页面运行耗时，不是错误或本次连接耗时。

结合23:31:22的Owner回报，Wallet V2的两个固定账户/角色/10143网络只读检查记录为 **USER-REPORTED 2/2 PASS**。这是用户提供的真实扩展页面结果，不是Agent直接观察或代操作，也不证明未授权钱包重新连接权限流程。无需重复本轮Owner/Donor读取测试；下文“Donor待测/真实只读NOT_RUN”为历史状态，由本节覆盖。

此处2/2专指钱包只读验收，不是页面批准记录2/2，也不同于Phase5历史练习签名2/2。页面仍NO_ROUND、两角色批准未记录、NO RELEASE，正式Recovery双签NOT_RUN。生产签名开关仍关闭，原UNKNOWN未解决、未发券；商家结算#17限制及用户暂不提交域名官方复核的决定保持。不能依据本次通过自动创建轮次、打开签名或重试发券。

下一阶段的依赖是正式Recovery签名的既有运行门槛：域名风险/签名暂停尚无解除证据，须在该门槛解决后经审查启用生产签名并准备同一有效轮次；当前没有需要用户重复执行的钱包检查。若继续工程工作，可在合成环境推进，不把本次只读验收当作实链授权。

本轮只读确认Render `dep-dbflt5gu01pc73bodam0` 仍live，应用commit `75cdd9ce913b442a67a4674fc5e109d504c08d28`。仅文档更新，无应用/部署/数据库/钱包操作；未重跑CI、公网或实库检查，沿用既有记录并明确区分本次用户证据。

## 2026-10-26 23:31:22 Owner 新版真人只读检查：USER-REPORTED PASS，Donor 待测

用户回传Wallet V2页面全文：当前账户 `0xc4f8a468f10d5f98dcff3282516125e97f26433b`、角色Owner、Monad Testnet10143、观察时间2026/10/26 23:31:22，页面“已读取当前钱包”“服务已响应”。诊断为 `phase=ready/ready/NO_ROUND elapsed=15s code=NONE`，build ID `wallet-v2-d1beddb91a74549b3cb3a2ce2e31c34a7c6c8d506be970c5d463da7fb0acbd98` 与已部署版本一致。

据此将Owner新版真实扩展只读检查记录为 **USER-REPORTED PASS**；这是用户提供的页面证据，不是Agent直接操作或观察扩展的证据，也不证明重新申请连接权限的流程。本轮Donor仍待用户测试，不能把Owner结果推广为双钱包通过。NO_ROUND、Owner/Donor批准未记录、NO RELEASE是当前预期状态，连接/读取不等于正式签名批准。

本轮只读复核Render部署 `dep-dbflt5gu01pc73bodam0` 仍live，应用commit `75cdd9ce913b442a67a4674fc5e109d504c08d28`。仅更新交接/验收文档，没有应用改动、部署、数据库或钱包操作；沿用此前CI/公网/实库证据，不冒称本轮重跑。下文“真人MetaMask全部NOT_RUN”为历史状态，现由本节Owner用户回报覆盖；正式签名、创建轮次、发券及域名复核决定均不变。

下一步：用户在MetaMask切换至已授权Donor `0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952`，回同页点击“检查当前 MetaMask”，回传角色/网络/观察时间和诊断；无需点击正式签名。若未授权或警告，回报提示即可。

## 2026-10-26 Wallet V2 已上线；独立验收完成，等待真人只读钱包测试

用户已确认方案A具体设计并授权自主推进到真人测试。本轮完成全新客户端，使用固定版本 Wagmi Core/viem；旧前端未被复制为实现模板。钱包、服务、轮次、批准记录分开显示；按钮先绑定再异步加载，后台或校验故障不锁钱包检查；提供方显式选择，当前首账户/实际网络核对、观察时间、阶段等待提示及源码构建指纹可见。正式生产签名仍保持关闭，NO RELEASE。

- **源码与审查**：应用提交 `75cdd9ce913b442a67a4674fc5e109d504c08d28`；源码分支 `codex/mealforward-t1f-phase6-release-review-20261026`，既有 [Draft PR #47](https://github.com/3956ray/MealForward/pull/47)。三个任务各自独审及最终全量/修复范围复查已通过，未留未解决发现。已修复提供方竞态、会话取消隔离、迟到API结果覆盖、提交不确定读回时序，以及适配器延迟后仍弹出过期/旧轮次签名框的问题。最终真实controller+adapter合成回归：失效路径0弹窗/0提交，有效路径1/1；不是用户真实签名证据。
- **确切 CI**：[run40336371458](https://github.com/3956ray/MealForward/actions/runs/40336371458) 对上述提交四作业全部success；日志确认272项测试（59客户端+184非PG+16旧core+13旧HTTP）及15组隔离PG17检查PASS。固定依赖、typecheck、六资源重建逐字节diff均PASS。后续交接文档提交使用[skip ci]，不冒称文档HEAD另跑应用CI。
- **实际部署**：Render `srv-dbfflq5g1s2s73fl05fg` / `dep-dbflt5gu01pc73bodam0`，2026-10-26T14:07:56.371206Z live，实际commit为75cdd9c；autoDeploy仍off，运行构建/环境/权限未改。入口 https://mealforward-t1f-approval-laodao.onrender.com/ 已切到Wallet V2；`/wallet-v2.html`同内容；`/t1f-approval.html`及旧资产保留回退。旧RoleProof/Claim服务没有操作。
- **公网**：新脚本 `node t1f-wallet-v2-live-smoke.mjs` 33项真实HTTPS检查 `T1F_WALLET_V2_PUBLIC_NO_ROUND_NEGATIVE_PASS`，六资产与源码一致，NO_ROUND/noRelease=true，realSignatures/onchainTransactions/durableWritesRequested均0。HTML SHA256 `e4b473da3ab0cb07d091804d81f1310680903811b29e3696f406f4510e58b572`，bootstrap `301c93a874ae524c7dc4e20e8c5814c45fab7bef680ec5328da872b2a1bc73a0`。
- **浏览器边界**：本机真实HTTP handler+实际构建bootstrap+合成provider验收Owner/Donor10143、错误链/账户、未授权、挂起API时钱包可用、NO_ROUND禁签；最终390px无横向溢出（client/scroll均375）、观察时间切账户后失效、控制台无error/warn。临时fixture已停止、视口已复原。公网IAB导航超时，未标公网浏览器PASS；真人MetaMask新版验收仍NOT_RUN，不能用上述合成结果替代。
- **实库**：部署后只读原Claim/Fund/Consent/Event指纹仍 `01556b358764d9c262f96c90f75cafcc`，successor release/operation/event=0/0/0；没有新迁移、正式轮次、签名、交易或持久写入。原UNKNOWN及商家结算#17限制不变。
- **识别新版**：页面四区域＋观察时间；安全诊断构建ID为 `wallet-v2-d1beddb91a74549b3cb3a2ce2e31c34a7c6c8d506be970c5d463da7fb0acbd98`。该ID由客户端源码/模板/构建配置/依赖锁计算，不随纯文档提交改变。
- **下一步仅需本人测试**：在同一公开页选择MetaMask提供方，分别在扩展中选择已授权Owner/Donor及Monad10143，点击“检查当前 MetaMask”，回报实际角色/网络/提示和观察时间。NO_ROUND与禁签是预期。若未授权或有风险警告，回报页面状态即可，不要求重复越过警告。详细步骤见源码分支 `docs/wallet-v2-verification.md`。正式签名/创建轮次继续暂停；用户“暂不提交MetaMask官方复核”决定保持，未向第三方发消息。

工程裁定：为满足已批准的可取消请求设计，API read/submit增加可选AbortSignal，原无参数调用保持兼容；若撤回该选择，代价为下游接口/测试返工，无后台变更。Git推送对象成功后本机OAuth缺workflow权限，使用已授权GitHub连接按旧HEAD lease做非强制快进至同一75cdd9c；未重写历史或扩大权限。

## 2026-10-26 Wallet V2设计已确认，授权自主实施到真人测试门槛

用户明确回答“确认设计，自主推进到需要我测试”。此前待设计确认状态已结束；方案A及具体设计均获批准，实施计划、编码、独立审查与必要的同服务部署可自主推进，不再次请求相同计划授权。执行计划：`docs/superpowers/plans/2026-10-26-wallet-client-v2.md`，3任务串行实现/独立审查：adapter+API+validation、bootstrap+controller+UI、static+CI+live验证。工作区继续复用现有Phase6隔离checkout，不触碰旧CP30。

本节为开工记录，尚无新版实现/CI/部署验收。实际运行基线仍8500627，NO RELEASE；不得把开发授权视为正式钱包签名或发券授权，暂不提交MetaMask复核决定保持。

## 2026-10-26 方案A已选定；对话改名，详细设计完成独立检查

用户明确选择A路径继续开发，并要求rename；当前对话已通过应用工具改名为“MealForward · 钱包客户端重建 A”（thread01a1780c-b63f-7542-991f-38ca7f6b05a2）。A范围是全新客户端＋成熟钱包库，保留现有后台接口及数据，不复制旧Phase6前端；下文“范围待选择”已成为历史记录。

已完成具体设计 [Wallet V2 design](https://github.com/3956ray/MealForward/blob/codex/mealforward-t1f-phase6-release-review-20261026/docs/superpowers/specs/2026-10-26-wallet-client-v2-design.md)：无异步依赖的启动控制、Wagmi Core/viem与EIP6963发现、已有授权只读检查、四种独立状态、可见等待与防迟到结果、同源session复用、严格manifest及签名前后核对、提交不确定时先读回、固定资产路径与灰度回退。已从后台协议抽出准确15字段及公开pin。独立fresh builder agent wallet_v2_builder_check只读审查返回“nothing important left”。没有将设计检查当作实现或测试PASS。

依用户指定的Superpowers brainstorming，具体设计文档需本人确认后进入writing-plans与实现。本轮已选定A，尚待详细设计确认；下一步是在原先授权的agent方式下完成实现计划、开发和独立验收，直到需要真人测试。仅文档改动，无依赖安装/产品源码/部署/迁移/实库或钱包操作。运行版本仍8500627/dep-dbfiinuc6qcc739rqdr0（沿用上次核验，本轮未重新验活）；NO RELEASE及暂不提交MetaMask复核决定保持。

## 2026-10-26 全新客户端调研：复现应用启动缺陷，替换范围待选择

用户报告正确MetaMask/Monad Testnet下Network无反应，明确授权新agent，并提出重写Phase6或采用GitHub成熟实现。本轮启动3个独立agent：wallet_v2_diagnosis、wallet_v2_reuse_research、wallet_v2_clean_design。独立设计agent只读HANDOFF/AGENTS及需求，没有读取旧Phase6实现；诊断与设计输入分开。

诊断agent以Node vm执行实际页面模块，隔离模拟签名依赖导入不返回/失败，复现连接按钮disabled且零事件绑定；模拟启动session请求不返回，复现global busy锁住连接按钮。无真实浏览器、钱包、网络或数据库参与。这证明应用存在可造成无反应的路径，不证明用户那一次的准确根因。旧单元测试跳过DOM bootstrap、公网smoke不执行JS，故此前PASS不能覆盖此缺口；已上线的反馈修复也不等于所有无反应问题已解决。连接RPC经过扩展通道，网页HTTP Network空白本身不说明点击是否执行。不要再用MetaMask风险警告解释这个应用症状。

已核对官方GitHub/docs，推荐A：全新TypeScript客户端，复用Wagmi Core/injected EIP6963/viem，保留既有同源后台契约和数据；不复制旧Phase6前端。B为前后端另起实现、旧数据只读保留。已呈交两方案并询问选择，尚未收到回答；按Superpowers brainstorming后续需选定方案、设计文档/独立builder检查及设计确认，再writing-plans与实现/独立验收。调研记录：[wallet replacement discovery](https://github.com/3956ray/MealForward/blob/codex/mealforward-t1f-phase6-release-review-20261026/docs/superpowers/2026-10-26-wallet-replacement-discovery.md)。它不是已批准设计，也不是已交付的新客户端。

本轮仅调查和文档，没有安装依赖、修改产品代码、删旧Phase6、部署、实库写入或钱包操作。正式签名暂停、NO RELEASE、用户暂不提交官方复核均保持；这不阻止新客户端隔离设计/开发。运行版本仍8500627，未冒称本轮已跑新版CI或真人验收。

## 2026-10-26 整体可用性复核：测试网局部可用，业务闭环未完成

用户要求解释全项目进度与卡点，本轮仅作只读复核。Render最新部署确认：Phase6为8500627/dep-dbfiinuc6qcc739rqdr0 live，RoleProof为c1b99b5/dep-dbfbvi4s728c73erotl0 live，Claim为c8723c2/dep-dbdto63rjlhs738br1sg live。再次实际执行Phase6公网31检查PASS，四资产匹配，NO_ROUND/NO RELEASE、零签名/交易/持久写请求。实库FUNDED=1；原Claim仍ISSUE_UNKNOWN/revision2/nonce0/deadline1792765625，hash/receipt为空；恢复release/operation均0。

新鲜只读链检查在Monad10143区块74358457（0x34bced6fa6e63fa4983f223164fd7fc0f8129e307ffd2a5174385aecfb48bfe5）显示原op未观察到、Unit available未issued、Issuer latest/pending nonce均0；不是全网/钱包不存在未知请求的证明，不授权重发。GitHub #17仍OPEN：原settle缺少链上强制180秒等待，商家结算继续关闭。

总体判断：已完成测试网资助、领取同意、身份/练习签名及正式批准收集基础设施；未完成首张餐券可确认发放、正式Recovery双签、从批准到真实恢复发券的上线验收及商家核销结算全链路。Phase5/6属于T1-F异常恢复子流程，不代表整个产品接近交付的百分比。当前公开页是专项测试/审批入口，不能作为可供公众真实经营的完整产品。钱包UI反馈已修复且有一次真实Owner连接成功；Donor及新版反馈的人类验收未完成。域名BLOCK原因仍未确定，用户“暂不提交官方复核”决定保持；本轮未重复请求、未向第三方发消息，也未重新扫描或宣称解除。后续离线开发/隔离测试可继续，与正式钱包操作暂停分开。

## 2026-10-26 用户决定：暂不提交 MetaMask 官方复核

用户明确回答“暂不提交”。复核材料继续保留为未发送草稿，不向MetaMask或其他第三方创建issue、发消息或自动提交，也不再次催促同一授权。此前“尚待回答”已被本决定覆盖。正式签名/新轮次继续暂停，NO RELEASE；没有解除域名风险分类的证据。本轮仅更新交接与草稿状态，没有应用、部署、钱包或数据库操作；应用验证仍属于下文8500627及其CI/公网记录，不宣称新验收。

## 2026-10-26 18:21（UTC+8）Owner 真实连接确认；角色旁反馈修复已上线

用户将问题页置前台后，Agent只读Chrome确认：页面显示“已连接 OWNER”、固定Owner地址及Monad Testnet 10143；MetaMask网站连接栏为Account1、Monad Testnet并有“断开连接”。本次Owner真实连接成功有直接证据；此前所有尝试不能因此概括成功，Donor真实连接本轮未验收。未点击真实连接/钱包/签名按钮。NO_ROUND时正式签名禁用，“尚未记录”指签名批准，不是连接状态。

按superpowers调试/TDD继续修复可见性：Owner/Donor各自按钮旁显示连接结果；成功按钮明确“已连接 · 重新核对”；签名批准加标签，禁用签名旁显示原因。独立审查发现钱包事件后失败会丢失角色，已加回归并仅保留错误所属角色，不恢复连接。4新增测试分别观察RED再转绿，页面测试20项。浏览器使用独立本机合成provider，检查Owner/Donor切换、错误网络、NO_ROUND禁签及390px无横向溢出；不代表真实扩展验收。钱包权限方法、签名检查与后端协议未改。

- **源码/独审/CI**：应用提交 `8500627b890589e57f46362a805bce3f006892e1`，仍为Phase6源码分支与Draft PR #47；独立agent复查无未解决阻断项。[CI #40306451109](https://github.com/3956ray/MealForward/actions/runs/40306451109) 四作业success，日志确认211项测试（182+16+13）和15组隔离PG17检查PASS。页面20项含4项本次回归；最后事件错误回归先观察断言失败再修复。
- **实际部署**：同一服务 `srv-dbfflq5g1s2s73fl05fg`，部署 `dep-dbfiinuc6qcc739rqdr0` 于2026-10-26T10:21:01.024459Z live，实际commit为上述8500627；autoDeploy仍off，无环境/权限/数据库迁移改动。入口仍 https://mealforward-t1f-approval-laodao.onrender.com 。旧RoleProof/Claim服务本轮没有操作。
- **验证边界**：31项真实HTTPS检查 `T1F_PHASE6_PUBLIC_NO_ROUND_NEGATIVE_PASS`，4资产与源码逐字节一致，NO_ROUND/noRelease=true、realSignatures/onchainTransactions/durableWritesRequested均0。HTML SHA256 `98c8d54296117f0f1c07d416bcb56bed9bc404d1c26ce8667e1d04c0e3085bc1`，JS `b45991a36d14dda4b10736aea61817ce8416ba8b42acc06f67725bd9315d6bdc`。本机独立IAB合成钱包UI验证通过；公网IAB只读导航超时，未将其标成浏览器验收，真实新版反馈尚待人工观察。合成fixture已停止，没有操作真人MetaMask。
- **实库收尾**：部署后只读旧Claim/Fund/Consent/Event指纹仍 `01556b358764d9c262f96c90f75cafcc`，successor release/operation/event仍0/0/0。没有创建正式轮次或持久写入。
- **当前门槛**：此前实证MetaMask扫描BLOCK尚无解除证据；本轮补查API超时，不能解释为已解除。复核草稿已更新公开源码/CI证据，仍未发送；用户随后明确选择“暂不提交”，保持草稿未发送。不要请求重复连接、忽略警告或创建正式轮次；待域名复核后安排剩余Donor及新版反馈人工观察。正式Recovery双签NOT_RUN、Phase5历史USER-REPORTED 2/2 PASS保留，NO RELEASE。

本轮后续文档提交使用[skip ci]，不把文档HEAD冒称另跑应用CI。

## 2026-10-26 正确账户仍无可见反应：撤回泛化根因，等待对应页面现场

**用户最新纠正优先于下文16:00结论**：用户明确说明“我是在正确的钱包下点击都没有反应的”，并进一步确认“点击后文字和按钮都没有变化”。此前观察到的Donor→Owner不匹配只证明那一次请求返回了不匹配，不能解释全部尝试，不能将本问题结案为用户选错账户。正确账户下的实际失败原因仍未确定，真人连接及正式签名均不得标记PASS。

本轮重新只读核对部署仍 `dep-dbfgcng473hc73d399g0` / `953fea650834aa475520819f0eec5763df54fc24`，工作区无应用变更。尝试读取已有Phase6标签失败；原生Chrome可读取前台，但当前前台不是对应测试页，且用户在操作浏览器，故停止切换/干预，只请求用户把出问题的Phase6页置前台、保留原状，不需要再次连接或越过警告。

独立只读agent确认一个界面观察缺口：连接完成后按钮文案不变，角色旁“尚未记录”仅指签名批准；真实连接结果在Owner/Donor区块上方的wallet-status，可能在按钮所在视口之外。现有checking文案也不区分等待权限/读账户/读网络。这些是候选诊断方向，不证明当前症状由它们引起。下一步先核对页面版本、按钮disabled状态、当前提示与钱包是否仍有待处理请求；需要代码诊断时先写失败测试，再增加就近结果和分阶段状态，不盲改权限/签名逻辑或把accounts[0]改成任意匹配账户。

MetaMask扫描BLOCK是上一节独立实证，尚未解除，也尚未证明它是正确账户无反应的完整原因。域名复核草稿未发送；本轮纠正不构成向第三方发帖的授权。没有新轮次、钱包操作、签名、部署或实库写入；NO RELEASE保持。本轮仅修正文档，不宣称新的应用测试/公网验收通过。

## 2026-10-26 16:00（UTC+8）真人复测定位账户不匹配；域名扫描BLOCK，暂停正式签名

**覆盖下文继续连接/准备正式轮次的操作建议。** 用户回传新页仍“没有任何连接”，并说明已亲自点击MetaMask风险警告的继续操作。Agent只读观察实际Chrome页面：最初页面为“正在连接OWNER”，MetaMask停在“继续操作，风险自负”的钓鱼/清空钱包警告。随后用户本人继续后，页面明确返回 **账户不匹配**，读取账户为固定Donor `0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952`，而请求角色为Owner。MetaMask网站连接栏显示Account2、Monad Testnet与“断开连接”。因此已观察到网站连接及账户读取返回，不能继续描述为无响应；尚未通过Owner角色核对，也不能把连接认作签名批准。资产列表的Sepolia筛选不代表该网站当前链。

- **风险检测实证**：MetaMask官方 `dapp-scanning.api.cx.metamask.io/v2/scan` 对该完整HTTPS域名返回 `{hostname:"mealforward-t1f-approval-laodao.onrender.com",recommendedAction:"BLOCK"}`。同次读取公开 `MetaMask/eth-phishing-detect/main/src/config.json`，blocklist/allowlist/fuzzylist没有该精确域名、onrender.com父域或含mealforward的条目。仅说明该静态名单未命中，不证明误报，不说明其他检测规则。未修改/关闭MetaMask安全设置，未代点“仍然连接”，未换域名规避检测。
- **源码与公网复核**：独立只读agent核查953fea6连接只请求eth_accounts权限，typed-data签名仍需另一次明确点击、有效COLLECTING轮次、固定角色/链/摘要及前后校验；没有交易方法。当前部署仍 `dep-dbfgcng473hc73d399g0` / `953fea650834aa475520819f0eec5763df54fc24`。本轮再次执行31项真实HTTPS smoke全部PASS，四资产逐字节匹配，NO_ROUND/noRelease=true、零签名/链交易/持久写请求。上述事实可支持厂商复核，不能证明域名误报或整个系统绝对安全。
- **实库只读复查**：旧业务整体指纹仍 `01556b358764d9c262f96c90f75cafcc`；successor release/operation/event仍0/0/0。无运行代码、部署、配置、权限或数据库写入；没有创建正式轮次。应用CI仍属上一节953fea6的207测试+15PG，本轮只有文档更新。
- **已准备但未发送的复核材料**：[MetaMask域名复核草稿](https://github.com/3956ray/MealForward/blob/codex/mealforward-t1f-phase6-release-review-20261026/docs/t1f-phase6-domain-review-request.md)。目标为MetaMask/eth-phishing-detect官方blocklist-removal issue，包含公开域名、官方扫描结果、固定源码及CI证据，不含钱包截图/活动、签名或秘密。精确域名issue搜索0条；提交前应再查重。需用户明确授权以其GitHub身份向第三方公开提交后才能发送，不因项目开发授权擅自联系外部维护者。

**当前门槛**：先处理域名风险分类，正式连接复测/Recovery双签暂缓，不创建300秒轮次、不发券。不能将用户曾自行继续视为今后自动忽略警告的批准。待风险复核后，正确的角色映射仍是Owner=`0xc4f8a468f10d5f98dcff3282516125e97f26433b`、Donor=`0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952`；不能用Donor账户通过Owner按钮。Phase5练习的USER-REPORTED 2/2 PASS保持历史结果，无需重做。正式Recovery真人签名仍NOT_RUN、NO RELEASE。

## 2026-10-26 15:53（UTC+8）Phase6 钱包连接反馈修复上线，等待真人复测

**用户实际验收发现问题**：电脑浏览器MetaMask扩展弹出账户选择，但回到页面没有明显连接结果。该反馈不记为真人连接PASS，也不能由此前HTTP/合成测试推断真人钱包已连通。通过superpowers systematic-debugging、TDD及独立只读agent复核，确认源码缺失连接状态：成功后只设置needsRefresh，页面仍显示固定期望地址和“尚未记录批准”；错误账户/网络也被统一吞为刷新提示。没有证据证明MetaMask授权协议本身失败，故保留与已通过Phase5相同的权限请求流程。

- **修复范围**：`t1-intents/public/t1f-approval.{html,mjs}` 与页面测试。独立显示“当前钱包连接”的实际账户、角色、网络；错误账户/网络、拒绝、待处理请求、未安装/断开均给出安全提示。切换账户/网络/断开立即撤销旧连接确认，只显示当前角色；连接状态与持久批准分开。NO_ROUND时解释签名按钮禁用。独立审查发现通用消息会残留旧成功文字，已改为中性提示，事实只从实时连接区域读取。长地址沿用现有窄屏换行样式。
- **应用提交与CI**：连接修复 `536085437cadaf7a781f6bd53860ed4198fde57b`，窄屏修复 **`953fea650834aa475520819f0eec5763df54fc24`**；最终 [CI #40288180862](https://github.com/3956ray/MealForward/actions/runs/40288180862) 四作业全部success，日志确认 **207项测试（178+16+13）及15组真实隔离PG检查PASS**。页面16项测试含7项新增覆盖；前5项先在旧实现观察到预期失败，再修复转绿。初次本地全量非PG测试遗漏 `GITHUB_ACTIONS=true`，3项旧quote fixture按守卫拒绝；补齐既有CI要求后178项全通过，没有修改旧资金校验。语法与diff检查通过。
- **浏览器证据**：真实Chrome无痕窗口运行仅绑定127.0.0.1的合成钱包fixture，直接使用实际页面模块和HTTP处理器；验证Owner成功、账户变化撤销、Donor成功、错误网络提示、NO_ROUND始终禁签；390px设备预览确认完整地址和提示可换行。fixture没有真实钱包、数据库、RPC或签名，已停止进程。实际用户页面只读截图证明旧页的连接反馈缺口；不能据钱包资产筛选显示Sepolia就断言dapp实际网络。新版真人扩展连接仍待用户复测。
- **实际部署**：同一Phase6服务 `srv-dbfflq5g1s2s73fl05fg`，新部署 **`dep-dbfgcng473hc73d399g0`**，2026-10-26T07:51:47.007579Z进入live，实际运行上述953fea6完整SHA；autoDeploy仍off。入口仍 [Phase6正式恢复批准](https://mealforward-t1f-approval-laodao.onrender.com)。仅更新该服务，无环境/凭据/迁移变化，旧RoleProof和Claim部署仍分别c1b99b5/dep-dbfbvi4s728c73erotl0、c8723c2/dep-dbdto63rjlhs738br1sg。
- **真实公网与实库收尾**：实际执行 `t1f-approval-live-smoke.mjs` 返回 `T1F_PHASE6_PUBLIC_NO_ROUND_NEGATIVE_PASS`，31项HTTPS检查通过，四个静态资源与953fea6源码逐字节匹配，状态NO_ROUND、realSignatures/onchainTransactions/durableWritesRequested均0；实库旧Claim/Fund/Consent/Event指纹仍 `01556b358764d9c262f96c90f75cafcc`，successor release/operation/event仍0/0/0。未创建正式轮次、未签名或发送交易；数据库17条迁移及权限保持上一节实况。NO RELEASE不变。

**本人下一步**：刷新原入口，确认出现“当前钱包连接”；在MetaMask选择Monad Testnet（10143），只选择本页对应的固定Owner或Donor账户并确认连接。返回页面应显示“已连接 OWNER/DONOR”及实际地址；两角色逐个测试，不要求同时连接。若失败，回传该区域的完整提示文字即可，不需原始签名、cookie或开发者工具内容。`NO_ROUND · 0/2 · NO RELEASE`和签名按钮禁用仍属预期，“尚未记录”指尚未签署批准。真实连接通过、取得新鲜Issuer活动观察且用户准备好后，才明确创建300秒轮次；不要用之前的空活动回传伪造新观察时间。正式双签及实际Issue门槛保持不变。

此节为 `[skip ci]` 文档提交；应用验证属于953fea6，不冒称后续文档HEAD另跑CI。

## 2026-10-26 15:11（UTC+8）Phase6 已实际启用；公网通过，等待本人测试

**本节覆盖下文“真实环境等待批准”“源码未部署”“数据库仅001–012”的历史状态。** 用户明确回传“批准 并继续下一阶段开发 直到需要我进行测试”，批准了已提供的分步启用方案。现已完成013–016、专用最小权限账号、独立免费Render服务及实际公网验证。Phase5练习仍为USER-REPORTED 2/2 PASS，无需重做；**正式Recovery签名仍NOT_RUN，当前NO_ROUND，始终NO RELEASE**。

- **真实入口**：[Phase6正式恢复批准页面](https://mealforward-t1f-approval-laodao.onrender.com)。Render LaoDao服务 `srv-dbfflq5g1s2s73fl05fg`，部署 `dep-dbfflqtg1s2s73fl07m0`，2026-10-26 07:03:04 UTC进入live；实际应用提交 **`cb974115c3bf5198499394bf75ad455e47bdc2cc`**。Node22、Singapore、free、autoDeploy=off。源码分支 `codex/mealforward-t1f-phase6-release-review-20261026`，仍为 [Draft PR #47](https://github.com/3956ray/MealForward/pull/47)，未整支合并到旧发布分支。后续文档提交不改变此运行版本。
- **实际迁移**：Supabase `ketfrukrcuosrqynnsay` 顺序执行013=`20261026064525`、014=`20261026064614`、015=`20261026064724`、016=`20261026064745`，另专用角色非秘密迁移=`20261026064853`，合计17条。013审查 `bc78fcf5-a76c-4301-b0c3-5fcd37411d30` 为 `MANUAL_REVIEW_ONLY_NO_NEW_ISSUE`，所有may_*为false；014槽位 `e197f0cb-412e-4412-b8d5-9c15059e21e7` 为 `REVIEW_HOLD`，所有successor/receipt/release字段为空、权限false。015保持HOLD，release/operation/event行数 **0/0/0**；016当前round为空，没有创建正式轮次。
- **启用前新鲜链核验**：2026-10-26T06:44:03.510Z，同一canonical block **74312720** / **`0xb04560b3ddfbfce507f4ad411823d203f5320ad2e6ab5b076bfeb5741c50aa4e`**，固定合约/权限/Funding receipt/账目匹配，Issuer latest/pending nonce均0、unit available且未issued、余额7000000。仅只读检查，关闭issuer simulation。本人此前空活动报告仍只是历史人工观察，非所有mempool为空证明；正式轮次必须重新取得120秒内的观察。
- **真实连接修复**：Supabase session pooler忽略启动options里的role，实际专用连接先复现启动拒绝。`732e719` 改为每次取得连接后显式等待固定SET ROLE及5s/2s限制，再查询；交叉审查发现该等待会跨过取消/到期门槛，`cb97411` 在实际写SQL前再次检查取消及deadline。先复现再修复，新增5项回归；不增加运行权限，不用Promise.race伪装取消写入。
- **专用身份与独立实库审查**：login仅可SET到runtime，无管理/建库/建角色/绕过RLS权限；owner/runtime均NOLOGIN。五个受限函数、私有表/列/序列、固定search_path、不可变触发器及旧业务禁止写入均核对通过，security advisors lints=[]。凭据私密生成并仅配置到批准的Supabase/Render；角色迁移不含密码，凭据未显示或进入Git。私有操作员配置在 `/Users/mili/.mealforward-phase6-20261026/runtime.json`（目录0700、文件0600），必须进程内读取，禁止打印内容或把DSN放入命令参数。实际TLS连接验证session_user=专用login、current_user=runtime、NO_ROUND。
- **验证证据**：[CI #40283157818](https://github.com/3956ray/MealForward/actions/runs/40283157818) 在上述实际应用提交四作业全部completed/success：**200项测试（171+16+13）及15组真实隔离PG17行为检查全部PASS**。实际运行 `t1f-approval-live-smoke.mjs` 返回 `T1F_PHASE6_PUBLIC_NO_ROUND_NEGATIVE_PASS`，**31次真实HTTPS检查PASS**，覆盖health、session/state、同源/跨源/请求体/cookie/禁用路由，以及四个静态资源与部署源码逐字节相符。realSignatures=0、onchainTransactions=0、durableWritesRequested=0。它是实际本地执行的公网检查，不冒充GitHub公网CI或真人钱包验收。
- **浏览器验证边界**：桌面浏览器自动化两次打开超时，未取得新服务实际渲染证据；真实页面显示、MetaMask连接及正式双签仍待本人测试。既有隔离预览不替代公网浏览器PASS。网络/HTTP验证已通过，不能据自动化超时判断用户浏览器必然失败。
- **收尾复查**：旧Claim/Fund/Consent/Event整体指纹仍 `01556b358764d9c262f96c90f75cafcc`，原Claim仍ISSUE_UNKNOWN/revision2/nonce0/deadline1792765625/无hash或receipt。RoleProof仍 `dep-dbfbvi4s728c73erotl0` / `c1b99b5ed66831c364ba51d23653854756c6d1f4`；旧Claim仍 `dep-dbdto63rjlhs738br1sg` / `c8723c2f280e4b72ff067e0be08f5bf1c4a15412`。未发券、未发送链交易、未开放结算。下文已记录的非阻断历史唯一约束测试缺口与未来原子释放门槛仍适用。

**现在交给本人的测试：** 在有MetaMask的浏览器打开新入口，等待免费实例唤醒，确认 `NO_ROUND · 0/2 · NO RELEASE`。可分别连接固定Owner `0xc4f8a468f10d5f98dcff3282516125e97f26433b` 和Donor `0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952` 并刷新状态；正式签名按钮此时应禁用。选择Monad Testnet（10143），重新查看Issuer `0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3` 的活动/待处理队列，并在已准备好连续完成双方签名时回传页面和钱包现状。若有交易回传公开hash即可。不能以旧报告伪造新时间。

**收到新鲜观察及就绪回传后**：操作员依[runbook](https://github.com/3956ray/MealForward/blob/codex/mealforward-t1f-phase6-release-review-20261026/docs/t1f-phase6-approval-runbook.md)重新只读核验并明确创建一轮300秒正式批准，再提供同轮Owner→Donor签名步骤。不得提前让计时耗尽、自动续轮或自动签名。2/2只代表本轮批准收集完成，仍NO RELEASE；真实Issue是未来独立门槛。本节是 `[skip ci]` 文档更新，不宣称文档HEAD另跑过应用CI。

## 2026-10-26 14:37（UTC+8）Issuer 空活动回传已核对；Supabase 兼容性修复通过

**覆盖下文“等待 Issuer 活动核对”状态。** 用户针对 Issuer `0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3` / Monad Testnet 的活动与待处理队列检查回传：**“没有任何的内容和活动在这个地址里面。”** 记为 `OWNER_REPORTED_NO_TRANSACTIONS_VISIBLE`（本人回传，非 Agent 直接查看钱包、非全部节点 mempool 为空的证明）。当前回传用于恢复前检查；不得将其时间伪装为后续新观察，创建正式300秒轮次时仍须满足120秒新鲜度。

- **新鲜公网只读核验已实际执行**：2026-10-26 06:22:28 UTC，chain10143，同一 canonical block **74308442** / **`0xed598e8b154df9b2f0102fc7f5165582b06e9c0f24b0ac70db83a8bb86684db2`**。`firstVoucherCandidate({simulateIssuer:false})` 和 `inspectExpiredOriginalIssuer` 同块通过；原合约字节码、固定权限、原Funding receipt、原批次、账目均匹配，7 USDC余额/负债、1 available单位。Issuer latest/pending nonce均0，原op未观察到，unit未issued。状态 `T1F_EXPIRED_NO_ISSUE_OBSERVED_NOT_ABSENCE_PROOF`；零RPC写方法、零签名、零交易。仍不能据此宣称交易从未广播。
- **实库兼容性审查发现并修复两项缺口**：Supabase postgres实际非superuser、PG170011、CREATEROLE且createrole_self_grant为空，原016无法SET到新owner；另有无schemaUSAGE的统计视图PUBLIC SELECT，被原启动检查误判。通过真实临时PG17先复现42501和启动拒绝，再分别修复，不改任何平台全局ACL或旧业务权限。
- 016兼容修复 **`de37543`**：仅迁移事务内借用owner SET能力，提交前撤销自身授予关系；保留PG原生ADMIN-only创建者关系，SET/INHERIT=false。运行角色未扩大。运行检查修复 **`cdafe159228435e3f4ecce766733493f19f88f43`**：只忽略无schema访问权的环境PUBLIC表权限，显式表/列授权、ownership、业务表权限和有效schema访问仍拒绝。013–015字节未动。
- **最新 CI [#40280611850](https://github.com/3956ray/MealForward/actions/runs/40280611850)** 在 **cdafe159228435e3f4ecce766733493f19f88f43** 四作业全部completed/success；日志确认189测试（160+16+13）与 **15组真实隔离PG行为检查全部PASS**。新增组覆盖非superuser迁移、临时权限清理、平台环境授权与直接表/列/schema越权拒绝。只读agent交叉复核新谓词与实库ACL，无该修复范围内的未解决阻断项。旧非阻断测试缺口仍见下节，不扩大此结论到实际部署或正式钱包。
- **CI后实库复查**：Claim仍ISSUE_UNKNOWN/revision2/nonce0/deadline1792765625/无hash或receipt；013审查表和016schema均不存在，迁移仍001–012。本轮没有实库写入。RoleProof仍 dep-dbfbvi4s728c73erotl0 / c1b99b5；此前旧Claim运行c8723c2也未被本轮改动。当前PR仍 [Draft #47](https://github.com/3956ray/MealForward/pull/47)，未合并/部署。
- **可审查的下一步方案**：[Phase6实际启用方案](https://github.com/3956ray/MealForward/blob/codex/mealforward-t1f-phase6-release-review-20261026/docs/t1f-phase6-activation-proposal.md)，包含固定项目/服务范围、SQL SHA256、013审查/014 held slot参数化写入模板、015 HOLD/016顺序、专用账号权限、独立免费Render服务配置、每步断言及回退。不得将测试fixture用于实库。凭据私密注入机制若不可用，停在已完成的HOLD阶段并交由本人直接输入，不能把秘密回传到工具日志或使用旧高权限账号。

**当前门槛：真实环境启用的具体确认。** 钱包空活动这项人工核对已完成；该报告本身不是013–016实库迁移/新凭据/新服务的批准。013源码原有要求 `Never apply to live without a separate migration approval and fresh public-chain/MetaMask revalidation`，runbook同样将实际启用单列。现在源码修复、回归、交叉检查与具体方案已备齐，确认范围应为：按方案分步启用013–016、最小权限专用账号与独立Phase6收集服务，始终NO RELEASE，不发券、不签名/广播、不开放settle。实际公网与真人正式Recovery签名仍NOT_RUN。正式签名轮次只在独立服务公网验证后创建。

本节及方案为 `[skip ci]` 文档更新，最新CI证据属于上列cdafe159，不宣称后续文档HEAD另跑过CI。

## 2026-10-26 Phase6 源码交付候选 — 正式批准收集，始终 NO RELEASE

**Phase5 真人练习：USER-REPORTED 2/2 PASS · NO RELEASE，无需重做。正式 Recovery 真人签名仍 NOT_RUN。** 本节优先于下文“开始开发”记录；本轮完成源码和隔离验证，尚未启用真实 Phase6 服务。

- 新分支 `codex/mealforward-t1f-phase6-release-review-20261026`，基于 PR #46 的 `c3a6bf0beecd30d5ac53479f16dfcb38a68b6c03`；数据库实现 `024c702`，服务实现 `3ec8c1b`，最终审查修复 `6a42dc3`。[Draft PR #47](https://github.com/3956ray/MealForward/pull/47) 已创建；已测试 HEAD **`b666d10dfe523c1093722e52f10566d378efef76`** 的 [CI #40270078908](https://github.com/3956ray/MealForward/actions/runs/40270078908) 四作业全部 completed/success（2026-10-26 12:38 UTC+8），云端同样189测试+13组PG通过。后续仅本交接和计划勾选的 `[skip ci]` 文档提交，不能宣称文档HEAD另跑CI。独立工作区 `/Users/mili/Documents/Developer/mealforward-phase6-release`，保留旧 checkout/CP30。
- 新增 `016_t1f_recovery_approval_collection.sql`、`t1f-approval-{store,protocol,service,server,operator}.mjs`、独立 `public/t1f-approval.*`、测试及四作业 workflow。完整操作步骤见 [Phase6 runbook](https://github.com/3956ray/MealForward/blob/codex/mealforward-t1f-phase6-release-review-20261026/docs/t1f-phase6-approval-runbook.md)，设计/计划在 `docs/superpowers/`。
- `mf_t1f_recovery` 保存不可变轮次及双方验证指纹，不保存原始签名。NOLOGIN 的 owner/runtime 角色仅获必要能力；运行账户须独立最小权限，启动检查实际权限与严格 TLS。013–015 文件字节未改，015 仍 HOLD，旧 Fund/Claim/Consent 不写，不产生 release/successor/交易数据。
- Owner/Donor 使用同一正式 `MealForward T1F Recovery` v1 / `SuccessorIssueRelease` 摘要；仅操作员凭新鲜钱包观察创建300秒轮次，不自动换轮。刷新可以读回已存结果，过期显示 EXPIRED；完成状态 `COLLECTED_NO_RELEASE` 仍不能 Issue。
- superpowers 已完成设计、计划、分工实现、RED→GREEN、独立数据库及全分支审查。最终审查两个 Important（到期后缓存2/2、签名前展示不完整）均先复现再修复；无未解决 Critical/Important。完整签名域及15项内容现展示在签名按钮之前。
- **本地最终验证：189项测试全通过**（非PG160、旧core16、旧HTTP13，按不同固定DSN分开运行，无跳过），另 **真实临时 PostgreSQL17.11 的13组行为检查通过**（精确009–016、角色权限、并发/重放/过期/不可变/零释放）。`npm run check`、新模块语法、YAML与diff检查通过。命令/环境由 `.github/workflows/mealforward-t1f-phase6-approval.yml` 完整固定；无锁文件，沿用仓库CI的无脚本 npm install。
- 真浏览器隔离预览完成桌面/390px手机布局、会话刷新、完整内容换行、模拟2/2自动过期检查。预览使用合成批准，无真实钱包/实库/RPC，不能作为真人正式验收。截图保存在本任务 visualizations 目录；临时服务/PG/标签已关闭。
- 非阻断待补：PG套件未专门覆盖“历史轮次 fingerprint/nonceDomain/newOpId 被新轮复用”的三项独立回归，唯一约束已审查。数据库信任受审服务的密码学验证；旧记录检查是快照，不保证跨提交冻结。因当前严格 NO_RELEASE 可接受，未来释放必须另做原子新鲜校验，不能复用此结论直接发券。
- 推送及CI后再次只读复查（12:39 UTC+8）：Supabase `ketfrukrcuosrqynnsay` 仍001–012，security advisors无告警；RoleProof仍 `dep-dbfbvi4s728c73erotl0` / `c1b99b5ed66831c364ba51d23653854756c6d1f4`，无新部署；旧Claim服务仍 `dep-dbdto63rjlhs738br1sg` / `c8723c2f280e4b72ff067e0be08f5bf1c4a15412`。原 Claim `fbab3b22-965d-44e2-b144-d7307b7aa8ea` 仍 ISSUE_UNKNOWN/revision2/nonce0/deadline1792765625/无hash与receipt。无hash不等于未广播；本轮未作全链恢复证明。

**当前需要用户的人工核对：** 打开 MetaMask 的 Monad Testnet，选择 Issuer `0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3`，查看活动记录及待处理队列，回传与原 Issue 有关的状态；若有交易，回传公开交易hash即可。不要点击加速、取消、重试或重置账户。仅本人的钱包可显示本地待处理/未广播请求，链上查询或数据库无hash不能替代。此步是恢复前检查，尚非正式签名测试；创建300秒正式轮次前仍须重新取得120秒内的新鲜观察。

**下一实际门槛：**按 runbook 审查并逐步启用013→审查记录→014 held slot→015 HOLD→016、专用最小权限账号和独立服务，不能整分支合并到原Render发布。此前先取得新鲜 Issuer 钱包活动观察并复核链上原操作；缺任一项停止。真实迁移/凭据/服务启用、正式双签与实际Issue是不同门槛。此轮未做任何实库写入、正式签名或链交易。失败时仅停用新collector，保留审计，不删除记录或重发UNKNOWN。

## 2026-10-26 Phase5 真人验收通过，进入 Phase6 隔离开发

用户在本聊天明确回传：**“Owner 和 Donor 都已显示练习签名验证成功，页面是 2/2 PASS · NO RELEASE。”** 因此将 Phase5 Owner、Donor 两项真人 MetaMask EIP-712 练习验收记为 **USER-REPORTED PASS**，覆盖下文 PENDING 状态。证据是用户本人回传的页面结果；服务无持久 Session/签名记录，不冒充服务器永久批准，也不要求提交原始签名。Phase4 原双 EIP191 PASS 保留，无需重做。

用户同时授权继续按 superpowers 开发到下一次确需本人测试，并已允许使用 agent。当前开始 Phase6 的独立恢复批准服务、016+ 最小权限规则与隔离测试设计/实现；具体完成状态以后续本文件新增条目为准，此刻不宣称已交付。本轮新查 RoleProof 仍 Live dep-dbfbvi4s728c73erotl0 @ c1b99b5ed66831c364ba51d23653854756c6d1f4，原 Claim 仍 ISSUE_UNKNOWN/revision2/nonce0/deadline1792765625/无 hash。

此用户反馈只完成练习兼容性验收。继续开发不自动批准真实 Supabase 013–016+ 迁移、新运行凭据、正式 Owner/Donor Recovery Release 签名或 Issuer 链上交易；这些到具体可审查、可执行步骤时再交用户确认。旧 Fund/Claim/Consent/Nonce 保持冻结，不重发旧 UNKNOWN、不开放商家结算。


## 2026-10-26 11:40（UTC+8）Phase5 公网核验完成 — 可开始双钱包真人练习，尚非真人 PASS

**本节取代下文“公网超时待验证”“部署进行中”“不要重签”的旧阶段判断，仅适用于 Phase5 无资金练习。** 本轮用户授权继续按 superpowers 排障及创建 agent；已执行 systematic-debugging、verification-before-completion，并由只读 agent 独立复核练习签名源码和操作步骤。真人 Owner/Donor 的新版 Phase5 验收仍为 **PENDING**，Phase4 两次原 EIP191 PASS 保留，不重做。

**11:42（UTC+8）收尾 CI 补记：** 本轮文档提交后的发布 HEAD `e8d24c537e8044e24f2cf41482e385583ef9e222` 七组 workflow 全部 completed/success，包含新的真实公网 [Phase5 #40265313353](https://github.com/3956ray/MealForward/actions/runs/40265313353)、[Phase4 #40265313412](https://github.com/3956ray/MealForward/actions/runs/40265313412)、[签名回归 #40265313491](https://github.com/3956ray/MealForward/actions/runs/40265313491) 和只读链/PG17 #40265313407。规范交接分支文档提交 `c30cb69e422f7395456e02b144cbfcbd239491f6` 的三组 CI 也全部成功，包含 [公网 #40265311001](https://github.com/3956ray/MealForward/actions/runs/40265311001)。本补记为 `[skip ci]` 的纯文档提交，避免记录结果再触发同样检查；不冒充补记 HEAD 另跑了测试。实际部署仍 c1b99b5 / dep-dbfbvi4s728c73erotl0，真人两次 Phase5 仍待用户执行。

### 当前运行与 CI 的准确区分

- **Render 工作区/服务**：LaoDao `tea-db7q3ou7bikc73bp2bt0`，RoleProof `srv-dbdeuft9fdbs73atbvh0`，URL https://mealforward-t1e-role-proof-laodao.onrender.com 。再次查询确认 Live 部署仍是 `dep-dbfbvi4s728c73erotl0`，实际运行 Commit **`c1b99b5ed66831c364ba51d23653854756c6d1f4`**；未重新部署。服务为 free、Singapore、autoDeploy=off、非暂停、maintenance=false，启动命令仍 `cd t1-intents && npm run start:t1e:proof`。
- **发布源码 HEAD**：文档更新前发布分支 `codex/mealforward-t1e-issuer-original-tx-verifier-20261023` 为 **`9824bf09a87c207c6186bee8c9f2f30a093e2318`**。与运行 Commit c1b99b5 比较仅增加一个 workflow 配置提交，将 `.github/workflows/mealforward-t1f-phase5-live-https.yml` 的 EXPECT 改为 true；应用源码一致。因此当前线上**已启用** Phase5 是本次实际观测结果，不再按旧文档 false 假定。该开关/该配置提交在本轮开始前已存在，本轮没有改开关或发布源码。
- **GitHub 重新查询**：9824bf09 上七个 workflow 全部 completed/success。关键独立公网 [Phase5 #40261154801](https://github.com/3956ray/MealForward/actions/runs/40261154801)、[Phase4 #40261154748](https://github.com/3956ray/MealForward/actions/runs/40261154748)、[Owner/Donor 签名回归 #40261154732](https://github.com/3956ray/MealForward/actions/runs/40261154732)。这些是已有 CI 的实时查询，不冒充本轮新运行。此文件文档提交会使分支 HEAD 变化；该文档提交的 CI 在写入时尚未检查，不能自动继承上述 PASS。部署 Commit 不因文档更新自动变化。
- **独立源码审查**：部署 c1b99b5 的 Phase5 module、frontend、public smoke 与 PR #46 源码一致；完整四字段 EIP712Domain、Practice v0、PracticeControl、10143、固定 escrow 皆存在。PR #46 与发布分支其余内容显著分叉，**不可整支合并到 Render**，更不能附带 013–015 SQL 或 successor runtime。

### 超时调查结论及本次新鲜公网证据

- 原先每次 25 秒无响应的故障本轮未持续复现。当前 DNS 正常、无进程代理变量，IPv4 与默认 HTTPS 请求均成功；Phase4/Phase5 status 200，延迟约 0.8–1.4 秒；额外页面/脚本/health GET 200，约 0.4–3.3 秒。未发现需要修复的持续应用错误，因此未盲目重启或改业务代码。
- Render app 日志显示 03:11:13 UTC（北京时间 11:11:13）新进程启动，03:11:16 输出 `T1E_ROLE_PROOF_ONLY_READY,noFinancialWrites=true,noDatabaseConnected=true`，在上一轮超时之后。结合实际 free 实例与 [Render 官方说明](https://render.com/docs/free#spinning-down-on-idle)：空闲 15 分钟可休眠，首次请求唤醒通常约一分钟，**证据支持冷启动超出原 25 秒探测窗口的解释；缺少当时边缘请求追踪，不能把它写成已证明的唯一网络根因**。
- **本轮实际执行**发布源码 `t1-intents/t1f-phase5-live-smoke.mjs` 的 `attestPhase5Live`（EXPECT=true），返回 **`T1F_PHASE5_TYPED_PRACTICE_PUBLIC_NEGATIVE_PASS`**，enabled=true、requests=23、realWalletSignaturesCollected=0、dbWrites=0、onchainTransactions=0、recoveryApproved=false。本地执行时显式 import 调用入口，避免 macOS /tmp 符号链接与 import.meta.url 判定导致“exit0却未执行”的误报。
- 23 次真实 HTTPS 检查已覆盖 Owner 与 Donor 挑战：固定钱包、`MealForward Phase5 Typed Wallet Practice` / version0 / primary PracticeControl、chain10143、原 escrow `0xcf0c8827c8610eeff1ecbd9719e559d805fafe58`、purpose 为 `PRACTICE ONLY - NO RECOVERY RELEASE, NO ISSUE, NO FUNDS`，以及按顺序 name:string / version:string / chainId:uint256 / verifyingContract:address 四个 Domain 字段。
- 同次检查确认错误钱包、未签名 verify、跨站 Origin、伪造钱包 header、恶意 query 被拒绝；六个 release/issue/claim/settle/fund 路由均405；旧 T1E 和 Phase4 兼容；无 Cookie。只产生两条 120 秒内存挑战，无真人签名、数据库或链上动作。
- 额外公开 GET 的 Git blob 指纹：线上 `/t1f-phase5.mjs` = `19de769c30bcfe5ccc4a5980db4582523abcbd51`，`/t1f-phase5.html` = `fffeea47b4ec69b773996151b7c66d3b080dfe25`，与部署源码逐字节相同；无 Set-Cookie，Cache-Control no-store，CSP frame-ancestors none。浏览器自动化打开超时，故本轮不声称完成真实浏览器或真人 MetaMask 验收。
- **以后公网核验操作**：先对同源 `/health` 做有界只读预热，确认200/noDatabase/noFunds后再跑完整 smoke。休眠时让首页完成加载，约等待1分钟，必要时1–2分钟后手动刷新一次；不要为唤醒反复点签名或发券。现有 smoke 首批并发中只有 health 用120秒，其余40秒，未来可另做小范围测试改进；本轮已预热并实际通过，不因这个观察引入新的发布。
- 可重跑命令：在准确发布源码的 `t1-intents` 目录，`EXPECT_PHASE5_TYPED_PRACTICE=true node t1f-phase5-live-smoke.mjs`；只读预热可用 `curl --connect-timeout 10 --max-time 120 https://mealforward-t1e-role-proof-laodao.onrender.com/health`。不要在当前 enabled 服务错误运行 EXPECT=false 检查。

### 实库冻结再核与本轮变更范围

Supabase `ketfrukrcuosrqynnsay` 本轮只读确认：12 条既有迁移，末条 `20261023105932 mealforward_t1f_issuer_issue_deadline_immutable_v1`；013–015 未安装。FUNDED=1、Claim ISSUE_UNKNOWN=1、CLAIM_PREPARED=1、CONSENT_VERIFIED=1、ISSUE_RESERVED=1。原 Claim revision2、issuer nonce0、deadline1792765625、无 issuer_tx_hash；Security Advisors lints=[]。未重新核链上状态，不能仅据无 hash 断言未广播。

本轮只读排障、临时源码核验和更新 HANDOFF；**无运行配置写入、无新部署、无实库写入/迁移、无资金或链上交易**。旧 Claim/Issuer 服务和 Mac CP30 不动。正式 Recovery Release、第二次 Issue、Lock/Report/Settle 继续禁用，未知原操作不重发。接手授权与练习验收不等于真实恢复批准。

### 用户下一步：同一页面完成 Owner + Donor 两次练习

1. 用有 MetaMask 的浏览器打开 **https://mealforward-t1e-role-proof-laodao.onrender.com/t1f-phase5.html**。首次冷启动按上述等待页面就绪，页首应为 `PHASE5 EIP-712 PRACTICE · 0/2 PASS · NO RELEASE`；保留本页，刷新会清空本页计数。
2. 在 MetaMask 选择 **Monad Testnet，Chain ID 10143**。点击 **“选择 Owner 钱包”**，选择原 Owner `0xc4f8a468f10d5f98dcff3282516125e97f26433b`，该卡应显示“钱包和网络正确”。
3. 点击 Owner 卡 **“本人 EIP-712 练习签名”**。本人核对弹窗域是 **MealForward Phase5 Typed Wallet Practice**、version **0**、类型 **PracticeControl**，purpose 是 **PRACTICE ONLY - NO RECOVERY RELEASE, NO ISSUE, NO FUNDS**，再确认签名。挑战有效120秒；超时只在此练习卡重新发起，不碰 Issue 页面。
4. 同页点击 **“选择 Donor 钱包”**，选原 Donor `0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952`；确认10143和“钱包和网络正确”，点击 Donor 卡 **“本人 EIP-712 练习签名”**，核对相同 Practice 域和用途后本人确认。
5. 成功应分别显示 `PASS · OWNER EIP-712 练习签名验证成功`、`PASS · DONOR EIP-712 练习签名验证成功`，页首变为 **`2/2 PASS · NO RELEASE`**。仅回传这些脱敏结果或错误文字；不要回传原始签名、私钥或 Cookie。
6. 若出现真正 `MealForward T1F Recovery` / `SuccessorIssueRelease`、交易/代币授权请求或资金动作，不签并反馈。Phase5 只是无 gas 的练习签名，2/2 PASS 仍不是恢复批准。收到用户结果后再更新本 HANDOFF 的真人验收状态；目前仍 PENDING。


## 2026-10-26 11:10（UTC+8）Codex 接手核验 — 云连接已确认，Phase5 公网仍待验证

**本段为本次接手的最新只读证据，优先于下文旧部署“进行中”描述。** 用户已授权接手项目、使用 obra/superpowers 工作流程，以及连接 GitHub / Vercel / Render / Supabase。本轮只做接手核验与本文件更新，未改服务配置、未启用 Phase5、未迁移实库、未签名或发送链上交易。已读取 superpowers 的 using-superpowers、Codex 工具适配与 verification-before-completion；未来实现按相应技能执行。

- **GitHub**：连接器确认 3956ray/MealForward 可读写，默认分支 main；本文件所在 PR #45 仍 Open Draft，更新前 HEAD `0bf83bcc007307a45161aaf65fa624e385bd2295`。签名修复 PR #46 仍 Open Draft，HEAD `c3a6bf0beecd30d5ac53479f16dfcb38a68b6c03`，应用修复提交仍为 `fbbc5c3f77b2466f5de66cb295d783eb6e35d652`。这次文档提交会改变 PR #45 HEAD，后续须实时重新查询。只检查了 PR 元数据，没有完成新的全量代码审查或合并。
- **CI 重新核实**：通过 GitHub job API 查到 [40259382619](https://github.com/3956ray/MealForward/actions/runs/40259382619) 的 owner-donor-proof、[40259671961](https://github.com/3956ray/MealForward/actions/runs/40259671961) 的 phase5-public 均 completed/success。这是既有运行结果的重新查询，不是本次重跑，也不表示本次文档 HEAD 或当前公网已通过测试。按 commit 列举 workflow 的连接器仅过滤 pull_request 事件，本次返回空，不能据此断言所有 CI 不存在或失败。
- **Render 实况已前进**：RoleProof `srv-dbdeuft9fdbs73atbvh0` 最新部署 `dep-dbfbvi4s728c73erotl0` 为 **live**，Commit `c1b99b5ed66831c364ba51d23653854756c6d1f4`，deploy_ended 事件为 succeeded（北京时间 10:50:36）。下文 `dep-dbfboglg1s2s73f6mh20` 已成功后被替换，当前为 deactivated；其应用 Commit `6d085568d802725f7281439005d0f20c6ffe32ca` 不可冒充当前部署 HEAD。Claim/Issuer 服务 `srv-dbdgstivcj2c73fnqcc0` 仍 Live `dep-dbdto63rjlhs738br1sg` @ `c8723c2f280e4b72ff067e0be08f5bf1c4a15412`。
- **公网未通过本次核验**：对 RoleProof 的 `/v1/t1f/phase5/status` 与 `/v1/t1f/phase4/status` 两次独立 HTTPS GET 各等待 25 秒，均超时、未收到 HTTP 响应；另一网页读取工具也无法访问。故只能确认 Render 控制面 Live，不能声称当前公网健康、Phase5 flag 当前值或两角色 typed challenge 已验收。没有读取环境变量值；启动日志查询因工作区未选择返回错误，未将其当作有效日志证据。不要仅据 Live 邀请用户重新签名。
- **Supabase 本次只读确认**：`mealforward-t1-staging` / `ketfrukrcuosrqynnsay` 为 ACTIVE_HEALTHY；迁移列表恰为原 12 条，最后 `20261023105932 mealforward_t1f_issuer_issue_deadline_immutable_v1`，013–015 未安装。聚合查询确认 FUNDED=1、Claim ISSUE_UNKNOWN=1、CLAIM_PREPARED=1、CONSENT_VERIFIED=1、ISSUE_RESERVED=1。原 Claim revision=2、Issuer nonce=0、deadline=1792765625、无 issuer_tx_hash；Security Advisors lints=[]。本次没有链上 RPC 复核，因此数据库无 hash 不能解释为链上一定未广播。
- **Vercel**：已能列出同团队的 mealforward、mealforward-experience-sandbox、mealforward-real-testnet-pilot 三项目；本轮未改部署、域名、环境变量，也未审计前端生产健康。
- **本地状态**：发现旧 checkout `/Users/mili/Documents/Developer/mealforward` 停在 `codex/mcpay-local-mvp`，不是上述云试点最新分支。本次没有切换或覆盖它；后续开发须取得最新目标 ref 并按工作区规则隔离，不得直接在旧版本实施本轮修复。

**下一步顺序**：先排查并重新取得公网 Phase4/Phase5 响应，确认 RoleProof 的实际部署源码、Phase5 flag 和无数据库/资金写入边界；完成关闭模式的 HTTPS 门禁后，才能按既有安全发布流程推进练习启用、校验 Owner/Donor 四字段 EIP712Domain 及资金路由拒绝，再邀请两位本人重做 Phase5 练习签名。Phase4 的两次真人 PASS 不重做。真正 Recovery Release、实库新迁移及第二次 Issue 仍未获本轮授权，不重复 Fund/Claim/Consent、不重置旧 UNKNOWN、不开放 Lock/Report/Settle；未来每轮仍须更新本文件。

## 2026-10-26 MetaMask V4 实际双钱包 401 修复进度 — CI PASS，RoleProof 安全灰度中

**本段优先级高于下面旧的「修复尚未提交」事故记录；以下是 2026-10-26 的实时阶段性事实。** 用户明确授权修复，但 Owner／Donor 尚未完成本次 Phase5 真人新验收（两人先前均 401）。Phase4 EIP-191 两项真人 PASS 仍有效，不必重复签。

- **401 根因已由 MetaMask 官方文档与 eth-sig-util 源码证实。** 原 `t1-intents/t1f-phase5-typed-practice.mjs` 返回给 `eth_signTypedData_v4` 的 `types` 只有 `PracticeControl`，缺少 `EIP712Domain`；MetaMask 的 `sanitizeData` 对缺失 Domain Type 填空数组，令其按空 Domain Hash 签名，与后端 ethers `verifyTypedData` 的完整 `name/version/chainId/verifyingContract` Domain Hash 不一致。于是 Owner 和 Donor 都返回 `T1F_PHASE5_SIGNATURE_INVALID · 401`，与钱款/权限无关。MetaMask 官方说明 `types.EIP712Domain` **必须显式声明**；参考 https://github.com/MetaMask/eth-sig-util/blob/main/src/sign-typed-data.ts 与 https://github.com/MetaMask/metamask-docs/blob/main/metamask-connect/multichain/guides/sign-transactions.md。
- **修复已提交而非仅建议：** 独立 [Draft PR #46](https://github.com/3956ray/MealForward/pull/46)，源分支 `codex/mealforward-phase5-metamask-v4-domain-fix-20261026`，通过测试的应用源码提交 `fbbc5c3f77b2466f5de66cb295d783eb6e35d652`；原 [PR #45](https://github.com/3956ray/MealForward/pull/45) 的 015 `HUMAN_REVIEW_HOLD` 数据库禁发门禁不变。修复内容**仅限 Phase5 的 Practice 签名服务与前端**：JSON-RPC V4 typedData 增加四个按标准排序的 `EIP712Domain` 字段；前端核对固定 Testnet escrow 地址、完整 Domain 字段和值后才请求 MetaMask；后端 ethers `verifyTypedData` 仍用不含额外 Domain type 的原 `PracticeControl` 类型。Practice 域 `MealForward Phase5 Typed Wallet Practice` version `0` 与真正 Recovery `MealForward T1F Recovery` version `1` 完全隔离。
- **根因回归已经通过：** [GitHub Actions #40259382619](https://github.com/3956ray/MealForward/actions/runs/40259382619) **PASS**，包括两只合成 EOA MetaMask V4 JSON 域编码与后端 ethers 校验一致、模拟旧空 Domain 签名返回 401、EIP191/Phase4 回归和 HTTP 角色/跨站/过期/防重放负测。发布分支应用 Commit `6d085568d802725f7281439005d0f20c6ffe32ca` 的七组 Actions [#40259671961](https://github.com/3956ray/MealForward/actions/runs/40259671961) 等 **全部 PASS**。其中 Phase5 禁用阶段真实 HTTPS 为 `T1F_PHASE5_DISABLED_PUBLIC_NEGATIVE_PASS`，21 请求，不签名、不写数据库。
- **Render 安全发布进行中，不能声称 LIVE 修复完成：** 独立 LaoDao RoleProof `srv-dbdeuft9fdbs73atbvh0`，`T1F_PHASE5_TYPED_PRACTICE_ENABLED=false` 已实际更新并验证禁用版本 `dep-dbfbioqjnfac738pemn0` Live。修复版专用代码已 cherry-pick 到 Render 分支 `codex/mealforward-t1e-issuer-original-tx-verifier-20261023`，实际应用 Commit `6d085568d802725f7281439005d0f20c6ffe32ca`，部署 `dep-dbfboglg1s2s73f6mh20` 在最后检查时 **`update_in_progress`**，build 已成功但尚未有新的 `server_available` 事件/Live 确认，未开启 Phase5。因此用户此时**不要重新签 Practice**。
- **下一 Agent 必须依序执行：** (1) 只读查看 Render `dep-dbfboglg1s2s73f6mh20` 是否真正 Live、运行原 EIP191 Proof 的状态；(2) Stage 仍 `Phase5=false`，复跑真实 HTTPS 关闭门禁；(3) 在确定部署 Commit 正确后，仅该 RoleProof 服务开启 `T1F_PHASE5_TYPED_PRACTICE_ENABLED=true` 并等待新部署 **Live**；(4) 更新唯一公开 HTTPS Phase5 workflow 的期望 true，真实请求 `/v1/t1f/phase5/challenge` 分别读 Owner 和 Donor 的 `typedData.types.EIP712Domain`，查齐四字段、练习域和原 ESCROW，同时验证资金路由始终拒绝；(5) 复核真实 Supabase/Claim 没变；(6) 最后才邀请用户真人重签**两次练习签名**，无需再做 Phase4 的 EIP191。
- **硬安全红线：** 这只是无数据库、无 Session 的 `RoleProof` 练习 EIP712，不是正式 Recovery Release。真实 Supabase 项目 `ketfrukrcuosrqynnsay` 只有 001–012：013/014/015 没有安装，原 Fund=1、Claim=1 且 `ISSUE_UNKNOWN`、原 Issue Reserve=1；不能重做 Fund/Claim/Consent、重置原 Nonce、发送过期的 `issue()`、开放 Lock/Report/Settle。真实发券恢复仍需要独立安全批准。
- **每次代码/部署/人工验收结束，必须再更新根目录本 HANDOFF.md**，写清准确部署 commit/状态、Source HEAD、CI 和需要用户操作的步骤，不得把本段的部署进行中当成完成状态。

## 2026-10-26 Phase5 真实 MetaMask EIP-712 签名 401 — 当前 BLOCKED，修复尚未提交

**2026-10-26 最新处置：** 代码更新操作连续被工具安全检查拒绝；尝试把独立 Render 服务的 `T1F_PHASE5_TYPED_PRACTICE_ENABLED` 调整为 `false` 也被相同检查拒绝，因此**不能声称入口已经关闭**，当前应视为旧错误版本仍对外开放，用户不得继续签署 Phase5 练习。已在本次聊天提供本地可审查的最小修复脚本（仅练习 JSON-RPC 域与对应验证前校验、回归测试），但尚未推送 GitHub、未跑项目 CI 或部署。下一个 Agent 需在获得允许的写入路径后执行正规 code review→CI→关闭模式部署→开启模式公网验收，绝不能绕过检查或启用真正的 Recovery Release。



**真人结果（不要重复签名直到修复部署）：** 用户分别使用原 Owner 与 Donor 钱包在已上线 `/t1f-phase5.html` 签署 EIP-712 Practice 后，两者均返回 `T1F_PHASE5_SIGNATURE_INVALID · 401`。Phase4 两角色原先的 EIP-191 控制证明仍为 PASS，不需要重复做。错误发生在 Phase5 服务端校验，而不代表真实恢复批准失败；本次无数据库、无链上交易。

**高度可信的共同根因（需自动回归确认）：** 正在运行的 RoleProof 代码 `t1-intents/t1f-phase5-typed-practice.mjs` 在 JSON-RPC `eth_signTypedData_v4` 挑战中只声明 `types.PracticeControl`，**未声明 `types.EIP712Domain`**，但后端 `ethers.verifyTypedData` 使用包含 `name/version/chainId/verifyingContract` 的完整 Domain。MetaMask 的签名工具对未声明 `EIP712Domain` 的消息可能按空 Domain Struct 编码，与后端验签摘要不一致。MetaMask 官方开发规范要求显式 `EIP712Domain` 类型，域字段顺序建议 `name:string,version:string,chainId:uint256,verifyingContract:address`。此推断与两只独立 EOA 同样失败高度吻合；之前的 CI 使用 ethers.signTypedData 而非 MetaMask JSON-RPC V4 严格格式，未覆盖真实钱包。

**修复方案，不可绕过安全边界：**
1. 在 server 生成的 V4 JSON-RPC typedData 中**显式加入** `types.EIP712Domain` 四个标准字段（但后端传给 ethers 的 verifier 类型 `types` 继续只包含 `PracticeControl`，避免 ethers 对冗余 primary type 解释错误）。
2. 前端在调用 `eth_signTypedData_v4` 之前 fail-closed 校验四个 Domain 字段及原 Testnet Escrow 固定地址，绝不更改 Practice Domain / version0 / `PracticeControl` / `PRACTICE ONLY`，不采集原始签名与私钥。
3. 加入能重现 **MetaMask 缺失 Domain 类型导致签名与 ethers verifier 不一致**的回归测试，以及两只临时 EOA V4 JSON 结构签名正例、错误钱包/跨域/replay/超时负例。只有 exact-head CI PASS 后才能**仅**发布到独立无数据库 RoleProof Render `srv-dbdeuft9fdbs73atbvh0`，先 gate=false，再 gate=true 并跑真实 HTTPS 门禁。
4. 本轮 GitHub 代码更新工具**连续被安全审查拦截**；故此时**源码未修复，未部署**。不得把文档记录当成已修复结果、不得改用旧真实 Recovery Release 域进行练习。若之后代码工具恢复可写，先修复 CI 再交给用户复测。

**真实运行边界保留：** Render RoleProof `dep-dbf2125g1s2s73e6r1u0` 仍 Live，源 Commit `7a5ee5e1f9d796e743f6b128e856f86473a2e856`，Phase5 练习独立于真实 Fund/Issue/Settle。Supabase 仅 001–012，013–015 没有运行；原 Claim `ISSUE_UNKNOWN`、唯一 Fund 与 Issue Reserve 不得覆盖。Phase3 015 HOLD SQL 已在 Draft PR #45 修复并隔离测试通过，但没有激活真实第二次 Issue。

## 2026-10-25 当前最新：Phase 5 EIP-712 PRACTICE 已上线，等待 Owner + Donor 本人新测试

**这是全项目当前真人测试 Stop Point。** 用户此前已完成两只钱包的 **Phase 4 EIP-191 控制权 PASS**，不要重新要求那两次签名。本阶段不是恢复授权：在独立无数据库的 RoleProof 服务新增 EIP-712 **练习专用**挑战，原 Claim `ISSUE_UNKNOWN` 依旧冻结，永久禁止拿已过期的原 Issue 参数发交易。

### Phase 5 安全修复 / 开发与源码 CI

- 新开发：[Draft PR #45](https://github.com/3956ray/MealForward/pull/45)，工作分支 `codex/mealforward-t1f-phase5-release-hold-hardening-20261025`，base Phase4 [PR #44](https://github.com/3956ray/MealForward/pull/44)。代码涉及 `t1-intents/supabase/015_t1f_dual_release_successor_issue.sql`、`t1f-successor-issuer-ledger.mjs`、`t1f-successor-phase3.ci.mjs`：为 015 的 `HUMAN_REVIEW_HOLD` 添加明确禁止继任 Issue INSERT 的数据库触发器门禁，JS 源码镜像 fail-closed。015 本身没有放行状态，因此无论任何未来误授予的写权限，都不能仅凭 HOLD 创建第二次 Issue。真正放行必须先另写经过独立审查的 **016+ 迁移/权限规则**；不能直接把 015 当作已经获得正式授权。
- 安全修复 CI：[Actions 40205800527](https://github.com/3956ray/MealForward/actions/runs/40205800527) **PASS**，在 127.0.0.1:5439 的独立 PostgreSQL17 运行 009–015，模拟管理员持有合成双人 fingerprint 后尝试创建继任 Issue 仍被拒绝；`T1F_SOURCE_ONLY_PG17_HOLD_DENIES_SUCCESSOR_INSERT_PASS`，`successorOperationRows=0`、`successorAuditRows=0`，原 Claim/Consent/Fund 不变。该测试表示 **HOLD 安全**，不表示新 Issue 能正常发行。
- 新 `t1-intents/t1f-phase5-typed-practice.mjs` 与 `public/t1f-phase5.html`/`t1f-phase5.mjs`、HTTP/签名测试和外部 HTTPS 门禁：固定原 Owner `0xc4f8a468f10d5f98dcff3282516125e97f26433b` 和 Donor `0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952`，每人单独随机 32 byte nonce、120s 时限与一次性消费，用 ethers `verifyTypedData` 核验真实 EIP-712 签名地址。限制 Origin/ChainID/钱包切换、错误角色、重放、过期和每分钟请求数；没有 Cookie/Session、没有数据库、没有写链 RPC。测试 `T1F_PHASE5_OWNER_TYPED_PRACTICE_PASS` / `T1F_PHASE5_DONOR_TYPED_PRACTICE_PASS` 仅在用户本人签名后出现。
- **务必区别正式 Recovery Release**：Phase5 Domain 为 **`MealForward Phase5 Typed Wallet Practice` / version `0` / primary `PracticeControl`**，与真实 EIP712 Recovery 的 `MealForward T1F Recovery` / version `1` / `SuccessorIssueRelease` 完全不同，练习签名不能用于批准恢复、发券、资金或结算。
- 开发/CI 实证：[Phase5 角色 HTTP 与模拟真实 EIP712 CI 40207373717](https://github.com/3956ray/MealForward/actions/runs/40207373717) **PASS**；[SQL 015 + 完整源码 PG17 回归 40207373725](https://github.com/3956ray/MealForward/actions/runs/40207373725) **PASS**。Phase 4 EIP-191 原功能同步通过。
- 更详细技术、安全界限与用户测试步骤：`docs/CP31-T1F-PHASE5-TYPED-PRACTICE-AND-HOLD-HANDOFF-2026-10-25.md`（PR #45 分支）。本 Handoff 更新后 GitHub 分支 HEAD 会变化，要实时查询 exact SHA/CI；不能把文档更新误认为新的 Render 部署 Commit。

### 真实云发布（只选择安全的无数据库 RoleProof 文件）

- RoleProof 连接器 Render 工作区 LaoDao `tea-db7q3ou7bikc73bp2bt0`，服务 **`srv-dbdeuft9fdbs73atbvh0`**，本次**真实已 Live** Commit `7a5ee5e1f9d796e743f6b128e856f86473a2e856`；目前启用部署 **`dep-dbf2125g1s2s73e6r1u0`**（前一关闭阶段 `dep-dbf204m7bikc73bt2o8g`）。仅 RoleProof 服务 `T1F_PHASE5_TYPED_PRACTICE_ENABLED=true`；原 `T1F_PHASE4_PROOF_ENABLED=true` 仍正常、`T1E_DEPLOYMENT_STAGE=ROLE_PROOF_ONLY`；原服务保持 `noFinancialWrites=true,noDatabaseConnected=true`。**绝没有**在 Render 引入 PR #45 的 015 SQL、新发券 runtime 或数据库 Secret。
- 正式 Phase5 入口：**https://mealforward-t1e-role-proof-laodao.onrender.com/t1f-phase5.html**。Phase4 原入口 `/t1f-phase4.html` 不需重测。新接口仅 `/v1/t1f/phase5/status`、`/challenge`、`/verify`，其他 `/release`、`/issue` 等仍禁用。
- **真实启用阶段公网 CI**：[Actions 40207354606](https://github.com/3956ray/MealForward/actions/runs/40207354606) **PASS**，实际 21 次 HTTPS 请求，`T1F_PHASE5_TYPED_PRACTICE_PUBLIC_NEGATIVE_PASS`，`realWalletSignaturesCollected=0`、`dbWrites=0`、`onchainTransactions=0`、`recoveryApproved=false`；[RoleProof 功能回归 40207354573](https://github.com/3956ray/MealForward/actions/runs/40207354573) PASS、[Issuer/Recipient 兼容 40207354550](https://github.com/3956ray/MealForward/actions/runs/40207354550) PASS。关闭阶段部署后的 [Actions 40207044017 attempt 2](https://github.com/3956ray/MealForward/actions/runs/40207044017/attempts/2) PASS。
- 回滚门槛：若新练习页面有异常，只在 `srv-dbdeuft9fdbs73atbvh0` 把 `T1F_PHASE5_TYPED_PRACTICE_ENABLED=false`，确认 Render 自动部署后 Phase5 URL 不可用而 Phase4 仍可用。原 RoleProof 代码备份分支 `codex/mealforward-roleproof-before-phase5-20261025` @ `49fdcd99af2d39ea726cf8f7c9dd111b53351a88`。不修改 Supabase、旧 CP30 或 Claim 服务。

### 实库安全边界与下一步唯一人工测试

- 实际 Supabase 项目 `ketfrukrcuosrqynnsay` **仍只应用至第 012 条迁移**。013 Review / 014 Slot / 015 Release 全部**未安装**；原 7 Test USDC 仅 1 条 `FUNDED`，1 Claim `ISSUE_UNKNOWN`、1 `ISSUE_RESERVED`，无真实继任 Issue、TxHash 或二次资助。原 Claim `fbab3b22-965d-44e2-b144-d7307b7aa8ea`、原 Issuer Nonce0、已过期的 deadline1792765625 冻结。Supabase Security Advisor 0 lints。
- Claim/Issuer 资金隔离 Render 服务 `srv-dbdgstivcj2c73fnqcc0` **仍旧 Live** `dep-dbdto63rjlhs738br1sg` @ `c8723c2f280e4b72ff067e0be08f5bf1c4a15412`，此次没有碰它；旧 Mac CP30 Journal `PREPARED #3560` 未恢复/未重放。
- **真人新测试**：Owner 本人用原 EOA 在 Monad10143 打开 Phase5 入口，只在 MetaMask 消息域/类型明确 **Practice**、purpose 写着 `PRACTICE ONLY - NO RECOVERY RELEASE, NO ISSUE, NO FUNDS` 时点击“本人 EIP-712 练习签名”，预期 OWNER PASS；随后 Donor 另一个 EOA 独立做一次，预期 DONOR PASS、`2/2`。只发页面的脱敏结果/错误，不提供原始签名、Cookie 或私钥。遇到真实 Recovery Release 域请停止签名并反馈。
- **Phase5 通过仍不放行真实第二次 Issue**：之后仍需要单独审查 016+ 正式审批状态迁移/最小权限角色、完整双 EIP712 Recovery Release 与新 Issuer 交易安全流程。必须额外获得用户对实库 013–015/016+ 迁移、真钱包批准、合约 Testnet Issue 的独立明确许可。严禁重复 Fund/Claim/Consent、重置旧 `ISSUE_UNKNOWN`、广播过期旧 nonce/op/deadline、开放商家 Settle（原合约 180s Cooldown Issue #17 尚未解决）。
- **用户固定要求：每轮开发/部署/验收/回退最后都必须更新根 `HANDOFF.md`，使另一 Agent 不用聊天也可接手**。接手请从这段开始，再看 PR #45、精确 CI、已部署 Commit 和实库快照。

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
