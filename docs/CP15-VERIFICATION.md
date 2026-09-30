# CP15 本地持久后台验证

2026-09-30。范围为本地 Anvil31337、Flask HTTP、SQLite、个人工作认证和 issueN3。实现提交待 Leader 独立审查；本文件不是 ACCEPTED 声明。

## 运行与隔离

在仓库根目录使用 Python3.12.14、Node24.21.0、npm11.19.0。依赖精确锁定在 requirements.lock，venv 不入库。

```sh
uv venv --python python3.12 .venv
uv pip sync requirements.lock --python .venv/bin/python
npm ci
node_modules/.bin/forge build
.venv/bin/python -m unittest tests.test_auth tests.test_backend_chain tests.test_flow -v
```

自动测试启动自己拥有的随机端口 Anvil 和真实 HTTP 服务，每项使用独立临时数据库/合约/随机签名者，只结束测试自己启动的进程。测试显式 mine 推进本地 finalized；业务 worker 从不自动挖块。

手工服务需三个终端，18645/8875 必须空闲：

```sh
# 终端A：本片独立节点，不使用18545预览节点
node_modules/.bin/anvil --host 127.0.0.1 --port 18645 --chain-id 31337 --silent
# 终端B：首次创建；目录非空则拒绝，绝不自动重置
.venv/bin/python -m server.local setup
.venv/bin/python -m server.local web
# 终端C：同一配置的单worker
.venv/bin/python -m server.local worker
```

HTTP 为 http://127.0.0.1:8875；所有POST要求相同 Origin 和 JSON。本地预置用户名 partner-a / partner-b，密码 local-only-password，仅虚构fixture。登录取得 HttpOnly work_session 和 CSRF token；工作POST要求 X-CSRF-Token。每机构各有 REF-A 3份资格，不共享额度。支持者先 POST /api/v1/support-session 接收独立cookie，再 POST /support-intents；客户端仅签返回的已持久化意图。测试文件展示完整可复现HTTP流程。

`.localbackend/` 独立持久目录包含配置、DB、随机临时issuer私钥和加密key；目录0700、文件0600。API不加载issuer私钥，worker不输出raw/key/秘密；私钥从未来自用户钱包。单API进程可处理并发线程；进程内认证限速锁不支持多Gunicorn worker。worker的文件锁阻止同库并行签名者。SQLite整数金额限定当前合约总额上限1e17 wei，不宣称通用uint256数据库。

重新启动同一个API/worker会恢复原库。若Anvil被重置，旧库不得搭配新部署：manifest、code/genesis/checkpoint核对失败会停止写入，不能靠删状态自动恢复。备份使用SQLite backup API并保管原加密key/manifest；含已接受操作的备份可重放链确认。早于操作接受的旧备份无法重建私有资格/ref/秘密，遇本地签名者已发行但outbox缺失时停写，须人工恢复完整私有记录。不能把任意时间点旧备份宣称无损恢复。

## 真实后台验证矩阵

- Auth：11项真实Flask/SQLite测试，覆盖慢哈希、登录/登出、Origin/CSRF、账号/IP限速、绝对/空闲超时、禁用与角色scope。
- 后台：真实HTTP+Anvil，覆盖签前持久化、capability同键幂等/异参409/跨cap拒绝/期限、公开原intent只读找回；cap不证明地址所有权、不授工作权限。
- 同一机构并发2+2争3份资格只接受一个；跨机构争同一批预算仍原子；两批余额独立；同键返回原业务，异参拒绝。额度、券秘密和raw不进公开DTO。
- 未finalized资金不得发行；券仅在finalized后列为确认，不提供秘密分享API。最终资金F=A+R+H+S+X，X=L=0；私有发行预留单列，不伪造链上L。
- 真正子进程在签名前、持久raw后、广播后分别os._exit；重启保持原业务ID、nonce、raw/hash并仅产生一次Issued。签名后撤销链权限得到真实revert，最终确认前保预留、最终revert后释放。
- 广播已送达但响应丢失保留unknown及预留；RPC故障不回退已保存finalized。支持交易未finalized重组先保持不可用，规范链恢复后转unknown，不自动补付。
- SQLite备份恢复读取已上链原交易，无第二次广播；过旧备份缺私有接受记录停写。禁用再启用账号，期间未访问的旧session仍401。
- 重复事件不重复计账；完整receipt log解码与事件内容比较；finalized checkpoint或事件内容矛盾停写。签名前崩溃后若预检拒绝，释放未签名nonce供后续交易使用，不形成nonce空洞。
- 暂停禁止新发行，worker仍投影已完成交易；无旧actor/reset/outcome假接口。异常HTTP只返回通用错误，不序列化RPC错误payload。

最终命令 `.venv/bin/python -m unittest tests.test_auth tests.test_backend_chain tests.test_flow -q`：**41项 PASS，31.282秒**（Auth11 + 后台16 + 原模拟14）。追加原业务键查询和异参409断言后，定向重跑完整HTTP链路通过。现有14项模拟状态测试仅为隔离回归，不算真实链验收。CP13合约/钱包源码未改，不重复宣称重新完成其全部验收。

## Envio 独立状态

固定源提交1871961；本仓库串行整合。`indexer/` 依赖与根依赖分离，执行 npm ci --ignore-scripts、npm run codegen、npm run check、npm test 成功，4项SDK内存模拟测试通过。它们不是实际Anvil摄取证据。

真实HyperIndex/Postgres/Hasura、GraphQL摄取、服务重启持久性和链重组自动回滚：**NOT_RUN**，本机缺Docker；没有安装daemon。审查与运行前提见 [indexer/README](../indexer/README.md)。作者记录11项npm传递依赖audit报告（6 high）；未强制降级Envio，独立风险审查待Leader。后台权威来自直接RPC，Envio未接入业务写，索引延迟不回退最终结果。

## 仍未实现

完整P01–P14接链、lock/report/settle HTTP、券分享/核销邀请、Dynamic/Mera真实SDK、Alchemy测试网、生产部署及真人供餐核验，均不在此片完成范围。没有push、云账户、真实网络签名或用户钱包访问。
