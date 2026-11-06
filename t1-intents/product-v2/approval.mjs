/** Explicit exact-amount ERC20 approval. No signing or broadcasting in this service. */
import {randomUUID} from 'node:crypto';
import {fail} from './service.mjs';
import {validateApprovalTransaction} from './approval-wire.mjs';
const check=(ok,code,status=409)=>{if(!ok)fail(code,status);};
const copy=x=>structuredClone(x);
const ref=v=>{check(typeof v==='string'&&/^[a-zA-Z0-9_-]{1,96}$/.test(v),'INVALID_ID',422);return v;};
const wallet=v=>{check(typeof v==='string'&&/^0x[0-9a-f]{40}$/i.test(v)&&BigInt(v)!==0n,'UNAUTHENTICATED',401);return v.toLowerCase();};
const pending=o=>['AWAITING_HANDOVER','PREPARED','SEND_UNKNOWN','HASH_BOUND'].includes(o.state);
const initialize=s=>{s.approvals||={};s.approvalRequests||={};};
const dto=o=>{const {transaction,...rest}=o;return {...copy(rest),...(o.state==='PREPARED'?{transaction:copy(transaction)}:{})};};
const operationFor=(s,w,id)=>{const o=s.approvals?.[ref(id)];check(o?.wallet===w,'APPROVAL_NOT_FOUND',404);return o;};
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
/**
 * chain.prepareApproval(op) must only construct {from,to,chainId,nonce,value,data}.
 * chain.verifyApproval(op,hash) must independently verify transaction, canonical
 * receipt/finality and allowance(owner,spender) at that SAME final block. Evidence:
 * {verified:true,txHash,transaction,finalized,outcome,blockNumber,owner,asset,
 * spender,amount,allowance}. CONFIRMED needs exact op.amount for both amounts.
 * Missing or noncanonical transactions return unverified; never authorize resend.
 */
export function makeApprovalService({store,chain,clock=()=>Math.floor(Date.now()/1000),newId=randomUUID}){
 const enabled=()=>check(chain.approvalEnabled===true,'APPROVAL_NOT_CONNECTED',503);
 const requestKey=(w,id)=>w+':'+ref(id);
 return {
  async prepare(w,body){w=wallet(w);enabled();check(body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).sort().join()==='requestId,reviewId','INVALID_REQUEST',422);ref(body.reviewId);ref(body.requestId);
   return store.transact(async s=>{initialize(s);const key=requestKey(w,body.requestId),original=s.approvalRequests[key];if(original){check(original.reviewId===body.reviewId,'REQUEST_CONFLICT');return dto(operationFor(s,w,original.id));}
    const r=s.reviews?.[body.reviewId];check(r?.wallet===w&&r.kind==='support','REVIEW_NOT_FOUND',404);
    check(!['intents','redemptions','publications','approvals'].some(k=>Object.values(s[k]||{}).some(o=>o.wallet===w&&pending(o))),'WALLET_OPERATION_PENDING');
    check(!r.intentId,'REVIEW_ALREADY_USED');check(Number.isSafeInteger(r.expiresAt)&&r.expiresAt>clock(),'REVIEW_EXPIRED');
    check(typeof r.amount==='string'&&/^[1-9][0-9]{0,77}$/.test(r.amount)&&BigInt(r.amount)<2n**256n-1n,'INVALID_APPROVAL_AMOUNT',422);
    check(typeof chain.prepareApproval==='function','APPROVAL_NOT_CONNECTED',503);
    const op={id:ref(newId()),kind:'approval',wallet:w,reviewId:r.id,requestId:body.requestId,state:'PREPARED',createdAt:clock(),expiresAt:r.expiresAt,asset:chain.target?.asset,spender:chain.target?.escrow,amount:r.amount,name:r.name,storeId:r.storeId,mealId:r.mealId,version:r.version,quantity:r.quantity,unitPrice:r.unitPrice};
    const tx=await chain.prepareApproval(copy(op));try{op.transaction=validateApprovalTransaction(op,chain.target,tx);}catch{fail('TRANSACTION_UNVERIFIED',503);}
    s.approvals[op.id]=op;s.approvalRequests[key]={reviewId:body.reviewId,id:op.id};return dto(op);
   });
  },
  async operation(w,id){return dto(operationFor(await store.read(),wallet(w),id));},
  async byRequest(w,id){w=wallet(w);const s=await store.read(),r=s.approvalRequests?.[requestKey(w,id)];check(r,'APPROVAL_NOT_FOUND',404);return dto(operationFor(s,w,r.id));},
  async operations(w){w=wallet(w);return {items:Object.values((await store.read()).approvals||{}).filter(o=>o.wallet===w).map(dto)};},
  async attempt(w,id){w=wallet(w);enabled();return store.transact(s=>{const o=operationFor(s,w,id);check(o.state==='PREPARED','ALREADY_ATTEMPTED');check(o.expiresAt>clock(),'REVIEW_EXPIRED');o.state='SEND_UNKNOWN';o.attemptedAt=clock();return {allowed:true,operation:dto(o)};});},
  async cancel(w,id){w=wallet(w);return store.transact(s=>{const o=operationFor(s,w,id);check(['PREPARED','CANCELLED'].includes(o.state),'ATTEMPTED_OPERATION_CANNOT_CANCEL');o.state='CANCELLED';return dto(o);});},
  async recordHash(w,id,hash){w=wallet(w);check(typeof hash==='string'&&/^0x[0-9a-f]{64}$/i.test(hash),'INVALID_HASH',422);hash=hash.toLowerCase();return store.transact(s=>{const o=operationFor(s,w,id);check(['SEND_UNKNOWN','HASH_BOUND','CONFIRMED','REVERTED'].includes(o.state),'ATTEMPT_REQUIRED');check(!o.txHash||o.txHash===hash,'HASH_CONFLICT');o.candidateHashes=[...new Set([...(o.candidateHashes||[]),hash])];o.candidateHash=hash;return dto(o);});},
  async reconcile(w,id){w=wallet(w);const original=operationFor(await store.read(),w,id);if(!original.candidateHash||!['SEND_UNKNOWN','HASH_BOUND'].includes(original.state))return dto(original);check(typeof chain.verifyApproval==='function','VERIFIER_NOT_CONNECTED',503);
   const e=await chain.verifyApproval(copy(original),original.candidateHash);
   return store.transact(s=>{const o=operationFor(s,w,id);if(!['SEND_UNKNOWN','HASH_BOUND'].includes(o.state))return dto(o);check(o.candidateHash===original.candidateHash,'HASH_CONFLICT');if(e?.verified!==true)return dto(o);
    check(e.txHash===o.candidateHash&&e.transaction&&Object.keys(e.transaction).sort().join()===Object.keys(o.transaction).sort().join()&&Object.keys(o.transaction).every(k=>same(String(e.transaction[k]),String(o.transaction[k]))),'EVIDENCE_MISMATCH');
    o.txHash=e.txHash;o.state='HASH_BOUND';if(e.finalized!==true)return dto(o);
    check(Number.isSafeInteger(e.blockNumber)&&e.blockNumber>=0&&['CONFIRMED','REVERTED'].includes(e.outcome),'EVIDENCE_MISMATCH');
    if(e.outcome==='CONFIRMED')check(same(e.owner,o.wallet)&&same(e.asset,o.asset)&&same(e.spender,o.spender)&&e.amount===o.amount&&e.allowance===o.amount,'EVIDENCE_MISMATCH');
    o.state=e.outcome;o.confirmedBlock=e.blockNumber;return dto(o);
   });
  },
 };
}
