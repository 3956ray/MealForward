# CP31 G1 阻塞：原 CP30 Runtime Ledger 已提交未确认的受控恢复门禁

日期：2026-10-16（UTC+8）。**决策文件，不是已执行恢复或授权执行恢复的声明。**
本文件只记录用户从原 Mac CP30 实例提供的**脱敏**只读证据，以及待审批的原生恢复流程。不得纳入任何私钥、会话 Cookie、Bootstrap 密码、完整 Ticket/Proof、Journal 内容或原始钱包签名。

## 1. 一致性证据（用户 Mac，已完成）

| 观察 | 结果 |
| --- | --- |
| 现有 `GET /v1/registered-stores` | HTTP 200 |
| `GET /v1/stores` 与 `GET /v1/ledger` | HTTP 422 `INVALID_REQUEST` |
| 已安装 `/app.js` | HTTP 200，哈希与独立 CP31 审核构建不一致 |
| `/ledger-view.mjs` | HTTP 404 |
| `c1_runtime_private.state` | 1 行，`pending` 1 行 |
| `c1_runtime_private.checkpoints` | 1 条 unfinished；其中 committed 1、aborted 0 |
| 数据库原 Pending 对应 Checkpoint | `linked_checkpoints=1`；proof_committed / state_matches_proof / pending_matches_ticket / previous_anchor_matches 全 true |
| 原有 Journal 最后一帧 | `PREPARED`、Sequence 3560 |
| 精确 Ticket 一致性八项审计 | **8/8 PASS**、`RESULT: MATCHED`、`NO_RECOVERY_PERFORMED` |
| 控制器历史诊断 | 7 次 `ledger_abort` / SQLSTATE P0001 / `ORIGINAL_RUNTIME_ABORT_CONFLICT`（历史窗口次数，尚未与本次操作建立时间关联） |

**推论的可信边界：** 已证明所检查的最后 PREPARED 帧摘要、原 Mutation/Sequence/Digest、Checkpoint、Previous Anchor 与数据库中的 Pending Ticket 完全一致，DB Proof 标记为 committed、不是 finished。尚未证明完整 Journal 从 HEADER 到第 3560 帧的每一条哈希链、所有环境/文件 pin、实际活动控制器所持内存和 journal FD、恢复前可靠备份或原链上交易最终性。

> 这里的 `committed` 表示 Runtime Ledger 的**数据库写入**有提交证据；绝不等同于 Monad 链上业务交易最终成功。

## 2. 源码审计：为什么必须走原控制器

- `cp30-backend/src/c1/runtime_ledger_controller.py` 的 `RuntimeLedgerController.begin` 即使 `read_only=True`，也先处理已存 Journal pending：向 DB `ledger_proof` 读取原提交证据，只有 `actual.committed is True` 且 `actual.ticket == journal.pending` 才允许 `journal.append('COMMITTED',...)`。否则走独立证据 Abort 分支；随后才 `_ack`。
- `_ack` 依据 Journal 所保留的 `terminal.ticket + terminal.proof + journalSequence/journalDigest` 调用固定 `ledger_finish`，DB 内 `finish_proof` 再逐字段校验当前 revision/head/material Hash、prepared_sequence/digest 和原 Proof，成功时才将 `finished=true` 并清除 `pending`。
- `cp30-backend/tools/connection-bootstrap.py` 的 **start** 会在控制器启动时显式调用 `runtime_ledger_begin({'readOnly':True})` 做验收，因此**启动不是纯只读操作，可能自动恢复并写 Journal/PG**。
- `Application.handle` 把某些 `RuntimeLedgerClosed(ValueError)` 误映射为 HTTP `422 INVALID_REQUEST`，不能把 HTTP 422 作为允许重发订单的依据。
- `RuntimeLedgerController.begin` 的恢复保护不是“无条件完成”：如 Proof/Ticket/Hash/floors/pins 任意不一致，必须按原策略失败封闭；不允许手工拼造 `COMMITTED`、直接 SQL 把 `pending` 清零或执行 `ledger_abort`。
- 工作线程自己的 RPC 观察器超时、`BUSINESS_CODEC_UNAVAILABLE` 和过期 authority grants 是**另外的**业务可用性 Gate，不能顺便绕过。

## 3. 待审批的受控恢复计划（当前全部未执行）

**Gate A — 确认当前唯一 Writer 与冻结资金操作。** 用户在 Mac 上停止发起新 Sponsor/Claim/Lock/Settle，记录原控制器、application、worker、registrar、identity、security、PG17 进程身份及启动时间；确认实际 controller 配置的 journals 路径与本次审计的 `~/.mf-cp30-20261013/ledger/runtime-ledger.jsonl` 是相同的规范文件（不输出私有配置）。确认 `HOSTS-*.json` 原安装清单、`INSTALLED.json`、`WALLET-LOGIN-INSTALLED.json` source pins、受信源码和唯一持锁控制器身份。不能用第二控制器抢 Journal 独占锁。

**Gate B — 恢复点备份并验证完整性。** 在获准的维护窗口，用原官方 `connection-bootstrap stop` 所提供的 owned PID 启停流程有序隔离六服务（**需用户明确批准**）。保留 PG17 原集群；把本机 PG 数据库用 `pg_dump` 的自描述格式备份，并备份 runtime ledger Journal、所有其他原业务签名 Journals、原私有配置与安装 manifest 至受限新目录（0700 文件系统权限，0600 文件），保持原运行目录只读不覆盖。核对文件大小/摘要、备份完整性和数据库转储可读取性；保证 PG 与 Journal 同一停止写入的逻辑恢复点。既有旧备份只是补充证据，不可替代本次恢复点。任何备份未完成或完整性验证失败 → STOP，不能启动恢复。

**Gate C — 最终不变性确认。** 在隔离状态下再次验证整条 Journal 哈希链从原 HEADER 到尾部 PREPARED #3560 的连续性、pending 原 Ticket、DB Proof 与原 Ticket/Proof/Head/Floors/Epochs 全部一致，记录当前仓库 SHA/pins、DB `pending=1` 和 unfinished committed checkpoint 恰好 1。任何差异 → STOP，不运行自动恢复。

**Gate D — 受控调用原生恢复。** 只有 A–C 均通过并已获用户批准，方由本机授权维护者通过已审查的**原官方生命周期入口**恢复控制器（不能通过脚本手工追加 Journal 或直接执行 `UPDATE`、`ledger_finish`、`ledger_abort`）。若旧控制器仍存活，必须先走官方 owned-PID 停止流程，且确认完全停下；不能对活跃控制器之外启动第二个控制器。原生恢复在 `ledger_proof` 证实匹配后追加真正 COMMITTED 帧及 DB ACK；观察失败即 STOP，保留现场，不盲目重试。官方 `start` 会按内置序列启动多个服务，事先审查是否能保持用户业务写入冻结/避免自动生成新的交易。

**Gate E — 恢复后只读验收。** 检查 DB `pending_rows=0`、待完成 Checkpoint `finished=true`，Journal 出现针对**同一原 Mutation**的正确 COMMITTED frame，anchor Sequence/Digest 归位；重新验证连续哈希链、source pins 与原历史 Intent 不丢失。对业务 API 先做最小匿名 GET 读验收，且理解 GET 仍可能触发限流和 recovery 行为。只有 Runtime Ledger 正常后才继续对 CP31 Sites `staticRoot/staticFiles` 做独立受控安装、浏览器 My Contributions / My Meals / Public Ledger 验证。此恢复不等同于资金业务可上线；云端 G2/G3 和钱包业务可靠性仍未通过。

**事故分支：** 一旦控制器启动失败、Journal 为 PREPARED 之外的新非预期状态、数据库 ACK 拒绝、Source Pin 不一致或服务停止无法确认，停止自动恢复，记录脱敏错误分类并请原权限负责人审批人工取证。**不可自动把运行时回滚到旧 DB/Journals**；链上历史与原 nonce/floors 需独立比对后才能制定恢复措施。

## 4. 访问边界和下一动作

本次网页版会话**没有用户 Mac 本机进程/DB/私有 Journal 的直接控制权限**，所有状态证明均来自用户粘贴的脱敏结果。GitHub 当前分支文档变更不会修改正在运行的 Mac CP30。用户应先明确批准受控维护窗口、备份和原官方生命周期操作；未获批准时**只继续审计，不启动恢复**。

**注意：** G1 仍然阻塞，新版 Sites 静态文件也尚未在真实 CP30 同源 origin 装载。Native Ledger 的 COMMITTED/ACK 恢复验收通过后才能解除本地读功能阻塞。
