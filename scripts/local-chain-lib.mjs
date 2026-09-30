import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createPublicClient, createWalletClient, http, keccak256, stringToHex } from 'viem'
import { foundry } from 'viem/chains'
import { assertLocalRpc, LOCAL_CHAIN_ID, LOCAL_PRICE_WEI, LOCAL_FUNDING_CAP_WEI, LOCAL_RULE_VERSION, mealForwardAbi } from '../src/chain-contract.ts'

export const id = value => keccak256(stringToHex(`cp13:${value}`))
export function build() {
  execFileSync('node_modules/.bin/forge', ['build'], { stdio: 'inherit' })
}
export async function artifact(path = 'out/MealForward.sol/MealForward.json') {
  return JSON.parse(await readFile(path, 'utf8'))
}
export async function connectLocal(rpcUrl) {
  assertLocalRpc(rpcUrl)
  const publicClient = createPublicClient({ chain: foundry, transport: http(rpcUrl, { retryCount: 0 }), pollingInterval: 30 })
  async function guard() {
    assertLocalRpc(rpcUrl)
    if (await publicClient.getChainId() !== LOCAL_CHAIN_ID) throw new Error('Refusing non-local chain')
    const version = await publicClient.request({ method: 'web3_clientVersion' })
    if (!String(version).toLowerCase().includes('anvil')) throw new Error('Only dedicated local Anvil is supported')
  }
  await guard()
  const accounts = await publicClient.request({ method: 'eth_accounts' })
  if (accounts.length < 8) throw new Error('Expected isolated Anvil development accounts')
  const wallets = accounts.map(account => createWalletClient({ account, chain: foundry, transport: http(rpcUrl, { retryCount: 0 }) }))
  async function receipt(hash) {
    return publicClient.waitForTransactionReceipt({ hash, timeout: 15_000, pollingInterval: 30 })
  }
  async function write(address, index, functionName, args = [], value = 0n) {
    await guard()
    const hash = await wallets[index].writeContract({ address, abi: mealForwardAbi, functionName, args, value, gas: 3_000_000n })
    return receipt(hash)
  }
  async function deploy(index, contractArtifact, args = []) {
    await guard()
    const hash = await wallets[index].deployContract({ abi: contractArtifact.abi, bytecode: contractArtifact.bytecode.object, args, gas: 8_000_000n })
    const result = await receipt(hash)
    if (result.status !== 'success' || !result.contractAddress) throw new Error('Local deployment failed')
    return result
  }
  const read = (address, functionName, args = []) => publicClient.readContract({ address, abi: mealForwardAbi, functionName, args })
  return { rpcUrl, publicClient, accounts, wallets, guard, receipt, write, deploy, read }
}
export async function deployFixture(client, merchant = client.accounts[5]) {
  const deployed = await client.deploy(0, await artifact(), [client.accounts[0], merchant])
  const address = deployed.contractAddress
  for (const [role, indices] of [['SUPPORTER_ROLE',[1,6]], ['ISSUER_ROLE',[2]], ['OPERATOR_ROLE',[3,7]], ['SETTLER_ROLE',[4]]]) {
    const roleId = await client.read(address, role)
    for (const index of indices) {
      const r = await client.write(address, 0, 'grantRole', [roleId, client.accounts[index]])
      if (r.status !== 'success') throw new Error('Role grant failed')
    }
  }
  const code = await client.publicClient.getCode({ address })
  return {
    mode: 'localchain', chainId: LOCAL_CHAIN_ID, rpcUrl: client.rpcUrl,
    contractAddress: address, deploymentBlock: deployed.blockNumber.toString(),
    codeHash: keccak256(code), supporter: client.accounts[1], merchant,
    ruleVersion: LOCAL_RULE_VERSION, priceWei: LOCAL_PRICE_WEI.toString(), fundingCapWei: LOCAL_FUNDING_CAP_WEI.toString(),
  }
}
