import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore canonical backend fixture
import {publicApproval} from '../../t1f-approval-protocol.mjs';
// @ts-ignore canonical backend fixture
import {fixture,NOW} from '../../t1f-approval-test-fixture.mjs';
import {OWNER} from '../src/contract.ts';
import {createController} from '../src/controller.ts';
import {createWalletPort} from '../src/wallet.ts';
import {validateState} from '../src/validation.ts';

function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes});return {promise,resolve}}
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve()};
const round=()=>publicApproval({row:fixture().row,context:fixture().context,now:NOW});
async function setup(holdRead=4){
 const previous=(globalThis as any).window;
 const events=new EventTarget();(globalThis as any).window=events;
 let now=NOW,accounts=0,prompts=0,submits=0,failRead=false;
 let state=round();
 const readGate=deferred<string[]>(),promptGate=deferred<string>(),submitGate=deferred<unknown>();
 const calls:string[]=[];
 const scheduled=new Map<number,{fn:()=>void;ms:number}>();let next=0;
 const timers={setTimeout:(fn:()=>void,ms:number)=>{const id=++next;scheduled.set(id,{fn,ms});return id as unknown as ReturnType<typeof setTimeout>},clearTimeout:(id:ReturnType<typeof setTimeout>)=>{scheduled.delete(id as unknown as number)}};
 let c:ReturnType<typeof createController>|undefined;
 const wallet=createWalletPort({changed:()=>c?.walletChanged()});
 const provider={request:async({method}:{method:string})=>{
  calls.push(method);
  if(method==='eth_accounts'){accounts++;return accounts===holdRead?readGate.promise:[OWNER]}
  if(method==='eth_chainId')return '0x279f';
  if(method==='eth_signTypedData_v4'){prompts++;return promptGate.promise}
  throw Error('FORBIDDEN_METHOD');
 }};
 const event=new Event('eip6963:announceProvider') as any;event.detail={info:{uuid:'synthetic',name:'Synthetic'},provider};events.dispatchEvent(event);
 c=createController({wallet,api:{read:async()=>{if(failRead)throw Error('API_NETWORK');return state},submit:async()=>{submits++;return submitGate.promise}},validate:validateState,render:()=>{},clock:()=>now,timers,signingEnabled:true});
 c.selectProvider('synthetic');await c.inspect();await c.refresh();
 return {c,readGate,promptGate,submitGate,calls,counts:()=>({accounts,prompts,submits}),advance:()=>{now=NOW+301},changeRound:()=>{state=structuredClone(state);state.round.id='88888888-8888-4888-8888-888888888888'},failRead:()=>{failRead=true},fire:(ms:number)=>{for(const [id,t] of [...scheduled])if(t.ms===ms){scheduled.delete(id);t.fn()}},callbacks:(ms:number)=>[...scheduled.values()].filter(t=>t.ms===ms).map(t=>t.fn),finish:()=>{c!.dispose();(globalThis as any).window=previous}};
}
for(const invalidation of ['expiry','changed round','failed refresh','wallet event'] as const){
 test(`actual request boundary rejects ${invalidation} after adapter preparation awaits`,async()=>{
  const x=await setup();
  try{
   const signing=x.c.sign();await flush();assert.equal(x.counts().accounts,4);
   if(invalidation==='expiry')x.advance();
   else if(invalidation==='wallet event')x.c.walletChanged();
   else {if(invalidation==='changed round')x.changeRound();else x.failRead();await x.c.refresh()}
   x.readGate.resolve([OWNER]);await flush();
   // Release a wrongly opened prompt too, so RED reports assertions rather than hanging.
   x.promptGate.resolve('0x'+'a'.repeat(130));await signing;
   assert.equal(x.counts().prompts,0);assert.equal(x.counts().submits,0);
  }finally{x.finish()}
 });
}
test('actual current round opens exactly one prompt and submits exactly once',async()=>{
 const x=await setup();
 try{
  const signing=x.c.sign();await flush();x.readGate.resolve([OWNER]);await flush();
  assert.equal(x.counts().prompts,1);await x.c.sign();assert.equal(x.counts().prompts,1);
  x.promptGate.resolve('0x'+'a'.repeat(130));await flush();assert.equal(x.counts().submits,1);
  x.submitGate.resolve({...round(),roles:{owner:true,donor:false}});await signing;
  assert.equal(x.c.snapshot().round.reason,'ALREADY_RECORDED');
  assert.ok(x.calls.every(method=>['eth_accounts','eth_chainId','eth_signTypedData_v4'].includes(method)));
 }finally{x.finish()}
});
for(const readNumber of [2,3,4,5]){
 test(`signing wallet read ${readNumber} reports at ten seconds without false prompt reporting`,async()=>{
  const x=await setup(readNumber);
  try{
   const signing=x.c.sign();await flush();
   if(readNumber===5){assert.equal(x.counts().prompts,1);x.promptGate.resolve('0x'+'a'.repeat(130));await flush()}
   assert.equal(x.counts().accounts,readNumber);
   x.fire(10000);assert.match(x.c.snapshot().round.progress,/钱包.*仍在等待/);
   const progress=x.c.snapshot().round.progress;x.fire(30000);assert.equal(x.c.snapshot().round.progress,progress);
   await x.c.sign();assert.equal(x.counts().accounts,readNumber);
   x.readGate.resolve([OWNER]);await flush();
   if(readNumber!==5){assert.equal(x.counts().prompts,1);x.promptGate.resolve('0x'+'a'.repeat(130));await flush()}
   x.submitGate.resolve({...round(),roles:{owner:true,donor:false}});await signing;
  }finally{x.finish()}
 });
}
test('thirty-second reporting belongs only to a live prompt; slow save retains its own phase',async()=>{
 const x=await setup();
 try{
  const signing=x.c.sign();await flush();assert.equal(x.callbacks(30000).length,0);
  x.readGate.resolve([OWNER]);await flush();assert.equal(x.callbacks(30000).length,1);
  const stalePromptCallbacks=x.callbacks(30000);x.fire(30000);assert.match(x.c.snapshot().round.progress,/签名请求仍待处理/);
  x.promptGate.resolve('0x'+'a'.repeat(130));await flush();assert.equal(x.counts().submits,1);
  assert.equal(x.callbacks(30000).length,0);const saving=x.c.snapshot().round.progress;
  stalePromptCallbacks.forEach(fn=>fn());assert.equal(x.c.snapshot().round.progress,saving);
  x.fire(10000);assert.match(x.c.snapshot().round.progress,/保存.*仍在等待/);
  x.submitGate.resolve({...round(),roles:{owner:true,donor:false}});await signing;
 }finally{x.finish()}
});
test('invalidated signing timer cannot overwrite refreshed progress or release outstanding lock',async()=>{
 const x=await setup();
 try{
  const signing=x.c.sign();await flush();x.readGate.resolve([OWNER]);await flush();
  const stale=x.callbacks(30000);x.changeRound();await x.c.refresh();const progress=x.c.snapshot().round.progress;
  stale.forEach(fn=>fn());assert.equal(x.c.snapshot().round.progress,progress);
  await x.c.sign();assert.equal(x.counts().prompts,1);
  x.promptGate.resolve('0x'+'a'.repeat(130));await signing;assert.equal(x.counts().submits,0);
 }finally{x.finish()}
});
test('observation timestamp records successful reads and clears on invalidation',async()=>{
 const x=await setup(99);
 try{
  assert.equal(x.c.snapshot().wallet.observedAt,NOW);
  x.c.walletChanged();assert.equal(x.c.snapshot().wallet.observedAt,null);
  await x.c.inspect();assert.equal(x.c.snapshot().wallet.observedAt,NOW);
 }finally{x.finish()}
});
