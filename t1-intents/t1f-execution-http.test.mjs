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
