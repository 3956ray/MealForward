# Kitchen 真实接口交接

2026-10-13，供总 Leader 与前端实施使用。当前运行模式为
`CP30_TESTNET_CONNECTION`。已部署原店与首餐继续保留；恢复 UI 不等于
新增、编辑、发布、上下架已全部接通。本文新增草稿源码尚待 Leader 应用 031
并完成真实会话验收，不代表已在现有运行环境启用。

## 已有能力与老板边界

- `GET /v1/stores/{store}/workbench` 为真实老板工作台，返回
  `{store,financial,items}`；当前 items 仍是原首餐。
- `GET /v1/stores/{store}/meals` 提供公开 `listed` 与财务投影。
  `businessReady=false` 可能来自快照陈旧或服务未恢复，不能解释成从未上架。
- `GET /v1/store-registrations` 按有效会话找回原注册。不得使用浏览器钱包地址认权。
- `c1_live_private.owner` 检查原注册主体等于会话主体、启用的老板绑定、
  原 owner 地址、bindingRevision、identityRevision、credentialEpoch 和有效期。
  第二钱包须真正建立第二会话，再验证原店工作台、草稿及私人图片均被拒绝。
  仅切换钱包 provider 而继续使用原 cookie 不构成第二身份验收。

证据：`src/c1/live_gateway.py` 的 `handle`；
`connection-migrations/023-live-business.sql` 的 `owner`；
`connection-migrations/026-wallet-principal.sql` 的 `live_api`。

## 新增私人草稿合同

`store` 为原店无 `0x` 的 64 位小写 hex。新草稿 `meal` 使用客户端生成并稳定
保留的小写 UUID；原首餐的 64 位小写 hex 也可用，其余任意 hex 不可冒充原餐。
所有接口均需有效老板会话。写请求沿用精确同源、CSRF 和 Idempotency-Key。

- `GET /v1/stores/{store}/drafts`：返回 `{items:[DTO],capabilities}`。
  能力为 `create/edit/upload=true`，`publish/listing=false`。
- `GET /v1/stores/{store}/drafts/{meal}`：返回 DTO。未保存时 revision 为 0；
  原首餐以原内容为初值，新 UUID 为空文本、price 为 `"1"`、windows 为 `[[0,1440]]`。
- `PUT /v1/stores/{store}/drafts/{meal}`：JSON 为
  `{name,description,price,windows,expectedRevision}`，返回保存后的 DTO。
  price 是正整数原子单位十进制字符串，windows 为至多两个有序不重叠分钟区间。
- `PUT /v1/stores/{store}/drafts/{meal}/image`：原始图片字节，Content-Type 为
  PNG/JPEG/WebP，携带 `X-C1-Draft-Revision`。必须已有草稿；返回 DTO。
  先验证老板，再用现有有界解码器规范化为 PNG 并计算既有 imageDigest。
- `GET /v1/stores/{store}/drafts/{meal}/image`：仅老板可读，PNG、no-store。
  未上传时 404；不会通过公开图片路由暴露私人图片。

DTO 为 `{id,meal,revision,draftRevision,saved,publicationState:"PRIVATE_DRAFT",
draft:{name,description,price,windows,imageDigest,hasImage,imageUrl}}`。
revision 为整数；imageDigest 是无 `0x` 的 hex，未上传时为 null；imageUrl 由后端
返回。列表仅包含已保存草稿。原餐初值不自动复制公开图片，故未上传时 hasImage=false。
本期每店最多 20 个草稿、256 条不可删除的幂等记录；达到上限返回 QUEUE_FULL。

保存、图片上传均按原 expectedRevision 比较并原子递增；同 key 同请求返回原响应，
同 key 不同请求拒绝。图片重试先解析原请求重放，再判断 CAS，不重复递增。
任何草稿写入都不修改已发布餐品、注册记录、first_binding 或链上交易。
`/review` 与 `/publish` 明确返回 `503 LIVE_CATALOG_EXECUTION_UNAVAILABLE`；
现有 live `/list` 仍为 `503 LIVE_OPERATION_NOT_IMPLEMENTED`。

## 合约已经核实的能力与阻塞

精确只读核对 `cp30-contracts/contracts/StoreEscrow.sol` 和
`out/s0b-final/StoreEscrow.sol/StoreEscrow.json` 后确认：

- `publish(bytes32 opId,uint256 expectedControlRevision,TermsInput input)`：
  调用者必须是 **catalogAuthority**，operation kind 为 1。版本须为 currentVersion+1；
  新 meal 可从 version 1 开始。发布不会自动设置 listed。
- `setListed(bytes32 opId,uint256 expectedControlRevision,bytes32 mealId,bool value)`：
  调用者同样必须是 **catalogAuthority**，kind 为 2；meal 须已存在，值须发生变化。
- 两者均校验 controlRevision；原 opId 同 caller/参数重放返回原结果，冲突拒绝。
  TermsInput 字段为 mealId、version、unitPrice、bodyDigest、imageDigest、windowCount、
  startMinute0、endMinute0、startMinute1、endMinute1。

这不是老板钱包直接调用的菜单写权限，也不是现有注册 EIP712 签名可复用的授权。
当前运行服务只有 quote/issuer/operator 三个角色，缺少受限 catalogAuthority
交易签名、广播、原交易跟踪通路。不得借其他角色代签或将老板签名冒充合约权限。

兼容性证据：源代码 keccak 为
`0xfa9d981e685e5246b14a5430b1aa520ca1ba0bed74a206bafe2771e250d29461`，
与 accepted artifact metadata 中源哈希一致。accepted artifact SHA256 为
`92c2b42db5728f0d9790a7bdcf1eed0f66969af1e26b19f5c9c0e9b3c5ddf4e5`。
其 creation bytecode 与 backend factory 编译产物都是 25501 字节，去除末尾 Solidity
metadata 后完全相同；原始字节不相同，不能混称同一编译产物。factory 原 creation pin
仍为 `0x3aed59967d18f9b80a436f1080f9b55b5ea9299f62eb1c7d8f612d7ed8d30b4e`。
此源码核对没有重新查询链上；原 escrow runtime 验证沿用 Leader 已有确认记录。

## 后续完整实现阶段

1. 应用本次私人草稿能力，验证原老板读写、重新登录恢复、第二会话拒绝、CAS 和重放。
2. 接入受限 catalogAuthority 原操作执行。复用现有账本与 UNKNOWN 原交易模式，
   新增准确 ABI/参数 hash、权限、广播与 finalized 观察；当前 wallet bridge 的 fund/settle
   成品流程不能直接执行菜单写交易。
3. 实现原首餐上下架与编辑版本发布：只有可信原交易确认后更新公开投影。
4. 扩展同店多餐：替换 gateway 的 catalog[0]、observer 首 meal、projection 单 meal 映射、
   SQL t.meal 与 firstMeal 返回逻辑，并保留旧资金/餐券对应的历史 terms。
   初次注册仍可一餐，不需要重新运行 registrar 或更改 first_binding。

旧 `migrations/005-catalog.sql` 不能直接切到 live：其 owner_auth 使用 email/grants，
drafts 外键指向旧 `c1_private.stores`。本次使用独立 live 表和真实 owner 权限。
禁用按钮只是阶段状态，不构成完整新增、编辑、发布、上下架交付。

## 031 应用与恢复边界

`connection-migrations/031-live-drafts.sql` 新增 drafts/replays 和一个固定 runtime
入口；草稿写入走原 PgRuntimeLedger，不新增签名权限。material/floors 包含草稿、
版本和重放记录，图片纳入 SHA256 而不把原图展开进账本 material。
空表迁移前后 material/floors 等值，避免修改原 checkpoint 或恢复下限。

由 Leader 停止原服务并确认退出，在 owned PG 事务中应用；核对旧函数内容/权限、
空表前后 material/floors、原注册/first_binding/交易数据不变，以及新函数仅授
c1_live_api。同步 application/db sourcePins 和安装 metadata 后正常启动。
不要运行初始化脚本、重置账本或补造已发布菜单。

应用失败应回滚整个 DDL 事务。应用成功但尚无草稿写入，可停服务后回退源码并暂留
空表包装；发生首次草稿写入后必须保留 031 表、material/floors 和恢复记录，只做向前
修复，禁止删表或把 checkpoint/floors 改回旧值。

验证：`tools/live-drafts-pg-check.py` 使用独立临时 PG17.11，真实 owner 函数和合成
context guards，覆盖迁移、权限、CAS、幂等、私图与摘要；不等于完整 runtime journal
或真实钱包验收。离线测试在 `src/c1/live_drafts_checks.py`；真实环境应用和双钱包
浏览器验收仍由 Leader 执行。
