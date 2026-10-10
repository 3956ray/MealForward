# CP29 单操作者双工作角色最小合同

2026-10-10。唯一目标为当前CP29工作树；801383d基线上的已应用Stage1完整纳入本次checkpoint和独审，不重新套补丁。只实现身份模式及安全整合，不启动真实业务。

## 固定配置与权限

默认保留Stage1两不同指纹各映射一个Actor的模型。新 `cp29IdentityMode` 仅接受显式 `single-operator-testnet`，连同固定environment、chain10143、Origin http://127.0.0.1:15287、contract 0xD60ceD42A67e6B7bE2A3d17464181875b75531a9、deploymentId 60b8e4d0b25c4cf73bf49b0e4fb1c0c909cd0f77837caa2bd4d58183416807d1、runId cp29-first-meal-20261009及操作员批准的 `cp29IdentityWindow: {issuedAt, expiresAt}`（UTC Unix 秒整数、最长8小时）校验；未知/错误/过期全部拒绝。environment 字段名固定为 `environmentId`；contractAddress 接受同一固定地址的 checksum 或全小写拼写，与既有 read-only 注册输出兼容。

`trustedSubjects`只准一个经签名JWT验证后计算的HMAC指纹，值为明确的partner/owner两项 `{actorId,revision}`；Actor必须分别为cp29-partner、cp29-owner，不允许同Actor、任意角色或额外映射。配置仅由本机可信操作员提供，本片不创建真实映射文件。默认two-subject格式及两身份约束不放宽。

业务登录只能固定 `/api/cp28/partner/login`、`/api/cp28/owner/login`，空JSON+当前SDK内存Bearer；浏览器不得提交actor/role/subject/fingerprint来授予权限。复用严格已审核profile、fixedJWKS/RS256，精确aud/issuer/environment/sid/scope/time不放宽。DB mapping enabled/revision、users enabled/role/partner/shop及deployment/config digest继续由原work/store权威检查；登录会话不长于JWT/mode/原绝对期限。

## 切换、撤销与证据

单操作者模式最多一个有效工作角色：每次成功角色登录在同一事务中撤销该模式两个Actor的旧工作sessions/CSRF及owner wallet sessions/challenges；不取消已接受链操作，不释放UNKNOWN预算或重发。旧cookie、跨角色CSRF、过期/更改配置均失败关闭。注销及离页清理撤销当前工作权限。

前端按角色挂载、串行等待旧登录/注销清理，不让旧fetch写回当前session/CSRF或UI；无法确认清理时关闭工作登录并要求核对，不将网络错误当成功退出。到期、SDK身份变化和角色离开清除工作UI及钱包proof状态。仅固定partner/owner页按需加载工作SDK，recipient保持匿名免钱包。

界面与脱敏审计明确“单操作者测试，不等于两个独立自然人交接”。两个Actor是不同业务角色而非两名自然人；审计不记录邮箱、subject、指纹、JWT/OTP/CSRF或密钥。成功登录不代表Runtime或签名授权。

## 本片完成条件与禁止项

使用合成JWT/临时DB/离线或随机端口验证：默认双主体回归、同一主体分别进入固定两角色、未知身份/任意actor输入拒绝、错mode/env/chain/contract/id/runId/origin/期限/actor、失效mapping及关系、跨角色cookie/CSRF、切换proof/challenge撤销、迟到响应/退出/SDK初始化竞态、recipient无SDK；并跑Stage1适配器与原重复/UNKNOWN交易守卫回归。桌面与移动合成浏览器验证，构建写独立目录。

不改served dist、不重启15287/15429/15430、不读旧私有配置/真实凭据/HMAC/keystore、不重校准/部署/grant，不写真实业务DB或映射、不启动SignerRuntime、不改合约/预算策略/签名权限。DB初始化、launcher、独立signer/IPC及真实Runtime计划留待另一个受审增量。完整实网一餐E2E NOT_RUN；提交本地checkpoint（不push/merge）后交独审/PM/Leader，不自行ACCEPTED。


## 实现与验证入口

- `cp29_mode.py` 校验模式；`cp29_auth.py` 继承原可信认证边界，通过 `cp29_composition.business_web_app` 显式装配。无新 CLI，也不自动装配到准备入口。
- 默认模式不设置 `cp29IdentityMode` / `cp29IdentityWindow`。单操作者配置以 `tests/test_cp29_single_operator.py:config` 的合成形状为参考；禁止将合成指纹、测试密钥或 fixture 用于真实运行。
- 成功登录的事务先验证新 Actor，再撤销两个固定 Actor 的旧工作会话、钱包 proof/challenge；既有操作和 UNKNOWN 保留。业务事务中的 `ManualWork.require_actor` 再检查实时 session/config/mapping，阻止预检后切换的旧 Actor 接受新业务。
- 会话最晚到期为 JWT exp、单操作者窗口 expiresAt、原绝对 TTL 的最早值；原 idle TTL 仍适用。profile/密钥变动由每次 HTTP 权限检查拒绝；配置来源/摘要和映射关系在业务事务继续复核。
- 复用 `cp24_audit` 保存事件类别、工作角色和单操作者说明，空 redemption ID 表示身份事件。没有写入 subject、指纹、session ID、令牌、邮箱或钱包地址。
- 前端全角色挂载共用串行会话队列；未知网络结果或撤销失败关闭工作登录及状态恢复。跨标签并发由服务端事务保证最多一个有效会话；旧 cookie/CSRF 的后续请求失败。页面离开不能保证浏览器强制关闭时发送注销，服务端期限仍是最终边界。
- 浏览器 fixture 仅使用临时 DB、合成 JWT/SDK，随机端口的 Host/Origin 翻译只存在于测试包装器；生产固定 Origin 由 HTTP 负例独立验证。fixture 未开放业务 Runtime，不能作为真实一餐 E2E 证据。

复现（使用该项目已批准的 Python 环境；下方解释器是当前已有依赖的运行器）：

```sh
/Users/mili/Documents/Developer/mealforward-cp28-manual-test/.venv/bin/python -m unittest tests.test_cp29_single_operator tests.test_cp29_mapping_composition tests.test_cp29_integration_adapters tests.test_cp29_fingerprint_http tests.test_cp28_runtime tests.test_cp28_fake_flow tests.test_cp28_identity tests.test_cp28_calibration tests.test_cp28_ipc -q
npm run test:wallet
node_modules/.bin/tsc --noEmit -p manual-business-harness/tsconfig.json
node_modules/.bin/tsc --noEmit
node_modules/.bin/vite build --config manual-business-harness/vite.config.ts --outDir ../dist/cp29-single-operator-review
node_modules/.bin/vite build --config tests/cp29_single_operator_vite.config.ts
/Users/mili/Documents/Developer/mealforward-cp28-manual-test/.venv/bin/python -m tests.cp29_single_operator_browser
```

两个构建目录均位于项目根 `dist/` 下，不覆盖 `manual-business-harness/dist`。浏览器移动检查使用 viewport override，结束后恢复。最终 fixed-SHA、日志与截图索引由 Leader 工作区的 `research/cp29/developer/SINGLE-OPERATOR-DELIVERY.md` 记录。本次是待独审的本地交付，不是 ACCEPTED 或真实 Runtime 激活。
