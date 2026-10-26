# MealForward（留膳）— Agent 一读即接手 · HANDOFF

> **本文件是当前项目唯一的高优先级跨 Agent 接手入口。** 从仓库根目录打开 `HANDOFF.md`，先核对实时 GitHub / Render / Supabase，再继续任何开发。此文件随每次开发、迁移、部署和用户验收更新。历史 `docs/agent-handoff-2026-10-16/` 与原 CP30 合同不得当作 2026-10-23 的实时云状态。
>
> **更新日期：2026-10-26（UTC+8）**。状态在新提交和链上交易后可能变化；引用的是当时已实际查到的资源，不能把未来状态当真。
>
> **当前最高优先级门槛：真实用户已预留唯一 T1-F Issue，Claim=ISSUE_UNKNOWN。必须核对链上原交易/过期/恢复，不得重新预留或自动重发。** 详见本文件 22:24 的 CRITICAL LIVE STATE。



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


## 2026-10-25 Phase 3 安全审查新发现：015 REVIEW_HOLD SQL 权限门禁缺失 — 必须阻止上线

**重要：此节在 Phase4 真人 OWNER/DONOR EIP-191 两项 PASS 后新增，Phase4 仍已通过，但 Phase3 EIP-712 正式恢复仍不允许启用。** 最新代码审阅发现 `t1-intents/supabase/015_t1f_dual_release_successor_issue.sql` 的 `successor_issue_releases.stage` 被约束成 `HUMAN_REVIEW_HOLD`，`may_release_to_wallet=false`，但是创建独立 `successor_issue_operations` 的 `successor_operation_guard()` 只校验 Release 关联关系、参数/有效期、原 Claim 等，没有显式要求已通过**另一独立的正式放行状态**。现有 Phase3 一次性 PG17 集成测试在 HOLD 下插入了一条后续 Operation 并报告 PASS；**这证明测试覆盖的不是完整的安全放行门禁**，不能作为发布批准。

- **风险级别：真实数据库目前未暴露，但未来上线阻塞。** 当前 Supabase 013/014/015 未安装、运行角色未获 015 INSERT/UPDATE 授权，真实资金/Claim 未因这个源码缺口改变。一旦未来误授予 INSERT 权限或引入有缺陷的服务，数据库 HOLD 设计就未在操作行插入阶段再次强制验证。
- **待独立代码评审与修复：** 先在独立开发分支严格修复 015 的 successor INSERT fail-closed gate，使 `HUMAN_REVIEW_HOLD` 本身绝无后续交易授权；未来可能新增的 Release 状态与权限必须通过独立审批及全套签名/Nonce/Receipt 检查引入。更新 PG17 测试：在 015 仅有 HOLD 的表结构上，**尝试创建后续 Operation 必须拒绝**，且原 Claim、Review/Slot、资助和旧事件保持字节级不变。原 Phase3 模拟完成 3 个新 Audit Event 的成功路径只有在真正定义并经过审查的后续版本中才是可解释的。
- **工具执行边界：** 本轮尝试提交限制性 SQL 更新时，GitHub 代码变更操作被平台安全检查阻止，**没有改变源码 SQL 或绕过屏蔽执行**；源码仍存在该待审核缺口。已建立未改代码的隔离分支 `codex/mealforward-t1f-phase5-release-hold-hardening-20261025` 作为可能的后续审查入口，不应声称已有修复 PR/CI。
- **直到修复 + 重新验证前不得做的事：** 不向真实 Supabase 应用 013/014/015，不开放继任 Issue API 或最小权限写入角色，不要求 Owner/Donor 签 EIP-712 恢复授权，更不能让 Issuer 调用任何继任 `issue()`。用户此前两次 EIP-191 钱包控制证明已经通过，**不需要重做**。
- **仍然有效的事实：** 原 Testnet Fund=1、Claim=1、原 Issue Reserve=1，旧 `recipient_claims` 保持冻结 `ISSUE_UNKNOWN`；当前运行的 Role Proof 是无数据库、无交易能力的纯控制证明服务。此项新的安全审查发现不影响 Phase4 PASS。
- **Handoff 强制规则：** 下一个 Agent 必须首先处理这条 HOLD 门禁及其隔离测试；不得拿此前 `PR #43 CI PASS` 或 `PR #44 Owner/Donor PASS` 作为新 Issue 交易已经获准的依据。本轮完成后更新根目录 `HANDOFF.md`。

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
