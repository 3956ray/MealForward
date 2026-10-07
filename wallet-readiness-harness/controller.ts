import { selectMetaMask, firstAccount } from '../src/testnet-funding/wallet.ts'
import { manifestKey, validManifest, roleNames } from './contract.ts'
import type { Manifest, Roles } from './contract.ts'
import type { Provider } from '../src/testnet-funding/wallet.ts'

export type Result = { address:string; profileId:string; sourceLabel:string; targetChainId:number; rpcChainId:number|null; startedAt:number; checkedAt:number|null; expiresAt:number; network:Item; account:Item; deployment:Item; roles:Roles; manifest?:Manifest|null; newBusinessTarget?:null; block?:{number:number;hash:string;timestamp:number} }
export type Item={status:string;reason:string;balanceWei?:string;hasCode?:boolean;runtimeKeccak?:string}
export type State={status:string;account?:string;chain?:string;result?:Result;error?:string;busy:boolean}
export class Readiness {
  state:State={status:'未连接',busy:false}
  private manifest:Manifest|null=null; private configValid=true; private provider?:Provider; private generation=0; private disposed=false; private connecting=false
  private listeners=new Set<()=>void>(); private abort?:AbortController
  private changed=()=>{this.generation++;this.abort?.abort();this.set({status:'钱包状态已改变，请重新连接并核验',busy:false})}
  private injected:()=>Provider|undefined; private transport:typeof fetch; private now:()=>number; private timing:{connect:number;read:number;http:number}
  constructor(injected:()=>Provider|undefined,transport:typeof fetch=fetch,now=()=>Date.now(),timing={connect:60000,read:5000,http:21000}){this.injected=injected;this.transport=transport;this.now=now;this.timing=timing}
  configure(manifest:Manifest|null){
    let valid=false
    try{valid=validManifest(manifest)}catch{/* malformed server configuration fails closed */}
    if(!valid||manifestKey(manifest)!==manifestKey(this.manifest)){
      this.generation++;this.abort?.abort()
      this.set({status:valid?'历史部署配置已更新，请重新核验':'历史部署配置不可用',account:this.state.account,chain:this.state.chain,busy:false})
    }
    this.configValid=valid;this.manifest=valid?manifest:null
  }
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
    if(!this.configValid){this.set({...this.state,result:undefined,error:'RESULT_INVALID'});return}
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
      const transport=this.transport
      const response=await transport('/api/cp26/check',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',cache:'no-store',body:JSON.stringify({address:account}),signal:abort.signal})
      const data=await response.json()
      if(!response.ok)throw Error(['RPC_NOT_CONFIGURED','RATE_LIMIT'].includes(data.code)?data.code:'CHECK_UNAVAILABLE')
      if(!data||data.address?.toLowerCase()!==account.toLowerCase()||data.targetChainId!==10143||!Number.isFinite(data.expiresAt)||data.expiresAt*1000<=this.now()||data.expiresAt-data.startedAt!==60||!['PASS','FAIL','NOT_CHECKED'].includes(data.network?.status)||!['PASS','FAIL','NOT_CHECKED'].includes(data.account?.status))throw Error('RESULT_INVALID')
      if(!Number.isFinite(data.startedAt)||!Number.isFinite(data.checkedAt)&&data.checkedAt!==null||data.startedAt*1000>this.now()+5000)throw Error('RESULT_INVALID')
      if(data.profileId!=='monad-testnet-readonly-cp26-v1')throw Error('RESULT_INVALID')
      if(data.network.status==='PASS'&&(data.rpcChainId!==10143||!data.block||!Number.isSafeInteger(data.block.number)||data.block.number<0||!/^0x[0-9a-f]{64}$/i.test(data.block.hash)||!Number.isFinite(data.block.timestamp)||!Number.isFinite(data.checkedAt)||data.checkedAt<data.startedAt||data.checkedAt>=data.expiresAt))throw Error('RESULT_INVALID')
      if(this.manifest){
        if(!data.manifest||!validManifest(data.manifest)||manifestKey(data.manifest)!==manifestKey(this.manifest)||data.newBusinessTarget!==null||!['PASS','FAIL','NOT_CHECKED'].includes(data.deployment?.status)||!['OBSERVED','NOT_CHECKED'].includes(data.roles?.status))throw Error('RESULT_INVALID')
        if(data.deployment.status==='PASS'&&(data.network.status!=='PASS'||data.deployment.runtimeKeccak!==this.manifest.expectedRuntimeKeccak))throw Error('RESULT_INVALID')
        if(data.roles.status==='OBSERVED'){
          const r=data.roles
          if(data.network.status!=='PASS'||data.deployment.status!=='PASS'||!data.block||!Number.isSafeInteger(data.block.number)||data.block.number<0||!/^0x[0-9a-f]{64}$/i.test(data.block.hash)||!Number.isFinite(data.block.timestamp)||!Number.isFinite(data.checkedAt)||data.checkedAt<data.startedAt||data.checkedAt>=data.expiresAt||!r.values||Object.keys(r.values).length!==5||!roleNames.every(n=>typeof r.values[n]==='boolean')||r.merchant?.toLowerCase()!==this.manifest.expectedMerchant.toLowerCase()||r.merchantMatches!==(r.merchant.toLowerCase()===account.toLowerCase())||typeof r.paused!=='boolean'||r.ruleVersion!==this.manifest.expectedRuleVersion)throw Error('RESULT_INVALID')
        }else if(['values','merchant','merchantMatches','paused','ruleVersion'].some(k=>Object.hasOwn(data.roles,k)))throw Error('RESULT_INVALID')
      }else if(data.manifest!=null||data.deployment?.status!=='NOT_CONFIGURED'||data.roles?.status!=='NOT_CHECKED')throw Error('RESULT_INVALID')
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
