---
name: cp30-contracts
description: MealForward 合约轨（cp30-contracts/，Foundry 冻结工程）的只读参考与变更流程。当任务涉及智能合约、ABI、链上地址、catalog/escrow 逻辑、部署时使用；默认状态是冻结只读。
---

# CP30 合约轨

## 本轨身份：默认冻结，只读优先

- `cp30-contracts/` 是 **FROZEN_FOR_LOCAL_BUILD** 状态（合同见其目录内 `AGENTS.md`，CP30-S0b freeze）：只允许该目录内按合同变更，**任何改动前必须先立新阶段授权**（按项目 CP 惯例：先写 BRIEF/FREEZE 合同文档，获用户作为 Leader 的放行，再动代码）
- 仓库根 `contracts/`（MealForward.sol / MealForwardTestnet.sol）是 CP13 历史合约，**字节不动**
- 冻结范围（勿改）：已接受的 evidence 文件、历史测试、锁文件；新产物只进 `evidence/s0b/`

## 工具链（冻结时点）

- Foundry 1.7.1、solc 0.8.28、OpenZeppelin 5.6.1（根安装）；**不装/升级依赖**，不碰 RPC/fork、真实 key、广播、部署（未授权时）

## 对另外两轨提供的接口（本轨的产出物）

1. **ABI**：`cp30-contracts/out/` 构建产物 → 副本落在 `shared/MealForward.abi.json` 与 `indexer/abis/MealForward.abi.json`（两处副本必须一致；分发 ABI 属于本轨动作，改 ABI = 全轨 breaking change）
2. **链上地址登记册**：部署/变化经后端 catalog 流程落到 `~/.mf-cp30-20261013/chain-profile-public.json`（chainId 10143、genesis、factory、五 authority、USDC asset、code hash、runtimeTemplatePins，带 chainProfileDigest）。**digest 变了 = 接口变了**，前后端轨都要重新同步
3. 业务语义：catalog/control、A/R/H/S/X 账务不变量、voucher 72h、operation kinds 1..11、owner settlement、180s 门禁（合约不自动打款）

## 变更流程（有合约需求时）

1. 立新阶段：写 BRIEF/FREEZE 文档（范围、边界、禁项），获 Leader（用户）放行
2. 实现 + 全测试矩阵：T01–T10、五桶独立参照、fuzz ≥10000 例、stateful ≥64×256，不关 EIP170/代码大小限制
3. 冻结干净 commit → 独立验收（不自标 ACCEPTED）
4. 若涉及新部署：新地址 = breaking change，先广播接口变更（新 ABI + 新 profile digest），等前后端轨确认同步后才能切
5. 已有 live intent 引用的旧地址/合约不可使其失效（实库不清不重建红线）

## 只读排查（不改合约时的常用动作）

- 核对前端/后端用的 ABI 是否与 `out/` 产物一致
- 用 chain-profile 的 code hash / runtimeTemplatePins 校验链上实际代码与预期 pin 是否一致
- 读测试矩阵理解某个 operation kind 的预期行为
