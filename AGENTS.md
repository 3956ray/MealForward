# mealforward 项目规则

## 项目定位

- 本仓库当前实现留膳的 CP8 本机虚构数据演示；对外英文名始终为小写 `mealforward`。
- 技术栈：React、TypeScript、Vite；Python 标准库 HTTP 服务和 SQLite。Git 根目录即本目录。
- 入口：`src/main.tsx`（界面）、`server/app.py`（模拟状态服务）。

## 边界

- 只使用虚构店、机构、角色、金额及领取关联。不得接真实钱包、链、支付、通讯平台或真人资料；不得部署、公开发布或推送远端。
- 模拟服务仅绑定 `127.0.0.1`；它和演示角色不构成生产级身份认证或资金安全证明。
- 服务端是预算、券、操作和角色作用域的唯一权威；客户端不能凭缓存使券复活。未知操作只查原 ID。
- 保持 `F=A+R+H+S+X`、`0≤L≤A`、单券唯一处理权与 R→H→S；所有金额用整数 DU，费用与餐款分列。
- 机构私有 `recipient_ref`、资格、渠道和券秘密不得出现在公共账或店员响应。交付动作、持券人自称收到和店员申报不得写成指定自然人实际收到或吃完。

## 目录与验证

- `src/`：前端页面、状态与视觉；`server/`：本地 API/SQLite；`tests/`：状态机和接口验证；`docs/`：本地接口契约。
- `node_modules/`、`dist/`、`data/`、`__pycache__/` 为生成物，不入库。
- 以 README 中**已验证**的安装、运行、测试、构建命令为准。更改写操作时运行对应测试；更改界面时做移动/桌面浏览器流程验收。
- 只改本项目目录；独立审查由主 agent 安排，subagent 不再委派。

## CP13 本地链授权（覆盖上述“不得接链”的本轮例外）

- Leader 已授权仅 Anvil chainId 31337 + loopback，虚构身份/本地余额；禁止真实测试网、用户现有钱包、云、push与公网部署。
- 主开发拥有共享 `src/chain-contract.ts`、依赖/锁、配置/文档、`contracts/`、`tests/contracts/`、`scripts/`；Leader钱包代理独占 `src/wallet/`、`src/components/WalletSupport.tsx`、`wallet-harness/`、`tests/wallet/`。共享更改先提给主开发。
- 不改现有 App.tsx/P01–P14，不做持久backend/auth/outbox；不得重置或停止5173/8765及CP11演示数据。
- 链状态以合约与确认结果为准；本地chain单位不是Monad testnet MON，gas与本金分开。独立harness不代表完整DApp。
- 所有开发/审查Astra Medium；Leader派钱包代理及独立审查，主开发不重复委派同范围。

## CP15 持久后台授权（覆盖CP13的后端暂缓条款）

- 正式BUILD仅本地31337独立后台，支持intent→issueN3/个人工作认证/outbox/finalized/恢复；不改CP13合约、钱包、既有App/server/app.py，不实现完整锁/申报/结算HTTP。
- 主开发拥有共享schema/storage/contracts/依赖/ABI/config/docs与server/web.py、server/chain/、outbox/projection/服务及tests/test_backend_chain*。
- Leader Auth子代理独占server/auth.py、tests/test_auth*；Envio子代理独占indexer/。共享文件由主开发单一整合；不另建迁移或改根锁。
- Python3.12项目.venv及requirements.lock；不装系统Dockerdaemon，不碰5173/8765/18545/5195预览；CP15自有节点18645、HTTP8875，自动测试随机空闲loopback端口。

## CP16 正式BUILD（覆盖CP15工作闭环暂缓）

- Leader已完成Dev–PM DESIGN闭环并授权完整本地HTTP领券→锁→原员工handoff/report→独立settle；不改CP13合约、模拟App或真实网络边界。
- 主开发先C0固定schema/API/helpers/action registry/三signer/备份兼容；Leader之后派模块。共享storage/contracts/auth边界、migrations/backend/web/chain/outbox/projection/recovery/local与依赖锁/文档/tests/test_backend_chain*仍唯一主开发整合。
- 领取代理仅server/recipient.py、tests/test_recipient.py；工作代理仅server/redemption.py、tests/test_redemption.py。冻结接口见docs/CP16-CONTRACT.md；任何共享变更先回主开发，不自行改schema或新建签名队列。
- 真源为Leader项目research/cp16/developer/READINESS.md及pm/ANSWERS.md。恢复库旧能力撤销/新业务隔离，可信NEVER_SIGNED与可能签名后缺raw不得混同。短码消费与claim/op/outbox须同事务。

## CP16 用户角色纠正（优先于上述旧角色要求）

- 用户已确认四类产品身份：支持者、机构伙伴、领取者、餐馆老板；领取者免注册。餐馆老板统一验券/锁、交餐声明/report与结算，不再要求独立员工/settler或禁止原actor结算。
- 选择A：后台operator明确代发锁/report；settle由可信绑定收款钱包的老板本人逐笔直接链签，后端不持老板私钥、不代签settle。钱包地址字符串不构成授权；现有合约不强制验码/交餐声明，不改合约或引入额外授权合约。
- Leader授权先修正模拟P06入口及必要模拟API兼容，和真实本地链改动分提交。保留既有数据、5173服务，不重置/停止现有预览。模拟必须明确无真实钱包接入。
- 前端范围src/App.tsx、src/styles.css、必要src/api.ts由Leader另派owner；主开发不双写，负责server/app.py、模拟测试及链共享C0。角色相关链实现先与PM定向冻结新接口；ROLE-CORRECTION.md及最新用户决定覆盖旧角色文档。
