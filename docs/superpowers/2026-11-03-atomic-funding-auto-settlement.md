# V3 单次资助确认与常驻自动结算

## 状态与边界

当前公网仍为 Product V2（75e207f）；本轮源码实现不等于公网发布。V3 合约及工具已在隔离测试链验证；`product-v3/approved-deployments.json` 在用户部署并核验前保持空。旧合约和餐款不迁移。真实 MetaMask/10143 原子批处理需要审核过的官方账户实现 pin 和真人确认验收；默认没有 pin，前端明确显示两次确认，不能宣称已实现所有钱包单次付款。

## 实现

- 新 ProductEscrowV3 保持既有资助/领取/验券接口，保留 180 秒；settle 可由任何人触发，receiver 由不可变商家归属得到，调用者不能改收款人。旧 Solidity 文件保持字节不变。
- 原子付款精确 approve 本次金额+fund，官方 DeleGator execute(DEFAULT batch)入口，仅允许已核验账户实现。walletBatchId 与链 batchId 分开。链上 receipt/log/原请求/getBatch/Transfer/Funded/canonical 证据共同确认，不能按剩余 allowance 判定失败。
- 结果未知只查询原批次；换设备丢钱包 Hash 可由资金索引找候选后再次完整验证。普通占位 nonce 取消不适用于原子批次。只有最终链时间超过原 deadline 且精确原请求不存在，才能显式解除该过期操作。
- platformOutbox 在共享根状态事务锁内串行协调各目标 Claim/自动结算；签名包先落盘、广播前 admission 落盘，未知不换 nonce。原交易最终 REVERTED 且仍未交付餐款时，保存 attempt 后限次退避重试（最多三次重试），旧回执不能覆盖下一 attempt。
- worker 独立常驻，扫描最终交餐状态补齐队列；每笔支付前重新验证状态/时间/收款人/预算。余额与费用检查阻止不具备条件的新签名；诊断仅输出聚合积压/余额不足和心跳，不输出钱包或原始签名。扫描链日志按 Monad 10 块上限分页并保留规范块游标。
- 多目标记录以 chainId:escrow 隔离，同一根库保存，不新建资金库；无版本历史数据固定解释为旧目标。领取冷却/未决领取及平台 nonce 跨版本共享；恢复作业轮流处理目标，某目标故障不阻塞其它目标恢复。
- 页面可切换新版业务与历史订单；长期餐券链接携 target query，无 target 的旧券链接归历史目标。服务端仅接受已核验目标的入口 query。切换清理临时私密界面并复核原钱包会话；已资助旧餐券继续 Claim，旧商家仍手动结算。

## 运行命令与托管费用

- 新 web/worker 共用入口：`node t1-intents/product-v3/server-entry.mjs`。`MF_PRODUCT_PROCESS_ROLE=web` 只提供页面/API；`worker` 只拉取并执行任务，不监听公网端口。持久队列复用专用 PostgreSQL state 根行锁，不增加 Redis。
- 继续复用现有专用数据库、会话 pepper 和签名配置；不得打印 DSN/私钥。旧的 `MF_PRODUCT_MANIFEST` 保持旧部署 pin；新增已核验 V3 manifest 写入仓库允许列表；`MF_PRODUCT_ACTIVE_TARGET` 必须匹配允许列表。
- 新 worker 建议 Render `0.5c-512mb`（旧名 starter）、单实例、Singapore、手动部署。2026-11-03 官方报价为约 US$7/月计算实例费用；既有 web/数据库维持原方案。税费、流量超额、RPC/数据库升级另计；不是总账单报价。测试网 MON Gas 与托管费分开。
- 未创建收费服务。创建前向用户列出实际配置与费用。官方依据：https://render.com/pricing 、https://render.com/docs/compute-plans 、https://render.com/docs/background-workers 。

## 发布与回退步骤

1. 完成候选全套测试、独立审查和 CI。V3 创建代码/构造参数/固定角色及费用上限由部署审核工具校验。
2. 本机执行 `node t1-intents/product-v3/review-server.mjs`，仅监听127.0.0.1；用户本人用MetaMask部署。未知结果只查询原部署，不再次创建。核验原交易后得到 VERIFIED_CANDIDATE_NOT_APPROVED manifest，再追加允许列表；不让浏览器直接修改生产允许列表。
3. 首先将旧 web 停止旧后台签名：暂停服务并确认旧执行进程退出，核查原SIGNED/UNKNOWN包。新 worker 不得与旧版 tickClaims 同时运行，旧代码不认识新共享 outbox。不能只设置字符串就冒称完成交接。
4. 切换到新 dual-target web，初始 active target 可保留 legacy；设置 `MF_PRODUCT_LEGACY_WORKER_STOPPED=true` 表示运维已经完成真实交接。新 worker 先恢复旧包，再承接新任务。若旧未知包尚未最终确认，保持全局 nonce 阻塞。
5. 新目标隔离登记/资助/领取/交餐/自动结算用真实钱包验证后开放新资助。旧库存保留原目标，旧领取和手动结算继续。未验证账户 pin 一律显示两步付款兼容模式。
6. 新入口默认关闭资助；隔离环境验收用 MF_PRODUCT_NEW_FUNDING_ENABLED=true，回退置 false。回退只关闭新资助，继续识别两个目标及完成已存在任务。不能回退到无法识别 V3 状态或不认识共享 outbox 的旧程序。平台签名停止时保留原包和 Hash，不删除任务/库存。

## 尚需真人/外部环境验收

- 用户部署 V3 新合约及提供原交易Hash；允许列表尚无新实际地址。
- 选定且允许费用的常驻 worker 服务，真实密钥组/专用DB配置引用、旧worker停机交接、发布后心跳与恢复核验。
- 实际 MetaMask 在10143上的批处理能力/官方实现审核及付款；当前没有代替用户升级账户，也没有生产pin。
- 新版真实钱包交餐后关闭网页，180秒后核验平台付Gas及商家收到USDC；本地Anvil成功不能替代这一项。

真实钱包限制：Monad 测试网已查到 MetaMask DeleGator 1.3.0 地址 0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B 的代码，哈希 0x399646560cadf8e8f30b232c75d0be4e629939b4eba8019589c6d0d4b69ff9f9；已提供的三个账户当时的代码都为空。公开部署地址不能证明钱包会发出当前验证器支持的交易形式。不得仅凭此信息配置生产允许列表；须先验证真实钱包的调用及最终收据。
