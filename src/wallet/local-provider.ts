import { LOCAL_CHAIN_ID, type LocalDeployment } from '../chain-contract.ts'
import { rpcProvider, type Provider } from './controller.ts'

export type Fault = 'none' | 'reject' | 'drop-after-send' | 'unknown-before-send'
/** Isolated EIP-1193 adapter. Uses only unlocked Anvil development accounts, never window.ethereum. */
export class LocalTestProvider implements Provider {
  rpc: Provider
  deployment: LocalDeployment
  fault: Fault = 'none'
  listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  constructor(deployment: LocalDeployment) { this.deployment = deployment; this.rpc = rpcProvider(deployment.rpcUrl) }
  on(event: string, callback: (...args: unknown[]) => void) { const set = this.listeners.get(event) ?? new Set(); set.add(callback); this.listeners.set(event, set) }
  removeListener(event: string, callback: (...args: unknown[]) => void) { this.listeners.get(event)?.delete(callback) }
  async request({ method, params = [] }: { method: string; params?: unknown[] }): Promise<unknown> {
    if (BigInt(await this.rpc.request({ method: 'eth_chainId' }) as string) !== BigInt(LOCAL_CHAIN_ID)) throw new Error('Local provider requires 31337')
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [this.deployment.supporter]
    if (method === 'wallet_switchEthereumChain') {
      if ((params[0] as { chainId?: string })?.chainId !== '0x7a69') throw new Error('Local chain only')
      return null
    }
    if (method === 'eth_sendTransaction') {
      if (this.fault === 'reject') throw Object.assign(new Error('Injected refusal before broadcast'), { code: 4001 })
      if (this.fault === 'unknown-before-send') throw new Error('Injected transport uncertainty without send')
      const result = await this.rpc.request({ method, params })
      if (this.fault === 'drop-after-send') throw new Error('Injected response loss after real broadcast')
      return result
    }
    return this.rpc.request({ method, params })
  }
}
