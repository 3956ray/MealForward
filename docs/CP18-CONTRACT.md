# CP18 Alchemy只读测试网检查

Leader已完成Dev–PM DESIGN并放行BUILD。独立UI http://127.0.0.1:15217/ 与只读API127.0.0.1:18985；不动旧入口、Dynamic内存登录、业务DB/ChainRpc/worker。复用已有依赖，不改根package/lock/tsconfig。无需登录或钱包，无部署/交易/回执查询。

从仓库根启动：

```sh
.venv/bin/python -m server.alchemy_readonly --port 18985
node_modules/.bin/vite --config alchemy-harness/vite.config.ts
```

后端固定私有配置`.localbackend/alchemy/config.json`（0600，目录0700），只使用testnet_rpc_url，不使用mainnet/active_network作为路由。HTTPS目标仅monad-testnet.g.alchemy.com/v2/<key>，禁止代理继承与重定向。不要打印、提交或传给前端该文件。新Vite使用独立root/cache/dist并拒绝私有目录访问。端口占用时不要接管旧服务。

唯一查询POST /api/v1/testnet/status，application/json且严格空对象，请求上限1KiB；Origin必须http://127.0.0.1:15217，Host允许127.0.0.1:15217或API端口。不提供宽松CORS、cookie、任意RPC/URL转发。先eth_chainId，严格10143才读eth_blockNumber；143/31337失败且不继续读取。成功白名单chainId=10143、network=Monad Testnet、latestBlock十进制字符串、checkedAt UTC、contractDeployed=false。合法区块0可显示。

错误结构`{error:{code,message}}`，固定中文信息。400 INVALID_REQUEST；403 ORIGIN_DENIED；413 REQUEST_TOO_LARGE；415 JSON_REQUIRED；429 LOCAL_RATE_LIMITED（60秒）/CHECK_IN_PROGRESS（1秒）；503 UPSTREAM_RATE_LIMITED（60秒）/CONFIG_UNAVAILABLE；504 UPSTREAM_TIMEOUT；502 NETWORK_MISMATCH/UPSTREAM_FAILURE。404/405/500亦固定脱敏，无异常、原始上游body或URL回显。所有响应no-store。

全进程5次受理/60秒滑动窗口、一个在途；失败计额度，拒绝不排队/不触上游，无重试。每次connect≤2秒/read≤3秒、解压后响应≤64KiB，整次HTTP等待deadline8秒。最小单工作线程在每RPC前及每读取片段检查剩余时间；HTTP截止后底层可能仍在退出，此时仍占在途锁，禁止发第二RPC/新增并发。不是强制取消DNS/socket的保证。前端12秒停止等待，代次丢弃迟到响应，恢复按钮但不宣称后端取消或自动重试。

页面初始不请求，无轮询。检查开始清旧结果，失败不显示过时成功。常驻“本项目尚未部署测试网合约”，为本checkpoint配置事实而非链上全网探测。区块不代表finality、资金到账或餐账；完整CP17业务与owner钱包仍按原证据状态。

定向验证：

```sh
.venv/bin/python -m unittest tests.test_alchemy_readonly -v
node --experimental-strip-types --test tests/alchemy/api.test.ts
node_modules/.bin/tsc --project alchemy-harness/tsconfig.json --noEmit
node_modules/.bin/vite build --config alchemy-harness/vite.config.ts
```

实际HTTP与原生Chrome CUA新tab证据、受控负例和固定SHA独审分开记录至Leader项目research/cp18/developer/IMPLEMENTATION.md。真实Alchemy成功不代表bounty或未来合约部署已完成。
