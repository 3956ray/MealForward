/**
 * Real PostgreSQL 17 G1 cache tests; all keys and data generated locally.
 * NEVER points at old CP30, Render Auth PG, wallet or real beneficiaries.
 */
import test, {before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import pg from 'pg';
import {
  makeG1PublicSnapshotCache
} from './public-cache.mjs';
import {publicEnvelopeSigningBytes} from './public-envelope.mjs';

const CI_PG_URL='postgres://postgres:g1-cache-ci-only@127.0.0.1:5432/mealforward_g1_cache_ci_only';
const KEY_ID='mealforward-g1-public-export-v1';
const AUDIENCE='https://mealforward-cp31-auth-laodao.onrender.com';
const STORE='a'.repeat(64);
const MEAL='b'.repeat(64);
const FIXED_NOW=1790000000;
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const other=generateKeyPairSync('ed25519');
const pinnedFingerprint=createHash('sha256')
  .update(publicKey.export({type:'spki',format:'der'})).digest('hex');
let pool,clockValue=FIXED_NOW,cache;

function finance(kind='A',total='7000000',number='1'){
 const f={F:total,A:'0',R:'0',H:'0',S:'0',X:'0',
  liability:'0',
  counts:{F:number,A:'0',R:'0',H:'0',S:'0',X:'0'}};
 f[kind]=total;f.counts[kind]=number;
 f.liability=['A','R','H'].includes(kind)?total:'0';
 return f;
}
function publicSnapshot(asOf=clockValue-2,kind='A'){
 const x=finance(kind);
 return {
   mode:'G1_PUBLIC_SOURCE_PROJECTION_ONLY',
   source:'CP30_ORIGINAL_POSTGRES',
   businessTransactionsAllowed:false,asOf,
   stores:{items:[{
     id:STORE,store:STORE,name:'Community Kitchen',
     escrow:'0x'+'3'.repeat(40)
   }]},
   ledger:{items:[{store:STORE,funded:'1',financial:structuredClone(x)}]},
   meals:{items:[{
     id:MEAL,meal:MEAL,mealId:'0x'+MEAL,store:STORE,version:'1',
     name:'Rice bowl',description:'Warm vegetables and rice',
     windows:[[690,810]],listed:true,published:true,
     eligible:x.counts.A,supported:'1',unitPrice:'7000000',
     assetDecimals:6,assetSymbol:'USDC',
     financial:structuredClone(x),collectionTimeZone:'Asia/Shanghai'
   }]}
 };
}
function envelope({sequence='1',asOf=FIXED_NOW-2,issuedAt=FIXED_NOW,
  expiresAt=FIXED_NOW+90,kind='A',body,signingKey=privateKey,
  audience=AUDIENCE,keyId=KEY_ID}={}){
 const doc={
  v:1,keyId,audience,issuedAt,expiresAt,sequence,
  data:body??publicSnapshot(asOf,kind)
 };
 return {...doc,signature:sign(null,publicEnvelopeSigningBytes(doc),signingKey).toString('base64url')};
}
const make=(which=pool,key=publicKey,fingerprint=pinnedFingerprint)=>
 makeG1PublicSnapshotCache({
   pool:which,publicKey:key,expectedKeyId:KEY_ID,expectedAudience:AUDIENCE,
   expectedPublicKeyFingerprint:fingerprint,clock:()=>clockValue
 });
const rejected=async promise=>assert.rejects(promise,{code:'G1_CACHE_REJECTED'});
const unavailable=async promise=>assert.rejects(promise,{code:'G1_CACHE_NOT_READY'});
const inspect=async()=>{
 const res=await pool.query('SELECT last_sequence,receipt_digest,source_as_of FROM mf_g1_public_cache.active WHERE singleton=1');
 return res.rows[0];
};
async function reset(){
 clockValue=FIXED_NOW;
 // Test administrator alone can recreate a fresh isolated row. The
 // deployed writer role lacks DELETE and INSERT, and the update trigger
 // refuses sequence resets even if its credentials are stolen.
 await pool.query('DELETE FROM mf_g1_public_cache.active WHERE singleton=1');
 await pool.query('INSERT INTO mf_g1_public_cache.active(singleton,key_id,audience) VALUES(1,$1,$2)',[KEY_ID,AUDIENCE]);
}

before(async()=>{
 if(process.env.GITHUB_ACTIONS!=='true'||
    process.env.MF_G1_CACHE_DISPOSABLE_ONLY!=='ack-fresh-public-cache-pg17'||
    process.env.DATABASE_URL!==CI_PG_URL)
  throw Error('REFUSE_NON_DISPOSABLE_G1_POSTGRES');
 pool=new pg.Pool({connectionString:CI_PG_URL,max:18,connectionTimeoutMillis:5000});
 const version=Number((await pool.query('SHOW server_version_num')).rows[0].server_version_num);
 assert.ok(version>=170000&&version<180000);
 const existing=await pool.query("SELECT nspname FROM pg_namespace WHERE nspname LIKE 'c1\\_%' ESCAPE '\\' OR nspname='mf_g1_public_cache'");
 assert.equal(existing.rowCount,0,'No original CP30 or prior G1 cache schema allowed');
 const priorRoles=await pool.query("SELECT rolname FROM pg_roles WHERE rolname LIKE 'mf_g1_cache_%'");
 assert.equal(priorRoles.rowCount,0,'CI cluster must be fresh');
 const sql=readFileSync(new URL('./cache-schema.sql',import.meta.url),'utf8');
 await pool.query(sql);
 await pool.query('INSERT INTO mf_g1_public_cache.active(singleton,key_id,audience) VALUES(1,$1,$2)',[KEY_ID,AUDIENCE]);
 cache=make();
});
beforeEach(reset);
after(async()=>{if(pool)await pool.end();});

test('without a verified signed source the cache is NOT ready',async()=>{
 await unavailable(cache.current());
 assert.equal((await inspect()).last_sequence,'0');
});
test('valid first envelope persists and GET cryptographically reverifies source',async()=>{
 const accepted=await cache.ingest(envelope());
 assert.equal(accepted.accepted,true);
 assert.equal(accepted.sequence,'1');
 const read=await cache.current();
 assert.equal(read.status,'G1_PUBLIC_SNAPSHOT_VERIFIED');
 assert.equal(read.authenticatedPublicSource,true);
 assert.equal(read.chainFinalityIndependentlyVerified,false);
 assert.deepEqual(read.data,publicSnapshot(FIXED_NOW-2));
 assert.equal(read.receiptDigest,accepted.receiptDigest);
 assert.equal((await inspect()).last_sequence,'1');
});
test('parallel replay: 16 concurrent inserts with same sequence accept exactly ONE',async()=>{
 const signed=envelope();
 const attempts=await Promise.allSettled(Array.from({length:16},()=>cache.ingest(signed)));
 assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(attempts.filter(x=>x.status==='rejected'&&
   x.reason?.code==='G1_CACHE_REJECTED').length,15);
 assert.equal((await inspect()).last_sequence,'1');
 assert.equal((await cache.current()).sequence,'1');
});
test('sequence must be contiguous, never allow gaps, duplicates or rollback',async()=>{
 await rejected(cache.ingest(envelope({sequence:'2'})));
 assert.equal((await inspect()).last_sequence,'0');
 await cache.ingest(envelope());
 await rejected(cache.ingest(envelope({sequence:'1'})));
 await rejected(cache.ingest(envelope({sequence:'3',issuedAt:FIXED_NOW+1,asOf:FIXED_NOW-1})));
 const second=envelope({sequence:'2',issuedAt:FIXED_NOW+1,
  expiresAt:FIXED_NOW+91,asOf:FIXED_NOW-1});
 const ok=await cache.ingest(second);
 assert.equal(ok.sequence,'2');
 assert.equal((await inspect()).last_sequence,'2');
});
test('restart/new pool still refuses old envelope via durable PG high-watermark',async()=>{
 await cache.ingest(envelope());
 const rebooted=new pg.Pool({connectionString:CI_PG_URL,max:4});
 try{
   const newApp=make(rebooted);
   assert.equal((await newApp.current()).sequence,'1');
   await rejected(newApp.ingest(envelope()));
   const second=envelope({sequence:'2',issuedAt:FIXED_NOW+1,
    expiresAt:FIXED_NOW+91,asOf:FIXED_NOW-1});
   assert.equal((await newApp.ingest(second)).sequence,'2');
 }finally{await rebooted.end()}
 assert.equal((await inspect()).last_sequence,'2');
});
test('foreign signature, modified digest, wrong origin and bad trust roots never persist',async()=>{
 await rejected(cache.ingest(envelope({signingKey:other.privateKey})));
 const bad=envelope();bad.data.meals.items[0].unitPrice='1';
 await rejected(cache.ingest(bad));
 await rejected(cache.ingest(envelope({audience:'https://other.onrender.com'})));
 await rejected(cache.ingest(envelope({keyId:'another-key-v1'})));
 assert.throws(()=>make(pool,other.publicKey,pinnedFingerprint),{code:'G1_CACHE_TRUST_ROOT_REQUIRED'});
 assert.throws(()=>make(pool,privateKey,pinnedFingerprint),{code:'G1_CACHE_TRUST_ROOT_REQUIRED'});
 assert.equal((await inspect()).last_sequence,'0');
});
test('expired source never served; only fresh next sequence can restore availability',async()=>{
 await cache.ingest(envelope());
 clockValue=FIXED_NOW+91;
 await unavailable(cache.current());
 await rejected(cache.ingest(envelope()));
 const next=envelope({sequence:'2',issuedAt:clockValue,asOf:clockValue-2,
  expiresAt:clockValue+80});
 assert.equal((await cache.ingest(next)).sequence,'2');
 assert.equal((await cache.current()).sequence,'2');
});
test('stale or inconsistent source timestamps cannot change existing materials',async()=>{
 await cache.ingest(envelope());
 const same=publicSnapshot(FIXED_NOW-2);same.meals.items[0].name='Different meal';
 await rejected(cache.ingest(envelope({sequence:'2',body:same})));
 await rejected(cache.ingest(envelope({sequence:'2',asOf:FIXED_NOW-3})));
 assert.equal((await inspect()).last_sequence,'1');
 const next=envelope({sequence:'2',issuedAt:FIXED_NOW+1,
  expiresAt:FIXED_NOW+91,asOf:FIXED_NOW-1});
 await cache.ingest(next);
 assert.equal((await inspect()).last_sequence,'2');
});
test('monotone funded/settled monetary state and store identity enforced',async()=>{
 const first=publicSnapshot(FIXED_NOW-2,'S');
 await cache.ingest(envelope({body:first}));
 const rollback=publicSnapshot(FIXED_NOW-1,'A');
 await rejected(cache.ingest(envelope({sequence:'2',body:rollback,
  issuedAt:FIXED_NOW+1,expiresAt:FIXED_NOW+91})));
 const swapped=publicSnapshot(FIXED_NOW-1,'S');
 swapped.stores.items[0].id='c'.repeat(64);swapped.stores.items[0].store='c'.repeat(64);
 swapped.ledger.items[0].store='c'.repeat(64);
 swapped.meals.items[0].store='c'.repeat(64);
 await rejected(cache.ingest(envelope({sequence:'2',body:swapped,
  issuedAt:FIXED_NOW+1,expiresAt:FIXED_NOW+91})));
 assert.equal((await inspect()).last_sequence,'1');
});
test('missing trust-root row and tampered saved signed JSON never served',async()=>{
 await cache.ingest(envelope());
 // Privileged fixture corruption (requires disabling an owner-only trigger).
 // This proves GET verifies cryptography even against a tampered DB backup.
 await pool.query('ALTER TABLE mf_g1_public_cache.active DISABLE TRIGGER mf_g1_cache_monotone');
 try{
  await pool.query("UPDATE mf_g1_public_cache.active SET signed_envelope=jsonb_set(signed_envelope,"+
   "'{data,meals,items,0,name}',to_jsonb('FORGED'::text)) WHERE singleton=1");
 }finally{
  await pool.query('ALTER TABLE mf_g1_public_cache.active ENABLE TRIGGER mf_g1_cache_monotone');
 }
 await unavailable(cache.current());
 await rejected(cache.ingest(envelope({sequence:'2',issuedAt:FIXED_NOW+1,
  expiresAt:FIXED_NOW+91,asOf:FIXED_NOW-1})));
 assert.equal((await inspect()).last_sequence,'1');
});
test('failed DB UPDATE rolls back atomically: same original signed seq can retry',async()=>{
 await pool.query("CREATE FUNCTION mf_g1_public_cache.ci_fail() RETURNS trigger "+
  "LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'CI_BLOCK_UPDATE'; END $$");
 await pool.query('CREATE TRIGGER ci_fail BEFORE UPDATE ON mf_g1_public_cache.active '+
  'FOR EACH ROW EXECUTE FUNCTION mf_g1_public_cache.ci_fail()');
 try{
   await rejected(cache.ingest(envelope()));
   assert.equal((await inspect()).last_sequence,'0');
 }finally{
   await pool.query('DROP TRIGGER ci_fail ON mf_g1_public_cache.active');
   await pool.query('DROP FUNCTION mf_g1_public_cache.ci_fail()');
 }
 const retry=await cache.ingest(envelope());
 assert.equal(retry.sequence,'1');
 assert.equal((await inspect()).last_sequence,'1');
});
test('reader/writer NOLOGIN SQL roles cannot access original or mutate public cache',async()=>{
 const roles=await pool.query("SELECT rolname,rolcanlogin,rolsuper,rolbypassrls "+
  "FROM pg_roles WHERE rolname IN ('mf_g1_cache_reader','mf_g1_cache_writer') ORDER BY rolname");
 assert.equal(roles.rowCount,2);
 assert.ok(roles.rows.every(r=>r.rolcanlogin===false&&r.rolsuper===false&&r.rolbypassrls===false));
 const privs=await pool.query("SELECT "+
  "has_table_privilege('mf_g1_cache_reader','mf_g1_public_cache.active','SELECT') r, "+
  "has_table_privilege('mf_g1_cache_reader','mf_g1_public_cache.active','UPDATE') u, "+
  "has_table_privilege('mf_g1_cache_writer','mf_g1_public_cache.active','UPDATE') w, "+
  "has_table_privilege('mf_g1_cache_writer','mf_g1_public_cache.active','INSERT') i");
 assert.deepEqual(privs.rows[0],{r:true,u:false,w:true,i:false});
 const client=await pool.connect();
 try{
   await client.query('BEGIN');
   await client.query('SET LOCAL ROLE mf_g1_cache_reader');
   assert.equal((await client.query('SELECT key_id FROM mf_g1_public_cache.active')).rowCount,1);
   await assert.rejects(client.query("UPDATE mf_g1_public_cache.active "+
    "SET audience='https://evil.onrender.com'"),{code:'42501'});
 }finally{await client.query('ROLLBACK');client.release()}
 const names=await pool.query("SELECT nspname FROM pg_namespace WHERE nspname LIKE 'c1\\_%' ESCAPE '\\'");
 assert.equal(names.rowCount,0);
});
test('writer cannot change trust roots, delete cache row or rewind accepted sequence',async()=>{
 await cache.ingest(envelope());
 const writer=await pool.connect();
 try{
  await writer.query('BEGIN');
  await writer.query('SET LOCAL ROLE mf_g1_cache_writer');
  await assert.rejects(writer.query("UPDATE mf_g1_public_cache.active SET key_id='unauthorized-root' WHERE singleton=1"),{code:'42501'});
 }finally{await writer.query('ROLLBACK');writer.release()}
 const reader=await pool.connect();
 try{
  await reader.query('BEGIN');
  await reader.query('SET LOCAL ROLE mf_g1_cache_writer');
  await assert.rejects(reader.query('DELETE FROM mf_g1_public_cache.active WHERE singleton=1'),{code:'42501'});
 }finally{await reader.query('ROLLBACK');reader.release()}
 const fresh=await pool.connect();
 try{
  await fresh.query('BEGIN');
  await fresh.query('SET LOCAL ROLE mf_g1_cache_writer');
  await assert.rejects(fresh.query("UPDATE mf_g1_public_cache.active SET last_sequence=0,"+
    "signed_envelope=NULL,receipt_digest=NULL,source_as_of=NULL,"+
    "signed_issued_at=NULL,signed_expires_at=NULL,accepted_at=NULL WHERE singleton=1"),{code:'P0001'});
 }finally{await fresh.query('ROLLBACK');fresh.release()}
 assert.equal((await inspect()).last_sequence,'1');
 assert.equal((await cache.current()).sequence,'1');
});
