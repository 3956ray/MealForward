/**
 * Real ephemeral PG17 + HTTP integration for G1 public signed cache.
 * This test is manually invoked by the G1 CI workflow, not npm test.
 * It is forbidden outside CI with the exact disposable DB and dummy role.
 * All Ed25519 private keys are ephemeral in-memory test fixtures.
 */
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {generateKeyPairSync,sign} from 'node:crypto';
import pg from 'pg';
import {publicEnvelopeSigningBytes} from './public-envelope.mjs';
import {createG1PublicCache,makeG1PublicCacheHandler} from './public-cache.mjs';

const URL='postgres://mf_g1_cache_app:g1-disposable-only@127.0.0.1:5432/mf_g1_cache_ci_only';
const ADMIN_URL='postgres://postgres:g1-disposable-only@127.0.0.1:5432/mf_g1_cache_ci_only';
const audience='https://mealforward-cp31-auth-laodao.onrender.com';
const keyId='mealforward-g1-public-source-ci-key';
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const attacker=generateKeyPairSync('ed25519');
const store='a'.repeat(64),meal='b'.repeat(64);
let now=1800000000,pool,admin,server,origin,cache,handler;
const funds=()=>({
 F:'7000000',A:'7000000',R:'0',H:'0',S:'0',X:'0',
 liability:'7000000',counts:{F:'1',A:'1',R:'0',H:'0',S:'0',X:'0'}
});
const data=()=>({
 mode:'G1_PUBLIC_SOURCE_PROJECTION_ONLY',
 source:'CP30_ORIGINAL_POSTGRES',
 businessTransactionsAllowed:false,asOf:now-2,
 stores:{items:[{id:store,store,name:'Community Kitchen',escrow:'0x'+'3'.repeat(40)}]},
 ledger:{items:[{store,funded:'1',financial:funds()}]},
 meals:{items:[{
  id:meal,meal,mealId:'0x'+meal,store,version:'1',
  name:'Vegetable rice',description:'A warm local meal',
  windows:[[690,810]],listed:true,published:true,
  eligible:'1',supported:'1',unitPrice:'7000000',
  assetDecimals:6,assetSymbol:'USDC',financial:funds(),
  collectionTimeZone:'Asia/Shanghai'
 }]}
});
function signed(seq,payload=data(),key=privateKey,overrides={}){
 const original={
  v:1,keyId,audience,issuedAt:now,expiresAt:now+90,
  sequence:String(seq),data:payload,...overrides
 };
 return {...original,signature:sign(null,publicEnvelopeSigningBytes(original),key).toString('base64url')};
}
const call=async(method,path,payload,options={})=>{
 const headers={...(method==='POST'?{'Content-Type':'application/json'}:{}),...options.headers};
 const response=await fetch(origin+path,{
  method,headers,redirect:'error',
  ...(payload===undefined?{}:{body:options.raw?payload:JSON.stringify(payload)})
 });
 return {status:response.status,body:await response.json(),headers:response.headers};
};
async function launch(nextPool=pool,enabled=true){
 const c=createG1PublicCache({
  pool:nextPool,publicKey,keyId,audience,clock:()=>now,enabled
 });
 const h=makeG1PublicCacheHandler({cache:c,expectedAudience:audience,enabled});
 const s=http.createServer((req,res)=>h(req,res));
 await new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));
 return {server:s,origin:'http://127.0.0.1:'+s.address().port,cache:c};
}
const close=s=>new Promise((resolve,reject)=>s.close(e=>e?reject(e):resolve()));
const pgRow=async()=>{
 const r=await pool.query(
  'SELECT sequence,envelope,digest FROM mf_g1_public_cache.snapshots WHERE source_id=$1',
  ['cp30-public-v1']);
 return r.rows[0];
};
before(async()=>{
 if(process.env.GITHUB_ACTIONS!=='true'||
  process.env.MF_G1_CACHE_DISPOSABLE_ONLY!=='g1-fresh-runner-postgres-17'||
  process.env.G1_CACHE_TEST_DB_URL!==URL)
  throw Error('FRESH_CI_G1_CACHE_ONLY');
 pool=new pg.Pool({connectionString:URL,max:16,connectionTimeoutMillis:5000});
 admin=new pg.Pool({connectionString:ADMIN_URL,max:2,connectionTimeoutMillis:5000});
 const v=await pool.query('SHOW server_version_num');
 assert.ok(Number(v.rows[0].server_version_num)>=170000&&Number(v.rows[0].server_version_num)<180000);
 const name=await pool.query('SELECT current_database() AS n');
 assert.equal(name.rows[0].n,'mf_g1_cache_ci_only');
 const pre=await pool.query("SELECT count(*)::int AS n FROM mf_g1_public_cache.snapshots");
 assert.equal(pre.rows[0].n,1);
 const site=await launch();({server,origin,cache}=site);
});
after(async()=>{
 if(server)await close(server);
 if(pool)await pool.end();
 if(admin)await admin.end();
});

test('restricted cache role cannot create objects, delete snapshots or inspect source tables',async()=>{
 const details=await admin.query(
  "SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname='mf_g1_cache_app'");
 assert.deepEqual(Object.values(details.rows[0]),[false,false,false,false]);
 for(const privilege of ['DELETE','INSERT','TRUNCATE']){
  const r=await admin.query(
   "SELECT has_table_privilege('mf_g1_cache_app','mf_g1_public_cache.snapshots',$1) AS permitted",
   [privilege]);
  assert.equal(r.rows[0].permitted,false,privilege);
 }
 const create=await admin.query(
  "SELECT has_database_privilege('mf_g1_cache_app',current_database(),'CREATE') AS permitted");
 assert.equal(create.rows[0].permitted,false);
 for(const q of [
  "DELETE FROM mf_g1_public_cache.snapshots",
  "INSERT INTO mf_g1_public_cache.snapshots(source_id) VALUES('invalid')",
  "UPDATE mf_g1_public_cache.snapshots SET source_id='wrong'",
  "CREATE TABLE public.unauthorized(id integer)"
 ])await assert.rejects(pool.query(q),{code:'42501'});
 const schemas=await pool.query(
  "SELECT count(*)::int AS n FROM information_schema.schemata WHERE schema_name LIKE 'c1\\_%' ESCAPE '\\'");
 assert.equal(schemas.rows[0].n,0);
});
test('no signed data means 503; health does not claim business connected',async()=>{
 const healthy=await call('GET','/health');
 assert.equal(healthy.status,200);
 assert.equal(healthy.body.walletTransactionsAllowed,false);
 assert.equal((await call('GET','/v1/stores')).status,503);
 assert.equal((await call('GET','/v1/ledger')).status,503);
 assert.equal((await call('GET','/v1/my/vouchers')).status,503);
});
test('unsigned body, forged source, malicious fields and cross-origin uploads never update state',async()=>{
 let x=await call('POST','/internal/g1/public-snapshot',{arbitrary:'untrusted'});
 assert.equal(x.status,403);
 x=await call('POST','/internal/g1/public-snapshot',signed(1,data(),attacker.privateKey));
 assert.equal(x.status,403);
 const bad=data();bad.stores.items[0].email='recipient@private.invalid';
 x=await call('POST','/internal/g1/public-snapshot',signed(1,bad));
 assert.equal(x.status,403);
 x=await call('POST','/internal/g1/public-snapshot',signed(1),{headers:{Origin:'https://evil.example'}});
 assert.equal(x.status,403);
 x=await call('POST','/internal/g1/public-snapshot','{}',{raw:true,headers:{'Content-Type':'text/plain'}});
 assert.equal(x.status,415);
 assert.equal(String((await pgRow()).sequence),'0');
});
test('twelve concurrent copies of one valid signed upload accept exactly once',async()=>{
 const original=signed(1);
 const requests=await Promise.all(Array.from({length:12},()=>
  call('POST','/internal/g1/public-snapshot',original)));
 assert.equal(requests.filter(x=>x.status===202).length,1);
 assert.equal(requests.filter(x=>x.status===409).length,11);
 assert.equal(String((await pgRow()).sequence),'1');
 assert.equal((await call('GET','/v1/stores')).body.items[0].name,'Community Kitchen');
 assert.equal((await call('GET','/v1/ledger')).body.items[0].financial.F,'7000000');
 assert.equal((await call('GET','/v1/stores/'+store+'/meals')).body.items[0].id,meal);
 assert.equal((await call('GET','/v1/my/orders')).status,503);
 assert.equal((await call('GET','/v1/stores/'+'c'.repeat(64)+'/meals')).status,404);
});
test('bad signature/tampering and signed private content cannot replace accepted data',async()=>{
 const wrong=signed(2,data(),attacker.privateKey);
 assert.equal((await call('POST','/internal/g1/public-snapshot',wrong)).status,403);
 const altered=signed(2);altered.data.ledger.items[0].financial.F='1';
 assert.equal((await call('POST','/internal/g1/public-snapshot',altered)).status,403);
 const leaked=data();leaked.meals.items[0].voucherAccessCode='SECRET';
 assert.equal((await call('POST','/internal/g1/public-snapshot',signed(2,leaked))).status,403);
 assert.equal(String((await pgRow()).sequence),'1');
});
test('new receiver connection after restart still rejects replay and accepts higher sequence',async()=>{
 const second=new pg.Pool({connectionString:URL,max:3,connectionTimeoutMillis:5000});
 try{
  const fresh=createG1PublicCache({pool:second,publicKey,keyId,audience,clock:()=>now,enabled:true});
  await assert.rejects(fresh.accept(signed(1)),{code:'G1_PUBLIC_REPLAY'});
  const next=data();next.stores.items[0].name='Second snapshot';
  const r=await fresh.accept(signed(2,next));
  assert.equal(r.sequence,'2');
  assert.equal((await fresh.read()).data.stores.items[0].name,'Second snapshot');
  assert.equal(String((await pgRow()).sequence),'2');
 }finally{await second.end()}
});
test('lower signed sequence can never overwrite latest committed snapshot',async()=>{
 const less=signed(1),current=await pgRow();
 assert.equal((await call('POST','/internal/g1/public-snapshot',less)).status,409);
 assert.equal((await pgRow()).digest,current.digest);
 const many=await Promise.all([
  call('POST','/internal/g1/public-snapshot',signed(3)),
  call('POST','/internal/g1/public-snapshot',signed(4))
 ]);
 assert.ok(many.every(x=>[202,409].includes(x.status)));
 assert.equal(String((await pgRow()).sequence),'4');
});
test('expired cache disappears from public reads but retains durable replay floor',async()=>{
 now+=121;
 assert.equal((await call('GET','/v1/stores')).status,503);
 assert.equal((await call('GET','/v1/ledger')).status,503);
 assert.equal((await call('POST','/internal/g1/public-snapshot',signed(4))).status,409);
 assert.equal(String((await pgRow()).sequence),'4');
 const newer=signed(5);
 assert.equal((await call('POST','/internal/g1/public-snapshot',newer)).status,202);
 assert.equal((await call('GET','/v1/stores')).status,200);
});
test('a damaged cached envelope cannot be served even if stored row remains valid',async()=>{
 assert.equal((await call('GET','/v1/stores')).status,200);
 const original=await pgRow();
 try{
  const forged=structuredClone(original.envelope);
  forged.data.meals.items[0].unitPrice='1';
  await pool.query('UPDATE mf_g1_public_cache.snapshots SET envelope=$1::jsonb WHERE source_id=$2',
   [JSON.stringify(forged),'cp30-public-v1']);
  assert.equal((await call('GET','/v1/stores')).status,503);
 }finally{
  await pool.query('UPDATE mf_g1_public_cache.snapshots SET envelope=$1::jsonb WHERE source_id=$2',
   [JSON.stringify(original.envelope),'cp30-public-v1']);
 }
 assert.equal((await call('GET','/v1/stores')).status,200);
});
test('disabled candidate does not read or accept any snapshot',async()=>{
 const temp=await launch(pool,false);
 const base=origin;origin=temp.origin;
 try{
  assert.equal((await call('GET','/v1/stores')).status,503);
  assert.equal((await call('POST','/internal/g1/public-snapshot',signed(6))).status,503);
 }finally{origin=base;await close(temp.server)}
});
