import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {Wallet} from 'ethers';
import {makeRedemptionService} from './redemption.mjs';
import {redemptionTransaction,redemptionDomain,redemptionTypes} from './redemption-wire.mjs';
const OWNER='0x'+'d'.repeat(40),OTHER='0x'+'c'.repeat(40),RECIPIENT='0x'+'a'.repeat(40);
const VOUCHER='0x'+'1'.repeat(64),HASH='0x'+'2'.repeat(64),WRONG_HASH='0x'+'3'.repeat(64),CODE='123456';
const PEPPER='synthetic-redemption-test-pepper-no-secret';
const verifier=Wallet.createRandom();
function fixture(){
  let now=Date.parse('2026-10-30T12:00:00+08:00')/1000,sequence=0,queue=Promise.resolve();
  let state={intents:{},publications:{},vouchers:{[VOUCHER]:{id:VOUCHER,wallet:RECIPIENT,storeId:'kitchen',mealId:'meal',name:'Original meal',version:1,
    generation:1,state:'ISSUED',windows:[[660,840],[1020,1260]],claimedAt:now,expiresAt:now+7200}},
    displays:{[VOUCHER]:{hash:createHmac('sha256',PEPPER).update(CODE).digest('hex'),generation:1,expiresAt:now+120}}};
  const store={read:async()=>structuredClone(state),transact(fn){const run=queue.then(async()=>{const next=structuredClone(state),result=await fn(next);state=next;return structuredClone(result);});queue=run.catch(()=>{});return run;}};
  const target={chainId:31337,escrow:'0x'+'e'.repeat(40),redemptionAuthority:verifier.address};
  const chainState={state:'ISSUED',unitPrice:'7000000',settlementAvailableAt:null};
  const chain={target,redemptionEnabled:true,catalog:async()=>({verified:true,stores:[{id:'kitchen',owner:OWNER},{id:'other-kitchen',owner:OTHER}]}),
    voucherState:async v=>({verified:true,finalized:true,voucherId:v.id,...chainState,chainTime:now,recipient:v.wallet,generation:v.generation,storeId:v.storeId,owner:OWNER}),
    signRedemptionPermit:p=>verifier.signTypedData(redemptionDomain(target),redemptionTypes,p),
    prepareHandover:async op=>redemptionTransaction(op,target,0),prepareSettlement:async op=>redemptionTransaction(op,target,1),
    verifyRedemption:async()=>({verified:false})};
  const service=makeRedemptionService({store,chain,pepper:PEPPER,clock:()=>now,newId:()=>`redemption-${++sequence}`});
  const check=()=>service.check(OWNER,'session',{storeId:'kitchen',code:CODE});
  const reserve=async()=>{const checked=await check();return service.reserveHandover(OWNER,'session',{handle:checked.handle,requestId:`reserve-${++sequence}`});};
  const prepare=async()=>{const locked=await reserve();return service.prepareHandover(OWNER,'session',{handle:locked.handle,requestId:`prepare-${++sequence}`,handedOver:true});};
  async function finishHandover(){
    const op=await prepare();await service.attempt(OWNER,op.id);await service.recordHash(OWNER,op.id,HASH);
    chainState.state='HANDED_OVER';chainState.settlementAvailableAt=now+180;
    chain.verifyRedemption=async i=>({verified:true,finalized:true,txHash:i.candidateHash,outcome:'CONFIRMED',blockNumber:10,
      voucherId:i.voucherId,generation:i.generation,owner:OWNER,state:'HANDED_OVER',handedOverAt:now,settlementAvailableAt:now+180});
    await service.reconcile(OWNER,op.id);return op;
  }
  return {store,chain,target,chainState,service,check,reserve,prepare,finishHandover,now:()=>now,tick:s=>now+=s};
}
const rejects=(fn,code)=>assert.rejects(fn,e=>e.code===code||e.message===code);
test('check is non-consuming and private fields never appear in check or payout DTOs',async()=>{
  const f=fixture(),result=await f.check(),state=await f.store.read();assert.equal(result.state,'VALID');
  assert.equal(state.vouchers[VOUCHER].state,'ISSUED');assert.ok(state.displays[VOUCHER]);
  assert.ok(!JSON.stringify(result).includes(RECIPIENT));assert.ok(!JSON.stringify(result).includes(CODE));
  await f.finishHandover();const payouts=await f.service.payouts(OWNER,'kitchen');assert.equal(payouts.items.length,1);
  assert.ok(!JSON.stringify(payouts).includes(RECIPIENT));assert.ok(!JSON.stringify(payouts).includes(CODE));
});
test('wrong owner/store/session and changed display cannot prepare',async()=>{
  const f=fixture();await rejects(()=>f.service.check(OTHER,'session',{storeId:'kitchen',code:CODE}),'STORE_ACCESS_DENIED');
  await rejects(()=>f.service.check(OTHER,'session',{storeId:'other-kitchen',code:CODE}),'VOUCHER_UNAVAILABLE');
  const checked=await f.check();
  await rejects(()=>f.service.reserveHandover(OWNER,'different',{handle:checked.handle,requestId:'wrong-session'}),'CHECK_HANDLE_INVALID');
  await f.store.transact(s=>{s.displays[VOUCHER].generation++;});
  await rejects(()=>f.service.reserveHandover(OWNER,'session',{handle:checked.handle,requestId:'stale-display'}),'CHECK_HANDLE_INVALID');
});
test('failed guessing attempts persist across transactions and enforce session/global limits',async()=>{
  const f=fixture();
  for(let i=0;i<10;i++)await rejects(()=>f.service.check(OWNER,'session',{storeId:'kitchen',code:'000000'}),'INVALID_CODE');
  await rejects(()=>f.check(),'RATE_LIMIT');
  const g=fixture();
  for(let i=0;i<30;i++)await rejects(()=>g.service.check(OWNER,'session-'+Math.floor(i/10),{storeId:'kitchen',code:'000000'}),'INVALID_CODE');
  await rejects(()=>g.service.check(OWNER,'fourth',{storeId:'kitchen',code:CODE}),'RATE_LIMIT');
  g.tick(60);assert.equal((await g.check()).state,'VALID');
});
test('explicit handover, valid platform signature and exact transaction required',async()=>{
  const f=fixture(),checked=await f.check();
  await rejects(()=>f.service.prepareHandover(OWNER,'session',{handle:checked.handle,requestId:'not-confirmed',handedOver:false}),'HANDOVER_CONFIRMATION_REQUIRED');
  await rejects(()=>f.service.prepareHandover(OWNER,'session',{handle:checked.handle,requestId:'without-lock',handedOver:true}),'HANDOVER_LOCK_REQUIRED');
  const lock=await f.service.reserveHandover(OWNER,'session',{handle:checked.handle,requestId:'reserve'});
  const wrong=Wallet.createRandom();f.chain.signRedemptionPermit=p=>wrong.signTypedData(redemptionDomain(f.target),redemptionTypes,p);
  await rejects(()=>f.service.prepareHandover(OWNER,'session',{handle:checked.handle,requestId:'bad-signature',handedOver:true}),'REDEMPTION_SIGNATURE_UNVERIFIED');
  assert.equal((await f.store.read()).vouchers[VOUCHER].pendingRedemptionId,lock.id);
  assert.equal((await f.service.operation(OWNER,lock.id)).state,'AWAITING_HANDOVER');
  f.chain.signRedemptionPermit=p=>verifier.signTypedData(redemptionDomain(f.target),redemptionTypes,p);
  f.chain.prepareHandover=async op=>({...redemptionTransaction(op,f.target,0),to:OTHER});
  await rejects(()=>f.service.prepareHandover(OWNER,'session',{handle:checked.handle,requestId:'bad-tx',handedOver:true}),'TRANSACTION_UNVERIFIED');
});
test('one handle and one voucher responsibility survive repeat and unknown operations',async()=>{
  const f=fixture(),checked=await f.check(),body={handle:checked.handle,requestId:'prepare',handedOver:true};
  const lock=await f.service.reserveHandover(OWNER,'session',{handle:checked.handle,requestId:'reserve'});
  const op=await f.service.prepareHandover(OWNER,'session',body);
  assert.equal(op.id,lock.id);assert.equal((await f.service.byRequest(OWNER,'reserve')).id,op.id);
  assert.equal((await f.service.prepareHandover(OWNER,'session',body)).id,op.id);
  assert.equal((await f.service.byRequest(OWNER,'prepare')).id,op.id);
  assert.equal((await f.service.prepareHandover(OWNER,'session',{...body,requestId:'different'})).id,op.id);
  await rejects(()=>f.service.prepareHandover(OWNER,'session',{...body,handle:'changed'}),'REQUEST_CONFLICT');
  const results=await Promise.allSettled([f.service.attempt(OWNER,op.id),f.service.attempt(OWNER,op.id)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  f.tick(8000);assert.equal((await f.service.reconcile(OWNER,op.id)).state,'SEND_UNKNOWN');
  const saved=await f.store.read();assert.equal(saved.vouchers[VOUCHER].pendingRedemptionId,op.id);assert.equal(saved.displays[VOUCHER],undefined);
  assert.equal((await f.service.operation(OWNER,op.id)).transaction,undefined);
});
test('different cashier sessions cannot acquire two handover locks',async()=>{
  const f=fixture(),a=await f.check(),b=await f.service.check(OWNER,'other-session',{storeId:'kitchen',code:CODE});
  const results=await Promise.allSettled([a,b].map((r,i)=>f.service.reserveHandover(OWNER,i?'other-session':'session',{handle:r.handle,requestId:'lock-'+i})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const op=results.find(r=>r.status==='fulfilled').value;assert.equal(op.state,'AWAITING_HANDOVER');assert.equal(op.transaction,undefined);
  assert.equal(Object.values((await f.store.read()).redemptions).length,1);
});
test('cross funding/publication/approval/merchant operations share wallet nonce gate',async()=>{
  for(const field of ['intents','publications','approvals','redemptions']){
    for(const state of ['AWAITING_HANDOVER','SEND_UNKNOWN']){const f=fixture();await f.store.transact(s=>{s[field]||={};s[field].pending={wallet:OWNER,state};});
    await rejects(()=>f.prepare(),'WALLET_OPERATION_PENDING');}
  }
});
test('handle and service time expiry reject without creating responsibility',async()=>{
  const f=fixture(),checked=await f.check();f.tick(120);
  await rejects(()=>f.service.reserveHandover(OWNER,'session',{handle:checked.handle,requestId:'late'}),'CHECK_HANDLE_INVALID');
  const g=fixture();g.tick(7200);await g.store.transact(s=>{s.vouchers[VOUCHER].expiresAt=g.now()+7200;s.displays[VOUCHER].expiresAt=g.now()+120;});
  await rejects(()=>g.check(),'OUTSIDE_SERVICE_WINDOW');
});
test('permit deadline is capped at original service window end',async()=>{
  const f=fixture();f.tick(7190);await f.store.transact(s=>{s.vouchers[VOUCHER].expiresAt=f.now()+500;s.displays[VOUCHER].expiresAt=f.now()+120;});
  const op=await f.prepare(),saved=(await f.store.read()).redemptions[op.id];
  assert.equal(saved.permit.deadline,f.now()+10);assert.equal(saved.permit.issuedAt,f.now());
  f.tick(10);await rejects(()=>f.service.attempt(OWNER,op.id),'HANDOVER_AUTHORIZATION_EXPIRED');
});
test('candidate hash may be corrected, but validated hash is immutable',async()=>{
  const f=fixture(),op=await f.prepare();await f.service.attempt(OWNER,op.id);
  await f.service.recordHash(OWNER,op.id,WRONG_HASH);await f.service.recordHash(OWNER,op.id,HASH);
  f.chain.verifyRedemption=async()=>({verified:true,txHash:HASH,finalized:false});
  assert.equal((await f.service.reconcile(OWNER,op.id)).state,'HASH_BOUND');
  await rejects(()=>f.service.recordHash(OWNER,op.id,WRONG_HASH),'HASH_CONFLICT');
  await rejects(()=>f.service.operation(OTHER,op.id),'OPERATION_NOT_FOUND');
});
test('only finalized revert unlocks responsibility and old code stays revoked',async()=>{
  const f=fixture(),op=await f.prepare();await f.service.attempt(OWNER,op.id);await f.service.recordHash(OWNER,op.id,HASH);
  f.chain.verifyRedemption=async()=>({verified:true,txHash:HASH,finalized:true,outcome:'REVERTED',blockNumber:10});
  assert.equal((await f.service.reconcile(OWNER,op.id)).state,'REVERTED');
  const saved=await f.store.read();assert.equal(saved.vouchers[VOUCHER].pendingRedemptionId,undefined);assert.equal(saved.displays[VOUCHER],undefined);
  await rejects(()=>f.check(),'INVALID_CODE');
});
test('settlement 179/180 boundary, immutable original amount and one payment responsibility',async()=>{
  const f=fixture();await f.finishHandover();f.tick(179);
  await rejects(()=>f.service.reviewSettlement(OWNER,{voucherId:VOUCHER,requestId:'review'}),'SETTLEMENT_TOO_EARLY');
  const waiting=(await f.service.payouts(OWNER,'kitchen')).items[0];assert.equal(waiting.canSettle,false);assert.equal(waiting.settlementAvailableAt-waiting.chainTime,1);
  f.tick(1);const ready=(await f.service.payouts(OWNER,'kitchen')).items[0];assert.equal(ready.canSettle,true);assert.equal(ready.chainTime,ready.settlementAvailableAt);const review=await f.service.reviewSettlement(OWNER,{voucherId:VOUCHER,requestId:'review'});
  assert.equal(review.amount,'7000000');assert.equal(review.receiver,OWNER);
  const op=await f.service.confirmSettlement(OWNER,{reviewId:review.id,requestId:'confirm'});
  assert.equal((await f.service.confirmSettlement(OWNER,{reviewId:review.id,requestId:'confirm-again'})).id,op.id);
  await f.service.attempt(OWNER,op.id);await f.service.recordHash(OWNER,op.id,HASH);
  f.chain.verifyRedemption=async()=>({verified:true,txHash:HASH,finalized:true,outcome:'CONFIRMED',blockNumber:12,voucherId:VOUCHER,generation:1,owner:OWNER,state:'SETTLED',amount:'7000000',receiver:OWNER});
  assert.equal((await f.service.reconcile(OWNER,op.id)).state,'CONFIRMED');
  assert.equal((await f.service.reconcile(OWNER,op.id)).state,'CONFIRMED');
  f.chainState.state='SETTLED';
  await rejects(()=>f.service.reviewSettlement(OWNER,{voucherId:VOUCHER,requestId:'another'}),'NOT_AWAITING_SETTLEMENT');
  await rejects(()=>f.service.attempt(OWNER,op.id),'ALREADY_ATTEMPTED');
  assert.equal((await f.store.read()).vouchers[VOUCHER].state,'SETTLED');
});
test('mismatched finalized payment evidence cannot mark settled or release operation',async()=>{
  const f=fixture();await f.finishHandover();f.tick(180);
  const r=await f.service.reviewSettlement(OWNER,{voucherId:VOUCHER,requestId:'review'}),op=await f.service.confirmSettlement(OWNER,{reviewId:r.id,requestId:'confirm'});
  await f.service.attempt(OWNER,op.id);await f.service.recordHash(OWNER,op.id,HASH);
  f.chain.verifyRedemption=async()=>({verified:true,txHash:HASH,finalized:true,outcome:'CONFIRMED',blockNumber:12,voucherId:VOUCHER,generation:1,owner:OWNER,state:'SETTLED',amount:'9000000',receiver:OWNER});
  await rejects(()=>f.service.reconcile(OWNER,op.id),'REDEMPTION_EVIDENCE_MISMATCH');
  assert.equal((await f.service.operation(OWNER,op.id)).state,'SEND_UNKNOWN');assert.equal((await f.store.read()).vouchers[VOUCHER].pendingSettlementId,op.id);
});
test('only explicit original-owner cancellation after finalized permit expiry releases unattempted responsibility',async()=>{
  const f=fixture(),op=await f.prepare();assert.equal(op.generation,1);
  await rejects(()=>f.service.cancel(OTHER,op.id),'OPERATION_NOT_FOUND');
  await rejects(()=>f.service.cancel(OWNER,op.id),'CANCELLATION_NOT_YET_SAFE');
  f.tick(120);await rejects(()=>f.service.cancel(OWNER,op.id),'CANCELLATION_NOT_YET_SAFE');
  f.tick(1);f.chainState.finalized=false;await rejects(()=>f.service.cancel(OWNER,op.id),'CANCELLATION_NOT_YET_SAFE');
  f.chainState.finalized=true;
  const cancelled=await f.service.cancel(OWNER,op.id);assert.equal(cancelled.state,'CANCELLED');assert.equal(cancelled.transaction,undefined);
  assert.equal((await f.service.cancel(OWNER,op.id)).state,'CANCELLED');
  const saved=await f.store.read();assert.equal(saved.vouchers[VOUCHER].pendingRedemptionId,undefined);assert.equal(saved.displays[VOUCHER],undefined);
  await rejects(()=>f.check(),'INVALID_CODE');
  await rejects(()=>f.service.recordHash(OWNER,op.id,HASH),'ATTEMPT_REQUIRED');
  await f.store.transact(s=>{s.displays[VOUCHER]={hash:createHmac('sha256',PEPPER).update(CODE).digest('hex'),generation:2,expiresAt:f.now()+120};});
  assert.notEqual((await f.prepare()).id,op.id);
});
test('expiry cannot cancel UNKNOWN or a voucher that already changed onchain',async()=>{
  const f=fixture(),op=await f.prepare();await f.service.attempt(OWNER,op.id);f.tick(1000);
  await rejects(()=>f.service.cancel(OWNER,op.id),'ATTEMPTED_OPERATION_CANNOT_CANCEL');
  assert.equal((await f.store.read()).vouchers[VOUCHER].pendingRedemptionId,op.id);
  const g=fixture(),prepared=await g.prepare();g.tick(121);g.chainState.state='HANDED_OVER';
  await rejects(()=>g.service.cancel(OWNER,prepared.id),'CANCELLATION_NOT_YET_SAFE');
  const h=fixture();await h.finishHandover();h.tick(180);
  const review=await h.service.reviewSettlement(OWNER,{voucherId:VOUCHER,requestId:'review'}),settle=await h.service.confirmSettlement(OWNER,{reviewId:review.id,requestId:'settle'});
  await rejects(()=>h.service.cancel(OWNER,settle.id),'ATTEMPTED_OPERATION_CANNOT_CANCEL');
});
test('durable lock survives display expiry and only its original session can continue',async()=>{
  const f=fixture(),checked=await f.check();let signatures=0;const sign=f.chain.signRedemptionPermit;
  f.chain.signRedemptionPermit=p=>{signatures++;return sign(p);};
  const body={handle:checked.handle,requestId:'reserve'},lock=await f.service.reserveHandover(OWNER,'session',body);
  assert.equal(signatures,0);assert.equal(lock.state,'AWAITING_HANDOVER');assert.equal(lock.transaction,undefined);assert.equal(lock.canConfirmHandover,true);
  assert.equal(lock.handle,checked.handle);assert.equal(lock.expiresAt,f.now()+7200);assert.deepEqual(lock.windows,[[660,840],[1020,1260]]);
  assert.equal((await f.service.reserveHandover(OWNER,'session',body)).id,lock.id);
  await rejects(()=>f.service.reserveHandover(OWNER,'session',{...body,handle:'changed'}),'REQUEST_CONFLICT');
  const privateView=await f.service.operation(OWNER,lock.id,'different');assert.equal(privateView.handle,undefined);assert.equal(privateView.canConfirmHandover,false);
  assert.equal((await f.service.byRequest(OWNER,'reserve','session')).handle,checked.handle);
  await rejects(()=>f.service.prepareHandover(OWNER,'different',{handle:checked.handle,requestId:'hijack',handedOver:true}),'HANDOVER_LOCK_REQUIRED');
  await rejects(()=>f.service.cancel(OWNER,lock.id,'different'),'HANDOVER_LOCK_REQUIRED');
  await rejects(()=>f.service.attempt(OWNER,lock.id),'ALREADY_ATTEMPTED');
  f.tick(121);assert.equal((await f.service.operation(OWNER,lock.id,'session')).state,'AWAITING_HANDOVER');
  const op=await f.service.prepareHandover(OWNER,'session',{handle:checked.handle,requestId:'handover',handedOver:true});
  assert.equal(op.id,lock.id);assert.equal(op.state,'PREPARED');assert.equal(signatures,1);assert.equal(op.expiresAt,f.now()+120);
  assert.equal((await f.service.byRequest(OWNER,'reserve')).id,(await f.service.byRequest(OWNER,'handover')).id);
});
test('explicit cancellation of an unhanded lock requires original session and finalized unchanged voucher',async()=>{
  const f=fixture(),lock=await f.reserve();f.chainState.finalized=false;
  await rejects(()=>f.service.cancel(OWNER,lock.id,'session'),'CANCELLATION_NOT_YET_SAFE');
  f.chainState.finalized=true;f.chainState.state='HANDED_OVER';
  await rejects(()=>f.service.cancel(OWNER,lock.id,'session'),'CANCELLATION_NOT_YET_SAFE');
  f.chainState.state='ISSUED';f.tick(121);
  assert.equal((await f.service.cancel(OWNER,lock.id,'session')).state,'CANCELLED');
  const saved=await f.store.read();assert.equal(saved.vouchers[VOUCHER].pendingRedemptionId,undefined);assert.equal(saved.displays[VOUCHER],undefined);
  await rejects(()=>f.check(),'INVALID_CODE');
  await rejects(()=>f.service.prepareHandover(OWNER,'session',{handle:lock.handle,requestId:'after-cancel',handedOver:true}),'HANDOVER_LOCK_REQUIRED');
});
test('voucher expiry or original window end never automatically releases a lock',async()=>{
  const f=fixture(),lock=await f.reserve();f.tick(7200);
  await rejects(()=>f.service.prepareHandover(OWNER,'session',{handle:lock.handle,requestId:'expired',handedOver:true}),'VOUCHER_UNAVAILABLE');
  assert.equal((await f.store.read()).vouchers[VOUCHER].pendingRedemptionId,lock.id);
  const g=fixture();await g.store.transact(s=>{s.vouchers[VOUCHER].expiresAt+=86400;});const other=await g.reserve();g.tick(7200);
  await rejects(()=>g.service.prepareHandover(OWNER,'session',{handle:other.handle,requestId:'outside',handedOver:true}),'OUTSIDE_SERVICE_WINDOW');
  assert.equal((await g.service.operation(OWNER,other.id)).state,'AWAITING_HANDOVER');
});
test('owner explicitly transfers original unhanded lock to a new login and previous device loses authority',async()=>{
  const f=fixture(),lock=await f.reserve();f.tick(121);
  const listed=await f.service.operations(OWNER,'new-session');assert.equal(listed.items[0].id,lock.id);assert.equal(listed.items[0].handle,undefined);
  assert.ok(!JSON.stringify(listed).includes(RECIPIENT));assert.equal((await f.service.operations(OTHER,'new-session')).items.length,0);
  await rejects(()=>f.service.resumeHandover(OTHER,lock.id,'new-session',{previousDeviceStopped:true}),'OPERATION_NOT_FOUND');
  await rejects(()=>f.service.resumeHandover(OWNER,lock.id,'new-session',{previousDeviceStopped:false}),'PREVIOUS_DEVICE_CONFIRMATION_REQUIRED');
  f.chainState.finalized=false;await rejects(()=>f.service.resumeHandover(OWNER,lock.id,'new-session',{previousDeviceStopped:true}),'HANDOVER_RESUME_UNVERIFIED');f.chainState.finalized=true;
  f.chainState.state='HANDED_OVER';await rejects(()=>f.service.resumeHandover(OWNER,lock.id,'new-session',{previousDeviceStopped:true}),'HANDOVER_RESUME_UNVERIFIED');f.chainState.state='ISSUED';
  const resumed=await f.service.resumeHandover(OWNER,lock.id,'new-session',{previousDeviceStopped:true});
  assert.equal(resumed.id,lock.id);assert.equal(resumed.handle,lock.handle);assert.equal(resumed.canConfirmHandover,true);assert.equal(resumed.transaction,undefined);
  assert.equal((await f.service.resumeHandover(OWNER,lock.id,'new-session',{previousDeviceStopped:true})).id,lock.id);
  assert.equal((await f.service.operation(OWNER,lock.id,'session')).handle,undefined);
  await rejects(()=>f.service.prepareHandover(OWNER,'session',{handle:lock.handle,requestId:'old',handedOver:true}),'HANDOVER_LOCK_REQUIRED');
  await rejects(()=>f.service.cancel(OWNER,lock.id,'session'),'HANDOVER_LOCK_REQUIRED');
  const prepared=await f.service.prepareHandover(OWNER,'new-session',{handle:lock.handle,requestId:'new',handedOver:true});assert.equal(prepared.id,lock.id);
  await rejects(()=>f.service.resumeHandover(OWNER,lock.id,'third-session',{previousDeviceStopped:true}),'HANDOVER_LOCK_NOT_RESUMABLE');
  await f.service.attempt(OWNER,lock.id);
  await rejects(()=>f.service.resumeHandover(OWNER,lock.id,'third-session',{previousDeviceStopped:true}),'HANDOVER_LOCK_NOT_RESUMABLE');
  assert.equal(Object.keys((await f.store.read()).redemptions).length,1);
});
test('final expired voucher proof lets a new owner session explicitly release its original lock',async()=>{
  const f=fixture(),lock=await f.reserve();f.tick(7200);
  await rejects(()=>f.service.resumeHandover(OWNER,lock.id,'new-session',{previousDeviceStopped:true}),'HANDOVER_RESUME_UNVERIFIED');
  await rejects(()=>f.service.cancel(OWNER,lock.id,'new-session'),'HANDOVER_LOCK_REQUIRED');
  f.chainState.state='EXPIRED';f.chainState.finalized=false;
  await rejects(()=>f.service.cancel(OWNER,lock.id,'new-session'),'CANCELLATION_NOT_YET_SAFE');
  f.chainState.finalized=true;f.chainState.voucherId=WRONG_HASH;
  await rejects(()=>f.service.cancel(OWNER,lock.id,'new-session'),'VOUCHER_EVIDENCE_UNVERIFIED');
  f.chainState.voucherId=VOUCHER;
  assert.equal((await f.service.cancel(OWNER,lock.id,'new-session')).state,'CANCELLED');
  const saved=await f.store.read();assert.equal(saved.vouchers[VOUCHER].state,'EXPIRED');assert.equal(saved.vouchers[VOUCHER].pendingRedemptionId,undefined);assert.equal(saved.displays[VOUCHER],undefined);
});
test('expired chain state cannot unlock early, before immutable permit deadline, or after attempt',async()=>{
  const a=fixture(),lock=await a.reserve();a.chainState.state='EXPIRED';
  await rejects(()=>a.service.cancel(OWNER,lock.id,'new-session'),'CANCELLATION_NOT_YET_SAFE');
  const b=fixture();await b.store.transact(s=>{s.vouchers[VOUCHER].expiresAt=b.now()+120;});const prepared=await b.prepare();b.tick(120);b.chainState.state='EXPIRED';
  await rejects(()=>b.service.cancel(OWNER,prepared.id,'new-session'),'CANCELLATION_NOT_YET_SAFE');b.tick(1);
  assert.equal((await b.service.cancel(OWNER,prepared.id,'new-session')).state,'CANCELLED');
  const c=fixture(),unknown=await c.prepare();await c.service.attempt(OWNER,unknown.id);c.tick(7200);c.chainState.state='EXPIRED';
  await rejects(()=>c.service.cancel(OWNER,unknown.id,'new-session'),'ATTEMPTED_OPERATION_CANNOT_CANCEL');
  await c.service.recordHash(OWNER,unknown.id,HASH);c.chain.verifyRedemption=async()=>({verified:true,txHash:HASH,finalized:false});await c.service.reconcile(OWNER,unknown.id);
  await rejects(()=>c.service.cancel(OWNER,unknown.id,'new-session'),'ATTEMPTED_OPERATION_CANNOT_CANCEL');
});
