import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveApi,parseVoucherCode} from './dist/live-api.mjs';
const origin='https://localhost:16443',code='a'.repeat(43),store='1'.repeat(64),wallet='0x'+'2'.repeat(40),voucher='0x'+'3'.repeat(64),caseId='0x'+'4'.repeat(64),intent='11111111-1111-4111-8111-111111111111';
async function fixture({owner=true,loseLock=false,mismatch=false,changeDuringCheck=false}={}){
 const values=new Map([['mealforward-live-csrf-v1','csrf']]),calls=[],events={};let lost=false;
 const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const provider={on:(k,f)=>events[k]=f,removeListener(){},async request({method}){if(method==='eth_accounts')return [wallet];if(method==='eth_chainId')return '0x279f';throw Error('Unexpected wallet mutation');}};
 const dto={id:voucher,voucherId:voucher,store,state:'R',locked:false,marked:false,pending:false};
 const operation=action=>({id:intent,intentId:intent,store,action,stage:'UNKNOWN',result:null});
 const ok=value=>({ok:true,status:200,json:async()=>value});
 const fetchImpl=async(path,options)=>{calls.push({path,...options});
 if(path==='/v1/connection')return ok({});if(path==='/v1/identity/setup')return ok({});
 if(path==='/v1/me')return ok({walletAddress:wallet});
 if(path==='/v1/store-registrations')return ok({items:owner?[{registrationId:voucher,storeId:'0x'+store,state:'CONFIRMED',businessReady:true}]:[]});
 if(path==='/v1/stores')return ok({items:[{id:store}]});if(path.endsWith('/meals'))return ok({items:[{listed:true}]});
 if(path.endsWith('/checks')){if(changeDuringCheck)events.accountsChanged();return ok({...dto,store:mismatch?'9'.repeat(64):store,valid:true});}
 if(path.endsWith('/locks')){if(loseLock&&!lost){lost=true;throw Error('lost');}return ok(operation('lock'));}
 if(path.endsWith('/handover-intents'))return ok(operation('handover'));
 if(path==='/v1/intents/'+intent)return ok(operation('lock'));
 if(path.endsWith('/cases/'+caseId))return ok({...dto,id:caseId,voucher,lockId:caseId,redemptionIntents:[operation('lock')],serverTime:1800000000});
 throw Error('Unexpected route '+path);
 };
 const api=createLiveApi({fetchImpl,storage,provider:()=>provider,origin:()=>origin,onSessionInvalidated(){}});await api.getContext();return {api,calls,values,events};
}
test('private link parser accepts only exact same-site voucher links or bounded codes',()=>{
 assert.equal(parseVoucherCode(code,origin),code);assert.equal(parseVoucherCode(origin+'/#verify?code='+code,origin),code);
 for(const value of ['https://elsewhere.test/#verify?code='+code,origin+'/other#verify?code='+code,origin+'/#verify?code='+code+'&code='+code,origin+'/?x=1#verify?code='+code,'javascript:alert(1)',origin+'/#verify?code='+code+'&x=1'])assert.throws(()=>parseVoucherCode(value,origin),{code:'INVALID_VOUCHER_LINK'});
});
test('checking never locks, hands over, signs, or stores the private code',async()=>{
 const f=await fixture();assert.equal((await f.api.checkVoucher({storeId:store,code})).valid,true);
 assert.equal(f.calls.filter(x=>x.method==='POST').length,1);assert.ok(f.calls.at(-1).path.endsWith('/checks'));
 assert.ok(!JSON.stringify([...f.values]).includes(code));
});
test('unknown lock retries retain the same key, and handover is a separate explicit action',async()=>{
 const f=await fixture({loseLock:true});await assert.rejects(f.api.lockVoucher({storeId:store,code}),{code:'CONNECTION_UNAVAILABLE'});
 assert.equal((await f.api.lockVoucher({storeId:store,code})).stage,'UNKNOWN');
 const locks=f.calls.filter(x=>x.path.endsWith('/locks'));assert.equal(locks[0].headers['Idempotency-Key'],locks[1].headers['Idempotency-Key']);
 assert.ok(!f.calls.some(x=>x.path.endsWith('/handover-intents')));assert.equal((await f.api.getRedemptionIntent(store,intent)).id,intent);
 assert.equal((await f.api.getRedemptionCase(store,caseId)).voucherId,voucher);
 await f.api.confirmHandover({storeId:store,caseId});await f.api.confirmHandover({storeId:store,caseId});
 const handovers=f.calls.filter(x=>x.path.endsWith('/handover-intents'));assert.equal(handovers[0].headers['Idempotency-Key'],handovers[1].headers['Idempotency-Key']);
 assert.ok(!JSON.stringify([...f.values]).includes(code));
});
test('foreign wallet, mismatched voucher and late wallet response cannot grant merchant authority',async()=>{
 const foreign=await fixture({owner:false});await assert.rejects(foreign.api.checkVoucher({storeId:store,code}),{code:'OWNER_ACCESS_REQUIRED'});assert.ok(!foreign.calls.some(x=>x.path.endsWith('/checks')));
 const wrong=await fixture({mismatch:true});await assert.rejects(wrong.api.checkVoucher({storeId:store,code}),{code:'VOUCHER_MISMATCH'});
 const late=await fixture({changeDuringCheck:true});await assert.rejects(late.api.checkVoucher({storeId:store,code}),{code:'SESSION_CHANGED'});await assert.rejects(late.api.lockVoucher({storeId:store,code}),{code:'LOGIN_REQUIRED'});
});
