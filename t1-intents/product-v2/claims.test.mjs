import test from 'node:test';
import assert from 'node:assert/strict';
import {Wallet,keccak256} from 'ethers';
import {makeClaimService} from './claims.mjs';
import {claimCalldata} from './claim-wire.mjs';
import {emptyState} from './service.mjs';
const A='0x'+'a'.repeat(40),B='0x'+'b'.repeat(40),OWNER='0x'+'d'.repeat(40),BATCH='0x'+'1'.repeat(64),TERMS='0x'+'2'.repeat(64);
// Fresh synthetic signing identity; no network and never a user's wallet/key.
const platform=Wallet.createRandom();
function fixture(policySeconds=7200) {
  let state=emptyState(),queue=Promise.resolve(),now=Date.parse('2026-10-30T12:00:00+08:00')/1000,seq=0,sends=0;
  const store={read:async()=>structuredClone(state),transact(fn){const run=queue.then(async()=>{const next=structuredClone(state),result=await fn(next);state=next;return structuredClone(result);});queue=run.catch(()=>{});return run;}};
  const candidate={verified:true,storeId:'kitchen',mealId:'meal',name:'Original meal',batchId:BATCH,unitIndex:'0',expectedGeneration:1,version:1,windows:[[660,840]],termsHash:TERMS};
  const target={chainId:31337,escrow:'0x'+'e'.repeat(40),claimAuthority:platform.address,maxFeePerGas:'1000000000',maxTransactionFee:'1000000000000000'};
  const chain={target,claimEnabled:true,
    claimCandidate:async(storeId,mealId)=>({...candidate,storeId,mealId}),
    eligibility:async()=>({verified:true,policySeconds,nextEligibleAt:0}),
    signClaim:async intent=>{const raw=await platform.signTransaction({chainId:31337,to:target.escrow,nonce:0,value:0,gasLimit:1000000,gasPrice:1,data:claimCalldata(intent)});return {verified:true,raw,hash:keccak256(raw)};},
    broadcastClaim:async raw=>{sends++;return keccak256(raw);},
    verifyClaim:async()=>({verified:false}),
    voucherState:async v=>({verified:true,voucherId:v.id,state:'ISSUED',recipient:v.wallet,generation:v.generation}),
  };
  const service=makeClaimService({store,chain,policySeconds,pepper:'synthetic-test-pepper-no-real-secret-000',clock:()=>now,newId:()=>`claim-${++seq}`});
  const review=(w=A,storeId='kitchen')=>service.review(w,{storeId,mealId:'meal',requestId:`review-${++seq}`});
  const confirm=(w,r)=>service.confirm(w,{reviewId:r.id,requestId:`confirm-${++seq}`});
  async function finish(w=A){const intent=await confirm(w,await review(w));await service.signNext();await service.dispatch(intent.id);
    chain.verifyClaim=async i=>({verified:true,txHash:i.txHash,finalized:true,outcome:'CONFIRMED',recipient:i.wallet,batchId:i.batchId,unitIndex:i.unitIndex,termsHash:i.termsHash,generation:i.expectedGeneration,claimedAt:now,expiresAt:now+policySeconds,voucherId:`voucher-${i.id}`});
    const result=await service.reconcile(w,intent.id);return {intent:result,voucher:await service.voucher(w,result.voucherId)};
  }
  return {service,store,chain,candidate,target,review,confirm,finish,now:()=>now,tick:s=>now+=s,sends:()=>sends};
}
const rejects=(fn,code)=>assert.rejects(fn,e=>e.code===code);
test('only two exact policies are supported; funded unlisted/out-of-hours meal may be claimed',async()=>{
  for(const seconds of [7200,259200]){
    const f=fixture(seconds);f.candidate.windows=[[0,1]];
    const review=await f.review();assert.equal(review.lifetimeSeconds,seconds);assert.equal((await f.confirm(A,review)).state,'QUEUED');
  }
  assert.throws(()=>fixture(3600),e=>e.code==='INVALID_CLAIM_POLICY');
});
test('cross-store same-wallet claim and same funded unit cannot be reserved twice',async()=>{
  const f=fixture(),r1=await f.review(),r2=await f.review(A,'second'),r3=await f.review(B);
  await f.confirm(A,r1);await rejects(()=>f.confirm(A,r2),'CLAIM_PENDING');await rejects(()=>f.confirm(B,r3),'UNIT_RESERVED');
});
test('lost confirm response recovers by original request; wrong wallet cannot read it',async()=>{
  const f=fixture(),r=await f.review(),body={reviewId:r.id,requestId:'original'};
  const first=await f.service.confirm(A,body);assert.deepEqual(await f.service.confirm(A,body),first);
  assert.equal((await f.service.byRequest(A,'original')).id,first.id);await rejects(()=>f.service.byRequest(B,'original'),'CLAIM_NOT_FOUND');
  assert.equal(f.sends(),0);
});
test('platform signs and broadcasts once; unknown retains the original hash and never resends',async()=>{
  const f=fixture(),i=await f.confirm(A,await f.review());await f.service.signNext();
  const dto=await f.service.get(A,i.id);assert.equal(dto.packet,undefined);assert.equal(dto.raw,undefined);
  f.chain.broadcastClaim=async()=>{throw Error('response lost');};
  await f.service.dispatch(i.id);await rejects(()=>f.service.dispatch(i.id),'CLAIM_ALREADY_ATTEMPTED');
  assert.equal((await f.service.reconcile(A,i.id)).state,'SEND_UNKNOWN');
  f.tick(7201);await rejects(()=>f.review(),'CLAIM_PENDING');
  assert.equal(await f.service.signNext(),null);
});
test('raw platform packet is verified against original receiver and calldata before outbox acceptance',async()=>{
  const f=fixture(),i=await f.confirm(A,await f.review());
  f.chain.signClaim=async intent=>{const raw=await platform.signTransaction({chainId:31337,to:f.target.escrow,nonce:0,gasLimit:1000000,gasPrice:1,data:claimCalldata({...intent,wallet:B})});return {verified:true,raw,hash:keccak256(raw)};};
  await rejects(()=>f.service.signNext(),'CLAIM_PACKET_UNVERIFIED');assert.equal((await f.service.get(A,i.id)).state,'QUEUED');
});
test('successful claim freezes original terms, enforces global cooldown and binds saved link to wallet',async()=>{
  const f=fixture(),{voucher}=await f.finish();
  assert.equal(voucher.expiresAt-voucher.claimedAt,7200);assert.equal(f.sends(),1);
  assert.equal((await f.service.vouchers(A)).items.length,1);assert.equal((await f.service.vouchers(B)).items.length,0);
  await rejects(()=>f.service.voucher(B,voucher.id),'VOUCHER_NOT_FOUND');
  const review=await f.review(A,'other-store');await rejects(()=>f.confirm(A,review),'CLAIM_COOLDOWN');
  f.tick(7200);assert.equal((await f.service.voucher(A,voucher.id)).state,'EXPIRED');
  f.candidate.expectedGeneration=2;
  assert.equal((await f.confirm(A,await f.review())).state,'QUEUED');
});
test('platform signing requires explicit fee and transaction budgets',async()=>{
  const f=fixture();await f.confirm(A,await f.review());f.target.maxTransactionFee='999999';
  await rejects(()=>f.service.signNext(),'CLAIM_PACKET_UNVERIFIED');assert.equal(f.sends(),0);
  delete f.target.maxFeePerGas;await rejects(()=>f.service.signNext(),'CLAIM_PACKET_UNVERIFIED');assert.equal(f.sends(),0);
});
test('definitive claim revert does not consume cooldown and original confirmation stays failed',async()=>{
  const f=fixture(),r=await f.review(),body={reviewId:r.id,requestId:'failed-original'},i=await f.service.confirm(A,body);
  await f.service.signNext();await f.service.dispatch(i.id);
  f.chain.verifyClaim=async c=>({verified:true,txHash:c.txHash,finalized:true,outcome:'REVERTED'});
  assert.equal((await f.service.reconcile(A,i.id)).state,'REVERTED');assert.equal((await f.service.confirm(A,body)).state,'REVERTED');
  assert.equal((await f.confirm(A,await f.review())).state,'QUEUED');
});
test('short display is wallet-bound, hash-only, <=120 sec and limited by original window/expiry',async()=>{
  const f=fixture(),{voucher}=await f.finish();
  const first=await f.service.display(A,voucher.id);assert.match(first.code,/^\d{6}$/);assert.equal(first.expiresAt-f.now(),120);
  const before=(await f.store.read()).displays[voucher.id];assert.equal(before.code,undefined);assert.match(before.hash,/^[0-9a-f]{64}$/);
  await f.service.display(A,voucher.id);assert.equal((await f.store.read()).displays[voucher.id].generation,2);
  await rejects(()=>f.service.display(B,voucher.id),'VOUCHER_NOT_FOUND');
  f.tick(7190);assert.equal((await f.service.display(A,voucher.id)).expiresAt-f.now(),10);
  f.tick(10);await rejects(()=>f.service.display(A,voucher.id),'VOUCHER_EXPIRED');
});
test('outside original service time or changed chain state cannot issue a display',async()=>{
  const f=fixture();f.candidate.windows=[[720,721]];const {voucher}=await f.finish();f.tick(60);
  await rejects(()=>f.service.display(A,voucher.id),'OUTSIDE_SERVICE_WINDOW');
  f.chain.voucherState=async()=>({verified:true,state:'HANDED_OVER',recipient:A,generation:1});
  await rejects(()=>f.service.display(A,voucher.id),'VOUCHER_UNAVAILABLE');
});

test('local confirmed voucher defeats a stale candidate and only the next expired generation can queue',async()=>{
  const f=fixture();await f.finish(A);
  const held=await f.review(B);await rejects(()=>f.confirm(B,held),'UNIT_RESERVED');
  f.tick(7200);const stale=await f.review(B);await rejects(()=>f.confirm(B,stale),'UNIT_GENERATION_CHANGED');
  f.candidate.expectedGeneration=2;
  const next=await f.review(B);assert.equal((await f.confirm(B,next)).state,'QUEUED');
});
test('handed-over units remain unavailable after nominal expiry and malformed terms never reach a queue',async()=>{
  const f=fixture();const done=await f.finish(A);f.tick(7200);f.candidate.expectedGeneration=2;
  await f.store.transact(s=>{s.vouchers[done.voucher.id].state='HANDED_OVER';});
  const r=await f.review(B);await rejects(()=>f.confirm(B,r),'UNIT_RESERVED');
  f.candidate.termsHash='broken';await rejects(()=>f.review(B),'CANDIDATE_UNVERIFIED');
});
