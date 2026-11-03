import test from 'node:test';
import assert from 'node:assert/strict';
import {makeAtomicFundingService} from './atomic-funding.mjs';
import {chainReference} from './funding-wire.mjs';
import {makeOperationCancellations} from './operation-cancellations.mjs';
const wallet='0x'+'a'.repeat(40),hash='0x'+'b'.repeat(64),batch='0x'+'c'.repeat(64);
function fixture(){
 let data={intents:{op:{id:'op',wallet,kind:'support',mode:'atomic',state:'PREPARED',expiresAt:200,atomicAccount:{codeHash:'pin'},amount:'10',quantity:'1',termsHash:hash,transaction:{nonce:'0x1',chainId:'0x279f'}}}};
 const store={read:async()=>structuredClone(data),transact:async fn=>{const next=structuredClone(data),r=await fn(next);data=next;return r;}};
 const chain={target:{chainId:10143,escrow:'0x'+'d'.repeat(40)},atomicFundingEnabled:true,verifyAtomicAccount:async()=>({verified:true,finalized:true,codeHash:'pin'}),verifyAtomicFunding:async()=>({verified:true,finalized:true,outcome:'CONFIRMED',txHash:hash,batchId:batch,blockNumber:1,wallet,amount:'10',quantity:'1',termsHash:hash})};
 return {store,chain,service:makeAtomicFundingService({store,chain,service:{},clock:()=>100})};
}
test('wallet call ID cannot overwrite canonical funding batch identity',async()=>{
 const f=fixture(),a=await f.service.attempt(wallet,'op');assert.match(a.operation.walletBatchId,/^0x[0-9a-f]{128}$/);assert.equal(a.operation.batchId,undefined);
 await f.service.recordBatch(wallet,'op',{batchId:a.operation.walletBatchId,transactionHashes:[hash]});
 const done=await f.service.status(wallet,'op');assert.equal(done.batchId,batch);assert.equal(done.walletBatchId,a.operation.walletBatchId);assert.equal(done.state,'CONFIRMED');
});
test('generic nonce cancellation cannot expose or release atomic placeholder nonce',async()=>{
 const f=fixture();await f.service.attempt(wallet,'op');let queries=0;
 const c=makeOperationCancellations({store:f.store,chain:{verifyOperationCancellation:async()=>{queries++;return {verified:true};}}});
 await assert.rejects(c.get(wallet,'intents','op'),/ATOMIC_CANCELLATION_REQUIRES_BATCH_PROOF/);
 await assert.rejects(c.record(wallet,'intents','op',{txHash:hash}),/ATOMIC_CANCELLATION_REQUIRES_BATCH_PROOF/);
 assert.equal(queries,0);assert.equal((await f.store.read()).intents.op.cancellationHash,undefined);assert.equal((await f.store.read()).intents.op.state,'SEND_UNKNOWN');
});
test('unverified wallet receipt cannot claim canonical batch identity',async()=>{
 const f=fixture(),a=await f.service.attempt(wallet,'op');await f.service.recordBatch(wallet,'op',{batchId:a.operation.walletBatchId,transactionHashes:[hash]});
 f.chain.verifyAtomicFunding=async()=>({verified:false});const value=await f.service.status(wallet,'op');assert.equal(value.state,'SEND_UNKNOWN');assert.equal(value.batchId,undefined);
});
function expiry(f){return {verified:true,finalized:true,absent:true,wallet,requestId:chainReference('op'),chainId:f.chain.target.chainId,escrow:f.chain.target.escrow,expiresAt:200,chainTime:201,blockNumber:2,blockHash:hash};}
test('only explicit final expired absent-request proof releases attempted funding',async()=>{
 const f=fixture();await f.service.attempt(wallet,'op');f.chain.verifyAtomicExpiry=async()=>({verified:false});await assert.rejects(f.service.cancelExpired(wallet,'op'),/ATOMIC_EXPIRY_UNVERIFIED/);assert.equal((await f.store.read()).intents.op.state,'SEND_UNKNOWN');
 f.chain.verifyAtomicExpiry=async()=>expiry(f);const cancelled=await f.service.cancelExpired(wallet,'op');assert.equal(cancelled.state,'CANCELLED');assert.equal(cancelled.cancellationReason,'EXPIRED_UNFUNDED');assert.equal((await f.service.cancelExpired(wallet,'op')).state,'CANCELLED');assert.equal((await f.service.status(wallet,'op')).state,'CANCELLED');
});
test('proof for another caller, target, request, deadline or nonfinal block cannot release inventory',async()=>{
 for(const change of [{wallet:'other'},{chainId:31337},{escrow:wallet},{requestId:hash},{expiresAt:199},{chainTime:200},{absent:false},{finalized:false},{blockHash:'bad'}]){const f=fixture();await f.service.attempt(wallet,'op');f.chain.verifyAtomicExpiry=async()=>({...expiry(f),...change});await assert.rejects(f.service.cancelExpired(wallet,'op'),/ATOMIC_EXPIRY_UNVERIFIED/);assert.equal((await f.store.read()).intents.op.state,'SEND_UNKNOWN');}
});
test('unverified candidate hash is correctable but confirmed hash is immutable',async()=>{
 const f=fixture(),a=await f.service.attempt(wallet,'op');const body=h=>({batchId:a.operation.walletBatchId,transactionHashes:[h]});await f.service.recordBatch(wallet,'op',body(batch));await f.service.recordBatch(wallet,'op',body(hash));assert.equal((await f.service.status(wallet,'op')).state,'CONFIRMED');await assert.rejects(f.service.recordBatch(wallet,'op',body(batch)),/ATOMIC_HASH_CONFLICT/);
});
test('stale confirmation cannot overwrite an explicit expiry terminal decision',async()=>{
 const f=fixture(),a=await f.service.attempt(wallet,'op');await f.service.recordBatch(wallet,'op',{batchId:a.operation.walletBatchId,transactionHashes:[hash]});let release,started;const entered=new Promise(r=>started=r),gate=new Promise(r=>release=r),verify=f.chain.verifyAtomicFunding;f.chain.verifyAtomicFunding=async()=>{started();await gate;return verify();};const pending=f.service.status(wallet,'op');await entered;f.chain.verifyAtomicExpiry=async()=>expiry(f);await f.service.cancelExpired(wallet,'op');release();assert.equal((await pending).state,'CANCELLED');
});
test('stale expiry cannot release already confirmed original funding',async()=>{
 const f=fixture(),a=await f.service.attempt(wallet,'op');await f.service.recordBatch(wallet,'op',{batchId:a.operation.walletBatchId,transactionHashes:[hash]});let release,started;const entered=new Promise(r=>started=r),gate=new Promise(r=>release=r);f.chain.verifyAtomicExpiry=async()=>{started();await gate;return expiry(f);};const pending=f.service.cancelExpired(wallet,'op');await entered;await f.service.status(wallet,'op');release();assert.equal((await pending).state,'CONFIRMED');
});
