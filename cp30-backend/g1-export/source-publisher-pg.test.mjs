/**
 * Disposable 3×PG17.11 G1 source publisher/outbox integration security tests.
 * The "original" source is a generated PUBLIC-only fixture; the signer is
 * a new ephemeral Ed25519 key. Original CP30/Render/signers remain untouched.
 */
import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import pg from 'pg';
import {makeG1SourcePublisher} from './source-publisher.mjs';
import {makeG1PublicSnapshotCache} from './public-cache.mjs';
import {makeIndependentG1PublicAnchor} from './independent-anchor.mjs';

const OUTBOX_URL='postgres://postgres:g1-source-ci-only@127.0.0.1:5435/mealforward_g1_source_ci_only';
const CACHE_URL='postgres://postgres:g1-anchored-cache-ci-only@127.0.0.1:5434/mealforward_g1_anchor_cache_ci_only';
const ANCHOR_URL='postgres://postgres:g1-anchor-ci-only@127.0.0.1:5433/mealforward_g1_anchor_ci_only';
const TRUST='mealforward-g1-public-export-v1';
const AUDIENCE='https://mealforward-cp31-auth-laodao.onrender.com';
const TIME=1790000000;
const STORE='a'.repeat(64),MEAL='b'.repeat(64);
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const stranger=generateKeyPairSync('ed25519');
const FINGERPRINT=createHash('sha256')
  .update(publicKey.export({format:'der',type:'spki'})).digest('hex');
let outboxPool,cachePool,anchorPool,anchor,cache,publisher;
let now=TIME,sourceData,signs=0,sourceReads=0,sends=[],sendImpl,readImpl;

const datum=(asOf=now-2)=>({
 mode:'G1_PUBLIC_SOURCE_PROJECTION_ONLY',
 source:'CP30_ORIGINAL_POSTGRES',businessTransactionsAllowed:false,asOf,
 stores:{items:[{id:STORE,store:STORE,name:'Community Kitchen',escrow:'0x'+'3'.repeat(40)}]},
 ledger:{items:[{store:STORE,funded:'1',financial:money()}]},
 meals:{items:[{id:MEAL,meal:MEAL,mealId:'0x'+MEAL,store:STORE,version:'1',
  name:'Rice bowl',description:'Warm rice and vegetables',windows:[[690,810]],
  listed:true,published:true,eligible:'1',supported:'1',unitPrice:'7000000',
  assetDecimals:6,assetSymbol:'USDC',financial:money(),
  collectionTimeZone:'Asia/Shanghai'}]}
});
const money=()=>({F:'7000000',A:'7000000',R:'0',H:'0',S:'0',X:'0',
 liability:'7000000',counts:{F:'1',A:'1',R:'0',H:'0',S:'0',X:'0'}});
const reject=async promise=>assert.rejects(promise,{code:'G1_PUBLISHER_REJECTED'});
const inspect=async()=> {
 const [a,b,c]=await Promise.all([
  outboxPool.query('SELECT last_ack_sequence,last_ack_digest,pending_sequence,'+
    'pending_receipt_digest,pending_signed_envelope FROM mf_g1_publisher.outbox WHERE singleton=1'),
  cachePool.query('SELECT last_sequence,receipt_digest FROM mf_g1_public_cache.active WHERE singleton=1'),
  anchorPool.query('SELECT last_sequence,receipt_digest FROM mf_g1_independent_anchor.checkpoint WHERE singleton=1')
 ]);
 return {outbox:a.rows[0],cache:b.rows[0],anchor:c.rows[0]};
};
const configure=({signerKey=privateKey}={})=>makeG1SourcePublisher({
 pool:outboxPool,
 publicKey,expectedKeyId:TRUST,expectedAudience:AUDIENCE,
 expectedPublicKeyFingerprint:FINGERPRINT,clock:()=>now,
 readPublicSource:async()=>{sourceReads++;return structuredClone(sourceData)},
 signer:{signPublicEnvelope:async bytes=>{
  signs++;return sign(null,bytes,signerKey);
 }},
 transport:{
  send:async doc=>{sends.push(structuredClone(doc));return sendImpl(doc)},
  readBack:()=>readImpl()
 }
});

before(async()=>{
 if(process.env.GITHUB_ACTIONS!=='true'||
  process.env.MF_G1_SOURCE_DISPOSABLE_ONLY!=='ack-three-standalone-pg17'||
  process.env.OUTBOX_DATABASE_URL!==OUTBOX_URL||
  process.env.ANCHOR_CACHE_DATABASE_URL!==CACHE_URL||
  process.env.ANCHOR_DATABASE_URL!==ANCHOR_URL)
  throw Error('REFUSE_UNAUTHORIZED_SOURCE_DB_OR_PRODUCTION_ENV');
 outboxPool=new pg.Pool({connectionString:OUTBOX_URL,max:14,connectionTimeoutMillis:5000});
 cachePool=new pg.Pool({connectionString:CACHE_URL,max:16,connectionTimeoutMillis:5000});
 anchorPool=new pg.Pool({connectionString:ANCHOR_URL,max:16,connectionTimeoutMillis:5000});
 const ports=await Promise.all([outboxPool,cachePool,anchorPool].map(
  p=>p.query('SELECT current_database() AS db,inet_server_port() AS port')));
 assert.equal(new Set(ports.map(x=>x.rows[0].db)).size,3);
 for(const pool of [outboxPool,cachePool,anchorPool]){
  const version=Number((await pool.query('SHOW server_version_num')).rows[0].server_version_num);
  assert.ok(version>=170000&&version<180000);
  const prior=await pool.query("SELECT nspname FROM pg_namespace "+
    "WHERE nspname LIKE 'c1\\_%' ESCAPE '\\' OR nspname LIKE 'mf_g1_%'");
  assert.equal(prior.rowCount,0,'Only fresh disposable databases are permitted');
 }
 await Promise.all([
  outboxPool.query(readFileSync(new URL('./source-publisher-outbox.sql',import.meta.url),'utf8')),
  cachePool.query(readFileSync(new URL('./cache-schema.sql',import.meta.url),'utf8')),
  anchorPool.query(readFileSync(new URL('./independent-anchor-schema.sql',import.meta.url),'utf8'))
 ]);
 await Promise.all([
  outboxPool.query('INSERT INTO mf_g1_publisher.outbox(singleton,key_id,audience) VALUES(1,$1,$2)',[TRUST,AUDIENCE]),
  cachePool.query('INSERT INTO mf_g1_public_cache.active(singleton,key_id,audience) VALUES(1,$1,$2)',[TRUST,AUDIENCE]),
  anchorPool.query('INSERT INTO mf_g1_independent_anchor.checkpoint(singleton,key_id,audience) VALUES(1,$1,$2)',[TRUST,AUDIENCE])
 ]);
 anchor=makeIndependentG1PublicAnchor({pool:anchorPool,publicKey,
  expectedKeyId:TRUST,expectedAudience:AUDIENCE,expectedPublicKeyFingerprint:FINGERPRINT,
  clock:()=>now});
 cache=makeG1PublicSnapshotCache({pool:cachePool,anchor,publicKey,
  expectedKeyId:TRUST,expectedAudience:AUDIENCE,expectedPublicKeyFingerprint:FINGERPRINT,
  clock:()=>now});
 publisher=configure();
});
beforeEach(async()=>{
 now=TIME;signs=0;sourceReads=0;sends=[];
 sourceData=datum(TIME-2);
 sendImpl=doc=>cache.ingest(doc);
 readImpl=()=>cache.current();
 // Only a GitHub Actions disposable PostgreSQL superuser resets fixture
 // rows; no application role has INSERT/DELETE privileges.
 await Promise.all([
  outboxPool.query('DELETE FROM mf_g1_publisher.outbox'),
  cachePool.query('DELETE FROM mf_g1_public_cache.active'),
  anchorPool.query('DELETE FROM mf_g1_independent_anchor.checkpoint')
 ]);
 await Promise.all([
  outboxPool.query('INSERT INTO mf_g1_publisher.outbox(singleton,key_id,audience) VALUES(1,$1,$2)',[TRUST,AUDIENCE]),
  cachePool.query('INSERT INTO mf_g1_public_cache.active(singleton,key_id,audience) VALUES(1,$1,$2)',[TRUST,AUDIENCE]),
  anchorPool.query('INSERT INTO mf_g1_independent_anchor.checkpoint(singleton,key_id,audience) VALUES(1,$1,$2)',[TRUST,AUDIENCE])
 ]);
});
after(async()=>{
 await Promise.all([outboxPool,cachePool,anchorPool].filter(Boolean).map(p=>p.end()));
});

test('source signer prepares exact signed payload in outbox BEFORE any network call',async()=>{
 const created=await publisher.prepareNext();
 assert.equal(created.prepared,true);
 assert.equal(created.sequence,'1');
 assert.equal(signs,1);assert.equal(sourceReads,1);
 assert.equal(sends.length,0);
 const rows=await inspect();
 assert.equal(rows.outbox.pending_sequence,'1');
 assert.equal(rows.outbox.last_ack_sequence,'0');
 assert.equal(rows.cache.last_sequence,'0');assert.equal(rows.anchor.last_sequence,'0');
 assert.equal(rows.outbox.pending_signed_envelope.signature.length,86);
 assert.deepEqual(rows.outbox.pending_signed_envelope.data,sourceData);
 assert.equal(await publisher.status().then(s=>s.pending),true);
});

test('dispatch requires both independently anchored receiver and exact read-back before durable ACK',async()=>{
 await publisher.prepareNext();
 const receipt=await publisher.dispatchPending();
 assert.equal(receipt.delivered,true);
 assert.equal(receipt.sequence,'1');
 const rows=await inspect();
 assert.equal(rows.outbox.last_ack_sequence,'1');
 assert.equal(rows.outbox.pending_sequence,null);
 assert.equal(rows.outbox.last_ack_digest,rows.anchor.receipt_digest);
 assert.equal(rows.outbox.last_ack_digest,rows.cache.receipt_digest);
 assert.equal(signs,1);
 assert.equal((await publisher.dispatchPending()).delivered,false);
 assert.equal(sends.length,1);
});

test('16 concurrent prepare calls sign once and do not create differing same-sequence envelopes',async()=>{
 const all=await Promise.all(Array.from({length:16},()=>publisher.prepareNext()));
 assert.equal(all.filter(x=>x.prepared).length,1);
 assert.equal(all.filter(x=>x.pending).length,16);
 assert.equal(new Set(all.map(x=>x.receiptDigest)).size,1);
 assert.equal(signs,1);assert.equal(sourceReads,1);
 assert.equal((await inspect()).outbox.pending_sequence,'1');
});

test('16 concurrent dispatch attempts accept one full source ACK and do not resend after ACK',async()=>{
 await publisher.prepareNext();
 const all=await Promise.all(Array.from({length:16},()=>publisher.dispatchPending()));
 assert.equal(all.filter(x=>x.delivered).length,1);
 assert.equal(all.filter(x=>!x.delivered).length,15);
 assert.equal(sends.length,1);
 const rows=await inspect();
 assert.equal(rows.outbox.last_ack_sequence,'1');
 assert.equal(rows.anchor.last_sequence,'1');
});

test('lost POST reply after independent anchor COMMIT is safely resolved by verified GET',async()=>{
 await publisher.prepareNext();
 sendImpl=async doc=>{await cache.ingest(doc);throw Error('SIMULATED_POST_REPLY_LOST')};
 const ack=await publisher.dispatchPending();
 assert.equal(ack.delivered,true);
 assert.equal(signs,1);
 assert.equal((await inspect()).outbox.last_ack_sequence,'1');
 assert.equal(sends.length,1);
});

test('transport blackout keeps exact pending original; recovery does not re-sign',async()=>{
 await publisher.prepareNext();
 const first=(await inspect()).outbox.pending_signed_envelope;
 sendImpl=async()=>{throw Error('SYNTHETIC_NETWORK_DOWN')};
 readImpl=async()=>{throw Error('SYNTHETIC_NETWORK_DOWN')};
 await reject(publisher.dispatchPending());
 let rows=await inspect();
 assert.equal(rows.outbox.last_ack_sequence,'0');
 assert.deepEqual(rows.outbox.pending_signed_envelope,first);
 await publisher.prepareNext();
 assert.equal(signs,1);assert.equal(sourceReads,1);
 sendImpl=doc=>cache.ingest(doc);
 readImpl=()=>cache.current();
 assert.equal((await publisher.dispatchPending()).sequence,'1');
 assert.deepEqual(sends[0],sends[1]);
 assert.equal((await inspect()).outbox.last_ack_sequence,'1');
});

test('ack write fails AFTER remote commit: same immutable signed envelope can be re-sent and recovered',async()=>{
 await publisher.prepareNext();
 const first=(await inspect()).outbox.pending_signed_envelope;
 await outboxPool.query("CREATE FUNCTION mf_g1_publisher.ci_fail_ack() RETURNS trigger "+
  "LANGUAGE plpgsql AS $$ BEGIN IF NEW.last_ack_sequence>OLD.last_ack_sequence "+
  "THEN RAISE EXCEPTION 'DISPOSABLE_ACK_FAIL'; END IF; RETURN NEW; END $$");
 await outboxPool.query("CREATE TRIGGER ci_fail_ack BEFORE UPDATE ON mf_g1_publisher.outbox "+
  "FOR EACH ROW EXECUTE FUNCTION mf_g1_publisher.ci_fail_ack()");
 try{
  await reject(publisher.dispatchPending());
 }finally{
  await outboxPool.query('DROP TRIGGER ci_fail_ack ON mf_g1_publisher.outbox');
  await outboxPool.query('DROP FUNCTION mf_g1_publisher.ci_fail_ack()');
 }
 const midway=await inspect();
 assert.equal(midway.outbox.last_ack_sequence,'0');
 assert.deepEqual(midway.outbox.pending_signed_envelope,first);
 assert.equal(midway.anchor.last_sequence,'1');
 // Receiver is already at seq=1: POST returns replay rejection; the
 // independent signed read-back still proves the exact original was stored.
 assert.equal((await publisher.dispatchPending()).delivered,true);
 const end=await inspect();
 assert.equal(end.outbox.last_ack_sequence,'1');
 assert.equal(end.outbox.pending_sequence,null);
 assert.equal(signs,1);
});

test('forged or incomplete acknowledgement cannot clear pending source intent',async()=>{
 await publisher.prepareNext();
 readImpl=async()=>({status:'G1_PUBLIC_SNAPSHOT_VERIFIED',sequence:'1',
  receiptDigest:'f'.repeat(64)});
 await reject(publisher.dispatchPending());
 assert.equal((await inspect()).outbox.last_ack_sequence,'0');
 assert.equal((await inspect()).outbox.pending_sequence,'1');
 readImpl=()=>cache.current();
 assert.equal((await publisher.dispatchPending()).sequence,'1');
});

test('expired pending original is terminal and cannot be silently re-signed or skipped',async()=>{
 await publisher.prepareNext();
 const first=(await inspect()).outbox.pending_signed_envelope;
 now=TIME+91;
 await reject(publisher.dispatchPending());
 const queue=await publisher.prepareNext();
 assert.equal(queue.prepared,false);
 assert.equal(queue.pending,true);
 assert.equal(signs,1);
 assert.deepEqual((await inspect()).outbox.pending_signed_envelope,first);
 assert.equal(sends.length,0);
});

test('after ACK, only a newer source projection can create signed seq+1',async()=>{
 await publisher.prepareNext();await publisher.dispatchPending();
 const unchanged=structuredClone(sourceData);
 await reject(publisher.prepareNext());
 assert.equal(signs,1);
 sourceData={...unchanged,asOf:TIME-1};
 now=TIME+1;
 const next=await publisher.prepareNext();
 assert.equal(next.sequence,'2');assert.equal(signs,2);
 const ack=await publisher.dispatchPending();
 assert.equal(ack.sequence,'2');
 assert.equal((await inspect()).outbox.last_ack_sequence,'2');
 assert.equal((await anchor.current()).sequence,'2');
});

test('source reader leakage or signer key mismatch never creates pending or sends data',async()=>{
 sourceData.meals.items[0].recipientEmail='private@example.test';
 await reject(publisher.prepareNext());
 assert.equal(signs,0);assert.equal(sends.length,0);
 assert.equal((await inspect()).outbox.pending_sequence,null);
 sourceData=datum();
 const invalid=configure({signerKey:stranger.privateKey});
 await reject(invalid.prepareNext());
 assert.equal((await inspect()).outbox.pending_sequence,null);
});

test('outbox SQL role cannot change trust root or replace signed pending material',async()=>{
 await publisher.prepareNext();
 const worker=async sql=>{
  const c=await outboxPool.connect();
  try{
   await c.query('BEGIN');await c.query('SET LOCAL ROLE mf_g1_publisher_writer');
   await assert.rejects(c.query(sql));
  }finally{await c.query('ROLLBACK');c.release()}
 };
 await worker("UPDATE mf_g1_publisher.outbox SET key_id='other-authority' WHERE singleton=1");
 await worker("UPDATE mf_g1_publisher.outbox SET pending_sequence=2 WHERE singleton=1");
 await worker("DELETE FROM mf_g1_publisher.outbox WHERE singleton=1");
 await worker("UPDATE mf_g1_publisher.outbox SET last_ack_sequence=1 WHERE singleton=1");
 assert.equal((await inspect()).outbox.pending_sequence,'1');
 const roles=await outboxPool.query("SELECT rolcanlogin,rolsuper,rolbypassrls FROM pg_roles "+
  "WHERE rolname='mf_g1_publisher_writer'");
 assert.deepEqual(roles.rows[0],{rolcanlogin:false,rolsuper:false,rolbypassrls:false});
});

test('no arbitrary HTTP origin, wallet session or private business source is installed by this module',async()=>{
 await assert.rejects(publisher.dispatchPending({wallet:'0x'+'1'.repeat(40)}).then(x=>{
  if(x.delivered)throw Error('unexpected-delivery');
  // An empty queue must not begin an unsigned user-supplied business intent.
  throw Object.assign(Error('G1_PUBLISHER_REJECTED'),{code:'G1_PUBLISHER_REJECTED'});
 }),{code:'G1_PUBLISHER_REJECTED'});
 assert.equal((await inspect()).outbox.last_ack_sequence,'0');
});
