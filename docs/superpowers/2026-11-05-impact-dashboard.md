# 留膳「善意足迹」Dashboard

## 实现与来源

中文品牌留膳、文案「留一膳，待一人」。新路由 #impact，旧 #ledger 兼容。公众顶部导航不引入管理后台侧栏。

- shadcn/ui dashboard-01 的指标卡、图表及表格信息结构，参考固定提交 8a3536678a528cc012b9e62484290e79d0be410f： https://github.com/shadcn-ui/ui/tree/8a3536678a528cc012b9e62484290e79d0be410f/apps/v4/registry/bases/radix/blocks/dashboard-01 。按现有 CSS/React 重组，保留 MIT 声明。
- Recharts 3.10.1（MIT，package-lock 锁定）提供响应式折线、环形、Tooltip/Legend；不是手写 SVG 图表。https://github.com/recharts/recharts
- Park UI 仅参考留白/边框，不安装其组件体系。https://github.com/chakra-ui/park-ui
- 构建附带 THIRD_PARTY_NOTICES。钱包组件、合约与资金规则未改动。

## 数据与隐私

GET /v1/product/impact?days=7|30|90 为公开只读接口，不受当前钱包 target 选择影响。链适配器以最终确认块核验登记厨房的 getStoreAccounting、getBatch、getVoucher。资助保留退款前历史总量，交餐/结算只计一次；人数按领取钱包跨版本去重，非实名自然人数。厨房按明确 ID/target 区分，同名不自动合并；目前没有批准的跨版本厨房映射。

六类份额守恒：available + claimed + handedOver + settled + refundPending + refunded = funded。历史总量与可核验事件覆盖数量相等后才开放人数/趋势/完整榜单，补齐中不会伪装为零。

持久化：原私有 JSONB 状态新增根 impactProjection、各 target 的 impactHistory（事件和同步游标）。事件唯一键 network/contract/tx/logIndex；逐块核验 canonical hash。优先核验每轮最多4笔原确认交易收据，并扫描最多10块历史区间；重启从游标继续，最多4096事件，超限失败关闭并保留旧快照。无需 SQL migration、索引服务或付费服务。

每30秒低频只读刷新，与签名任务独立调度；RPC失败/分叉/数据不守恒保留完整旧快照。超过120秒展示旧数据状态。趋势按北京时间及已核验快照时间计算，不为快照之后的日期捏造零值。免费服务休眠期间不刷新。

内部快照包含用于去重的地址，仅存原有私有状态表；公开 DTO 明确选择指标/榜单/资助交易证明，不返回领取钱包、券ID或凭证。查询不执行链写操作。

## 验证与运维

本地前端175通过/1跳过，后台295通过/3跳过；Anvil adapter 完整场景通过（含退款、停业、返池、重复扫描与快照守恒）。新增 tests/impact-product.test.mjs、product-v2/impact.test.mjs 与多target API测试覆盖范围切换、过期快照、隐私、并列排名、北京时间边界和读取失败。构建通过，前端生产依赖审计0漏洞。

CUA Chrome 使用同一实际组件，预览顶部明确标注示例数据；检查390/768/1440宽度无横向溢出，7天切换、键盘展开每日数据、全部12家榜单；手机列定位缺陷已修正。示例页面仅 /tmp 本地预览，不提交、不上线。真实钱包签名不属于本轮看板验收，未代用户签名。

发布目标：原 Render Free srv-dbjv7lnf3r2c73d7ri50，原分支 codex/mealforward-product-mvp-20261031，autoDeploy off。CI通过后手动部署；状态/真实API核验补记 HANDOFF。若故障可回退 UI/统计功能，但保留 V3-aware 后台及全部新旧订单、签名任务；不得清空统计或业务数据库。

后续扩容边界：超过4096事件或大量历史脱离应用记录时，需要提高有界回填吞吐/独立统计存储；当前失败时保留旧结果，不输出错误总数。缺少跨版本厨房映射时保持分别计数并标注历史版本。

## 发布结果

2026-11-05 21:33:52（北京时间）应用1e95dbc部署至原免费服务，部署dep-dbm8amu1egvs73bl9nh0为LIVE；CI https://github.com/3956ray/MealForward/actions/runs/42036160424 全部通过。公网聚合覆盖完整：资助5、交餐1、受助钱包1、厨房2；份额守恒，浏览器页面实际显示相同结果。前端脚本与CSS摘要匹配本地。详见HANDOFF最新证据。
