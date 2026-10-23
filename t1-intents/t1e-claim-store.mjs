/**
 * T1-E single original 7 Test USDC voucher Claim persistence.
 * This PG role CAN NOT see T1-D funding or even T1-E Auth.
 * No issuer wallet signing or chain transaction is implemented here.
 */
import {randomBytes,randomUUID} from 'node:crypto';
import {originalVoucherId,FIXED} from './t1e-first-issue-readiness.mjs';
import {MEAL,TERMS,ESCROW,CHAIN,PRICE} from './core.mjs';

export const ORIGINAL_INTENT='2b9ae6f1-2bb7-4096-8136-70f30f302eea';
export const PILOT_RECIPIENT='0x2539fefe77a5ce4d09d2225c2e8a7517b22b9135';
const FIRST_VOUCHER=originalVoucherId(0,1n);
const assert=(ok,why)=>{if(!ok)throw Error(why)};
const eq=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const columns='claim_id,funding_intent,chain_id,escrow,meal_id,terms_hash,unit_seq,generation,voucher_id,beneficiary_wallet,issuer_wallet,consent_nonce,consent_deadline,consent_digest,consent_signature_fingerprint,stage,revision,issuer_op_id,issuer_tx_nonce,issuer_tx_data_hash,issuer_tx_hash,receipt_block,receipt_block_hash';
function validate(row){
 assert(row&&row.funding_intent===ORIGINAL_INTENT&&
  row.chain_id===CHAIN&&eq(row.escrow,ESCROW)&&
  eq(row.meal_id,MEAL)&&eq(row.terms_hash,TERMS)&&
  Number(row.unit_seq)===0&&BigInt(row.generation)===1n&&
  eq(row.voucher_id,FIRST_VOUCHER)&&eq(row.issuer_wallet,FIXED.issuerAuthority)&&
  eq(row.beneficiary_wallet,PILOT_RECIPIENT)&&
  /^0x[0-9a-f]{64}$/.test(row.consent_nonce)&&
  Number.isSafeInteger(Number(row.consent_deadline)),
  'T1E_ORIGINAL_CLAIM_ROW_CHANGED');
 return row;
}
export function publicClaim(row){
 if(!row)return null;
 validate(row);
 return Object.freeze({
  claimId:row.claim_id,
  fundingIntent:row.funding_intent,
  beneficiaryWallet:row.beneficiary_wallet,
  issuerWallet:row.issuer_wallet,
  voucherId:row.voucher_id,
  unitSeq:0,generation:1,amountBaseUnits:PRICE.toString(),
  deadline:String(row.consent_deadline),
  stage:row.stage,revision:Number(row.revision),
  // No personal eligibility data or raw consent signature is stored.
  consentVerified:row.consent_digest!==null,
  issuerTxKnown:row.issuer_tx_hash!==null,
  transactionActionsEnabled:false,
  merchantSettlementEnabled:false
 });
}
export function claimStore(pool){
 assert(pool&&typeof pool.connect==='function'&&typeof pool.query==='function',
  'T1E_CLAIM_POOL_REQUIRED');
 const get=async(client,wallet)=>{
  const result=await client.query(
   'SELECT '+columns+' FROM mf_t1e.recipient_claims WHERE beneficiary_wallet=$1 LIMIT 2',
   [wallet]);
  assert(result.rowCount<=1,'T1E_DUPLICATE_RECIPIENT_CLAIM');
  return result.rows[0]?validate(result.rows[0]):null;
 };
 return {
  async health(){
   const r=await pool.query('SELECT count(*)::integer AS n FROM mf_t1e.recipient_claims');
   return Number.isInteger(r.rows[0].n);
  },
  async own(wallet){
   assert(eq(wallet,PILOT_RECIPIENT),'T1E_PILOT_RECIPIENT_ONLY');
   return get(pool,wallet);
  },
  async issuerReadiness(){
   // Isolated Issuer Session required by HTTP before this method can be called.
   // Do not reveal beneficiary wallet, signature or consent nonce to public.
   const result=await pool.query(
    'SELECT '+columns+' FROM mf_t1e.recipient_claims WHERE funding_intent=$1::uuid LIMIT 2',
    [ORIGINAL_INTENT]);
   assert(result.rowCount<=1,'T1E_MULTIPLE_FIRST_UNIT_CLAIMS');
   if(!result.rows[0])return null;
   const row=validate(result.rows[0]);
   return Object.freeze({
    claimId:row.claim_id,unitSeq:0,generation:1,
    voucherId:row.voucher_id,
    claimStage:row.stage,
    consentVerified:row.stage==='CONSENT_VERIFIED'||
     ['ISSUE_UNKNOWN','ISSUE_HASH_BOUND','ISSUED'].includes(row.stage),
    issuerWallet:row.issuer_wallet,
    onchainIssued:row.stage==='ISSUED',
    issuerTransactionEnabled:false,
    merchantSettlementEnabled:false
   });
  },
  async prepare({wallet,now,proof}){
   assert(eq(wallet,PILOT_RECIPIENT),'T1E_PILOT_RECIPIENT_ONLY');
   assert(Number.isSafeInteger(now)&&now>0,'T1E_CLOCK_INVALID');
   assert(proof&&proof.status==='T1E_ORIGINAL_FUNDED_UNIT_READONLY_ISSUE_GATE_PASS'&&
    proof.chainId===CHAIN&&eq(proof.escrow,ESCROW)&&eq(proof.mealId,MEAL)&&
    proof.firstUnitSequence===0&&proof.nextGeneration===1&&
    proof.issuedOnchain===false&&proof.verifiedFirstBatch===true&&
    proof.accounting?.availableUnits==='1'&&
    proof.accounting?.liabilityBaseUnits===PRICE.toString(),
    'T1E_ORIGINAL_AVAILABLE_UNIT_REQUIRED');
   const c=await pool.connect();
   try{
    await c.query('BEGIN');
    const found=await get(c,wallet);
    if(found){await c.query('COMMIT');return {row:found,created:false}}
    const nonce='0x'+randomBytes(32).toString('hex');
    const id=randomUUID();
    let fresh;
    try{
     const r=await c.query(
      `INSERT INTO mf_t1e.recipient_claims(
       claim_id,funding_intent,chain_id,escrow,meal_id,terms_hash,
       unit_seq,generation,voucher_id,beneficiary_wallet,issuer_wallet,
       consent_nonce,consent_deadline)
       VALUES($1,$2,10143,$3,$4,$5,0,1,$6,$7,$8,$9,$10)
       RETURNING ${columns}`,
      [id,ORIGINAL_INTENT,ESCROW,MEAL,TERMS,FIRST_VOUCHER,
       wallet,FIXED.issuerAuthority,nonce,now+420]);
     assert(r.rowCount===1,'T1E_CLAIM_INSERT_NOT_CONFIRMED');
     fresh=validate(r.rows[0]);
    }catch(e){
     // The first and ONLY original Unit may already have a claim.
     // Roll back and surface a conflict, NEVER mint another nonce.
     if(e?.code==='23505')throw Error('T1E_ORIGINAL_UNIT_ALREADY_CLAIMED');
     throw e;
    }
    await c.query('INSERT INTO mf_t1e.claim_events(claim_id,event_type) VALUES($1,$2)',
     [id,'CLAIM_PREPARED']);
    await c.query('COMMIT');
    return {row:fresh,created:true};
   }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}
   finally{c.release()}
  },
  async verifyConsent({wallet,claimId,digest,fingerprint,now}){
   assert(eq(wallet,PILOT_RECIPIENT)&&typeof claimId==='string'&&
    /^0x[0-9a-f]{64}$/.test(digest)&&
    /^0x[0-9a-f]{64}$/.test(fingerprint)&&
    Number.isSafeInteger(now),'T1E_CONSENT_INPUT_INVALID');
   const c=await pool.connect();
   try{
    await c.query('BEGIN');
    const r=await c.query('SELECT '+columns+
     ' FROM mf_t1e.recipient_claims WHERE claim_id=$1::uuid AND beneficiary_wallet=$2 FOR UPDATE',
     [claimId,wallet]);
    assert(r.rowCount===1,'T1E_CLAIM_NOT_OWNED');
    const old=validate(r.rows[0]);
    assert(old.stage==='PREPARED'&&old.consent_digest===null&&
     BigInt(old.consent_deadline)>BigInt(now+5),
     'T1E_CONSENT_ALREADY_USED_OR_EXPIRED');
    const updated=await c.query(
     `UPDATE mf_t1e.recipient_claims
     SET stage='CONSENT_VERIFIED',consent_digest=$3,
      consent_signature_fingerprint=$4,revision=revision+1
     WHERE claim_id=$1::uuid AND beneficiary_wallet=$2
       AND stage='PREPARED' AND revision=$5 RETURNING ${columns}`,
     [claimId,wallet,digest,fingerprint,old.revision]);
    assert(updated.rowCount===1,'T1E_CONSENT_CAS_CONFLICT');
    await c.query('INSERT INTO mf_t1e.claim_events(claim_id,event_type) VALUES($1,$2)',
     [claimId,'CONSENT_VERIFIED']);
    await c.query('COMMIT');
    return validate(updated.rows[0]);
   }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}
   finally{c.release()}
  }
 };
}
export {FIRST_VOUCHER};
