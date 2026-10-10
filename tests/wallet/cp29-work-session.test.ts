import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {WorkSessions} from '../../manual-business-harness/work-session.ts'

const session=(role='partner')=>({actorId:'cp29-'+role,role,csrfToken:'synthetic-'+role,expiresAt:5000})
const ok=(value:unknown)=>new Response(JSON.stringify(value),{status:200})
const tick=()=>new Promise(resolve=>setImmediate(resolve))
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r});return {promise,resolve}}

test('late login is revoked before next role login; old response cannot authorize UI',async()=>{
  const pending=deferred<Response>(),calls:string[]=[]
  const work=new WorkSessions((async(path:unknown)=>{
    calls.push(String(path))
    if(String(path).endsWith('partner/login'))return pending.promise
    return ok(String(path).endsWith('/logout')?{loggedOut:true}:session('owner'))
  }) as typeof fetch,()=>1000)
  const old=work.open('partner')
  const login=work.login(old,'synthetic-token',()=>true)
  const rejected=assert.rejects(login,/迟到/)
  await tick()
  const cleanup=work.invalidate(old,async()=>{},true)
  const next=work.login(work.open('owner'),'synthetic-token',()=>true)
  await tick();assert.equal(calls.length,1)
  pending.resolve(ok(session()))
  await rejected;await cleanup;assert.equal((await next).role,'owner')
  assert.deepEqual(calls,['/api/cp28/partner/login','/api/cp28/partner/logout','/api/cp28/owner/login'])
})

test('cleanup failure blocks next login instead of silently proceeding',async()=>{
  let calls=0
  const work=new WorkSessions((async(path:unknown)=>{
    calls++;if(String(path).endsWith('/logout'))throw Error('offline')
    return ok(session())
  }) as typeof fetch,()=>1000)
  const lease=work.open('partner');await work.login(lease,'token',()=>true)
  await assert.rejects(work.invalidate(lease),/清理未确认/)
  await assert.rejects(work.login(work.open('owner'),'token',()=>true),/关闭工作登录/)
  assert.equal(calls,2)
})

test('network-ambiguous login and malformed successful response fail closed',async()=>{
  for(const response of [null,ok({role:'owner'})]){
    let calls=0
    const work=new WorkSessions((async()=>{calls++;if(!response)throw Error('offline');return response}) as typeof fetch)
    await assert.rejects(work.login(work.open('partner'),'token',()=>true),/清理未确认/)
    await assert.rejects(work.login(work.open('owner'),'token',()=>true),/清理未确认/)
    assert.equal(calls,1)
  }
})

test('SDK identity change during login revokes returned session',async()=>{
  let current=true,calls=0
  const wait=deferred<Response>()
  const work=new WorkSessions((async()=>{calls++;return calls===1?wait.promise:ok({loggedOut:true})}) as typeof fetch,()=>1000)
  const login=work.login(work.open('partner'),'token',()=>current)
  const rejected=assert.rejects(login,/迟到/)
  await tick();current=false;wait.resolve(ok(session()));await rejected
  assert.equal(calls,2)
})

test('expired response, close before queue starts, SDK failure, and StrictMode remount',async()=>{
  let calls=0
  const work=new WorkSessions((async()=>{calls++;return ok(calls===1?session():{loggedOut:true})}) as typeof fetch,()=>6000000)
  await assert.rejects(work.login(work.open('partner'),'token',()=>true),/迟到/)
  assert.equal(calls,2)
  const closed=work.open('owner');const cleanup=work.invalidate(closed,async()=>{},true)
  await assert.rejects(work.login(closed,'token',()=>true),/已变化/);await cleanup
  await assert.rejects(work.invalidate(work.open('owner'),async()=>{throw Error('sdk')}),/清理未确认/)
  await assert.rejects(work.login(work.open('owner'),'token',()=>true),/关闭/)
})

test('fixed empty-body endpoints and role-specific CSRF; already revoked cookie accepts 401',async()=>{
  const requests:{url:string,init:RequestInit}[]=[]
  const work=new WorkSessions((async(url:unknown,init:RequestInit)=>{
    requests.push({url:String(url),init})
    return requests.length===1?ok(session('owner')):new Response('{}',{status:401})
  }) as typeof fetch,()=>1000)
  const lease=work.open('owner');await work.login(lease,'synthetic-token',()=>true);await work.invalidate(lease)
  assert.equal(requests[0].init.body,'{}');assert.equal(requests[1].init.body,'{}')
  assert.equal((requests[1].init.headers as Record<string,string>)['X-CSRF-Token'],'synthetic-owner')
  assert.equal(requests[1].url,'/api/cp28/owner/logout')
})

test('recipient entry keeps work SDK behind role-conditional lazy boundary',()=>{
  const app=readFileSync(new URL('../../manual-business-harness/App.tsx',import.meta.url),'utf8')
  assert.match(app,/lazy\(\(\)=>import\('\.\/WorkDynamicLogin'\)\)/)
  assert.match(app,/\(role === 'partner' \|\| role === 'owner'\) &&/)
  assert.doesNotMatch(app,/from ['"].*dynamic\/client/)
  assert.match(app,/generation !== viewGeneration.current/)
})

test('Stage1 fingerprint cannot survive expiry or a disposed preparation controller',async()=>{
  const {IdentityController}=await import('../../manual-business-harness/identity.ts')
  for(const scenario of ['current','expired','disposed']){
    const expiry=Date.now()/1000+120
    const fp=deferred<Response>()
    const client={getAccessToken:()=> 'synthetic-token',onInvalidate:()=>()=>{},logout:async()=>{}}
    const c=new IdentityController(client as any,()=>{},(async(url:unknown)=>{
      if(String(url).endsWith('/fingerprint'))return fp.promise
      return ok({csrfToken:'synthetic-csrf',serverIdentityVerified:true,expiresAt:expiry})
    }) as typeof fetch)
    await c.bootstrap();await c.verify()
    const result=c.fingerprint()
    const checked=scenario==='current'?result:assert.rejects(result)
    await tick()
    if(scenario==='disposed')await c.dispose()
    fp.resolve(ok({subjectFingerprint:'cp29:'+'a'.repeat(64),expiresAt:scenario==='expired'?1:expiry,
                   actorMapped:false,businessAuthorized:false,profileCreated:false}))
    if(scenario==='current')assert.equal(await checked,'cp29:'+'a'.repeat(64));else await checked
    await c.dispose()
  }
})
