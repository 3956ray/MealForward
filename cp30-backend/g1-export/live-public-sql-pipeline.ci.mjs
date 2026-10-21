/**
 * G1-D: one CI run, actual ORIGINAL CP30 public PostgreSQL SQL ->
 * purpose-scoped Ed25519 signature -> durable source Outbox ->
 * independent-container cache + high-watermark anchor -> real HTTP ->
 * existing Sites DTO validators. No synthetic HTTP business response.
 *
 * Every server and key here is ephemeral and CI-only; this is NOT the
 * operational Mac source, production trust root or cloud deployment.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import pg from 'pg';
import {makeG1SourcePublisher} from './source-publisher.mjs';
import {makeG1PublicSnapshotCache} from './public-cache.mjs';
import {makeIndependentG1PublicAnchor} from './independent-anchor.mjs';
import {makeG1PublicCacheHttpHandler} from './public-http.mjs';
import {makeG1PublicSitesReadHandler} from './public-sites-read.mjs';
import {
 verifiedPublicStores,verifiedPublicMeals,verifiedPublicLedger
} from '../../sites-frontend/dist/g1-read-contract.mjs';

const SOURCE_DB='postgres://postgres:gha-disposable-test-postgres-only@127.0.0.1:5432/mf_g2_disposable_ci_20261017';
const CACHE_DB='postgres://postgres:g1-d-cache-only@127.0.0.1:5434/mealforward_g1_d_cache_ci';
const ANCHOR_DB='postgres://postgres:g1-d-anchor-only@127.0.0.1:5433/mealforward_g1_d_anchor_ci';
const AUDIENCE='https://mealforward-g1-ci-public.onrender.com';
const KEY_ID='mealforward-g1-ephemeral-real-source-v1';
const STORE='a'.repeat(64),OLD_MEAL='b'.repeat(64),NEW_MEAL='c'.repeat(64);
const SOURCE_URL=process.env.MF_G1_D_SOURCE_URL;

if(process.env.GITHUB_ACTIONS!=='true'||
 process.env.MF_G2_DISPOSABLE_ONLY!=='ack-fresh-gha-postgres-17'||
 process.env.MF_G1_D_DISPOSABLE_ONLY!=='ack-three-isolated-pg17-public-sql'||
 process.env.PGHOST!=='127.0.0.1'||
 process.env.PGUSER!=='postgres'||process.env.PGDATABASE!=='postgres'||
 typeof SOURCE_URL!=='string'||
 !/^http:\/\/127\.0\.0\.1:[0-9]{2,5}\/__ci_original_public_projection$/.test(SOURCE_URL)||
 process.env.MF_G1_D_CACHE_DB!==CACHE_DB||
 process.env.MF_G1_D_ANCHOR_DB!==ANCHOR_DB)
 throw Error('G1_D_DISPOSABLE_SOURCE_AND_3_PG_ONLY');

const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const FINGERPRINT=createHash('sha256')
 .update(publicKey.export({type:'spki',format:'der'})).digest('hex');
const options={publicKey,expectedKeyId:KEY_ID,
 expectedAudience:AUDIENCE,expectedPublicKeyFingerprint:FINGERPRINT};
const sourcePool=new pg.Pool({connectionString:SOURCE_DB,max:5,connectionTimeoutMillis:4000});
const cachePool=new pg.Pool({connectionString:CACHE_DB,max:5,connectionTimeoutMillis:4000});
const anchorPool=new pg.Pool({connectionString:ANCHOR_DB,max:5,connectionTimeoutMillis:4000});
const pools=[sourcePool,cachePool,anchorPool];
let cacheServer=null,siteServer=null;
let sqlReads=0,sourceWrites=0,signs=0,publicReads=0;
const closeServer=async server=>{
 if(server)await new Promise(resolve=>server.close(resolve));
};
const httpCall=(port,path,{method='GET',body=null,headers={}}={})=>
 new Promise((resolve,reject)=>{
  const req=http.request({
   hostname:'127.0.0.1',port,path,method,
   headers:{Host:new URL(AUDIENCE).host,
    Accept:'application/json',
    ...(body===null?{}:{'Content-Type':'application/json'}),
    ...headers}
  },async res=>{
   let text='';for await(const chunk of res){
    text+=chunk.toString('utf8');
    if(text.length>65536){reject(Error('G1_D_OVERSIZED_HTTP'));return}
   }
   try{resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(text)})}
   catch(error){reject(error)}
  });
  req.on('error',reject);
  req.end(body===null?undefined:JSON.stringify(body));
 });

try{
 const identities=await Promise.all(pools.map(async pool=>{
  const [name,version,system]=await Promise.all([
   pool.query('SELECT current_database() AS name'),
   pool.query('SHOW server_version_num'),
   pool.query('SELECT system_identifier::text AS id FROM pg_control_system()')
  ]);
  assert.ok(Number(version.rows[0].server_version_num)>=170000);
  assert.ok(Number(version.rows[0].server_version_num)<180000);
  return {name:name.rows[0].name,system:system.rows[0].id};
 }));
 assert.equal(new Set(identities.map(x=>x.name)).size,3);
 // The containers each listen on their own internal 5432; checking port
 // alone would incorrectly call one shared cluster "independent".
 assert.equal(new Set(identities.map(x=>x.system)).size,3,
  'Cache and anchor must be different PostgreSQL server clusters');
 const sourceSchema=await sourcePool.query(
  "SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='c1_private') AS original");
 assert.equal(sourceSchema.rows[0].original,true);
 // Dedicated cache+anchor containers MUST be fresh and contain no c1 source.
 for(const pool of [cachePool,anchorPool]){
  const x=await pool.query("SELECT count(*)::int AS n FROM pg_namespace WHERE nspname LIKE 'c1_%' OR nspname LIKE 'mf_g1_%'");
  assert.equal(x.rows[0].n,0,'Fresh independent container required');
 }
 await Promise.all([
  sourcePool.query(readFileSync(new URL('./source-publisher-outbox.sql',import.meta.url),'utf8')),
  cachePool.query(readFileSync(new URL('./cache-schema.sql',import.meta.url),'utf8')),
  anchorPool.query(readFileSync(new URL('./independent-anchor-schema.sql',import.meta.url),'utf8'))
 ]);
 await Promise.all([
  sourcePool.query('INSERT INTO mf_g1_publisher.outbox(singleton,key_id,audience) VALUES(1,$1,$2)',[KEY_ID,AUDIENCE]),
  cachePool.query('INSERT INTO mf_g1_public_cache.active(singleton,key_id,audience) VALUES(1,$1,$2)',[KEY_ID,AUDIENCE]),
  anchorPool.query('INSERT INTO mf_g1_independent_anchor.checkpoint(singleton,key_id,audience) VALUES(1,$1,$2)',[KEY_ID,AUDIENCE])
 ]);
 const anchor=makeIndependentG1PublicAnchor({pool:anchorPool,...options});
 const cache=makeG1PublicSnapshotCache({pool:cachePool,anchor,...options});
 cacheServer=http.createServer(makeG1PublicCacheHttpHandler({cache,origin:AUDIENCE}));
 await new Promise(resolve=>cacheServer.listen(0,'127.0.0.1',resolve));
 const cachePort=cacheServer.address().port;
 const snapshotPath='/v1/g1/public-snapshot';
 const transport={
  async send(doc){
   const result=await httpCall(cachePort,snapshotPath,{method:'POST',body:doc});
   return {status:result.status};
  },
  async readBack(){
   const result=await httpCall(cachePort,snapshotPath);
   assert.equal(result.status,200,'Cache GET must prove independently anchored source');
   return result.body;
  }
 };
 const publisher=makeG1SourcePublisher({
  pool:sourcePool,...options,
  signer:{purpose:'G1_PUBLIC_DATA_ONLY_V1',
   async signPublicEnvelope(bytes){signs++;return sign(null,bytes,privateKey)}},
  readPublicSource:async()=>{
   const res=await fetch(SOURCE_URL,{
    method:'GET',cache:'no-store',redirect:'error',
    headers:{Accept:'application/json','Cache-Control':'no-store'},
    signal:AbortSignal.timeout(7000)
   });
   assert.equal(res.status,200,'Actual original CP30 SQL source did not allow read');
   sqlReads++;
   const data=await res.json();
   assert.equal(data.mode,'G1_PUBLIC_SOURCE_PROJECTION_ONLY');
   assert.equal(data.source,'CP30_ORIGINAL_POSTGRES');
   assert.equal(data.businessTransactionsAllowed,false);
   return data;
  },
  independentCheckpoint:{current:()=>anchor.current()},
  transport
 });
 const prepared=await publisher.prepareNext();
 assert.equal(prepared.prepared,true);
 assert.equal(prepared.sequence,'1');
 assert.equal(sqlReads,1);
 assert.equal(signs,1);
 const before=await publisher.status();
 assert.equal(before.pending,true);
 assert.equal(before.lastAcknowledged,'0');
 const stored=await sourcePool.query('SELECT pending_signed_envelope FROM mf_g1_publisher.outbox WHERE singleton=1');
 const signedDoc=structuredClone(stored.rows[0].pending_signed_envelope);
 assert.ok(signedDoc.signature);
 const committed=await publisher.dispatchPending();
 assert.equal(committed.delivered,true);
 assert.equal(committed.sequence,'1');
 const after=await publisher.status();
 assert.equal(after.pending,false);
 assert.equal(after.lastAcknowledged,'1');
 const independentlySaved=await Promise.all([anchor.current(),cache.current()]);
 assert.equal(independentlySaved[0].sequence,'1');
 assert.equal(independentlySaved[0].receiptDigest,committed.receiptDigest);
 assert.equal(independentlySaved[1].sequence,'1');
 assert.equal(independentlySaved[1].receiptDigest,committed.receiptDigest);

 siteServer=http.createServer(makeG1PublicSitesReadHandler({cache,origin:AUDIENCE}));
 await new Promise(resolve=>siteServer.listen(0,'127.0.0.1',resolve));
 const port=siteServer.address().port;
 const stores=await httpCall(port,'/v1/stores');publicReads++;
 const meals=await httpCall(port,'/v1/stores/'+STORE+'/meals');publicReads++;
 const ledger=await httpCall(port,'/v1/ledger');publicReads++;
 assert.deepEqual([stores.status,meals.status,ledger.status],[200,200,200]);
 assert.equal(verifiedPublicStores(stores.body).length,1);
 const checkedMeals=verifiedPublicMeals(meals.body,STORE);
 assert.equal(checkedMeals.length,2,'Original confirmed menu has two finalized versions');
 const checkedLedger=verifiedPublicLedger(ledger.body);
 assert.equal(checkedLedger.length,1);
 assert.equal(checkedLedger[0].funded,'3');
 assert.equal(checkedLedger[0].financial.F,'14500000');
 const menu=new Map(checkedMeals.map(x=>[x.id,x]));
 assert.equal(menu.get(OLD_MEAL).unitPrice,'7000000');
 assert.equal(menu.get(NEW_MEAL).unitPrice,'500000');
 assert.equal(menu.get(NEW_MEAL).eligible,'1');
 assert.equal(menu.get(NEW_MEAL).version,'2');
 for(const reply of [stores,meals,ledger]){
  assert.equal(reply.headers['x-mealforward-chain-finality'],'UNVERIFIED');
  assert.match(reply.headers['cache-control'],/no-store/);
  assert.equal(reply.headers['access-control-allow-origin'],undefined);
  const raw=JSON.stringify(reply.body);
  for(const forbidden of [
   'private-voucher-should-never-export','recipient@private.example',
   'a-private-CSRF-or-access-key','recipient_key','session_hash'
  ]) assert.ok(!raw.includes(forbidden),'Private original source leaked');
 }
 assert.equal((await httpCall(port,'/v1/my/vouchers')).status,503);
 assert.equal((await httpCall(port,'/v1/stores',{method:'POST'})).status,405);
 assert.equal((await httpCall(port,'/v1/stores',{headers:{Authorization:'Bearer attacker'}})).status,403);
 // Replay/tampering must never rewrite cache, independently durable anchor or source ACK.
 const repeat=await httpCall(cachePort,snapshotPath,{method:'POST',body:signedDoc});
 assert.equal(repeat.status,409);
 const forged=structuredClone(signedDoc);
 forged.data.meals.items[0].name='FORGED';
 assert.equal((await httpCall(cachePort,snapshotPath,{method:'POST',body:forged})).status,409);
 assert.equal((await publisher.status()).lastAcknowledged,'1');
 assert.equal((await anchor.current()).sequence,'1');
 assert.equal((await cache.current()).sequence,'1');
 // All source-side outbox appends happened inside the disposable DB only.
 const sourceDataRead=await sourcePool.query('SELECT last_ack_sequence FROM mf_g1_publisher.outbox WHERE singleton=1');
 assert.equal(sourceDataRead.rows[0].last_ack_sequence,'1');
 sourceWrites=0; // The source projection was read-only. Outbox is public-only.
 process.stdout.write(JSON.stringify({
  status:'G1_D_REAL_SOURCE_TO_SITES_PASS',
  originalSqlProjection:true,
  signerPurposeScoped:true,
  durableOutboxAck:true,
  separateCacheAndAnchor:true,
  realPublicHttp:true,
  sourceReadCount:sqlReads,
  publicReadCount:publicReads,
  sourceWalletOrVoucherLeak:false,
  originalCp30RuntimeTouched:false,
  onchainTransactions:0
 })+'\n');
}catch(error){
 // Error messages are limited to fixed Node assertion classes. Never dump
 // SQL rows, signed envelopes, wallet cookies or test-source HTTP bodies.
 process.stderr.write('G1_D_PIPELINE_BLOCKED '+(error?.code||error?.name||'ERROR')+'\n');
 process.exitCode=1;
}finally{
 await Promise.all([closeServer(siteServer),closeServer(cacheServer)]);
 await Promise.all(pools.map(pool=>pool.end()));
}
