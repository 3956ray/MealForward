import test from 'node:test';
import assert from 'node:assert/strict';
const load=()=>import('./t1f-phase8-service.mjs');
test('Phase8 service requires separate durable capabilities and status never returns bytes',async()=>{
 const {makePhase8Service}=await load();
 assert.throws(()=>makePhase8Service({store:{}}));
 const predecessor={...(await import('./t1f-phase8-protocol.mjs')).PHASE8_FIXED.predecessor};
 const envelope={context:{},predecessor,round:null,operation:null};
 const store=Object.fromEntries(['context','get','create','record','consume','bind','reconcile'].map(k=>[k,async()=>envelope]));
 const s=makePhase8Service({store});const result=await s.status();
 assert.equal(result.status,'NO_ROUND');assert.equal(result.serverMayBroadcast,false);
 assert.equal(result.predecessor.id,predecessor.successor_id);assert.equal(result.operation,null);
 assert.equal(JSON.stringify(result).includes('transaction'),false);
});
test('Phase8 prepare on existing child cannot return wallet bytes or call RPC',async()=>{
 const {makePhase8Service}=await load();const {PHASE8_FIXED}=await import('./t1f-phase8-protocol.mjs');
 const store={};for(const k of ['context','get','create','record','consume','bind','reconcile'])store[k]=async()=>({context:{},predecessor:{...PHASE8_FIXED.predecessor},round:null,operation:{successor_id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',operation_id:'0x'+'8'.repeat(64),stage:'ISSUE_UNKNOWN',revision:0,issuer_nonce:0,issuer_issue_deadline:1793081000,calldata_hash:'0x'+'7'.repeat(64),tx_hash:null,receipt_block:null,receipt_block_hash:null}});
 const s=makePhase8Service({store,rpc:{send(){throw Error('NO_RPC_ALLOWED')}}});
 // Corrupt envelope must fail closed, not manufacture a packet for an existing row.
 await assert.rejects(()=>s.prepare({roundId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',digest:'0x'+'8'.repeat(64)}));
});

import {Wallet} from 'ethers';
import {makePhase8Service,phase8Public} from './t1f-phase8-service.mjs';
import {setupPhase8,NOW,CREATED,HEX,CHILD} from './t1f-phase8-service-fixture.mjs';
import {PHASE8_FIXED as F} from './t1f-phase8-protocol.mjs';
import {t0} from './t1e-first-issue-readiness.mjs';

test('fresh full probe, simulation and durable reservation return wallet bytes only on first prepare',async()=>{
 const f=await setupPhase8(),original=JSON.stringify(f.envelope.context),out=await f.service.prepare(f.body());
 assert.equal(out.created,true);assert.equal(out.transaction.from,F.issuer);assert.equal(out.transaction.nonce,'0x0');assert.equal(out.operation.stage,'ISSUE_UNKNOWN');
 assert.ok(f.calls.some(([m,a])=>m==='eth_call'&&a[0].data===out.transaction.data));
 const calls=f.calls.length;const repeat=await f.service.prepare(f.body());assert.equal(repeat.created,false);assert.equal(repeat.transaction,undefined);assert.equal(f.calls.length,calls);assert.equal(f.counts.consume,1);
 assert.equal((await f.service.status()).transaction,undefined);assert.equal(JSON.stringify(f.envelope.context),original);assert.doesNotMatch(JSON.stringify(await f.service.status()),/PRIVATE_BENEFICIARY|consent|fingerprint/);
});
test('lost commit response then expired read/prepare cannot issue a second packet',async()=>{
 const f=await setupPhase8();f.lose();await assert.rejects(f.service.prepare(f.body()),/LOST_COMMIT/);const calls=f.calls.length;f.setNow(NOW+1000);
 const recovered=await f.service.prepare(f.body());assert.equal(recovered.created,false);assert.equal(recovered.transaction,undefined);assert.equal(f.calls.length,calls);assert.equal(f.counts.consume,1);
});
test('expiry during awaited probe, cancellation, simulation failure and post-simulation reorg never reserve',async()=>{
 for(const kind of ['expiry','cancel','simulation','reorg']){
  const f=await setupPhase8(),ac=new AbortController();let simulated=false;
  const base=f.rpc.send.bind(f.rpc);f.rpc.send=async(m,a)=>{const value=await base(m,a);
   if(kind==='expiry')f.setNow(CREATED+210);if(kind==='cancel')ac.abort();
   if(m==='eth_call'&&a[0].data.startsWith(t0.getFunction('issue').selector)){simulated=true;if(kind==='simulation')return t0.encodeFunctionResult('issue',[HEX('9')]);}
   if(kind==='reorg'&&simulated&&m==='eth_getBlockByNumber')return {...value,hash:HEX('9')};return value;};
  await assert.rejects(f.service.prepare(f.body(),{signal:ac.signal}));assert.equal(f.counts.consume,0,kind);
 }
});
test('cutoff and abort after durable connection acquisition remain guarded',async()=>{
 for(const kind of ['expiry','abort']){const f=await setupPhase8(),ac=new AbortController();f.setBeforeStore(name=>{if(name==='consume'){if(kind==='expiry')f.setNow(CREATED+210);else ac.abort();}});await assert.rejects(f.service.prepare(f.body(),{signal:ac.signal}));assert.equal(f.counts.consume,0);}
});
test('untrusted signer and digest never record or perform RPC',async()=>{
 const f=await setupPhase8();f.envelope.round.approvals=[];const wallet=Wallet.createRandom(),signature=await wallet.signTypedData(f.manifest.domain,f.manifest.types,f.manifest.value);
 await assert.rejects(f.service.submit({...f.body(),role:'owner',signature}),/SIGNER/);assert.equal(f.counts.record,0);assert.equal(f.calls.length,0);
 await assert.rejects(f.service.submit({...f.body(),digest:HEX('a'),role:'owner',signature}),/DIGEST/);assert.equal(f.counts.record,0);
});
test('creation requires fresh wallet report and only creates a V2 round, never a child',async()=>{
 const f=await setupPhase8({withRound:false});await assert.rejects(f.service.createRound({walletObservation:{value:'ISSUER_REPORTED_NO_PENDING_OR_SENT_TRANSACTIONS',observedAt:NOW-121}}),/WALLET_REPORT/);assert.equal(f.counts.create,0);
 const out=await f.service.createRound({walletObservation:{value:'ISSUER_REPORTED_NO_PENDING_OR_SENT_TRANSACTIONS',observedAt:NOW}});assert.equal(out.round.typedData.domain.version,'2');assert.equal(out.operation,null);assert.equal(out.transaction,undefined);assert.equal(f.counts.consume,0);assert.equal(f.counts.create,1);
});
test('operation round/predecessor linkage and lifecycle metadata are fail-closed in public DTO',async()=>{
 const f=await setupPhase8();await f.service.prepare(f.body());
 for(const change of [{round_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},{predecessor_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},{revision:-1},{stage:'ISSUED',tx_hash:HEX('a'),receipt_block:null,receipt_block_hash:null}]){
  const e=structuredClone(f.envelope);Object.assign(e.operation,change);assert.throws(()=>phase8Public(e,NOW),/T1F_PHASE8_/);
 }
});
test('approval receipts must belong to the same round digest with reviewed verification version and valid time',async()=>{
 const f=await setupPhase8();
 for(const change of [{round_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},{digest:HEX('a')},{verification_version:'UNVERIFIED'},{verified_at_epoch:CREATED-1},{verified_at_epoch:NOW+1}]){const e=structuredClone(f.envelope);Object.assign(e.round.approvals[0],change);assert.throws(()=>phase8Public(e,NOW),/T1F_PHASE8_/);}
});
test('bind checks all transaction identity fields and rejects mismatch without durable hash write',async()=>{
 for(const change of [{from:F.owner},{to:F.owner},{chainId:'0x1'},{nonce:'0x1'},{value:'0x1'},{input:'0x1234'},{hash:HEX('9')}]){
  const f=await setupPhase8(),out=await f.service.prepare(f.body()),hash=HEX('8');f.useReceipt(out.transaction,hash);const base=f.rpc.send.bind(f.rpc);f.rpc.send=async(m,a)=>{const r=await base(m,a);return m==='eth_getTransactionByHash'?{...r,...change}:r};
  await assert.rejects(f.service.bind({roundId:f.row.round_id,successorId:CHILD,revision:0,txHash:hash}),/TRANSACTION_IDENTITY/);assert.equal(f.counts.bind,0);
 }
});
test('bound original hash reconciles pending/reverted/success without resending or rewriting original claim',async()=>{
 const f=await setupPhase8(),before=JSON.stringify(f.envelope.context),out=await f.service.prepare(f.body()),hash=HEX('8');f.useReceipt(out.transaction,hash);
 const body={roundId:f.row.round_id,successorId:CHILD,revision:0,txHash:hash};assert.equal((await f.service.bind(body)).operation.stage,'ISSUE_HASH_BOUND');
 const rec={roundId:f.row.round_id,successorId:CHILD,revision:1};assert.equal((await f.service.reconcile(rec)).receiptStatus,'PENDING_NO_REBROADCAST');assert.equal(f.counts.reconcile,0);
 f.setReceiptMode('reverted');assert.equal((await f.service.reconcile(rec)).receiptStatus,'REVERTED_NO_AUTORETRY');assert.equal(f.counts.reconcile,0);
 f.setReceiptMode('good');assert.equal((await f.service.reconcile(rec)).operation.stage,'ISSUED');assert.equal(f.counts.reconcile,1);assert.equal(JSON.stringify(f.envelope.context),before);assert.equal(f.envelope.context.claim.stage,'ISSUE_UNKNOWN');
});

test('existing child still requires selected digest and cannot be reopened by another round',async()=>{
 const f=await setupPhase8();await f.service.prepare(f.body());const calls=f.calls.length;await assert.rejects(f.service.prepare({...f.body(),digest:HEX('9')}),/DIGEST/);await assert.rejects(f.service.prepare({...f.body(),roundId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}),/ROUND/);assert.equal(f.calls.length,calls);assert.equal(f.counts.consume,1);
});
test('concurrent preparation has one durable child and one packet even when both callers start before reserve',async()=>{
 const f=await setupPhase8();const results=await Promise.all([f.service.prepare(f.body()),f.service.prepare(f.body())]);assert.equal(results.filter(r=>r.created).length,1);assert.equal(results.filter(r=>r.transaction).length,1);assert.equal(f.envelope.operation.successor_id,CHILD);
});
test('old predecessor hash becoming known during probe blocks child reservation',async()=>{
 const f=await setupPhase8();f.onRpc((m,a)=>{if(m==='eth_call'&&a[0].data.startsWith(t0.getFunction('issue').selector))f.envelope.predecessor.tx_hash=HEX('8')});await assert.rejects(f.service.prepare(f.body()));assert.equal(f.counts.consume,0);
});
