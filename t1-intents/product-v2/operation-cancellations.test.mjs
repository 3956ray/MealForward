import test from 'node:test';
import assert from 'node:assert/strict';
import {makeOperationCancellations} from './operation-cancellations.mjs';
const wallet='0x'+'11'.repeat(20),other='0x'+'22'.repeat(20),txHash='0x'+'ab'.repeat(32),blockHash='0x'+'cd'.repeat(32),transaction={from:wallet,to:other,nonce:'0x3',chainId:'0x7a69',value:'0x0',data:'0x12345678'};
function fixture(kind='support',group='intents'){
 const op={id:'original',kind,wallet,state:'SEND_UNKNOWN',transaction,expiresAt:100,voucherId:'voucher',generation:1,handle:'handle',session:'original-session',handedOverConfirmedAt:50};
 const state={[group]:{original:op},vouchers:{voucher:{id:'voucher',wallet:other,generation:1,expiresAt:500,state:'ISSUED',pendingRedemptionId:'original',pendingSettlementId:'original'}},verificationHandles:{handle:{id:'handle',wallet,session:'original-session',operationId:'original'}},displays:{voucher:{secret:'private'}}};
 const proof={verified:true,finalized:true,invalidated:true,wallet,originalNonce:3,chainId:31337,txHash,blockNumber:10,blockHash,chainTime:101};
 let currentProof=proof,ids=0;const chain={verifyOperationCancellation:async()=>currentProof,voucherState:async()=>({verified:true,finalized:true,voucherId:'voucher',generation:1,owner:wallet,recipient:other,chainTime:101,state:'ISSUED'})};
 const service=makeOperationCancellations({store:{read:async()=>structuredClone(state),transact:async fn=>fn(state)},chain,newId:()=>`replacement-${++ids}`,clock:()=>101});return{state,op,proof,service,chain,setProof:p=>currentProof=p};
}
test('rejecting a wallet is not cancellation; only exact final nonce proof releases four domains',async()=>{
 for(const [kind,group] of [['support','intents'],['approval','approvals'],['registration','publications'],['settlement','redemptions']]){
  const f=fixture(kind,group),dto=await f.service.get(wallet,group,'original');assert.equal(dto.state,'SEND_UNKNOWN');assert.equal(dto.transaction.to,wallet);assert.equal(dto.transaction.data,'0x');assert.equal(dto.originalNonce,'0x3');
  f.setProof({verified:false,reason:'CANCELLATION_PENDING'});assert.equal((await f.service.record(wallet,group,'original',{txHash})).state,'SEND_UNKNOWN');
  f.setProof(f.proof);assert.equal((await f.service.get(wallet,group,'original')).state,'CANCELLED');assert.equal(f.op.cancellationProof.txHash,txHash);if(kind==='settlement')assert.equal(f.state.vouchers.voucher.pendingSettlementId,undefined);
  assert.equal((await f.service.record(wallet,group,'original',{txHash})).state,'CANCELLED');
 }
});
test('wrong identity, groups, nonce, finality and chain cannot release original request',async()=>{
 const f=fixture();await assert.rejects(f.service.get(other,'intents','original'),/OPERATION_NOT_FOUND/);await assert.rejects(f.service.get(wallet,'__proto__','original'),/INVALID_REQUEST/);
 for(const patch of [{wallet:other},{originalNonce:4},{finalized:false},{chainId:10143},{invalidated:false}]){f.setProof({...f.proof,...patch});await assert.rejects(f.service.record(wallet,'intents','original',{txHash}),/CANCELLATION_EVIDENCE_MISMATCH/);assert.equal(f.op.state,'SEND_UNKNOWN');}
});
test('handover cancellation preserves physical responsibility and creates one new durable continuation',async()=>{
 const f=fixture('handover','redemptions');const result=await f.service.record(wallet,'redemptions','original',{txHash});assert.equal(result.state,'CANCELLED');assert.equal(result.replacementOperationId,'replacement-1');
 const continuation=f.state.redemptions[result.replacementOperationId];assert.equal(continuation.state,'AWAITING_HANDOVER');assert.equal(continuation.handedOverConfirmedAt,50);assert.equal(continuation.transaction,undefined);assert.equal(continuation.recoveredFrom,'original');assert.equal(f.state.vouchers.voucher.pendingRedemptionId,continuation.id);assert.equal(f.state.verificationHandles[continuation.handle].operationId,continuation.id);assert.equal(f.state.displays.voucher,undefined);
 await f.service.get(wallet,'redemptions','original');assert.equal(Object.keys(f.state.redemptions).length,2);
});
test('handover permit still valid and unverified voucher cannot unlock or create new processing',async()=>{
 for(const invalidVoucher of [false,true]){const f=fixture('handover','redemptions');if(invalidVoucher)f.chain.voucherState=async()=>({verified:false});else f.setProof({...f.proof,chainTime:100});await assert.rejects(f.service.record(wallet,'redemptions','original',{txHash}),/CANCELLATION_(PERMIT_STILL_VALID|VOUCHER_UNVERIFIED)/);assert.equal(f.op.state,'SEND_UNKNOWN');assert.equal(f.state.vouchers.voucher.pendingRedemptionId,'original');}
});
