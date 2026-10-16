import test from 'node:test';
import assert from 'node:assert/strict';
import {
 verifiedPublicStores,verifiedPublicMeals,verifiedContributions,
 verifiedClaimIntents,verifiedMyVouchers,verifiedVoucher,verifiedPublicLedger
} from './dist/g1-read-contract.mjs';
import {createLiveApi} from './dist/live-api.mjs';

const STORE='a'.repeat(64), MEAL='b'.repeat(64), VOUCHER='0x'+'c'.repeat(64);
const INTENT='22222222-2222-4222-8222-222222222222';
const CLAIM='11111111-1111-4111-8111-111111111111';
const WALLET='0x'+'3'.repeat(40);
const origin='https://localhost:16443';
const copy=value=>structuredClone(value);
const ZERO='0', PRICE='7000000';
function totals(){
 return {F:'14000000',A:PRICE,R:PRICE,H:ZERO,S:ZERO,X:ZERO,liability:'14000000',counts:{F:'2',A:'1',R:'1',H:ZERO,S:ZERO,X:ZERO}};
}
const records=()=>({
 stores:{items:[{id:STORE,store:STORE,name:'Neighborhood Kitchen',controlRevision:'1'}]},
 meals:{items:[{id:MEAL,meal:MEAL,mealId:'0x'+MEAL,store:STORE,name:'Mushroom rice',description:'A warm bowl',version:'1',windows:[[660,780]],unitPrice:PRICE,price:PRICE,listed:true,published:true,eligible:'1',supported:'2',financial:totals()}]},
 contributions:{items:[{id:INTENT,intentId:INTENT,action:'fund',store:STORE,stage:'UNKNOWN',amount:'14000000',quantity:'2',mealId:'0x'+MEAL,transactionHash:null}]},
 claims:{items:[{id:CLAIM,intentId:CLAIM,action:'issue',store:STORE,stage:'FINAL_SUCCEEDED',result:{result:VOUCHER},transactionHash:VOUCHER}]},
 vouchers:{items:[{id:VOUCHER,voucherId:VOUCHER,store:STORE,state:'R',mealId:'0x'+MEAL,generation:'1',version:'1',expiresAt:'1790000000',locked:false,marked:false,pending:false,terms:{name:'Mushroom rice',windows:[[660,780]]}}]},
 ledger:{items:[{store:STORE,financial:totals(),funded:'2'}]}
});
const invalid=fn=>assert.throws(fn,{code:'READ_RESPONSE_INVALID'});
test('valid G1 DTOs preserve exact original objects and never fabricate data',()=>{
 const r=records();
 assert.equal(verifiedPublicStores(r.stores)[0],r.stores.items[0]);
 assert.equal(verifiedPublicMeals(r.meals,STORE)[0],r.meals.items[0]);
 assert.equal(verifiedContributions(r.contributions)[0].stage,'UNKNOWN');
 assert.equal(verifiedClaimIntents(r.claims)[0].stage,'FINAL_SUCCEEDED');
 assert.equal(verifiedMyVouchers(r.vouchers)[0].voucherId,VOUCHER);
 assert.equal(verifiedVoucher(r.vouchers.items[0]),r.vouchers.items[0]);
 assert.equal(verifiedPublicLedger(r.ledger)[0].funded,'2');
 for(const fn of [verifiedPublicStores,verifiedContributions,verifiedClaimIntents,verifiedMyVouchers,verifiedPublicLedger])
  assert.deepEqual(fn({items:[]}),[]);
});

test('public kitchens fail closed for missing names, invalid IDs, duplicate stores and leaked PII',()=>{
 const base=records().stores;
 for(const transform of [
  x=>{x.items[0].name=null}, x=>{x.items[0].id='../attack'},
  x=>{x.items[0].store='b'.repeat(64)},x=>{x.items.push(copy(x.items[0]))},
  x=>{x.items[0].email='recipient@example.com'},x=>{x.items[0].metadata={sessionToken:'secret'}}
 ]){const x=copy(base);transform(x);invalid(()=>verifiedPublicStores(x));}
});
test('public meals require immutable catalog refs and finalized coherent counts',()=>{
 const base=records().meals;
 for(const transform of [
  x=>{x.items[0].store='f'.repeat(64)}, x=>{x.items[0].mealId='0x'+'f'.repeat(64)},
  x=>{x.items[0].listed='true'}, x=>{x.items[0].published=false},
  x=>{x.items[0].unitPrice='unknown'},x=>{x.items[0].windows=[[820,710]]},
  x=>{x.items[0].financial.counts.R='2'},
  x=>{x.items[0].financial.liability=ZERO},x=>{x.items[0].eligible='2'},
  x=>{x.items[0].financial.F='7000000'},
  x=>{x.items[0].recipientKey='private-recipient'}
 ]){const x=copy(base);transform(x);invalid(()=>verifiedPublicMeals(x,STORE));}
});

test('private contribution and claim lists reject cross-action or malformed IDs, do not turn UNKNOWN into success',()=>{
 const r=records(),x=copy(r.contributions);
 x.items[0].action='settle';invalid(()=>verifiedContributions(x));
 const a=copy(r.contributions);a.items[0].transactionHash='0xgarbage';invalid(()=>verifiedContributions(a));
 const b=copy(r.contributions);b.items[0].amount='-1';invalid(()=>verifiedContributions(b));
 const c=copy(r.claims);c.items[0].action='fund';invalid(()=>verifiedClaimIntents(c));
 const d=copy(r.claims);d.items[0].id='invalid';invalid(()=>verifiedClaimIntents(d));
 const valid=verifiedContributions(r.contributions)[0];assert.equal(valid.stage,'UNKNOWN');assert.equal(valid.transactionHash,null);
});

test('my vouchers reject inconsistent owner-independent fields without exposing display credentials',()=>{
 const base=records().vouchers;
 for(const transform of [
  x=>{x.items[0].id='0x'+'e'.repeat(64)},
  x=>{x.items[0].store='invalid'},
  x=>{x.items[0].state='success'},
  x=>{x.items[0].expiresAt='expired'},
  x=>{x.items[0].terms.windows=[[1440,1499]]}
 ]){const x=copy(base);transform(x);invalid(()=>verifiedMyVouchers(x));}
});

test('public accounting conservation and privacy fail closed',()=>{
 const base=records().ledger;
 for(const transform of [
  x=>{x.items[0].financial.counts.F='9'},
  x=>{x.items[0].funded='3'},
  x=>{x.items[0].financial.S='1'},
  x=>{x.items[0].financial.liability='0'},
  x=>{x.items[0].financial.counts.R='18446744073709551616'},
  x=>{x.items[0].financial.counts.F='18446744073709551618'},
  x=>{x.items[0].walletAddress=WALLET},
  x=>{x.items[0].financial.recipient_key='secret'},
  x=>{x.items.push(copy(x.items[0]))},
 ]){const x=copy(base);transform(x);invalid(()=>verifiedPublicLedger(x));}
});

function apiFixture(overrides={}){
 const r=records(),requests=[],storageMap=new Map([['mealforward-live-csrf-v1','csrf']]);
 const storage={getItem:key=>storageMap.get(key)||null,setItem:(key,value)=>storageMap.set(key,value),removeItem:key=>storageMap.delete(key)};
 const provider={on(){},removeListener(){},async request({method}){
  if(method==='eth_accounts')return [WALLET];
  if(method==='eth_chainId')return '0x279f';
  throw Error('G1 read-only test may not send wallet transaction');
 }};
 const data={
  '/v1/connection':{mode:'CP30_TESTNET_CONNECTION',registrationEnabled:false},
  '/v1/identity/setup':{walletLoginEnabled:true,walletLoginChainId:10143,walletLoginOrigin:origin},
  '/v1/me':{walletAddress:WALLET},
  '/v1/store-registrations':{items:[]},
  '/v1/stores':r.stores,
  ['/v1/stores/'+STORE+'/meals']:r.meals,
  '/v1/my/orders':r.contributions,
  '/v1/my/claims':r.claims,
  '/v1/my/vouchers':r.vouchers,
  ['/v1/vouchers/'+VOUCHER]:r.vouchers.items[0],
  '/v1/ledger':r.ledger,
  ...overrides
 };
 const fetchImpl=async(path,options)=>{requests.push({path,method:options.method});if(!Object.hasOwn(data,path))throw Error('Unprepared route '+path);return{ok:true,status:200,json:async()=>data[path]};};
 const api=createLiveApi({fetchImpl,storage,provider:()=>provider,origin:()=>origin,onSessionInvalidated(){}});
 return{api,requests};
}
test('Sites G1 adapter only uses read-only HTTP for catalog, donor, recipient and ledger',async()=>{
 const fixture=apiFixture(),api=fixture.api;
 assert.equal((await api.getContext()).session.wallet,WALLET);
 assert.equal((await api.listStores()).length,1);
 assert.equal((await api.getStoreMeals(STORE)).length,1);
 assert.equal((await api.getSupportOrders())[0].stage,'UNKNOWN');
 assert.equal((await api.getClaimIntents()).length,1);
 assert.equal((await api.getMyVouchers()).length,1);
 assert.equal((await api.getVoucher(VOUCHER)).id,VOUCHER);
 assert.equal((await api.getPublicLedger()).items.length,1);
 assert.ok(fixture.requests.every(r=>r.method==='GET'));
});
test('malformed 200 private response fails before it can enter a real UI list',async()=>{
 const bad=apiFixture({'/v1/my/orders':{items:[{id:INTENT,stage:'FINAL_SUCCEEDED'}]}});
 await bad.api.getContext();
 await assert.rejects(bad.api.getSupportOrders(),{code:'READ_RESPONSE_INVALID'});
 assert.ok(bad.requests.every(r=>r.method==='GET'));
});
