# mealforward 项目规则

## CP20 当前 BUILD（覆盖旧阶段冲突条款）

- Leader已完成Dev–PM闭环并放行固定CP19虚构批次的10143持久只读账；合同`docs/CP20-CONTRACT.md`。15207同入口，独立18995读服务/DB；18975既有Dynamic鉴权后检查显式partner只读scope，owner未映射。
- 首段0广播/0新本金/0gas，不加载signer/runner发送模块，不改31337守卫、旧DB/CP19journal/Envio卷。仅BUILD一次受控入口切换，aud不变；未做OTP如实NOT_RUN。
- 每页getLogs实际10块（供应商限制），两水位分别展示，不冒称全区间已同步。CP8隐私P2仍开放，未来批次不自动公开。主开发唯一源码writer；Leader安排Astra Medium独审及最终验收。

## CP19 当前 BUILD（覆盖旧阶段冲突条款）

- Leader已放行独立10143合约与受控runner，合同`docs/CP19-CONTRACT.md`；主开发唯一writer。完整实现固定SHA独审及Leader核部署计划前不广播交易。
- 仅全新专用测试身份/测试MON，一券本金.001、全片gas≤2MON/最多13笔；owner由独立测试客户端直签，业务后台不读取其key。未知只查原hash，禁止自动重部署/重复付款/换nonce。
- 不改旧31337合约/ChainRpc/default Foundry，根依赖锁不动；保留15207登录、15217只读页和全部旧服务/数据。测试网脚本闭环不代表真人钱包/产品全业务UI验收。

## CP18 当前 BUILD（覆盖旧阶段冲突条款）

- Leader已完成Dev–PM五问与READINESS回核并放行；按`docs/CP18-CONTRACT.md`实现独立Alchemy只读测试网入口15217/API18985，严格10143。仅允许固定chainId/最新区块读取，不交易、不部署、不加载钱包或业务Backend。
- 主开发单一writer，Leader安排固定SHA独审。私有配置仅后端读取且不得回显；不改根package/lock/tsconfig、旧入口/31337守卫/数据，不刷新15207现有Dynamic内存登录。
- CP17未验收业务保持原状态，Alchemy连通不代表完整业务或bounty验收。

## CP17 当前 BUILD（覆盖旧阶段冲突条款）

- Leader 已核对 Dev–PM Q1–Q12 并放行 C0。精确边界见 `docs/CP17-CONTRACT.md`；主开发先交付合同，再由 Leader 派 JWT 与前端模块，主开发不另派、不双写。
- 新独立入口 15207 使用 Dynamic Sandbox email/access token 与本地可信角色映射；领取者免注册且不加载 SDK。真实声明 profile 未核实则交换失败，不放宽 aud/issuer/environment 检查。
- JWT 模块只拥有 `server/dynamic_jwt.py`、`tests/test_dynamic_jwt.py`；前端模块只拥有 `src/dynamic/client.ts`、`src/dynamic/auth.ts`、`src/dynamic/Login.tsx`、`tests/dynamic/`。其余共享文件由主开发整合。
- 使用 CP17 cookie 命名空间、schema/backup v4 隔离恢复；旧部署保留密码模式。完整 session/mapping/dispatch/restore 与运行接线在 C0 后完成，stub 不得认证成功。
- 只允许本机 Anvil 31337 交易；不自动钱包连接/签名/创建，不做真实网络交易、push、云部署。保留 5173、5186、15197 与 Envio18646 既有服务及数据。
- 模型配置保持原样，Leader 负责独立审查与验收。C0 编译通过不等于完整 CP17 验收。

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
