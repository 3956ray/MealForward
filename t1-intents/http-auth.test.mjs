/**
 * Real isolated PG17 + genuine CP31 G0 SIWE EIP-191 HTTP authentication ->
 * authenticated T1-C Intent GET and explicitly disposable-only Prepare.
 *
 * No public funding endpoint, no token approvals, no wallet broadcasts,
 * no Mac/CP30 credentials, no Render customer database.
 */
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {Wallet} from 'ethers';
import {randomUUID} from 'node:crypto';
import {makeChallenge,verifyChallenge} from './auth/siwe.mjs';
import {initializeSchema,pgStore} from './auth/db.mjs';
import {makeT1CAuthenticatedGateway} from './http-auth-gateway.mjs';
import {startT1ReadOnlyServer,validateConfig} from './read-only-server.mjs';

const DSN='postgres://postgres:t1c-disposable-only@127.0.0.1:5433/mf_t1c_http_ci';
const disabled=process.env.GITHUB_ACTIONS!=='true'||
 process.env.MF_T1C_DISPOSABLE_ONLY!=='ack-fresh-t1c-postgres17'||
 process.env.MF_T1C_HTTP_DISPOSABLE_ONLY!=='ack-original-siwe-pg17'||
 process.env.DATABASE_URL!==DSN;
let adminPool,authPool,intentPool,server,origin,handler,clock=Math.floor(Date.now()/1000);
let walletA,walletB,authA,authB,persistedBIntent;

async function request(path,{method='GET',cookie=null,csrf=null,body=null,originHeader=origin,extra={}}={}){
 const headers={
  ...(method==='POST'?{'Content-Type':'application/json',Origin:originHeader}:{}),
  ...(cookie?{Cookie:cookie}:{}),
  ...(csrf?{'X-C1-CSRF':csrf}:{}),
  ...extra
 };
 const response=await fetch(origin+path,{
  method,headers,redirect:'manual',
  ...(body===null?{}:{body:JSON.stringify(body)})
 });
 const out=await response.text();
 try{return {status:response.status,value:JSON.parse(out),cookie:response.headers.get('set-cookie')?.split(';')[0],headers:response.headers}}
 catch{throw Error('PRIVATE_HTTP_NON_JSON_'+response.status)}
}

async function signIn(wallet){
 const pre=await request('/v1/auth/pre-session',{
  method:'POST',body:{},extra:{'X-C1-Bootstrap':'1'}
 });
 assert.equal(pre.status,200);
 assert.ok(pre.cookie?.startsWith('__Host-mcpay_c1_pre='));
 const ch=await request('/v1/identity/wallet/challenge',{
  method:'POST',body:{address:wallet.address.toLowerCase()},
  cookie:pre.cookie,csrf:pre.value.csrf
 });
 assert.equal(ch.status,200);
 const signed=await wallet.signMessage(ch.value.message);
 const login=await request('/v1/identity/wallet/login',{
  method:'POST',body:{challengeId:ch.value.challengeId,signature:signed},
  cookie:pre.cookie,csrf:pre.value.csrf
 });
 assert.equal(login.status,200);
 assert.ok(login.cookie?.startsWith('__Host-mcpay_c1_session='));
 assert.match(login.headers.get('set-cookie'),/Secure; HttpOnly; SameSite=Strict/);
 return {cookie:login.cookie,csrf:login.value.csrf,wallet:wallet.address.toLowerCase()};
}

before(async()=>{
 assert.equal(disabled,false,'T1C_HTTP_DISPOSABLE_PG17_ONLY');
 adminPool=new pg.Pool({connectionString:DSN,max:22,connectionTimeoutMillis:3000});
 const v=await adminPool.query('SHOW server_version_num');
 assert.equal(Math.floor(Number(v.rows[0].server_version_num)/10000),17);
 assert.equal((await adminPool.query("SELECT to_regnamespace('mf_cp31_auth_pilot') IS NULL AS blank")).rows[0].blank,true);
 assert.equal((await adminPool.query("SELECT to_regnamespace('mf_t1c') IS NULL AS blank")).rows[0].blank,true);
 assert.equal((await adminPool.query("SELECT count(*)::int AS n FROM pg_namespace WHERE nspname LIKE 'c1\\_%' ESCAPE '\\'")).rows[0].n,0);
 await initializeSchema(adminPool);
 await adminPool.query(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
 await adminPool.query(await readFile(new URL('./ci-two-roles.sql',import.meta.url),'utf8'));
 authPool=new pg.Pool({connectionString:DSN.replace('postgres:t1c-disposable-only','mf_t1c_ci_auth:t1c-ci-auth-only-local'),max:15});
 intentPool=new pg.Pool({connectionString:DSN.replace('postgres:t1c-disposable-only','mf_t1c_ci_intent:t1c-ci-intent-only-local'),max:18});
 server=http.createServer((req,res)=>handler(req,res));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 origin='http://127.0.0.1:'+server.address().port;
 handler=makeT1CAuthenticatedGateway({
  sessionPool:authPool,intentPool,authStore:pgStore(authPool),siwe:{makeChallenge,verifyChallenge},
  origin,clock:()=>clock,mode:'disposable_ci'
 });
 walletA=Wallet.createRandom();
 walletB=Wallet.createRandom();
 authA=await signIn(walletA);
 authB=await signIn(walletB);
});
after(async()=>{
 if(server)await new Promise(resolve=>server.close(resolve));
 await Promise.all([authPool?.end(),intentPool?.end(),adminPool?.end()]);
});
test('disposable-only guard disallows a public Render origin or a deployable CI prepare switch',()=>{
 assert.throws(()=>makeT1CAuthenticatedGateway({
  sessionPool:authPool,intentPool,authStore:pgStore(authPool),siwe:{makeChallenge,verifyChallenge},
  origin:'https://mealforward-t1-write.onrender.com',mode:'disposable_ci'
 }),/T1C_CI_MODE_FORBIDDEN/);
 assert.throws(()=>makeT1CAuthenticatedGateway({
  sessionPool:authPool,intentPool,authStore:pgStore(authPool),siwe:{makeChallenge,verifyChallenge},
  origin,mode:'funds_enabled'
 }),/T1C_UNKNOWN_MODE/);
});
test('real PostgreSQL roles prohibit Auth credentials from financial intents and vice versa',async()=>{
 const a=await authPool.query('SELECT current_user AS role');
 const b=await intentPool.query('SELECT current_user AS role');
 assert.equal(a.rows[0].role,'mf_t1c_ci_auth');
 assert.equal(b.rows[0].role,'mf_t1c_ci_intent');
 const dbRole=await adminPool.query(
  "SELECT rolname,rolsuper,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname IN ('mf_t1c_ci_auth','mf_t1c_ci_intent') ORDER BY rolname"
 );
 assert.equal(dbRole.rowCount,2);
 assert.ok(dbRole.rows.every(x=>!x.rolsuper&&!x.rolcreaterole&&!x.rolbypassrls));
 await assert.rejects(()=>authPool.query('SELECT * FROM mf_t1c.intents'),e=>e.code==='42501');
 await assert.rejects(()=>intentPool.query('SELECT * FROM mf_cp31_auth_pilot.sessions'),e=>e.code==='42501');
 await assert.rejects(()=>authPool.query('TRUNCATE TABLE mf_cp31_auth_pilot.sessions'),e=>e.code==='42501');
 await assert.rejects(()=>intentPool.query('DELETE FROM mf_t1c.intents'),e=>e.code==='42501');
 await assert.rejects(()=>intentPool.query('TRUNCATE TABLE mf_t1c.audit_events'),e=>e.code==='42501');
});
test('real SIWE G0 A and B wallet sessions are distinct, private, expiring and server-authored',async()=>{
 const a=await request('/v1/me',{cookie:authA.cookie});
 const b=await request('/v1/me',{cookie:authB.cookie});
 assert.equal(a.status,200);assert.equal(b.status,200);
 assert.equal(a.value.walletAddress,authA.wallet);
 assert.equal(b.value.walletAddress,authB.wallet);
 assert.notEqual(a.value.walletAddress,b.value.walletAddress);
 assert.equal(a.value.authPilot,true);
 const tx=await request('/v1/t1/status');
 assert.equal(tx.status,200);
 assert.equal(tx.value.transactionActionsEnabled,false);
 assert.equal(tx.value.fundingEnabled,false);
 assert.equal(tx.value.quoteSigningEnabled,false);
 assert.equal(tx.value.originalCp30DataConnected,false);
 assert.equal((await request('/v1/t1/intents/'+randomUUID())).status,401);
});
test('24 overlapping HTTPS-shaped POST requests use the SAME logged-in SIWE wallet principal and one Quote ID',async()=>{
 const key=randomUUID();
 const calls=await Promise.all(Array.from({length:24},()=>
  request('/v1/t1/intents/prepare',{
   method:'POST',body:{idempotencyKey:key,quantity:2},
   cookie:authA.cookie,csrf:authA.csrf
  })
 ));
 assert.ok(calls.every(r=>r.status===200),JSON.stringify(calls.map(x=>x.status)));
 const ids=new Set(calls.map(x=>x.value.intentId));
 const quotes=new Set(calls.map(x=>x.value.quoteId));
 assert.equal(ids.size,1);
 assert.equal(quotes.size,1);
 const value=calls[0].value;
 assert.equal(value.stage,'PREPARED');
 assert.equal(value.quantity,2);
 assert.equal(value.amount,'14000000');
 assert.equal(value.unsignedQuote.amount,'14000000');
 assert.equal(value.payer,authA.wallet);
 assert.equal(value.fundingEnabled,false);
 assert.equal(value.sendTransactionAllowed,false);
 assert.ok(!JSON.stringify(value).includes(authA.cookie));
 const original=await request('/v1/t1/intents/'+value.intentId,{
  cookie:authA.cookie
 });
 assert.equal(original.status,200);
 assert.equal(original.value.quoteId,value.quoteId);
 assert.deepEqual(original.value.attempts,[]);
 const b=await request('/v1/t1/intents/'+value.intentId,{cookie:authB.cookie});
 assert.equal(b.status,404);
 const changed=await request('/v1/t1/intents/prepare',{
  method:'POST',body:{idempotencyKey:key,quantity:1},
  cookie:authA.cookie,csrf:authA.csrf
 });
 assert.equal(changed.status,409);
 assert.equal(changed.value.error,'IDEMPOTENCY_CONFLICT');
});
test('same browser-supplied key under different authenticated wallets creates different intents',async()=>{
 const id=randomUUID();
 const a=await request('/v1/t1/intents/prepare',{
  method:'POST',body:{idempotencyKey:id,quantity:1},
  cookie:authA.cookie,csrf:authA.csrf
 });
 const b=await request('/v1/t1/intents/prepare',{
  method:'POST',body:{idempotencyKey:id,quantity:1},
  cookie:authB.cookie,csrf:authB.csrf
 });
 assert.equal(a.status,200);assert.equal(b.status,200);
 assert.notEqual(a.value.intentId,b.value.intentId);
 assert.notEqual(a.value.quoteId,b.value.quoteId);
 persistedBIntent=b.value.intentId;
 assert.equal((await request('/v1/t1/intents/'+a.value.intentId,{cookie:authB.cookie})).status,404);
 assert.equal((await request('/v1/t1/intents/'+b.value.intentId,{cookie:authA.cookie})).status,404);
});
test('malformed cookie, duplicate cookie, cross-site origin, forged wallet and missing CSRF cannot reserve',async()=>{
 const cases=[
  {cookie:authA.cookie+'; '+authB.cookie,csrf:authA.csrf},
  {cookie:authA.cookie,csrf:'z'.repeat(43)},
  {cookie:authA.cookie},
  {cookie:authA.cookie,csrf:authA.csrf,originHeader:'https://evil.example'},
  {cookie:authA.cookie,csrf:authA.csrf,extra:{'X-Wallet-Address':authB.wallet}},
  {cookie:authA.cookie,csrf:authA.csrf,extra:{Authorization:'Bearer forged'}},
  {cookie:authA.cookie,csrf:authA.csrf,extra:{'Sec-Fetch-Site':'cross-site'}}
 ];
 for(const args of cases){
  const key=randomUUID();
  const res=await request('/v1/t1/intents/prepare',{
   method:'POST',body:{idempotencyKey:key,quantity:1},...args
  });
  assert.ok([401,403].includes(res.status));
  assert.equal((await intentPool.query('SELECT count(*)::int AS n FROM mf_t1c.intents WHERE idempotency_key=$1',[key])).rows[0].n,0);
 }
});
test('forged body fields cannot select a payer, change escrow, provide Quote signature, tx nonce or post a Fund',async()=>{
 const attempts=[
  {idempotencyKey:randomUUID(),quantity:1,payer:authB.wallet},
  {idempotencyKey:randomUUID(),quantity:1,escrow:'0x'+'9'.repeat(40)},
  {idempotencyKey:randomUUID(),quantity:1,quoteId:'0x'+'5'.repeat(64)},
  {idempotencyKey:randomUUID(),quantity:1,transactionHash:'0x'+'7'.repeat(64)}
 ];
 for(const body of attempts){
  const r=await request('/v1/t1/intents/prepare',{
   method:'POST',cookie:authA.cookie,csrf:authA.csrf,body
  });
  assert.equal(r.status,422);
 }
 for(const path of [
  '/v1/t1/intents/approve','/v1/t1/intents/fund',
  '/v1/t1/sign-quote','/v1/t1/settle'
 ]){
  const r=await request(path,{method:'POST',
   cookie:authA.cookie,csrf:authA.csrf,body:{}});
  assert.equal(r.status,405);
  assert.equal(r.value.error,'FUNDING_DISABLED');
 }
 assert.equal((await intentPool.query('SELECT count(*)::int AS n FROM mf_t1c.wallet_attempts')).rows[0].n,0);
});
test('revocation denies old cookie immediately; unrelated wallet B remains authorized',async()=>{
 const a=await request('/v1/auth/logout',{
  method:'POST',body:{},cookie:authA.cookie,csrf:authA.csrf
 });
 assert.equal(a.status,200);
 assert.equal((await request('/v1/me',{cookie:authA.cookie})).status,401);
 assert.equal((await request('/v1/t1/intents/'+randomUUID(),{cookie:authA.cookie})).status,401);
 assert.equal((await request('/v1/t1/intents/'+randomUUID(),{cookie:authB.cookie})).status,404);
 const denied=await request('/v1/t1/intents/prepare',{
  method:'POST',body:{idempotencyKey:randomUUID(),quantity:1},
  cookie:authA.cookie,csrf:authA.csrf
 });
 assert.equal(denied.status,403);
});
test('existing CP30/private funding endpoints remain closed even with genuine testnet SIWE',async()=>{
 for(const route of ['/v1/my/orders','/v1/my/vouchers','/v1/stores']){
  const r=await request(route,{cookie:authB.cookie});
  assert.equal(r.status,503);
  assert.equal(r.value.error,'ORIGINAL_BUSINESS_NOT_CONNECTED');
 }
 assert.equal((await request('/v1/support/intents',{
  method:'POST',body:{},cookie:authB.cookie,csrf:authB.csrf
 })).status,503);
});


test('Cloud Supabase origin must be exact approved project + named roles + session TLS pooler',()=>{
 const pass='example-ci-only-secret';
 const base={
  PORT:'10000',PUBLIC_ORIGIN:'https://mealforward-t1c-readonly-laodao.onrender.com',
  T1C_SERVER_MODE:'READ_ONLY_NO_FUNDS',
  T1C_AUTH_DB_URL:'postgres://mf_t1c_auth_runtime.ketfrukrcuosrqynnsay:'+pass+
   '@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres',
  T1C_INTENT_DB_URL:'postgres://mf_t1c_intent_runtime.ketfrukrcuosrqynnsay:'+pass+
   '@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres'
 };
 // The test-specific environment must not disable production project checks.
 const oldActions=process.env.GITHUB_ACTIONS;
 const oldLabel=process.env.MF_T1C_DISPOSABLE_ONLY;
 const oldHttp=process.env.MF_T1C_HTTP_DISPOSABLE_ONLY;
 try{
  delete process.env.GITHUB_ACTIONS;
  delete process.env.MF_T1C_DISPOSABLE_ONLY;
  delete process.env.MF_T1C_HTTP_DISPOSABLE_ONLY;
  const v=validateConfig(base);
  assert.equal(v.expectedAuthRole,'mf_t1c_auth_runtime');
  assert.equal(v.expectedIntentRole,'mf_t1c_intent_runtime');
  const reject=(over,pattern)=>assert.throws(()=>validateConfig({...base,...over}),pattern);
  reject({T1C_AUTH_DB_URL:base.T1C_AUTH_DB_URL.replace(
   'ketfrukrcuosrqynnsay','qygnwgovbwltffsytnje'
  )},/WRONG_CLOUD_ROLE_OR_SUPABASE_TENANT/);
  reject({T1C_AUTH_DB_URL:base.T1C_AUTH_DB_URL.replace(':5432/',':6543/')},
   /ONLY_PINNED_SUPABASE_SESSION_POOLER/);
  reject({T1C_AUTH_DB_URL:base.T1C_AUTH_DB_URL.replace(
   'aws-0-ap-southeast-2.pooler.supabase.com','db.ketfrukrcuosrqynnsay.supabase.co'
  )},/ONLY_PINNED_SUPABASE_SESSION_POOLER/);
  reject({T1C_AUTH_DB_URL:base.T1C_AUTH_DB_URL+'?sslmode=disable'},/DATABASE_DSN_NOT_REVIEWABLE/);
  reject({T1C_AUTH_DB_URL:base.T1C_AUTH_DB_URL.replace('mf_t1c_auth_runtime','postgres')},
   /WRONG_CLOUD_ROLE_OR_SUPABASE_TENANT/);
  reject({T1C_FUNDING_ENABLED:'true'},/T1C_WALLET_WRITE_FLAG_FORBIDDEN/);
 }finally{
  if(oldActions===undefined)delete process.env.GITHUB_ACTIONS;else process.env.GITHUB_ACTIONS=oldActions;
  if(oldLabel===undefined)delete process.env.MF_T1C_DISPOSABLE_ONLY;else process.env.MF_T1C_DISPOSABLE_ONLY=oldLabel;
  if(oldHttp===undefined)delete process.env.MF_T1C_HTTP_DISPOSABLE_ONLY;else process.env.MF_T1C_HTTP_DISPOSABLE_ONLY=oldHttp;
 }
});
test('cloud startup refuses unsafe database credentials and every money-enabled configuration',async()=>{
 const AUTH_DB=DSN.replace('postgres:t1c-disposable-only',
  'mf_t1c_ci_auth:t1c-ci-auth-only-local');
 const INTENT_DB=DSN.replace('postgres:t1c-disposable-only',
  'mf_t1c_ci_intent:t1c-ci-intent-only-local');
 const good={...process.env,
  PUBLIC_ORIGIN:'http://127.0.0.1:48129',
  PORT:'48129',T1C_SERVER_MODE:'READ_ONLY_NO_FUNDS',
  T1C_AUTH_DB_URL:AUTH_DB,T1C_INTENT_DB_URL:INTENT_DB
 };
 assert.throws(()=>validateConfig({...good,T1C_SERVER_MODE:'FUNDING_ENABLED'}),
  /FINANCIAL_WRITE_MODE_FORBIDDEN/);
 assert.throws(()=>validateConfig({...good,T1C_FUNDING_ENABLED:'true'}),
  /T1C_WALLET_WRITE_FLAG_FORBIDDEN/);
 assert.throws(()=>validateConfig({...good,T1C_AUTH_DB_URL:INTENT_DB}),
  /TWO_DISTINCT_DATABASE_PRINCIPALS_REQUIRED/);
 assert.throws(()=>validateConfig({...good,PUBLIC_ORIGIN:'https://attacker.example'}),
  /ORIGIN_MUST_BE_EXACT_PINNED_HTTPS/);
 await assert.rejects(()=>startT1ReadOnlyServer({
  env:{...good,T1C_AUTH_DB_URL:DSN}
 }),/T1_C_READONLY_BOOT_FAIL_CLOSED/);
});
test('real SECOND HTTP process boots read-only roles, reads prior SIWE wallet+Intent after restart, refuses any funding',async()=>{
 assert.ok(persistedBIntent,'A source-funded synthetic B intent must already exist');
 const tcp=net.createServer();
 await new Promise(resolve=>tcp.listen(0,'127.0.0.1',resolve));
 const port=tcp.address().port;
 await new Promise(resolve=>tcp.close(resolve));
 const host='http://127.0.0.1:'+port;
 const env={...process.env,
  PUBLIC_ORIGIN:host,PORT:String(port),
  T1C_SERVER_MODE:'READ_ONLY_NO_FUNDS',
  T1C_AUTH_DB_URL:DSN.replace('postgres:t1c-disposable-only',
   'mf_t1c_ci_auth:t1c-ci-auth-only-local'),
  T1C_INTENT_DB_URL:DSN.replace('postgres:t1c-disposable-only',
   'mf_t1c_ci_intent_ro:t1c-ci-intent-ro-only-local')
 };
 const launch=async()=>{
  const child=spawn(process.execPath,[
   fileURLToPath(new URL('./read-only-server.mjs',import.meta.url))
  ],{env,stdio:['ignore','pipe','pipe']});
  let text='',stderr='';
  child.stderr.on('data',value=>{stderr+=value.toString().slice(0,400)});
  await new Promise((resolve,reject)=>{
   const clock=setTimeout(()=>{
    child.kill('SIGTERM');
    reject(Error('READONLY_SERVER_BOOT_TIMEOUT'));
   },8000);
   child.stdout.on('data',chunk=>{
    text+=chunk.toString('utf8');
    if(text.includes('T1_C_SAFE_READONLY_PROCESS_READY')){
     clearTimeout(clock);resolve();
    }
   });
   child.once('exit',code=>{
    if(!text.includes('T1_C_SAFE_READONLY_PROCESS_READY')){
     clearTimeout(clock);
     reject(Error('T1_READONLY_SERVER_NOT_STARTED_'+code+'_'+
      (stderr.match(/T1_C_READONLY_BOOT_FAIL_CLOSED_[A-Z_]+/)||['UNSPECIFIED_STAGE'])[0]));
    }
   });
  });
  return child;
 };
 const stop=async child=>{
  if(child.exitCode!==null)return;
  const exit=once(child,'exit');
  child.kill('SIGTERM');
  await exit;
 };
 const fetchResult=async(path,init={})=>{
  const response=await fetch(host+path,init);
  return {status:response.status,body:await response.json()};
 };
 for(let iteration=0;iteration<2;iteration++){
  const child=await launch();
  try{
   const home=await fetch(host+'/');
   assert.equal(home.status,200);
   assert.match(home.headers.get('content-security-policy'),/script-src 'self'/);
   assert.match(await home.text(),/READ_ONLY_NO_FUNDS/);
   const uiFile=await fetch(host+'/ui.mjs');
   assert.equal(uiFile.status,200);
   const script=await uiFile.text();
   assert.match(script,/personal_sign/);
   for(const forbidden of ['eth_sendTransaction','eth_sendRawTransaction',
     'eth_signTypedData_v4','wallet_sendCalls','privateKeyToAccount']){
     assert.ok(!script.includes(forbidden),'Forbidden financial action '+forbidden);
   }
   const css=await fetch(host+'/ui.css');
   assert.equal(css.status,200);
   assert.match(css.headers.get('content-type'),/text\/css/);
   const blocked=await fetch(host+'/?wallet=other');
   assert.equal(blocked.status,403);
   const ready=await fetchResult('/v1/t1/status');
   assert.equal(ready.status,200);
   assert.equal(ready.body.fundingEnabled,false);
   const old=await fetchResult('/v1/t1/intents/'+persistedBIntent,{
    headers:{Cookie:authB.cookie}
   });
   assert.equal(old.status,200);
   assert.equal(old.body.intentId,persistedBIntent);
   assert.equal(old.body.stage,'PREPARED');
   assert.equal(old.body.fundingEnabled,false);
   const my=await fetchResult('/v1/t1/my-intents',{
    headers:{Cookie:authB.cookie}
   });
   assert.equal(my.status,200);
   assert.equal(my.body.scope,'NEW_TESTNET_ORIGINAL_SIWE_ONLY');
   assert.ok(my.body.items.some(i=>i.intentId===persistedBIntent));
   assert.equal(my.body.fundingEnabled,false);
   assert.equal((await fetchResult('/v1/t1/intents/'+persistedBIntent,{
    headers:{Cookie:authA.cookie}
   })).status,401,'Revoked A cookie must never recover B original Intent');
   const closed=await fetchResult('/v1/t1/intents/prepare',{
    method:'POST',headers:{
     Cookie:authB.cookie,Origin:host,'X-C1-CSRF':authB.csrf,
     'Content-Type':'application/json'
    },
    body:JSON.stringify({quantity:1,idempotencyKey:randomUUID()})
   });
   assert.equal(closed.status,503);
   assert.equal(closed.body.error,'FUNDING_DISABLED');
   assert.equal((await fetchResult('/v1/t1/intents/fund',{
    method:'POST',headers:{Origin:host,'Content-Type':'application/json'},
    body:'{}'
   })).status,405);
  }finally{await stop(child)}
 }
});
