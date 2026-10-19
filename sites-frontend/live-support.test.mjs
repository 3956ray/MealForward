import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveApi} from './dist/live-api.mjs';
import {prepareApprove,prepareFund} from './dist/assets/live-wallet.mjs';
// Existing pre-G1 fixture only: production adapter always validates full CP30 DTOs.
const legacyFixtureApi=options=>createLiveApi({...options,testOnlyAllowIncompleteReadFixtures:true});
const address=n=>'0x'+String(n).repeat(40),word=n=>'0x'+String(n).repeat(64),payer=address(2),intent='11111111-1111-4111-8111-111111111111',store=word(1).slice(2),meal=word(8).slice(2);
const response=(value,status=200)=>({ok:status<400,status,json:async()=>value});
async function fixture({tamper=false,failAdmission=false,failHash=false,incompleteReview=false,failPreparation=false}={}){
 const values=new Map([['mealforward-live-csrf-v1','csrf']]),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const now=Math.floor(Date.now()/1000),binding={chainId:10143,escrow:address(3),asset:address(4),owner:address(5),receiver:address(5),quoteAuthority:address(6)};
 const quote={quoteId:word(7),payer,mealId:word(8),currentVersion:'1',termsHash:word(9),quantity:'1',unitPrice:'7000000',amount:'7000000',deadline:String(now+600)};
 const signedQuote={chainId:10143,escrow:binding.escrow,quoteAuthority:binding.quoteAuthority,quote,signature:'0x'+'a'.repeat(130)};
 const transactions=[prepareApprove({binding,wallet:{chainId:10143,account:payer},payer,amount:quote.amount}),prepareFund({binding,wallet:{chainId:10143,account:payer},signedQuote,now:String(now)})].map(tx=>({...tx,value:'0'}));
 if(tamper)transactions[0].to=address(9);
 const attempts={},calls=[];let sends=0,hashFailed=false;
 const wallet={on(){},removeListener(){},async request({method}){if(method==='eth_accounts')return [payer];if(method==='eth_chainId')return '0x279f';if(method==='eth_sendTransaction'){sends++;return word(6);}throw Error(method);}};
 const fetchImpl=async(path,options)=>{
  calls.push({path,options});
  if(path==='/v1/connection')return response({assetDecimals:6,assetSymbol:'USDC'});
  if(path==='/v1/identity/setup')return response({walletLoginEnabled:true,walletLoginChainId:10143,walletLoginOrigin:'https://localhost:16443'});
  if(path==='/v1/me')return response({walletAddress:payer});
  if(path==='/v1/store-registrations'||path==='/v1/stores')return response({items:[]});
  if(path==='/v1/support/reviews')return response({reviewId:intent,store,review:incompleteReview?{name:'222',unitPrice:'7000000',reviewId:intent}:quote});
  if(path==='/v1/support/intents')return response({id:intent,intentId:intent,stage:'ACCEPTED'});
  if(path.endsWith('/wallet-preparation')&&failPreparation)return response({error:'CODEC_UNAVAILABLE'},503);
  if(path.endsWith('/wallet-preparation'))return response({material:{kind:'fund',binding,expectedAccount:payer,signedQuote},transactions,now,walletActionsEnabled:true,allowedKinds:attempts.approve?.confirmed?['fund']:['approve'],attempts});
  if(path.endsWith('/wallet-attempts')){if(failAdmission)throw Error('lost');const {kind}=JSON.parse(options.body);attempts[kind]={hash:null,confirmed:false};return response({status:'UNKNOWN'});}
  if(path.endsWith('/wallet-transactions')){if(failHash&&!hashFailed){hashFailed=true;throw Error('lost');}const {kind,transactionHash}=JSON.parse(options.body);attempts[kind]={hash:transactionHash,confirmed:false};return response({status:'PENDING'});}
  throw Error('unexpected '+path);
 };
 const args={storage,fetchImpl,provider:()=>wallet,origin:()=> 'https://localhost:16443'};
 const api=legacyFixtureApi(args);await api.getContext();return {api,args,attempts,calls,get sends(){return sends;}};
}
test('support permits only published meal IDs and exact review parameters',async()=>{
 const f=await fixture();await assert.rejects(f.api.createSupportReview({storeId:store,mealId:intent,quantity:1}),{code:'INVALID_SUPPORT'});
 assert.equal((await f.api.createSupportReview({storeId:store,mealId:meal,quantity:1})).review.amount,'7000000');
 assert.equal((await f.api.confirmSupport(intent)).stage,'ACCEPTED');assert.equal(f.sends,0);
});
test('mismatched server payment descriptor cannot reach wallet or admission',async()=>{
 const f=await fixture({tamper:true});await assert.rejects(f.api.sendSupportTransaction(intent,'approve'),{code:'PAYMENT_DETAILS_MISMATCH'});assert.equal(f.sends,0);assert.ok(!f.calls.some(c=>c.path.endsWith('/wallet-attempts')));
});
test('approve must finalize before fund and a pending attempt is never resent',async()=>{
 const f=await fixture();await assert.rejects(f.api.sendSupportTransaction(intent,'fund'),{code:'ORIGINAL_PAYMENT_PENDING'});
 assert.equal((await f.api.sendSupportTransaction(intent,'approve')).status,'PENDING');assert.equal(f.sends,1);
 await assert.rejects(f.api.sendSupportTransaction(intent,'approve'),{code:'ORIGINAL_PAYMENT_PENDING'});
 f.attempts.approve.confirmed=true;await f.api.sendSupportTransaction(intent,'fund');assert.equal(f.sends,2);
});
test('unknown attempt admission blocks sending again even after reload',async()=>{
 const f=await fixture({failAdmission:true});await assert.rejects(f.api.sendSupportTransaction(intent,'approve'),{code:'CONNECTION_UNAVAILABLE'});
 const again=legacyFixtureApi(f.args);await again.getContext();await assert.rejects(again.sendSupportTransaction(intent,'approve'),{code:'ORIGINAL_PAYMENT_PENDING'});assert.equal(f.sends,0);
});
test('known hash reporting retries without another wallet transaction',async()=>{
 const f=await fixture({failHash:true});await assert.rejects(f.api.sendSupportTransaction(intent,'approve'),{code:'CONNECTION_UNAVAILABLE'});assert.equal(f.sends,1);
 const again=legacyFixtureApi(f.args);await again.getContext();assert.equal((await again.getSupportWalletPreparation(intent)).actions[0].canRetryRecord,true);
 await again.retrySupportTransactionRecord(intent,'approve');assert.equal(f.sends,1);assert.equal(f.attempts.approve.hash,word(6));
});

test('incomplete support review cannot advance to an intent or wallet request',async()=>{
 const f=await fixture({incompleteReview:true});
 await assert.rejects(f.api.createSupportReview({storeId:store,mealId:meal,quantity:1}),{code:'REVIEW_MISMATCH'});
 assert.equal(f.sends,0);assert.ok(!f.calls.some(c=>c.path==='/v1/support/intents'));
});

test('preparation failure explicitly reports no new wallet step and preserves retry',async()=>{
 const f=await fixture({failPreparation:true});
 await assert.rejects(f.api.sendSupportTransaction(intent,'approve'),{code:'CODEC_UNAVAILABLE',walletStepNotStarted:true});
 assert.equal(f.sends,0);assert.ok(!f.calls.some(c=>c.path.endsWith('/wallet-attempts')));
 await assert.rejects(f.api.sendSupportTransaction(intent,'approve'),{walletStepNotStarted:true});
});
test('unknown admission never reports wallet step not started, including after reload',async()=>{
 const f=await fixture({failAdmission:true});
 await assert.rejects(f.api.sendSupportTransaction(intent,'approve'),e=>e.code==='CONNECTION_UNAVAILABLE'&&e.walletStepNotStarted!==true);
 const recovered=legacyFixtureApi(f.args);await recovered.getContext();
 await assert.rejects(recovered.sendSupportTransaction(intent,'approve'),e=>e.walletStepNotStarted!==true);assert.equal(f.sends,0);
});
