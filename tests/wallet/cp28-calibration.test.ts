import test from 'node:test'
import assert from 'node:assert/strict'
import {IdentityController, type Calibration} from '../../manual-business-harness/identity.ts'
import type {DynamicAuthClient} from '../../src/dynamic/contracts.ts'

function fixture() {
  let token='synthetic-token', gate=Promise.resolve(), status=200
  const invalidators=new Set<()=>void>(), calls:{path:string;options:RequestInit}[]=[], views:any[]=[]
  const summary:Calibration={status:'VERIFIED_EXPECTATIONS_ONLY',audience:'http://127.0.0.1:12345',issuer:'fixed',environmentId:'fixed',
    sid:{present:true,type:'string'},scopes:['user:basic'],tokenExpiresAt:Date.now()/1000+600,remainingTokenSeconds:600,
    validUntil:Date.now()/1000+120,serverIdentityVerified:false,businessAuthorized:false,profileCreated:false}
  const client={getAccessToken:()=>token,onInvalidate:(fn:()=>void)=>{invalidators.add(fn);return()=>invalidators.delete(fn)},
    logout:async()=>{token='';invalidators.forEach(fn=>fn())}} as unknown as DynamicAuthClient
  const controller=new IdentityController(client,(session,account,message,diagnostic)=>views.push({session,account,message,diagnostic}),async(url,options)=>{
    const path=String(url).split('/').pop()!;calls.push({path,options:options!})
    if(path==='calibrate'){await gate;return new Response(JSON.stringify(status===200?summary:{message:'固定待确认'}),{status})}
    return new Response(JSON.stringify(path==='bootstrap'?{csrfToken:'synthetic-csrf',developmentCalibrationEnabled:true,serverVerificationConfigured:false}:{}))
  })
  return {controller,calls,views,summary,invalidators,change:()=>{token='new-synthetic-token';invalidators.forEach(fn=>fn())},
    delay:()=>{let release!:()=>void;gate=new Promise<void>(resolve=>{release=resolve});return release},deny:()=>{status=401}}
}
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve))

test('calibration sends SDK bearer same-origin with empty body, never exchange or candidate',async()=>{
  const f=fixture();try{
    await f.controller.bootstrap();await f.controller.calibrate()
    const call=f.calls.find(c=>c.path==='calibrate')!
    assert.equal(call.options.credentials,'same-origin');assert.equal(call.options.cache,'no-store')
    assert.equal(call.options.body,'{}');assert.equal((call.options.headers as any).Authorization,'Bearer synthetic-token')
    assert.equal((call.options.headers as any)['X-CSRF-Token'],'synthetic-csrf')
    assert.equal(f.views.at(-1).session,null);assert.equal(f.views.at(-1).diagnostic.businessAuthorized,false)
    await assert.rejects(f.controller.confirm());assert.equal(f.calls.some(c=>['exchange','candidate'].includes(c.path)),false)
  }finally{await f.controller.dispose()}
})
test('token change, logout and unmount invalidate both visible and late diagnostics',async()=>{
  for(const action of ['change','logout','dispose'] as const){
    const f=fixture();try{
      await f.controller.bootstrap();await f.controller.calibrate()
      const release=f.delay(),pending=assert.rejects(f.controller.calibrate());await tick()
      if(action==='change')f.change();else await f.controller[action]()
      release();await pending;assert.equal(f.views.at(-1).diagnostic,undefined)
    }finally{await f.controller.dispose()}
  }
})
test('failed repeat calibration removes prior diagnostic without showing unverified claims',async()=>{
  const f=fixture();try{
    await f.controller.bootstrap();await f.controller.calibrate();f.deny()
    await assert.rejects(f.controller.calibrate(),/固定待确认/)
    assert.equal(f.views.at(-1).diagnostic,undefined)
  }finally{await f.controller.dispose()}
})
test('diagnostic expires at session bound even while the JWT would remain valid',async()=>{
  const f=fixture();try{
    await f.controller.bootstrap();f.summary.validUntil=Date.now()/1000+.05;await f.controller.calibrate()
    await new Promise(resolve=>setTimeout(resolve,100))
    assert.equal(f.views.at(-1).diagnostic,undefined);assert.match(f.views.at(-1).message,/过期/)
  }finally{await f.controller.dispose()}
})
test('disposed controller cannot start calibration or use old session after waiting',async()=>{
  const f=fixture();await f.controller.bootstrap();await f.controller.dispose()
  await assert.rejects(f.controller.calibrate());assert.equal(f.calls.some(c=>c.path==='calibrate'),false)
})
