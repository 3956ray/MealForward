/**
 * Two independent postgres:17.11 containers, two connection URLs, and a
 * rollback-safe anchor-first cache. CI ONLY. No original CP30, Render, wallet,
 * signer, voucher, source principal or real public snapshot.
 */
import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import pg from 'pg';
import {makeG1PublicSnapshotCache} from './public-cache.mjs';
import {makeIndependentG1PublicAnchor} from './independent-anchor.mjs';
import {publicEnvelopeSigningBytes} from './public-envelope.mjs';

const CACHE_URL='postgres://postgres:g1-cache-ci-only@127.0.0.1:5432/mealforward_g1_anchor_cache_ci_only';
const ANCHOR_URL='postgres://postgres:g1-anchor-ci-only@127.0.0.1:5433/mealforward_g1_anchor_ci_only';
const AUDIENCE='https://mealforward-cp31-auth-laodao.onrender.com';
const KEY_ID='mealforward-g1-public-export-v1';
const TIME=1790000000;
const STORE='a'.repeat(64),MEAL='b'.repeat(64);
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const other=generateKeyPairSync('ed25519');
const fingerprint=createHash('sha256').update(publicKey.export({format:'der',type:'spki'})).digest('hex');
let cachePool,anchorPool,cache,anchor,now=TIME;

function finance(){
 return {F:'7000000',A:'7000000',R:'0',H:'0',S:'0',X:'0',
  liability:'7000000',counts:{F:'1',A:'1',R:'0',H:'0',S:'0',X:'0'}};
}
function data(asOf=now-2){
 return {
  mode:'G1_PUBLIC_SOURCE_PROJECTION_ONLY',source:'CP30_ORIGINAL_POSTGRES',
  businessTransactionsAllowed:false,asOf,
  stores:{items:[{id:STORE,store:STORE,name:'Warm Kitchen',escrow:'0x'+'3'.repeat(40)}]},
  ledger:{items:[{store:STORE,funded:'1',financial:finance()}]},
  meals:{items:[{id:MEAL,meal:MEAL,mealId:'0x'+MEAL,store:STORE,version:'1',
   name:'Rice bowl',description:'Rice and vegetables',windows:[[690,810]],
   listed:true,published:true,eligible:'1',supported:'1',unitPrice:'7000000',
   assetDecimals:6,assetSymbol:'USDC',financial:finance(),collectionTimeZone:'Asia/Shanghai'}]}
 };
}
function signed(sequence='1',{issuedAt=now,asOf=now-2,expiresAt=now+90,
 key=privateKey,dataOverride}={}){
 const original={v:1,keyId:KEY_ID,audience:AUDIENCE,issuedAt,expiresAt,
  sequence,data:dataOverride??data(asOf)};
 return {...original,signature:sign(null,publicEnvelopeSigningBytes(original),key).toString('base64url')};
}
const expectFail=promise=>assert.rejects(promise,{code:'G1_CACHE_REJECTED'});
const rejectRead=promise=>assert.rejects(promise,{code:'G1_CACHE_NOT_READY'});
const rejectAnchor=promise=>assert.rejects(promise,{code:'G1_INDEPENDENT_ANCHOR_REJECTED'});
const sequenceRows=async()=>{
 const [cacheRow,anchorRow]=await Promise.all([
  cachePool.query('SELECT last_sequence,receipt_digest FROM mf_g1_public_cache.active WHERE singleton=1'),
  anchorPool.query('SELECT last_sequence,receipt_digest FROM mf_g1_independent_anchor.checkpoint WHERE singleton=1')
 ]);
 return {cache:cacheRow.rows[0],anchor:anchorRow.rows[0]};
};
function makeAnchor(pool=anchorPool,key=publicKey){
 return makeIndependentG1PublicAnchor({
  pool,publicKey:key,expectedPublicKeyFingerprint:fingerprint,
  expectedAudience:AUDIENCE,expectedKeyId:KEY_ID,clock:()=>now
 });
}
function makeCache(pool=cachePool,reader=anchor,key=publicKey){
 return makeG1PublicSnapshotCache({
  pool,anchor:reader,publicKey:key,expectedPublicKeyFingerprint:fingerprint,
  expectedAudience:AUDIENCE,expectedKeyId:KEY_ID,clock:()=>now
 });
}

before(async()=>{
 if(process.env.GITHUB_ACTIONS!=='true'||
    process.env.MF_G1_CACHE_DISPOSABLE_ONLY!=='ack-fresh-public-cache-pg17'||
    process.env.MF_G1_ANCHOR_DISPOSABLE_ONLY!=='ack-separate-pg17'||
    process.env.DATABASE_URL!==CACHE_URL||process.env.ANCHOR_DATABASE_URL!==ANCHOR_URL)
  throw Error('REFUSE_NON_DISPOSABLE_OR_SHARED_SOURCE_DB');
 cachePool=new pg.Pool({connectionString:CACHE_URL,max:18,connectionTimeoutMillis:4000});
 anchorPool=new pg.Pool({connectionString:ANCHOR_URL,max:18,connectionTimeoutMillis:4000});
 const [a,b]=await Promise.all([
  cachePool.query("SELECT version(),current_database() db,inet_server_port() port"),
  anchorPool.query("SELECT version(),current_database() db,inet_server_port() port")
 ]);
 assert.equal(a.rows[0].port,5432);
 assert.equal(b.rows[0].port,5432); // Anchor container sees its own 5432 internally.
 assert.notEqual(a.rows[0].db,b.rows[0].db);
 const verifyEmpty=async pool=>{
  const versions=await pool.query('SHOW server_version_num');
  const version=Number(versions.rows[0].server_version_num);
  assert.ok(version>=170000&&version<180000);
  const existing=await pool.query("SELECT nspname FROM pg_namespace "+
   "WHERE nspname LIKE 'c1\\_%' ESCAPE '\\' OR nspname LIKE 'mf_g1_%'");
  assert.equal(existing.rowCount,0);
 };
 await Promise.all([verifyEmpty(cachePool),verifyEmpty(anchorPool)]);
 await cachePool.query(readFileSync(new URL('./cache-schema.sql',import.meta.url),'utf8'));
 await anchorPool.query(readFileSync(new URL('./independent-anchor-schema.sql',import.meta.url),'utf8'));
 await cachePool.query('INSERT INTO mf_g1_public_cache.active(singleton,key_id,audience) VALUES(1,$1,$2)',[KEY_ID,AUDIENCE]);
 await anchorPool.query('INSERT INTO mf_g1_independent_anchor.checkpoint(singleton,key_id,audience) VALUES(1,$1,$2)',[KEY_ID,AUDIENCE]);
 anchor=makeAnchor();
 cache=makeCache();
});
beforeEach(async()=>{
 now=TIME;
 // The test-only postgres superuser resets both disposable databases. No
 // application writer can do this, and no original CP30 state exists here.
 await cachePool.query('DELETE FROM mf_g1_public_cache.active');
 await anchorPool.query('DELETE FROM mf_g1_independent_anchor.checkpoint');
 await cachePool.query('INSERT INTO mf_g1_public_cache.active(singleton,key_id,audience) VALUES(1,$1,$2)',[KEY_ID,AUDIENCE]);
 await anchorPool.query('INSERT INTO mf_g1_independent_anchor.checkpoint(singleton,key_id,audience) VALUES(1,$1,$2)',[KEY_ID,AUDIENCE]);
});
after(async()=>{
 if(cachePool)await cachePool.end();
 if(anchorPool)await anchorPool.end();
});

test('independent stores are physically different local PG containers and have no CP30 schemas',async()=>{
 const [a,b]=await Promise.all([
  cachePool.query('SELECT pg_postmaster_start_time() AS born'),
  anchorPool.query('SELECT pg_postmaster_start_time() AS born')
 ]);
 assert.equal(a.rowCount,1);assert.equal(b.rowCount,1);
 await assert.rejects(cachePool.query('SELECT * FROM mf_g1_independent_anchor.checkpoint'),{code:'42P01'});
 await assert.rejects(anchorPool.query('SELECT * FROM mf_g1_public_cache.active'),{code:'42P01'});
 await rejectRead(cache.current());
 assert.deepEqual((await anchor.current()).sequence,'0');
});
test('first signed public snapshot commits anchor and cache to identical immutable digest',async()=>{
 const accepted=await cache.ingest(signed());
 assert.equal(accepted.independentlyAnchored,true);
 assert.equal(accepted.anchorReconciled,false);
 const both=await sequenceRows();
 assert.equal(both.cache.last_sequence,'1');
 assert.equal(both.anchor.last_sequence,'1');
 assert.match(both.cache.receipt_digest,/^[0-9a-f]{64}$/);
 assert.equal(both.cache.receipt_digest,both.anchor.receipt_digest);
 const read=await cache.current();
 assert.equal(read.sequence,'1');
 assert.equal(read.independentlyAnchored,true);
 assert.equal(read.chainFinalityIndependentlyVerified,false);
});
test('16 concurrent signed payload submissions produce one anchor advance and one visible snapshot',async()=>{
 const payload=signed();
 const outcomes=await Promise.allSettled(Array.from({length:16},()=>cache.ingest(payload)));
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(outcomes.filter(x=>x.status==='rejected'&&x.reason?.code==='G1_CACHE_REJECTED').length,15);
 const both=await sequenceRows();
 assert.equal(both.cache.last_sequence,'1');
 assert.equal(both.anchor.last_sequence,'1');
 assert.equal((await cache.current()).sequence,'1');
});
test('failed anchor advance never mutates cache or presents public data',async()=>{
 const failed=makeCache(cachePool,{
  advance:async()=>{throw Error('ISOLATED_ANCHOR_UNAVAILABLE')},
  current:async()=>{throw Error('ISOLATED_ANCHOR_UNAVAILABLE')}
 });
 await expectFail(failed.ingest(signed()));
 const both=await sequenceRows();
 assert.equal(both.cache.last_sequence,'0');
 assert.equal(both.anchor.last_sequence,'0');
 await rejectRead(failed.current());
});
test('anchor commits, cache write fails, identical signed envelope repairs one-step crash gap',async()=>{
 const first=signed();
 await cachePool.query("CREATE FUNCTION mf_g1_public_cache.ci_fail_update() RETURNS trigger "+
  "LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'DISPOSABLE_CACHE_COMMIT_FAIL'; END $$");
 await cachePool.query("CREATE TRIGGER ci_fail_update BEFORE UPDATE ON mf_g1_public_cache.active "+
  "FOR EACH ROW EXECUTE FUNCTION mf_g1_public_cache.ci_fail_update()");
 try{
  await expectFail(cache.ingest(first));
 }finally{
  await cachePool.query('DROP TRIGGER ci_fail_update ON mf_g1_public_cache.active');
  await cachePool.query('DROP FUNCTION mf_g1_public_cache.ci_fail_update()');
 }
 let both=await sequenceRows();
 assert.equal(both.cache.last_sequence,'0');
 assert.equal(both.anchor.last_sequence,'1');
 await rejectRead(cache.current());
 const repaired=await cache.ingest(first);
 assert.equal(repaired.anchorReconciled,true);
 both=await sequenceRows();
 assert.equal(both.cache.last_sequence,'1');
 assert.equal(both.anchor.last_sequence,'1');
 assert.equal(await cache.current().then(x=>x.sequence),'1');
});
test('a DIFFERENT signed body cannot claim an already-anchored crash-recovery sequence',async()=>{
 const first=signed(),secondData=data();secondData.meals.items[0].name='Different meal';
 const alternate=signed('1',{dataOverride:secondData});
 await anchor.advance({
  envelope:first,expectedPreviousSequence:'0',
  expectedPreviousDigest:null,now
 });
 await expectFail(cache.ingest(alternate));
 const both=await sequenceRows();
 assert.equal(both.cache.last_sequence,'0');
 assert.equal(both.anchor.last_sequence,'1');
 const recovered=await cache.ingest(first);
 assert.equal(recovered.anchorReconciled,true);
});
test('a privileged restore of CACHE DB to a lower sequence is detected by the surviving anchor',async()=>{
 await cache.ingest(signed());
 now=TIME+1;
 await cache.ingest(signed('2'));
 await cachePool.query('DELETE FROM mf_g1_public_cache.active');
 await cachePool.query('INSERT INTO mf_g1_public_cache.active(singleton,key_id,audience) VALUES(1,$1,$2)',[KEY_ID,AUDIENCE]);
 const both=await sequenceRows();
 assert.equal(both.cache.last_sequence,'0');
 assert.equal(both.anchor.last_sequence,'2');
 await rejectRead(cache.current());
 await expectFail(cache.ingest(signed('1',{issuedAt:TIME,expiresAt:TIME+90,asOf:TIME-2})));
 await expectFail(cache.ingest(signed('2')));
 assert.equal((await anchor.current()).sequence,'2');
});
test('a privileged restore of ANCHOR DB cannot silently authorize cache data',async()=>{
 const original=signed();
 await cache.ingest(original);
 await anchorPool.query('DELETE FROM mf_g1_independent_anchor.checkpoint');
 await anchorPool.query('INSERT INTO mf_g1_independent_anchor.checkpoint(singleton,key_id,audience) VALUES(1,$1,$2)',[KEY_ID,AUDIENCE]);
 await rejectRead(cache.current());
 now=TIME+1;
 await expectFail(cache.ingest(signed('2')));
 assert.equal((await sequenceRows()).cache.last_sequence,'1');
});
test('anchor role cannot delete row, change key, decrease sequence, skip sequence or reach cache database',async()=>{
 await cache.ingest(signed());
 const client=await anchorPool.connect();
 try{
  await client.query('BEGIN');
  await client.query('SET LOCAL ROLE mf_g1_anchor_writer');
  await assert.rejects(client.query("UPDATE mf_g1_independent_anchor.checkpoint SET key_id='modified-trust-root'"),{code:'42501'});
 }finally{await client.query('ROLLBACK');client.release()}
 const denied=async query=>{
  const c=await anchorPool.connect();
  try{
   await c.query('BEGIN');await c.query('SET LOCAL ROLE mf_g1_anchor_writer');
   await assert.rejects(c.query(query));
  }finally{await c.query('ROLLBACK');c.release()}
 };
 await denied('DELETE FROM mf_g1_independent_anchor.checkpoint WHERE singleton=1');
 await denied("UPDATE mf_g1_independent_anchor.checkpoint SET last_sequence=0 WHERE singleton=1");
 await denied("UPDATE mf_g1_independent_anchor.checkpoint SET last_sequence=3 WHERE singleton=1");
 const role=await anchorPool.query("SELECT rolcanlogin,rolsuper,rolbypassrls FROM pg_roles WHERE rolname='mf_g1_anchor_writer'");
 assert.deepEqual(role.rows[0],{rolcanlogin:false,rolsuper:false,rolbypassrls:false});
 assert.equal((await anchor.current()).sequence,'1');
});
test('repeated and foreign signatures cannot advance the independent checkpoint',async()=>{
 const first=signed();
 await cache.ingest(first);
 // An exact duplicate anchored receipt may be used to repair a cache
 // commit failure; it must not advance the anchor sequence a second time.
 const duplicate=await anchor.advance({
  envelope:first,expectedPreviousSequence:'0',expectedPreviousDigest:null,now
 });
 assert.equal(duplicate.recoveryMatch,true);
 assert.equal((await anchor.current()).sequence,'1');
 await rejectAnchor(anchor.advance({
  envelope:signed('2',{key:other.privateKey}),
  expectedPreviousSequence:'1',
  expectedPreviousDigest:(await anchor.current()).receiptDigest,now
 }));
 assert.equal((await anchor.current()).sequence,'1');
});
test('expired public cache is withheld even while its high-watermark is intact',async()=>{
 await cache.ingest(signed());
 now=TIME+92;
 await rejectRead(cache.current());
 assert.equal((await anchor.current()).sequence,'1');
 const repaired=await cache.ingest(signed('2'));
 assert.equal(repaired.sequence,'2');
 assert.equal((await cache.current()).sequence,'2');
});
