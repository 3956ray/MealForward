# mealforward CP15 公开索引

独立 Envio HyperIndex **3.12.1** 包，仅本地 Anvil chainId **31337**。源 ABI 来自 `../shared/MealForward.abi.json`，`npm run abi` 对照 `abi-manifest.json` 核 SHA256 后复制；禁止手改 `abis/`。SDK 类型由 `envio codegen` 生成到忽略的 `.envio/types.d.ts`，不提交构建产物。

## 已验证（2026-09-30）

在 Node **24.21.0** / npm **11.19.0** 运行：

```sh
cd indexer
npm ci --ignore-scripts
npm run codegen
npm run check
npm test
```

- ABI SHA256：`8b922614a26c2cd379c8ffc85dd3b0af47ba2748666d733df52e7e5ebf99b1d4`。
- Codegen、TypeScript 检查、4 个测试通过。SDK `createTestIndexer` 实际加载注册处理器，用 **simulate 虚构事件**验证九类事件、两批隔离、N3 独立逐券记录、部分逐券状态、超过 JS safe integer 的金额、重复事件不累计、从空索引确定性重建、私有额外参数丢弃。
- EventFeed 用注入的模拟 GraphQL 响应验证游标作用域、稳定排序查询、滞后水位、503/GraphQL 错误/缺失水位；这不是 GraphQL 服务验收。
- 本机 `command -v docker` 无结果。**真实 HyperIndex + PostgreSQL + Hasura GraphQL：NOT_RUN。真实 Anvil 事件摄取、服务重启持久性、snapshot/revert 自动回滚：NOT_RUN。** 没有安装 Docker daemon、启动节点或访问其他项目端口。
- 依赖修复后执行 `npm ci --ignore-scripts`、codegen、check、原4项测试、`npm audit --json` 均成功；当前 audit **0**（2026-09-30）。Envio仍为3.12.1，viem仍为2.54.0，未采用工具建议的V2降级。通过精确 overrides 固定 express4.22.3、body-parser1.20.6、qs6.16.0、path-to-regexp0.1.13、ws8.22.0、esbuild0.28.1，更新的锁同时消除了旧的viem嵌套ws8.20.1和Express依赖链报告。`npm ls` 已核实实际解析版本。原始11项报告（4 low / 1 moderate / 6 high）属于修复前状态。
- 兼容性边界：Express/body-parser/qs/ws保持原major，path-to-regexp保持0.1系列；esbuild由0.27.7跨至0.28.1，超出tsx原依赖范围。[官方变更记录](https://github.com/evanw/esbuild/blob/main/CHANGELOG.md#0280)说明0.28版本边界涉及安装回退下载完整性校验及Go工具链更新；本机锁文件安装和tsx加载真实处理器测试已过，但不自动证明完整Envio服务/容器/全部编译场景兼容。上述真实服务NOT_RUN状态保持。
- Node24 下 Fuel 非使用路径依赖仍报告 engine warning；未来容器模板选 Node22，容器构建尚未运行。audit0只表示本次已知依赖报告清空，不构成生产安全、真实服务验收或bounty集成证明。

## 模型与权限

`ChainEvent` 保存九种 ABI 事件的公开字段，`argsJson` 内所有 uint 金额为十进制字符串。事件 ID 为 `deploymentId:transactionHash:logIndex`。`IssuedVoucher` ID 再附 `voucherId:arrayIndex`，同一 Issued log 的三券不会互相覆盖。`Batch` 与 `Voucher` 的 ID 都带 deploymentId；金额使用 BigInt，重复父事件不会重复增加资金或券数。

处理器只读写 Envio context 实体，不访问私有数据库、外部业务 API、文件、cookie、资格、领取关联或券秘密。ABI allowlist 来自生成副本，额外 transport 参数不会进入公开索引。`Batch/Voucher` 是候选公开投影，未声明已最终确认，更不证明指定自然人已领取或吃完。

`src/EventFeed.ts` 实现 `EventFeed.fetchRange(deploymentId, from, to, cursor?)`，返回 `events,indexedThrough,observedAt,nextCursor,source`。IndexedEvent 不带内部 ID/argsJson，与共享 schema 对齐；按 blockNumber/transactionIndex/logIndex 做 keyset 分页。`indexedThrough` 使用 Envio 3.12.1 的 `chain_metadata.latest_processed_block`，不是最后一个业务事件块；`observedAt` 为客户端成功观察时刻。该 GraphQL endpoint 必须属于指定的单部署实例。

游标绑定部署和范围，但不是冻结快照或最终性证明。遇重组、重建、数据源改变，应从所需范围开头重读并按稳定事件键去重。索引为空/延迟/故障不能推导链上失败。**正式后台继续通过 directRPC、receipt、canonical block、finalized 核验并持久化最终结果；Envio lag 不回退已确认结果，也不单独禁止合法后台进展。**

## 真实服务待验证步骤

`config.yaml` 是可通过 codegen 的实际 HyperIndex 配置，默认地址 `0x…0001` 仅用于 SDK 模拟，不能声称已有部署。未来前提：已有可用 Docker runtime（本轮不安装）、独立 Anvil **18646** 的经核验部署、独立本地数据库及管理员随机凭据。18645 为主后台共享节点，本模块不使用；不碰 5173/8765/18545/5195。

1. 在独立 Anvil31337 部署冻结 MealForward 合约，保留公开地址、起始块。每次链重置/重新部署使用新的唯一 `ENVIO_DEPLOYMENT_ID`；部署改变不能沿用旧数据库的混合状态。
2. 在本目录忽略的 `.env`（权限0600）设置 `ENVIO_DEPLOYMENT_ID`、`ENVIO_CONTRACT_ADDRESS`、`ENVIO_START_BLOCK`、随机 `ENVIO_PG_PASSWORD`、随机 `HASURA_GRAPHQL_ADMIN_SECRET`。密码用无 URL 特殊字符的随机 hex；不要提交或在证据日志打印。Docker Compose 读取此文件。真实地址及部署 ID 必填；启动脚本还会核 `eth_chainId=31337`。
3. `npm run dev` 使用项目名 `mealforward-cp15-indexer`。Postgres **127.0.0.1:5435**、GraphQL **127.0.0.1:8085**；indexer 指标9895不映射到宿主机。Docker 内通过 `host.docker.internal:18646` 读取本机独立 Anvil（模板针对本机 macOS Docker Desktop；未验证其连通性）。Docker build allowlist 排除私有文件、node_modules和.env。没有云/API token要求。
4. 运行两批 Funded/IssuedN3/逐券 Locked→Reported→Settled，查询下列 GraphQL；检查每个 tx/log/数组子记录与 RPC 相同、金额精确且无私有字段。
5. 重启同一 Compose 项目，验证事件/金额不重复；在新的隔离 DB 从 deploymentBlock 重建比对结果。独立链 snapshot/revert 制造未最终块重组，验证旧实体撤销。无需重置任何其他项目。
6. 停止 Hasura/制造延迟并恢复，验证后台仍保留 directRPC 已 finalized 结果。完成上述步骤后才可把 NOT_RUN 改为实测结果。

```graphql
query PublicTimeline {
  ChainEvent(order_by: [{blockNumber: asc}, {transactionIndex: asc}, {logIndex: asc}]) {
    deploymentId eventName transactionHash logIndex argsJson
  }
  IssuedVoucher { id eventId voucherId arrayIndex batchId }
  Batch { deploymentId batchId fundedWei issuedCount }
  Voucher { deploymentId voucherId batchId status settledWei }
  chain_metadata { chain_id latest_processed_block }
}
```

Compose / Dockerfile 是待执行模板，不把镜像构建、服务可用或 GraphQL schema 视为已验证。禁止对未知 Compose 项目执行 stop/down/restart；本项目也无需 `down -v` 删除持久证据。

## 核验来源

2026-09-30 读取官方文档及已安装 SDK 源码：

- [Local Anvil](https://docs.envio.dev/docs/HyperIndex/local-anvil)
- [V3 handlers and field selection](https://docs.envio.dev/docs/HyperIndex/event-handlers)
- [SDK createTestIndexer](https://docs.envio.dev/docs/HyperIndex/testing)
- [Configuration interpolation](https://docs.envio.dev/docs/HyperIndex/configuration-file)
- [Environment variables](https://docs.envio.dev/docs/HyperIndex/environment-variables)
- [Self hosting](https://docs.envio.dev/docs/HyperIndex/self-hosting)
- [Official container example](https://github.com/enviodev/local-docker-example)

`npm view envio version` 返回3.12.1。`chain_metadata` 字段核于包内 `src/db/InternalTable.res`；SDK 指标服务监听核于 `src/Main.res`（未限定 host，因此容器不映射指标端口）。
