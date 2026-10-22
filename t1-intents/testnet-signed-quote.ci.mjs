/**
 * T1-D signed FundingQuote atomicity and crash recovery on disposable PG17.
 * Real original source & exact 006/007 SQL, CI-only synthetic EOA, no real
 * MetaMask prompts, no cloud secrets and NO onchain transactions.
 */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {Wallet,keccak256} from 'ethers';
import {
 createT1IntentLedger,CHAIN,ESCROW,QUOTE,MEAL,TERMS,PRICE,
 signatureDomain,quoteTypes
} from './core.mjs';

const LOCAL='postgres://postgres:t1c-disposable-only@127.0.0.1:5433/postgres';
assert.equal(process.env.GITHUB_ACTIONS,'true','GITHUB_ACTIONS_ONLY');
assert.equal(process.env.MF_T1C_DISPOSABLE_ONLY,'ack-fresh-t1c-postgres17','DISPOSABLE_ONLY');
assert.equal(process.env.MF_T1C_HTTP_DISPOSABLE_ONLY,'ack-original-siwe-pg17','DISPOSABLE_HTTP_ONLY');
assert.equal(process.env.DATABASE_URL,
 'postgres://postgres:t1c-disposable-only@127.0.0.1:5433/mf_t1c_http_ci',
 'DISPOSABLE_PG_PORT_REQUIRED');

const pool=new pg.Pool({connectionString:LOCAL,max:5});
const payer=Wallet.createRandom();
const intruder=Wallet.createRandom();
const signer=Wallet.createRandom(); // disposable only, NEVER the real Quote Authority
const principal=async who=>({
 verified:true,source:'TESTNET_WALLET_AUTHORITY',
 address:who==='payer'?payer.address:intruder.address
});
const makeLedger=()=>createT1IntentLedger({
 pool,resolveWallet:principal,quoteAuthority:signer.address,
 persistSignedQuotes:true
});
const prepare=ledger=>ledger.prepare({
 session:'payer',idempotencyKey:randomUUID(),quantity:1
});
const sign=quote=>signer.signTypedData(signatureDomain,quoteTypes,quote);

try{
 const pgVersion=await pool.query('SHOW server_version_num');
 assert.equal(Math.floor(Number(pgVersion.rows[0].server_version_num)/10000),17);
 const table=await pool.query("SELECT to_regclass('mf_t1c.quote_authorizations') AS t");
 assert.equal(table.rows[0].t,'mf_t1c.quote_authorizations');
 const ledger=makeLedger();
 const prepared=await prepare(ledger);
 assert.equal(prepared.stage,'PREPARED');
 assert.equal(prepared.amount,PRICE.toString());
 assert.equal(prepared.unsignedQuote.currentVersion,1n);
 const signed=await sign(prepared.unsignedQuote);

 // Exercise a forced insert failure after the Intent UPDATE: the entire
 // original stage transition (including audit) MUST roll back atomically.
 const failing=await prepare(ledger);
 const failingSig=await sign(failing.unsignedQuote);
 assert.match(failing.intentId,/^[0-9a-f-]{36}$/i);
 await pool.query(
  "ALTER TABLE mf_t1c.quote_authorizations ADD CONSTRAINT t1d_ci_atomic_reject "+
  "CHECK (intent_id <> '"+failing.intentId+"'::uuid)"
 );
 try{
  await assert.rejects(
   ()=>ledger.bindQuote({session:'payer',intentId:failing.intentId,signature:failingSig}),
   e=>e.code==='23514'
  );
  const unchanged=await ledger.fetchOriginal({
   session:'payer',intentId:failing.intentId
  });
  assert.equal(unchanged.stage,'PREPARED');
  assert.equal(unchanged.quoteDigest,null);
  assert.equal((await pool.query(
   "SELECT count(*)::int AS n FROM mf_t1c.audit_events WHERE intent_id=$1 "+
   "AND event_type='QUOTE_BOUND'",[failing.intentId]
  )).rows[0].n,0);
 }finally{
  await pool.query('ALTER TABLE mf_t1c.quote_authorizations DROP CONSTRAINT t1d_ci_atomic_reject');
 }

 const result=await ledger.bindQuote({
  session:'payer',intentId:prepared.intentId,signature:signed
 });
 assert.equal(result.stage,'QUOTE_BOUND');
 assert.equal(result.quoteSignatureFingerprint.toLowerCase(),keccak256(signed).toLowerCase());

 // Payer only; a completely different authenticated wallet receives
 // no signature and cannot re-authorize or fetch the original Intent.
 await assert.rejects(
  ()=>ledger.recoverSignedQuote({session:'intruder',intentId:prepared.intentId}),
  /SIGNED_QUOTE_NOT_FOUND/
 );
 await assert.rejects(
  ()=>ledger.fetchOriginal({session:'intruder',intentId:prepared.intentId}),
  /INTENT_NOT_FOUND/
 );
 const recovered=await makeLedger().recoverSignedQuote({
  session:'payer',intentId:prepared.intentId
 });
 assert.equal(recovered.signature.toLowerCase(),signed.toLowerCase());
 assert.equal(recovered.quoteId,prepared.quoteId);
 assert.equal(recovered.restoredFromOriginalPostgres,true);
 assert.equal(recovered.quoteSignatureFingerprint.toLowerCase(),keccak256(signed).toLowerCase());

 // Re-signing an immutable original quote or rewriting the signed table
 // is rejected; restart uses the SAME persistent Intent and signature.
 await assert.rejects(()=>ledger.bindQuote({
  session:'payer',intentId:prepared.intentId,signature:signed
 }),/QUOTE_ALREADY_BOUND_OR_IN_FLIGHT/);
 await assert.rejects(
  ()=>pool.query("UPDATE mf_t1c.quote_authorizations SET signature=$2 WHERE intent_id=$1",
   [prepared.intentId,'0x'+'a'.repeat(130)]),
  /T1D_ORIGINAL_SIGNED_QUOTE_APPEND_ONLY/
 );
 await assert.rejects(
  ()=>pool.query('DELETE FROM mf_t1c.quote_authorizations WHERE intent_id=$1',
   [prepared.intentId]),
  /T1D_ORIGINAL_SIGNED_QUOTE_APPEND_ONLY/
 );

 // The signed quote remains restricted to its original one-meal fixed
 // Testnet contract; the EOA fixture exists only within GitHub Docker.
 assert.equal(CHAIN,10143);assert.ok(ESCROW.startsWith('0xcf0c88'));
 assert.equal(MEAL.length,66);assert.equal(TERMS.length,66);assert.equal(QUOTE.length,42);
 const attempts=await pool.query(
  'SELECT count(*)::int AS n FROM mf_t1c.wallet_attempts'
 );
 assert.equal(attempts.rows[0].n,0);
 console.log(JSON.stringify({
  status:'T1D_ATOMIC_SIGNED_QUOTE_AND_PAYER_ONLY_CRASH_RECOVERY_PG17_PASS',
  immutableOneMealAmount:PRICE.toString(),
  writerOnlySqlMigrated:true,
  otherWalletDenied:true,
  rollbackPreservedPrepared:true,
  originalSignatureSurvivesSecondLedgerInstance:true,
  realOnchainTransactionsSent:0
 }));
}finally{await pool.end()}
