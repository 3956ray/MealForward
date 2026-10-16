# MealForward / 留膳 — 新 Agent 接手包

更新：2026-10-16（UTC+8）。编制依据：本次 ChatGPT 对话的用户回传证据、项目历史决定、GitHub 整合分支和交接文件。**不是正在运行的 Mac 的实时状态**。

**下载边界说明：** 本 GitHub 文件夹保存 Markdown 交接文档；`tools/cp30_maintenance_backup_gate_v2.py` 随交接 ZIP 附件提供，并**未**提交到此 GitHub 文档目录，也不会自动复制到 Mac 的 `~/Downloads`。用户必须亲自下载、确认 SHA256 后才能运行。只在用户本机操作，不要把原始 Journal、密码或配置上传 GitHub。

## 打开顺序

1. `01-AGENT-INSTRUCTIONS.md` —— 新 Agent 的常驻职责、权限门禁、证据规则；可放进 Agent 指令栏，或在新对话第一条发送。
2. `02-STATE-AND-HANDOFF.md` —— 完整产品与工程进展、已验证和未验证的成果、真实本机安全状态、当前最小下一步。
3. `03-DECISION-AND-ACCEPTANCE-LOG.md` —— 不得丢失的流程/决策、状态机、Gate G0–G6、验收门槛、跨会话同步规范。
4. `04-STARTER-MESSAGE.md` —— 新 Agent 启动后的首条任务；复制发送。
5. `tools/cp30_maintenance_backup_gate_v2.py` —— 上一轮准备的本机备份/核验脚本，只可在用户 Mac 明确保存并确认 SHA 后，按已批准阶段运行。**绝对不含启动/恢复入口**。当前用户并未证明在 Mac 保存或执行过 v2。

## 关键状态，先读

2026-10-16 用户在原 Mac CP30 实例先完成匿名只读定位：`/v1/stores` 和 `/v1/ledger` = 422 INVALID_REQUEST；`/v1/registered-stores` = 200。DB 存在唯一 `pending`、唯一 `unfinished committed checkpoint`。Journal 最后一帧为 `PREPARED #3560`。最后一帧与 DB Ticket 的八项本机只读检查 **8/8 PASS**，恢复未执行。

其后，用户在**本机尚未下载备份脚本**的情况下，执行项目官方 `connection-bootstrap stop`，返回 `OWNED_PRIVATE_HOST_STOP_REQUESTED`。**仅确认停机请求已发出，不确认六个应用进程都已退出。尚未完成 stopped gate，尚未进行 PG/Journal 备份与验证，绝不可启动/恢复。**

用户进一步授权了“受控维护准备（停机、备份和校验），真正恢复前另行批准”，也授权制作新的 Agent 来接管协作。授权**不包括**自动恢复 `COMMITTED → ACK`、重新启动六服务、发起钱包/链上签名、手工改 DB 或重发 UNKNOWN。

## 可共享与不可共享

本交接包是脱敏的上下文资料，可传给 Agent，但项目私有配置、PostgreSQL 认证文件、私钥、JWT/CSRF、原 Ticket/Proof、Journal 原文、短码和动态二维码绝不可提交至 GitHub 或上传聊天。上面的诊断结果都是脱敏用户输出，没有承载秘密。

## 持续真实来源

- Repository：https://github.com/3956ray/MealForward
- 统一整合分支：`codex/mealforward-integrated-mvp`；编制时已核对 HEAD `561b05ed24861a0afd207c2043798540d41056ef`，后续应重新查真实 HEAD。
- 账本恢复审批门禁：`docs/CP31-CP30-RUNTIME-LEDGER-RECOVERY-GATE-2026-10-16.md`
- G0–G6：`docs/CP31-INTEGRATED-MVP-ROADMAP-2026-10-15.md`
- Sites × 后端 API：`docs/CP31-API-CONTRACT-GATE.md`
- Sites 本机接入：`docs/CP31-LOCAL-SITES-INTEGRATION-HANDOFF.md`
- 原本机运维规范：`cp30-backend/docs/ZCODE-WORKFLOW-2026-10-14.md`、`.zcode/skills/cp30-ops/SKILL.md`、`cp30-backend/docs/RUNTIME-HOTFIXES-2026-10-14.md`

**不要把旧日文档中的“尚未安装 042–044”当成本机今日真相**；2026-10-14 后用户实库已经联调并热修到 044。按“本机只读事实 > 当前可信 Git HEAD > 当前交接 > 历史文档”核对冲突。