import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeFunctionData, keccak256, type Hex } from 'viem'
import { mealForwardAbi } from '../../src/chain-contract.ts'
import { OwnerWalletController, type OwnerApi, type OwnerView, type OwnerLock } from '../../src/wallet/owner-controller.ts'
import type { Provider } from '../../src/wallet/controller.ts'
const address='0x'+'1'.repeat(40), contract='0x'+'2'.repeat(40), op='0x'+'3'.repeat(64), voucher='0x'+'4'.repeat(64)
const txHash='0x'+'5'.repeat(64), genesisHash='0x'+'6'.repeat(64), code='0x6000' as Hex
const deployment={mode:'localchain',chainId:31337,deploymentId:'owner-test',contractAddress:contract,codeHash:keccak256(code),genesisHash,merchant:address,priceWei:'1000000000000000',ownerWalletMode:true}
function fixture(){
 let now=1000, account=address, chain='0x7a69', fault='', sent=0, starts=0, proof=false, logout=0
 const methods:string[]=[], data=new Map<string,string>(), handlers=new Map<string,Set<(...args:unknown[])=>void>>()
 const store={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v)}}
 let tail=Promise.resolve()
 const lock:OwnerLock=async(_name,action)=>{const old=tail;let release!:()=>void;tail=new Promise<void>(r=>release=r);await old;try{return await action()}finally{release()}}
 let view:OwnerView={operation:{id:op,action:'settle',target:voucher,status:'PREPARED'},intent:{operationId:op,from:address,to:contract,chainId:31337,data:encodeFunctionData({abi:mealForwardAbi,functionName:'settle',args:[op as Hex,voucher as Hex]}),value:'0',merchant:address,amountWei:deployment.priceWei,gasSeparate:true,reviewExpiresAt:1300,submissionStarted:false}}
 const clone=()=>structuredClone(view)
 const provider:Provider={on(event,fn){if(!handlers.has(event))handlers.set(event,new Set());handlers.get(event)!.add(fn)},removeListener(event,fn){handlers.get(event)?.delete(fn)},async request({method}){
  methods.push(method)
  if(method==='eth_requestAccounts'||method==='eth_accounts')return [account]
  if(method==='eth_chainId')return chain
  if(method==='eth_getCode')return code
  if(method==='eth_getBlockByNumber')return {hash:genesisHash}
  if(method==='personal_sign')return '0x'+'7'.repeat(130)
  if(method==='eth_sendTransaction'){sent++;if(fault==='reject')throw {code:4001};if(fault==='disconnect')throw {code:4900};if(fault==='missing')return null;return txHash}
  throw new Error(method)
 }}
 const api:OwnerApi={async request<T>(path:string,body?:Record<string,unknown>):Promise<T>{
  if(path==='/work/wallet/logout'){logout++;proof=false;return undefined as T}
  if(path==='/work/wallet/challenge'){const fields={origin:'http://127.0.0.1:9876',chainId:31337,deploymentId:deployment.deploymentId,contract,shopId:'shop-local',actorId:'owner-a',sessionId:'opaque-session',address,challengeId:'challenge',expiresAt:now+300};return {challengeId:'challenge',address,expiresAt:now+300,message:'Mealforward owner identity only; no transaction or settlement authorization.\n'+JSON.stringify(fields)} as T}
  if(path==='/work/wallet/verify'){proof=true;return {verified:true,address,expiresAt:now+1800} as T}
  if(path.includes('/payables/')){if(!proof)throw new Error('proof required');return clone() as T}
  if(path.endsWith('/submission-start')){starts++;const maySubmit=!view.intent.submissionStarted;view={...view,operation:{...view.operation,status:'SUBMISSION_UNKNOWN'},intent:{...view.intent,submissionStarted:true}};if(fault==='lost-start')throw new Error('response lost');return {...clone(),maySubmit:fault==='denied-start'?false:maySubmit} as T}
  if(path.endsWith('/transaction')){if(fault==='association')throw new Error('association unavailable');assert.equal(body?.txHash,txHash);view.operation.txHash=txHash;return clone() as T}
  return clone() as T
 }}
 const create=()=>new OwnerWalletController({deployment,provider,api,store,origin:'http://127.0.0.1:9876',actorId:'owner-a',lock,now:()=>now})
 const controller=create();controller.attach()
 return {controller,provider,api,store,create,methods,lock,setFault:(v:string)=>{fault=v},advance:(n:number)=>{now+=n},setView:(v:OwnerView)=>{view=v},view:clone,
  counts:()=>({sent,starts,logout}),emit:(event:string)=>{for(const fn of handlers.get(event)??[])fn()},switchAccount:()=>{account='0x'+'8'.repeat(40)},switchChain:()=>{chain='0x1'}}
}
async function ready(f:ReturnType<typeof fixture>){await f.controller.connect();await f.controller.verifyIdentity();return f.controller.review('redemption-1')}

test('construction, recovery and identity proof never request a transaction; signing is explicit',async()=>{
 const f=fixture();assert.deepEqual(f.methods,[]);await f.controller.connect();assert(!f.methods.includes('personal_sign'))
 await f.controller.verifyIdentity();assert.equal(f.methods.filter(m=>m==='personal_sign').length,1)
 const j=await f.controller.review('redemption-1');assert.equal(j.view?.operation.id,op);assert.equal(f.counts().sent,0)
 await f.controller.send();assert.deepEqual({sent:f.counts().sent,starts:f.counts().starts},{sent:1,starts:1})
 const saved=f.store.getItem(f.controller.storageKey)!;assert(!saved.includes('maySubmit'));assert(!saved.includes('signature'));assert(!saved.includes('csrf'));assert(!saved.includes('opaque-session'))
 await assert.rejects(f.controller.send(),/review required/i);assert.equal(f.counts().sent,1)
})
for(const fault of ['reject','disconnect','missing','lost-start','denied-start'])test(`${fault} after start is permanently query-only, including reload`,async()=>{
 const f=fixture();await ready(f);f.setFault(fault);const result=await f.controller.send();assert.equal(result.startAttempted,true)
 assert.equal(f.counts().sent,['lost-start','denied-start'].includes(fault)?0:1)
 const reloaded=f.create();await reloaded.recover();await assert.rejects(reloaded.send(),/review required/i)
 await reloaded.connect();await reloaded.verifyIdentity();await assert.rejects(reloaded.review('redemption-1'),/original operation only/)
 assert.equal(f.counts().starts,1)
})
test('known hash survives failed association and only that hash can be re-reported',async()=>{
 const f=fixture();await ready(f);f.setFault('association');assert.equal((await f.controller.send()).txHash,txHash)
 f.setFault('');assert.equal((await f.controller.associateKnownHash()).view?.operation.txHash,txHash);assert.equal(f.counts().sent,1)
})
test('storage failure before submission-start prevents both start and signing',async()=>{
 const f=fixture();await ready(f);f.store.setItem=()=>{throw new Error('disk unavailable')}
 await assert.rejects(f.controller.send(),/disk unavailable/);assert.equal(f.counts().sent,0);assert.equal(f.counts().starts,0)
})
test('two tabs sharing journal and lock cannot obtain two wallet calls',async()=>{
 const f=fixture();await ready(f);const second=f.create();await second.connect();await second.verifyIdentity();await second.review('redemption-1')
 const outcomes=await Promise.allSettled([f.controller.send(),second.send()]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.counts().sent,1);assert.equal(f.counts().starts,1)
})
for(const event of ['accountsChanged','chainChanged','disconnect'])test(`${event} invalidates review and revokes backend proof`,async()=>{
 const f=fixture();await ready(f);f.emit(event);await f.controller.logout();assert.equal(f.controller.reviewed,false);assert.equal(f.controller.verified,false)
 await assert.rejects(f.controller.send(),/review required/i);assert.equal(f.counts().sent,0);assert(f.counts().logout>=2)
})
test('silent account/chain change and review expiry prevent start',async()=>{
 for(const mutate of [(f:ReturnType<typeof fixture>)=>f.switchAccount(),(f:ReturnType<typeof fixture>)=>f.switchChain(),(f:ReturnType<typeof fixture>)=>f.advance(300)]){
  const f=fixture();await ready(f);mutate(f);await assert.rejects(f.controller.send());assert.equal(f.counts().starts,0)
 }
})
test('event during start response prevents wallet invocation but preserves original unknown',async()=>{
 const f=fixture();await ready(f);const original=f.api.request.bind(f.api)
 f.api.request=async(path,body)=>{const value=await original(path,body);if(path.endsWith('/submission-start'))f.emit('accountsChanged');return value as never}
 const result=await f.controller.send();assert.equal(result.startAttempted,true);assert.equal(f.counts().sent,0);assert.equal(f.counts().starts,1)
})
test('late identity verification cannot reinstate proof after a wallet event',async()=>{
 const f=fixture();await f.controller.connect();const original=f.api.request.bind(f.api)
 f.api.request=async(path,body)=>{const value=await original(path,body);if(path==='/work/wallet/verify')f.emit('chainChanged');return value as never}
 await assert.rejects(f.controller.verifyIdentity(),/Identity review changed/);assert.equal(f.controller.verified,false);assert(f.counts().logout>=2)
})
test('backend intent tampering is rejected before any transaction',async()=>{
 for(const field of ['to','from','merchant','value','amountWei','chainId','data','operationId'] as const){
  const f=fixture();await f.controller.connect();await f.controller.verifyIdentity();const view=f.view()
  ;(view.intent as unknown as Record<string,unknown>)[field]=field==='chainId'?1:field==='data'?'0xdeadbeef':field==='value'?'1':'0x'+'9'.repeat(40)
  f.setView(view);await assert.rejects(f.controller.review('redemption-1'));assert.equal(f.counts().starts,0);assert.equal(f.counts().sent,0)
 }
})
test('lost prepare response recovers same intent key without generating another operation',async()=>{
 const f=fixture();await f.controller.connect();await f.controller.verifyIdentity();const original=f.api.request.bind(f.api)
 f.api.request=async(path,body)=>{const result=await original(path,body);if(path.includes('/payables/'))throw new Error('lost prepare');return result as never}
 await assert.rejects(f.controller.review('redemption-1'),/lost prepare/);const key=f.controller.load()!.intentKey
 f.api.request=original;await f.controller.recover();assert.equal(f.controller.load()!.intentKey,key);assert.equal(f.controller.load()!.view?.operation.id,op);assert.equal(f.counts().sent,0)
})

test('wrong local genesis and missing provider events fail closed',async()=>{
 const f=fixture();await ready(f);const original=f.provider.request.bind(f.provider)
 f.provider.request=async args=>args.method==='eth_getBlockByNumber'?{hash:'0x'+'0'.repeat(64)}:original(args)
 await assert.rejects(f.controller.send(),/contract changed/);assert.equal(f.counts().starts,0)
 assert.throws(()=>new OwnerWalletController({deployment,provider:{request:original},api:f.api,store:f.store,origin:'http://127.0.0.1:9876',actorId:'owner-a',lock:f.lock}),/events required/)
})
