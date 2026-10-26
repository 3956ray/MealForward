import test from 'node:test';import assert from 'node:assert/strict';import {TypedDataEncoder} from 'ethers';
import {fixture,NOW} from './t1f-approval-test-fixture.mjs';import {publicApproval} from './t1f-approval-protocol.mjs';
import {createApprovalClient,validateApprovalState} from './public/t1f-approval.mjs';
import * as page from './public/t1f-approval.mjs';
import {readFile} from 'node:fs/promises';
const hash=t=>TypedDataEncoder.hash(t.domain,{SuccessorIssueRelease:t.types.SuccessorIssueRelease},t.message);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
function harness({hook}={}){
 const f=fixture(),state=publicApproval({...f,now:NOW});let time=NOW,account=state.wallets.owner,chain='0x279f',signs=0,posts=0,sessions=0,reads=0;
 const events={};const provider={on:(k,fn)=>events[k]=fn,request:async q=>{await hook?.(q.method);if(q.method==='eth_accounts')return [account];if(q.method==='eth_chainId')return chain;if(q.method==='eth_signTypedData_v4'){signs++;return '0x'+'1'.repeat(130)}if(q.method==='wallet_requestPermissions')return [];throw Error('Forbidden wallet method')}};
 const request=async(path,method,body)=>{await hook?.(path);if(path.endsWith('/session')){sessions++;return {csrf:'a'.repeat(64),expiresAt:time+300}}if(path.endsWith('/state')){reads++;return structuredClone(state)}if(path.endsWith('/submit')){posts++;assert.deepEqual(Object.keys(body).sort(),['digest','role','roundId','signature']);return structuredClone(state)}throw Error('Forbidden HTTP path')};
 const client=createApprovalClient({provider,request,hashTypedData:hash,clock:()=>time});
 return {client,state,events,get signs(){return signs},get posts(){return posts},get sessions(){return sessions},get reads(){return reads},changeAccount(event=true){account=state.wallets.donor;if(event)events.accountsChanged?.([account])},changeChain(){chain='0x1';events.chainChanged?.(chain)},expire(){time+=300}};
}
test('explicit session refresh reads durable progress; no automatic wallet action or post',async()=>{
 const h=harness();await h.client.refresh();assert.equal(h.signs,0);assert.equal(h.posts,0);assert.equal(h.sessions,1);
 await h.client.refresh();assert.equal(h.sessions,2);assert.equal(h.client.snapshot().state.round.digest,h.state.round.digest);
 await h.client.sign('owner');assert.equal(h.signs,1);assert.equal(h.posts,1);
});
test('changed digest/schema/domain/static pins never prompt wallet',()=>{
 const h=harness();
 for(const mutate of [s=>s.round.digest='0x'+'8'.repeat(64),s=>s.round.typedData.types.EIP712Domain=[],s=>s.round.typedData.domain.name='Practice',s=>s.round.typedData.message.originalNonce='1',s=>s.round.typedData.message.newNonce=0,s=>s.round.typedData.message.extra='x',s=>s.round.typedData.message.originalDeadline='1792765626',s=>s.wallets.owner=s.wallets.donor,s=>s.noRelease=false,s=>s.private='secret']){const s=structuredClone(h.state);mutate(s);assert.throws(()=>validateApprovalState(s,{hashTypedData:hash,now:NOW}))}
});
test('wallet changes during state fetch and before prompt abort without signature or post',async()=>{
 for(const withEvent of [true,false]){
  const gate=deferred();let block=false;const h=harness({hook:async method=>{if(block&&method==='/v1/approval/state')await gate.promise}});
  await h.client.refresh();block=true;const pending=h.client.sign('owner');await new Promise(r=>setTimeout(r,0));h.changeAccount(withEvent);gate.resolve();await assert.rejects(()=>pending);assert.equal(h.signs,0);assert.equal(h.posts,0);
 }
});
test('account/chain/disconnect while signature pending prevents submission',async()=>{
 for(const event of ['accountsChanged','chainChanged','disconnect']){
  const gate=deferred();const h=harness({hook:async method=>{if(method==='eth_signTypedData_v4')await gate.promise}});await h.client.refresh();
  const pending=h.client.sign('owner');await new Promise(r=>setTimeout(r,0));h.events[event]?.([]);gate.resolve();await assert.rejects(()=>pending);assert.equal(h.posts,0);
 }
});
test('expiry and completed round prohibit prompts; ambiguous submit requires explicit readback',async()=>{
 const h=harness();await h.client.refresh();h.expire();await assert.rejects(()=>h.client.sign('owner'));assert.equal(h.signs,0);
 const complete=harness();complete.state.roles={owner:true,donor:true};complete.state.status='COLLECTED_NO_RELEASE';await complete.client.refresh();await assert.rejects(()=>complete.client.sign('owner'));assert.equal(complete.signs,0);
 let fail=true;const lost=harness({hook:async method=>{if(method.endsWith('/submit')&&fail)throw Error('private network error')}});await lost.client.refresh();await assert.rejects(()=>lost.client.sign('owner'));assert.equal(lost.signs,1);assert.equal(lost.client.snapshot().needsRefresh,true);await assert.rejects(()=>lost.client.sign('owner'));assert.equal(lost.signs,1);fail=false;await lost.client.refresh();assert.equal(lost.client.snapshot().needsRefresh,false);
});
test('sign click cannot silently replace the displayed round with a new server round',async()=>{
 const h=harness();await h.client.refresh();h.state.round.id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 await assert.rejects(()=>h.client.sign('owner'));assert.equal(h.signs,0);assert.equal(h.posts,0);
});
test('completed 2/2 display expires without a refresh or network request',async()=>{
 const h=harness();h.state.roles={owner:true,donor:true};h.state.status='COLLECTED_NO_RELEASE';
 await h.client.refresh();assert.equal(h.client.snapshot().state.status,'COLLECTED_NO_RELEASE');
 const reads=h.reads;h.expire();
 assert.equal(h.client.snapshot().state.status,'EXPIRED');
 assert.deepEqual(h.client.snapshot().state.roles,{owner:true,donor:true});
 assert.equal(h.reads,reads);assert.equal(h.posts,0);assert.equal(h.signs,0);
});
test('formal review text exposes the fixed domain and every signed field, not private records',()=>{
 const h=harness(),text=page.approvalReviewText?.(h.state)??'';
 assert.ok(text.includes(h.state.round.typedData.domain.verifyingContract),'verifying contract must be reviewable');
 for(const [name,value] of Object.entries(h.state.round.typedData.domain))assert.ok(text.includes(name)&&text.includes(String(value)),name);
 for(const [name,value] of Object.entries(h.state.round.typedData.message))assert.ok(text.includes(name)&&text.includes(String(value)),name);
 assert.ok(text.includes('SuccessorIssueRelease'));assert.ok(text.includes(h.state.round.digest));
 assert.doesNotMatch(text,/PRIVATE_BENEFICIARY|consent|fingerprint|signature/);
});
test('complete manifest review is visible before either formal signature control',async()=>{
 const html=await readFile(new URL('./public/t1f-approval.html',import.meta.url),'utf8');
 const review=html.indexOf('id="manifest"');assert.ok(review>=0,'manifest review region must exist');
 assert.ok(review<html.indexOf('id="owner-sign"')&&review<html.indexOf('id="donor-sign"'));
});
