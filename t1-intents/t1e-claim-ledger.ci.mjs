/**
 * Execute EXACT T1-E 009 SQL on an entirely NEW dockerized PG17 database.
 * CI-only; cannot connect to Supabase, Render, Mac CP30 or any chain RPC.
 * Tests one original FUNDED fixture -> immutable claim lifecycle, replay
 * rejection, bounded role privileges and appendix-only forensics.
 */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {originalVoucherId} from './t1e-first-issue-readiness.mjs';
const strict=(x,label)=>assert.equal(x,true,label);
assert.equal(process.env.GITHUB_ACTIONS,'true');
assert.equal(process.env.MF_T1E_DISPOSABLE_ONLY,'ack-fresh-t1e-pg17');
assert.equal(process.env.DATABASE_URL,
 'postgres://postgres:t1e-disposable-only@127.0.0.1:5435/postgres');
const c=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000});
const id='2b9ae6f1-2bb7-4096-8136-70f30f302eea';
const payer='0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952';
const quote='0xd19b6ca862dc452dd13246bac6faba2d024ba7c59add7e614c6d3b9b54421e12';
const meal='0x44f977bbf22112030199e42ccf232d08fe6e8223be9c274944c8a40671f6ae6b';
const terms='0x0ec28ec279f5a4b4321da6d4b1698fea8e57cd8a64743de02677c73cb86a9222';
const escrow='0xcf0c8827c8610eeff1ecbd9719e559d805fafe58';
const token='0x534b2f3a21130d7a60830c2df862319e593943a3';
const aHash='0x0b5ef56afe4e8ffcba6349b7893929231213a130896a7810d5f428723b4a218d';
const fHash='0x6d241844fc0edda40af1c30eceab11ac0b95057337218de21e0c4026954ce219';
const blockA='0x65e25481798e882a51c96cd07457639566d4047d5c595c189c60419d67857dd3';
const blockF='0xe90a0e084d9b83e6063c04a2e831158d53173c77c6cd2e240551257587c80b9e';
const claimId=randomUUID(),beneficiary='0x'+'7'.repeat(40);
const voucherId=originalVoucherId(0,1n);
const nonce='0x'+'a'.repeat(64);
const consentDigest='0x'+'b'.repeat(64),sigHash='0x'+'c'.repeat(64);
const opId='0x'+'d'.repeat(64),dataHash='0x'+'e'.repeat(64);
const issueTxHash='0x'+'f'.repeat(64);
async function mustFail(action,code){
 await assert.rejects(action,error=>error?.code===code,
  'expected SQLSTATE '+code);
}
try{
 await c.connect();
 const head=(await c.query(
  "SELECT current_database() AS db,current_setting('server_version_num')::int AS version,"+
  "to_regnamespace('mf_t1c') IS NULL AS empty"
 )).rows[0];
 assert.equal(head.db,'postgres');
 strict(head.version>=170000&&head.version<180000,'Postgres17');
 strict(head.empty,'fresh database required');
 await c.query(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
 await c.query(`CREATE SCHEMA mf_t1d_auth;
  CREATE TABLE mf_t1d_auth.sessions (id text PRIMARY KEY);
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN;
  CREATE ROLE mf_t1c_auth_runtime NOLOGIN NOBYPASSRLS;
  CREATE ROLE mf_t1c_intent_runtime NOLOGIN NOBYPASSRLS;
  CREATE ROLE mf_t1d_auth_runtime NOLOGIN NOBYPASSRLS;
  CREATE ROLE mf_t1d_fund_runtime NOLOGIN NOBYPASSRLS;
  GRANT USAGE ON SCHEMA mf_t1c TO mf_t1c_intent_runtime;
  GRANT SELECT ON mf_t1c.intents TO mf_t1c_intent_runtime;`);
 await c.query(`INSERT INTO mf_t1c.intents(
  intent_id,payer,idempotency_key,quote_id,meal_id,terms_hash,
  version,quantity,unit_price,amount,quote_deadline,
  quote_digest,quote_signature_hash,stage,revision
 ) VALUES($1,$2,$3,$4,$5,$6,1,1,7000000,7000000,1792724422,
   $7,$8,'FUNDED',5)`,[
  id,payer,randomUUID(),quote,meal,terms,
  '0xad03e29d0d3b8e97f73710822961c5162cde1cdcfc4b034b63c1a566fb14a31a',
  '0x5ec41ebeb6899d36393b9a4ecdfc1c66b7e6b15f21b39652ab1b2a629111a885'
 ]);
 for(const [kind,txTo,txNonce,txHash,block,blockHash] of [
  ['approve',token,7,aHash,73410402,blockA],
  ['fund',escrow,8,fHash,73410628,blockF]
 ]){
  await c.query(`INSERT INTO mf_t1c.wallet_attempts(
   intent_id,kind,chain_id,payer,tx_to,tx_data_hash,tx_nonce,
   tx_hash,status,receipt_block,receipt_block_hash,receipt_status
  ) VALUES($1,$2,10143,$3,$4,$5,$6,$7,'CONFIRMED',$8,$9,1)`,
   [id,kind,payer,txTo,'0x'+'1'.repeat(64),txNonce,txHash,block,blockHash]);
 }
 const migration=await readFile(new URL('./supabase/009_t1e_first_recipient_issue_ledger.sql',import.meta.url),'utf8');
 assert.match(migration,/CREATE ROLE mf_t1e_claim_runtime NOLOGIN/);
 assert.ok(!migration.includes('ALTER ROLE mf_t1d_fund_runtime'));
 assert.ok(!migration.includes('DROP SCHEMA mf_t1c'));
 await c.query(migration);
 const p=(await c.query(`SELECT
  (SELECT rolcanlogin FROM pg_roles WHERE rolname='mf_t1e_claim_runtime') AS login,
  has_table_privilege('mf_t1e_claim_runtime','mf_t1e.recipient_claims','SELECT') AS can_read,
  has_table_privilege('mf_t1e_claim_runtime','mf_t1e.recipient_claims','INSERT') AS can_insert,
  has_column_privilege('mf_t1e_claim_runtime','mf_t1e.recipient_claims','stage','UPDATE') AS can_stage,
  has_column_privilege('mf_t1e_claim_runtime','mf_t1e.recipient_claims','beneficiary_wallet','UPDATE') AS can_rewrite_beneficiary,
  has_table_privilege('mf_t1e_claim_runtime','mf_t1e.recipient_claims','DELETE') AS can_delete,
  has_schema_privilege('mf_t1e_claim_runtime','mf_t1c','USAGE') AS can_finance,
  has_schema_privilege('mf_t1d_fund_runtime','mf_t1e','USAGE') AS fund_can_claim,
  has_schema_privilege('mf_t1d_auth_runtime','mf_t1e','USAGE') AS auth_can_claim,
  has_table_privilege('mf_t1e_claim_runtime','mf_t1e.claim_events','INSERT') AS can_audit`)).rows[0];
 assert.deepEqual(p,{
  login:false,can_read:true,can_insert:true,can_stage:true,
  can_rewrite_beneficiary:false,can_delete:false,can_finance:false,
  fund_can_claim:false,auth_can_claim:false,can_audit:true
 });
 // SET ROLE is allowed to superuser in disposable Docker even when
 // the actual T1-E role is NOLOGIN. It reduces all privileges.
 await c.query('SET ROLE mf_t1e_claim_runtime');
 await mustFail(()=>c.query('SELECT * FROM mf_t1c.intents LIMIT 0'),'42501');
 await mustFail(()=>c.query('SELECT * FROM mf_t1d_auth.sessions LIMIT 0'),'42501');
 await c.query(`INSERT INTO mf_t1e.recipient_claims(
 claim_id,funding_intent,voucher_id,beneficiary_wallet,consent_nonce,consent_deadline
 ) VALUES($1,$2,$3,$4,$5,$6)`,
  [claimId,id,voucherId,beneficiary,nonce,1792740000+480]);
 await c.query(`INSERT INTO mf_t1e.claim_events(claim_id,event_type)
  VALUES($1,'CLAIM_PREPARED')`,[claimId]);
 // The first funded unit may be reserved only once, even with a new UUID.
 await mustFail(()=>c.query(`INSERT INTO mf_t1e.recipient_claims(
  claim_id,funding_intent,voucher_id,beneficiary_wallet,consent_nonce,consent_deadline
 ) VALUES($1,$2,$3,$4,$5,$6)`,
  [randomUUID(),id,'0x'+'7'.repeat(64),'0x'+'8'.repeat(40),'0x'+'9'.repeat(64),1792740480]),
 '23505');
 await mustFail(()=>c.query(`UPDATE mf_t1e.recipient_claims
 SET beneficiary_wallet=$2,revision=revision+1 WHERE claim_id=$1`,
  [claimId,'0x'+'8'.repeat(40)]),'42501');
 // The SQL stage machine never allows an Issuer operation before
 // the independent recipient EIP712 signature has been verified.
 await mustFail(()=>c.query(`UPDATE mf_t1e.recipient_claims
 SET stage='ISSUE_UNKNOWN',revision=revision+1,
 issuer_op_id=$2,issuer_tx_nonce=9,issuer_tx_data_hash=$3
 WHERE claim_id=$1`,[claimId,opId,dataHash]),'P0001');
 await c.query(`UPDATE mf_t1e.recipient_claims SET
  stage='CONSENT_VERIFIED',consent_digest=$2,consent_signature_fingerprint=$3,
  revision=revision+1 WHERE claim_id=$1`,[claimId,consentDigest,sigHash]);
 await c.query(`INSERT INTO mf_t1e.claim_events(claim_id,event_type)
  VALUES($1,'CONSENT_VERIFIED')`,[claimId]);
 await c.query(`UPDATE mf_t1e.recipient_claims SET
  stage='ISSUE_UNKNOWN',issuer_op_id=$2,issuer_tx_nonce=9,issuer_tx_data_hash=$3,
  revision=revision+1 WHERE claim_id=$1`,[claimId,opId,dataHash]);
 await mustFail(()=>c.query(`UPDATE mf_t1e.recipient_claims SET
  issuer_tx_nonce=10,stage='ISSUE_HASH_BOUND',issuer_tx_hash=$2,
  revision=revision+1 WHERE claim_id=$1`,[claimId,issueTxHash]),'P0001');
 await c.query(`UPDATE mf_t1e.recipient_claims SET
  stage='ISSUE_HASH_BOUND',issuer_tx_hash=$2,revision=revision+1
  WHERE claim_id=$1`,[claimId,issueTxHash]);
 await mustFail(()=>c.query(`UPDATE mf_t1e.recipient_claims SET
  issuer_tx_hash=$2,stage='ISSUED',receipt_block=73420000,
  receipt_block_hash=$3,revision=revision+1 WHERE claim_id=$1`,
  [claimId,'0x'+'a'.repeat(64),blockF]),'P0001');
 await c.query(`UPDATE mf_t1e.recipient_claims SET
  stage='ISSUED',receipt_block=73420000,receipt_block_hash=$2,
  revision=revision+1 WHERE claim_id=$1`,[claimId,blockF]);
 await c.query(`INSERT INTO mf_t1e.claim_events(claim_id,event_type,original_tx_hash)
  VALUES($1,'ISSUE_CONFIRMED',$2)`,[claimId,issueTxHash]);
 await mustFail(()=>c.query(`UPDATE mf_t1e.recipient_claims
  SET stage='BLOCKED',revision=revision+1 WHERE claim_id=$1`,[claimId]),'P0001');
 await mustFail(()=>c.query('DELETE FROM mf_t1e.recipient_claims WHERE claim_id=$1',[claimId]),'42501');
 await mustFail(()=>c.query('TRUNCATE mf_t1e.recipient_claims'),'42501');
 await mustFail(()=>c.query('DELETE FROM mf_t1e.claim_events WHERE claim_id=$1',[claimId]),'42501');
 await c.query('RESET ROLE');
 const snapshot=(await c.query(`SELECT stage,revision,issuer_tx_nonce,issuer_tx_hash,receipt_block
 FROM mf_t1e.recipient_claims WHERE claim_id=$1`,[claimId])).rows[0];
 assert.deepEqual(snapshot,{stage:'ISSUED',revision:'4',issuer_tx_nonce:'9',
  issuer_tx_hash:issueTxHash,receipt_block:'73420000'});
 assert.equal((await c.query('SELECT count(*)::int AS n FROM mf_t1e.claim_events')).rows[0].n,3);
 console.log(JSON.stringify({
  status:'T1E_EXACT_PRIVATE_RECIPIENT_LEDGER_PG17_PASS',
  roleIsNoLogin:true,oldT1CFundAuthDenied:true,
  onlyOneFirstUnitClaim:true,differentBeneficiaryCannotReplace:true,
  consentBeforeIssueReserved:true,originalNonceCannotChange:true,
  originalTransactionHashCannotChange:true,appendOnlyClaimEvents:true,
  noLiveDatabaseConnected:true,realVoucherIssued:false,
  onchainTransactionsSent:0
 }));
}finally{await c.end().catch(()=>{})}
