# 留膳 / mealforward — 本地模拟 MVP

本仓库当前是 **CP8 虚构状态链 + CP10 安全导航 + CP11 多张单份券与逐券部分完成**：支持者、机构、无账号持券者和门店/结算角色可在同一台电脑上走通餐券状态链。所有店、机构、领取关联、DU 金额、付款、交付、申报与结算都是假的。它不连接钱包、Monad 链、真实支付、通讯平台或真实个人资料，也不证明指定自然人收到或吃完。

## 环境与启动

- Node.js 24、npm 11、Python 3.9+；SQLite 随 Python 标准库使用。
- 安装前端依赖：`npm install`（锁文件是 `package-lock.json`）。
- 重置普通虚构场景：`python3 server/app.py --reset normal`。预置暂停异常用 `--reset paused`；重置会清空旧演示会话。
- 终端 A：`python3 server/app.py`，本地模拟 API 仅监听 `127.0.0.1:8765`。
- 终端 B：`npm run dev`，打开 Vite 报出的 `127.0.0.1` 地址；Vite 将 `/api` 代理至本机 API。
- 构建：`npm run build`。接口与状态机测试：`python3 -m unittest discover -s tests -v`。

模拟数据库写到 `data/demo.sqlite3`，已被 `.gitignore` 排除。服务和前端只供本机演示；不要将此服务暴露到公网或放入生产。演示角色选择不等于真实身份认证。

CP11 启动只新增发行/处理组表并关联旧单券发行，不清空旧余额、券、额度或会话。旧种子额度不自动提升。可用 `python3 server/app.py --db data/cp11-browser.sqlite3` 在独立演示库运行；测试使用临时数据库。

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

## CP15持久后台（C0接口，实施中）

运行时/隔离venv/锁定依赖、Auth协议、Envio事件接口与端口约定见 [CP15-CONTRACT](docs/CP15-CONTRACT.md)。
此阶段不改原模拟App、合约或隔离钱包；C0不宣称持久链路已经实现。
