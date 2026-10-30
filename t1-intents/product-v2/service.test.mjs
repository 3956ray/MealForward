import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {emptyState,makeProductService} from './service.mjs';
import {fundingTransaction} from './funding-wire.mjs';
import {makeProductHttp} from './http.mjs';
const A='0x'+'a'.repeat(40),B='0x'+'b'.repeat(40),C='0x'+'c'.repeat(40),OWNER='0x'+'d'.repeat(40),HASH='0x'+'1'.repeat(64),TERMS='0x'+'2'.repeat(64);
function memoryStore() {
  let state=emptyState(), queue=Promise.resolve();
  return {read:async()=>structuredClone(state),transact(change){const work=queue.then(async()=>{const next=structuredClone(state);const value=await change(next);state=next;return structuredClone(value);});queue=work.catch(()=>{});return work;}};
}
export function fixture(store=memoryStore()) {
  let now=1800000000,sequence=0;
  const snapshot={verified:true,blockNumber:5,asset:{symbol:'test USDC',decimals:6},stores:[{id:'kitchen',name:'Test Kitchen',owner:OWNER}],meals:[{id:'meal',storeId:'kitchen',version:1,name:'Original meal',description:'Original terms',unitPrice:'7000000',windows:[[660,840]],remaining:'20',fundingDeadline:now+10000,listed:true,termsHash:TERMS}]};
  const target={asset:'0x'+'c'.repeat(40),chainId:31337,escrow:'0x'+'e'.repeat(40)};
  const chain={target,fundingEnabled:true,fundingAllowance:async owner=>({verified:true,finalized:true,blockNumber:5,owner,asset:target.asset,spender:target.escrow,allowance:'99999999999999999'}),catalog:async()=>structuredClone(snapshot),prepareFunding:async i=>fundingTransaction(i,target,1),verifyFunding:async()=>({verified:false})};
  const service=makeProductService({store,chain,clock:()=>now,newId:()=>`generated-${++sequence}`});
  const review=(who=A,quantity='1',requestId=`review-${++sequence}`)=>service.reviewSupport(who,{storeId:'kitchen',mealId:'meal',version:1,quantity,requestId});
  const confirm=(who,r,requestId=`confirm-${++sequence}`)=>service.confirmSupport(who,{reviewId:r.id,requestId});
  return {store,service,chain,snapshot,review,confirm,tick:seconds=>now+=seconds,addresses:{A,B,C,OWNER}};
}
const rejects=(fn,code)=>assert.rejects(fn,e=>e.code===code);
test('draft revisions, original public terms, publication review and cross-owner isolation',async()=>{
  const f=fixture(),body={storeId:'kitchen',expectedRevision:0,requestId:'save',name:'New name',description:'New body',unitPrice:'8000000',windows:[[660,840],[1020,1200]],quantity:'30',fundingDeadline:1800008000};
  const draft=await f.service.saveDraft(OWNER,'draft',body);
  assert.equal(draft.revision,1); assert.equal((await f.service.catalog()).meals[0].name,'Original meal');
  assert.deepEqual(await f.service.saveDraft(OWNER,'draft',body),draft);
  await rejects(()=>f.service.saveDraft(B,'draft',body),'STORE_ACCESS_DENIED');
  await rejects(()=>f.service.saveDraft(OWNER,'draft',{...body,requestId:'different',name:'Changed'}),'DRAFT_REVISION_CHANGED');
  const review=await f.service.reviewPublication(OWNER,{draftId:'draft',revision:1,requestId:'publish-review'});
  await f.service.saveDraft(OWNER,'draft',{...body,requestId:'edit',expectedRevision:1,name:'Later draft'});
  assert.equal(review.name,'New name');assert.equal((await f.store.read()).reviews[review.id].name,'New name');
});
test('multi-portion arithmetic exceeds ten, capacity reservation is atomic across payers',async()=>{
  const f=fixture(),a=await f.review(A,'12'),b=await f.review(B,'12');
  const results=await Promise.allSettled([f.confirm(A,a),f.confirm(B,b)]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(results.find(x=>x.status==='rejected').reason.code,'INSUFFICIENT_INVENTORY');
  assert.equal((await f.service.catalog()).meals[0].remaining,'8');
  const c=await f.review(C,'8');assert.equal((await f.confirm(C,c)).amount,'56000000');
  assert.equal((await f.service.orders(A)).items.length,1);assert.equal((await f.service.orders(B)).items.length,0);
});
test('same-wallet pending operation cannot allocate the same nonce; other wallets can proceed',async()=>{
  const f=fixture(),a=await f.review(A),b=await f.review(A),c=await f.review(B);
  await f.confirm(A,a);await rejects(()=>f.confirm(A,b),'WALLET_OPERATION_PENDING');await f.confirm(B,c);
});
test('confirmed review binds every retry request id and never duplicates a payment',async()=>{
  const f=fixture(),r=await f.review(),intent=await f.confirm(A,r,'first');
  assert.equal((await f.confirm(A,r,'second')).id,intent.id);
  const other=await f.review();await rejects(()=>f.confirm(A,other,'second'),'REQUEST_CONFLICT');
  assert.equal((await f.service.orders(A)).items.length,1);
});
test('single attempt, unknown holds past expiry, unverified hash correction and verified final result',async()=>{
  const f=fixture(),intent=await f.confirm(A,await f.review(A,'3'));
  const admissions=await Promise.allSettled([f.service.attempt(A,intent.id),f.service.attempt(A,intent.id)]);
  assert.equal(admissions.filter(x=>x.status==='fulfilled').length,1);
  assert.equal((await f.service.intent(A,intent.id)).transaction,undefined);
  await rejects(()=>f.service.cancel(A,intent.id),'ATTEMPTED_OPERATION_CANNOT_CANCEL');
  await f.service.recordHash(A,intent.id,HASH);f.tick(7201);
  assert.equal((await f.service.reconcile(A,intent.id)).state,'SEND_UNKNOWN');
  assert.equal((await f.service.catalog()).meals[0].remaining,'17');
  const corrected='0x'+'3'.repeat(64);await f.service.recordHash(A,intent.id,corrected);
  f.chain.verifyFunding=async i=>({verified:true,txHash:corrected,finalized:true,blockNumber:6,outcome:'CONFIRMED',amount:i.amount,quantity:i.quantity,termsHash:i.termsHash});
  assert.equal((await f.service.reconcile(A,intent.id)).state,'CONFIRMED');
  await rejects(()=>f.service.recordHash(A,intent.id,HASH),'HASH_CONFLICT');
  // Snapshot at block5 has not incorporated the payment: retain conservative hold.
  assert.equal((await f.service.catalog()).meals[0].remaining,'17');
  f.snapshot.blockNumber=6;f.snapshot.meals[0].remaining='17';
  assert.equal((await f.service.catalog()).meals[0].remaining,'17');
  assert.equal((await f.service.orders(A)).items[0].candidateHashes.length,2);
});
test('only a never-attempted operation can release inventory without chain evidence',async()=>{
  const f=fixture(),intent=await f.confirm(A,await f.review(A,'20'));
  await f.service.cancel(A,intent.id);assert.equal((await f.service.catalog()).meals[0].remaining,'20');
  await rejects(()=>f.service.attempt(A,intent.id),'ALREADY_ATTEMPTED');
  await rejects(()=>f.service.recordHash(A,intent.id,HASH),'ATTEMPT_REQUIRED');
});
test('term changes, unlisting, expiration and invalid integer fields fail before reservation',async()=>{
  const f=fixture(),r=await f.review();
  f.snapshot.meals[0].version=2;await rejects(()=>f.confirm(A,r),'MEAL_VERSION_CHANGED');
  f.snapshot.meals[0].version=1;f.snapshot.meals[0].listed=false;await rejects(()=>f.review(),'FUNDING_CLOSED');
  f.snapshot.meals[0].listed=true;f.tick(121);await rejects(()=>f.confirm(A,r),'REVIEW_EXPIRED');
  for(const quantity of ['0','1.1','-1',1,'01','9'.repeat(78)]) await rejects(()=>f.review(A,quantity),'INVALID_INTEGER');
});
test('wrong transaction payload is rejected before any operation or reservation is persisted',async()=>{
  const f=fixture(),r=await f.review();f.chain.prepareFunding=async i=>({...fundingTransaction(i,f.chain.target,1),value:'0x1'});
  await rejects(()=>f.confirm(A,r),'TRANSACTION_UNVERIFIED');assert.equal((await f.service.orders(A)).items.length,0);
});
test('feature off gates writes server-side; reads and original recovery remain available',async()=>{
  const f=fixture(),r=await f.review(),i=await f.confirm(A,r);f.chain.fundingEnabled=false;
  await rejects(()=>f.service.attempt(A,i.id),'FUNDING_NOT_CONNECTED');
  await rejects(async()=>f.confirm(B,await f.review(B)),'FUNDING_NOT_CONNECTED');
  assert.equal((await f.service.intent(A,i.id)).state,'PREPARED');
  await rejects(()=>f.service.intent(B,i.id),'INTENT_NOT_FOUND');
});
test('HTTP requires pinned origin, verified session and write CSRF; client wallet fields cannot authorize',async()=>{
  const f=fixture();let handler;const server=createServer((req,res)=>handler(req,res));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
  handler=makeProductHttp({service:f.service,origin,enabled:true,authorize:async(req,{write})=>req.headers.cookie==='synthetic-session' ? {wallet:A,csrfVerified:write&&req.headers['x-test-csrf']==='synthetic'} : null});
  try {
    assert.equal((await fetch(origin+'/v1/product/catalog')).status,200);
    assert.equal((await fetch(origin+'/v1/product/orders')).status,401);
    const body={storeId:'kitchen',mealId:'meal',version:1,quantity:'2',requestId:'http'};
    const options={method:'POST',headers:{origin,'content-type':'application/json',cookie:'synthetic-session'},body:JSON.stringify(body)};
    assert.equal((await fetch(origin+'/v1/product/support-reviews',options)).status,403);
    options.headers['x-test-csrf']='synthetic';
    assert.equal((await fetch(origin+'/v1/product/support-reviews',options)).status,200);
    options.headers.origin='https://evil.example';
    assert.equal((await fetch(origin+'/v1/product/support-reviews',options)).status,403);
  } finally {await new Promise(r=>server.close(r));}
});

test('exact allowance is required before reservation and rechecked before admitting any send',async()=>{
  const f=fixture();const verified=f.chain.fundingAllowance;
  f.chain.fundingAllowance=async w=>({...await verified(w),allowance:'0'});
  const r=await f.review();assert.equal(r.approvalRequired,true);
  await assert.rejects(()=>f.confirm(A,r),e=>e.code==='INSUFFICIENT_ALLOWANCE');
  assert.deepEqual((await f.service.orders(A)).items,[]);
  f.chain.fundingAllowance=verified;const intent=await f.confirm(A,r);
  f.chain.fundingAllowance=async w=>({...await verified(w),allowance:'0'});
  await assert.rejects(()=>f.service.attempt(A,intent.id),e=>e.code==='INSUFFICIENT_ALLOWANCE');
  assert.equal((await f.service.intent(A,intent.id)).state,'PREPARED');
  f.chain.fundingAllowance=async w=>({...await verified(w),spender:B});
  await assert.rejects(()=>f.service.attempt(A,intent.id),e=>e.code==='ALLOWANCE_UNVERIFIED');
});
test('current menu uses newest immutable version while funded older portions remain discoverable',async()=>{
  const f=fixture();f.snapshot.meals[0].claimable='3';
  f.snapshot.meals.push({...f.snapshot.meals[0],version:2,name:'New meal',unitPrice:'9000000',claimable:'0'});
  const c=await f.service.catalog();assert.equal(c.meals.length,1);assert.equal(c.meals[0].version,2);assert.equal(c.meals[0].claimable,'3');
  await assert.rejects(()=>f.review(),e=>e.code==='MEAL_VERSION_CHANGED');
  f.snapshot.verified=false;await assert.rejects(()=>f.service.catalog(),e=>e.code==='CATALOG_UNVERIFIED');
});

test('merchant HTTP preserves trusted session scope across lock, recovery, reconcile, resume and cancel',async()=>{
  const calls=[],scope='s'.repeat(64),op={id:'locked',kind:'handover',state:'AWAITING_HANDOVER'};
  const redemptions=Object.fromEntries(['reserveHandover','prepareHandover','operation','byRequest','operations','resumeHandover','cancel','reconcile'].map(method=>[method,async(...args)=>{calls.push([method,...args]);return method==='operations'?{items:[op]}:op;}]));
  let handler;const server=createServer((req,res)=>handler(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
  handler=makeProductHttp({service:fixture().service,redemptions,origin,enabled:true,authorize:async()=>({wallet:A,sessionScope:scope,csrfVerified:true})});
  const get=p=>fetch(origin+'/v1/product'+p),post=(p,body)=>fetch(origin+'/v1/product'+p,{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
  try{
    assert.equal((await post('/merchant/locks',{handle:'h',requestId:'r'})).status,200);assert.deepEqual(calls.at(-1),['reserveHandover',A,scope,{handle:'h',requestId:'r'}]);
    await get('/merchant/operations/locked');assert.deepEqual(calls.slice(-2),[['reconcile',A,'locked'],['operation',A,'locked',scope]]);
    await post('/merchant/operations/locked/reconcile',{});assert.deepEqual(calls.at(-1),['operation',A,'locked',scope]);
    await get('/merchant/operations/by-request/r');assert.deepEqual(calls.at(-1),['operation',A,'locked',scope]);
    await get('/merchant/operations');assert.deepEqual(calls.at(-1),['operations',A,scope]);
    await post('/merchant/operations/locked/resume',{previousDeviceStopped:true});assert.deepEqual(calls.at(-1),['resumeHandover',A,'locked',scope,{previousDeviceStopped:true}]);
    await post('/merchant/operations/locked/cancel',{});assert.deepEqual(calls.at(-1),['cancel',A,'locked',scope]);
    const count=calls.length;assert.equal((await post('/merchant/operations/locked/cancel',{sessionScope:'forged'})).status,422);assert.equal(calls.length,count);
  }finally{await new Promise(r=>server.close(r));}
});
