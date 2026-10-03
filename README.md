## CP21 测试网付款 BUILD

CP21实现位于独立`server/testnet_funding`、MetaMask支持页`#/support`及单用途`scripts/testnet_funding_admin`。运行与验证见[CP21合同](docs/CP21-CONTRACT.md)。默认未配置、不广播；一个Leader冻结payer/intent、.001测试MON、本片不发券。服务只读观察、不持密钥；提交后拒签/无hash仍只查询原操作。管理员授权和用户MetaMask付款需固定SHA独审及另行广播Gate。当前15207真实OTP窗口在BUILD期间保持原版本，集成由Leader安排。

# 留膳 / mealforward — 本地模拟 MVP

CP20 同入口的固定测试网只读餐账见 [docs/CP20-CONTRACT.md](docs/CP20-CONTRACT.md)：15207公账与工作入口、18995独立读服务/DB、18975显式partner只读scope。只读0交易；现有模拟与31337数据保留。

CP19独立测试网合约及持久脚本的运行/恢复边界见 [docs/CP19-CONTRACT.md](docs/CP19-CONTRACT.md)。只使用专用测试身份；部署须先完成固定实现及计划审查，旧服务不切换。

CP18独立只读测试网入口见 [docs/CP18-CONTRACT.md](docs/CP18-CONTRACT.md)。UI `http://127.0.0.1:15217/`，API18985；手动检查Monad Testnet 10143及最新区块，无登录/钱包/交易。启动与定向测试命令见合同；旧入口保持。

CP17 独立 Dynamic 入口的共享合同见 [docs/CP17-CONTRACT.md](docs/CP17-CONTRACT.md)。`npm run dev:dynamic` 使用独立15207并代理专用18975；`npm run build:dynamic` 检查真实SDK构建。后台用 `.venv/bin/python -m server.local web --directory .localbackend/cp17-dynamic --port 18975 --dynamic-auth`，必须先有独立fixture。未审核的真实profile仍拒绝工作身份交换；邮箱本人登录与只诊断的配置核对已接线，浏览器/OTP尚未验收。`.venv/bin/python -m unittest tests.test_dynamic_jwt tests.test_dynamic_auth tests.test_dynamic_profile tests.test_dynamic_contracts -v` 为受控身份测试，`tests.test_backend_chain_dynamic` 为隔离本地链撤销/恢复测试；原有入口保持不变。

本仓库当前是 **CP8 虚构状态链 + CP10 安全导航 + CP11 多张单份券与逐券部分完成**：支持者、机构、无账号持券者和门店/结算角色可在同一台电脑上走通餐券状态链。所有店、机构、领取关联、DU 金额、付款、交付、申报与结算都是假的。它不连接钱包、Monad 链、真实支付、通讯平台或真实个人资料，也不证明指定自然人收到或吃完。

## 环境与启动

- Node.js 24、npm 11、Python 3.9+；SQLite 随 Python 标准库使用。
- 安装前端依赖：`npm install`（锁文件是 `package-lock.json`）。
- 重置普通虚构场景：`python3 server/app.py --reset normal`。预置暂停异常用 `--reset paused`；重置会清空旧演示会话。
- 终端 A：`python3 server/app.py`，本地模拟 API 仅监听 `127.0.0.1:8765`。
- 终端 B：`npm run dev`，打开 Vite 报出的 `127.0.0.1` 地址；Vite 将 `/api` 代理至本机 API。
- 构建：`npm run build`。模拟接口与状态机测试：`python3 -m unittest tests.test_flow -v`；CP15测试须用下述Python3.12隔离环境。

模拟数据库写到 `data/demo.sqlite3`，已被 `.gitignore` 排除。服务和前端只供本机演示；不要将此服务暴露到公网或放入生产。演示角色选择不等于真实身份认证。

CP11 启动只新增发行/处理组表并关联旧单券发行，不清空旧余额、券、额度或会话。旧种子额度不自动提升。可用 `python3 server/app.py --db data/cp11-browser.sqlite3` 在独立演示库运行；测试使用临时数据库。

### 保留旧记录，另开一轮模拟

单批次已有支持后不能追加；额度或餐款耗尽时，不需要重置旧库。使用一个**尚不存在**的新数据库路径与空闲端口，在两个终端分别启动：

```sh
.venv/bin/python server/app.py --db .localbackend/new-round.sqlite3 --port 8786
SIMULATOR_API_PORT=8786 npm run dev -- --port 5186 --strictPort
```

先确保 `.localbackend` 目录存在，且新数据库路径没有已有文件。新库自动初始化普通场景：F/A均0，REF-A资格、渠道已确认、额度3份；B/C/D异常样例保留。打开 `http://127.0.0.1:5186/#/P06`，先选支持者模拟支持3份，再切机构伙伴为REF-A发行3张。不同端口隔离浏览器会话，Vite代理明确指向8786；旧5173/8765仍读原库，旧UNKNOWN只能查询，不能通过新场景解除。`SIMULATOR_API_PORT`只接受1024–65535端口并固定loopback，不提供公网代理。

## 建议演示顺序

1. 普通场景：公众 P01→P02 选择份数，明确点“模拟支持”；成功后 P03 原操作及 P04 批次账确认 F/A。可选“未知”分支只查原操作，不产生新资金。
2. P06 选择“机构”假角色；P07 查看已预置的私有资格/渠道决议。`REF-A` 合格且渠道核对，`REF-B` 不合格，`REF-C` 未核渠道，`REF-D` 已用尽本期额度。为 `REF-A` 发行一张单份券 A→R；P08 记录“执行定向发送/当面交接”，也可试失败后再分享原券，R 不增加。
3. 机构私下取得该券演示邀请；持券页先清除地址中的秘密，点击“查看餐券”才交换邀请并显示短时码。刷新或离开再返回不会凭旧会话自动复活二维码，需从原私信重开。无注册/钱包；持链接者可选自称收到，但这不等于核验指定自然人。
4. P06 切到店员 A，P09 在线手输展示码先只读预检；确认有餐后 P10 申请唯一处理权，**显式模拟确认**后才声明交餐，并提交模拟申报 R→H。可用另一个浏览器的店员 B 试同券争锁。
5. 切到独立结算角色，在 P11 模拟结算 H→S，回 P04 看单批资金分层。申报/结算“未知”保留原 R/H 并只查原 ID。
6. 重置 `paused` 场景，在 P13 的受限只读页看预置暂停原因；新支持、发行、新锁和新付款被拒，旧 R/H 与查询保留。P14 是自愿静态公告。

CP11 多券演示：新的 normal 样例中 REF-A 有3份虚构额度。先支持3份（300 DU），P07输入3并确认发行3张单份券；P08选择原发行结果，逐券展开邀请及记录交付。P09新建/选择本人处理组，逐码预检、主动加入本次列表，再逐券申请处理权。未锁项刷新后需重新出示有效码；已锁项按原记录恢复。可以演练A已结算、B申报待核、C交付失败，分别保留金额和结果；现场只出示2张时店员组只见2张，不代表家庭人数。

公开页只显示去身份批次信息；机构私有 `recipient_ref`/渠道、私密邀请和案件正文不在公账或店员响应。普通咨询只建私人案件、不占退款锁 L。发行响应丢失只读查原intent，查不到仍待核，不自动补发。退款 L→X、补券、可写行政恢复和真实网络仍属后续 Checkpoint。

接口与字段见 [docs/API.md](docs/API.md)。首次仓库基线为 GitHub `3956ray/MealForward` 的 `db3d5729c320325aaf3247b0781ed5bb5064c065`（仅 `LICENSE`）；本地开发分支为 `codex/mcpay-local-mvp`。

CP11 实测范围与限制见 [docs/CP11-VERIFICATION.md](docs/CP11-VERIFICATION.md)。

## CP13 localchain（隔离核心与钱包模块）

仅本地Anvil31337及隔离测试provider，不触及用户钱包或Monad测试网。现有P01–P14仍是CP11模拟。
共享ABI、fixture与范围见 [CP13-CONTRACT](docs/CP13-CONTRACT.md)，证据和限制见 [CP13-VERIFICATION](docs/CP13-VERIFICATION.md)。

- `npm run chain:test`：13项合约测试（含256组fuzz）。
- `npm run chain:e2e`：独立18546真实交易验证，仅结束自己启动的节点。
- `node scripts/check-abi.mjs`：合约编译后核对共享ABI。
- 独立钱包预览：空闲端口下先 `npm run chain:node`（18545），另终端 `npm run chain:deploy` 生成本机公开manifest，再 `npm run dev:wallet`（5195）。
- `npm run test:wallet` 默认跳过真实链项；`CP13_REAL_CHAIN=1 npm run test:wallet` 才实际发送交易/推进本地块，须使用自己隔离的节点与manifest，勿写他人正在使用的预览。

本地单位非测试网MON，无真实供餐、退款、补券、释锁或改址恢复。钱包provider不是已验证的真实扩展；
本片没有持久后台/认证/outbox/完整App接链。不得把本地开发账户用于公开网络；脚本拒绝非31337/非loopback/非Anvil。

## CP15持久后台（隔离本地实现，待独立验收）

真实Anvil HTTP链路已实现：支持意图→最终确认资金→个人机构账号发行N3→持久预留/nonce/加密原始交易→最终确认投影与恢复。运行步骤和验证证据见 [CP15-VERIFICATION](docs/CP15-VERIFICATION.md)，接口见 [CP15-CONTRACT](docs/CP15-CONTRACT.md)。
现有模拟App和钱包预览保持原行为；没有完整锁券/申报/结算HTTP、分享接口或真实网络连接。Envio独立模块仅通过handler模拟测试，真实HyperIndex/GraphQL服务未运行。

## CP16 BUILD：C0共享接口

增量schema v2、事务辅助函数、动作编码、三个独立本地signer与v1/v2隔离备份合同见 [CP16-CONTRACT](docs/CP16-CONTRACT.md)。领取与工作模块在C0固定后独立实现；C0不代表完整工作HTTP已可用。
接口验证：`.venv/bin/python -m unittest tests.test_backend_chain_contracts -v`；原认证/后端回归：`.venv/bin/python -m unittest tests.test_auth tests.test_backend_chain -q`。均使用隔离venv、自有临时库/随机Anvil端口。

## CP16 老板钱包 C0（方案 A）

四类产品身份已确认为支持者、机构伙伴、领取者、餐馆老板。模拟 P06 修正与真实链钱包分开交付；模拟角色选择不证明钱包身份。新接口见 [CP16-OWNER-CONTRACT.md](docs/CP16-OWNER-CONTRACT.md)。

新隔离 `server.local setup` 创建 owner 模式：后台只有 issuer/operator 签名材料，老板测试钱包为部署 merchant，后台不持其私钥。锁/report 由后台明确代发；settle 由外部老板钱包主动发原交易，后台只核结果。旧库不自动升级老板资格，备份 v3 恢复仍隔离并撤销旧钱包证明。不得对现有预览目录运行 setup。

已验证命令：`.venv/bin/python -m unittest tests.test_backend_chain_owner -q`，使用自有随机端口 Anvil 与临时库。测试覆盖钱包身份挑战、外部签名/原交易恢复、finality、提交争用、实际 revert 与 v2/v3 备份边界。C0 锁/report 测试使用共享 helper；另以 `.venv/bin/python -m unittest tests.test_redemption tests.test_backend_chain_redemption -q` 验证完整 redemption HTTP/真实链集成。

P06 现提供独立本地链经营入口，默认 `http://127.0.0.1:15197`，需另行启动专用服务；原模拟页面不连接钱包。独立工作台用同一 owner controller 完成验码、锁定、交付声明、申报、选择应付款及逐笔钱包结算。受控 EIP1193 浏览器与真实 Anvil 完整 HTTP 流程已验证；真实钱包扩展和人类确认仍 NOT_RUN，不代表 CP16 整体验收。启动、测试命令及证据边界见 [经营工作台说明](owner-wallet-harness/README.md)。
