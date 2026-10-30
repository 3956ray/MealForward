/** Explicit nonce invalidation. Never sends, retries or releases on a wallet error. */
import {randomUUID} from 'node:crypto';
import {fail} from './service.mjs';
const check=(v,c,s=409)=>{if(!v)fail(c,s);};
const hash=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/i.test(v);
const address=v=>typeof v==='string'&&/^0x[0-9a-f]{40}$/i.test(v)&&BigInt(v)!==0n;
const groups=new Set(['intents','approvals','publications','redemptions']);
const pending=o=>['SEND_UNKNOWN','HASH_BOUND'].includes(o.state);
export function makeOperationCancellations({store,chain,clock=()=>Math.floor(Date.now()/1000),newId=randomUUID}){
 function owned(s,w,group,id){check(address(w),'UNAUTHENTICATED',401);check(groups.has(group)&&/^[a-zA-Z0-9_-]{1,96}$/.test(id),'INVALID_REQUEST',422);const op=s[group]?.[id];check(op?.wallet===w.toLowerCase(),'OPERATION_NOT_FOUND',404);return op;}
 function dto(o){const nonce=o.transaction?.nonce;return {id:o.id,kind:o.kind,wallet:o.wallet,state:o.state,originalNonce:nonce,...(pending(o)?{transaction:{from:o.wallet,to:o.wallet,chainId:o.transaction.chainId,nonce,value:'0x0',data:'0x'}}:{}),...(o.cancellationHash?{cancellationHash:o.cancellationHash}:{}),...(o.cancellationReason?{reason:o.cancellationReason}:{}),...(o.replacementOperationId?{replacementOperationId:o.replacementOperationId}:{})};}
 async function reconcile(w,group,id){
  const snapshot=await store.read(),original=owned(snapshot,w,group,id);check(pending(original)||original.cancellationProof,'CANCELLATION_NOT_AVAILABLE');
  if(!pending(original)||!original.cancellationHash)return dto(original);
  check(typeof chain.verifyOperationCancellation==='function','CANCELLATION_NOT_CONNECTED',503);
  const proof=await chain.verifyOperationCancellation(structuredClone(original),original.cancellationHash);
  let voucherEvidence;
  if(proof?.verified===true&&original.kind==='handover'){
   const v=snapshot.vouchers?.[original.voucherId];check(v&&typeof chain.voucherState==='function','CANCELLATION_VOUCHER_UNVERIFIED',503);voucherEvidence=await chain.voucherState(structuredClone(v));
   check(voucherEvidence?.verified===true&&voucherEvidence.finalized===true&&voucherEvidence.voucherId===v.id&&voucherEvidence.generation===v.generation&&voucherEvidence.owner?.toLowerCase()===w.toLowerCase()&&voucherEvidence.recipient?.toLowerCase()===v.wallet&&Number.isSafeInteger(voucherEvidence.chainTime)&&voucherEvidence.chainTime>=proof.chainTime,'CANCELLATION_VOUCHER_UNVERIFIED',503);
  }
  return store.transact(s=>{
   const op=owned(s,w,group,id);if(!pending(op))return dto(op);check(op.cancellationHash===original.cancellationHash&&JSON.stringify(op.transaction)===JSON.stringify(original.transaction),'CANCELLATION_CONTEXT_CHANGED');
   if(proof?.verified!==true){op.cancellationReason=typeof proof?.reason==='string'?proof.reason:'CANCELLATION_PENDING';return dto(op);}
   check(proof.finalized===true&&proof.invalidated===true&&proof.txHash===op.cancellationHash&&proof.wallet===op.wallet&&BigInt(proof.originalNonce)===BigInt(op.transaction.nonce)&&Number(proof.chainId)===Number(op.transaction.chainId)&&Number.isSafeInteger(proof.blockNumber)&&proof.blockNumber>=0&&hash(proof.blockHash)&&Number.isSafeInteger(proof.chainTime),'CANCELLATION_EVIDENCE_MISMATCH',503);
   if(op.kind==='handover'){
    check(proof.chainTime>op.expiresAt,'CANCELLATION_PERMIT_STILL_VALID');const v=s.vouchers?.[op.voucherId],h=s.verificationHandles?.[op.handle];
    check(v?.pendingRedemptionId===op.id&&v.generation===op.generation&&h?.operationId===op.id,'REDEMPTION_RESPONSIBILITY_CHANGED');
    if(voucherEvidence.state==='ISSUED'&&v.expiresAt>voucherEvidence.chainTime){
     const replacementId=newId(),handle=newId();const replacement={...structuredClone(op),id:replacementId,handle,state:'AWAITING_HANDOVER',expiresAt:v.expiresAt,recoveredFrom:op.id,createdAt:clock()};
     for(const field of ['transaction','permit','permitSignature','txHash','candidateHash','candidateHashes','cancellationHash','cancellationReason','cancellationProof','attemptedAt','confirmedBlock'])delete replacement[field];
     s.redemptions[replacementId]=replacement;s.verificationHandles[handle]={...structuredClone(h),id:handle,operationId:replacementId};v.pendingRedemptionId=replacementId;op.replacementOperationId=replacementId;
    }else {const state=voucherEvidence.state==='ISSUED'&&voucherEvidence.chainTime>=v.expiresAt?'EXPIRED':voucherEvidence.state;check(['EXPIRED','CANCELLED','HANDED_OVER','SETTLED'].includes(state),'CANCELLATION_VOUCHER_UNVERIFIED',503);v.state=state;delete v.pendingRedemptionId;}
    if(s.displays)delete s.displays[v.id];
   }else if(op.kind==='settlement'){const v=s.vouchers?.[op.voucherId];if(v?.pendingSettlementId===op.id)delete v.pendingSettlementId;}
   op.state='CANCELLED';op.cancelledAt=clock();op.cancellationProof=structuredClone(proof);delete op.cancellationReason;return dto(op);
  });
 }
 return {get:reconcile,async record(w,group,id,body){
  check(body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).join()==='txHash'&&hash(body.txHash),'INVALID_REQUEST',422);const txHash=body.txHash.toLowerCase();
  await store.transact(s=>{const op=owned(s,w,group,id);check(pending(op)||op.cancellationProof,'CANCELLATION_NOT_AVAILABLE');if(op.cancellationProof){check(op.cancellationHash===txHash,'HASH_CONFLICT');return;}op.cancellationHash=txHash;});
  return reconcile(w,group,id);
 }};
}
