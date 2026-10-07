import test from 'node:test'
import assert from 'node:assert/strict'
import {registerHooks} from 'node:module'
import {IdentityController} from '../../manual-business-harness/identity.ts'

function deferred() {
  let resolve!:()=>void, reject!:(error:Error)=>void
  const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no})
  return {promise,resolve,reject}
}
const fixture={initialize:Promise.resolve(),send:Promise.resolve(),verify:Promise.resolve(),logout:Promise.resolve(),sends:0,verifies:0,initializations:0}
// Only the vendor boundary is replaced; exercise the actual shared client and controller.
;(globalThis as any).cp28LifecycleFixture=fixture
registerHooks({
  resolve(specifier,context,next){return specifier==='@dynamic-labs-sdk/client'
    ? {url:'synthetic:cp28-lifecycle-sdk',shortCircuit:true}:next(specifier,context)},
  load(url,context,next){return url==='synthetic:cp28-lifecycle-sdk' ? {format:'module',shortCircuit:true,source:`
    const f=globalThis.cp28LifecycleFixture;
    export const createDynamicClient=()=>({projectSettings:{security:{}},token:null,user:null,listeners:[]});
    export const onEvent=({listener},raw)=>{raw.listeners.push(listener);return()=>{raw.listeners=raw.listeners.filter(x=>x!==listener)}};
    export const initializeClient=async()=>{f.initializations++;await f.initialize};
    export const sendEmailOTP=async({email})=>{f.sends++;await f.send;return {email}};
    export const verifyOTP=async(_,raw)=>{f.verifies++;await f.verify;raw.token='synthetic-token';raw.user={id:'synthetic',scope:'user:basic'};raw.listeners.forEach(fn=>fn())};
    export const logout=async(raw)=>{await f.logout;raw.token=null;raw.user=null;raw.listeners.forEach(fn=>fn())};
  `}:next(url,context)},
})
const {createDynamicAuthClient}=await import('../../src/dynamic/client.ts')
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve))
function reset() {
  Object.assign(fixture,{initialize:Promise.resolve(),send:Promise.resolve(),verify:Promise.resolve(),logout:Promise.resolve(),sends:0,verifies:0,initializations:0})
  return createDynamicAuthClient()
}
const email='synthetic@example.invalid'

test('normal initial email and OTP authentication still work',async()=>{
  const client=reset();await client.startEmail(email)
  assert.equal(client.getSnapshot().status,'email-pending')
  await client.verifyOtp('000000');assert.equal(client.getSnapshot().status,'authenticated')
  assert.equal(client.getAccessToken(),'synthetic-token');await client.logout()
})
for(const exit of ['logout','dispose'] as const) test(`deferred initialization then ${exit} cannot send OTP; new entry can log in`,async()=>{
  const client=reset(),init=deferred(),http=deferred();fixture.initialize=init.promise
  const controller=new IdentityController(client,()=>{},async(url)=>{
    if(String(url).endsWith('invalidate'))await http.promise
    return new Response(JSON.stringify({csrfToken:'synthetic-csrf'}))
  })
  await controller.bootstrap()
  const action=client.startEmail(email),rejected=assert.rejects(action)
  await tick();assert.equal(fixture.initializations,1)
  const cleanup=exit==='dispose'?controller.dispose():controller.logout()
  // Do not wait for HTTP cleanup: departure must cancel the SDK action immediately.
  assert.equal(client.getSnapshot().status,'signed-out')
  init.resolve();await rejected
  assert.equal(fixture.sends,0);assert.equal(client.getSnapshot().status,'signed-out')
  http.resolve();await cleanup
  await client.startEmail(email);assert.equal(fixture.sends,1)
  await client.verifyOtp('000000');assert.equal(client.getSnapshot().status,'authenticated')
  await controller.dispose()
})
test('late initialization failure after logout does not replace signed-out state',async()=>{
  const client=reset(),init=deferred();fixture.initialize=init.promise
  const action=assert.rejects(client.startEmail(email));await tick();await client.logout()
  init.reject(new Error('synthetic initialization failure'));await action
  assert.equal(client.getSnapshot().status,'signed-out');assert.equal(fixture.sends,0)
  fixture.initialize=Promise.resolve();await client.startEmail(email)
  assert.equal(client.getSnapshot().status,'email-pending');await client.logout()
})
for(const phase of ['send','verify'] as const) test(`late ${phase} result after departure cannot restore the old identity`,async()=>{
  const client=reset(),gate=deferred()
  if(phase==='verify')await client.startEmail(email)
  fixture[phase]=gate.promise
  const action=assert.rejects(phase==='send'?client.startEmail(email):client.verifyOtp('000000'))
  await tick();await client.logout();gate.resolve();await action
  assert.equal(client.getSnapshot().status,'signed-out');assert.equal(client.getAccessToken(),null)
  fixture[phase]=Promise.resolve();await client.startEmail(email);await client.verifyOtp('000000')
  assert.equal(client.getSnapshot().status,'authenticated');await client.logout()
})
test('new login waits for SDK logout; another exit cancels that waiting action',async()=>{
  const client=reset(),gate=deferred();await client.startEmail(email);fixture.logout=gate.promise
  const first=client.logout();const action=assert.rejects(client.startEmail(email))
  await tick();assert.equal(fixture.sends,1)
  const second=client.logout();gate.resolve();await Promise.all([first,second,action])
  assert.equal(fixture.sends,1);assert.equal(client.getSnapshot().status,'signed-out')
  await client.startEmail(email);assert.equal(fixture.sends,2);await client.logout()
})
