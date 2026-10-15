# CP31 Sites × CP30 — 本机同源联调操作手册

日期：2026-10-15（UTC+8）。**目前为预检工具与只读功能交付，不是已安装到本机 CP30 运行时的证明。**

## 1. 已提交的内容

分支：`codex/mealforward-integrated-mvp`，提交 `45a104562cf79b8d2acf2e65c338b28eb66fa3e6`。

- `sites-frontend/dist/`：Sites 风格 CP31 真正前端，保留三步资助、一键领取、My Contributions/My Meals 及商家工作台。
- `sites-frontend/dist/ledger-view.mjs`：新增 Public Ledger 真实只读页面，只消费 CP30 `GET /v1/ledger` 的已聚合字段 `{items:[{store, financial:{counts:{F,A,R,H,S,X}, F,H,S,liability}, funded}]}`。各类缺失/前后账不一致时不显示虚构数据；不展示受助者二维码、签名及个人信息。
- `sites-frontend/ledger-view.test.mjs`：6 项离线 UI/DTO/隐私回归。
- `cp30-backend/tools/cp31-sites-preflight.py`：严格静态文件白名单校验、CSP 与 API 同源契约预检；运行时仅读取公开源代码，不访问本机私有 PG/Journals/钱包。
- `cp30-backend/src/c1/static_assets.py` 为已有 CP30 机制：`staticRoot` 和 `staticFiles` 明确指定公开构建资源，路径不允许符号链接/越界，启动时快照文件；`Application.handle` 对 `/v1/*` **不交给静态资源**，仍走原真实 API。

## 2. 在 Mac 上进行只读预检（不消耗 ZCode Token）

以下只需用户运行普通终端命令，**不会修改**现有 `~/.mf-cp30-20261013/` 运行目录、服务、PostgreSQL 或 Journal：

```bash
mkdir -p "$HOME/Documents/Developer"
git clone --single-branch --branch codex/mealforward-integrated-mvp \
  https://github.com/3956ray/MealForward.git \
  "$HOME/Documents/Developer/mealforward-cp31-integration-review"
cd "$HOME/Documents/Developer/mealforward-cp31-integration-review/cp30-backend"
python3 tools/cp31-sites-preflight.py
```

预期 `status: PASS`，并显示一个仅包含 13 个固定文件名的 `staticRoot/staticFiles` JSON 片段。这不是服务器更改指令；该片段之后必须由**受控的私有运行配置安装流程**使用。

如果此文件夹已存在，不要覆盖或 `git reset --hard`，改用新的审核目录。若版本不兼容或预检失败，停止安装，不尝试放宽路径保护。

可选离线测试（Node >=22）：

```bash
cd "$HOME/Documents/Developer/mealforward-cp31-integration-review/sites-frontend"
node --test ledger-view.test.mjs
```

完整旧前端模拟/接口单元测试需要对应的 Node 依赖；带 `onboarding-browser.test.mjs` 的浏览器脚本使用旧本机 Playwright 绝对路径，不能在不满足依赖时算作通过。

## 3. 安全装入现有 `https://localhost:16443` 的前置门槛

**此文档不提供直接覆盖 `application.json` 的命令**，因为 CP30 的 `INSTALLED.json.configs`、`WALLET-LOGIN-INSTALLED.json.originalConfigs`、`sourcePins` 等会校验代码和配置来源。用户已存在真实 Testnet `fund/issue/lock/report` 历史和尚未结算义务，运行目录不能 reset/re-init。

由具有本机权限的操作者在另一次明确审查下：

1. 只读确认六服务 PID、`c1_connection` PG17.11、账本 Journal 当前 checkpoint/文件大小和 042–044 安装状态；备份数据库 + Journal，并验证对应恢复点。
2. 确认实际正在运行的应用与仓库 source hashes；不复写旧 config/未授权重签任何 Pin。
3. 在运行时私有配置中引入明确白名单 `staticRoot/staticFiles`，将站点绑定到 **现有相同** `https://localhost:16443`。不要使用跨源 localhost 或云端 Vercel Preview API 重定向。
4. 只按 CP30 官方“已安装配置/source pin 受控变更流程”进行 restart，禁止按端口 kill、清空 DB、删除 Journal 或重发未知交易。
5. 浏览器真钱包进行登录→Kitchens→My Contributions→My Meals→Public Ledger **只读验证**；私有订单和 Voucher 必须只属于当前钱包，且旧 original Intent 与链上收据不变。
6. 如不能证明配置更新和回滚策略，**保持现有服务原样**，只交付预检报告，不做安装。

### 关键用例

- 无登录：`/v1/stores` 和 `/v1/ledger` 匿名只读；`/v1/my/orders`、`/v1/my/vouchers` 必须不泄露其他钱包数据。
- 登录当前 MetaMask：`/v1/me` 与当前地址一致；My Contributions/Meals 展示原 DB 真数据，而非 Auth Pilot 的空目录。
- 切换钱包/重新登录：旧订单与 Voucher 不可读，未完成 Intent 只能从其原验证来源恢复；不要自动重签或发送资金交易。
- Public Ledger：F=A+R+H+S+X（份数），公开资金单位为链上最小单位转化的 USDC；缺失或不一致要提示“needs verification”而不是渲染假的成功值。
- 断网/服务停机：页面展示连接错误，不能假装已读取最新账目或提交链上操作。

## 4. 当前测试证据与阻塞

- 新 Public Ledger 独立 Node 测试 **6/6 PASS**。
- 基于原交接 ZIP 静态前端应用本次 ledger 补丁，离线 Node 模块/状态测试 **136/136 PASS**；另一个依赖用户私有 Playwright 绝对路径的浏览器脚本无法在当前容器运行，故未纳入通过数。由于版本不同，这 **不是**目前整合分支全套测试的通过证明。
- CP30 的 `StaticAssets` 以 13 个固定白名单文件运行独立 Python 预检 **PASS**。
- 当前容器禁止访问 localhost 的浏览器连接，因此未宣称 Chromium E2E 通过。
- **尚未**把前端配置写入现有本机私有运行配置，也未让 Render Auth Pilot 接入 CP30 历史店铺/订单/券。Render 上的资金业务继续关闭。
- 旧 CP30 `settle FINAL_SUCCEEDED` 仍缺少独立交易证据；资金 Journal 不能依赖 Render 免费磁盘。

## 5. 下一道 Gate

G1 只有在真实同源 CP30 /v1 API 与新版 Sites 前端之间完成受控只读浏览器验收后才判定通过。随后 G2 为隔离 PG17 迁移及权限回归、Session/Intent 原操作恢复机制；G3 为持久签名 Journal/Worker 可靠性，未过不开放云端 Funds。

## 6. 2026-10-15 用户本机预检证据

用户在 Mac 终端克隆本分支至 `~/Desktop/mealforward-integrated-review` 并执行
`python3 ~/Desktop/mealforward-integrated-review/cp30-backend/tools/cp31-sites-preflight.py`，
回传的 JSON 显示 `status: PASS`、`mode: read_only_preflight`、13 项静态文件、
`apiNamespaceReserved: /v1/` 及 `walletSigningOrDatabaseWrites: false`。

**判定：G1 的静态清单预检通过；不代表原 CP30 当前 HTTPS 服务已加载 Sites 构建。**
原 Mac `c1_connection`、`INSTALLED.json`、交易 Journal、Signer Grant 及运行服务没有因此被修改。

**下一步（仅公开、匿名 HTTP GET 检查）：** 从用户 Mac 向明确绑定
`127.0.0.1:16443` 的 `localhost` TLS Origin 查询
`/v1/connection`、`/v1/identity/setup`、`/v1/stores`、`/v1/ledger`、
`/v1/me`、`/app.js`、`/ledger-view.mjs`，只记录 HTTP 状态和 Content-Type，
不输出任何响应内容、Cookie、Signature 或 Privileged Config。
正常服务的 `/v1/me` 匿名返回 401；静态 `/app.js` 返回 404 意味着原 CP30
尚未启用新的静态 Sites 白名单，不能擅自为此重启服务。GET 访问可能增加普通
访问日志和限流计数，不能把它当作完全无运行时写入。

**红线：** 预检通过不授予修改运行时配置、应用 source pin、私有 journal、
数据库角色、交易授权或启动/停止服务的权限。要安装新的静态清单，必须先核对
备份、安装指纹以及受控回滚程序。

## 7. 2026-10-16 本机 HTTP 诊断结果

用户于 2026-10-16 （UTC+8）在 Mac 本机真实 `https://localhost:16443` 返回：

| 端点 | HTTP |
| --- | --- |
| `/v1/connection` | 200 |
| `/v1/identity/setup` | 200 |
| `/v1/stores` | **422** |
| `/v1/ledger` | **422** |
| `/v1/me`（无 Cookie） | 401 |
| `/app.js` | 200 |
| `/ledger-view.mjs` | 404 |

**确定事实：** 安装的身份配置 API 可访问，但两条公开业务查询同时异常；静态服务有 `app.js`，还没有确认其是否为此分支的最新构建，也没有确认 `ledger-view.mjs` 已在运行时白名单。匿名 `/v1/me` 的 401 符合权限预期。HTTP 422 原始 JSON 错误码尚未收集，因此不能把源头定为 PostgreSQL、Session、RuntimeLedger 或前端路由中的任意一种。

**下一步安全探针：** 先在用户 Mac 的独立审核目录快进拉取本分支，然后执行 `python3 cp30-backend/tools/cp31-local-api-probe.py`。该工具只对七个固定的 127.0.0.1:16443 HTTPS 端点发匿名 GET，显示 HTTP 状态、允许列出的 JSON 错误码、公开结果**数量**，并对服务器 `app.js` 与 `ledger-view.mjs` 进行相对审核副本的 SHA256 相等检查。不会输出原始响应、签名、Cookie、订单、餐券或数据库密钥；正常 HTTP GET 可能更新服务器限流计数/访问日志。使用的 4 项离线 Mock 测试通过，**未**对用户实际运行服务进行本机探针执行。

**不能做：** 直接重写私有 config、手动重锚 Journal、清空已有库/旧券，或将 422 当成“无商家”而返回空数组。需要先确认原 HTTP 错误与资源指纹，再判断下一步是只读服务状态审计、固定函数 SQL 门禁检查，还是受控静态资源重新安装。
