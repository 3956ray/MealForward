/** Independent concurrency review using copy-on-commit transactions like the PG store. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {makeOperationCancellations} from './operation-cancellations.mjs';
import {makeProductService} from './service.mjs';
import {makeApprovalService} from './approval.mjs';
import {makePublicationService} from './publication.mjs';
import {makeRedemptionService} from './redemption.mjs';
const wallet='0x'+'1'.repeat(40),recipient='0x'+'2'.repeat(40),escrow='0x'+'3'.repeat(40),originalHash='0x'+'4'.repeat(64),cancelHash='0x'+'5'.repeat(64),blockHash='0x'+'6'.repeat(64);
function fixture(group,kind){
 const transaction={from:wallet,to:escrow,nonce:'0x3',chainId:'0x7a69',value:'0x0',data:'0x12345678'};
 let db={intents:{},approvals:{},publications:{},redemptions:{},vouchers:{voucher:{id:'voucher',storeId:'kitchen',wallet:recipient,generation:1,expiresAt:1000,state:'ISSUED',pendingRedemptionId:'original',pendingSettlementId:'original'}},verificationHandles:{handle:{wallet,session:'session',voucherId:'voucher',operationId:'original',displayGeneration:1,consumed:true}},displays:{voucher:{hash:'private'}}};
 db[group].original={id:'original',kind,wallet,state:'SEND_UNKNOWN',candidateHash:originalHash,transaction,voucherId:'voucher',storeId:'kitchen',generation:1,handle:'handle',session:'session',displayGeneration:1,expiresAt:100,handedOverConfirmedAt:50};
 let tail=Promise.resolve(),ids=0;const store={read:async()=>structuredClone(db),transact(fn){const run=tail.then(async()=>{const next=structuredClone(db),result=await fn(next);db=next;return structuredClone(result);});tail=run.catch(()=>{});return run;}};
 const proof={verified:true,finalized:true,invalidated:true,operationId:'original',kind,wallet,originalNonce:3,chainId:31337,txHash:cancelHash,blockNumber:10,blockHash,finalizedBlockNumber:20,finalizedBlockHash:blockHash,chainTime:200};
 const chain={catalog:async()=>({verified:true,blockNumber:20,stores:[{id:'kitchen',owner:wallet}],meals:[]}),verifyOperationCancellation:async()=>proof,voucherState:async()=>({verified:true,finalized:true,voucherId:'voucher',storeId:'kitchen',generation:1,owner:wallet,recipient,chainTime:200,expiresAt:1000,state:'ISSUED'})};
 const cancellations=makeOperationCancellations({store,chain,newId:()=>`replacement-${++ids}`,clock:()=>200});
 return {store,chain,cancellations,transaction,proof,db:()=>db};
}
for(const [group,kind,build,verify]of [['intents','support',makeProductService,'verifyFunding'],['approvals','approval',makeApprovalService,'verifyApproval'],['publications','registration',makePublicationService,'verifyPublication'],['redemptions','handover',makeRedemptionService,'verifyRedemption'],['redemptions','settlement',makeRedemptionService,'verifyRedemption']]){
 test(`${kind}: stale pending receipt cannot resurrect a finally cancelled operation`,async()=>{
  const f=fixture(group,kind);let release,enter;const entered=new Promise(r=>enter=r);f.chain[verify]=async()=>{enter();return new Promise(r=>release=r);};const domain=build({store:f.store,chain:f.chain,pepper:'p'.repeat(32)});
  const inFlight=domain.reconcile(wallet,'original');await entered;const cancelled=await f.cancellations.record(wallet,group,'original',{txHash:cancelHash});assert.equal(cancelled.state,'CANCELLED');
  release({verified:true,txHash:originalHash,transaction:f.transaction,finalized:false});assert.equal((await inFlight).state,'CANCELLED');assert.equal(f.db()[group].original.state,'CANCELLED');
  if(kind==='handover'){const replacement=cancelled.replacementOperationId;assert.equal(f.db().vouchers.voucher.pendingRedemptionId,replacement);assert.deepEqual(Object.values(f.db().redemptions).filter(o=>['AWAITING_HANDOVER','HASH_BOUND','SEND_UNKNOWN'].includes(o.state)).map(o=>o.id),[replacement]);}
  if(kind==='settlement')assert.equal(f.db().vouchers.voucher.pendingSettlementId,undefined);
 });
}
test('concurrent cancellation reconciliation creates exactly one durable handover continuation',async()=>{
 const f=fixture('redemptions','handover');await f.store.transact(s=>{s.redemptions.original.cancellationHash=cancelHash;});const results=await Promise.all([f.cancellations.get(wallet,'redemptions','original'),f.cancellations.get(wallet,'redemptions','original')]);assert.equal(results[0].replacementOperationId,results[1].replacementOperationId);assert.equal(Object.keys(f.db().redemptions).length,2);assert.equal(f.db().vouchers.voucher.pendingRedemptionId,results[0].replacementOperationId);
});
test('expired raw ISSUED voucher needs no separate expire transaction to release an invalidated nonce responsibility',async()=>{
 const f=fixture('redemptions','handover');await f.store.transact(s=>{s.vouchers.voucher.expiresAt=150;});f.chain.voucherState=async()=>({verified:true,finalized:true,voucherId:'voucher',storeId:'kitchen',generation:1,owner:wallet,recipient,chainTime:200,expiresAt:150,state:'ISSUED'});
 const result=await f.cancellations.record(wallet,'redemptions','original',{txHash:cancelHash});assert.equal(result.state,'CANCELLED');assert.equal(result.replacementOperationId,undefined);assert.equal(f.db().vouchers.voucher.state,'EXPIRED');assert.equal(f.db().vouchers.voucher.pendingRedemptionId,undefined);
});
test('confirmed original wins over a concurrently returning cancellation proof',async()=>{
 const f=fixture('intents','support');let release,enter;const entered=new Promise(r=>enter=r);f.chain.verifyOperationCancellation=async()=>{enter();return new Promise(r=>release=r);};const cancellation=f.cancellations.record(wallet,'intents','original',{txHash:cancelHash});await entered;await f.store.transact(s=>{s.intents.original.state='CONFIRMED';});release(f.proof);assert.equal((await cancellation).state,'CONFIRMED');assert.equal(f.db().intents.original.cancellationProof,undefined);
});
