# MealForward / 留膳 — 全量现状与下一行动（2026-10-16）

## A. 产品定义、用户决定及威胁模型

- 品牌：中文“留膳”；“留一膳，待一人。”“一膳之微，亦可为善。”；英文 MealForward。善意传递、受助者尊严，不刻意渲染贫困；东方简洁、原创、现代、高质量 Site UI。
- 业务：支持者预付→平台链上托管→受助者领取待用餐券→店家查看私人链接/短时动态 QR→Check→Lock→实际交餐并确认→MarkHandover/Report→等待 180 秒→老板钱包 Settle→链上确认金额到账；公共餐账只显示聚合，不展示私人券码。
- 角色：商家 owner、支持者、领取者、issuer、operator、settler、default admin。Operator 与商家、甚至半可信/恶意平台可以合谋；用户最终选择威胁模型 C（可信平台 / 不可信平台两类边界并存）。EIP-712 claim 授权、独立密钥与权限分离、可审计延迟结算、异常暂停、最小授权必须保留；不能承诺链上能独立证明物理出餐。平台管理员若能轻易改公钥/升级绕过，则“独立机构”不成立。
- MVP 约束：仅 1 家店、最多 3 个餐品类型/版本测试边界、原商店 lifetime 10；原 7 USDC 餐品不可被新的 0.5 USDC 草稿覆盖。测试链 Monad 10143。所有时间 Asia/Shanghai / UTC+8，取餐时段为整点或半点、结束端不含。私人领取链接优先、QR 为次，历史 CP23 私人链接 72h/动态 QR 最长 120 秒；最新运行时仍以源代码实际权限为准。
- UX 重点：支持者三步（数量/价格合计审核→approve（如需）/fund→订单及 TX 链接）；领取者一键发券/领取→My Meals 真券/有效期/短码；商家 Open Kitchen、草稿/图片/发布/上架、核销、待结算→已结算；`My Contributions` 真实订单与交易 Hash；失败操作按原 idempotency key 恢复，拒绝“假成功”与多重技术确认。

## B. 代码、服务及已证事实

**GitHub**：`https://github.com/3956ray/MealForward`

| 轨 | 位置/版本 | 确认情况 |
| --- | --- | --- |
| CP30 业务后端和合约 | 原 `main`/`codex/mealforward-cp30-handoff` 下 `cp30-backend/`、`cp30-contracts/`；参考历史 `83ccc99`/`7621a98` | Mac 有真实本机 PG17.11 + 独占 Journals；`publish,setListed,approve,fund,issue,lock,markHandover,report` 曾有确认凭证，**settle FINAL_SUCCEEDED 尚无证据** |
| CP31 UX | `codex/mealforward-simple-flows-v1` `0aeaaeb` | MetaMask 当前授权钱包优先、三步资助、一键领取、私有订单和券、商家工作台；尚未完整真实云端资金 E2E |
| CP31 Auth Pilot | `codex/mealforward-cp31-auth-pilot` `b845e72` | Render 免费 Auth-only 用户已亲自确认 MetaMask 登录成功；数据库与 CP30 原订单分离；业务写端返回 503，不能接款；仍需 G0 登出/刷新/换钱包/重放回归 |
| Render readiness | `codex/mealforward-render-free-readiness` `dc5572d` | `connection-migrations/045-live-runtime-hotfix-parity.sql` 仅隔离**新 PG**验证，不能安装到原本机实库；默认 Render 无可依赖持久 Journal |
| CP31 统一分支 | `codex/mealforward-integrated-mvp`，创建包时 HEAD `561b05ed24861a0afd207c2043798540d41056ef` | 将 Sites 静态页面复制进 `sites-frontend/dist/`，旧后端保持 `cp30-backend/`。新 Public Ledger 只读页面代码已有，当前 Mac **未安装**新版 Sites 文件 |

- 测试证据：新 Public Ledger Node 独立测试 6/6；基于旧交接 ZIP 的离线前端总测试 136/136，但**并非整合分支完整回归**；用户在 Mac 执行 13 文件 Sites preflight，返回 PASS；浏览器同源 E2E 尚未通过。本机 Mac `/v1/connection` 200、`/v1/identity/setup` 200、`/v1/registered-stores` 200、`/v1/me` 匿名 401、`/v1/stores` 与 `/v1/ledger` 422 `INVALID_REQUEST`。已装 `/app.js` 200 但与审核分支哈希不同，`/ledger-view.mjs` 404。
- API 映射文件 `docs/CP31-API-CONTRACT-GATE.md`：钱包、My Orders、My Vouchers、Payouts 等 Route 与原 CP30 live_gateway 的 DTO/Session/CSRF、原始 Intent 对应关系。绝不能将 Render Auth Pilot 的独立登录 cookie 当 CP30 钱包资金身份。
- Render 免费 Web 服务和 PG 仅用于登录 Pilot：`https://mealforward-cp31-auth-laodao.onrender.com`，免费 PG expiry **2026-11-13T19:40:36Z**（预计时间，需届时重查）；Render 闲置休眠且无可靠持久盘，不能做签名 Journal 独占写者。Vercel 旧站可能仍为 React Demo，不能拿作正式 E2E。

## C. 本机真实运行时与不可丢的证据

- 原源码目录：`$HOME/Documents/Developer/mealforward-cp29-business/cp30-backend`（六服务从这里加载代码）。原实库运行目录：`$HOME/.mf-cp30-20261013/`。PostgreSQL 17.11 只在该目录 Unix Socket，库 `c1_connection`。官方工具：`cp30-backend/tools/isolated-entry.py connection-bootstrap {stop,start}`。
- 六个应用进程的预期身份：`controller`、`security`、`identity`、`registrar`、`automatic-business`、`application`。私有进程身份源：`HOSTS-*.json`。Source Pins 和已安装 config 哈希：`INSTALLED.json`、`WALLET-LOGIN-INSTALLED.json` 等；不可自行重签。
- 2026-10-16 用户从实库只读查到：`state_rows=1, pending_rows=1`；未完成 Checkpoint 1，其中 committed=true 1，aborted 0。Pending → Ticket/DB Proof 的 `linked_checkpoints=1`、`proof_committed`, `state_matches_proof`, `pending_matches_ticket`, `previous_anchor_matches` 全 true。
- Journal 最后一帧 **`PREPARED #3560`**。用户运行脱敏 Ticket Audit 八项均 PASS（last_frame_prepared、last_frame_hash_valid、mutation_matches、prepared_sequence_matches、prepared_digest_matches、checkpoint_ticket_matches、previous_anchor_matches、proof_committed_not_finished）；输出 `RESULT: MATCHED`、`NO_RECOVERY_PERFORMED`。这并不能证明完整 Journal 历史或运行控制器 FD 一致。
- 结构化日志分类：Controller 有 7 条 `ledger_abort / SQLSTATE P0001 / ORIGINAL_RUNTIME_ABORT_CONFLICT`。Application 还存在约 1141 tasks + 705 material LIVE_STEP_FAILED、234 business_observer snapshot TOTAL_TIME_LIMIT、33 RPC eth_call timeout、7 refresh DB_UNAVAILABLE、8 auth_touch UNAUTHENTICATED；Automatic-business 有 2158 条 BUSINESS_CODEC_UNAVAILABLE。这是历史日志尾部次数，**不是对应某个 GET 的事件精确归因**。不要把旧任务噪声当本次根因、也不要无视 Controller 的恢复冲突。
- RuntimeLedgerController.begin(read_only=True) **先试图恢复 pending**；当数据库 committed 且 Ticket 与原 Journal 一致，设计应经合法 COMMITTED→ACK；失败也可能被 ValueError 捕获成 422 INVALID_REQUEST。启动原 controller 的自检可能自动写 Journal 和 DB。**禁止直接 start/尝试修复**。
- **最后用户操作，14:09 UTC+8**：尝试执行旧维护工具（没有下载到 Mac），所有 SHA/preflight/stopped/backup/verify 都因脚本文件不存在失败；随后**手动运行官方** `connection-bootstrap stop`，返回 `{"status":"OWNED_PRIVATE_HOST_STOP_REQUESTED"}`；又尝试 stopped/backup/verify 均因工具仍不存在失败。由此：已请求停机，不代表完成；尚无新备份；恢复未执行。用户后来仅授权了创建继任 Agent。**不要把备份、完整 Hash 链、停机确认或恢复说成 PASS。**
- 上一轮交付了修正版 `cp30_maintenance_backup_gate_v2.py`，文件存在于原 ChatGPT 会话的下载附件，但不会自动出现于用户 Mac `~/Downloads`。核对 SHA256：`1275536e6cf9e1482c496a1bd9643cad88edf78760dbe00e11e5fd5722270e05`。它只提供 `preflight`, `stopped`, `backup`, `verify`，不含官方 `stop/start/restore`，并且假设原源码/目录布局存在。用户尚未报告下载或成功执行。继任 Agent应再做安全审查并确保来源可信。

## D. 当前受控维护权限与下一动作

用户批准**受控维护准备**：检查原六服务身份、官方停机、备份与校验。此前官方 STOP 已被用户自行执行；**不要再次停止**，除非先核对当前事实且得到新的明确授权。用户要求“真正恢复前再次确认，不要跳过安全门”。

建议按顺序：

1. 暂停所有钱包资助、发券、核销、结算、发布等写流程，通知其他同仓本机 Agent 不碰原服务/实库；禁止改运行时文件与 Source Pins。
2. 让用户明确在 Mac 下载本接手包中的 v2 脚本（或原已提供的沙盒附件）到可信路径。对照上述 SHA，然后**仅执行** `/usr/bin/python3 <path> stopped`；这一步仍需确认六服务确实已退出、HTTP 16443 不在监听、其他 PG client 连接为 0、PG 依旧存活。任何失败停止，不能蛮力 kill。
3. 若 `STOP_GATE: PASS`，再指导脚本的 `backup` 操作；备份目录新建、权限 0700/0600，包含 pg_dump -Fc、pg_dumpall globals、所有 Journals/配置/安装清单/原本机源代码引证，绝不直接复制在线 PG data dir 或上传 GitHub。脚本实际行为先审查，不得假设成功。
4. 从脚本返回的真实 Backup Location 执行 `verify`；要求完整 Journal 从 HEADER 到 #3560 连续 SHA256、原 PREPARED Ticket/Proof/Head/Epoch/Floors 与 DB 不变、pg_restore 对 dump 可解码、所有复制文件 SHA 一致。没有完整从零恢复测试时明确说“归档格式校验”，不是灾难恢复实测。
5. 备份验证后仍保持停机，更新审计记录；向用户**单独请求**启动和真正原生 `COMMITTED → ACK` 恢复授权。成功后 `pending_rows=0`、`finished=true`、Journal 原 Mutation 的 COMMITTED frame/新 anchor 一致，原业务查询恢复，再受控装新版 Sites，同源 My Contributions/My Meals/Public Ledger E2E。
6. 回滚不能简单拿旧 PG/Journals 覆盖运行时；必须考虑原链 Tx、nonces、Source Pins、已提交但 ACK 未确认的操作。出现非预期状态 STOP 取证。

## E. 业务安全技术债（不能因为账本恢复被遗漏）

- CP30 原本机 hotfix（用户实库已修改，源码中部分未回填）：043 的 `first_binding_material` 对 auto_binding 缺 GRANT；catalogAuthority `ledger_reserve` publish/setListed whitelist；过期 Fund Quote 容量过滤；原僵尸 lock 过期处理与 Journal Re-anchor；代码层 observer ABI / approve r/s 前导零修复。详见 `cp30-backend/docs/RUNTIME-HOTFIXES-2026-10-14.md`。不要直接重跑历史热修、盲目覆盖 042–044。
- Session 30 分钟失效使 pending intent 孤儿；Worker 每次 RPC spawn 子进程 (~2 秒)，25+ 调用易触 45 秒预算；120 秒窗口在排队下易超期；Journal 原 16MB→64MB 仍缺轮转；Authority Grants 在 2026-10-14 北京时间到期（要重新审查才可续）；真实老板结算尚无最终成功证据。
- 合约 / Trust Boundaries 是另一个安全 Gate：链上只约束签名授权、资金、状态与结算，不会凭空证明真实出餐。对平台恶意与商家合谋必须列出残余风险和升级/管理员权限限制。

## F. 完整工作范围与交付

用户最终目标不是暂时修好 422，而是完成上线可用的 MealForward：老板自助建店、支持者付款、受助者领券、到店扫码核销、老板结算、公开账本、真实资金/交易 Hash 和隐私权限。按照 G0–G6 并行做安全的 UI/代码/测试工作，但在恢复门禁前不触及真实资金写操作。前端需在视觉层次、排版、留白、色彩、动效、微交互、响应式和原创性上达到 Awwwards/Webby/FWA 优质网站要求；同时保证清晰易用而非炫技。全部优先免费资源；如果免费的 Render 不能安全承担持久 Journal，保持 Auth/只读，不为了“上线”牺牲一致性。

## G. 进度记录模板（每次更新）

- 日期 / 时区、仓库 branch+HEAD、当前真实本机证据时间
- Gate 编号及状态 `NOT_STARTED / IN_PROGRESS / BLOCKED / VERIFIED`
- 本轮已做（代码、测试、工具返回）与对应 commit
- 尚未完成 / 可证伪的假设 / 显式风险
- 谁可以执行哪一步及本次用户批准范围
- 下一个最小动作、停止条件、需要的下一次单独批准

**停止条件总原则**：Source Pins 不匹配、Journal 完整性不一致、PG 未确认停止写入、停机期间仍有活跃原业务进程、备份缺失、checkpoint 不自洽、超出用户明确授权 → 停止操作、保留现场、只报脱敏结果。