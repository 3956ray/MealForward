import test from 'node:test'
import assert from 'node:assert/strict'
import {IdentityController} from '../../manual-business-harness/identity.ts'
import type {DynamicAuthClient} from '../../src/dynamic/contracts.ts'

function fixture() {
  const events=new Map<string, (...args:unknown[])=>void>(), invalidators=new Set<()=>void>()
  const methods:string[]=[], requests:{path:string;body?:any;headers:any}[]=[]
  const state={token:'synthetic-token',account:'0x'+'11'.repeat(20),chain:'0x279f',candidate:null as any,session:false,deny:false,expiresAt:Date.now()/1000+120}
  const client={getAccessToken:()=>state.token,onInvalidate:(fn:()=>void)=>{invalidators.add(fn);return()=>invalidators.delete(fn)},
    logout:async()=>{state.token='';invalidators.forEach(fn=>fn())}} as unknown as DynamicAuthClient
  const provider={on:(name:string,fn:(...args:unknown[])=>void)=>{events.set(name,fn)},removeListener:(name:string)=>{events.delete(name)},
    request:async({method}:{method:string})=>{methods.push(method);if(method==='eth_chainId')return state.chain;
      if(method==='eth_accounts'||method==='eth_requestAccounts')return[state.account];throw new Error('Signing is forbidden')}}
  const transport=async(url:any,options:any)=>{
    const path=String(url).split('/').pop()!,body=options.body?JSON.parse(options.body):undefined
    requests.push({path,body,headers:options.headers})
    let data:any={};let status=200
    if(path==='bootstrap')data={csrfToken:'synthetic-csrf',serverVerificationConfigured:true}
    else if(path==='exchange'){state.candidate=null;state.session=true}
    else if(path==='invalidate'||path==='logout'){state.candidate=null;state.session=false}
    else if(path==='candidate'){if(state.deny)status=403;else state.candidate={adminAddress:body.address,merchantAddress:body.address,chainId:10143,controlVerified:false,chainPermissionsVerified:false}}
    if(path==='candidate'||path==='exchange')data={serverIdentityVerified:state.session,expiresAt:state.expiresAt,candidate:state.candidate}
    return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}})
  }
  const views:any[]=[];const controller=new IdentityController(client,(s,a,m)=>views.push({s,a,m}),transport as typeof fetch)
  return {controller,state,provider,events,methods,requests,invalidators,views}
}
test('identity verifies with same-origin CSRF and confirms one shared candidate without signing',async()=>{
  const f=fixture();try{
    await f.controller.bootstrap();await f.controller.verify();await f.controller.connect(f.provider);await f.controller.confirm()
    assert.equal(f.state.candidate.adminAddress,f.state.candidate.merchantAddress)
    assert.deepEqual([...new Set(f.methods)].sort(),['eth_accounts','eth_chainId','eth_requestAccounts'])
    const call=f.requests.find(r=>r.path==='candidate')!
    assert.equal(call.headers['X-CSRF-Token'],'synthetic-csrf');assert.equal(call.headers.Authorization,'Bearer synthetic-token')
  }finally{await f.controller.dispose()}
})
test('token, account, chain and disconnect events revoke previous identity/candidate',async()=>{
  for(const event of ['token','accountsChanged','chainChanged','disconnect']){
    const f=fixture();try{
      await f.controller.bootstrap();await f.controller.verify();await f.controller.connect(f.provider);await f.controller.confirm()
      if(event==='token')f.invalidators.forEach(fn=>fn());else f.events.get(event)!()
      await assert.rejects(f.controller.confirm());assert.equal(f.state.candidate,null);assert.equal(f.views.at(-1).s,null)
    }finally{await f.controller.dispose()}
  }
})
test('changed silent wallet context is checked again before candidate request',async()=>{
  const f=fixture();try{
    await f.controller.bootstrap();await f.controller.verify();await f.controller.connect(f.provider)
    f.state.account='0x'+'22'.repeat(20);await assert.rejects(f.controller.confirm())
    assert.equal(f.requests.some(r=>r.path==='candidate'),false)
  }finally{await f.controller.dispose()}
})
test('no verified identity, wrong chain and backend denial never sign or keep a candidate',async()=>{
  const f=fixture();try{
    await f.controller.bootstrap();await assert.rejects(f.controller.connect(f.provider));assert.equal(f.methods.length,0)
    await f.controller.verify();f.state.chain='0x1';await assert.rejects(f.controller.connect(f.provider))
    f.state.chain='0x279f';await f.controller.connect(f.provider);f.state.deny=true;await assert.rejects(f.controller.confirm())
    assert.equal(f.state.candidate,null);assert.equal(f.methods.some(m=>/sign|send|switch/i.test(m)),false)
  }finally{await f.controller.dispose()}
})
test('logout and disposal remove provider listeners and current candidate',async()=>{
  const f=fixture();await f.controller.bootstrap();await f.controller.verify();await f.controller.connect(f.provider);await f.controller.confirm()
  await f.controller.logout();assert.equal(f.events.size,0);assert.equal(f.state.candidate,null);assert.equal(f.state.token,'')
  await f.controller.dispose();assert.equal(f.invalidators.size,0)
})
test('provider without account/network events is refused before wallet access',async()=>{
  const f=fixture();try{
    await f.controller.bootstrap();await f.controller.verify()
    await assert.rejects(f.controller.connect({request:f.provider.request}))
    assert.equal(f.methods.length,0)
  }finally{await f.controller.dispose()}
})
test('expiry clears the visible confirmation and revokes server preparation',async()=>{
  const f=fixture();try{
    await f.controller.bootstrap();await f.controller.verify();await f.controller.connect(f.provider)
    f.state.expiresAt=Date.now()/1000+.05;await f.controller.confirm()
    await new Promise(resolve=>setTimeout(resolve,100))
    assert.equal(f.state.candidate,null);assert.equal(f.views.at(-1).s,null)
    await assert.rejects(f.controller.confirm())
  }finally{await f.controller.dispose()}
})
