import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveApi} from './dist/live-api.mjs';
import {prepareSettle} from './dist/assets/live-wallet.mjs';
// Existing pre-G1 fixture only: production adapter always validates full CP30 DTOs.
const legacyFixtureApi=options=>createLiveApi({...options,testOnlyAllowIncompleteReadFixtures:true});
const address=n=>'0x'+String(n).repeat(40),word=n=>'0x'+String(n).repeat(64),owner=address(2),store=word(1).slice(2),voucher=word(7),id='11111111-1111-4111-8111-111111111111';
const response=(v,status=200)=>({ok:status<400,status,json:async()=>v});
async function fixture({tamper=false,failAdmission=false,failHash=false,tooEarly=false,wrongVoucher=false,foreign=false}={}){
 const values=new Map([['mealforward-live-csrf-v1','csrf']]),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const binding={chainId:10143,escrow:address(3),asset:address(4),owner,receiver:owner,quoteAuthority:address(6)};
 const operation={opId:word(8),voucherId:voucher,generation:'1'},material={kind:'settle',binding,expectedAccount:owner,operation,amount:'7000000'};
 const tx={...prepareSettle({binding,wallet:{chainId:10143,account:owner},...operation}),value:'0'};if(tamper)tx.to=address(9);
 const intent={id,intentId:id,action:'settle',store,stage:'WAIT_ACTOR',voucherId:wrongVoucher?word(9):voucher,generation:'1',amount:'7000000'},attempts={},calls=[];let sends=0,lost=false;
 const wallet={on(){},removeListener(){},async request({method}){if(method==='eth_accounts')return [owner];if(method==='eth_chainId')return '0x279f';if(method==='eth_sendTransaction'){sends++;return word(6);}throw Error(method);}};
 const fetchImpl=async(path,o)=>{calls.push({path,...o});
 if(path==='/v1/connection')return response({});if(path==='/v1/identity/setup')return response({});if(path==='/v1/me')return response({walletAddress:owner});
 if(path==='/v1/store-registrations')return response({items:foreign?[]:[{registrationId:word(1),storeId:word(1),state:'CONFIRMED',businessReady:true}]});
 if(path==='/v1/stores')return response({items:[{id:store}]});if(path.endsWith('/meals'))return response({items:[{listed:true}]});
 if(path.endsWith('/payouts'))return response({serverTime:1000,items:[{id:voucher,state:'H',amount:'7000000',settleEligibleAt:1000,receiver:binding.receiver,settlementIntents:[intent]}]});
 if(path.endsWith('/settle-reviews'))return response({store,reviewId:id,review:{voucherId:voucher,generation:'1',amount:'7000000'}});
 if(path.endsWith('/settle-intents')||path==='/v1/intents/'+id)return response(intent);
 if(path.endsWith('/wallet-preparation'))return tooEarly?response({error:'SETTLEMENT_DELAY'},409):response({material,transactions:[tx],now:'1000',walletActionsEnabled:true,allowedKinds:['settle'],attempts});
 if(path.endsWith('/wallet-attempts')){if(failAdmission)throw Error('lost');attempts.settle={hash:null,confirmed:false};return response({status:'UNKNOWN'});}
 if(path.endsWith('/wallet-transactions')){if(failHash&&!lost){lost=true;throw Error('lost');}attempts.settle={hash:JSON.parse(o.body).transactionHash,confirmed:false};return response({status:'PENDING'});}
 throw Error('unexpected '+path);
 };
 const args={fetchImpl,storage,provider:()=>wallet,origin:()=> 'https://localhost:16443'},api=legacyFixtureApi(args);await api.getContext();return {api,args,calls,attempts,get sends(){return sends;}};
}
test('settlement review and confirmation never send wallet transactions',async()=>{
 const f=await fixture();assert.equal((await f.api.getPayouts(store)).items[0].state,'H');await f.api.createSettlementReview({storeId:store,voucherId:voucher});
 await f.api.confirmSettlement({storeId:store,reviewId:id});await f.api.confirmSettlement({storeId:store,reviewId:id});assert.equal(f.sends,0);
 const requests=f.calls.filter(x=>x.path.endsWith('/settle-intents'));assert.equal(requests[0].headers['Idempotency-Key'],requests[1].headers['Idempotency-Key']);
});
test('early, foreign-owner and mismatched transaction/voucher cannot reach wallet admission',async()=>{
 for(const opts of [{tamper:true},{wrongVoucher:true},{tooEarly:true},{foreign:true}]){const f=await fixture(opts);await assert.rejects(f.api.sendSettlementTransaction(store,id),e=>e.walletStepNotStarted===true);assert.equal(f.sends,0);assert.ok(!f.calls.some(x=>x.path.endsWith('/wallet-attempts')));}
});
test('settlement submits exactly once and a known hash can be recorded again without resending',async()=>{
 const f=await fixture({failHash:true});await assert.rejects(f.api.sendSettlementTransaction(store,id),{code:'CONNECTION_UNAVAILABLE'});assert.equal(f.sends,1);
 const recovered=legacyFixtureApi(f.args);await recovered.getContext();const p=await recovered.getSettlementWalletPreparation(store,id);assert.equal(p.actions[0].allowed,false);assert.equal(p.actions[0].canRetryRecord,true);
 await recovered.retrySettlementTransactionRecord(store,id);assert.equal(f.sends,1);await assert.rejects(recovered.sendSettlementTransaction(store,id),e=>e.code==='ORIGINAL_PAYMENT_PENDING'&&e.walletStepNotStarted!==true);
});
test('unknown settlement admission survives reload and cannot send again',async()=>{
 const f=await fixture({failAdmission:true});await assert.rejects(f.api.sendSettlementTransaction(store,id),e=>e.code==='CONNECTION_UNAVAILABLE'&&e.walletStepNotStarted!==true);
 const recovered=legacyFixtureApi(f.args);await recovered.getContext();await assert.rejects(recovered.sendSettlementTransaction(store,id),e=>e.code==='ORIGINAL_PAYMENT_PENDING'&&e.walletStepNotStarted!==true);assert.equal(f.sends,0);
});
