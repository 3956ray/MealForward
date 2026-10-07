import type {DynamicAuthClient} from '../src/dynamic/contracts.ts'
import type {Provider} from './wallet.ts'

export type IdentitySession = {serverIdentityVerified: boolean; expiresAt: number; candidate: null|{
  adminAddress: string; merchantAddress: string; chainId: number; controlVerified: false; chainPermissionsVerified: false; serviceIsolation: string
}}
export type IdentityConfig = {environmentId: string; serverVerificationConfigured: boolean}
export class IdentityController {
  private csrf = ''
  private epoch = 0
  private session: IdentitySession|null = null
  private account = ''
  private provider: Provider|null = null
  private unsubscribe: () => void
  private pending: Promise<unknown> = Promise.resolve()
  private timer?: ReturnType<typeof setTimeout>
  private disposed = false
  private client: DynamicAuthClient
  private changed: (session: IdentitySession|null, account: string, message?: string) => void
  private transport: typeof fetch
  constructor(client: DynamicAuthClient, changed: (session: IdentitySession|null, account: string, message?: string) => void,
    transport: typeof fetch = fetch) {
    this.client=client; this.changed=changed; this.transport=transport
    this.unsubscribe = client.onInvalidate(() => {void this.invalidate('登录状态已变化，请重新核验身份与地址。')})
  }
  private async call(path: string, body?: object, authenticated = true) {
    const token = authenticated ? this.client.getAccessToken() : null
    if (authenticated && !token) throw new Error('请先完成Dynamic邮箱登录。')
    const transport = this.transport
    const r = await transport('/api/cp28/identity/'+path, {method: body === undefined ? 'GET' : 'POST',
      credentials:'same-origin', cache:'no-store', redirect:'error', headers:{'Content-Type':'application/json',
        'X-CSRF-Token':this.csrf, ...(token ? {Authorization:'Bearer '+token} : {})},
      ...(body === undefined ? {} : {body:JSON.stringify(body)})})
    const data = await r.json()
    if (!r.ok) throw new Error(data.message || '身份准备请求未确认，请重新核验。')
    if (data.csrfToken) this.csrf = data.csrfToken
    return data
  }
  async bootstrap(): Promise<IdentityConfig> {return this.call('bootstrap', undefined, false)}
  private clear(message?: string) {
    this.epoch++; this.session = null; this.account = ''; clearTimeout(this.timer)
    this.changed(null, '', message)
  }
  invalidate(message?: string) {
    this.clear(message)
    this.pending = this.pending.catch(()=>{}).then(async()=>{
      if (this.csrf) await this.call('invalidate', {}, false)
    }).catch(()=>{this.changed(null, '', '本页确认已清除；服务端撤销未确认，请重新核验身份。')})
    return this.pending
  }
  private accept(value: IdentitySession, epoch: number) {
    if (this.disposed || this.epoch !== epoch) throw new Error('身份或钱包已变化，请重新核验。')
    if (!value.serverIdentityVerified || value.expiresAt*1000 <= Date.now()) throw new Error('身份会话已过期。')
    this.session = value
    clearTimeout(this.timer)
    this.timer = setTimeout(()=>void this.invalidate('身份会话已过期，请重新登录并确认地址。'), Math.min(2147483647, value.expiresAt*1000-Date.now()))
    this.changed(value, this.account)
    return value
  }
  async verify() {
    await this.pending
    const epoch = this.epoch
    try {return this.accept(await this.call('exchange', {}), epoch)}
    catch (e) {this.clear(); throw e}
  }
  private walletChanged = () => {void this.invalidate('钱包账户或网络已变化，旧候选确认已失效。')}
  private detach() {
    for (const event of ['accountsChanged','chainChanged','disconnect']) this.provider?.removeListener?.(event,this.walletChanged)
    this.provider = null
  }
  async connect(provider: Provider) {
    await this.pending
    if (!this.session || this.session.expiresAt*1000 <= Date.now()) throw new Error('请先完成服务端身份核验。')
    if (typeof provider.on !== 'function' || typeof provider.removeListener !== 'function') throw new Error('钱包不支持账户变化通知，无法确认候选地址。')
    // Reconnection never leaves an older server-side candidate active.
    await this.invalidate()
    await this.verify()
    this.detach(); this.provider = provider
    for (const event of ['accountsChanged','chainChanged','disconnect']) provider.on?.(event,this.walletChanged)
    const epoch = this.epoch
    const accounts = await provider.request({method:'eth_requestAccounts'})
    const chain = await provider.request({method:'eth_chainId'})
    if (epoch !== this.epoch) throw new Error('钱包已变化，请重新连接。')
    if (chain !== '0x279f') throw new Error('请本人在钱包中选择Monad Testnet（10143）；本页不会切链或签名。')
    if (!Array.isArray(accounts) || accounts.length !== 1 || !/^0x[0-9a-fA-F]{40}$/.test(accounts[0])) throw new Error('请在钱包中仅选择一个候选账户。')
    this.account = accounts[0]; this.changed(this.session,this.account)
    return this.account
  }
  async confirm() {
    await this.pending
    if (!this.session || !this.account || !this.provider) throw new Error('请先核验身份并连接本人钱包。')
    const epoch = this.epoch
    const accounts = await this.provider.request({method:'eth_accounts'})
    const chain = await this.provider.request({method:'eth_chainId'})
    if (epoch !== this.epoch || chain !== '0x279f' || !Array.isArray(accounts) || accounts.length !== 1 || accounts[0].toLowerCase() !== this.account.toLowerCase()) {
      await this.invalidate('钱包已变化，旧确认已失效。'); throw new Error('请重新连接并核对候选地址。')
    }
    try {return this.accept(await this.call('candidate', {address:this.account,chainId:10143}),epoch)}
    catch(e) {await this.invalidate(); throw e}
  }
  async logout() {
    this.clear(); this.detach(); await this.pending
    let revoked = false
    try {await this.call('logout',{},false); revoked = true}
    finally {this.csrf=''; await this.client.logout()}
    return revoked
  }
  dispose() {
    this.disposed=true; this.unsubscribe(); this.detach(); clearTimeout(this.timer)
    return this.invalidate().finally(()=>this.client.logout()).catch(()=>{})
  }
}
