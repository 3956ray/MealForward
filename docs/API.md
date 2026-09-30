# CP8–CP11 本地模拟接口约定

所有请求同源 `/api`，仅回环本机。所有数据虚构。私有操作使用 `Authorization: Bearer <token>`；前端通过 `POST /api/session {"actor":"supporter|partner|staff_a|staff_b|settler|admin"}` 显式选择**假角色**，得到 `{token,actor,role}`。选择角色是演示用，非真实认证。领取者通过私密邀请 URL 的 fragment 进入：`/#/P05/<secret>`；页面先清除地址栏的 secret，只在本次内存保留，用户点“查看餐券”后才 `POST /api/invite/exchange {secret}` 得到 `{token}`。刷新或返回不自动重开旧码。请求日志不记录正文。

`GET /api/state` 返回 `{brand,shop,batch,events,paused,work}`。公共字段对所有会话相同：`shop` 为虚构店/标准餐/机构/联系，`batch` 为单批整数 DU 字段 `F,A,R,H,S,X,L,available,price,rule_version,updated_at`；公开 `updated_at` 只保留上海时区的日期精度，避免单券动作精确时间可关联。`events` 仅公开批次支持/暂停摘要，不公开逐券发行、申报或结算事件时间。`work` 随 token 角色变化：

- `supporter`: `{operations,cases}`，仅该支持者的模拟操作与自己的咨询阶段。
- `partner`: `{recipients,vouchers,issuances,cases}`，包含本机构私有领取关联、资格/渠道及原发行结果，默认不含邀请码。示例 ref 有合格/不合格、未核渠道、额度已用完。
- `staff_a|staff_b`: `{redemptions,payables,groups,cases}`，只含本店所需券/锁/申报、本人处理组及案件阶段，绝不含领取关联、资格、交付渠道或邀请 secret。
- `settler`: `{payables}`，本店 H/S 与结算操作。`payables` 的每项含 `voucher_id,status,report_operation,settlement_operation,settlement_status,created_at`，明确失败 `FAILED` 可在查询原操作后安全重试；`UNKNOWN` 不可重试。
- `admin`: `{pause}`，只读预设暂停信息。
- 未带角色 token：`work:null`。

`GET /api/voucher` 使用领取 token，只返回当前单券的门店/餐/时段/状态、短时在线码和求助阶段；若申报未知/已处理则不返回可兑码。`GET /api/voucher/status` 只读返回该单券 `{status,delivery_status,paused}`，不重发码、不包含领取关联或邀请；持券页可用它察觉他处锁定、交付变化或暂停后卸载旧码。`GET /api/operations/<id>` 依角色/所属 scope 访问原操作；无权限返回 403。

写操作统一 `POST /api/act`；始终由服务端检查 token、角色、作用域和状态。成功 JSON 包含 `message`、可选 `operation`、`voucher`；出错 JSON `{error,code}` 和相应 HTTP 状态。客户端收到结果后重取 `/api/state`，不从本地直接改资金。每个可能重试的写动作带稳定 `intent_key`，服务端返回原结果，不重复状态变更。

| `action` | 主要字段 | 结果/权限 |
|---|---|---|
| `support` | `quantity`, `quote_price`, `rule_version`, `intent_key`, `outcome=success|unknown|failure` | supporter；价格/规则快照须匹配当前批次，成功增加 F/A 并返回 operation；未知不入账，同键只查。 |
| `issue` | `recipient_ref`, `quantity`, `batch_id`, `quote_price`, `rule_version`, `intent_key` | partner；N=1–20整数，同事务核资格/渠道/额度/预算/报价/暂停，N张全建才A→R，返回operation及issuance。同键改关键参数拒绝。 |
| `deliver` | `voucher_id`, `method=sent|handover|failed|reshare`, `intent_key` | partner；失败/再分享保原券与 R。 |
| `acknowledge` | `intent_key` | recipient；只记录持链接者主动声明，不证明指定自然人收到。 |
| `precheck` | `code` | staff；只读、不得取得锁；返回最少可见 `check`。 |
| `group_create` | `intent_key` | staff；新建本店本人处理组，operation.target为组ID，不拿锁不改账。 |
| `group_add` | `group_id`, `code`, `intent_key` | 原店员；重验当前有效码并显式加入该组，不存码、不拿锁不改账，同券在组内只计一次。 |
| `lock` | `code`, `group_id?`, `intent_key` | staff；若传组ID须为本人且含该券，仍须当前有效码；唯一占用，返回待显式确认的operation。 |
| `confirm_lock` | `operation_id`, `intent_key` | 原店员；显式本地确认后才可交餐。 |
| `handoff` | `voucher_id`, `intent_key` | 持确认锁的店员；记录“店员声明已交餐”，R 不变。 |
| `report` | `voucher_id`, `intent_key`, `outcome` | 原店员；成功 R→H；未知保 R/锁，仅查原操作。 |
| `settle` | `voucher_id`, `intent_key`, `outcome` | settler；成功 H→S；失败/未知保 H。 |
| `case` | `kind`, `voucher_id?`, `text?`, `intent_key` | 相关角色受限求助；普通咨询不动 L。 |

`POST /api/reset {"scenario":"normal|paused"}` 只供本机演示重置虚构样例；会清空旧假会话。`paused` 预置暂停，拒绝新入款/发行/新锁/新付款，保旧 R/H 演示数据，原操作仍可查询。P13 本轮不提供可写暂停/恢复。

状态文案严格区分“机构已执行发送或交接”“持链接者自称收到”“店员声明已交餐”“已模拟结算”；不得显示“指定本人已收到/吃完”。

## CP11 恢复与迁移

- `GET /api/issuances/<operation_id>` 或 `/api/issuances/by-intent/<intent_key>`：仅机构授权actor，返回 `{issuance:{operation,request,vouchers}}`。request为原始ref/N/batch/price/rule快照，vouchers不含secret。404不能当作未提交或可重发证据。
- `GET /api/partner-invite/<voucher_id>`：仅机构active券，返回单个 `{id,secret}`。P08默认收起、逐券主动展示。为兼容单券客户端，N=1首次issue及既有deliver仍可返回单券 `voucher:{id,secret}`；不是秘密合集接口。
- `GET /api/groups/<group_id>`：仅本店原staff_actor，返回 `{group:{id,created_at,items}}`。items只含主动加入的voucher_id/status/owned/lock_confirmed；他人取得锁的项显示unavailable，不泄露他人原操作。无ref、机构发行ID、邀请或短码；组ID不授读取权限。
- 未锁项刷新为needs_code，必须重新出示有效码。组ID/voucher_id不能代替码。已锁/交餐/申报依服务端恢复，不提供移出组抹责任。
- 发行不增加合成服务端UNKNOWN，客户端POST丢失/GET失败先保存原意图并只读查回结果。相同ref/batch的本标签页待核未解除时不创建新意图；未查到继续待核。服务端同键参数绑定及事务防重复，不宣称不同设备不同意图恰好一次。
- report/settle/lock本地待核先于POST持久化；核对同intent/actor/action/target的原操作与新state才解除。明确FAILED后可显式新试；lock待显式确认可恢复确认控件。
- 新表issuances、issuance_vouchers、processing_groups、processing_items为增量schema。启动不更改旧七张表，仅把历史成功单券发行关联为数量1的结果。新normal种子REF-A额度3，已有额度不自动修改。
