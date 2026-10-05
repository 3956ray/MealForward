import { IssuanceError, assertOriginal, parseConfig, parseView, type Config, type Status, type View } from './contracts.ts'
import { createIssuanceApi, type IssuanceApi } from './api.ts'
export interface IssuanceState { config: Config|null; view: View|null; busy: boolean; stale: boolean; error: string|null }
export const TEST_BANNER = 'Monad 测试网 · 虚构领取者 · 测试MON · 不证明供餐'
export const VOUCHER_NOTE = '本片无领取凭证，此券暂不可领取/不可分发'
export const ATTRIBUTION = '机构伙伴（partner-a）名义发行 · 平台受限发行服务钥匙代发（Leader 测试计划放行）'
export const STALE_NOTICE = '本次读取未完成，下列内容仅为上次已核结果'
export const statusTexts: Record<Status,string> = {
  PREPARED:'测试餐券发行计划已冻结，等待测试负责人放行',
  BROADCAST:'已广播',
  INCLUDED_SUCCESS:'链上已纳入',
  INCLUDED_REVERT:'链上已纳入·执行失败（终态，本片不再尝试）',
  FINALIZED_SUCCESS:'最终确认，正在核对批次账目',
  FINALIZED_REVERT:'已最终确认·执行失败（终态，本片不再尝试）',
  ACCOUNTING_VERIFIED:'测试餐券已发行，批次账目已核验',
  HALTED:'核验隔离（保留已核事实），请联系测试负责人',
  RESTORE_QUARANTINE:'恢复隔离（联系测试负责人）',
}
export const errorText: Record<string,string> = {
  RATE_LIMITED:'查询过于频繁，请稍后手动重查',
  NOT_CONFIGURED:'本轮测试发券尚未配置，请联系测试负责人',
  INVALID_RESPONSE:'服务响应未通过核验，已停止展示新数据',
  CONNECTION_UNAVAILABLE:'读取未完成；已显示数据仅为上次已核结果',
  RPC_UNAVAILABLE:'本次链上读取未完成，已显示数据仅为上次已核结果',
  RPC_TIMEOUT:'本次链上读取超时，已显示数据仅为上次已核结果',
  SYNC_BUDGET:'本次核验读取额度已用尽，已显示数据仅为上次已核结果',
  REQUEST_FAILED:'读取未完成；已显示数据仅为上次已核结果',
}
export function displayError(code: string) { return errorText[code] ?? `读取未完成（${code}），请联系测试负责人` }
export function statusText(state: IssuanceState) {
  if(!state.config?.configured && !state.view) return '本轮测试发券尚未配置'
  const status=state.view?.operation.status
  const text=status===undefined?'正在读取发券状态…':statusTexts[status]
  return state.view?.operation.budgetViolation ? '原交易费用已越过批准预算，本页只读记录实际结果。'+text : text
}
export class IssuanceController {
  state: IssuanceState = {config:null,view:null,busy:false,stale:false,error:null}
  private listeners = new Set<()=>void>()
  private epoch = 0
  private disposed = false
  private api: IssuanceApi
  constructor(api: IssuanceApi=createIssuanceApi()) { this.api=api }
  subscribe = (listener: ()=>void) => { this.listeners.add(listener); return ()=>{this.listeners.delete(listener)} }
  snapshot = () => this.state
  private update(patch: Partial<IssuanceState>) { this.state={...this.state,...patch}; if(!this.disposed) this.listeners.forEach(fn=>fn()) }
  private code(error: unknown) { return error instanceof IssuanceError ? error.message : 'CONNECTION_UNAVAILABLE' }
  dispose() { this.disposed=true; this.epoch++; this.listeners.clear() }
  private accept(raw: View): View {
    const next=parseView(raw)
    if(this.state.view) assertOriginal(this.state.view,next)
    this.update({view:next,stale:next.operation.errorCode!==null && next.operation.errorCode!=='BUDGET_EXCEEDED',error:next.operation.errorCode})
    return next
  }
  async load() {  // mount path: cheap cached reads only, never triggers a bounded sync
    if(this.state.busy || this.disposed) return
    this.update({busy:true,error:null})
    try {
      this.update({config:parseConfig(await this.api.config())})
      this.accept(await this.api.operation(true))
    } catch(error) {
      this.update({error:this.code(error),stale:this.state.view!==null})
    } finally { this.update({busy:false}) }
  }
  async refresh() {  // the only user action: exactly one bounded sync, stale epochs discarded
    if(this.state.busy || this.disposed) return
    const version=++this.epoch
    this.update({busy:true,error:null})
    try {
      const view=await this.api.operation(false)
      if(version!==this.epoch || this.disposed) return
      this.accept(view)
    } catch(error) {
      if(version!==this.epoch || this.disposed) return
      this.update({error:this.code(error),stale:true})
    } finally {
      if(version===this.epoch && !this.disposed) this.update({busy:false})
    }
  }
}
