/**
 * T1-E one original user-FUNDED 7 Test USDC Unit, consent nonce recovery.
 * Strictly isolated mf_t1e_claim_runtime: no T1-D money/Auth access.
 * The original Claim UUID, beneficiary, unit, voucher and first nonce remain
 * immutable; at most THREE consent windows can be issued for that SAME claim.
 * No issuer wallet private key, chain tx, settlement or payment operation.
 */
import {randomBytes,randomUUID} from 'node:crypto';
import {originalVoucherId,FIXED} from './t1e-first-issue-readiness.mjs';
import {MEAL,TERMS,ESCROW,CHAIN,PRICE} from './core.mjs';
export const ORIGINAL_INTENT='2b9ae6f1-2bb7-4096-8136-70f30f302eea';
export const PILOT_RECIPIENT='0x2539fefe77a5ce4d09d2225c2e8a7517b22b9135';
const FIRST_VOUCHER=originalVoucherId(0,1n);
const MAX_CONSENT_ROUNDS=3;
const CHECK=(ok,c)=>{if(!ok)throw Error(c)};
const eq=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const H32=/^0x[0-9a-f]{64}$/;
const columns='claim_id,funding_intent,chain_id,escrow,meal_id,terms_hash,unit_seq,generation,voucher_id,beneficiary_wallet,issuer_wallet,consent_nonce,consent_deadline,consent_digest,consent_signature_fingerprint,stage,revision,issuer_op_id,issuer_tx_nonce,issuer_tx_data_hash,issuer_tx_hash,receipt_block,receipt_block_hash';
function validate(row){
 CHECK(row&&row.funding_intent===ORIGINAL_INTENT&&row.chain_id===CHAIN&&
  eq(row.escrow,ESCROW)&&eq(row.meal_id,MEAL)&&eq(row.terms_hash,TERMS)&&
  Number(row.unit_seq)===0&&BigInt(row.generation)===1n&&
  eq(row.voucher_id,FIRST_VOUCHER)&&eq(row.issuer_wallet,FIXED.issuerAuthority)&&
  eq(row.beneficiary_wallet,PILOT_RECIPIENT)&&
  H32.test(row.consent_nonce)&&Number.isSafeInteger(Number(row.consent_deadline)),
  'T1E_ORIGINAL_CLAIM_ROW_CHANGED');
 return row;
}
function validateRound(round,row){
 CHECK(round&&round.claim_id===row.claim_id&&
  Number.isSafeInteger(Number(round.seq))&&
  Number(round.seq)>=1&&Number(round.seq)<=MAX_CONSENT_ROUNDS&&
  H32.test(round.nonce)&&Number.isSafeInteger(Number(round.deadline))&&
  ['PENDING','EXPIRED','VERIFIED'].includes(round.state),
  'T1E_IMMUTABLE_CONSENT_ROUND_INVALID');
 if(Number(round.seq)===1)
  CHECK(round.nonce===row.consent_nonce&&
   String(round.deadline)===String(row.consent_deadline),
   'T1E_FIRST_CONSENT_NONCE_CHANGED');
 return round;
}
async function get(client,wallet){
 const r=await client.query(
  'SELECT '+columns+' FROM mf_t1e.recipient_claims WHERE beneficiary_wallet=$1 LIMIT 2',
  [wallet]);
 CHECK(r.rowCount<=1,'T1E_DUPLICATE_RECIPIENT_CLAIM');
 if(r.rowCount===0)return null;
 const row=validate(r.rows[0]);
 const q=await client.query(
  `SELECT claim_id,seq,nonce,deadline,state FROM mf_t1e.consent_rounds
   WHERE claim_id=$1::uuid ORDER BY seq DESC LIMIT 2`,[row.claim_id]);
 CHECK(q.rowCount>=1,'T1E_CONSENT_ROUND_MISSING');
 const recent=q.rows[0];
 const round=validateRound(recent,row);
 if(q.rowCount===2)CHECK(Number(q.rows[1].seq)===Number(round.seq)-1,
  'T1E_CONSENT_ROUND_SEQUENCE_GAP');
 return {...row,round};
}
function validateProof(proof){
 CHECK(proof&&proof.status==='T1E_ORIGINAL_FUNDED_UNIT_READONLY_ISSUE_GATE_PASS'&&
  proof.chainId===CHAIN&&eq(proof.escrow,ESCROW)&&eq(proof.mealId,MEAL)&&
  proof.firstUnitSequence===0&&proof.nextGeneration===1&&
  proof.issuedOnchain===false&&proof.verifiedFirstBatch===true&&
  proof.accounting?.availableUnits==='1'&&
  proof.accounting?.liabilityBaseUnits===PRICE.toString(),
  'T1E_ORIGINAL_AVAILABLE_UNIT_REQUIRED');
}
function validWallet(wallet){
 CHECK(eq(wallet,PILOT_RECIPIENT),'T1E_PILOT_RECIPIENT_ONLY');
}
const audit=(c,id,type)=>c.query(
 'INSERT INTO mf_t1e.claim_events(claim_id,event_type) VALUES($1,$2)',[id,type]);
export function publicClaim(row,now=Math.floor(Date.now()/1000)){
 if(!row)return null;
 validate(row);CHECK(row.round,'T1E_CONSENT_ROUND_MISSING');
 const round=validateRound(row.round,row);
 return Object.freeze({
  claimId:row.claim_id,fundingIntent:row.funding_intent,
  beneficiaryWallet:row.beneficiary_wallet,issuerWallet:row.issuer_wallet,
  voucherId:row.voucher_id,unitSeq:0,generation:1,
  amountBaseUnits:PRICE.toString(),stage:row.stage,
  revision:Number(row.revision),deadline:String(round.deadline),
  consentRound:Number(round.seq),consentRoundState:round.state,
  consentNeedsRenewal:row.stage==='PREPARED'&&round.state==='PENDING'&&
   BigInt(round.deadline)<=BigInt(now+5)&&Number(round.seq)<MAX_CONSENT_ROUNDS,
  maxConsentRounds:MAX_CONSENT_ROUNDS,
  consentVerified:row.consent_digest!==null,
  issuerTxKnown:row.issuer_tx_hash!==null,
  transactionActionsEnabled:false,merchantSettlementEnabled:false
 });
}
export function claimStore(pool){
 CHECK(pool&&typeof pool.connect==='function'&&typeof pool.query==='function',
  'T1E_CLAIM_POOL_REQUIRED');
 const own=async wallet=>{validWallet(wallet);return get(pool,wallet)};
 return {
  async health(){
   const [a,b]=await Promise.all([
    pool.query('SELECT count(*)::integer AS n FROM mf_t1e.recipient_claims'),
    pool.query('SELECT count(*)::integer AS n FROM mf_t1e.consent_rounds')
   ]);
   return Number.isInteger(a.rows[0].n)&&Number.isInteger(b.rows[0].n);
  },
  own,
  async issuerReadiness(){
   const r=await pool.query('SELECT '+columns+
    ' FROM mf_t1e.recipient_claims WHERE funding_intent=$1::uuid LIMIT 2',
    [ORIGINAL_INTENT]);
   CHECK(r.rowCount<=1,'T1E_MULTIPLE_FIRST_UNIT_CLAIMS');
   if(!r.rows[0])return null;
   const row=validate(r.rows[0]);
   return Object.freeze({
    claimId:row.claim_id,unitSeq:0,generation:1,
    voucherId:row.voucher_id,claimStage:row.stage,
    consentVerified:row.stage==='CONSENT_VERIFIED'||
     ['ISSUE_UNKNOWN','ISSUE_HASH_BOUND','ISSUED'].includes(row.stage),
    issuerWallet:row.issuer_wallet,onchainIssued:row.stage==='ISSUED',
    issuerTransactionEnabled:false,merchantSettlementEnabled:false
   });
  },
  async prepare({wallet,now,proof}){
   validWallet(wallet);CHECK(Number.isSafeInteger(now)&&now>0,'T1E_CLOCK_INVALID');
   validateProof(proof);
   const c=await pool.connect();
   try{
    await c.query('BEGIN');
    const existing=await get(c,wallet);
    if(existing){await c.query('COMMIT');return {row:existing,created:false}}
    const id=randomUUID(),nonce='0x'+randomBytes(32).toString('hex');
    const deadline=now+420;
    let row;
    try{
     const r=await c.query(
      `INSERT INTO mf_t1e.recipient_claims(
       claim_id,funding_intent,chain_id,escrow,meal_id,terms_hash,
       unit_seq,generation,voucher_id,beneficiary_wallet,issuer_wallet,
       consent_nonce,consent_deadline)
       VALUES($1,$2,10143,$3,$4,$5,0,1,$6,$7,$8,$9,$10)
       RETURNING ${columns}`,
      [id,ORIGINAL_INTENT,ESCROW,MEAL,TERMS,FIRST_VOUCHER,
       wallet,FIXED.issuerAuthority,nonce,deadline]);
     CHECK(r.rowCount===1,'T1E_CLAIM_INSERT_NOT_CONFIRMED');
     row=validate(r.rows[0]);
     await c.query(
      'INSERT INTO mf_t1e.consent_rounds(claim_id,seq,nonce,deadline) VALUES($1,1,$2,$3)',
      [id,nonce,deadline]);
    }catch(e){
     if(e?.code==='23505')throw Error('T1E_ORIGINAL_UNIT_ALREADY_CLAIMED');
     throw e;
    }
    await audit(c,id,'CLAIM_PREPARED');
    await c.query('COMMIT');
    return {row:{...row,round:{
     claim_id:id,seq:1,nonce,deadline:String(deadline),state:'PENDING'
    }},created:true};
   }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}
   finally{c.release()}
  },
  async renew({wallet,now,proof}){
   validWallet(wallet);
   CHECK(Number.isSafeInteger(now)&&now>0,'T1E_CLOCK_INVALID');
   validateProof(proof);
   const c=await pool.connect();
   try{
    await c.query('BEGIN');
    const r=await c.query(
     'SELECT '+columns+
      ' FROM mf_t1e.recipient_claims WHERE funding_intent=$1::uuid AND beneficiary_wallet=$2 FOR UPDATE',
     [ORIGINAL_INTENT,wallet]);
    CHECK(r.rowCount===1,'T1E_CLAIM_NOT_OWNED');
    const row=validate(r.rows[0]);
    CHECK(row.stage==='PREPARED'&&row.consent_digest===null,
     'T1E_CONSENT_ALREADY_CONFIRMED');
    const p=await c.query(
     `SELECT claim_id,seq,nonce,deadline,state
     FROM mf_t1e.consent_rounds WHERE claim_id=$1::uuid
     ORDER BY seq DESC LIMIT 1 FOR UPDATE`,[row.claim_id]);
    CHECK(p.rowCount===1,'T1E_ORIGINAL_CONSENT_ROUND_REQUIRED');
    const old=validateRound(p.rows[0],row);
    CHECK(old.state==='PENDING'&&BigInt(old.deadline)<=BigInt(now),
     'T1E_CONSENT_RENEW_ONLY_AFTER_EXPIRED');
    CHECK(Number(old.seq)<MAX_CONSENT_ROUNDS,'T1E_CONSENT_RETRY_LIMIT');
    const done=await c.query(
     `UPDATE mf_t1e.consent_rounds SET state='EXPIRED'
       WHERE claim_id=$1::uuid AND seq=$2 AND state='PENDING' RETURNING seq`,
     [row.claim_id,old.seq]);
    CHECK(done.rowCount===1,'T1E_CONSENT_EXPIRE_CAS_CONFLICT');
    const nonce='0x'+randomBytes(32).toString('hex'),deadline=now+420;
    const seq=Number(old.seq)+1;
    await c.query(
     'INSERT INTO mf_t1e.consent_rounds(claim_id,seq,nonce,deadline) VALUES($1,$2,$3,$4)',
     [row.claim_id,seq,nonce,deadline]);
    await c.query('COMMIT');
    return {...row,round:{
     claim_id:row.claim_id,seq,nonce,deadline:String(deadline),state:'PENDING'
    }};
   }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}
   finally{c.release()}
  },
  async verifyConsent({wallet,claimId,digest,fingerprint,expectedNonce,now}){
   validWallet(wallet);
   CHECK(typeof claimId==='string'&&H32.test(digest)&&H32.test(fingerprint)&&
    H32.test(expectedNonce)&&Number.isSafeInteger(now),
    'T1E_CONSENT_INPUT_INVALID');
   const c=await pool.connect();
   try{
    await c.query('BEGIN');
    const r=await c.query('SELECT '+columns+
     ' FROM mf_t1e.recipient_claims WHERE claim_id=$1::uuid AND beneficiary_wallet=$2 FOR UPDATE',
     [claimId,wallet]);
    CHECK(r.rowCount===1,'T1E_CLAIM_NOT_OWNED');
    const old=validate(r.rows[0]);
    CHECK(old.stage==='PREPARED'&&old.consent_digest===null,
     'T1E_CONSENT_ALREADY_USED_OR_EXPIRED');
    const p=await c.query(
     `SELECT claim_id,seq,nonce,deadline,state
     FROM mf_t1e.consent_rounds WHERE claim_id=$1::uuid
     ORDER BY seq DESC LIMIT 1 FOR UPDATE`,[claimId]);
    CHECK(p.rowCount===1,'T1E_CONSENT_ROUND_MISSING');
    const round=validateRound(p.rows[0],old);
    CHECK(round.state==='PENDING'&&round.nonce===expectedNonce&&
     BigInt(round.deadline)>BigInt(now+5),
     'T1E_CONSENT_ALREADY_USED_OR_EXPIRED');
    const updated=await c.query(
     `UPDATE mf_t1e.recipient_claims
      SET stage='CONSENT_VERIFIED',consent_digest=$3,
       consent_signature_fingerprint=$4,revision=revision+1
      WHERE claim_id=$1::uuid AND beneficiary_wallet=$2
       AND stage='PREPARED' AND revision=$5 RETURNING ${columns}`,
     [claimId,wallet,digest,fingerprint,old.revision]);
    CHECK(updated.rowCount===1,'T1E_CONSENT_CAS_CONFLICT');
    const used=await c.query(
     `UPDATE mf_t1e.consent_rounds
       SET state='VERIFIED',digest=$3,signature_fingerprint=$4
       WHERE claim_id=$1::uuid AND seq=$2 AND nonce=$5 AND state='PENDING'
       RETURNING seq`,[claimId,round.seq,digest,fingerprint,expectedNonce]);
    CHECK(used.rowCount===1,'T1E_CONSENT_ROUND_CAS_CONFLICT');
    await audit(c,claimId,'CONSENT_VERIFIED');
    await c.query('COMMIT');
    return {...validate(updated.rows[0]),round:{...round,state:'VERIFIED'}};
   }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}
   finally{c.release()}
  }
 };
}
export {FIRST_VOUCHER,MAX_CONSENT_ROUNDS};
