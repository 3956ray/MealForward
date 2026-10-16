// A successful HTTP status is not proof that the authenticated source returned
// real meal, order, claim or voucher records. Refuse malformed list payloads.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveApi} from './dist/live-api.mjs';
const wallet='0x'+'1'.repeat(40),store='a'.repeat(64),base='https://localhost:16443';
const ok=value=>({ok:true,status:200,json:async()=>value});
function fixture(bad={}){
 const calls=[],storageMap=new Map([['mealforward-live-csrf-v1','local-csrf']]);
 const storage={getItem:k=>storageMap.get(k)||null,setItem:(k,v)=>storageMap.set(k,v),removeItem:k=>storageMap.delete(k)};
 const provider={on(){},removeListener(){},async request({method}){if(method==='eth_accounts')return [wallet];if(method==='eth_chainId')return '0x279f';throw Error('No wallet mutations allowed');}};
 const normal={
  '/v1/connection':{},
  '/v1/identity/setup':{walletLoginEnabled:true,walletLoginChainId:10143,walletLoginOrigin:base},
  '/v1/me':{walletAddress:wallet},
  '/v1/store-registrations':{items:[]},
  '/v1/stores':{items:[]},
  ['/v1/stores/'+store+'/meals']:{items:[]},
  '/v1/my/orders':{items:[]},
  '/v1/my/claims':{items:[]},
  '/v1/my/vouchers':{items:[]},
  '/v1/ledger':{items:[]}
 };
 const fetchImpl=async(path,options)=>{calls.push({path,method:options.method});if(!(path in normal))throw Error('Unexpected API '+path);return ok(path in bad?bad[path]:normal[path]);};
 const api=createLiveApi({fetchImpl,storage,provider:()=>provider,origin:()=>base,onSessionInvalidated(){}});
 return {api,calls};
}
test('all legitimate empty lists are still valid, without any mutations',async()=>{
 const h=fixture();assert.equal((await h.api.getContext()).session.wallet,wallet);
 assert.deepEqual(await h.api.listStores(),[]);
 assert.deepEqual(await h.api.getStoreMeals(store),[]);
 assert.deepEqual(await h.api.getSupportOrders(),[]);
 assert.deepEqual(await h.api.getClaimIntents(),[]);
 assert.deepEqual(await h.api.getMyVouchers(),[]);
 assert.deepEqual((await h.api.getPublicLedger()).items,[]);
 assert.ok(h.calls.every(x=>x.method==='GET'));
});
test('malformed successful public lists are errors, never disguised as empty menus',async()=>{
 for(const path of ['/v1/stores','/v1/stores/'+store+'/meals']){
  for(const invalid of [{}, {items:null}, {items:{}}, {items:'none'}]){
   const h=fixture({[path]:invalid});
   if(path==='/v1/stores')await assert.rejects(h.api.listStores(),{code:'READ_RESPONSE_INVALID'});
   else await assert.rejects(h.api.getStoreMeals(store),{code:'READ_RESPONSE_INVALID'});
   assert.ok(h.calls.every(x=>x.method==='GET'));
  }
 }
});
test('authenticated account lists fail closed when backend returns incomplete records',async()=>{
 for(const [path,method] of [
  ['/v1/my/orders','getSupportOrders'],
  ['/v1/my/claims','getClaimIntents'],
  ['/v1/my/vouchers','getMyVouchers']
 ]){
  const h=fixture({[path]:{status:'OK'}});
  await h.api.getContext();
  await assert.rejects(h.api[method](),{code:'READ_RESPONSE_INVALID'});
  assert.ok(h.calls.every(x=>x.method==='GET'));
 }
});
test('malformed registration listing cannot fabricate anonymous or empty owner records',async()=>{
 const h=fixture({'/v1/store-registrations':{ok:true}});
 await assert.rejects(h.api.getContext(),{code:'READ_RESPONSE_INVALID'});
});
test('a malformed public ledger response keeps the existing ledger-specific error',async()=>{
 const h=fixture({'/v1/ledger':{items:{}}});
 await assert.rejects(h.api.getPublicLedger(),{code:'LEDGER_INVALID'});
});
