import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveApi} from './dist/live-api.mjs';
// Existing pre-G1 fixture only: production adapter always validates full CP30 DTOs.
const legacyFixtureApi=options=>createLiveApi({...options,testOnlyAllowIncompleteReadFixtures:true});
const wallet='0x'+'3'.repeat(40),store='1'.repeat(64),meal='2'.repeat(64),voucher='0x'+'4'.repeat(64),review='11111111-1111-4111-8111-111111111111',intent='22222222-2222-4222-8222-222222222222';
async function fixture({loseConfirm=false,mismatch=false,rotateDuringRecover=false,replayRecover=false}={}){
 const values=new Map([['mealforward-live-csrf-v1','old-csrf']]),calls=[],handlers={};let lost=false;
 const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const provider={on:(k,f)=>handlers[k]=f,removeListener(){},async request({method}){if(method==='eth_accounts')return [wallet];if(method==='eth_chainId')return '0x279f';throw Error('No wallet transaction expected');}};
 const ok=value=>({ok:true,status:200,json:async()=>value});
 const dto={id:voucher,voucherId:voucher,state:'R',store,expiresAt:Math.floor(Date.now()/1000)+300};
 const fetchImpl=async(path,o)=>{calls.push({path,...o});
 if(path==='/v1/connection')return ok({});if(path==='/v1/identity/setup')return ok({walletLoginEnabled:true,walletLoginChainId:10143,walletLoginOrigin:'https://localhost:16443'});
 if(path==='/v1/me')return ok({walletAddress:wallet});if(path==='/v1/stores'||path==='/v1/store-registrations')return ok({items:[]});
 if(path==='/v1/claims/reviews')return ok({store,reviewId:review,review:{mealId:'0x'+(mismatch?store:meal),expectedUnitSeq:'1',expectedNextGeneration:'1',expectedTermsHash:'0x'+'5'.repeat(64),deadline:String(Math.floor(Date.now()/1000)+600)}});
 if(path==='/v1/claims/intents'){if(loseConfirm&&!lost){lost=true;throw Error('lost response');}return ok({id:intent,intentId:intent,action:'issue',stage:'ACCEPTED'});}
 if(path==='/v1/my/claims')return ok({items:[{id:intent,action:'issue',stage:'ACCEPTED'}]});
 if(path==='/v1/my/vouchers')return ok({items:[dto]});
 if(path==='/v1/intents/'+intent)return ok({id:intent,intentId:intent,action:'issue',stage:'FINAL_SUCCEEDED',result:{result:voucher}});
 if(path==='/v1/vouchers/'+voucher)return ok(dto);
 if(path.endsWith('/recover')){if(rotateDuringRecover)handlers.accountsChanged();return ok({...dto,redeemable:true,...(replayRecover?{replay:true}:{access:'a'.repeat(43),csrf:'rotated-csrf'})});}
 if(path.endsWith('/display'))return ok({...dto,display:'d'.repeat(43),validUntil:Math.floor(Date.now()/1000)+120});
 throw Error('unexpected route '+path);
 };
 const api=legacyFixtureApi({fetchImpl,storage,provider:()=>provider,origin:()=> 'https://localhost:16443',onSessionInvalidated(){}});await api.getContext();return {api,calls,values,handlers};
}
test('real claim review validates original meal, and confirmation retains its original idempotency key',async()=>{
 const f=await fixture({loseConfirm:true});await f.api.createClaimReview({storeId:store,mealId:meal});
 await assert.rejects(f.api.confirmClaim(review),{code:'CONNECTION_UNAVAILABLE'});assert.equal((await f.api.confirmClaim(review)).action,'issue');
 const reqs=f.calls.filter(x=>x.path==='/v1/claims/intents');assert.equal(reqs[0].headers['Idempotency-Key'],reqs[1].headers['Idempotency-Key']);assert.equal((await f.api.getClaimIntents()).length,1);
 assert.equal((await f.api.getClaimIntent(intent)).result.result,voucher);
});
test('claim mismatches and private meal draft references cannot create a claim',async()=>{
 const f=await fixture({mismatch:true});await assert.rejects(f.api.createClaimReview({storeId:store,mealId:review}),{code:'INVALID_CLAIM'});
 await assert.rejects(f.api.createClaimReview({storeId:store,mealId:meal}),{code:'CLAIM_REVIEW_MISMATCH'});assert.ok(!f.calls.some(x=>x.path==='/v1/claims/intents'));
});
test('voucher credentials stay in memory; recovery rotates CSRF and display refresh uses original access',async()=>{
 const f=await fixture();assert.equal((await f.api.getMyVouchers())[0].id,voucher);assert.equal((await f.api.getVoucher(voucher)).id,voucher);
 const result=await f.api.prepareVoucherDisplay(voucher);assert.equal(result.displayUrl,'https://localhost:16443/#verify?code='+'d'.repeat(43));
 await f.api.prepareVoucherDisplay(voucher);
 assert.equal(f.calls.filter(x=>x.path.endsWith('/recover')).length,1);
 const displays=f.calls.filter(x=>x.path.endsWith('/display'));assert.equal(displays.length,2);assert.equal(displays[0].headers['X-C1-CSRF'],'rotated-csrf');assert.notEqual(displays[0].headers['Idempotency-Key'],displays[1].headers['Idempotency-Key']);
 const saved=JSON.stringify([...f.values]);assert.ok(!saved.includes('a'.repeat(43)));assert.ok(!saved.includes('d'.repeat(43)));
 f.handlers.accountsChanged();await assert.rejects(f.api.prepareVoucherDisplay(voucher),{code:'LOGIN_REQUIRED'});
});

test('wallet switch during recovery discards credentials and late CSRF',async()=>{
 const f=await fixture({rotateDuringRecover:true});await assert.rejects(f.api.prepareVoucherDisplay(voucher),{code:'SESSION_CHANGED'});
 assert.equal(f.values.get('mealforward-live-csrf-v1'),'old-csrf');assert.ok(!f.calls.some(x=>x.path.endsWith('/display')));
});
test('replayed recovery without one-time access requires reauthentication, never emits a synthetic QR',async()=>{
 const f=await fixture({replayRecover:true});await assert.rejects(f.api.prepareVoucherDisplay(voucher),{code:'VOUCHER_RECOVERY_REQUIRED'});
 await assert.rejects(f.api.getMyVouchers(),{code:'LOGIN_REQUIRED'});assert.ok(!f.calls.some(x=>x.path.endsWith('/display')));
});
