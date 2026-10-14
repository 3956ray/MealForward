# 运行时热修复记录（2026-10-14 凌晨联调）

接手后完成 042–044 安装、catalog provision 与新餐发布→支持→领取→核销的真实联调。
期间发现并修复了 8 个只有真实运行才暴露的缺陷。代码侧修复见本次提交；**DB 侧修复
直接应用于运行目录的 owned PG（c1_connection），不随代码提交**，记录于此。

## 代码侧（本次提交）

1. `integrations/business/rpc_transport.py`
   - SEND_ABI 白名单补 catalog 操作：publish `0x5e88339b`（12 词）、setListed
     `0x55e80d27`（4 词）
   - `operationPayloadHash` 的 kind→role 映射补 `1/2 → catalogAuthority`
   - 否则 observer 的 RPC 会话瞬时拒绝（BUSINESS_RPC_ORIGINAL_REJECTED /
     BUSINESS_RPC_ARGUMENT_REJECTED），publish/setListed 永远无法被链上确认。
2. `integrations/wallet/approval-codec.mjs`
   - secp256k1 签名 r/s 允许前导零被剥离的 63 位 hex，左补零到 64 位。约 50% 的
     钱包签名会触发；原先直接 APPROVAL_CODEC_REJECTED，approve 永远无法确认。
3. `src/c1/runtime_ledger_controller.py`
   - journal 文件上限 16MB→64MB。1635 条历史自然增长到 16.8MB 触发
     EXTERNAL_JOURNAL_LIMIT，controller 拒绝加载，全部服务无法启动。
     （该文件不在 WALLET-LOGIN sourcePins 覆盖范围内。）

## DB 侧（仅存在于运行实例，重装全新库时需按此重放）

4. `GRANT EXECUTE ON FUNCTION c1_runtime_internal.first_binding_material(text,jsonb)
   TO c1_auto_binding` —— 043 重建该函数时漏授权，worker 每 2.2s permission
   denied，草稿保存 503 DB_UNAVAILABLE。**043 文件本身待上游修复并重 pin。**
5. `c1_runtime_internal.ledger_reserve` 角色白名单补
   `(a.role='catalogAuthority' AND operation IN('publish','setListed'))` —— 否则
   预约写事务被 PRIVATE_OPERATION_FORBIDDEN 拒绝，publish 死锁 UNKNOWN。
   **runtime-ledger.sql 待上游同步。**
6. `c1_runtime_internal.live_api` 的 CAPACITY 公式排除 quote 已过期的 fund
   intents（`signed_quote IS NULL OR deadline > now`）——9 条废弃单永久占满
   lifetime 10 的容量，新支持被 CAPACITY 拒绝。
7. 僵尸 lock intent `f6c9a7cb` 终结为 FINAL_REVERT（reason:
   OPERATION_WINDOW_EXPIRED_PRE_SIGNING；零签名、零交易，DB 内可证）并释放
   lease —— worker 排队错过 120 秒窗口的 intent 永远 UNKNOWN，把券锁死。
   **上游需要"预签名过期自动退役"设计。**
8. 账本重锚：上述旁路写入后按协议补了规范的 journal PREPARED+COMMITTED 对与
   state/checkpoints 行（rev 817→818）。**教训：任何覆盖 material() 输出行的
   直接 SQL 都必须随后重锚，否则 finish_proof 全线失败。**

## 联调结论（链上证据）

- 新餐发布：publish `0xe7855991…`、setListed `0x6bc3edac…` 均 FINAL_SUCCEEDED，
  catalog_versions=LIVE
- 支持：approve `0x456c90a6…`、fund `0x0070da04…`（1.5 USDC / 3 份）
- 领取：issue `0x53e13a98…`（新钱包 0xC9a0…728A）
- 核销：lock `0xd16cdd17…`、markHandover `0x6270107b…`、report `0xfb082c13…`
- 结算：待执行（owner 钱包签名）

## 已知设计缺口（赛后修复清单）

- intent 与创建时会话绑定，重新登录即吊销会话 → pending intent 永久孤儿
  （admit UNAUTHENTICATED），无恢复路径
- worker 观察器每 RPC 请求 spawn 一个 Python 子进程（≈2s），25+ 调用逼近 45s
  总预算；队列有积压时新 intent 赶不上 120 秒操作窗口
- journal 无轮转/压缩机制，只能上调上限
- 前端错误路径的补偿登出会吊销服务端会话，与上面的会话绑定组合放大故障
