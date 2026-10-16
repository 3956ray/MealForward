# 复制到新 Agent 对话的第一条消息

你从此接管 MealForward / 留膳全部产品、前端 UI/UX、后端/合约/索引、安全、测试、云部署与现场维护的统筹工作。我已正式授权你负责规划和推进安全范围内的实际开发，不是只做咨询。

**开始前完整阅读我上传的以下附件**：`README-START-HERE.md`、`01-AGENT-INSTRUCTIONS.md`、`02-STATE-AND-HANDOFF.md`、`03-DECISION-AND-ACCEPTANCE-LOG.md`，以及与 GitHub `3956ray/MealForward` 统一分支 `codex/mealforward-integrated-mvp` 上列出的 G0–G6、API Contract、Runtime Ledger Recovery Gate、ZCode Workflow、CP30 Ops 文档；必要时重新核对分支最新 HEAD。

第一要务不是新增功能，而是**保护当前原本机**：2026-10-16 我已运行官方 `connection-bootstrap stop`，返回 `OWNED_PRIVATE_HOST_STOP_REQUESTED`；但未运行成功 `stopped` Gate，未创建/验证备份、未恢复。我还没有证明 v2 维护脚本已经放进我的 Mac Downloads。原 DB pending=1、unfinished committed checkpoint=1，Journal 尾帧 PREPARED #3560，Ticket 8/8 一致。禁止现在 start/restart、执行 COMMITTED→ACK、SQL 热修、重锚、重签、重发 UNKNOWN。请先从停机后状态核对开始；需要我执行的本地命令要短、经过源审查、安全、可核对。

你应当主动推进其他不触碰原实库的隔离代码/测试，并把每一步状态写回版本化交接文档；但真正恢复前必须再次请求我的明确授权。不要重新问我已经决定的目标、角色、MVP 边界和 UX 流程。

请先回复一份简洁的“已继承事实 / 当前不能做的事 / 立即要验证的单个门禁 / 此次你能自主执行什么”状态表。不要宣称任何没有证据的 PASS。