# MealForward 接手文档（2026-10-14，北京时间）

## 先读：当前交付的真实状态

用户要求把当前开发成果提交并推送 GitHub，交付给网页版 GPT 接手。本次交付是代码与交接，不是完成真实链路验收或云部署。

- 后端源代码提交：`4911ce4`，分支 `codex/mealforward-cp30-handoff`，仓库 https://github.com/3956ray/MealForward 。后端在 `cp30-backend/`，原合约在同分支 `cp30-contracts/`。
- 前端源代码提交：`06ed48c`，同仓库的独立分支 `codex/mealforward-sites-integration`，根目录 `dist/` 是实际静态前端。两个分支是不同 Git 历史，**不要直接把前端分支 merge 到后端分支**。分别 checkout，或明确设计目录后再导入。
- 已确认的真实测试网行为：老板建店/部署；支持者授权与付款；第三钱包领取旧餐品的餐券。核销/结算完整真实链路尚未通过。
- 最新新餐品发布、上架、多餐品查询代码已实现并完成隔离测试；**042、043、044 尚未安装到实际数据库，catalogAuthority 尚未接入实际签名服务，最后检查其 gas 为 0**。
- 实际数据库已安装至 041。不能根据新源码或测试 PASS 声称 localhost 已能发布新餐品。
- 最近改动涉及 wallet 登录 source pins；安装时必须审核并更新对应 pin。不能只重启就认为新功能生效。
- 仓库中的历史文档有旧阶段 “禁止 push / synthetic only / NOT CONNECTED”等状态。当前用户已明确授权本地真实测试钱包联调以及本次提交 push；其他未被明确覆盖的保护仍须保留。旧状态文档不是当前完成度证据，本文件优先说明交付时状态。

## 用户目标与已确认的产品决定

MVP 先跑通一家店、一种测试 USDC；保留扩展架构，老板自助注册后由平台自动部署厨房合约是必要功能。前端沿用用户已有 Sites 设计和 kitchen workspace，不另造替代产品。当前多餐品观察预算最多 3 种（含原餐品），一店、原 lifetime 10 上限不扩大。

完整流程：老板钱包登录→登记店铺和首餐→老板签登记授权→平台 registrar 部署→链上发布并上架；支持者自己的钱包登录→选择餐品/数量→审核→独立 approve→独立 fund；领取者自己的钱包登录→领取有资金支持的券→展示短时私人链接/二维码；老板在独立浏览器身份打开验券页，粘贴私人链接或扫码→校验→锁券→实际交餐后明确确认→标记交餐并申报→餐券不可再次使用→等 180 秒→老板钱包提交结算→链上确认后显示到账。

所有取餐时间按 `Asia/Shanghai` / UTC+8，选择器只允许整点和半点，结束时间不包含在有效区间内。不要把历史保存的分钟数再加减 8 小时。新测试草稿名 `test_for_mealforward`、描述 `test`、0.5 USDC（500000 基础单位）、00:00–07:00 北京时间。原餐品 7 USDC 及其历史条款不得被新草稿覆盖。

**正确结果**：
1. 草稿只对所属老板可见；保存不产生库存。未确认上链不能显示 Published/LIVE。
2. publish 与 setListed 分别有原 intent、交易与确认；新版本只有两阶段满足条件才公开。
3. 新餐品零支持时可支持，但没有可领库存。真实 fund 确认后才增加份数。
4. 领取使用真实 funded unit 的 meal/version/price/image/time；历史资助与券不被后来版本改写。
5. 钱包切换不能看到另一老板的私有草稿或管理权限。
6. 查看/扫码不等于核销；锁券不等于交餐；确认交餐后的已用券及旧展示凭证不能再次消费。
7. UNKNOWN 不是成功，也不是可以重发的许可；只恢复同一个 intent/op/交易。
8. 前端状态来自后端持久记录与链上确认，刷新后保持一致，不以浏览器缓存伪造完成。
9. 180 秒是平台结算门禁，**合约本身没有强制该等待时间，也不自动打款**。老板仍需显式钱包结算；到点不是到账。

## 获取代码与给网页版 GPT 的入口

```sh
git clone --branch codex/mealforward-cp30-handoff https://github.com/3956ray/MealForward.git mealforward-backend
git clone --single-branch --branch codex/mealforward-sites-integration https://github.com/3956ray/MealForward.git mealforward-frontend
```

网页版 GPT 可以读取上述分支或上传交接 ZIP。它无法直接操作这台电脑的 localhost、私有 PG、浏览器钱包与私有运行目录。需要本机 agent 执行安装/签名步骤；不要向聊天粘贴私钥、Cookie、签名、完整 JWT 或 DB 密码。

本机源目录：
- 后端 `/Users/mili/Documents/Developer/mealforward-cp29-business/cp30-backend`
- 前端 `/Users/mili/Documents/Developer/mealforward-site-source-audit`
- 私有运行目录 `/Users/mili/.mf-cp30-20261013`，不随代码/ZIP 交付。
- 服务 `https://localhost:16443/`，静态源码启动时加载，更新前端后需受控重启。
- 原 Sites https://mealforward-three-stores.ochre-jelly-7528.chatgpt.site/
- Vercel 项目 https://vercel.com/mangsengs-projects/mealforward

用户已选择先完成本机真实联调。没有配置可供线上 Sites 调用的公网后端，本次没有云部署。普通静态 HTTP 预览不能替代 HTTPS 同源 API 联调。

## 架构与阅读顺序

前端是静态 HTML/CSS/JS，无 npm 构建步骤。`dist/app.js` 为界面与流程，`dist/live-api.mjs` 为真实 API、钱包身份及恢复适配，`dist/onboarding-view.mjs` 为注册/钱包界面，`dist/assets/live-wallet.mjs` 为钱包打包代码。旧 README 主要描述历史模拟站点；现行联调见 `LOCAL-INTEGRATION.md` 与本文件。

后端 Python + PostgreSQL，受限 API / runtime / worker / authority 角色，原请求幂等、持久 nonce/gas 预算及签名日志；敏感配置/授权能力在私有运行目录。`src/c1/application.py`、`connection_composition.py` 负责组合；`live_gateway.py` 调度原 intent 与链上观察；`automatic_business.py`、`private_business_host.py` 管受限服务；`integrations/business/` 含 ABI、编码、签名、广播、observer 和 projection。所有 RPC 状态需按原操作与 finalized 证据核实。

按顺序阅读：
1. 本文件；前端 `LOCAL-INTEGRATION.md`。
2. 后端 `docs/KITCHEN-LIVE-HANDOFF.md`、`LIVE-BUSINESS-PROTOCOL.md`、`FRESH-RUN-CONFIGURATION.md`（后者是配置形状，不是可直接执行的现有配置）。
3. `src/c1/live_catalog.py`、`live_gateway.py`、`live_catalog_images.py`。
4. `connection-migrations/042-live-catalog-reviews.sql`、`043-live-catalog-execution.sql`、`044-live-multi-meal.sql`。
5. `integrations/business/catalog*`、`observer.py`、`projection.py`、`private_runtime.py`、`original-signer-worker.mjs`。
6. `tools/catalog-provision.py`、`catalog-provision-check.py` 及三个 catalog/multi-meal PG 检查脚本。

### 已有真实联调修复

Dynamic OTP 能验证，但拉 profile 曾遇 HTTP403；当前使用独立测试钱包登录。不要降低 JWT 验证绕过。钱包切换隔离、草稿、新旧 quote/付款恢复、领券列表、核销原请求恢复、180 秒结算门禁及 UTC+8 已开发。部分过期 quote 与失败历史会保留，不删数据假装成功。

迁移 031 草稿；032 review；033 钱包/rate；034 权限；035 quote DTO；036 新 quote 1800秒；037 claims；038 kitchen recovery；039 延迟结算；040 UTC+8；041 原 lock FINAL_REVERT 恢复。

### 本次发布链路

`POST /v1/stores/{store}/drafts/{draftId}/review`，body `{expectedRevision:number}`。
返回 `{reviewId,store,review:{draftId,draftRevision,mealId,version,name,description,unitPrice,price,windows,collectionTimeZone,imageDigest,bodyDigest,termsHash,expectedControlRevision,expiresAt,needsListing,targetListed}}`。
`price`/`unitPrice` 是基础单位字符串，0.5 USDC=500000，不能再当显示金额乘一次。

`POST .../drafts/{draftId}/publish`，body `{reviewId}`；返回 action=publish 的原 intent，追加 draftId/mealId/version/needsListing/targetListed。需 CSRF、幂等 key、当前 owner 会话。相同确认重试必须返回原 intent。

`GET /v1/intents/{id}` 恢复。workbench.catalogIntents 同时包含 publish 和 setListed，后者 parentIntentId 指向前者。首发 needsListing=true；旧餐品新版本不能偷偷重新上架。catalog 未配置时能力 false，不能假装发布。

图片 `GET /v1/stores/{store}/meals/{meal64}/versions/{version}/image`，只允许已确认版本内容；固定存储读取并返回 PNG。public/workbench 的 item ID 通常不带0x，mealId 是0x+64hex，draft UUID 不等同 mealId。

044 将内容固化到 meal/version，未 LIVE 的新餐品不公开；support 用当前条款，claim 用实际库存历史版本，voucher 保持该 unit 的条款。各餐品统计与全店财务统计分别计算。

## 下一位必须继续的工作（按顺序）

1. 核对本文件对应提交、工作区状态和测试。停止并行写入后再安装，不把源码存在当作运行成功。
2. 本机确认 catalogAuthority 测试 MON 余额。最后观测为 0；曾建议补 0.5 测试 MON，实际需按有限交易预算核对，不能承诺此数必够。这是 gas，不是捐餐 USDC。
3. 查看实际服务状态/运行目录/数据库归属；备份后在正确数据库事务内安装 042→043→044，验证原 material、profile、grant、历史 records 与权限只发生预期变化。不要重新初始化或清空旧库，不重部署原店合约。
4. 对审核过的 source 和 SQL 更新精确 pin。修改 application.json / automatic-business.json 时必须同时维护 `INSTALLED.json.configs` 和 `WALLET-LOGIN-INSTALLED.json.originalConfigs`。`WALLET-LOGIN-INSTALLED.json.sourcePins` 包含 application.py/db.py，必须核对本次改动。不要批量把未知变化重新签成可信。
5. `tools/catalog-provision.py` 是专用安装工具，**尚未执行**。先阅读其参数/前置条件，在私有 run 中使用；它不代替迁移和 source 安装。保留原 quote/issuer/operator profiles 和 compilerPins；仅新增 catalog profile/grant/login/journal/capability。
6. 工具持久保存 CATALOG-PREPARING 状态与四文件恢复计划，出现中断只能按原计划恢复；发现第三种文件内容应停止，不覆盖。catalog grant 有期限与有限预算（设计6次签名、合计0.72 MON上限，每笔 gas1M×maxFee120gwei），旧授权过期后需明确重新审核，不延长旧历史记录。公开文档中的历史 expiry 不构成当前授权。
7. 原有 gateway 即使 catalog 不可用也须继续支持三种原角色；catalog 缺配置返回等待。安装后重启正确 owned 服务，检查实际服务 app bytes、钱包登录和 owner workbench capability，而非只跑源码测试。
8. 用老板钱包审核并发布 0.5 USDC 草稿。保存 publish/setListed 各自 hash，等待 finalized；检查前端公开菜单、数据库、链上条款一致，发布本身库存为零。
9. 用 B 支持新餐，approve 与 fund 分开；receipt 与份数确认后领取。C 已持有旧7USDC餐券，可能受单钱包一张有效券限制；用另一独立测试钱包，不能删旧券绕过。
10. 在 UTC+8 服务时段生成新120秒短码；老板另一个浏览器 profile 验券、锁券、确认交餐/申报。等待180秒后老板钱包结算，最终核对餐券失效、份数账与实际收款。没有链上证据不写“全链路已通过”。

原服务正常启停入口（仅本机、审核安装后；不能作为新机器一键部署）：
```sh
env -i /Users/mili/.mf-cp30-20261013/.venv/bin/python -I -B /Users/mili/Documents/Developer/mealforward-cp29-business/cp30-backend/tools/isolated-entry.py connection-bootstrap stop /Users/mili/.mf-cp30-20261013
# 安装、检查并维护 pin 后，使用同一入口把 stop 改为 start。
```
仅停止自身受控 PID，禁止按端口杀全部服务。此前 CUA 访问 localhost 有策略限制，不应使用调试端口绕过；可由用户浏览器配合完成钱包动作。

## 测试与可复现性

前端最终重新执行 130/130 PASS：
```sh
node --test live-publish.test.mjs live-api.test.mjs live-support.test.mjs live-claim.test.mjs live-redemption.test.mjs live-settlement.test.mjs onboarding.test.mjs onboarding-wallet.test.mjs support-ui.test.mjs claim-ui.test.mjs verification-ui.test.mjs settlement-ui.test.mjs meal-publish-ui.test.mjs
```

后端本轮已完成：gateway/refresh/catalog dispatch 26 unittest runs PASS（含导入重复）；042 fresh PG PASS；043 fresh PG PASS；044 fresh PG PASS；catalog provisioning 临时文件恢复测试 PASS；catalog codec 3/3 PASS；observer 两动作验证 PASS；前一组合回归28通过1断言失败，错误码期待已修正，catalog runtime独立3/3 PASS。最终整组合重跑结果见文末补录。

在 backend 子目录，现有本机 Python 是 `/Users/mili/.mf-cp30-20261013/.venv/bin/python`。相关脚本：
```sh
# 使用已验证的 Python 环境，空环境、隔离导入执行：
env -i /Users/mili/.mf-cp30-20261013/.venv/bin/python -I -B tools/live-catalog-review-pg-check.py
env -i /Users/mili/.mf-cp30-20261013/.venv/bin/python -I -B tools/live-catalog-execution-pg-check.py
env -i /Users/mili/.mf-cp30-20261013/.venv/bin/python -I -B tools/live-multi-meal-pg-check.py
env -i /Users/mili/.mf-cp30-20261013/.venv/bin/python -I -B tools/catalog-provision-check.py
```
PG 脚本使用 fresh owned PG17.11，部分路径固定 `/opt/homebrew/bin`，不是生产库测试；新机器先适配已验证的运行时路径。Python 依赖见 requirements.lock / requirements-connection.lock；Node codec 依赖 viem；有些检查使用 Codex bundled Node 绝对路径。合约编译产物 out、node_modules、虚拟环境不打包，若缺失按合约 README 的固定编译配置重建并核对原 artifact/hash，不能改pin迁就不同结果。没有提供通用一键启动脚本，也没有宣称新机器可免配置运行。

Git whitespace 检查发现历史源码3个文件共4处空白问题（023 SQL尾空行、onboarding离线测试2行尾空格、email_policy尾空行），为避免无关改动影响旧source/SQL pins未清理；不影响上述功能测试。没有在本轮跑全历史测试或完整真人钱包 E2E。

## 真实记录（公开标识，不含凭证）

网络 Monad Testnet chainId10143，测试 USDC6位精度。

|对象|标识|
|---|---|
|老板A|0xc4f8a468f10d5f98dcff3282516125e97f26433b|
|支持者B|0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952|
|领取者C|0x41dcbfed391b79fac7b2951dd136c6b7e1384259|
|store|5304b95655b2140ebc382c6bb672b2fb027b393997e83228157e15691170ae53|
|原meal|0x7b38800e409c5e71f7d9291ea349ee69ee7c5e99420d5d72117022d74da4e218|
|escrow|0xfeced14e8533d29f9c21182a11556ad5c4931043|
|USDC|0x534b2f3a21130d7a60830c2df862319e593943a3|
|catalogAuthority|0x864218503e18bb73d86bcbffbb3a27d7f7a34a2d|
|登记ID（不是交易hash）|0x197f53eb35acef8abf4638bd40249b7b0acdc52505ee5588b60b2f05f5f40395|
|部署交易|0x7186a0d38064407f843e902de193e0756778b19250b8f4d03d79213fc4ddbf9a|
|support intent|a4596099-217e-4018-8cc2-efa1156e9279|
|approve tx|0xb71ac4890ce09ce7ea5198e4a486f722c7ee951b0ef1015b0a5b4177a574c901|
|fund tx（FINAL_SUCCEEDED）|0x00bada598ccc902bb71a9c815e6d7f508ef088e536974a8f06680260e685530c|
|claim intent（FINAL_SUCCEEDED）|0305851f-ede6-401f-aa40-6fbb347fd728|
|issue tx|0xef797ad0aa5db7ff7f020948bfc9bc40dc11758c6ef9adaa4a3033aae6bae398|
|voucher|0xd06187e4d586ee6b6ad728048859a37c04f2ef5f7e698178a9fcf57ddc68a49e|

最后核对旧账：F1 A0 R1 H0 S0 X0，7 USDC负债，未结算。原窗口 [[870,1140]]=北京14:30–19:00。券过期2026-10-16T15:17:27Z；接手时必须重新检查，不将历史快照当作实时状态。

原失败 lock intent `549f366b-c924-4561-b8a3-3220bfb57ef6`，tx `0x45c9f386cd8032db816e146bff5d4454a6db8bbebeeb03afb14a421cbe2a3dd2`。01:28北京不在窗口，TimeDenied，status0；041已按严格原交易证据恢复为 FINAL_REVERT 并释放该lease，券仍R，旧短码无效。不能重发旧lock或改历史时间。

私密链接正确形式为 `https://localhost:16443/#verify?code=<短时秘密>`；`#mine:~:text=Open...` 是浏览器文本定位链接，不是验券链接。真实code禁止进Git/聊天/日志。领取者需保持登录，老板用独立浏览器profile，普通新tab共享Cookie不能隔离身份。

## 可直接交给新 GPT 的任务提示

“请先阅读 WEB-GPT-HANDOFF-2026-10-14.md，并核对两个指定分支。目标是完成现有新餐品发布→支持→领取→老板核销→180秒后老板钱包结算的真实联调。先区分源码、已安装运行时、数据库和链上状态；不要重建店、清库、重发UNKNOWN操作或覆盖原7USDC条款。当前042–044未安装，catalog服务未配置且最后gas为0。先提出精确安装与验证步骤，再由有本机访问权的agent执行；网页GPT无法访问用户localhost时明确说明。所有真人钱包签名由用户完成；任何完成结论必须附相应原intent和链上确认依据。”

## 最终补录

Root 在冻结源代码后完整重新执行 catalog runtime、live drafts、original signer、private runtime、broadcaster、observer、projection 组合：**29/29 PASS，64.490秒**。前端重新执行 **130/130 PASS**。因此前述错误断言已在当前提交得到整组验证，不再是未解决测试失败；实际安装与链上发布/核销/结算仍未执行。

源码 ZIP 只包含 Git 跟踪的后端、合约、前端及必要根构建清单/说明，不包含 .git 历史、ignored evidence、运行数据库、密钥、私有配置、虚拟环境和 node_modules。完整历史以 GitHub 分支为准。交付包另附 SHA256 清单用于检查文件完整性。
