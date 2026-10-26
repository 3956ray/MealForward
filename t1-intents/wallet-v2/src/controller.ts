import {CHAIN_ID,OWNER,DONOR,type PublicState,type Role} from './contract.ts';
import type {WalletPort,WalletObservation} from './wallet.ts';
import type {ApprovalApi} from './api.ts';

type Phase='idle'|'loading'|'ready'|'error';
export type ControllerSnapshot={
 wallet:{phase:Phase;providers:ReturnType<WalletPort['providers']>;account:string|null;chainId:number|null;role:Role|null;code:string|null;progress:string};
 backend:{phase:Phase;code:string|null;progress:string;validated:boolean};
 round:{state:PublicState|null;canSign:boolean;reason:string;progress:string;uncertain:boolean};
 diagnostic:string;
};
type Timers={setTimeout:(callback:()=>void,delay:number)=>ReturnType<typeof setTimeout>;clearTimeout:(id:ReturnType<typeof setTimeout>)=>void};
type Options={wallet:WalletPort;api:ApprovalApi;validate:(value:unknown,now:number)=>PublicState;render:(state:ControllerSnapshot)=>void;clock?:()=>number;timers?:Timers;reportMs?:number;promptMs?:number;signingEnabled?:boolean;buildId?:string};
const safeCode=(error:unknown,prefix:string)=>{
 const message=error instanceof Error?error.message:'';
 return /^(API|WALLET|VALIDATION)_[A-Z0-9_]+$/.test(message)?message:prefix;
};
const roundKey=(state:PublicState|null)=>state?.round?state.round.id+':'+state.round.digest:null;
const roleFor=(account:string|null):Role|null=>account?.toLowerCase()===OWNER?'owner':account?.toLowerCase()===DONOR?'donor':null;

/** All signing decisions use a validated server state and a current wallet observation. */
export function createController({wallet,api,validate,render,clock=()=>Math.floor(Date.now()/1000),timers=globalThis,reportMs=10000,promptMs=30000,signingEnabled=false,buildId='wallet-v2'}:Options){
 let walletPhase:Phase='idle',backendPhase:Phase='idle';
 let walletCode:string|null=null,backendCode:string|null=null;
 let walletProgress='选择钱包后检查当前账户',backendProgress='等待服务读取',roundProgress='尚未读取正式轮次';
 let observed:WalletObservation={account:null,chainId:null};
 let state:PublicState|null=null;
 let validatedFresh=false,validationCode:string|null=null;
 let selected=false,walletGeneration=0,apiGeneration=0;
 let walletBusy=false,signBusy=false,walletBusyKind:'inspect'|'connect'|null=null;
 let uncertain:{key:string;role:Role;pending:boolean}|null=null;
 let apiAbort:AbortController|null=null;
 let expiryTimer:ReturnType<typeof setTimeout>|null=null;
 let started=clock();
 const publish=()=>render(snapshot());
 function scheduleExpiry(){
  if(expiryTimer)timers.clearTimeout(expiryTimer);
  expiryTimer=null;
  if(!state?.round)return;
  const delay=(state.round.expiresAt-clock())*1000;
  if(delay<=0)return;
  expiryTimer=timers.setTimeout(()=>{expiryTimer=null;roundProgress='轮次已过期';publish()},delay);
  (expiryTimer as unknown as {unref?:()=>void}).unref?.();
 }
 function readiness(){
  if(backendPhase!=='ready')return 'BACKEND_UNAVAILABLE';
  if(!validatedFresh)return validationCode||'VALIDATION_UNAVAILABLE';
  if(!state?.round)return 'NO_ROUND';
  if(state.status==='EXPIRED'||clock()>=state.round.expiresAt)return 'EXPIRED';
  if(state.status==='COLLECTED_NO_RELEASE')return 'COLLECTED_NO_RELEASE';
  if(state.status!=='COLLECTING')return 'ROUND_NOT_COLLECTING';
  if(uncertain?.key===roundKey(state))return 'RESULT_UNCERTAIN';
  if(!signingEnabled)return 'SIGNING_HELD';
  if(signBusy||walletBusy)return 'WALLET_BUSY';
  if(walletPhase!=='ready'||!observed.account)return 'WALLET_UNAVAILABLE';
  if(observed.chainId!==CHAIN_ID)return 'WRONG_CHAIN';
  const role=roleFor(observed.account);
  if(!role)return 'WRONG_ROLE';
  if(state.roles[role])return 'ALREADY_RECORDED';
  return 'READY';
 }
 function snapshot():ControllerSnapshot{
  const reason=readiness();
  return {
   wallet:{phase:walletPhase,providers:wallet.providers(),account:observed.account,chainId:observed.chainId,role:roleFor(observed.account),code:walletCode,progress:walletProgress},
   backend:{phase:backendPhase,code:backendCode,progress:backendProgress,validated:validatedFresh},
   round:{state,canSign:reason==='READY',reason,progress:roundProgress,uncertain:uncertain?.key===roundKey(state)},
   diagnostic:`build=${buildId} phase=${walletPhase}/${backendPhase}/${reason} elapsed=${Math.max(0,clock()-started)}s code=${walletCode||backendCode||validationCode||'NONE'}`
  };
 }
 function walletChanged(){
  if(walletBusyKind!=='connect')walletGeneration++;
  observed={account:null,chainId:null};
  walletPhase='idle';walletProgress='钱包状态已变化，请重新检查';walletCode=null;
  publish();
 }
 function selectProvider(id:string){
  walletGeneration++;
  walletChanged();
  try{wallet.select(id);selected=true;walletProgress='已选择钱包，可检查账户';}
  catch(error){selected=false;walletPhase='error';walletCode=safeCode(error,'WALLET_SELECT');walletProgress='选择钱包失败';}
  publish();
 }
 async function walletAction(kind:'inspect'|'connect'){
  if(walletBusy||signBusy)return;
  if(!selected){walletPhase='error';walletCode='WALLET_NO_PROVIDER';walletProgress='请先选择钱包';publish();return;}
  walletBusy=true;walletBusyKind=kind;const generation=++walletGeneration;
  walletPhase='loading';walletCode=null;walletProgress=kind==='inspect'?'正在检查当前账户和网络':'正在等待钱包连接许可';publish();
  const report=timers.setTimeout(()=>{if(generation===walletGeneration){walletProgress=kind==='inspect'?'钱包检查仍在等待':'钱包许可仍待处理；请查看扩展';publish()}},kind==='inspect'?reportMs:promptMs);
  try{
   const result=await wallet[kind]();
   if(generation!==walletGeneration)return;
   observed=result;walletPhase='ready';walletProgress=result.account?'已读取当前钱包':'尚未授权当前账户；可显式连接';
  }catch(error){
   if(generation!==walletGeneration)return;
   observed={account:null,chainId:null};walletPhase='error';walletCode=safeCode(error,'WALLET_ERROR');walletProgress=kind==='inspect'?'检查失败':'连接未完成';
  }finally{timers.clearTimeout(report);walletBusy=false;walletBusyKind=null;publish()}
 }
 async function refresh(){
  const generation=++apiGeneration;
  apiAbort?.abort();apiAbort=new AbortController();
  validatedFresh=false;validationCode=null;
  backendPhase='loading';backendCode=null;backendProgress='正在读取服务状态';roundProgress='正在核对正式轮次';publish();
  const report=timers.setTimeout(()=>{if(generation===apiGeneration){backendProgress='服务仍在等待响应';publish()}},reportMs);
  try{
   const value=await api.read(apiAbort.signal);
   if(generation!==apiGeneration)return;
   backendPhase='ready';backendProgress='服务已响应';
   try{
    const fresh=validate(value,clock());
    state=fresh;scheduleExpiry();validatedFresh=true;roundProgress=fresh.round?'已核对正式轮次与摘要':'尚无正式轮次';
    if(uncertain&&roundKey(fresh)===uncertain.key){
     if(fresh.roles[uncertain.role]||(fresh.status==='COLLECTING'&&!uncertain.pending))uncertain=null;
    }
   }catch(error){
    validationCode=safeCode(error,'VALIDATION_INVALID_STATE');
    roundProgress='服务已响应，轮次校验不可用；签名已关闭';
   }
  }catch(error){
   if(generation!==apiGeneration)return;
   backendPhase='error';backendCode=safeCode(error,'BACKEND_ERROR');backendProgress='服务读取失败；请手动重试';roundProgress='最近轮次仅供查看，签名已关闭';
  }finally{timers.clearTimeout(report);if(generation===apiGeneration){apiAbort=null;publish()}}
 }
 async function inspectCurrent(){
  const result=await wallet.inspect();
  if(result.account!==observed.account||result.chainId!==observed.chainId)throw Error('WALLET_CONTEXT');
  if(result.chainId!==CHAIN_ID||!roleFor(result.account))throw Error('WALLET_CONTEXT');
  return result;
 }
 async function sign(){
  if(readiness()!=='READY'||signBusy)return;
  const original=state!;const key=roundKey(original)!;
  const account=observed.account!;const role=roleFor(account)!;
  const generation=walletGeneration,apiAtStart=apiGeneration;
  const ownsApi=()=>generation===walletGeneration&&apiAtStart===apiGeneration;
  signBusy=true;roundProgress='正在核对钱包与服务轮次';publish();
  let promptTimer:ReturnType<typeof setTimeout>|null=null;
  try{
   await inspectCurrent();
   let fresh:PublicState;
   try{
    const value=await api.read();
    if(!ownsApi())return;
    fresh=validate(value,clock());
   }catch(error){
    if(ownsApi()){backendPhase='error';backendCode=safeCode(error,'BACKEND_PREFLIGHT');validatedFresh=false}
    throw error;
   }
   if(!ownsApi())return;
   if(roundKey(fresh)!==key){backendPhase='error';backendCode='VALIDATION_CONTEXT';validatedFresh=false;throw Error('VALIDATION_CONTEXT')}
   if(fresh.status!=='COLLECTING'||fresh.roles[role]||clock()>=fresh.round!.expiresAt)throw Error('VALIDATION_CONTEXT');
   state=fresh;scheduleExpiry();backendPhase='ready';validatedFresh=true;
   await inspectCurrent();
   if(!ownsApi()||clock()>=fresh.round!.expiresAt)throw Error('VALIDATION_CONTEXT');
   roundProgress='等待钱包签名；请查看扩展';publish();
   promptTimer=timers.setTimeout(()=>{roundProgress='签名请求仍待处理；不会重复弹窗';publish()},promptMs);
   const signature=await wallet.sign(fresh.round!.typedData,account);
   if(!ownsApi()||clock()>=fresh.round!.expiresAt)return;
   await inspectCurrent();
   if(!ownsApi()||clock()>=fresh.round!.expiresAt)return;
   roundProgress='签名已返回，正在保存批准记录';publish();
   const pending={key,role,pending:true};
   uncertain=pending;
   try{
    const value=await api.submit({role,roundId:fresh.round!.id,digest:fresh.round!.digest,signature});
    pending.pending=false;
    if(!ownsApi())return;
    const result=validate(value,clock());
    if(roundKey(result)!==key)throw Error('VALIDATION_CONTEXT');
    state=result;scheduleExpiry();backendPhase='ready';validatedFresh=true;roundProgress=result.roles[role]?'服务已记录批准':'服务未确认批准';
    if(result.roles[role]&&uncertain===pending)uncertain=null;
   }catch{
    pending.pending=false;
    if(!ownsApi())return;
    roundProgress='提交结果不确定，正在读取服务确认';publish();
    try{
     const value=await api.read();
     if(!ownsApi())return;
     const result=validate(value,clock());
     if(roundKey(result)!==key)throw Error('VALIDATION_CONTEXT');
     state=result;scheduleExpiry();backendPhase='ready';validatedFresh=true;
     if(uncertain===pending)uncertain=null;
     roundProgress=result.roles[role]?'服务已确认批准记录':'服务未记录批准；需要新的明确操作';
    }catch(error){
     if(!ownsApi())return;
     backendPhase='error';backendCode=safeCode(error,'BACKEND_READBACK');validatedFresh=false;roundProgress='无法确认提交结果，签名保持关闭';
    }
   }
  }catch(error){
   if(ownsApi()){roundProgress='签名未完成';walletCode=safeCode(error,'SIGN_ABORTED')}
  }finally{
   if(promptTimer)timers.clearTimeout(promptTimer);
   signBusy=false;publish();
  }
 }
 publish();
 return {snapshot,selectProvider,inspect:()=>walletAction('inspect'),connect:()=>walletAction('connect'),refresh,sign,walletChanged,dispose:()=>{walletGeneration++;apiGeneration++;apiAbort?.abort();if(expiryTimer)timers.clearTimeout(expiryTimer);wallet.dispose()}};
}
export {createApprovalApi} from './api.ts';
