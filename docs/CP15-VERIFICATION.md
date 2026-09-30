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
- 重复事件不重复计账；完整receipt log解码与事件内容比较；finalized checkpoint或事件内容矛盾停写。预检拒绝不证明未广播：保留原资格与预算，标记unknown；只允许原操作在证据一致时继续，不释放nonce另发新业务。
- 暂停禁止新发行，worker仍投影已完成交易；无旧actor/reset/outcome假接口。异常HTTP只返回通用错误，不序列化RPC错误payload。

初版602ce49的41项测试通过，但独立审查发现了下述恢复/权限缺口，初版不应验收。修订增加4项真实HTTP/Anvil回归，并收紧原有预检失败测试。现有14项模拟状态测试仅为隔离回归，不算真实链验收。CP13合约/钱包源码未改，不重复宣称重新完成其全部验收。

### 独立审查修订 R1/R2

R1原复现：接受issue后备份QUEUED；原库广播并INCLUDED_SUCCESS；恢复旧库估gas得到重复业务revert，错误释放预留，最终成功却used=0。修订先查原operation映射、完整Issued/receipt/交易payload和nonce；恢复相同原txHash，确认前保持reserved=3，最终变used=3，恢复库broadcast_count=0。若原交易还在mempool，nonce已占用但raw丢失，保持unknown/预留，不重签或换nonce；原交易入块后再恢复。预检失败不再自动释放。已有RELEASED却出现链上成功的矛盾数据库会停写，不静默标成功。

R2原复现：用户从partner-a调到partner-b，GET原操作403，但同键POST返回partner-a私有发行。修订幂等分支先核当前partner scope，原操作GET、by-intent GET与重复POST全部403且不含request/vouchers。

修订验证：`.venv/bin/python -m unittest tests.test_auth tests.test_backend_chain tests.test_flow -q` **45项PASS / 41.890秒**（Auth11 + 后台20 + 原模拟14）。以修订源码重跑审查者原脚本，恢复前最终确认状态为INCLUDED_SUCCESS / reserved=3 / used=0 / PENDING；最终确认后为FINALIZED_SUCCESS / reserved=0 / used=3 / USED；改机构后GET=403、POST=403、泄露券数=0。修订仍待独立复核，不自宣ACCEPTED。

## Envio 独立状态

固定源提交1871961及依赖修复d5443ab；本仓库串行整合，后者为093967a。`indexer/` 依赖与根依赖分离；初版在本仓库运行ci/codegen/check/4项SDK模拟测试通过，依赖修订由作者与Leader独立reviewer fresh ci/codegen/check/4tests/audit复核通过，npm audit为0，保留Envio3.12.1。它们不是实际Anvil摄取证据。

真实HyperIndex/Postgres/Hasura、GraphQL摄取、服务重启持久性和链重组自动回滚：**NOT_RUN**，本机缺Docker；没有安装daemon。审查与运行前提见 [indexer/README](../indexer/README.md)。原11项npm audit报告已通过固定overrides清零，并未降级Envio；audit0不代表真实服务已验收。后台权威来自直接RPC，Envio未接入业务写，索引延迟不回退最终结果。

## 仍未实现

完整P01–P14接链、lock/report/settle HTTP、券分享/核销邀请、Dynamic/Mera真实SDK、Alchemy测试网、生产部署及真人供餐核验，均不在此片完成范围。没有push、云账户、真实网络签名或用户钱包访问。
