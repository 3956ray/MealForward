# MealForward 独立本机全栈验收

这是显式启动的本机验收环境：真实 PostgreSQL 17、Anvil 31337、新版合约、链适配器、HTTP/SIWE 及静态前端共同运行。它不连接 Supabase、Monad Testnet 或旧 MVP，不是线上发布；钱包和资产均为本次新生成的测试数据。没有静态 mock API。

## 准备

已有项目依赖需要安装完成；需 Node.js、PostgreSQL **17**（默认 `/opt/homebrew/opt/postgresql@17/bin`）和 PATH 中的 `anvil`。合约与独立前端必须先构建：

```sh
cd mvp-contracts
forge build
cd ../t1-intents/mvp-client
npm run build:catalog
cd ..
```

入口为 `t1-intents/product-v2/acceptance-stack.mjs`。导入模块本身不会启动服务。

## 启动、完整验收、停止

在 `t1-intents` 目录运行：

```sh
node product-v2/acceptance-stack.mjs seed
```

`seed` 预置一家厨房、三道餐品与 7 份真实已资助餐食，领取账户保持未领取。需要完全空白环境时使用 `start`。

控制台只显示本次 UI URL、本次 31337 RPC URL、公开测试账户、合约地址和工作目录。浏览器打开显示的 UI URL。默认开启明确标记 **“本地测试钱包（非 MetaMask）”** 的 EIP-1193 桥：先选择商家／支持者／领取者，再在应用中登录；每次连接、签名和发送均需明确确认。桥只签本机产品 SIWE、既定赎餐域或发送至本次部署 asset/escrow 的允许交易；没有私钥导出。

测试桥不是 MetaMask；桥验收不能表述为用户真实 MetaMask 验收。商家与支持者有本次本机测试原生币，支持者有测试代币；领取人的 Claim Gas 由本机平台测试身份支付。

自动运行真实 HTTP 全链路并安全关闭：

```sh
node product-v2/acceptance-stack.mjs verify
```

脚本顺序：三个随机测试身份真实 SIWE 登录 → 商家登记／餐品发布 → 今日休息 → 精确授权及三份资助 → 平台付 Gas Claim → 原钱包查券 → 短码检查／取得处理权／确认交餐 → 推进本机链时间越过 180 秒 → 结算并核对实际余额和债务守恒。时间推进只作用于本次 Anvil；日常浏览器点测按实际等待时间执行。

`start` 和 `seed` 均保持前台运行；按 **Ctrl+C** 或向该启动器发 SIGTERM，会关闭它拥有的 HTTP 服务、worker、PG 连接、独立 PG 实例及 Anvil，并移除临时 PG socket。数据库目录保留供本机排查。不要关闭或重置其他旧服务。

可指定全新目录，但必须为仓库 `.local-product-acceptance/` 下的直接子目录：

```sh
node product-v2/acceptance-stack.mjs start --workdir /absolute/repository/.local-product-acceptance/my-new-run
```

已有目录、符号链接、目录逃逸和覆盖数据库均拒绝。每次重新启动创建一套新环境；测试私钥仅存在进程内，所以不支持拿旧目录恢复同一组测试身份。整个目录已加入 Git ignore。异常强制杀进程不属于正常关闭，保留的 `status.json` 只含公开运行信息；不要据此自动终止不属于本次启动器的进程。

## 隔离与配置

- PG 不监听 TCP：使用新建、私有临时目录中的 Unix socket。数据目录位于专属新工作区，运行连接使用专用非管理员 LOGIN 和 `mf_product_v2_runtime` 角色，启动时执行真实权限门禁。
- Anvil 仅监听 `127.0.0.1`，关闭默认预生成账户。五个随机测试身份仅在本启动器内存中使用；不读 `.env`、旧钱包文件、旧 DSN 或云凭据。
- 默认产品 host 仍关闭，默认链仍为 Monad 测试网。只有显式 `profile:'local-acceptance'` 和精确 loopback origin 才接受 31337，测试钱包桥仅由此启动器提供。
- 部署后明确计算并固定本次资产／Escrow 字节码摘要、地址、部署块、权限地址、policy、Gas 限额，再交给真实链适配器验证。
- `startAcceptanceStack({pgBin,anvilBin,workdir,localWallet:false})` 可由本机脚本调用；关闭 bridge 不改变其他安全门禁。返回 `{public, verify, seed, stop, status}`，不返回私钥。
- 目前没有将用户现有 MetaMask 自动注资的 HTTP faucet，也不修改用户网络。要增加这种能力，应使用独立、仅本机可见的开发入口；不能放入生产 host。

## 测试

快速安全与钱包桥验证：

```sh
node --test product-v2/acceptance-stack.test.mjs product-v2/acceptance-wallet.test.mjs
```

默认跳过会启动真实依赖的那项；显式启用真实 PG＋Anvil＋HTTP 联合验收：

```sh
MEALFORWARD_RUN_LOCAL_ACCEPTANCE=1 node --test product-v2/acceptance-stack.test.mjs
```

测试使用新建临时运行目录，完成后仅关闭、清理自身资源；不触碰旧数据库或旧链。以命令本次输出为准；单元测试通过不等于真实联合验收通过。

本轮实际证据：上述显式全栈测试已运行 **5/5 通过**，包括真实 PG、真实 Anvil、HTTP/SIWE、完整业务与安全停止；钱包桥安全测试 **5/5 通过**。这里的联合验收是 Node 驱动真实 HTTP 的全栈验收；浏览器界面通过本地测试钱包的端到端验收应另行记录，不冒称 MetaMask 或公网验收。

永久停业、退款、逐店账目和浏览器证据的最新范围见 [本轮验收文档](../../docs/superpowers/2026-10-31-mvp-acceptance.md)。
