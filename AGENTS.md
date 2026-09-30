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
