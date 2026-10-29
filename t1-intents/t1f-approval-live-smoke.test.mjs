import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {makeApprovalHttpHandler} from './t1f-approval-server.mjs';
import {APPROVAL_WALLETS} from './t1f-approval-protocol.mjs';
import {attestApprovalLive,warmApprovalHealth,APPROVAL_PUBLIC_ORIGIN} from './t1f-approval-live-smoke.mjs';
async function fixture(t,{state,fetchWrap=x=>x}={}){
 let writes=0,reads=0;
 const clean={noRelease:true,canIssue:false,chainId:10143,wallets:APPROVAL_WALLETS,roles:{owner:false,donor:false},serverTime:Math.floor(Date.now()/1000),status:'NO_ROUND',round:null};
 const service={status:async()=>{reads++;return state??clean},submit:async()=>{writes++;throw Error('UNEXPECTED_WRITE')}};
 const server=http.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port;
 server.on('request',makeApprovalHttpHandler({service,origin,testing:true}));
 t.after(()=>new Promise(r=>server.close(r)));
 const requests=[];
 const fetchImpl=fetchWrap(async(url,options)=>{requests.push({path:new URL(url).pathname,method:options.method,body:options.body});return fetch(url,options)});
 return {options:{origin,fixture:true,fetchImpl},requests,get writes(){return writes},get reads(){return reads}};
}
test('real HTTP smoke checks exact assets, sessions, repeated NO_ROUND and all negatives without submits',async t=>{
 const f=await fixture(t),warm=await warmApprovalHealth(f.options),r=await attestApprovalLive(f.options);
 assert.equal(warm.status,'T1F_APPROVAL_HEALTH_READY');assert.equal(r.status,'T1F_PHASE6_PUBLIC_NO_ROUND_NEGATIVE_PASS');
 assert.equal(r.noRelease,true);assert.equal(r.realSignatures,0);assert.equal(r.onchainTransactions,0);
 assert.ok(r.requests<=44);assert.equal(f.requests.length,r.requests+1);assert.equal(f.writes,0);assert.equal(f.reads,3);
 assert.equal(Object.keys(r.assetSha256).length,4);
 assert.ok(f.requests.filter(x=>x.method==='POST').every(x=>x.body===undefined||!x.body.includes('signature')));
 assert.doesNotMatch(JSON.stringify(r),/csrf|cookie|postgres:|signature=/i);
});
test('wrong initial state or changed static bytes fail closed',async t=>{
 const wrong=await fixture(t,{state:{noRelease:true,status:'COLLECTING',round:{}}});
 await assert.rejects(()=>attestApprovalLive(wrong.options),/T1F_APPROVAL_SMOKE_STATE/);
 const changed=await fixture(t,{fetchWrap:base=>async(url,options)=>{
  const r=await base(url,options);if(new URL(url).pathname==='/t1f-approval.mjs')return new Response('changed',{status:200,headers:r.headers});return r;
 }});
 await assert.rejects(()=>attestApprovalLive(changed.options),/T1F_APPROVAL_SMOKE_ASSET/);
 assert.equal(wrong.writes+changed.writes,0);
});
test('unreviewed endpoints and insecure production cookie cannot pass',async t=>{
 for(const origin of ['https://evil.example','https://mealforward-t1e-role-proof-laodao.onrender.com','http://localhost:8080','https://user:secret@mealforward-t1f-approval-laodao.onrender.com']){
  await assert.rejects(()=>attestApprovalLive({origin,fetchImpl:()=>{throw Error('must not fetch')}}),/T1F_APPROVAL_SMOKE_ORIGIN/);
 }
 const f=await fixture(t);
 const forwarded=async(url,options)=>{
  const next={...options,headers:{...options.headers,Origin:f.options.origin}};
  const r=await fetch(f.options.origin+new URL(url).pathname,next);
  if(r.headers.has('set-cookie')){
   const h=new Headers(r.headers);h.set('set-cookie',h.get('set-cookie').replace('mf_t1f_approval_fixture','__Host-mf_t1f_approval'));
   return new Response(await r.arrayBuffer(),{status:r.status,headers:h});
  }
  return r;
 };
 await assert.rejects(()=>attestApprovalLive({origin:APPROVAL_PUBLIC_ORIGIN,fetchImpl:forwarded}),/T1F_APPROVAL_SMOKE_SESSION_COOKIE/);
});
test('network failure details never escape and noncooperating fetch is bounded',async()=>{
 await assert.rejects(()=>attestApprovalLive({fetchImpl:()=>{throw Error('postgres://private cookie=SECRET')}}),e=>e.message==='T1F_APPROVAL_SMOKE_NETWORK');
 const start=Date.now();
 await assert.rejects(()=>attestApprovalLive({fetchImpl:()=>new Promise(()=>{}),budgetMs:25}),/T1F_APPROVAL_SMOKE_TIMEOUT/);
 assert.ok(Date.now()-start<1000);
});
test('session cookie scoped below root is rejected even if manual HTTP replay would succeed',async t=>{
 const f=await fixture(t,{fetchWrap:base=>async(url,options)=>{
  const r=await base(url,options);if(r.headers.has('set-cookie')){
   const headers=new Headers(r.headers);headers.set('set-cookie',headers.get('set-cookie').replace('Path=/;','Path=/unexpected;'));
   return new Response(await r.arrayBuffer(),{status:r.status,headers});
  }return r;
 }});
 await assert.rejects(()=>attestApprovalLive(f.options),/T1F_APPROVAL_SMOKE_SESSION_COOKIE/);
});
test('redirects and oversized response streams fail with bounded public errors',async()=>{
 await assert.rejects(()=>attestApprovalLive({fetchImpl:async()=>new Response('',{status:302,headers:{Location:'https://invalid.example'}})}),/T1F_APPROVAL_SMOKE_REDIRECT/);
 await assert.rejects(()=>attestApprovalLive({fetchImpl:async()=>new Response('x'.repeat(1048577),{status:200})}),/T1F_APPROVAL_SMOKE_BODY_LIMIT/);
});
