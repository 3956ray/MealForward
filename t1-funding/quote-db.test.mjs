import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {CHAIN,ESCROW,MEAL,TERMS,PRICE,QUOTE} from '../t1-intents/core.mjs';

const DB='postgres://postgres:t1d-disposable-only@127.0.0.1:5434/mf_t1d_ci';
const AUTH=process.env.GITHUB_ACTIONS==='true'&&
  process.env.MF_T1D_DISPOSABLE_ONLY==='ack-ephemeral-quote-key'&&
  process.env.DATABASE_URL===DB;
let pool;
const intentId=randomUUID();
const quoteId='0x'+'9'.repeat(64);
const digest='0x'+'b'.repeat(64);
const sigHash='0x'+'c'.repeat(64);
const testSignature='0x'+'a'.repeat(130);
// The signature is a SYNTHETIC FORMAT fixture only. It is NOT cryptographically
// signed by the user's real Quote EOA and can NEVER fund an actual contract.

before(async()=>{
 assert.equal(AUTH,true,'DISPOSABLE_CI_DATABASE_ONLY');
 pool=new pg.Pool({connectionString:DB,max:4});
 const v=await pool.query('SHOW server_version_num');
 assert.ok(Number(v.rows[0].server_version_num)>=170000&&
  Number(v.rows[0].server_version_num)<180000);
 const empty=await pool.query("SELECT to_regnamespace('mf_t1c') IS NULL AS empty");
 assert.equal(empty.rows[0].empty,true);
 // Original Supabase private schema is built only on fresh PG, never old Mac.
 const original=await readFile(new URL('../t1-intents/schema.sql',import.meta.url),'utf8');
 const clean=original.replace(/,anon,authenticated,service_role/g,'');
 await pool.query(clean);
 const mod=await readFile(new URL('./006_quote_authorizations.sql',import.meta.url),'utf8');
 await pool.query(mod.replace(/,anon,authenticated,service_role/g,''));
});
after(async()=>{await pool?.end()});

async function insertIntent(id= intentId,qid=quoteId){
 await pool.query(
  'INSERT INTO mf_t1c.intents (intent_id,payer,idempotency_key,quote_id,meal_id,terms_hash,version,quantity,unit_price,amount,quote_deadline) '+
  'VALUES ($1,$2,$3,$4,$5,$6,1,1,$7,$8,$9)',
  [id,'0x'+'1'.repeat(40),randomUUID(),qid,MEAL,TERMS,PRICE.toString(),PRICE.toString(),1792681800]
 );
}
const insertSigned=(options={})=>pool.query(
 'INSERT INTO mf_t1c.quote_authorizations(intent_id,quote_id,signed_authority,quote_digest,signature,signature_fingerprint) '+
 'VALUES($1,$2,$3,$4,$5,$6)',
 [options.intent_id??intentId, options.quote_id??quoteId,
  options.signed_authority??QUOTE,options.quote_digest??digest,
  options.signature??testSignature,options.signature_fingerprint??sigHash]
);

test('T1-D SQL migration creates a narrow, initially EMPTY private authorization table',async()=>{
 const table=await pool.query("SELECT to_regclass('mf_t1c.quote_authorizations') AS table_name");
 assert.equal(table.rows[0].table_name,'mf_t1c.quote_authorizations');
 const count=await pool.query('SELECT count(*)::int AS n FROM mf_t1c.quote_authorizations');
 assert.equal(count.rows[0].n,0);
 await insertIntent();
});
test('cannot bind a FundingQuote while original Intent is still PREPARED',async()=>{
 await assert.rejects(()=>insertSigned(),/T1D_SIGNED_QUOTE_NOT_ORIGINAL_INTENT/);
});
test('cannot alter quote identity, quote digest or signature fingerprint independently from original Intent',async()=>{
 await pool.query(
  "UPDATE mf_t1c.intents SET stage='QUOTE_BOUND',quote_digest=$2,quote_signature_hash=$3,revision=revision+1 WHERE intent_id=$1",
  [intentId,digest,sigHash]
 );
 await assert.rejects(()=>insertSigned({quote_id:'0x'+'8'.repeat(64)}),/T1D_SIGNED_QUOTE_NOT_ORIGINAL_INTENT/);
 await assert.rejects(()=>insertSigned({quote_digest:'0x'+'8'.repeat(64)}),/T1D_SIGNED_QUOTE_NOT_ORIGINAL_INTENT/);
 await assert.rejects(()=>insertSigned({signature_fingerprint:'0x'+'8'.repeat(64)}),/T1D_SIGNED_QUOTE_NOT_ORIGINAL_INTENT/);
 await assert.rejects(()=>insertSigned({signed_authority:'0x'+'2'.repeat(40)}),e=>e.code==='23514');
});
test('original Quote signature may be persisted ONCE with exact nonzero 7-USDC Intent after separate EIP712 signer verification',async()=>{
 const inserted=await insertSigned();
 assert.equal(inserted.rowCount,1);
 const r=await pool.query('SELECT quote_id,signed_authority,quote_digest,signature_fingerprint FROM mf_t1c.quote_authorizations WHERE intent_id=$1',[intentId]);
 assert.equal(r.rows[0].quote_id,quoteId);
 assert.equal(r.rows[0].signed_authority,QUOTE);
 assert.equal(r.rows[0].quote_digest,digest);
 assert.equal(r.rows[0].signature_fingerprint,sigHash);
 await assert.rejects(()=>insertSigned(),e=>e.code==='23505');
});
test('SQL enforces append-only: UPDATE, DELETE and TRUNCATE signed quote are all rejected',async()=>{
 for(const [sql,params] of [
  ['UPDATE mf_t1c.quote_authorizations SET quote_digest=$2 WHERE intent_id=$1',[intentId,'0x'+'2'.repeat(64)]],
  ['DELETE FROM mf_t1c.quote_authorizations WHERE intent_id=$1',[intentId]],
  ['TRUNCATE mf_t1c.quote_authorizations',[]]
 ]){
  await assert.rejects(()=>pool.query(sql,params),/T1D_ORIGINAL_SIGNED_QUOTE_APPEND_ONLY/);
 }
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM mf_t1c.quote_authorizations')).rows[0].n,1);
});
test('no server received signer private key, live Quote EOA signature or testnet funded assets in PG test',async()=>{
 assert.equal(CHAIN,10143);
 assert.equal(ESCROW,'0xcf0c8827c8610eeff1ecbd9719e559d805fafe58');
 const counters=await pool.query(
  'SELECT (SELECT count(*)::int FROM mf_t1c.wallet_attempts) AS tx,'+
  '(SELECT count(*)::int FROM mf_t1c.intents WHERE stage=$1) AS funded',
  ['FUNDED']
 );
 assert.equal(counters.rows[0].tx,0);
 assert.equal(counters.rows[0].funded,0);
});
