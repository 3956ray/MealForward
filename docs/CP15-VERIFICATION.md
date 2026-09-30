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

原路径、未替换数据库的API/worker普通重启继续正常运行。若Anvil被重置，旧库不得搭配新部署：manifest、code/genesis/checkpoint核对失败会停止写入，不能靠删状态自动恢复。早于操作接受的旧备份无法重建私有资格/ref/秘密，遇本地签名者已发行但outbox缺失时停写，须人工核对完整私有记录。

### 受支持的备份与恢复入口

```sh
# 本地私有备份目录必须不存在；bundle包含数据库、加密key与临时issuer key
.venv/bin/python -m server.local backup --directory .localbackend --destination .localbackend/backups/cp15-snapshot
# 停止自己拥有的旧后台worker后，恢复到全新的目录；不能覆盖正在运行的库
.venv/bin/python -m server.local restore --backup .localbackend/backups/cp15-snapshot --directory .localbackend/restored
.venv/bin/python -m server.local web --directory .localbackend/restored
.venv/bin/python -m server.local worker --directory .localbackend/restored
```

备份使用SQLite一致性backup，封装备份ID、时间、schema、部署域、文件SHA256和完成标记，目录0700/私有文件0600。恢复拒绝已有目标目录、未完成或内容不匹配的bundle；SHA256只用于完整性检查，**不防有权操作者重写整个bundle和清单**。原始bundle应保持只读封存，通过restore产生运行副本；不要直接在bundle上运行服务改变其校验内容。

恢复实例持久标为 **RESTORE_QUARANTINE**；config、health和原操作DTO显示恢复状态、`writeAvailable=false`、只查原操作策略，capabilities为空。新支持会话/意图、发行及重复POST返回明确503、机器码`RESTORE_QUARANTINED`。恢复时旧工作session和旧support cap全部撤销，防止恢复快照复活后来的读权限撤销；仍可用原具名工作账号重新登录，只按当前机构scope读原发行。旧cap即使此前未到期且原op绑定正确，私查仍401；不补发cap或自动认领旧私有意图。支持者只能按原chain/contract/payer/intent查公开链字段或联系处理人，查不到不等于未广播。无匿名私有读取、无自动延长cap期限。

隔离worker可核对原业务/交易与finality，内部更新真实账本；无可信raw的恢复任务始终只观察并保留预留，即使原交易drop、nonce看似空闲也不生成raw。已有原raw须核hash、签名者、部署地址/chainId、nonce和完整payload后才可同字节重播。恢复操作即使finalized，**实例也不自动解除隔离**。本片没有解除按钮、HTTP端点或CLI开关；解除需后续具名恢复负责人、独立复核者和授权执行者核齐备份点后完整操作/签名历史、资格/预算/券/私有材料与nonce证据并留审计。raw存在或当前无pending都不足以解除全库隔离。

额外防护：数据库移到不同路径或缺少新版来源记录，加载时自动隔离。普通原库首次签名及原路径正常重启保持ACTIVE。**不支持任意文件复制后恢复可写，也不声称能识别同一路径下手工替换旧DB或有权操作者改元数据**；受支持restore明确禁止覆盖已有目录，此类手工替换必须停机并改用受控restore进入隔离，不能当作普通重启。

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

e7eb677历史验证：45项PASS / 41.890秒（Auth11 + 后台20 + 原模拟14），原漏扣与跨scope复现关闭，但独立复核追加掉单测试仍失败，不能以该45PASS宣称恢复缺口关闭。

### 剩余P2：掉单后恢复不可新签

新增受控入口与持久隔离状态后，原 `/tmp/cp15-r1-drop-repro.py` 仅替换import源码路径复跑：原库真实mempool广播→drop→改变basefee挖块→加载旧QUEUED副本，得到 `has_new_raw=false / broadcast_count=0 / status=SUBMISSION_UNKNOWN`。恢复库nonce/hash仍为空，既没有新分配nonce，也没有把“当前nonce相等”当成首次签名证明。

新增回归真实执行backup/restore CLI、掉单及basefee变化，验证预留PENDING、reserved=3/used=0、不签名/不广播、恢复重启仍隔离；真实HTTP验证新业务拒绝、旧work cookie及旧support cap401、重新登录原scope只读、跨机构403、cap不可补发认领、公开原域查询200且无私有响应。另验证已签bundle仅原raw重播、finalized仍隔离、raw与nonce矛盾在广播前停写、损坏bundle和覆盖活动目录被拒。原先三处硬进程崩溃测试同时确认普通未恢复库重启仍ACTIVE。

最终执行 `.venv/bin/python -m unittest tests.test_auth tests.test_backend_chain tests.test_flow -q`：**49项PASS / 53.443秒**（Auth11 + 后台24 + 原模拟14）。compileall与git diff --check通过；原掉单脚本最终复跑仍无新raw、广播0、UNKNOWN。本修订待原独立reviewer按固定提交复核，未自行宣告P2关闭。

## Envio 独立状态

固定源提交1871961及依赖修复d5443ab；本仓库串行整合，后者为093967a。`indexer/` 依赖与根依赖分离；初版在本仓库运行ci/codegen/check/4项SDK模拟测试通过，依赖修订由作者与Leader独立reviewer fresh ci/codegen/check/4tests/audit复核通过，npm audit为0，保留Envio3.12.1。它们不是实际Anvil摄取证据。

真实HyperIndex/Postgres/Hasura、GraphQL摄取、服务重启持久性和链重组自动回滚：**NOT_RUN**，本机缺Docker；没有安装daemon。审查与运行前提见 [indexer/README](../indexer/README.md)。原11项npm audit报告已通过固定overrides清零，并未降级Envio；audit0不代表真实服务已验收。后台权威来自直接RPC，Envio未接入业务写，索引延迟不回退最终结果。

## 仍未实现

完整P01–P14接链、lock/report/settle HTTP、券分享/核销邀请、Dynamic/Mera真实SDK、Alchemy测试网、生产部署及真人供餐核验，均不在此片完成范围。没有push、云账户、真实网络签名或用户钱包访问。
