import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore backend fixture has no declarations
import {publicApproval} from '../../t1f-approval-protocol.mjs';
// @ts-ignore backend fixture has no declarations
import {fixture,NOW} from '../../t1f-approval-test-fixture.mjs';
import {OWNER,DONOR} from '../src/contract.ts';
import {validateState} from '../src/validation.ts';
import {createController} from '../src/controller.ts';
import type {WalletSignContext} from '../src/wallet.ts';

function deferred<T>() {
 let resolve!: (value:T)=>void;
 let reject!: (reason:Error)=>void;
 const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no});
 return {promise,resolve,reject};
}
// Drain the adapter lifecycle and post-sign inspection promise chain.
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve()};
const round=()=>publicApproval({row:fixture().row,context:fixture().context,now:NOW});
const noRound=()=>publicApproval({row:null,context:fixture().context,now:NOW});
function setup() {
 let now=NOW;
 let observation={account:OWNER,chainId:10143};
 const reads: Array<ReturnType<typeof deferred<unknown>>>=[];
 const signatures: Array<ReturnType<typeof deferred<string>>>=[];
 const submits: Array<ReturnType<typeof deferred<unknown>>>=[];
 let inspections=0, connects=0;
 const wallet={providers:()=>[{id:'meta',name:'MetaMask'}],select:(_id:string)=>{},inspect:async()=>{inspections++;return {...observation}},connect:async()=>{connects++;return {...observation}},sign:(_typed:unknown,_account:string,context:WalletSignContext)=>{context.assertCurrent();context.phase('prompt');const d=deferred<string>();signatures.push(d);return d.promise.finally(()=>context.phase('settled'))},dispose:()=>{}};
 const api={read:(_signal?:AbortSignal)=>{const d=deferred<unknown>();reads.push(d);return d.promise},submit:(_input:unknown,_signal?:AbortSignal)=>{const d=deferred<unknown>();submits.push(d);return d.promise}};
 const controller=createController({wallet,api,validate:validateState,render:()=>{},clock:()=>now,signingEnabled:true,reportMs:5,promptMs:5});
 return {controller,reads,signatures,submits,wallet,observation:(x:{account:string;chainId:number})=>{observation=x},clock:(x:number)=>{now=x},counts:()=>({inspections,connects})};
}
test('wallet and backend stay independent; NO_ROUND, role and chain gate signing',async()=>{
 const x=setup();x.controller.selectProvider('meta');
 const pending=x.controller.refresh();
 await x.controller.inspect();
 assert.equal(x.controller.snapshot().wallet.role,'owner');
 assert.equal(x.controller.snapshot().wallet.chainId,10143);
 assert.equal(x.controller.snapshot().backend.phase,'loading');
 x.reads[0].resolve(noRound());await pending;
 assert.equal(x.controller.snapshot().round.reason,'NO_ROUND');
 x.observation({account:DONOR,chainId:1});await x.controller.inspect();
 assert.equal(x.controller.snapshot().wallet.role,'donor');
 assert.equal(x.controller.snapshot().round.canSign,false);
});
test('expired and completed rounds retain records but disable signing',async()=>{
 const x=setup();x.controller.selectProvider('meta');await x.controller.inspect();
 const p=x.controller.refresh();x.reads[0].resolve({...round(),roles:{owner:true,donor:true},status:'COLLECTED_NO_RELEASE'});await p;
 assert.equal(x.controller.snapshot().round.reason,'COLLECTED_NO_RELEASE');
 x.clock(NOW+301);assert.equal(x.controller.snapshot().round.canSign,false);
});
test('sign checks same round again, locks prompt, and discards invalidated result',async()=>{
 const x=setup();x.controller.selectProvider('meta');await x.controller.inspect();
 const initial=x.controller.refresh();x.reads[0].resolve(round());await initial;
 const signing=x.controller.sign();await flush();
 assert.equal(x.reads.length,2);x.reads[1].resolve(round());await flush();
 assert.equal(x.signatures.length,1);
 const duplicate=x.controller.sign();await duplicate;
 assert.equal(x.signatures.length,1);
 x.controller.walletChanged();
 x.signatures[0].resolve('0x'+'a'.repeat(130));await signing;
 assert.equal(x.submits.length,0);
});
test('round swap before prompt and local expiry prevent signature',async()=>{
 const x=setup();x.controller.selectProvider('meta');await x.controller.inspect();
 const initial=x.controller.refresh();x.reads[0].resolve(round());await initial;
 const signing=x.controller.sign();await flush();
 const changed=structuredClone(round());changed.round.id='88888888-8888-4888-8888-888888888888';
 x.reads[1].resolve(changed);await signing;
 assert.equal(x.signatures.length,0);
 x.clock(NOW+301);await x.controller.sign();assert.equal(x.reads.length,2);
});
test('submission response loss requires readback and never auto signs again',async()=>{
 const x=setup();x.controller.selectProvider('meta');await x.controller.inspect();
 const initial=x.controller.refresh();x.reads[0].resolve(round());await initial;
 const signing=x.controller.sign();await flush();x.reads[1].resolve(round());await flush();
 x.signatures[0].resolve('0x'+'a'.repeat(130));await flush();
 assert.equal(x.submits.length,1);x.submits[0].reject(Error('API_NETWORK'));await flush();
 assert.equal(x.reads.length,3);x.reads[2].reject(Error('API_NETWORK'));await signing;
 assert.equal(x.controller.snapshot().round.canSign,false);
 assert.equal(x.signatures.length,1);
});
test('positive and negative readback make no automatic second prompt',async()=>{
 for(const approved of [true,false]){
  const x=setup();x.controller.selectProvider('meta');await x.controller.inspect();
  const initial=x.controller.refresh();x.reads[0].resolve(round());await initial;
  const signing=x.controller.sign();await flush();x.reads[1].resolve(round());await flush();
  x.signatures[0].resolve('0x'+'b'.repeat(130));await flush();
  x.submits[0].reject(Error('API_NETWORK'));await flush();
  x.reads[2].resolve(approved?{...round(),roles:{owner:true,donor:false}}:round());
  await signing;
  assert.equal(x.signatures.length,1);
  assert.equal(x.controller.snapshot().round.reason,approved?'ALREADY_RECORDED':'READY');
 }
});
test('wrong current account or chain before prompt and after return never submits',async()=>{
 for(const changedAt of ['before','after'] as const){
  const x=setup();x.controller.selectProvider('meta');await x.controller.inspect();
  const initial=x.controller.refresh();x.reads[0].resolve(round());await initial;
  const signing=x.controller.sign();await flush();
  if(changedAt==='before')x.observation({account:DONOR,chainId:10143});
  x.reads[1].resolve(round());await flush();
  if(changedAt==='after'){
   assert.equal(x.signatures.length,1);
   x.observation({account:OWNER,chainId:1});
   x.signatures[0].resolve('0x'+'c'.repeat(130));
  }
  await signing;
  assert.equal(x.submits.length,0);
 }
});
test('permission request remains single flight and connection event can settle it',async()=>{
 const permission=deferred<{account:string;chainId:number}>();
 let prompts=0,changed:()=>void=()=>{};
 const wallet={providers:()=>[{id:'meta',name:'MetaMask'}],select:(_id:string)=>{},inspect:async()=>({account:null,chainId:10143}),connect:()=>{prompts++;return permission.promise},sign:async()=>'',dispose:()=>{}};
 const api={read:async()=>noRound(),submit:async()=>noRound()};
 const c=createController({wallet,api,validate:validateState,render:()=>{},clock:()=>NOW,reportMs:5,promptMs:5});
 c.selectProvider('meta');
 const first=c.connect();await c.connect();assert.equal(prompts,1);
 changed=()=>c.walletChanged();changed();
 permission.resolve({account:OWNER,chainId:10143});await first;
 assert.equal(c.snapshot().wallet.role,'owner');
});
test('failed backend refresh invalidates readiness while wallet remains usable',async()=>{
 const x=setup();x.controller.selectProvider('meta');await x.controller.inspect();
 const first=x.controller.refresh();x.reads[0].resolve(round());await first;
 assert.equal(x.controller.snapshot().round.canSign,true);
 const failed=x.controller.refresh();x.reads[1].reject(Error('API_NETWORK'));await failed;
 assert.equal(x.controller.snapshot().round.canSign,false);
 await x.controller.inspect();assert.equal(x.controller.snapshot().wallet.role,'owner');
});
test('correct Donor on 10143 is eligible for its own unrecorded approval',async()=>{
 const x=setup();x.controller.selectProvider('meta');x.observation({account:DONOR,chainId:10143});await x.controller.inspect();
 const p=x.controller.refresh();x.reads[0].resolve(round());await p;
 assert.equal(x.controller.snapshot().round.reason,'READY');
 assert.equal(x.controller.snapshot().wallet.role,'donor');
});
test('local expiry while signature prompt is outstanding discards returned signature',async()=>{
 const x=setup();x.controller.selectProvider('meta');await x.controller.inspect();
 const initial=x.controller.refresh();x.reads[0].resolve(round());await initial;
 const signing=x.controller.sign();await flush();x.reads[1].resolve(round());await flush();
 assert.equal(x.signatures.length,1);
 x.clock(NOW+301);x.signatures[0].resolve('0x'+'d'.repeat(130));await signing;
 assert.equal(x.submits.length,0);
 assert.equal(x.controller.snapshot().round.reason,'EXPIRED');
});
test('provider selection during pending permission cannot accept old provider result',async()=>{
 const permission=deferred<{account:string;chainId:number}>();
 const wallet={providers:()=>[{id:'first',name:'First'},{id:'second',name:'Second'}],select:(_id:string)=>{},inspect:async()=>({account:null,chainId:10143}),connect:()=>permission.promise,sign:async()=>'',dispose:()=>{}};
 const c=createController({wallet,api:{read:async()=>noRound(),submit:async()=>noRound()},validate:validateState,render:()=>{},clock:()=>NOW,reportMs:5,promptMs:5});
 c.selectProvider('first');const pending=c.connect();
 c.selectProvider('second');permission.resolve({account:OWNER,chainId:10143});await pending;
 assert.equal(c.snapshot().wallet.account,null);
});
test('outstanding sign reports progress and rejects wallet prompt without auto retry',async()=>{
 const x=setup();x.controller.selectProvider('meta');await x.controller.inspect();
 const initial=x.controller.refresh();x.reads[0].resolve(round());await initial;
 const signing=x.controller.sign();await flush();x.reads[1].resolve(round());await flush();
 await new Promise(resolve=>setTimeout(resolve,8));
 assert.match(x.controller.snapshot().round.progress,/待处理/);
 x.signatures[0].reject(Error('WALLET_SIGN'));await signing;
 assert.equal(x.signatures.length,1);
 assert.equal(x.submits.length,0);
});
test('local expiry rerenders completed state as expired and preserves both records',async()=>{
 let now=NOW;
 const timers=new Map<number,()=>void>();let next=0;
 const clockwork={setTimeout:(fn:()=>void,_ms:number)=>{const id=++next;timers.set(id,fn);return id as unknown as ReturnType<typeof setTimeout>},clearTimeout:(id:ReturnType<typeof setTimeout>)=>{timers.delete(id as unknown as number)}};
 const rendered:Array<ReturnType<ReturnType<typeof createController>['snapshot']>>=[];
 const wallet={providers:()=>[{id:'meta',name:'MetaMask'}],select:(_id:string)=>{},inspect:async()=>({account:OWNER,chainId:10143}),connect:async()=>({account:OWNER,chainId:10143}),sign:async()=>'',dispose:()=>{}};
 const completed={...round(),roles:{owner:true,donor:true},status:'COLLECTED_NO_RELEASE'};
 const c=createController({wallet,api:{read:async()=>completed,submit:async()=>completed},validate:validateState,render:s=>{rendered.push(s)},clock:()=>now,timers:clockwork});
 c.selectProvider('meta');await c.inspect();await c.refresh();
 assert.equal(c.snapshot().round.reason,'COLLECTED_NO_RELEASE');
 now=NOW+301;
 for(const callback of [...timers.values()])callback();
 assert.equal(rendered.at(-1)?.round.reason,'EXPIRED');
 assert.equal(rendered.at(-1)?.round.state?.roles.owner,true);
 assert.equal(rendered.at(-1)?.round.state?.roles.donor,true);
 c.dispose();
});
test('late submit success cannot undo a newer failed manual refresh',async()=>{
 const x=setup();x.controller.selectProvider('meta');await x.controller.inspect();
 const initial=x.controller.refresh();x.reads[0].resolve(round());await initial;
 const signing=x.controller.sign();await flush();x.reads[1].resolve(round());await flush();
 x.signatures[0].resolve('0x'+'e'.repeat(130));await flush();
 assert.equal(x.submits.length,1);
 const newer=x.controller.refresh();x.reads[2].reject(Error('API_NETWORK'));await newer;
 assert.equal(x.controller.snapshot().backend.phase,'error');
 x.submits[0].resolve({...round(),roles:{owner:true,donor:false}});await signing;
 assert.equal(x.controller.snapshot().backend.phase,'error');
 assert.equal(x.controller.snapshot().round.canSign,false);
 assert.equal(x.controller.snapshot().round.uncertain,true);
});
test('late negative readback cannot restore readiness after newer failed refresh',async()=>{
 const x=setup();x.controller.selectProvider('meta');await x.controller.inspect();
 const initial=x.controller.refresh();x.reads[0].resolve(round());await initial;
 const signing=x.controller.sign();await flush();x.reads[1].resolve(round());await flush();
 x.signatures[0].resolve('0x'+'e'.repeat(130));await flush();
 x.submits[0].reject(Error('API_NETWORK'));await flush();
 assert.equal(x.reads.length,3);
 const newer=x.controller.refresh();x.reads[3].reject(Error('API_NETWORK'));await newer;
 x.reads[2].resolve(round());await signing;
 assert.equal(x.controller.snapshot().backend.phase,'error');
 assert.equal(x.controller.snapshot().round.canSign,false);
 assert.equal(x.controller.snapshot().round.uncertain,true);
});
test('late readback error cannot overwrite a newer successful different round',async()=>{
 const x=setup();x.controller.selectProvider('meta');await x.controller.inspect();
 const initial=x.controller.refresh();x.reads[0].resolve(round());await initial;
 const signing=x.controller.sign();await flush();x.reads[1].resolve(round());await flush();
 x.signatures[0].resolve('0x'+'e'.repeat(130));await flush();
 x.submits[0].reject(Error('API_NETWORK'));await flush();
 const changed=structuredClone(round());changed.round.id='88888888-8888-4888-8888-888888888888';
 const newer=x.controller.refresh();x.reads[3].resolve(changed);await newer;
 x.reads[2].reject(Error('API_NETWORK'));await signing;
 assert.equal(x.controller.snapshot().backend.phase,'ready');
 assert.equal(x.controller.snapshot().round.state?.round?.id,changed.round.id);
 assert.equal(x.controller.snapshot().round.canSign,true);
});
test('late preflight API error cannot overwrite a newer successful refresh',async()=>{
 const x=setup();x.controller.selectProvider('meta');await x.controller.inspect();
 const initial=x.controller.refresh();x.reads[0].resolve(round());await initial;
 const signing=x.controller.sign();await flush();
 const newer=x.controller.refresh();x.reads[2].resolve(round());await newer;
 x.reads[1].reject(Error('API_NETWORK'));await signing;
 assert.equal(x.controller.snapshot().backend.phase,'ready');
 assert.equal(x.controller.snapshot().round.canSign,true);
});
test('raw service response without signing validator is visible but never signable',async()=>{
 const wallet={providers:()=>[{id:'meta',name:'MetaMask'}],select:(_id:string)=>{},inspect:async()=>({account:OWNER,chainId:10143}),connect:async()=>({account:OWNER,chainId:10143}),sign:async()=>'',dispose:()=>{}};
 const c=createController({wallet,api:{read:async()=>round(),submit:async()=>round()},validate:()=>{throw Error('VALIDATION_UNAVAILABLE')},render:()=>{},clock:()=>NOW,signingEnabled:true});
 c.selectProvider('meta');await c.inspect();await c.refresh();
 assert.equal(c.snapshot().backend.phase,'ready');
 assert.equal(c.snapshot().round.reason,'VALIDATION_UNAVAILABLE');
 assert.equal(c.snapshot().round.state,null);
 assert.equal(c.snapshot().round.canSign,false);
});
test('negative read begun during pending submit cannot clear uncertainty after response loss',async()=>{
 const x=setup();x.controller.selectProvider('meta');await x.controller.inspect();
 const initial=x.controller.refresh();x.reads[0].resolve(round());await initial;
 const signing=x.controller.sign();await flush();x.reads[1].resolve(round());await flush();
 x.signatures[0].resolve('0x'+'e'.repeat(130));await flush();
 assert.equal(x.submits.length,1);
 const olderRead=x.controller.refresh();
 assert.equal(x.reads.length,3);
 x.submits[0].reject(Error('API_NETWORK'));await signing;
 x.reads[2].resolve(round());await olderRead;
 assert.equal(x.controller.snapshot().round.reason,'RESULT_UNCERTAIN');
 assert.equal(x.controller.snapshot().round.canSign,false);
 const freshNegative=x.controller.refresh();x.reads[3].resolve(round());await freshNegative;
 assert.equal(x.controller.snapshot().round.reason,'READY');
 assert.equal(x.controller.snapshot().round.canSign,true);
 const freshPositive=x.controller.refresh();x.reads[4].resolve({...round(),roles:{owner:true,donor:false}});await freshPositive;
 assert.equal(x.controller.snapshot().round.reason,'ALREADY_RECORDED');
 assert.equal(x.controller.snapshot().round.canSign,false);
 assert.equal(x.signatures.length,1);
});
test('same-round positive read may resolve uncertainty while submit is pending',async()=>{
 const x=setup();x.controller.selectProvider('meta');await x.controller.inspect();
 const initial=x.controller.refresh();x.reads[0].resolve(round());await initial;
 const signing=x.controller.sign();await flush();x.reads[1].resolve(round());await flush();
 x.signatures[0].resolve('0x'+'e'.repeat(130));await flush();
 const positive=x.controller.refresh();x.reads[2].resolve({...round(),roles:{owner:true,donor:false}});await positive;
 assert.equal(x.controller.snapshot().round.state?.roles.owner,true);
 assert.equal(x.controller.snapshot().round.uncertain,false);
 x.submits[0].reject(Error('API_NETWORK'));await signing;
 assert.equal(x.controller.snapshot().round.reason,'ALREADY_RECORDED');
 assert.equal(x.controller.snapshot().round.uncertain,false);
});
