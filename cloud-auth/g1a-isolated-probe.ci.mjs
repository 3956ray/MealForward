/**
 * Actual disposable PostgreSQL 17 + MetaMask EIP-191 + HTTP G1-A read test.
 * This harness REFUSES any database other than the exact CI fixture.
 * Absolutely no real user wallets, CP30 store, transaction, or Journal.
 */
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {privateKeyToAccount,generatePrivateKey} from 'viem/accounts';
import {initializeSchema,pgStore} from './db.mjs';
import {makePilotHandler} from './core.mjs';
import {makeChallenge,verifyChallenge} from './siwe.mjs';
import {makeG1IsolatedProbeReader} from './g1a-isolated-probe-read.mjs';

const DATABASE='mealforward_g1_read_ci_only';
const EXPECTED='postgres://postgres:g1-only-ci-pg17@127.0.0.1:5432/'+DATABASE;
const schemaFile=new URL('../cp30-backend/g1-export/g1a-isolated-probe-schema.sql',import.meta.url);
const accountA=privateKeyToAccount(generatePrivateKey());
const accountB=privateKeyToAccount(generatePrivateKey());
const STORE='a'.repeat(64),MEAL='b'.repeat(64);
const nonce=()=>randomUUID();
let admin,reader,server,origin,now=1792400000;
let A,B,readPass;
const dataRows={
 A:{order:'00000000-0000-4000-8000-000000000001',voucher:'0x'+'1'.repeat(64)},
 B:{order:'00000000-0000-4000-8000-000000000002',voucher:'0x'+'2'.repeat(64)}
};
const headersFor=(method,other={})=>({
 ...(method==='POST'?{'Origin':origin,'Content-Type':'application/json'}:{}),...other
});
async function call(method,path,body,{cookie,csrf,extra={}}={}){
 const headers=headersFor(method,{
  ...(cookie?{Cookie:cookie}:{}),
  ...(csrf?{'X-C1-CSRF':csrf}:{}),...extra
 });
 const response=await fetch(origin+path,{method,headers,
  ...(method==='POST'?{body:JSON.stringify(body??{})}:{}),redirect:'error'});
 const result=await response.json();
 return {status:response.status,body:result,cookie:response.headers.get('set-cookie')?.split(';',1)[0]};
}
async function login(account){
 const pre=await call('POST','/v1/auth/pre-session',{}, {extra:{'X-C1-Bootstrap':'1'}});
 assert.equal(pre.status,200);assert.ok(pre.cookie);
 const challenge=await call('POST','/v1/identity/wallet/challenge',
  {address:account.address.toLowerCase()},{cookie:pre.cookie,csrf:pre.body.csrf});
 assert.equal(challenge.status,200);
 const signature=await account.signMessage({message:challenge.body.message});
 const done=await call('POST','/v1/identity/wallet/login',
  {challengeId:challenge.body.challengeId,signature},
  {cookie:pre.cookie,csrf:pre.body.csrf});
 assert.equal(done.status,200);
 assert.ok(done.cookie?.startsWith('__Host-mcpay_c1_session='));
 return done.cookie;
}
before(async()=>{
 if(process.env.GITHUB_ACTIONS!=='true'||
  process.env.MF_G1_PG_DISPOSABLE_ONLY!=='i-acknowledge-g1-test-only-pg17'||
  process.env.DATABASE_URL!==EXPECTED)
  throw Error('DISPOSABLE_G1_PG17_CI_ONLY');
 admin=new pg.Pool({connectionString:EXPECTED,max:8,connectionTimeoutMillis:4000});
 const version=await admin.query('SHOW server_version_num');
 assert.ok(Number(version.rows[0].server_version_num)>=170000&&Number(version.rows[0].server_version_num)<180000);
 const existing=await admin.query("SELECT to_regnamespace('mf_cp31_auth_pilot') AS auth,to_regnamespace('mf_g1_probe') AS probe,to_regnamespace('c1_private') AS cp30");
 assert.equal(existing.rows[0].auth,null);
 assert.equal(existing.rows[0].probe,null);
 assert.equal(existing.rows[0].cp30,null);
 await initializeSchema(admin);
 const schema=fs.readFileSync(schemaFile,'utf8');
 // A different database MUST be rejected before any DDL.
 const other=new pg.Pool({host:'127.0.0.1',port:5432,user:'postgres',password:'g1-only-ci-pg17',database:'postgres'});
 try{
  await assert.rejects(()=>other.query(schema),/G1_ISOLATED_TEST_DATABASE_REQUIRED/);
  const untouched=await other.query("SELECT to_regnamespace('mf_g1_probe') IS NULL AS clean");
  assert.equal(untouched.rows[0].clean,true);
 }finally{await other.end()}
 // A live CP30 namespace must block migration entirely, even in our CI DB.
 await admin.query('CREATE SCHEMA c1_private');
 await assert.rejects(()=>admin.query(schema),/ORIGINAL_CP30_SCHEMA_FORBIDDEN/);
 await admin.query('DROP SCHEMA c1_private');
 const stillFresh=await admin.query("SELECT to_regnamespace('mf_g1_probe') IS NULL AS fresh");
 assert.equal(stillFresh.rows[0].fresh,true);
 // An apparently safe preexisting NOLOGIN role can inherit pg_read_all_data.
 // The provisioning transaction MUST refuse this before creating a schema.
 await admin.query('CREATE ROLE mf_g1_probe_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS');
 await admin.query('GRANT pg_read_all_data TO mf_g1_probe_reader');
 await assert.rejects(()=>admin.query(schema),/G1_PROBE_ROLE_INHERITS_OTHER_ROLES/);
 assert.equal((await admin.query("SELECT to_regnamespace('mf_g1_probe') IS NULL AS fresh")).rows[0].fresh,true);
 await admin.query('REVOKE pg_read_all_data FROM mf_g1_probe_reader');
 await admin.query(schema);
 await assert.rejects(()=>admin.query(schema),/G1_PROBE_MUST_START_FRESH/);
 // Generate a disposable, non-committed-away login solely inside this docker.
 readPass=randomBytes(24).toString('hex');
 await admin.query("CREATE ROLE mf_g1_probe_login LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+readPass+"'");
 await admin.query('GRANT mf_g1_probe_reader TO mf_g1_probe_login');
 reader=new pg.Pool({
  host:'127.0.0.1',port:5432,database:DATABASE,
  user:'mf_g1_probe_login',password:readPass,max:3,connectionTimeoutMillis:3000
 });
 const rows=await reader.query("SELECT scope FROM mf_g1_probe.provenance");
 assert.equal(rows.rows[0].scope,'ISOLATED_SYNTHETIC_READ_TEST');
 const attestation=await reader.query(
  "SELECT current_database() AS db,current_user AS login,session_user AS authenticated_login,"+
  "(SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls FROM pg_roles WHERE rolname=current_user) AS elevated,"+
  "has_database_privilege(current_user,current_database(),'CREATE') AS creates_database,"+
    "has_schema_privilege(current_user,'public','CREATE') AS creates_public,"+
  "has_schema_privilege(current_user,'mf_cp31_auth_pilot','USAGE') AS auth_schema_usage,"+
  "EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='mf_cp31_auth_pilot' AND c.relname='sessions' AND has_table_privilege(current_user,c.oid,'SELECT')) AS auth_session_select,"+
  "has_table_privilege(current_user,'mf_g1_probe.orders','UPDATE') AS can_update_probe,"+
  "to_regnamespace('c1_private') IS NOT NULL AS original_private_present"
 );
 // Print only role/permission booleans and CI database name; NEVER credentials,
 // wallets, Cookie values, signatures or private table contents.
 console.log('G1A_RESTRICTED_READER_ATTESTATION',JSON.stringify(attestation.rows[0]));
 const insertOrder='INSERT INTO mf_g1_probe.orders(id,owner_wallet,store_id,meal_id,quantity,amount_base_units) VALUES($1,$2,$3,$4,1,7000000)';
 const insertVoucher='INSERT INTO mf_g1_probe.vouchers(id,owner_wallet,store_id,meal_id) VALUES($1,$2,$3,$4)';
 for(const [account,entry] of [[accountA,dataRows.A],[accountB,dataRows.B]]){
  const wallet=account.address.toLowerCase();
  await admin.query(insertOrder,[entry.order,wallet,STORE,MEAL]);
  await admin.query(insertVoucher,[entry.voucher,wallet,STORE,MEAL]);
 }
 let handle;
 const store=pgStore(admin);
 server=http.createServer((req,res)=>handle(req,res));
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 origin='http://127.0.0.1:'+server.address().port;
 const auth=makePilotHandler({store,origin,clock:()=>now,
  siwe:{makeChallenge,verifyChallenge}});
 const probe=makeG1IsolatedProbeReader({
  authStore:store,readPool:reader,origin,clock:()=>now,enabled:true
 });
 handle=(req,res)=>req.url?.startsWith('/__g1_probe/')?probe(req,res):auth(req,res);
 A=await login(accountA);B=await login(accountB);
});
after(async()=>{
 if(server)await new Promise(ok=>server.close(ok));
 if(reader)await reader.end();
 if(admin)await admin.end();
});
test('auth-pilot session and real G1 isolated reader bind wallet A to its own two test records',async()=>{
 const a=await call('GET','/__g1_probe/my/orders',null,{cookie:A});
 const v=await call('GET','/__g1_probe/my/vouchers',null,{cookie:A});
 assert.equal(a.status,200);assert.equal(v.status,200);
 assert.equal(a.body.mode,'ISOLATED_SYNTHETIC_G1_READ_TEST');
 assert.equal(a.body.originalCp30Connected,false);
 assert.equal(a.body.finalizedOnchainTransactions,false);
 assert.equal(a.body.items.length,1);assert.equal(a.body.items[0].id,dataRows.A.order);
 assert.equal(v.body.items.length,1);assert.equal(v.body.items[0].id,dataRows.A.voucher);
 assert.equal(a.body.items[0].record_origin,'SYNTHETIC_G1_PROBE');
 assert.ok(!JSON.stringify([a.body,v.body]).includes(dataRows.B.order));
});
test('wallet B has separate real signed session; no A orders or vouchers leak across sessions',async()=>{
 const b=await call('GET','/__g1_probe/my/orders',null,{cookie:B});
 const v=await call('GET','/__g1_probe/my/vouchers',null,{cookie:B});
 assert.equal(b.status,200);assert.equal(v.status,200);
 assert.equal(b.body.items.length,1);assert.equal(v.body.items.length,1);
 assert.equal(b.body.items[0].id,dataRows.B.order);assert.equal(v.body.items[0].id,dataRows.B.voucher);
 assert.ok(!JSON.stringify([b.body,v.body]).includes(dataRows.A.order));
});
test('no Cookie, duplicate Cookie, client wallet header and query wallet overrides always reject',async()=>{
 assert.equal((await call('GET','/__g1_probe/my/orders')).status,401);
 assert.equal((await call('GET','/__g1_probe/my/orders',null,{cookie:A+'; '+A})).status,401);
 assert.equal((await call('GET','/__g1_probe/my/orders',null,{cookie:A,extra:{'X-Wallet':accountB.address}})).status,403);
 assert.equal((await call('GET','/__g1_probe/my/orders?wallet='+accountB.address,null,{cookie:A})).status,403);
 assert.equal((await call('POST','/__g1_probe/my/orders',{}, {cookie:A})).status,405);
});
test('isolated reader login cannot SELECT CP31 sessions or mutate the synthetic schema',async()=>{
 await assert.rejects(()=>reader.query('SELECT token_hash FROM mf_cp31_auth_pilot.sessions'),/permission denied/);
 await assert.rejects(()=>reader.query("INSERT INTO mf_g1_probe.orders(id,owner_wallet,store_id,meal_id,quantity,amount_base_units) VALUES(gen_random_uuid(),$1,$2,$3,1,7)",[accountA.address.toLowerCase(),STORE,MEAL]),/permission denied/);
 await assert.rejects(()=>reader.query("DELETE FROM mf_g1_probe.provenance"),/permission denied/);
 const grants=await reader.query("SELECT has_schema_privilege(current_user,'mf_cp31_auth_pilot','USAGE') AS private_schema,has_table_privilege(current_user,'mf_g1_probe.orders','UPDATE') AS can_update");
 assert.equal(grants.rows[0].private_schema,false);
 assert.equal(grants.rows[0].can_update,false);
});
test('DB constraints reject fabricated finality or private QR even by test admin',async()=>{
 await assert.rejects(()=>admin.query("UPDATE mf_g1_probe.orders SET status='FINAL_SUCCEEDED'"),/check constraint/);
 await assert.rejects(()=>admin.query("UPDATE mf_g1_probe.orders SET tx_hash='0x123'"),/check constraint/);
 await assert.rejects(()=>admin.query("UPDATE mf_g1_probe.vouchers SET private_code='secret'"),/check constraint/);
});
test('original CP30 private schema never exists and auth session storage still works',async()=>{
 const result=await admin.query("SELECT to_regnamespace('c1_private') IS NULL AS no_old,(SELECT count(*) FROM mf_cp31_auth_pilot.sessions) AS sessions");
 assert.equal(result.rows[0].no_old,true);
 assert.equal(Number(result.rows[0].sessions),2);
 assert.equal((await call('GET','/v1/me',null,{cookie:A})).body.walletAddress,accountA.address.toLowerCase());
 assert.equal((await call('GET','/v1/me',null,{cookie:B})).body.walletAddress,accountB.address.toLowerCase());
});


test('live read route halts if an administrator mistakenly grants access to Auth Pilot schema',async()=>{
 await admin.query('GRANT USAGE ON SCHEMA mf_cp31_auth_pilot TO mf_g1_probe_reader');
 try{
  const result=await call('GET','/__g1_probe/my/orders',null,{cookie:A});
  assert.equal(result.status,503);
  assert.equal(result.body.error,'G1_TEST_READ_SOURCE_UNAVAILABLE');
 }finally{
  await admin.query('REVOKE USAGE ON SCHEMA mf_cp31_auth_pilot FROM mf_g1_probe_reader');
 }
 const restored=await call('GET','/__g1_probe/my/orders',null,{cookie:A});
 assert.equal(restored.status,200);
});
test('live read route halts if original CP30 schema later appears on the same database',async()=>{
 await admin.query('CREATE SCHEMA c1_private');
 try{
  const result=await call('GET','/__g1_probe/my/orders',null,{cookie:A});
  assert.equal(result.status,503);
  assert.equal(result.body.error,'G1_TEST_READ_SOURCE_UNAVAILABLE');
 }finally{
  await admin.query('DROP SCHEMA c1_private');
 }
 const recovered=await call('GET','/__g1_probe/my/orders',null,{cookie:A});
 assert.equal(recovered.status,200);
});


test('REAL Render server.mjs startup serves same-origin Sites, G0 SIWE, PG17 wallet A/B and private API denial',async()=>{
 const gate=net.createServer();
 await new Promise(ok=>gate.listen(0,'127.0.0.1',ok));
 const port=gate.address().port;
 await new Promise(ok=>gate.close(ok));
 const trustedOrigin='https://mealforward-g1a-ci.onrender.com';
 const host=new URL(trustedOrigin).host;
 const child=spawn(process.execPath,['cloud-auth/server.mjs'],{
  cwd:new URL('..',import.meta.url).pathname.replace(/\/cloud-auth\/$/,'/'),
  env:{...process.env,PORT:String(port),PUBLIC_ORIGIN:trustedOrigin,
   CP31_EMPTY_TEST_DB_INIT:'yes',DATABASE_URL:EXPECTED,
   MF_G1A_PROBE_MODE:'isolated-synthetic-read-only',
   MF_G1A_READONLY_DATABASE_URL:'postgres://mf_g1_probe_login:'+readPass+
      '@127.0.0.1:5432/'+DATABASE},
  stdio:['ignore','pipe','pipe']
 });
 // Never surface child output or connection strings in test assertions/logs.
 child.stdout.on('data',()=>{});
 child.stderr.on('data',()=>{});
 async function httpCall(method,path,body,headers={}){
  return new Promise((resolve,reject)=>{
   const payload=method==='POST'?JSON.stringify(body??{}):null;
   const req=http.request({
    hostname:'127.0.0.1',port,path,method,
    headers:{Host:host,
     ...(method==='POST'?{Origin:trustedOrigin,'Content-Type':'application/json'}:{}),
     ...headers}
   },async res=>{
    let text='';for await(const part of res)text+=part.toString('utf8');
    let data;
    if((res.headers['content-type']||'').includes('application/json'))
     try{data=JSON.parse(text);}catch{reject(Error('NON_JSON_RESPONSE'));return}
    else data=text;
    resolve({status:res.statusCode,body:data,cookie:res.headers['set-cookie']?.[0]?.split(';',1)[0]});
   });
   req.on('error',reject);
   if(payload)req.write(payload);
   req.end();
  });
 }
 async function signInReal(account){
  const pre=await httpCall('POST','/v1/auth/pre-session',{}, {'X-C1-Bootstrap':'1'});
  assert.equal(pre.status,200);
  const challenge=await httpCall('POST','/v1/identity/wallet/challenge',
   {address:account.address.toLowerCase()},
   {Cookie:pre.cookie,'X-C1-CSRF':pre.body.csrf});
  assert.equal(challenge.status,200);
  assert.equal(challenge.body.uri,trustedOrigin);
  const signature=await account.signMessage({message:challenge.body.message});
  const auth=await httpCall('POST','/v1/identity/wallet/login',
   {challengeId:challenge.body.challengeId,signature},
   {Cookie:pre.cookie,'X-C1-CSRF':pre.body.csrf});
  assert.equal(auth.status,200);
  return auth.cookie;
 }
 try{
  let up=false;
  for(let i=0;i<50;i++){
   if(child.exitCode!==null)throw Error('CI_RENDER_CHILD_DID_NOT_BOOT');
   try{
    const health=await httpCall('GET','/health');
    if(health.status===200){up=true;break;}
   }catch{}
   await new Promise(ok=>setTimeout(ok,180));
  }
  assert.equal(up,true,'CI Render server must pass genuine PG17 startup');
  const homepage=await httpCall('GET','/');
  assert.equal(homepage.status,200);
  assert.equal(typeof homepage.body,'string');
  assert.ok(homepage.body.length>500);
  const context=await httpCall('GET','/v1/connection');
  assert.equal(context.status,200);
  assert.equal(context.body.authPilot,true);
  assert.equal(context.body.transactionActionsEnabled,false);
  const authA=await signInReal(accountA);
  const authB=await signInReal(accountB);
  const mineA=await httpCall('GET','/__g1_probe/my/orders',null,{Cookie:authA});
  const mineB=await httpCall('GET','/__g1_probe/my/orders',null,{Cookie:authB});
  assert.equal(mineA.status,200);assert.equal(mineB.status,200);
  assert.equal(mineA.body.items[0]?.id,dataRows.A.order);
  assert.equal(mineB.body.items[0]?.id,dataRows.B.order);
  assert.equal(mineA.body.originalCp30Connected,false);
  assert.equal((await httpCall('GET','/v1/my/orders',null,{Cookie:authA})).status,503);
  assert.equal((await httpCall('GET','/v1/ledger')).status,503);
  assert.equal((await httpCall('GET','/__g1_probe/my/vouchers',null,{Cookie:authB})).body.items[0]?.id,dataRows.B.voucher);
  assert.equal((await httpCall('GET','/__g1_probe/my/orders')).status,401);
 }finally{
  child.kill('SIGTERM');
  if(child.exitCode===null)await Promise.race([
   new Promise(ok=>child.once('exit',ok)),
   new Promise(ok=>setTimeout(ok,3000))
  ]);
  if(child.exitCode===null)child.kill('SIGKILL');
 }
});
