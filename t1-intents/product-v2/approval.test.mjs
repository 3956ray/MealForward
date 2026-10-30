import test from 'node:test';
import assert from 'node:assert/strict';
import {makeApprovalService} from './approval.mjs';
import {approvalTransaction,approvalInterface} from './approval-wire.mjs';
const owner='0x'+'11'.repeat(20),other='0x'+'22'.repeat(20),hash='0x'+'33'.repeat(32),hash2='0x'+'44'.repeat(32);
function fixture(){
 let s={reviews:{r:{id:'r',kind:'support',wallet:owner,name:'Meal',storeId:'store',mealId:'meal',version:1,quantity:'20',unitPrice:'7000000',amount:'140000000',expiresAt:1120}},intents:{}},now=1000,n=0,evidence=null,calls=0;
 const target={chainId:31337,escrow:'0x'+'aa'.repeat(20),asset:'0x'+'bb'.repeat(20)};
 const store={read:async()=>structuredClone(s),transact:async fn=>{const next=structuredClone(s),result=await fn(next);s=next;return structuredClone(result);}};
 const chain={target,approvalEnabled:true,prepareApproval:async o=>{calls++;return approvalTransaction(o,target,5);},verifyApproval:async()=>evidence};
 const api=makeApprovalService({store,chain,clock:()=>now,newId:()=>`approval-${++n}`});
 return {api,chain,state:()=>s,time:t=>now=t,get calls(){return calls;},body:{reviewId:'r',requestId:'request'},receipt:(op,extra={})=>evidence={verified:true,txHash:hash,transaction:op.transaction,finalized:true,outcome:'CONFIRMED',blockNumber:6,owner,asset:target.asset,spender:target.escrow,amount:op.amount,allowance:op.amount,...extra}};
}
async function bind(f,o){await f.api.attempt(owner,o.id);await f.api.recordHash(owner,o.id,hash);}
test('exact approval immutable review, request recovery, session ownership and no send',async()=>{
 const f=fixture(),o=await f.api.prepare(owner,f.body),decoded=approvalInterface.parseTransaction(o.transaction);assert.equal(decoded.name,'approve');assert.equal(decoded.args.amount,140000000n);assert.equal(decoded.args.spender.toLowerCase(),f.chain.target.escrow);assert.equal(o.transaction.to,f.chain.target.asset);assert.equal(f.calls,1);f.state().reviews.r.amount='999';f.time(1200);assert.deepEqual(await f.api.prepare(owner,f.body),o);assert.equal(f.calls,1);await assert.rejects(f.api.prepare(owner,{...f.body,reviewId:'other'}),/REQUEST_CONFLICT/);await assert.rejects(f.api.operation(other,o.id),/APPROVAL_NOT_FOUND/);await assert.rejects(f.api.byRequest(other,'request'),/APPROVAL_NOT_FOUND/);assert.equal((await f.api.operations(other)).items.length,0);
});
test('explicit capabilities, invalid inputs, expired or consumed reviews and wrong owner rejected',async()=>{
 const f=fixture();f.chain.approvalEnabled=false;await assert.rejects(f.api.prepare(owner,f.body),/APPROVAL_NOT_CONNECTED/);f.chain.approvalEnabled='true';await assert.rejects(f.api.prepare(owner,f.body),/APPROVAL_NOT_CONNECTED/);f.chain.approvalEnabled=true;await assert.rejects(f.api.prepare(owner,{...f.body,amount:'1'}),/INVALID_REQUEST/);await assert.rejects(f.api.prepare(other,f.body),/REVIEW_NOT_FOUND/);f.time(1120);await assert.rejects(f.api.prepare(owner,f.body),/REVIEW_EXPIRED/);f.time(1000);f.state().reviews.r.intentId='used';await assert.rejects(f.api.prepare(owner,f.body),/REVIEW_ALREADY_USED/);
});
test('all wallet operation domains exclude approval and unrelated wallets remain independent',async()=>{
 for(const key of ['intents','redemptions','publications','approvals']){const f=fixture();f.state()[key]={x:{wallet:owner,state:'SEND_UNKNOWN'}};await assert.rejects(f.api.prepare(owner,f.body),/WALLET_OPERATION_PENDING/);f.state()[key].x.wallet=other;assert.equal((await f.api.prepare(owner,f.body)).state,'PREPARED');}
});
test('attempt is once, unknown no resend, cancellation only before admission and expired attempt denied',async()=>{
 const f=fixture(),o=await f.api.prepare(owner,f.body);await assert.rejects(f.api.recordHash(owner,o.id,hash),/ATTEMPT_REQUIRED/);const admitted=await f.api.attempt(owner,o.id);assert.equal(admitted.operation.transaction,undefined);await assert.rejects(f.api.attempt(owner,o.id),/ALREADY_ATTEMPTED/);await assert.rejects(f.api.cancel(owner,o.id),/ATTEMPTED_OPERATION_CANNOT_CANCEL/);assert.equal((await f.api.reconcile(owner,o.id)).state,'SEND_UNKNOWN');assert.equal((await f.api.prepare(owner,f.body)).state,'SEND_UNKNOWN');assert.equal(f.calls,1);
 const g=fixture(),p=await g.api.prepare(owner,g.body);g.time(1120);await assert.rejects(g.api.attempt(owner,p.id),/REVIEW_EXPIRED/);assert.equal((await g.api.cancel(owner,p.id)).state,'CANCELLED');
});
test('exact final allowance evidence required, partial verification only binds hash',async()=>{
 const f=fixture(),o=await f.api.prepare(owner,f.body);await bind(f,o);f.receipt(o,{finalized:false});assert.equal((await f.api.reconcile(owner,o.id)).state,'HASH_BOUND');await assert.rejects(f.api.recordHash(owner,o.id,hash2),/HASH_CONFLICT/);f.receipt(o);const r=await f.api.reconcile(owner,o.id);assert.equal(r.state,'CONFIRMED');assert.equal(r.transaction,undefined);assert.equal(r.confirmedBlock,6);assert.equal((await f.api.byRequest(owner,'request')).state,'CONFIRMED');
});
test('receipt mismatches cannot confirm or bind, reverted releases wallet without pretending allowance',async()=>{
 for(const e of [{owner:other},{asset:other},{spender:other},{amount:'1'},{allowance:'140000001'},{allowance:undefined},{transaction:{value:'0x1'}},{txHash:hash2},{blockNumber:undefined},{outcome:undefined}]){const f=fixture(),o=await f.api.prepare(owner,f.body);await bind(f,o);f.receipt(o,e);await assert.rejects(f.api.reconcile(owner,o.id),/EVIDENCE_MISMATCH/);assert.equal(f.state().approvals[o.id].state,'SEND_UNKNOWN');}
 const f=fixture(),o=await f.api.prepare(owner,f.body);await bind(f,o);f.receipt(o,{outcome:'REVERTED',allowance:undefined});assert.equal((await f.api.reconcile(owner,o.id)).state,'REVERTED');
});
test('candidate correction allowed until verified binding, absent receipt stays unknown',async()=>{
 const f=fixture(),o=await f.api.prepare(owner,f.body);await f.api.attempt(owner,o.id);await f.api.recordHash(owner,o.id,hash2);assert.equal((await f.api.reconcile(owner,o.id)).state,'SEND_UNKNOWN');await f.api.recordHash(owner,o.id,hash);f.receipt(o);assert.equal((await f.api.reconcile(owner,o.id)).state,'CONFIRMED');assert.deepEqual(f.state().approvals[o.id].candidateHashes,[hash2,hash]);
});
test('reject unlimited, tampered calldata/target/nonce/chain/value and roll back preparation',async()=>{
 for(const amount of ['0','-1',(2n**256n-1n).toString()]){const f=fixture();f.state().reviews.r.amount=amount;await assert.rejects(f.api.prepare(owner,f.body),/INVALID_APPROVAL_AMOUNT/);}
 for(const patch of [{to:other},{from:other},{chainId:'0x1'},{value:'0x1'},{nonce:'0xffffffffffffffffff'},{gas:'0x1'},{data:approvalInterface.encodeFunctionData('approve',[other,'140000000'])},{data:approvalInterface.encodeFunctionData('approve',['0x'+'aa'.repeat(20),(2n**256n-1n)])}]){const f=fixture();f.chain.prepareApproval=async o=>({...approvalTransaction(o,f.chain.target,5),...patch});await assert.rejects(f.api.prepare(owner,f.body),/TRANSACTION_UNVERIFIED/);assert.equal(Object.keys(f.state().approvals||{}).length,0);}
});
