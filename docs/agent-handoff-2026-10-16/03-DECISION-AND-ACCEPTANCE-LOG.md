# 决策与验收台账：新 Agent 必须继承的流程

## 长期接受的产品决策

- MealForward 留膳的使命是“待用餐/预付餐”，顾及受助者隐私和尊严；“留一膳，待一人。”“一膳之微，亦可为善。”
- 本轮重点为**一店、最多 3 餐品、原 lifetime 10、不触碰旧 7 USDC 条款**。新 0.5 USDC 餐品由独立版本支持；任何更改都要显式决定。
- 支持者“三步”，领券“一键”，钱包按已授权当前账号优先；My Contributions / My Meals 不显示模拟成功。前端保留 Sites 风格及商家工作台。
- 领取者的私有链接优先，QR 用作到店短时验证码；动态 QR 最长 120 秒的历史设计；CSRF、Session、私钥、Voucher 不公开。店主必须在与领取者隔离的浏览器身份操作。
- 区分不可省略的动作：Draft → Publish → SetListed；Approve → Fund；Issue → Voucher；Check → Lock → Physical Handover → Report → 180s Gate → Settle。每个动作以原 Intent/幂等键/链上终局证据为准，钱包签名由用户本人执行。
- 威胁模型 C：平台可信或半恶意两类场景都要讲清。授权 EIP-712 和角色隔离可以减少滥用，却不能证明物理交餐。Admin/Upgrade 若可以绕过约束，则分权失效，必须显式披露。
- 技术方向：EVM/Monad testnet 10143，后端 Python + PG17 + 独占 Journal/Controller/Worker，前端 Sites 静态 HTML/JS，同源 HTTPS 严格 Origin。
- 先完成本机真实只读与完整 E2E，再规划免费云端；没有 durable signer Journal 与完整重启恢复就不开放任何公网资金写操作。

## G0–G6 状态机（按依赖）

| Gate | 内容 | 已验证事实 / 当前门槛 |
| --- | --- | --- |
| G0 身份 | SIWE、当前钱包、nonce/CSRF、logout/refresh/switch/replay | Render Auth Pilot MetaMask 实测能登录；完整负面用例和 CP30 接口兼容还没验收 |
| G1 Sites × CP30 同源只读 | Kitchens/My Contributions/My Meals/Public Ledger | 前端文件整合与 13 静态文件 preflight PASS；原本机两个 Live API 422，旧 `app.js` 非新文件，`ledger-view.mjs` 404；先完成 Runtime Ledger 原证恢复与本机同源装载 |
| G2 Schema / ACL | 原 migration 001–045 新实例 PG17、所有角色 GRANT、历史 hotfix 回填、Source Pin | 隔离新 PG 真实性能和权限回归待完成；045 不得用于旧实库 |
| G3 持久化/崩溃恢复 | 资金 Journal 单写者、Nonce、防 UNKNOWN 重发、Session 重绑、超时处理 | 当前原 Mac 的 committed-but-unfinished / PREPARED #3560 是阻塞；Render free 不可当 durable signer host |
| G4 支持者/受助者 | 真实 wallet approve/fund、领取 issue、刷新/重登和原 Intent 恢复 | 历史本机有已完成 fund/issue，但新版 Sites×真实 DB E2E 和恢复未验收 |
| G5 商家/结算 | publish/list，锁券/交餐/report，180s 后老板签 settle，公共餐账 | 早期链上 publish/list/lock/report 有验证；**settle 首笔最终成功缺证据** |
| G6 发布 | 手机/电脑 UX、多身份隔离、负面用例、链/DB/UX 一致、免费云资源 | 未通过，不能把历史 React Demo / Auth Pilot 当最终可用产品 |

## 工程运行规范（每次必须按序）

1. 起手：更新事实与源码 SHA，对照本机/云端/分支/真实链上四层。记录此轮用户允许的操作边界。
2. 计划：涉及真实 SQL 写入、迁移、服务启停、Signer、Journal、pin 和恢复的操作，列停机条件、备份、恢复点与失败分支，取得批准后执行。
3. 单写者：任一时刻一个 Agent 拥有原 Mac 实库操作权。其他 Agent 可并行做隔离 UI/测试/研究但不能重叠改源码或私有配置。
4. 证据：优先本机只读/日志，再测试和浏览器；每个 Gate 输出真实 PASS/FAIL 与可溯源 commit/Tx。发现矛盾先止损，不做“自动纠错”式破坏性写入。
5. 收尾：写状态台账、检查遗留旧 Intent、列未完成测试/失效时限、新 Agent 直接可执行的最小下一步；用户不需要重新解释已确认的需求。

## 当前待解决事项顺序（不能变成随意代办清单）

**P0 原本机安全**：确认官方 STOP 后零剩余进程与无其他 PG client；`cp30_maintenance_backup_gate_v2.py` SHA 验证；受保护单恢复点 pg_dump/globals/Journals/配置/Source; verify；对完整 Journal 链做检查；单独申请原 controller COMMITTED→ACK 恢复，执行后验收 DB 与 Journal 不变性。过程中不重新签/广播。

**P1 本机读 API**：恢复后重新检查 `/v1/stores` `/v1/ledger` 是否 200 和 DTO 正确；受控静态载入 Sites 13 文件（切勿覆盖私有运行配置）；原钱包登录、真实订单/券隐私隔离。

**P2 软件可靠性**：现有 Session-bound orphan intents、RPC 启动开销/窗口过期、过期 grant、Journal 容量、源 SQL hotfix 不一致，按新 PG role/migration 测试门禁逐个解决。

**P3 端到端和发布**：Sponsor→Fund→Issue→QR→Check/Lock→Handover→Report→180s→Settle，完整证据；持续优化质量和移动体验；云端仅开放达到持久化要求的能力。

## 禁止继承错误的“已完成”结论

- `git pull` 因 HTTP2/framing、后因 github.com:443 连接超时失败，说明 Mac 本地整合审核副本未必是最新 HEAD；不是 API 422 的已证实根因。任何新 Agent 应从 GitHub 远程分支重新核对 HEAD。
- 原站已返回 Stop Requested 不等于已经退出；用户此前所有 backup/verify 命令因脚本未出现在 Mac Downloads 都没有执行。绝不能默默替换为“备份成功”。
- Ticket 8/8 MATCHED 不等于完整 Journal 全链验证或本机恢复成功；DB committed 不等于链上 settle 完成。
- 旧迁移/交接文档某些“未安装 042–044”是过时历史；2026-10-14 实库完成 042–044 及热修，并已发生交易，请以最新本机只读证据为准。