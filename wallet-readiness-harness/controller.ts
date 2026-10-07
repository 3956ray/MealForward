import { selectMetaMask, firstAccount } from '../src/testnet-funding/wallet.ts'
import type { Provider } from '../src/testnet-funding/wallet.ts'

export type Result = { address:string; profileId:string; sourceLabel:string; targetChainId:number; rpcChainId:number|null; startedAt:number; checkedAt:number|null; expiresAt:number; network:Item; account:Item; deployment:Item; roles:Item; block?:{number:number;hash:string;timestamp:number} }
export type Item={status:string;reason:string;balanceWei?:string;hasCode?:boolean}
export type State={status:string;account?:string;chain?:string;result?:Result;error?:string;busy:boolean}
export class Readiness {
  state:State={status:'未连接',busy:false}
  private provider?:Provider; private generation=0; private disposed=false; private connecting=false
  private listeners=new Set<()=>void>(); private abort?:AbortController
  private changed=()=>{this.generation++;this.abort?.abort();this.set({status:'钱包状态已改变，请重新连接并核验',busy:false})}
  private injected:()=>Provider|undefined; private transport:typeof fetch; private now:()=>number; private timing:{connect:number;read:number;http:number}
  constructor(injected:()=>Provider|undefined,transport:typeof fetch=fetch,now=()=>Date.now(),timing={connect:60000,read:5000,http:21000}){this.injected=injected;this.transport=transport;this.now=now;this.timing=timing}
  subscribe(fn:()=>void){this.listeners.add(fn);return ()=>{this.listeners.delete(fn)}}
  private set(value:State){if(this.disposed)return;this.state=value;this.listeners.forEach(fn=>fn())}
  private async request(method:'eth_requestAccounts'|'eth_accounts'|'eth_chainId',timeout:number):Promise<unknown>{
    if(!['eth_requestAccounts','eth_accounts','eth_chainId'].includes(method))throw Error('METHOD_DENIED')
    let timer:ReturnType<typeof setTimeout>|undefined
    try{return await Promise.race([this.provider!.request({method}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('WALLET_TIMEOUT')),timeout)})])}
    finally{clearTimeout(timer)}
  }
  private live(g:number){return !this.disposed&&g===this.generation}
  async connect(){
    if(this.state.busy||this.connecting||this.disposed)return
    const g=++this.generation;this.set({status:'等待本人确认连接',busy:true});this.connecting=true
    try{
      if(!this.provider){this.provider=selectMetaMask(this.injected());for(const event of ['accountsChanged','chainChanged','disconnect'])this.provider.on!(event,this.changed)}
      const account=firstAccount(await this.request('eth_requestAccounts',this.timing.connect))
      if(!this.live(g))return
      const current=firstAccount(await this.request('eth_accounts',this.timing.read))
      const chain=await this.request('eth_chainId',this.timing.read)
      if(typeof chain!=='string'||!/^0x[0-9a-f]+$/i.test(chain))throw Error('WALLET_SCHEMA')
      if(current.toLowerCase()!==account.toLowerCase())throw Error('ACCOUNT_CHANGED')
      if(this.live(g))this.set({status:'已连接地址（未证明账户控制权）',account:current,chain,busy:false})
    }catch(e){if(this.live(g))this.set({status:'连接未完成',busy:false,error:this.code(e)})}
    finally{this.connecting=false}
  }
  private code(e:unknown){const v=e as {message?:string;code?:string|number};return v.code===4001?'USER_REJECTED':['METAMASK_NOT_FOUND','WALLET_AMBIGUOUS','WALLET_EVENTS_UNAVAILABLE'].includes(String(v.code||v.message))?String(v.code||v.message):['WALLET_TIMEOUT','WALLET_SCHEMA','ACCOUNT_CHANGED','WRONG_CHAIN','RPC_NOT_CONFIGURED','CHECK_UNAVAILABLE','RATE_LIMIT','RESULT_INVALID'].includes(v.message||'')?v.message!:'CHECK_UNAVAILABLE'}
  async check(){
    if(this.disposed||this.state.busy||!this.state.account||!this.provider)return
    const account=this.state.account;const chain=this.state.chain;const g=++this.generation
    this.abort?.abort();this.abort=new AbortController();const abort=this.abort
    this.set({status:'正在进行只读检查',account,chain,busy:true})
    let timer:ReturnType<typeof setTimeout>|undefined
    try{
      const current=firstAccount(await this.request('eth_accounts',this.timing.read));const actual=await this.request('eth_chainId',this.timing.read)
      if(!this.live(g))return
      if(current.toLowerCase()!==account.toLowerCase()||actual!==chain)throw Error('ACCOUNT_CHANGED')
      if(actual!=='0x279f')throw Error('WRONG_CHAIN')
      timer=setTimeout(()=>abort.abort(),this.timing.http)
      const response=await this.transport('/api/cp26/check',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',cache:'no-store',body:JSON.stringify({address:account}),signal:abort.signal})
      const data=await response.json()
      if(!response.ok)throw Error(['RPC_NOT_CONFIGURED','RATE_LIMIT'].includes(data.code)?data.code:'CHECK_UNAVAILABLE')
      if(!data||data.address?.toLowerCase()!==account.toLowerCase()||data.targetChainId!==10143||!Number.isFinite(data.expiresAt)||data.expiresAt*1000<=this.now()||data.expiresAt-data.startedAt!==60||!['PASS','FAIL','NOT_CHECKED'].includes(data.network?.status)||!['PASS','FAIL','NOT_CHECKED'].includes(data.account?.status)||data.deployment?.status!=='NOT_CONFIGURED'||data.roles?.status!=='NOT_CHECKED')throw Error('RESULT_INVALID')
      // Re-read the wallet after RPC completes; event delivery alone is not enough.
      const after=firstAccount(await this.request('eth_accounts',this.timing.read));const afterChain=await this.request('eth_chainId',this.timing.read)
      if(after.toLowerCase()!==account.toLowerCase()||afterChain!==chain)throw Error('ACCOUNT_CHANGED')
      if(data.expiresAt*1000<=this.now())throw Error('RESULT_INVALID')
      if(this.live(g))this.set({status:'只读检查已返回，结果按项显示',account,chain,result:data,busy:false})
    }catch(e){if(this.live(g)){const error=this.code(e);this.set({status:'本次检查未完成，旧结果已失效',...(error==='ACCOUNT_CHANGED'?{}:{account,chain}),busy:false,error})}}
    finally{clearTimeout(timer)}
  }
  expire(){if(this.state.result&&this.state.result.expiresAt*1000<=this.now()){this.generation++;this.set({...this.state,result:undefined,status:'观察结果已过期，请重新核验'})}}
  dispose(){this.disposed=true;this.generation++;this.abort?.abort();for(const event of ['accountsChanged','chainChanged','disconnect'])this.provider?.removeListener?.(event,this.changed);this.listeners.clear()}
}
