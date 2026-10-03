# CP19 测试网合同（C0）

Leader已完成DESIGN/PM回核并放行BUILD。仅独立10143测试网合约及脚本验证，不切旧业务服务。广播仍待完整runner固定SHA独审和Leader核具体计划。C0合约通过不代表允许发送。

`MealForwardTestnet`保留旧合约账务/事件/幂等/暂停/无退款语义，最小差异：名称、10143/TestnetOnly、ruleVersion=keccak256("mealforward-cp19-testnet-v1")、price1e15、累计cap1e16、maxQuantity3。旧MealForward/ABI/default foundry配置保持。新配置`testnet/foundry.toml`（Forge要求文件basename为foundry.toml），产物/cache在被忽略.localbackend/cp19-build。

```sh
node_modules/.bin/forge build --config-path testnet/foundry.toml
node_modules/.bin/forge test --config-path testnet/foundry.toml
```

项目Forge/Anvil1.7.1只做通用EVM验证，不宣称Monad原生模拟。solc0.8.28/optimizer200/cancun固定；真实gas由10143节点估算，按gasLimit计费。老板唯一SETTLER角色且merchant同址，admin仍可增授角色；不新增caller==merchant条件，不冒称合约永恒禁止其他caller。

脚本接口约束：`python -m scripts.testnet.runner plan`只读创建一次固定公共计划/私有journal；`execute --plan-hash HASH`只执行下一个非owner步骤；`reconcile`仅查原hash不重播；`python -m scripts.testnet.owner_client settle --plan-hash HASH`独立owner直接签结算；`python -m scripts.testnet.verify`只读最终证据。无参数不发送。完整实现后增加验证/运行说明。

最多13笔：3个gas内转、1部署、4grant、fund/issue/lock/report/settle各1。本金.001测试MON，合约cap不等于可消费.01；全片gas硬cap2MON，逐步gas拒绝上限21000×3、8m×1、100k×4、fund300k、issue400k、lock/report/settle200k，按maxFee200gwei全序列最坏1.9526MON。实际签gas为真实estimate×1.075向上取整且≤stepcap，EOA内转21000；fee当前base×1.25+2gwei且≤200gwei，否则停。

计划/journal语义：固定chain/genesis/build/roles/预计CREATE地址/nonce/意图/数据/value/每步cap/预算；全运行文件锁；发送前atomic0600+fsync保存signed raw及预计算hash，网络尝试前记UNKNOWN。任何有签名痕迹/未知结果只查原hash，不以null或nonce推断未发，不重签/替nonce/重部署。已发生费用+UNKNOWN预留+所有未执行步骤最坏预留≤2MON。老板key独立私有目录，由独立客户端加载，后台不读。

finality独立核receipt status、原tx字段、预期事件及finalized高度/canonical blockHash；缺finalized不降级。新入账及低于10MON的同sender上次spend另外等当前k=3块执行延迟，重核余额/nonce/空EOAcode。每一步完成后才执行依赖，超时/冲突停止。最终F=S=1e15,A=R=H=0,liability0,contractbalance0，一券status4；L不是liability，X/L不引入本片账。

真源：Leader项目research/cp19/developer/READINESS.md、pm/ANSWERS.md、review/INVARIANTS.md。专用key/Alchemy URL不出私有目录或日志。只用测试MON，不购买/bridge，不启动新业务服务；15207、15217及旧服务/数据保留。
