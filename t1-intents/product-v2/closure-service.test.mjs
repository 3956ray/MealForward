/** Service/HTTP synthetic-proof regression. No claim of real-chain or real-SIWE acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {makePublicationService} from './publication.mjs';
import {publicationTransaction,publicationInterface} from './publication-wire.mjs';
import {chainReference} from './funding-wire.mjs';
import {makeProductService,emptyState} from './service.mjs';
import {makeClaimService} from './claims.mjs';
import {makeRedemptionService} from './redemption.mjs';
import {makeProductHttp} from './http.mjs';
const OWNER='0x'+'11'.repeat(20),PAYER='0x'+'22'.repeat(20),RECIPIENT='0x'+'33'.repeat(20),OTHER='0x'+'44'.repeat(20),BATCH='0x'+'55'.repeat(32),HASH='0x'+'66'.repeat(32),TERMS='0x'+'77'.repeat(32),NOW=1800000000;
const reject=(promise,code)=>assert.rejects(promise,e=>e.code===code);
function fixture(){
 let state=emptyState(),seq=0,evidence=null,prepares=0;
 const store={read:async()=>structuredClone(state),transact:async fn=>{const next=structuredClone(state),out=await fn(next);state=next;return structuredClone(out);}};
 const snapshot={verified:true,blockNumber:9,asset:{symbol:'USDC',decimals:6},stores:[{id:'s',owner:OWNER,name:'Kitchen',closed:false}],meals:[],accounting:{funded:'3',available:'0',claimed:'0',handedOver:'1',settled:'0',refundPending:'2',refunded:'0'}};
 const refund={verified:true,finalized:true,blockNumber:9,storeId:'s',owner:OWNER,payer:PAYER,batchId:BATCH,closed:true,refunded:false,quantity:'2',amount:'14000000'};
 const target={chainId:31337,escrow:'0x'+'aa'.repeat(20),asset:'0x'+'bb'.repeat(20)};
 const chain={target,publicationEnabled:true,catalog:async()=>structuredClone(snapshot),refundState:async()=>structuredClone(refund),refundableBatches:async(storeId,w)=>{if(w!==OWNER)throw Object.assign(Error('STORE_ACCESS_DENIED'),{code:'STORE_ACCESS_DENIED',status:403});return {verified:true,storeId,closed:snapshot.stores[0].closed,items:[structuredClone(refund)]};},preparePublicationOperation:async op=>{prepares++;return publicationTransaction(op,target,4);},verifyPublication:async()=>evidence};
 const api=makePublicationService({store,chain,clock:()=>NOW,newId:()=>`operation-${++seq}`});
 function receipt(op,extra={}){evidence={verified:true,finalized:true,blockNumber:10,outcome:'CONFIRMED',txHash:HASH,transaction:publicationTransaction(op,target,4),kind:op.kind,storeId:'s',owner:OWNER,closed:true,batchId:BATCH,payer:PAYER,quantity:'2',amount:'14000000',refunded:true,...extra};}
 return {api,store,chain,snapshot,refund,target,receipt,state:()=>state,prepares:()=>prepares};
}
const closeBody={storeId:'s',acknowledge:true,requestId:'close-original'},refundBody={storeId:'s',batchId:BATCH,requestId:'refund-original'};
async function attempted(f,op){await f.api.attempt(OWNER,op.id);await f.api.recordHash(OWNER,op.id,HASH);}

test('closure requires original owner and explicit acknowledgement; refund keeps original payer/amount',async()=>{
 const f=fixture();await reject(f.api.prepareClosure(OTHER,closeBody),'STORE_ACCESS_DENIED');await reject(f.api.prepareClosure(OWNER,{...closeBody,acknowledge:false}),'CLOSURE_ACKNOWLEDGEMENT_REQUIRED');
 const close=await f.api.prepareClosure(OWNER,closeBody);assert.equal(publicationInterface.parseTransaction(close.transaction).name,'closeStore');await f.api.cancel(OWNER,close.id);
 await reject(f.api.prepareRefund(PAYER,refundBody),'STORE_ACCESS_DENIED');await reject(f.api.prepareRefund(OWNER,{...refundBody,payer:OWNER}),'INVALID_REQUEST');
 const refund=await f.api.prepareRefund(OWNER,refundBody),decoded=publicationInterface.parseTransaction(refund.transaction);
 assert.equal(refund.payer,PAYER);assert.equal(refund.amount,'14000000');assert.equal(decoded.name,'refundBatch');assert.equal(decoded.args.batchId,BATCH);assert.equal(decoded.args.requestId,chainReference(refund.id));
 await reject(f.api.operation(OTHER,refund.id),'PUBLICATION_NOT_FOUND');await reject(f.api.byRequest(OTHER,refundBody.requestId),'PUBLICATION_NOT_FOUND');
});

test('closure and refund unknown outcomes preserve original request and never prepare/send twice',async()=>{
 for(const kind of ['Closure','Refund']){const f=fixture(),body=kind==='Closure'?closeBody:refundBody,op=await f.api['prepare'+kind](OWNER,body);await f.api.attempt(OWNER,op.id);
 assert.equal((await f.api['prepare'+kind](OWNER,body)).id,op.id);assert.equal((await f.api.byRequest(OWNER,body.requestId)).state,'SEND_UNKNOWN');assert.equal((await f.api.reconcile(OWNER,op.id)).state,'SEND_UNKNOWN');assert.equal(f.prepares(),1);
 await reject(f.api.attempt(OWNER,op.id),'ALREADY_ATTEMPTED');await reject(f.api.cancel(OWNER,op.id),'ATTEMPTED_OPERATION_CANNOT_CANCEL');await reject(f.api['prepare'+kind](OWNER,{...body,requestId:'new-request'}),'WALLET_OPERATION_PENDING');}
});

test('refund final receipt must match original payer, batch, amount and quantity',async()=>{
 for(const extra of [{payer:OWNER},{batchId:'0x'+'88'.repeat(32)},{amount:'1'},{quantity:'3'},{refunded:false},{owner:OTHER},{transaction:{value:'0x1'}}]){const f=fixture(),op=await f.api.prepareRefund(OWNER,refundBody);await attempted(f,op);f.receipt(op,extra);await reject(f.api.reconcile(OWNER,op.id),'EVIDENCE_MISMATCH');assert.equal((await f.api.operation(OWNER,op.id)).state,'SEND_UNKNOWN');}
 const f=fixture(),op=await f.api.prepareRefund(OWNER,refundBody);await attempted(f,op);f.receipt(op,{finalized:false});assert.equal((await f.api.reconcile(OWNER,op.id)).state,'HASH_BOUND');f.receipt(op);assert.equal((await f.api.reconcile(OWNER,op.id)).state,'CONFIRMED');
});

test('real HTTP routing reaches GET refunds before generic query rejection and ignores forged wallet',async()=>{
 const f=fixture();let origin;const server=http.createServer((req,res)=>handler(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;
 const handler=makeProductHttp({service:makeProductService({store:f.store,chain:f.chain}),publications:f.api,origin,enabled:true,authorize:async req=>req.headers.cookie==='synthetic-session'?{wallet:OWNER,csrfVerified:true}:null});
 try{let r=await fetch(origin+'/v1/product/merchant/refunds?storeId=s',{headers:{cookie:'synthetic-session','x-wallet':OTHER}});assert.equal(r.status,200);assert.equal((await r.json()).items[0].payer,PAYER);
 r=await fetch(origin+'/v1/product/merchant/refunds?storeId=s');assert.equal(r.status,401);
 r=await fetch(origin+'/v1/product/merchant/closure',{method:'POST',headers:{cookie:'synthetic-session',origin,'Content-Type':'application/json'},body:JSON.stringify({...closeBody,wallet:OTHER})});assert.equal(r.status,422);
 r=await fetch(origin+'/v1/product/merchant/closure',{method:'POST',headers:{cookie:'synthetic-session',origin,'Content-Type':'application/json'},body:JSON.stringify(closeBody)});assert.equal(r.status,200);assert.equal((await r.json()).wallet,OWNER);
 }finally{await new Promise(r=>server.close(r));}
});

function claimFixture(){
 const f=fixture();let proof={verified:true,finalized:true,state:'CANCELLED'},seq=0;
 const voucher={id:'old-voucher',wallet:RECIPIENT,claimId:'old-claim',storeId:'s',mealId:'m',version:1,name:'Old',windows:[[0,1440]],batchId:BATCH,unitIndex:'0',generation:1,termsHash:TERMS,state:'ISSUED',claimedAt:NOW-10,expiresAt:NOW+7190};
 f.state().vouchers={old:voucher};delete f.state().vouchers.old;f.state().vouchers[voucher.id]=voucher;f.state().displays={[voucher.id]:{hash:'private-digest',expiresAt:NOW+100}};
 const chain={...f.chain,claimEnabled:true,claimCandidate:async()=>({verified:true,storeId:'other-store',mealId:'m',name:'Other meal',batchId:'0x'+'99'.repeat(32),unitIndex:'0',expectedGeneration:1,version:1,windows:[[0,1440]],termsHash:TERMS}),eligibility:async()=>({verified:true,policySeconds:7200,nextEligibleAt:0}),voucherState:async v=>({voucherId:v.id,generation:v.generation,recipient:v.wallet,...proof}),signClaim:async i=>({verified:true,finalized:true,blockNumber:9,blockHash:HASH,storeId:i.storeId,batchId:i.batchId,unitIndex:i.unitIndex,expectedGeneration:i.expectedGeneration,unavailable:true,reason:'STORE_CLOSED'})};
 const service=makeClaimService({store:f.store,chain,policySeconds:7200,pepper:'synthetic-pepper-for-closure-testing-000',clock:()=>NOW,newId:()=>`claim-${++seq}`});
 return {...f,chain,service,voucher,proof:x=>proof=x,review:()=>service.review(RECIPIENT,{storeId:'other-store',mealId:'m',requestId:'review-other'})};
}

test('unverified or nonfinal closure cannot clear voucher, display or local cooldown',async()=>{
 for(const proof of [{verified:true,finalized:false,state:'CANCELLED'},{verified:false,finalized:true,state:'CANCELLED'},{verified:true,state:'CANCELLED'}]){
  const f=claimFixture();f.proof(proof);const r=await f.review();await reject(f.service.confirm(RECIPIENT,{reviewId:r.id,requestId:'claim-other'}),'CLAIM_COOLDOWN');assert.equal(f.state().vouchers[f.voucher.id].state,'ISSUED');assert.ok(f.state().displays[f.voucher.id]);
 }
});

test('final matching cancellation clears only affected voucher; later active voucher still blocks cooldown',async()=>{
 const f=claimFixture();f.proof({verified:true,finalized:true,state:'CANCELLED',recipient:OTHER});await reject(f.service.vouchers(RECIPIENT),'VOUCHER_EVIDENCE_MISMATCH');assert.equal(f.state().vouchers[f.voucher.id].state,'ISSUED');
 f.proof({verified:true,finalized:true,state:'CANCELLED'});await f.service.vouchers(RECIPIENT);assert.equal(f.state().vouchers[f.voucher.id].state,'CANCELLED');assert.equal(f.state().displays[f.voucher.id],undefined);
 f.state().vouchers.later={...f.voucher,id:'later',storeId:'later-store',state:'HANDED_OVER'};const r=await f.review();await reject(f.service.confirm(RECIPIENT,{reviewId:r.id,requestId:'still-cooling'}),'CLAIM_COOLDOWN');
 delete f.state().vouchers.later;const queued=await f.service.confirm(RECIPIENT,{reviewId:r.id,requestId:'new-claim'});assert.equal(queued.state,'QUEUED');assert.equal((await f.service.signNext()).state,'REJECTED');assert.equal((await f.service.get(RECIPIENT,queued.id)).state,'REJECTED');
});

test('merchant lock cancellation requires final cancelled proof; SEND_UNKNOWN never unlocks',async()=>{
 const f=claimFixture(),v=f.voucher,id='handover-op';f.state().vouchers[v.id].pendingRedemptionId=id;f.state().redemptions={[id]:{id,kind:'handover',state:'AWAITING_HANDOVER',wallet:OWNER,storeId:'s',voucherId:v.id,generation:1,windows:[[0,1440]],session:'old-session'}};
 let finalized=false;f.chain.voucherState=async()=>({verified:true,finalized,state:'CANCELLED',voucherId:v.id,generation:1,storeId:'s',owner:OWNER,recipient:RECIPIENT,chainTime:NOW,unitPrice:'7000000'});
 const service=makeRedemptionService({store:f.store,chain:f.chain,pepper:'synthetic-pepper-for-closure-testing-000',clock:()=>NOW});
 await reject(service.cancel(OWNER,id,'new-session'),'CANCELLATION_NOT_YET_SAFE');assert.equal(f.state().vouchers[v.id].pendingRedemptionId,id);
 finalized=true;f.state().redemptions[id].state='SEND_UNKNOWN';await reject(service.cancel(OWNER,id,'new-session'),'ATTEMPTED_OPERATION_CANNOT_CANCEL');assert.equal(f.state().vouchers[v.id].pendingRedemptionId,id);
 f.state().redemptions[id].state='AWAITING_HANDOVER';assert.equal((await service.cancel(OWNER,id,'new-session')).state,'CANCELLED');assert.equal(f.state().vouchers[v.id].state,'CANCELLED');assert.equal(f.state().vouchers[v.id].pendingRedemptionId,undefined);
});

test('public ledger counts pending refunds separately and rejects broken conservation',async()=>{
 const f=fixture(),service=makeProductService({store:f.store,chain:f.chain}),ledger=await service.ledger();assert.equal(ledger.counts.refundPending,'2');assert.equal(ledger.counts.refunded,'0');f.snapshot.accounting.refunded='1';await reject(service.ledger(),'ACCOUNTING_UNVERIFIED');
});


test('closed stores reject new publication/supplement/listing preparation but original requests still recover',async()=>{
 const f=fixture(),op=await f.api.prepareClosure(OWNER,closeBody);f.snapshot.stores[0].closed=true;
 assert.equal((await f.api.prepareClosure(OWNER,closeBody)).id,op.id);
 await reject(f.api.supplement(OWNER,{storeId:'s',mealId:'m',version:1,quantity:'2',fundingDeadline:NOW+1000,requestId:'new-stock'}),'STORE_CLOSED');
 await reject(f.api.setListed(OWNER,{storeId:'s',mealId:'m',version:1,listed:true,requestId:'new-listing'}),'STORE_CLOSED');
 f.state().reviews.review={id:'review',kind:'publication',wallet:OWNER,storeId:'s',expiresAt:NOW+100};
 await reject(f.api.confirmPublication(OWNER,{reviewId:'review',requestId:'new-publication'}),'STORE_CLOSED');
 assert.equal(f.prepares(),1);
});

test('queued claims remain queued if closure proof is nonfinal or identifies a different chain unit',async()=>{
 for(const changed of [{finalized:false},{finalized:undefined},{blockNumber:-1},{blockNumber:undefined},{blockHash:'broken'},{storeId:'different'},{batchId:BATCH},{unitIndex:'1'},{expectedGeneration:2}]){
  const f=claimFixture(),r=await f.review(),i=await f.service.confirm(RECIPIENT,{reviewId:r.id,requestId:'queued'}),original=f.chain.signClaim;
  f.chain.signClaim=async intent=>({...await original(intent),...changed});
  await reject(f.service.signNext(),'CLAIM_CLOSURE_UNVERIFIED');assert.equal((await f.service.get(RECIPIENT,i.id)).state,'QUEUED');assert.equal(f.state().claims[i.id].packet,undefined);assert.equal(f.state().claims[i.id].txHash,undefined);
 }
});

test('invalidated-only cancellation refuses still-valid vouchers even in the current session',async()=>{
 const f=claimFixture(),v=f.voucher,id='still-valid';f.state().vouchers[v.id].pendingRedemptionId=id;f.state().redemptions={[id]:{id,kind:'handover',state:'AWAITING_HANDOVER',wallet:OWNER,storeId:'s',voucherId:v.id,generation:1,windows:[[0,1440]],session:'old-session'}};
 let state='ISSUED';f.chain.voucherState=async()=>({verified:true,finalized:true,state,voucherId:v.id,generation:1,storeId:'s',owner:OWNER,recipient:RECIPIENT,chainTime:NOW,unitPrice:'7000000'});
 const service=makeRedemptionService({store:f.store,chain:f.chain,pepper:'synthetic-pepper-for-closure-testing-000',clock:()=>NOW});
 await reject(service.cancel(OWNER,id,'new-session',true),'VOUCHER_STILL_VALID');assert.equal(f.state().vouchers[v.id].pendingRedemptionId,id);
 state='CANCELLED';assert.equal((await service.cancel(OWNER,id,'new-session',true)).state,'CANCELLED');assert.equal(f.state().vouchers[v.id].pendingRedemptionId,undefined);
});
