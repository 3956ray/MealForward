import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {makeT1EClaimGateway} from './t1e-claim-http.mjs';
import {FIXED} from './t1e-first-issue-readiness.mjs';
import {PILOT_RECIPIENT} from './t1e-claim-store.mjs';
import {validateT1EClaimConfig,T1E_CLAIM_ORIGIN} from './t1e-claim-server.mjs';
import {httpFixture,RECIPIENT} from './t1f-execution-http-fixture.mjs';
test('existing SIWE cookie identity and CSRF gate; origin/body/method/disabled cannot reach writes',async()=>{
 let writes=0;const service={status:async()=>({status:'SAFE'}),prepare:async body=>{writes++;return {created:true}},bind:async()=>{},reconcile:async()=>{}};
 const f=await httpFixture({service});try{
  for(const [args,status] of [[{token:''},401],[{token:RECIPIENT},403],[{csrf:''},403],[{headers:{origin:'https://evil.invalid'}},403],[{headers:{'x-wallet-address':FIXED.issuerAuthority}},403],[{headers:{authorization:'Bearer fake'}},403],[{headers:{'sec-fetch-site':'cross-site'}},403],[{headers:{'content-type':'text/plain'}},415]])assert.equal((await f.request('prepare',args)).status,status);
  assert.equal(writes,0);const read=await f.request('status');assert.equal(read.status,200);assert.equal(read.cache,'no-store');
  assert.equal((await f.request('prepare',{method:'GET'})).status,405);assert.equal(writes,0);
  assert.equal((await f.request('prepare')).status,201);assert.equal(writes,1);
 }finally{await f.close()}
 const off=await httpFixture({enabled:false});try{assert.equal((await off.request('prepare')).status,405);assert.equal(writes,1)}finally{await off.close()}
});
test('service errors never reveal SQL, secrets or raw RPC failures',async()=>{const f=await httpFixture({service:{status:async()=>{throw Error('postgres://secret SELECT private')},prepare:async()=>{},bind:async()=>{},reconcile:async()=>{}}});try{const r=await f.request('status');assert.equal(r.status,503);assert.deepEqual(r.body,{error:'T1F_EXECUTION_UNAVAILABLE'})}finally{await f.close()}});
test('execution configuration is separately disabled and pins dedicated login/project/TLS source',()=>{
 const env={PUBLIC_ORIGIN:T1E_CLAIM_ORIGIN,PORT:'10000',T1E_DEPLOYMENT_STAGE:'CLAIM_CONSENT',T1E_CLAIM_WRITES_ENABLED:'true',T1E_WALLET_TX_ENABLED:'false',T1E_SETTLEMENT_ENABLED:'false',T1E_AUTH_DB_URL:'postgres://mf_t1e_auth_runtime.ketfrukrcuosrqynnsay:synthetic-password@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres',T1E_CLAIM_DB_URL:'postgres://mf_t1e_claim_runtime.ketfrukrcuosrqynnsay:synthetic-password@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres'};
 let cfg=validateT1EClaimConfig(env);assert.equal(cfg.successorEnabled,false);assert.equal(cfg.executionUrl,null);assert.equal(cfg.issueEnabled,false);
 assert.throws(()=>validateT1EClaimConfig({...env,T1F_SUCCESSOR_EXECUTION_ENABLED:'yes'}));
 assert.throws(()=>validateT1EClaimConfig({...env,T1F_SUCCESSOR_EXECUTION_ENABLED:'true'}));
 const execution='postgres://mf_t1f_execution_login.ketfrukrcuosrqynnsay:synthetic-password@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres';
 cfg=validateT1EClaimConfig({...env,T1F_SUCCESSOR_EXECUTION_ENABLED:'true',T1F_EXECUTION_DB_URL:execution});assert.equal(cfg.successorEnabled,true);assert.equal(cfg.issueEnabled,false);
 for(const url of [env.T1E_CLAIM_DB_URL,execution.replace('ketfrukrcuosrqynnsay','other'),execution+'?sslmode=disable',execution.replace(':5432',':15439')])assert.throws(()=>validateT1EClaimConfig({...env,T1F_SUCCESSOR_EXECUTION_ENABLED:'true',T1F_EXECUTION_DB_URL:url}));
 assert.throws(()=>validateT1EClaimConfig({...env,T1E_DEPLOYMENT_STAGE:'CLAIM_SIWE_ONLY',T1E_CLAIM_WRITES_ENABLED:'false',T1F_SUCCESSOR_EXECUTION_ENABLED:'true',T1F_EXECUTION_DB_URL:execution}));
});

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
async function deadlineFixture(service){
 const {makeExecutionHttp}=await import('./t1f-execution-http.mjs');
 let route;const tasks=[];
 const server=createServer((request,response)=>{
  const task=route({request,response,issuer:FIXED.issuerAuthority,path:new URL(request.url,origin).pathname,method:request.method,readBody:async req=>{const parts=[];for await(const part of req)parts.push(part);return JSON.parse(Buffer.concat(parts).toString())}});
  tasks.push(task);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 route=makeExecutionHttp({enabled:true,service,origin,requestTimeoutMs:20});
 return {tasks,close:()=>new Promise(r=>server.close(r)),async request(action='status'){
  const response=await fetch(origin+'/v1/t1f/successor/'+action,{method:action==='status'?'GET':'POST',headers:{origin,'content-type':'application/json'},...(action==='status'?{}:{body:'{}'})});
  return {status:response.status,body:await response.json(),cache:response.headers.get('cache-control')};
 }};
}
test('deadline finishes completed GET and late status resolution cannot write another response',async()=>{
 const wait=deferred();let signal;
 const f=await deadlineFixture({status:async(_,options)=>{signal=options.signal;return wait.promise},prepare:async()=>{},bind:async()=>{},reconcile:async()=>{}});
 try{
  const result=await f.request();assert.equal(result.status,504);assert.deepEqual(result.body,{error:'T1F_EXECUTION_REQUEST_TIMEOUT'});assert.equal(result.cache,'no-store');assert.equal(signal.aborted,true);
  wait.resolve({status:'LATE_PRIVATE_RESULT'});await Promise.all(f.tasks);
  assert.deepEqual(result.body,{error:'T1F_EXECUTION_REQUEST_TIMEOUT'});
 }finally{wait.resolve({});await Promise.all(f.tasks);await f.close()}
});
test('completed POST timeout suppresses late committed payload and aborts later mutation admission',async()=>{
 const wait=deferred();let signal,commits=0,lateWrites=0;
 const f=await deadlineFixture({status:async()=>({status:'RECOVERY_ONLY'}),prepare:async(_,options)=>{signal=options.signal;commits++;await wait.promise;return {created:true,transaction:{data:'NEVER_EXPOSE_LATE_BYTES'}}},bind:async(_,options)=>{await wait.promise;if(!options.signal.aborted)lateWrites++;throw Error('T1F_EXECUTION_REQUEST_ABORTED')},reconcile:async()=>{}});
 try{
  const [prepared,bound]=await Promise.all([f.request('prepare'),f.request('bind')]);
  assert.equal(prepared.status,504);assert.equal(bound.status,504);assert.equal(commits,1);assert.equal(signal.aborted,true);assert.equal(prepared.body.transaction,undefined);
  wait.resolve();await Promise.all(f.tasks);assert.equal(lateWrites,0);
  assert.deepEqual(prepared.body,{error:'T1F_EXECUTION_REQUEST_TIMEOUT'});assert.equal((await f.request()).body.status,'RECOVERY_ONLY');
 }finally{wait.resolve();await Promise.all(f.tasks);await f.close()}
});
test('timed-out unresolved work remains within four slots until underlying settlement',async()=>{
 const waits=Array.from({length:4},deferred);let calls=0;
 const f=await deadlineFixture({status:async()=>{const i=calls++;return i<4?waits[i].promise:{status:'RECOVERY_ONLY'}},prepare:async()=>{},bind:async()=>{},reconcile:async()=>{}});
 try{
  const results=await Promise.all(waits.map(()=>f.request()));assert.ok(results.every(r=>r.status===504));assert.equal(calls,4);
  for(let i=0;i<5;i++)assert.equal((await f.request()).status,429);assert.equal(calls,4);
  waits[0].resolve({status:'LATE'});await f.tasks[0];
  assert.equal((await f.request()).status,200);assert.equal(calls,5);
 }finally{for(const wait of waits)wait.resolve({});await Promise.all(f.tasks);await f.close()}
});
test('HTTP timeout option cannot exceed the production60second ceiling',async()=>{
 const {makeExecutionHttp}=await import('./t1f-execution-http.mjs');for(const requestTimeoutMs of [0,-1,60001,Infinity,1.5])assert.throws(()=>makeExecutionHttp({requestTimeoutMs}),/HTTP_CONFIG/);
});
