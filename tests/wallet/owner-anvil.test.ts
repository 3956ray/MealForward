import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OwnerWalletController, type OwnerApi, type OwnerDeployment, type OwnerLock } from '../../src/wallet/owner-controller.ts'
import { startOwnerFixture, controlledOwnerProvider } from '../../owner-wallet-harness/test-utils.ts'

test('real owner HTTP identity and external settlement, hash loss finalized through original operation', {skip:process.env.CP16_OWNER_REAL_CHAIN!=='1'},async()=>{
 const fixture=await startOwnerFixture()
 try{
  const {info}=fixture, controlled=controlledOwnerProvider(info.rpcUrl)
  const login=await fetch(info.origin+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:info.origin},body:JSON.stringify({username:'owner-a',password:'local-only-password'})})
  assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')!.split(';')[0],session=await login.json()
  const api:OwnerApi={async request<T>(path:string,body?:Record<string,unknown>):Promise<T>{const r=await fetch(info.origin+'/api/v1'+path,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,Origin:info.origin,'Content-Type':'application/json','X-CSRF-Token':session.csrfToken},body:body===undefined?undefined:JSON.stringify(body)});if(!r.ok)throw new Error('HTTP '+r.status);return r.status===204?undefined as T:await r.json() as T}}
  const deployment=await api.request<OwnerDeployment>('/config'),data=new Map<string,string>(),store={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v)}}
  const lock:OwnerLock=async(_name,fn)=>fn()
  const controller=new OwnerWalletController({deployment,provider:controlled.provider,api,store,origin:info.origin,actorId:session.actorId,lock})
  store.setItem(controller.storageKey,JSON.stringify({redemptionId:info.redemptionId,intentKey:info.intentKey,startAttempted:false}))
  await controller.connect();await controller.verifyIdentity();await controller.review(info.redemptionId)
  controlled.dropHash();const unknown=await controller.send();assert.equal(unknown.startAttempted,true);assert.equal(unknown.txHash,undefined);assert.equal(controlled.counts().sends,1)
  await assert.rejects(controller.send(),/review required/i)
  await controlled.rpc('anvil_mine',['0x80'])
  const tick=await fetch(info.origin+'/__test/tick',{method:'POST',headers:{Origin:info.origin,'Content-Type':'application/json'},body:'{}'});assert.equal(tick.status,200)
  const final=await controller.recover();assert.equal(final.view?.operation.status,'FINALIZED_SUCCESS');assert(final.view?.operation.txHash);assert.equal(controlled.counts().sends,1)
 }finally{await fixture.stop()}
})
