import test from 'node:test';
import assert from 'node:assert/strict';
import {makeTargetRegistry,targetIdOf} from './target-registry.mjs';
import {makeTargetStore,TARGET_SCOPE} from './target-store.mjs';
const old={chainId:10143,escrow:'0x'+'a'.repeat(40),policySeconds:7200},next={...old,escrow:'0x'+'b'.repeat(40),policySeconds:259200};
const A=targetIdOf(old),B=targetIdOf(next),wallet='0x'+'1'.repeat(40);
function fixture(seed={}){
 let data=structuredClone(seed),queue=Promise.resolve();
 const store={read:async()=>structuredClone(data),transact:fn=>{const promise=queue.then(async()=>{const copy=structuredClone(data),result=await fn(copy);data=copy;return result;});queue=promise.catch(()=>{});return promise;}};
 const registry=makeTargetRegistry({legacyTarget:old,targets:[next],activeTargetId:B});
 return {registry,store,a:makeTargetStore({store,registry,targetId:A,clock:()=>10000}),b:makeTargetStore({store,registry,targetId:B,clock:()=>10000})};
}
test('registry routes untagged history only to legacy and refuses unknown targets',()=>{
 const {registry}=fixture();assert.equal(registry.forRecord({}).targetId,A);assert.equal(registry.active().targetId,B);
 assert.throws(()=>registry.forRecord({targetId:null}),/UNKNOWN_TARGET/);
 assert.throws(()=>makeTargetRegistry({legacyTarget:old,targets:[old]}),/DUPLICATE_TARGET/);
 assert.throws(()=>targetIdOf({...old,chainId:'10143'}),/INVALID_TARGET/);
 assert.ok(Object.isFrozen(registry.get(A)));
});
test('same record IDs remain isolated and existing untagged legacy is unchanged',async()=>{
 const f=fixture({intents:{same:{id:'same',wallet,state:'CONFIRMED'}}});
 await f.b.transact(s=>{s.intents.same={id:'same',wallet,state:'CONFIRMED'};return s.intents.same;});
 assert.equal((await f.a.read()).intents.same.targetId,undefined);
 assert.equal((await f.b.read()).intents.same.targetId,B);
 assert.equal((await f.store.read()).intents.same.targetId,undefined);
});
test('shared outbox replacement and mutation persist globally, scope hooks never persist',async()=>{
 const f=fixture();await f.b.transact(s=>{s.platformOutbox={lane:{state:'SIGNED'}};});
 await f.a.transact(s=>{s.platformOutbox.lane.state='SEND_UNKNOWN';});
 assert.equal((await f.b.read()).platformOutbox.lane.state,'SEND_UNKNOWN');
 assert.equal((await f.store.read()).targetStates[B].platformOutbox,undefined);
 assert.ok((await f.b.read())[TARGET_SCOPE]);assert.ok(!JSON.stringify(await f.store.read()).includes('targetScope'));
});
test('concurrent cross-target claims admit only one and rollback rejected target',async()=>{
 const f=fixture();const results=await Promise.allSettled([f.a,f.b].map((scope,i)=>scope.transact(s=>{(s.claims||={})[String(i)]={id:String(i),wallet,state:'QUEUED'};})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'CLAIM_PENDING');
 assert.equal((await f.b.globalClaimStatus(await f.b.read(),wallet)).pending.length,1);
});
test('cooldown uses voucher origin policy; settlement does not release it, cancellation does',async()=>{
 const f=fixture();await f.b.transact(s=>{s.vouchers={v:{id:'v',wallet,state:'SETTLED',claimedAt:9000}};});
 let status=f.a.globalClaimStatus(await f.a.read(),wallet);assert.equal(status.nextEligibleAt,268200);assert.equal(status.eligible,false);
 await assert.rejects(f.a.transact(s=>{s.claims={c:{id:'c',wallet,state:'QUEUED'}};}),/CLAIM_COOLDOWN/);
 await f.b.transact(s=>{s.vouchers.v.state='CANCELLED';});
 await f.a.transact(s=>{s.claims={c:{id:'c',wallet,state:'QUEUED'}};});
});
test('ordinary wallet pending operations exclude other targets and platform scan sees all lanes',async()=>{
 const f=fixture({approvals:{op:{id:'op',wallet,state:'SEND_UNKNOWN'}},claims:{c:{id:'c',wallet,state:'SIGNED'}}});
 await assert.rejects(f.b.transact(s=>{s.intents.other={id:'other',wallet,state:'PREPARED'};}),/WALLET_OPERATION_PENDING/);
 const state=await f.b.read();assert.equal(f.b.hasPendingPlatformTransactions(state),true);assert.equal(state[TARGET_SCOPE].hasPendingPlatformTransactions(),true);
});
test('auto settlement pending exclusion is visible before transaction commit',async()=>{
 const f=fixture();await f.b.transact(s=>{s.autoSettlements={a:{id:'a',state:'SIGNED'}};assert.equal(f.b.hasPendingPlatformTransactions(s),true);});
 assert.equal(f.a.hasPendingPlatformTransactions(await f.a.read()),true);
});
test('target mutation, reserved namespace injection and thrown changes rollback',async()=>{
 const f=fixture();await assert.rejects(f.b.transact(s=>{s.intents.bad={id:'bad',targetId:A};}),/TARGET_RECORD_MISMATCH/);
 await assert.rejects(f.b.transact(s=>{s.targetStates={};}),/TARGET_NAMESPACE_RESERVED/);
 await assert.rejects(f.b.transact(s=>{s.platformOutbox={changed:true};throw Error('abort');}),/abort/);
 assert.deepEqual(await f.store.read(),{});
});
