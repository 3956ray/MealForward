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
import {PILOT_RECIPIENT,claimStore} from './t1e-claim-store.mjs';
import {originalIssueLedger,T1F_FIRST_CLAIM} from './t1f-issue-ledger.mjs';
import {FIXED,t0} from './t1e-first-issue-readiness.mjs';
const strict=(x,label)=>assert.equal(x,true,label);
assert.equal(process.env.GITHUB_ACTIONS,'true');
assert.equal(process.env.MF_T1E_DISPOSABLE_ONLY,'ack-fresh-t1e-pg17');
assert.equal(process.env.MF_T1F_DISPOSABLE_ONLY,'ack-fresh-t1f-pg17');
assert.equal(process.env.MF_T1F_REVIEW_DISPOSABLE_ONLY,'ack-fresh-t1f-review-pg17');
assert.equal(process.env.DATABASE_URL,
 'postgres://postgres:t1e-disposable-only@127.0.0.1:5437/postgres');
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
let claimId=randomUUID();const beneficiary=PILOT_RECIPIENT;
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
 await c.query(`CREATE SCHEMA mf_cp31_auth_pilot;
  CREATE TABLE mf_cp31_auth_pilot.sessions(id text);
  CREATE SCHEMA mf_t1d_auth;
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
 const newAuthMigration=await readFile(new URL('./supabase/010_t1e_auth_nologin.sql',import.meta.url),'utf8');
 await c.query(newAuthMigration);
 const recovery=await readFile(new URL('./supabase/011_t1e_consent_nonce_recovery.sql',import.meta.url),'utf8');
 assert.match(recovery,/CREATE UNIQUE INDEX t1e_one_pending_round_per_claim/);
 await c.query(recovery);

 const t1fMigration=await readFile(
  new URL('./supabase/012_t1f_separate_immutable_issuer_deadline.sql',import.meta.url),'utf8');
 assert.match(t1fMigration,/issuer_issue_deadline/);
 assert.ok(!t1fMigration.includes('ALTER ROLE mf_t1d_fund_runtime'));
 assert.ok(!t1fMigration.includes('DROP TABLE mf_t1c.intents'));
 await c.query(t1fMigration);
 const newColumn=await c.query("SELECT column_name FROM information_schema.columns WHERE "+
  "table_schema='mf_t1e' AND table_name='recipient_claims' "+
  "AND column_name='issuer_issue_deadline'");
 assert.equal(newColumn.rowCount,1);
 const perm=(await c.query(
  "SELECT has_column_privilege('mf_t1e_claim_runtime',"+
  "'mf_t1e.recipient_claims','issuer_issue_deadline','UPDATE') AS issuer_deadline,"+
  "has_schema_privilege('mf_t1e_auth_runtime','mf_t1e','USAGE') AS auth_claim,"+
  "has_schema_privilege('mf_t1e_claim_runtime','mf_t1c','USAGE') AS claim_fund"
 )).rows[0];
 assert.deepEqual(perm,{issuer_deadline:true,auth_claim:false,claim_fund:false});
 // Only in this disposable PG17 fixture. Do not touch live Supabase.
 await c.query('SET ROLE mf_t1e_claim_runtime');
 const realNow=Math.floor(Date.now()/1000);
 const consentNonce='0x'+'a'.repeat(64);
 await c.query('INSERT INTO mf_t1e.recipient_claims'+
  '(claim_id,funding_intent,voucher_id,beneficiary_wallet,consent_nonce,consent_deadline) '+
  'VALUES($1::uuid,$2::uuid,$3,$4,$5,$6)',[
  T1F_FIRST_CLAIM,id,voucherId,PILOT_RECIPIENT,consentNonce,realNow+420
 ]);
 await c.query('INSERT INTO mf_t1e.consent_rounds'+
  '(claim_id,seq,nonce,deadline) VALUES($1::uuid,1,$2,$3)',
  [T1F_FIRST_CLAIM,consentNonce,realNow+420]);
 await c.query('INSERT INTO mf_t1e.claim_events(claim_id,event_type)'+
  ' VALUES($1::uuid,\'CLAIM_PREPARED\')',[T1F_FIRST_CLAIM]);
 await c.query("UPDATE mf_t1e.recipient_claims SET stage='CONSENT_VERIFIED',"+
  ' revision=revision+1,consent_digest=$2,consent_signature_fingerprint=$3'+
  ' WHERE claim_id=$1::uuid',[T1F_FIRST_CLAIM,consentDigest,sigHash]);
 await c.query("UPDATE mf_t1e.consent_rounds SET state='VERIFIED',"+
  ' digest=$2,signature_fingerprint=$3 WHERE claim_id=$1::uuid',
  [T1F_FIRST_CLAIM,consentDigest,sigHash]);
 await c.query('INSERT INTO mf_t1e.claim_events(claim_id,event_type)'+
  ' VALUES($1::uuid,\'CONSENT_VERIFIED\')',[T1F_FIRST_CLAIM]);
 const ledger=originalIssueLedger({
  query:(...args)=>c.query(...args),
  connect:async()=>({query:(...args)=>c.query(...args),release(){}})
 });
 const proof={
  status:'T1E_ORIGINAL_FUNDED_UNIT_READONLY_ISSUE_GATE_PASS',
  chainId:10143,escrow,mealId:meal,firstUnitSequence:0,
  nextGeneration:1,unitPrice:'7000000',
  originalIssuerAuthority:FIXED.issuerAuthority,
  originalQuoteUsed:true,verifiedFirstBatch:true,
  issuedOnchain:false,issueSimulatedWithoutSend:true,
  accounting:{availableUnits:'1',liabilityBaseUnits:'7000000',
   escrowBalanceBaseUnits:'7000000'}
 };
 await assert.rejects(
  ()=>ledger.reserve({issuer:PILOT_RECIPIENT,now:realNow,
   issuerPendingNonce:9,chainProof:proof}),/T1F_REGISTERED_ISSUER_SESSION_REQUIRED/
 );
 const r=await ledger.reserve({issuer:FIXED.issuerAuthority,
  issuerPendingNonce:9,chainProof:proof,now:realNow});
 assert.equal(r.created,true);
 assert.equal(r.firstWalletSendPermitted,true);
 assert.equal(r.issueTransaction.to,escrow);
 assert.equal(BigInt(r.issueTransaction.nonce),9n);
 assert.equal(t0.parseTransaction({data:r.issueTransaction.data}).args[5],
  BigInt(realNow+480));

 // The first reservation exists (revision=2), but has not been broadcast.
 await c.query('RESET ROLE');
 const before=(await c.query(
  'SELECT stage,revision,issuer_op_id,issuer_tx_nonce,issuer_tx_data_hash,'+
  'issuer_issue_deadline,issuer_tx_hash FROM mf_t1e.recipient_claims '+
  'WHERE claim_id=$1::uuid',[T1F_FIRST_CLAIM])).rows[0];
 assert.equal(before.stage,'ISSUE_UNKNOWN');
 assert.equal(before.revision,'2');
 assert.equal(before.issuer_tx_nonce,'9');
 assert.equal(before.issuer_tx_hash,null);
 const migration13=await readFile(new URL(
  './supabase/013_t1f_expired_issue_review_only.sql',import.meta.url),'utf8');
 assert.match(migration13,/MANUAL_REVIEW_ONLY_NO_NEW_ISSUE/);
 assert.ok(!migration13.includes('UPDATE mf_t1e.recipient_claims'));
 assert.ok(!migration13.includes('GRANT INSERT'));
 assert.ok(!migration13.includes('eth_sendTransaction'));
 await c.query(migration13);
 assert.equal((await c.query(
  "SELECT to_regclass('mf_t1e.expired_issue_reviews') IS NOT NULL AS review"
 )).rows[0].review,true);

 // Neither Auth nor Claim runtime may author or alter security assessments.
 const grants=(await c.query("SELECT "+
  "has_table_privilege('mf_t1e_claim_runtime','mf_t1e.expired_issue_reviews','INSERT') AS claim_insert,"+
  "has_table_privilege('mf_t1e_claim_runtime','mf_t1e.expired_issue_reviews','UPDATE') AS claim_update,"+
  "has_table_privilege('mf_t1e_claim_runtime','mf_t1e.expired_issue_reviews','SELECT') AS claim_select,"+
  "has_schema_privilege('mf_t1e_auth_runtime','mf_t1e','USAGE') AS auth_schema,"+
  "has_schema_privilege('mf_t1e_claim_runtime','mf_t1c','USAGE') AS funding_schema"
 )).rows[0];
 assert.deepEqual(grants,{
  claim_insert:false,claim_update:false,claim_select:false,
  auth_schema:false,funding_schema:false
 });
 await c.query('SET ROLE mf_t1e_claim_runtime');
 await mustFail(()=>c.query(
  "SELECT * FROM mf_t1e.expired_issue_reviews LIMIT 0"
 ),'42501');
 await mustFail(()=>c.query(
  "INSERT INTO mf_t1e.expired_issue_reviews(review_id,claim_id) VALUES($1,$2)",
  [randomUUID(),T1F_FIRST_CLAIM]
 ),'42501');
 await c.query('RESET ROLE');

 // A synthetic manual reviewer may append exactly one NON-AUTHORIZING
 // observation in this disposable PG17 fixture. No real RPC or wallet used.
 const reviewSql='INSERT INTO mf_t1e.expired_issue_reviews('+
  'review_id,claim_id,original_operation_id,original_issuer_nonce,'+
  'original_deadline,original_calldata_hash,chain_id,'+
  'observed_block_number,observed_block_hash,'+
  'observed_issuer_latest_nonce,observed_issuer_pending_nonce,'+
  'original_operation_seen,original_unit_available,wallet_observation) '+
  'VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,10143,$7,$8,$9,$10,$11,$12,$13)';
 const params=[
  randomUUID(),T1F_FIRST_CLAIM,before.issuer_op_id,before.issuer_tx_nonce,
  before.issuer_issue_deadline,before.issuer_tx_data_hash,
  73645548,'0x'+'c'.repeat(64),9,9,false,true,
  'OWNER_REPORTED_NO_TRANSACTIONS_VISIBLE'
 ];
 await c.query(reviewSql,params);
 const caseRow=(await c.query(
  'SELECT review_state,may_create_second_operation,'+
  'may_broadcast_transaction,may_modify_original_claim,'+
  'wallet_observation_is_mempool_proof FROM mf_t1e.expired_issue_reviews'
 )).rows[0];
 assert.deepEqual(caseRow,{
  review_state:'MANUAL_REVIEW_ONLY_NO_NEW_ISSUE',
  may_create_second_operation:false,
  may_broadcast_transaction:false,
  may_modify_original_claim:false,
  wallet_observation_is_mempool_proof:false
 });
 await mustFail(()=>c.query(reviewSql,[randomUUID(),...params.slice(1)]),'23505');
 await mustFail(()=>c.query(reviewSql,[randomUUID(),T1F_FIRST_CLAIM,
  '0x'+'f'.repeat(64),...params.slice(3)]),'P0001');
 await mustFail(()=>c.query(
  "UPDATE mf_t1e.expired_issue_reviews SET wallet_observation='OWNER_ACTIVITY_NOT_CHECKED'"
 ),'P0001');
 await mustFail(()=>c.query(
  'DELETE FROM mf_t1e.expired_issue_reviews'
 ),'P0001');
 await mustFail(()=>c.query(
  'TRUNCATE mf_t1e.expired_issue_reviews'
 ),'P0001');
 const after=(await c.query(
  'SELECT stage,revision,issuer_op_id,issuer_tx_nonce,issuer_tx_data_hash,'+
  'issuer_issue_deadline,issuer_tx_hash FROM mf_t1e.recipient_claims '+
  'WHERE claim_id=$1::uuid',[T1F_FIRST_CLAIM])).rows[0];
 assert.deepEqual(after,before,'original reservation must remain byte-identical');
 assert.equal((await c.query(
  "SELECT count(*)::int AS n FROM mf_t1c.intents WHERE stage='FUNDED'"
 )).rows[0].n,1);
 assert.deepEqual((await c.query(
  'SELECT event_type FROM mf_t1e.claim_events ORDER BY event_id'
 )).rows.map(x=>x.event_type),[
  'CLAIM_PREPARED','CONSENT_VERIFIED','ISSUE_RESERVED'
 ]);
 console.log(JSON.stringify({
  status:'T1F_DISPOSABLE_PG17_APPEND_ONLY_RECOVERY_REVIEW_PASS',
  noRealSupabase:true,noRealWallet:true,noOnchainRPC:true,
  originalIssuerNonceUnchanged:true,originalClaimStageUnchanged:true,
  noNewOperationId:true,noNewIssueAllowed:true,
  originalFundAndConsentPreserved:true,
  runtimeReviewWritesDenied:true,reviewEvidenceImmutable:true,
  originalIssueReservations:1,syntheticReviewRecords:1
 }));
}finally{await c.end().catch(()=>{})}
