# CP20：同入口的固定测试网只读餐账

Leader已完成Dev–PM设计闭环并放行首段；产品真源为Leader项目research/cp20/pm/ANSWERS.md与developer/READINESS.md。只有15207同入口只读账及partner独立只读scope；不是发券/支付/真人钱包或四角色端到端。0广播、0新增本金、0gas。CP8实时小样本公账隐私P2仍未关闭。

## 固定边界与启动

公账仅固定CP19虚构批次，合约10143 `0x724EaB33ff67B06716913Ceb1c03581f4bBA9721`，部署块67797294；公开manifest及只读ABI在server/testnet_readonly/，ABI文件摘要固定。地址、genesis、runtime、merchant、规则、价格、上限和最终块均核验。首段只用现有Alchemy配置指针`.localbackend/alchemy/config.json`，不把URL/key传前端。读服务无signer/Worker/Runner/send方法。

```sh
# 先核18995空闲；已占用时不可接管
lsof -nP -iTCP:18995 -sTCP:LISTEN
.venv/bin/python -m server.testnet_readonly
# 18975在获批切换窗口重启同一旧库；不可运行setup或worker
.venv/bin/python -m server.local web --directory .localbackend/cp17-dynamic --port 18975 --dynamic-auth --dynamic-authority-file .localbackend/cp17-dynamic/authority-20261003-partner.json --testnet-scope-file .localbackend/cp20-testnet/scope.json
npm run dev:dynamic
```

读服务固定loopback18995，默认新`.localbackend/cp20-testnet/readonly.sqlite3`；`--database`仅供本机独立新库验证，不迁移旧库。Vite15207先代理精确testnet前缀，再将其余/api交18975。aud不变；页面切换可能需用户重新登录，不能保留token或冒称OTP已验。工作模块lazy import；公共首页/账页无SDK或钱包依赖。

私有scope.json0600、父目录0700：精确顶层version/enabled/scope/deployment/binding。scope为testnet:ledger:read；deployment包含chainId/genesisHash/contractAddress/runtimeCodeHash；binding绑定当前mappingId/revision/environment/issuer/subjectHash/actorId/partnerId/authorityVersion。仅显式partner-a获此scope；每次18975先核现有Dynamic bearer+cookie+当前mapping，再核文件绑定，读取摘要后再次核身份和scope版本；不转发Bearer到读服务。无scope403、失效401；owner未映射，写权不继承。此文件只由可信本机配置维护，不提供Web授权接口。

## API与页面

- `GET /api/v1/testnet/config`：公开白名单配置，readOnly=true、transactionsEnabled=false。
- `GET /api/v1/testnet/batches/<固定batchId>`：F/A/R/H/S精确wei字符串；余额与liability单列；source含10143/合约/finalized块/hash/成功时间；sync含独立accountingState/eventsState、scannedThrough/verifiedThrough、最近尝试/脱敏错误。`?cached=1`只读缓存，不触同步。
- `GET .../events`：固定五类事件，20条分页，cursor≤512字符并绑定部署/批次/水位/位置；不透传argsJson/券ID/私有关联/身份。未知批次404；非法参数400。
- `GET /api/v1/work/testnet-context`：仅18975先鉴权/scope；返回当前partner、只读能力、同公账摘要及受控历史来源，不补造资格/邀请/发行者归属。
- 新读服务仅GET/HEAD，其他方法405，错误脱敏/no-store/no-referrer。不会因为隐藏按钮而保留写API。

首页→`#/testnet/b/<batchId>`→partner→返回同公账；P04标测试MON、虚构测试记录、结算不证明交餐。A只叫链上未分配，非可发额度；不渲染X/L零卡。公众事件不显示时分秒/逐券轨迹/钱包持有人标签；技术折叠tx/block仍可反推出时间，隐私风险未解决。未来批次不自动公开，真人资料前另需聚合/延迟/小样本抑制及独立隐私复核。

## 有界读取、两水位与供应商限制

30秒缓存TTL；每部署单作业/文件互斥锁，多访客合并；最多2同步受理/60秒、120HTTP读取/60秒（超额429，Retry-After60）。无自动轮询/自动重试。页面首次/手动读可触发一个作业，之后最多一次31秒延后缓存读取，不继续触发同步。前端每请求8秒Abort及代次丢弃迟到结果。

每作业≤40 RPC尝试、30秒软deadline，单RPC connect≤2/read≤3/总读取6秒、1MiB、拒压缩/redirect/环境代理。底层DNS/socket并非硬实时终止，退出前保持在途，不再发新调用。每事件页≤200logs。

**2026-10-03实测Alchemy免费层getLogs拒绝256块页：HTTP400/-32600，分类FREE_TIER_10_BLOCK_RANGE；Leader已确认缩页。实际单页10块、最多8页/作业（≤80块），不提高RPC/时间预算。** 在快速出块网络上，按此预算连续扫描不能保证追齐；页面必须保留落后提示。五已知历史交易由公开manifest提供定位，均重新读取receipt、解码事件、核固定批次/券、canonical block与finalized上界；这不把连续cursor推进到事件块。全局VERIFIED只有连续范围扫描至本次资金核验块才可给出。CP19报告仅预期/定位，不是API账数据源。

资金getBatch/liability/balance在同一明确finalized块读取、守恒检查并复核block hash后原子存快照。每已核事件页与连续cursor原子提交；以tx/log唯一键去重。事件未齐允许显示带来源的金额，状态HISTORY_SYNCING；失败保留旧快照/原成功时间并标STALE，首次无数据503/占位；HALTED隐去当前金额、不清原证据。finalized不可用/倒退不降级latest。

## 重启、恢复与回滚

新库schema20与完整manifest绑定，绝不对旧CP15–17库执行迁移。重启先核已存snapshot/cursor/历史事件块身份再标健康；持久HALTED不因重启消除。复制改路径进入RESTORE_QUARANTINED，需核明后另行决定恢复，不能自动清库。新空库可从部署块重建；已知五历史事件独立回核，连续水位如实保留。

回滚：停止自己启动的18995读服务；在获批服务窗口撤新增testnet代理/导航及18975的scope参数，保留只读DB与所有证据。不要reset/setup旧库、重跑CP19或删除Envio卷；不要全仓reset覆盖其他改动。新服务和旧CP18/31337彼此独立。15207旧登录已过期则重新登录，不迁移内存凭据。

## 验证

```sh
.venv/bin/python -m unittest tests.test_testnet_readonly tests.test_testnet_readonly_auth tests.test_dynamic_auth tests.test_dynamic_contracts -q
node --experimental-strip-types --test tests/testnet/*.test.ts tests/dynamic/*.test.ts
npm run build:dynamic
```

测试使用隔离临时库和受控RPC/身份；不冒称真人认证。实际只读API/同块复查、新库重建、原生Chrome CUA桌面/390px/无SDK/离线恢复证据，以及保留旧文件hash，在Leader项目research/cp20/developer/。真实partner OTP后正例未完成时必须NOT_RUN；代码交独立审查后由Leader决定是否接受。
