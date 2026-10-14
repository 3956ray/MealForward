---
name: cp30-frontend
description: MealForward 前端轨（React/Vite，仓库根 src/）的开发边界、接口依赖与验收方式。当任务涉及前端页面、组件、UI、API 对接、浏览器验收、localhost:16443 时使用；与 cp30-backend / cp30-contracts 轨并行工作时不越界。
---

# CP30 前端轨

## 本轨身份与文件边界（并行开发的纪律）

- **拥有（可写）**：仓库根 `src/`、`index.html`、`vite.config.ts`、前端相关 `tests/`
- **只读消费，不可改**：
  - `shared/MealForward.abi.json`、`indexer/abis/MealForward.abi.json` —— ABI 属合约轨，改它需合约轨确认
  - `/Users/mili/.mf-cp30-20261013/chain-profile-public.json` —— 链上地址/genesis/asset 登记册（运行时产物），前端只读
  - `cp30-backend/**`、`cp30-contracts/**`、根 `server/`、`contracts/`（历史模拟服务与旧 Anvil 合约）—— 完全不碰
- `src/api.ts` 和 `src/chain-contract.ts` 是前端对另外两轨的接口视图；这两文件里**预期**变了，说明接口契约变了 → 停下走接口变更流程（见下），不要单方面适配了事

## 设计风格规范（必须遵守，不可自创视觉语言）

**真源（冲突时优先级从高到低）**：
1. 用户当前会话给出的新设计稿/明确指示（若有 Figma 等，先让用户提供并更新本节）
2. `/Users/mili/Documents/Developer/mealforward-site-source-audit/DESIGN-REVIEW.md` —— 正式设计评审，20 条标准 + 每个表面的目标/层级/交互/响应式要求
3. 根 `src/styles.css`（197 行）—— 业务/测试网 UI 的 token 与组件类真源
4. `mealforward-site-source-audit/ASSET-PROMPT.md` —— 生成素材（照片/插画）的画风基准

**视觉系统（DESIGN-REVIEW 定义）**：暖象牙白底、森林绿、克制的陶土橙；中文衬线展示字体（`Noto Serif SC`）配可读无衬线正文（`Nunito Sans` + `PingFang SC`）；碗形品牌标、「留一份」圆形印章、餐券（meal-ticket）视觉语言；照片传达日常食物的滋养感。

**styles.css 已落地的 token（新样式从这里取值，不发明新值）**：
- 底色：`#fbf8ef`（径向渐变 `#fffdf6→#fbf8ef→#f7f1e4`）、面板 `#fffdf7`、边框 `#e6d9c6`/`#cdb9a9`
- 主行动色：朱红 `#c9222b`（hover `#a81720`）、标题深红 `#64121b`、链接 `#a8161d`
- 文字：主 `#352d28`、弱化 `#776e65`；通知：错误 `#fff0ee/#8b1822`、成功 `#edf7eb/#2e6036`
- 圆角：输入 9px、按钮/通知 10px、面板 18px、胶囊 999px；阴影用暖色调透明色（如 `0 10px 32px #5f3b2410`）
- 布局：外壳 max-width 1300px、双栏 `page-grid`（主列 + 340–460px 侧栏）、窄页 `narrow-page` 850px

**硬规则**：
- 新页面/组件**必须复用既有类体系**：`.panel(.empty)`、`.button(.secondary/.subtle/.full)`、`.button-row`、`.field`、`.notice(.error/.success)`、`.quote-row`、`.eyebrow/.micro/.fineprint`、`.page-grid/.narrow-page`——先读完 styles.css 再动手
- 不引入新字体、新 CSS 框架/UI 库；`.meal-scene` 那套纯 CSS 食物插画是既定插画语言，可参考其手法
- 文案语气（DESIGN-REVIEW）：邻里口吻、朴素感谢、不评判措辞；**不虚构** testimonials、受益人故事或"已上链"宣传
- 每个新表面对照 DESIGN-REVIEW 表格里的对应行做验收（层级/交互/响应式/独特细节四栏）

## 接口依赖（另外两轨提供什么）

1. **后端 HTTP API**（`https://localhost:16443`，application 服务）：动作语义、错误码、草稿/review/publish 状态机
2. **链上层**（经 ABI + chain-profile）：chainId 10143、USDC 资产 `0x534b...43a3`（decimals 6）、catalog/escrow 调用

## 前端已知地雷（联调前自查）

- **必须精确 `https://localhost:16443/`**：用 `127.0.0.1` 或直开 API 路径 → ORIGIN_DENIED（后端 http.py 严格校验 Host/Origin/sec-fetch-site）
- **review 窗口只有 300 秒**：开着 Review 对话框超 5 分钟确认 → 422 STALE_REVIEW；无残留、重新点 Review & publish 立即确认即可
- **会话 1 小时 TTL**："owner records could not be refreshed" → 重新钱包登录
- 后端偶发 503 DB_UNAVAILABLE 是后端轨问题（缺 GRANT 类），前端不要试图重试掩盖，如实报错

## 验收方式

1. `npm run build`（或项目 README 已验证命令）通过
2. 浏览器实测 `https://localhost:16443`：登录 → 草稿 → Review & publish（300s 内确认）→ 查看发布状态
3. 移动/桌面两个视口过一遍（项目规则）
4. 涉及钱包签名的步骤，提示用户操作并等确认

## 接口变更流程（动了接口就要走）

改 `src/api.ts` 的预期、或发现后端行为与前端假设不符时：在交接文档记一条「接口变更请求」（改什么、为什么、影响哪轨），由用户/后端轨确认后再改代码。禁止前端单方面吞掉语义差异。
