import {createExecutionController} from './t1f-execution-controller.mjs';
const WALLETS={owner:'0xc4f8a468f10d5f98dcff3282516125e97f26433b',donor:'0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952',issuer:'0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3'};
const check=x=>{if(!x)throw Error('PHASE8_CONTEXT_UNCONFIRMED')};
const key=s=>s?.round?`${s.round.id}:${s.round.digest}`:null;
export function createPhase8Controller({provider,request,crypto,cryptoReady=()=>true,origin,clock=()=>Math.floor(Date.now()/1000),render=()=>{},timeoutMs=60000}={}){
 let state=null,valid=false,account=null,chainId=null,busy=false,walletBusy=false,error=null,revision=0,disposed=false,issuer;
 const role=()=>Object.keys(WALLETS).find(k=>WALLETS[k]===account)||null;
 const eligible=()=>valid&&!disposed&&!busy&&!walletBusy&&!issuer?.snapshot().busy&&cryptoReady()&&chainId===10143&&['owner','donor'].includes(role())&&state?.round&&!state.operation&&!state.round.roles[role()]&&clock()<state.round.prepareBefore;
 const snapshot=()=>({state,valid,account,chainId,role:role(),busy,walletBusy,error,canApprove:!!eligible(),issuer:issuer?.snapshot()||null});
 const notify=()=>{if(!disposed)render(snapshot())};
 const stable=v=>check(!disposed&&v===revision);
 const wait=async(p,v)=>{let timer;try{const x=await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('PHASE8_REQUEST_TIMEOUT')),timeoutMs)})]);stable(v);return x;}finally{clearTimeout(timer)}};
 const changed=()=>{revision++;account=null;chainId=null;notify()};
 for(const event of ['accountsChanged','chainChanged','disconnect'])provider?.on?.(event,changed);
 const inspectWallet=async v=>{check(provider?.request);const a=await wait(provider.request({method:'eth_accounts'}),v),c=await wait(provider.request({method:'eth_chainId'}),v);check(Array.isArray(a)&&(a.length===0||typeof a[0]==='string'&&/^0x[0-9a-fA-F]{40}$/.test(a[0]))&&typeof c==='string'&&/^0x[0-9a-fA-F]+$/.test(c));account=a[0]?.toLowerCase()||null;chainId=Number(BigInt(c));};
 const validate=raw=>{check(cryptoReady());crypto.validatePhase8(raw,clock());state=raw;valid=true;return raw;};
 const adapter=async(path,method,body,token)=>{
  const v=revision,mapped=path.replace('/v1/t1f/successor/','/v1/t1f/phase8/');
  const raw=await request(mapped,method,body,token);stable(v);
  if(!path.startsWith('/v1/t1f/successor/'))return raw;
  try{check(cryptoReady());const dto=crypto.executionDTO(raw,clock(),{prepare:path.endsWith('/prepare')});const {transaction,created,...safe}=raw;state=safe;valid=true;return dto;}catch(e){valid=false;throw e;}
 };
 issuer=createExecutionController({provider,request:adapter,hashData:d=>{check(cryptoReady());return crypto.hashData(d)},origin,clock,timeoutMs,render:notify});
 const run=async fn=>{check(!busy&&!issuer.snapshot().busy);busy=true;error=null;notify();try{return await fn(revision)}catch(e){error=/^PHASE8_[A-Z0-9_]+$/.test(e?.message)?e.message:'PHASE8_ACTION_UNCONFIRMED';throw e;}finally{busy=false;notify()}};
 const inspect=async()=>{check(!walletBusy);walletBusy=true;error=null;notify();try{await inspectWallet(revision);if(role()==='issuer'&&chainId===10143)await issuer.inspect();}catch(e){account=null;chainId=null;error='PHASE8_WALLET_UNCONFIRMED';throw e;}finally{walletBusy=false;notify()}};
 return Object.freeze({snapshot,issuer,
  invalidate(){disposed=true;revision++;issuer.invalidate();},
  inspect,
  connect:()=>run(async()=>{check(provider?.request);let timer;try{await Promise.race([provider.request({method:'wallet_requestPermissions',params:[{eth_accounts:{}}]}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('PHASE8_REQUEST_TIMEOUT')),timeoutMs)})]);}finally{clearTimeout(timer)}check(!disposed);await inspectWallet(revision);if(role()==='issuer'&&chainId===10143)await issuer.inspect();}),
  refresh:()=>run(async()=>{valid=false;await issuer.refresh();}),
  approve:async()=>{check(eligible());const selected=key(state),selectedRole=role(),selectedAccount=account;return run(async v=>{
   const assertWallet=async()=>{await inspectWallet(v);check(account===selectedAccount&&role()===selectedRole&&chainId===10143)};
   await assertWallet();const fresh=validate(await wait(request('/v1/t1f/phase8/status','GET'),v));check(key(fresh)===selected&&!fresh.operation&&!fresh.round.roles[selectedRole]&&clock()<fresh.round.prepareBefore);
   await assertWallet();check(clock()<fresh.round.prepareBefore);const signature=await wait(provider.request({method:'eth_signTypedData_v4',params:[selectedAccount,JSON.stringify(fresh.round.typedData)]}),v);
   await assertWallet();check(clock()<fresh.round.prepareBefore&&crypto.recoverApproval(fresh.round.typedData,signature)===selectedAccount);
   const result=validate(await wait(request('/v1/t1f/phase8/approval','POST',{roundId:fresh.round.id,digest:fresh.round.digest,role:selectedRole,signature}),v));
   check(key(result)===selected&&result.round.roles[selectedRole]);
  });}
 });
}
