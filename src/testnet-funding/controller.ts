import { CHAIN_HEX, FundingError, assertOriginal, assertSameTransaction, hash, parseConfig, parseView, same, type Config, type Review, type View } from './contracts.ts'
import { createFundingApi, type FundingApi } from './api.ts'
import { firstAccount, selectMetaMask, walletContext, type Provider } from './wallet.ts'
export interface FundingState { config: Config|null; view: View|null; account: string|null; chain: string|null; review: Review|null; busy: boolean; waitingWallet: boolean; consumed: boolean; stale: boolean; error: string|null }
export const errorText: Record<string,string> = {
  ORIGINAL_ACCESS_REQUIRED:'无法访问原付款记录，请联系本次测试负责人恢复；请勿再次付款',
  SESSION_EXPIRED:'无法访问原付款记录，请联系本次测试负责人恢复；请勿再次付款',
  UNAUTHORIZED:'尚未取得原操作访问权；若曾开始付款，请联系本次测试负责人恢复；请勿再次付款',
  BLOCKED_ROLE_GRANT:'当前钱包尚未获本轮测试入款权限',
  ROLE_REQUIRED:'当前钱包尚未获本轮测试入款权限',
  SUPPORTER_ROLE_REQUIRED:'当前钱包尚未获本轮测试入款权限',
  SUPPORTER_ROLE_NOT_FINALIZED:'测试入款权限尚未最终确认，请等待测试负责人核验',
  NONCE_CONFLICT:'原交易 nonce 发生冲突，已停止签名；请联系本次测试负责人',
  CONTRACT_PAUSED:'测试合约已暂停，已停止签名',
  FUNDING_CAP_EXCEEDED:'测试入款额度不足，已停止签名',
  INSUFFICIENT_FUNDS:'固定付款钱包余额不足以承担本金和 gas，已停止签名',
  FEE_CAP_EXCEEDED:'费用超过本轮上限，已停止签名；请联系本次测试负责人',
  GAS_CAP_EXCEEDED:'gas 超过本轮上限，已停止签名；请联系本次测试负责人',
  QUOTE_CHANGED:'交易报价已改变，请重新审核同一原意图',
  READ_ORIGINAL_ONLY:'本轮仅可查询原操作；请勿再次付款',
  REVIEW_REQUIRED:'请先审核同一原付款意图',
  RESTORE_QUARANTINE:'原记录处于恢复隔离，请联系本次测试负责人；请勿再次付款',
  CSRF_DENIED:'请求来源未通过核验，已停止操作',
  RATE_LIMITED:'查询或审核过于频繁，请稍后手动查询原操作；不要再次付款',
  WRONG_CHAIN:'请主动切换至 Monad 测试网 10143，再重新审核原意图',
  WRONG_ACCOUNT:'当前钱包与本轮固定付款钱包不一致',
  WALLET_CHANGED:'账户或网络已改变，审核已失效；请重新审核原意图',
  WALLET_NOT_CONNECTED:'请主动连接 MetaMask',
  METAMASK_NOT_FOUND:'未找到可明确识别的 MetaMask，请检查扩展',
  WALLET_AMBIGUOUS:'检测到多个 MetaMask 候选，无法安全选择，请仅启用本轮使用的钱包',
  WALLET_EVENTS_UNAVAILABLE:'钱包无法报告账户或网络变化，已停止签名',
  REVIEW_EXPIRED:'审核已过期，请重新审核原意图',
  INVALID_RESPONSE:'服务响应未通过交易核验，已停止签名',
  CONNECTION_UNAVAILABLE:'读取未完成；已显示数据仅为上次已核结果',
  WALLET_REQUEST_REJECTED:'钱包请求未完成，请确认后再主动操作',
  SUBMISSION_UNKNOWN:'付款结果待核，请查询原操作',
}
export function displayError(code: string) { return errorText[code] ?? `操作未完成（${code}），请联系本次测试负责人；不要再次付款` }
export class FundingController {
  state: FundingState = {config:null,view:null,account:null,chain:null,review:null,busy:false,waitingWallet:false,consumed:false,stale:false,error:null}
  private listeners = new Set<()=>void>()
  private provider: Provider|null = null
  private revision = 0
  private disposed = false
  private api: FundingApi
  private clock: ()=>number
  private injected: ()=>Provider|undefined
  private walletWaitMs: number
  constructor(api: FundingApi=createFundingApi(), injected: ()=>Provider|undefined=()=> (window as Window & {ethereum?:Provider}).ethereum, clock: ()=>number=Date.now, walletWaitMs=60000) { this.api=api; this.injected=injected; this.clock=clock; this.walletWaitMs=walletWaitMs }
  subscribe = (listener: ()=>void) => { this.listeners.add(listener); return ()=>{this.listeners.delete(listener)} }
  snapshot = () => this.state
  private update(patch: Partial<FundingState>) { this.state={...this.state,...patch}; if(!this.disposed) this.listeners.forEach(fn=>fn()) }
  private code(error: unknown) { return error instanceof FundingError ? error.message : 'WALLET_REQUEST_REJECTED' }
  private changed = () => { this.revision++; this.update({account:null,chain:null,review:null,error:this.state.consumed?'SUBMISSION_UNKNOWN':'WALLET_CHANGED'}) }
  dispose() { this.disposed=true; this.revision++; for(const event of ['accountsChanged','chainChanged','disconnect']) this.provider?.removeListener?.(event,this.changed); this.listeners.clear() }
  private accept(raw: View): View { const next=parseView(raw) as View; if(this.state.view) assertOriginal(this.state.view,next); if(this.state.consumed && !next.operation.submitted) throw new FundingError('SUBMISSION_UNKNOWN'); this.update({view:next,consumed:this.state.consumed||next.operation.submitted,stale:false}); return next }
  private async run(action: ()=>Promise<void>, reading=false) { if(this.state.busy || this.disposed) return; this.update({busy:true,error:null}); try { await action() } catch(error) { this.update({error:this.state.consumed && !reading?'SUBMISSION_UNKNOWN':this.code(error),review:null,...(reading?{stale:true}:{})}) } finally { this.update({busy:false,waitingWallet:false}) } }
  async load() { await this.run(async()=>{this.update({config:parseConfig(await this.api.config())}); if(this.state.config?.configured) this.accept(await this.api.operation())},true) }
  async start() { await this.run(async()=>{if(!this.state.config?.configured || this.state.view || this.state.consumed) return; this.accept(await this.api.session())}) }
  async connect() { await this.run(async()=>{
    if(this.state.consumed) return
    if(!this.provider) { this.provider=selectMetaMask(this.injected()); for(const event of ['accountsChanged','chainChanged','disconnect']) this.provider.on?.(event,this.changed) }
    this.update({review:null})
    const account=firstAccount(await this.provider.request({method:'eth_requestAccounts'}))
    const revision=this.revision
    const chain=await this.provider.request({method:'eth_chainId'})
    if(revision!==this.revision) throw new FundingError('WALLET_CHANGED')
    this.update({account,chain:typeof chain==='string'?chain:null})
  }) }
  async switchChain() { await this.run(async()=>{
    if(!this.provider || this.state.consumed) return
    this.update({review:null}); await this.provider.request({method:'wallet_switchEthereumChain',params:[{chainId:CHAIN_HEX}]})
    const revision=this.revision, account=await walletContext(this.provider)
    if(revision!==this.revision) throw new FundingError('WALLET_CHANGED')
    this.update({account,chain:CHAIN_HEX})
  }) }
  private prepared() { const view=this.state.view; if(!view || this.state.consumed || view.operation.status!=='PREPARED') throw new FundingError('SUBMISSION_UNKNOWN'); return view }
  private async checkWallet(view:View,revision:number) { if(!this.provider) throw new FundingError('WALLET_NOT_CONNECTED'); const account=await walletContext(this.provider); if(revision!==this.revision || this.disposed) throw new FundingError('WALLET_CHANGED'); if(!same(account,view.operation.payer)) throw new FundingError('WRONG_ACCOUNT'); this.update({account,chain:CHAIN_HEX}); return account }
  async review() { await this.run(async()=>{
    this.update({review:null}); const original=this.prepared(), revision=this.revision
    const account=await this.checkWallet(original,revision)
    const next=this.accept(await this.api.review(account))
    await this.checkWallet(next,revision)
    if(next.operation.status!=='PREPARED' || next.operation.submitted || !next.review || next.review.expiresAt<=this.clock() || next.review.expiresAt>this.clock()+120000) throw new FundingError('REVIEW_EXPIRED')
    this.update({review:next.review})
  }) }
  async submit() { await this.run(async()=>{
    const original=this.prepared(), review=this.state.review, revision=this.revision
    if(!review || review.expiresAt<=this.clock()) throw new FundingError('REVIEW_EXPIRED')
    await this.checkWallet(original,revision)
    if(review.expiresAt<=this.clock()) throw new FundingError('REVIEW_EXPIRED')
    // Treat even a lost HTTP response as consumed. Only this successful invocation may send.
    this.update({consumed:true,review:null})
    const result=await this.api.submitStart(review.id)
    parseView(result,true)
    assertOriginal(original,result); assertSameTransaction(review.transaction,result.transaction)
    const {transaction,...view}=result
    this.accept(view)
    await this.checkWallet(view,revision)
    if(review.expiresAt<=this.clock()) throw new FundingError('REVIEW_EXPIRED')
    this.update({waitingWallet:true})
    let timer: ReturnType<typeof setTimeout>|undefined
    let txHash: unknown
    try {
      txHash=await Promise.race([this.provider!.request({method:'eth_sendTransaction',params:[transaction]}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new FundingError('SUBMISSION_UNKNOWN')),this.walletWaitMs)})])
    } finally { clearTimeout(timer) }
    this.update({waitingWallet:false})
    if(!hash(txHash)) throw new FundingError('SUBMISSION_UNKNOWN')
    // The original operation remains authoritative even if the wallet changes now.
    this.accept(await this.api.transaction(txHash))
  }) }
  async reconcile() { await this.run(async()=>{this.update({review:null}); this.accept(await this.api.reconcile())},true) }
}
export function statusText(state: FundingState) {
  if(state.waitingWallet) return '等待钱包处理'
  if(state.consumed && (!state.view?.operation.submitted || state.error==='SUBMISSION_UNKNOWN')) return '付款结果待核，请查询原操作'
  switch(state.view?.operation.status) {
    case 'PREPARED': return state.review?'已审核，请核对后确认签名':'待审核'
    case 'SUBMISSION_UNKNOWN': return '付款结果待核，请查询原操作'
    case 'BROADCAST': return '已取得原交易哈希，等待链上核验'
    case 'INCLUDED_SUCCESS': case 'INCLUDED_REVERT': return '交易已入块，等待最终确认'
    case 'FINALIZED_SUCCESS': return '链上入款已最终确认，正在核对批次'
    case 'FINALIZED_REVERT': return '交易执行失败，可能已产生gas费用'
    case 'ACCOUNTING_VERIFIED': return '测试餐款已到账，批次已核验'
    case 'HALTED': return '核验已停止，请联系本次测试负责人；请勿再次付款'
    case 'RESTORE_QUARANTINE': return '原记录处于恢复隔离，仅可查询；请勿再次付款'
    default: return state.config?.configured?'请访问本轮原付款操作':'本轮测试入款尚未配置'
  }
}
