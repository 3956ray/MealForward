export type Provider = {
  isMetaMask?: boolean
  request(args: {method: string; params?: unknown[]}): Promise<unknown>
  on?(event: string, handler: (...args: unknown[]) => void): void
  removeListener?(event: string, handler: (...args: unknown[]) => void): void
}
export type Transaction = {from: string; to: string; data: string; value: number; chainId: number; nonce: number; gas: number; maxFeePerGas: number; maxPriorityFeePerGas: number}
export type Review = {operationId: string; kind: string; maySign: boolean; transaction: Transaction; configDigest: string; expiresAt: number}
type Api = (path: string, body?: unknown) => Promise<any>
const CHAIN = '0x279f'
const address = /^0x[0-9a-fA-F]{40}$/

export class Wallet {
  private generation = 0
  private busy = false
  private disposed = false
  private provider: Provider
  private api: Api
  private onChange: () => void
  private changed = () => { this.generation++; this.onChange() }
  constructor(provider: Provider, api: Api, onChange: () => void = () => {}) {
    this.provider = provider; this.api = api; this.onChange = onChange
    provider.on?.('accountsChanged', this.changed)
    provider.on?.('chainChanged', this.changed)
    provider.on?.('disconnect', this.changed)
  }
  dispose() {
    this.disposed = true; this.generation++
    for (const event of ['accountsChanged', 'chainChanged', 'disconnect']) this.provider.removeListener?.(event, this.changed)
  }
  async connect(): Promise<string> {
    const accounts = await this.provider.request({method: 'eth_requestAccounts'})
    if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' || !address.test(accounts[0])) throw new Error('未取得有效钱包地址')
    await this.context(accounts[0]); return accounts[0]
  }
  private async context(expected: string) {
    const [chain, accounts] = await Promise.all([
      this.provider.request({method: 'eth_chainId'}), this.provider.request({method: 'eth_accounts'})])
    if (chain !== CHAIN || !Array.isArray(accounts) || typeof accounts[0] !== 'string' || accounts[0].toLowerCase() !== expected.toLowerCase()) {
      throw new Error('请保持批准的钱包地址与 Monad Testnet 10143 网络')
    }
  }
  async send(review: Review): Promise<string> {
    if (this.busy || this.disposed) throw new Error('原钱包操作仍在处理中')
    if (!review.maySign || !['fund', 'settle'].includes(review.kind) || review.transaction.chainId !== 10143 ||
        !address.test(review.transaction.from) || !address.test(review.transaction.to) || review.expiresAt*1000 <= Date.now()) throw new Error('原交易审核不可用')
    const fields = ['from','to','data','value','chainId','nonce','gas','maxFeePerGas','maxPriorityFeePerGas']
    if (Object.keys(review.transaction).length !== fields.length || Object.keys(review.transaction).some(k => !fields.includes(k)) ||
        !/^0x(?:[0-9a-fA-F]{2})+$/.test(review.transaction.data) ||
        Object.values(review.transaction).some(v => typeof v === 'number' && (!Number.isSafeInteger(v) || v < 0))) throw new Error('交易字段不完整或超出精确数值范围')
    this.busy = true; const generation = this.generation; let started = false
    try {
      await this.context(review.transaction.from)
      if (generation !== this.generation) throw new Error('钱包上下文已变化，请重新核对')
      started = true // a lost start response may follow the durable server marker
      const accepted = await this.api(`operations/${review.operationId}/start`, {})
      if (!accepted.maySubmit) throw new Error('该操作已开始，只能查询原操作')
      if (Object.keys(accepted.transaction).length !== Object.keys(review.transaction).length ||
          Object.entries(review.transaction).some(([k,v]) => accepted.transaction[k] !== v) || accepted.configDigest !== review.configDigest) throw new Error('服务端审核内容已变化')
      await this.context(review.transaction.from)
      if (generation !== this.generation || this.disposed) throw new Error('钱包上下文已变化')
      const tx = Object.fromEntries(Object.entries(review.transaction).map(([k, v]) => [k, typeof v === 'number' ? '0x'+BigInt(v).toString(16) : v]))
      const hash = await this.provider.request({method: 'eth_sendTransaction', params: [tx]})
      if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('钱包未返回原交易哈希')
      await this.api(`operations/${review.operationId}/hash`, {txHash: hash})
      return hash
    } catch (e) {
      if (started) {
        try { await this.api(`operations/${review.operationId}/unknown`, {}) } catch { /* original server marker stays durable */ }
        throw new Error('原交易结果未知（包括拒签或响应丢失），只能查询原操作，不要重新签名')
      }
      throw e
    } finally { this.busy = false }
  }
  async prove(challenge: {challengeId: string; address: string; message: string}): Promise<void> {
    if (this.busy || this.disposed) throw new Error('原钱包操作仍在处理中')
    this.busy = true; const generation = this.generation; let started = false
    try {
      await this.context(challenge.address)
      started = true
      const accepted = await this.api('owner/proof/start', {challengeId: challenge.challengeId})
      if (!accepted.maySign || accepted.chainId !== 10143 || accepted.transaction.message !== challenge.message || accepted.transaction.from.toLowerCase() !== challenge.address.toLowerCase()) throw new Error('原证明不可再次签名')
      await this.context(challenge.address)
      if (generation !== this.generation || this.disposed) throw new Error('钱包上下文已变化')
      const message = '0x'+Array.from(new TextEncoder().encode(challenge.message), x => x.toString(16).padStart(2, '0')).join('')
      const signature = await this.provider.request({method: 'personal_sign', params: [message, challenge.address]})
      if (typeof signature !== 'string') throw new Error('未取得原证明')
      if (generation !== this.generation) throw new Error('钱包上下文已变化')
      await this.api('owner/proof/verify', {challengeId: challenge.challengeId, signature})
    } catch (e) {
      if (started) throw new Error('原钱包证明结果未知，请保留原记录；不要重复签名')
      throw e
    } finally { this.busy = false }
  }
}
