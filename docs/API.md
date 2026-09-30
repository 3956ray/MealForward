# CP8 本地模拟接口约定

所有请求同源 `/api`，仅回环本机。所有数据虚构。私有操作使用 `Authorization: Bearer <token>`；前端通过 `POST /api/session {"actor":"supporter|partner|staff_a|staff_b|settler|admin"}` 显式选择**假角色**，得到 `{token,actor,role}`。选择角色是演示用，非真实认证。领取者通过私密邀请 URL 的 fragment 进入：`/#/P05/<secret>`；页面先清除地址栏的 secret，只在本次内存保留，用户点“查看餐券”后才 `POST /api/invite/exchange {secret}` 得到 `{token}`。刷新或返回不自动重开旧码。请求日志不记录正文。

`GET /api/state` 返回 `{brand,shop,batch,events,paused,work}`。公共字段对所有会话相同：`shop` 为虚构店/标准餐/机构/联系，`batch` 为单批整数 DU 字段 `F,A,R,H,S,X,L,available,price,rule_version,updated_at`；公开 `updated_at` 只保留上海时区的日期精度，避免单券动作精确时间可关联。`events` 仅公开批次支持/暂停摘要，不公开逐券发行、申报或结算事件时间。`work` 随 token 角色变化：

- `supporter`: `{operations,cases}`，仅该支持者的模拟操作与自己的咨询阶段。
- `partner`: `{recipients,vouchers,cases}`，包含本机构私有领取关联、资格/渠道与邀请码。示例 ref 有合格/不合格、未核渠道、额度已用完。
- `staff_a|staff_b`: `{redemptions,payables,cases}`，只含本店所需券/锁/申报及本人案件阶段，绝不含领取关联、资格、交付渠道或邀请 secret。
- `settler`: `{payables}`，本店 H/S 与结算操作。`payables` 的每项含 `voucher_id,status,report_operation,settlement_operation,settlement_status,created_at`，明确失败 `FAILED` 可在查询原操作后安全重试；`UNKNOWN` 不可重试。
- `admin`: `{pause}`，只读预设暂停信息。
- 未带角色 token：`work:null`。

`GET /api/voucher` 使用领取 token，只返回当前单券的门店/餐/时段/状态、短时在线码和求助阶段；若申报未知/已处理则不返回可兑码。`GET /api/voucher/status` 只读返回该单券 `{status,delivery_status,paused}`，不重发码、不包含领取关联或邀请；持券页可用它察觉他处锁定、交付变化或暂停后卸载旧码。`GET /api/operations/<id>` 依角色/所属 scope 访问原操作；无权限返回 403。

写操作统一 `POST /api/act`；始终由服务端检查 token、角色、作用域和状态。成功 JSON 包含 `message`、可选 `operation`、`voucher`；出错 JSON `{error,code}` 和相应 HTTP 状态。客户端收到结果后重取 `/api/state`，不从本地直接改资金。每个可能重试的写动作带稳定 `intent_key`，服务端返回原结果，不重复状态变更。

| `action` | 主要字段 | 结果/权限 |
|---|---|---|
| `support` | `quantity`, `quote_price`, `rule_version`, `intent_key`, `outcome=success|unknown|failure` | supporter；价格/规则快照须匹配当前批次，成功增加 F/A 并返回 operation；未知不入账，同键只查。 |
| `issue` | `recipient_ref`, `intent_key` | partner；有效资格、本期额度、渠道已核、A−L 足、未暂停才 A→R，建单份券/原操作。 |
| `deliver` | `voucher_id`, `method=sent|handover|failed|reshare`, `intent_key` | partner；失败/再分享保原券与 R。 |
| `acknowledge` | `intent_key` | recipient；只记录持链接者主动声明，不证明指定自然人收到。 |
| `precheck` | `code` | staff；只读、不得取得锁；返回最少可见 `check`。 |
| `lock` | `code`, `intent_key` | staff；唯一占用，返回待显式确认的 operation。 |
| `confirm_lock` | `operation_id`, `intent_key` | 原店员；显式本地确认后才可交餐。 |
| `handoff` | `voucher_id`, `intent_key` | 持确认锁的店员；记录“店员声明已交餐”，R 不变。 |
| `report` | `voucher_id`, `intent_key`, `outcome` | 原店员；成功 R→H；未知保 R/锁，仅查原操作。 |
| `settle` | `voucher_id`, `intent_key`, `outcome` | settler；成功 H→S；失败/未知保 H。 |
| `case` | `kind`, `voucher_id?`, `text?`, `intent_key` | 相关角色受限求助；普通咨询不动 L。 |

`POST /api/reset {"scenario":"normal|paused"}` 只供本机演示重置虚构样例；会清空旧假会话。`paused` 预置暂停，拒绝新入款/发行/新锁/新付款，保旧 R/H 演示数据，原操作仍可查询。P13 本轮不提供可写暂停/恢复。

状态文案严格区分“机构已执行发送或交接”“持链接者自称收到”“店员声明已交餐”“已模拟结算”；不得显示“指定本人已收到/吃完”。
