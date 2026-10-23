/**
 * T1-F ORIGINAL one-voucher issuance ledger, using the independent existing
 * mf_t1e_claim_runtime role. No signer key, no backend broadcast, no auto
 * retry. The only sendable transaction is returned AFTER ISSUE_UNKNOWN and
 * its unique nonce/op/calldata/deadline are committed to Postgres.
 */
import {randomBytes} from 'node:crypto';
import {keccak256} from 'ethers';
import {FIXED} from './t1e-first-issue-readiness.mjs';
import {CHAIN,ESCROW} from './core.mjs';
import {
 proposeOriginalIssuerOperation,rebuildReservedIssuerTransaction,
 verifyOriginalIssuerReceipt
} from './t1f-issue-operation.mjs';

export const T1F_FIRST_CLAIM='fbab3b22-965d-44e2-b144-d7307b7aa8ea';
const FIRST_INTENT='2b9ae6f1-2bb7-4096-8136-70f30f302eea';
const eq=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const strict=(v,code)=>{if(!v)throw Error(code)};
const H32=/^0x[0-9a-f]{64}$/i;
const n=x=>{try{return BigInt(x)}catch{throw Error('T1F_NONCE_INVALID')}};
const COLS='claim_id,funding_intent,chain_id,escrow,meal_id,terms_hash,'+
 'unit_seq,generation,voucher_id,beneficiary_wallet,issuer_wallet,'+
 'consent_nonce,consent_deadline,consent_digest,consent_signature_fingerprint,'+
 'stage,revision,issuer_op_id,issuer_tx_nonce,issuer_tx_data_hash,'+
 'issuer_issue_deadline,issuer_tx_hash,receipt_block,receipt_block_hash';
const safeStatus=row=>Object.freeze({
 claimId:row.claim_id,stage:row.stage,voucherId:row.voucher_id,
 originalOperationId:row.issuer_op_id,
 originalNonce:row.issuer_tx_nonce===null?null:String(row.issuer_tx_nonce),
 issuerDeadline:row.issuer_issue_deadline===null?null:String(row.issuer_issue_deadline),
 originalTxHash:row.issuer_tx_hash,
 receiptBlock:row.receipt_block===null?null:String(row.receipt_block),
 sendAgainPermitted:false,settlementEnabled:false,
 onchainRecipientConsentEnforced:false
});

export function originalIssueLedger(pool){
 strict(pool?.query&&pool?.connect,'T1F_PRIVATE_CLAIM_POOL_REQUIRED');
 const requireIssuer=wallet=>strict(eq(wallet,FIXED.issuerAuthority),
  'T1F_REGISTERED_ISSUER_SESSION_REQUIRED');
 const read=async(client,lock=false)=>{
  const r=await client.query(
   'SELECT '+COLS+' FROM mf_t1e.recipient_claims WHERE claim_id=$1::uuid'+
    (lock?' FOR UPDATE':''),
   [T1F_FIRST_CLAIM]);
  strict(r.rowCount===1,'T1F_ORIGINAL_CLAIM_NOT_FOUND');
  const row=r.rows[0];
  strict(row.claim_id===T1F_FIRST_CLAIM&&row.funding_intent===FIRST_INTENT&&
   eq(row.issuer_wallet,FIXED.issuerAuthority)&&
   Number(row.unit_seq)===0&&Number(row.generation)===1,
   'T1F_ORIGINAL_FUNDED_ONE_UNIT_IDENTITY_CHANGED');
  return row;
 };
 const consent=async(c,row)=>{
  const r=await c.query(
   'SELECT state,digest,signature_fingerprint FROM mf_t1e.consent_rounds'+
   ' WHERE claim_id=$1::uuid ORDER BY seq DESC LIMIT 1',[row.claim_id]);
  strict(r.rowCount===1&&r.rows[0].state==='VERIFIED'&&
   H32.test(row.consent_digest||'')&&
   H32.test(row.consent_signature_fingerprint||'')&&
   eq(r.rows[0].digest,row.consent_digest)&&
   eq(r.rows[0].signature_fingerprint,row.consent_signature_fingerprint),
   'T1F_DURABLE_RECIPIENT_CONSENT_NOT_VERIFIED');
 };
 return Object.freeze({
  async status({issuer}){
   requireIssuer(issuer);
   return safeStatus(await read(pool));
  },
  async reserve({issuer,now,issuerPendingNonce,chainProof}){
   requireIssuer(issuer);
   strict(Number.isSafeInteger(now)&&now>0,'T1F_ISSUE_CLOCK_INVALID');
   const nonce=n(issuerPendingNonce);
   strict(nonce>=0n&&nonce<=BigInt(Number.MAX_SAFE_INTEGER),
    'T1F_INVALID_ORIGINAL_PENDING_NONCE');
   const c=await pool.connect();
   try{
    await c.query('BEGIN');
    const row=await read(c,true);
    if(row.stage!=='CONSENT_VERIFIED'){
     strict(['ISSUE_UNKNOWN','ISSUE_HASH_BOUND','ISSUED'].includes(row.stage),
      'T1F_ORIGINAL_CLAIM_NOT_READY');
     await c.query('COMMIT');
     return {created:false,state:safeStatus(row),
      recoveryOnly:true,sendAgainPermitted:false};
    }
    await consent(c,row);
    const opId='0x'+randomBytes(32).toString('hex');
    const expiry=now+480;
    const proposed=proposeOriginalIssuerOperation({
     claim:row,operationId:opId,
     issuerPendingNonce:nonce,issuerDeadline:expiry,chainProof,now
    });
    const saved=await c.query(
     'UPDATE mf_t1e.recipient_claims SET stage=\'ISSUE_UNKNOWN\','+
      ' revision=revision+1,issuer_op_id=$2,issuer_tx_nonce=$3,'+
      ' issuer_tx_data_hash=$4,issuer_issue_deadline=$5'+
      ' WHERE claim_id=$1::uuid AND stage=\'CONSENT_VERIFIED\''+
      ' AND revision=$6 RETURNING '+COLS,
     [T1F_FIRST_CLAIM,opId,nonce.toString(),
      proposed.issuerCalldataHash,String(expiry),row.revision]);
    strict(saved.rowCount===1,'T1F_ISSUE_ATOMIC_CAS_FAILURE');
    await c.query(
     'INSERT INTO mf_t1e.claim_events(claim_id,event_type)'+
     ' VALUES($1::uuid,\'ISSUE_RESERVED\')',[T1F_FIRST_CLAIM]);
    await c.query('COMMIT');
    return {created:true,state:safeStatus(saved.rows[0]),
     issueTransaction:proposed.transaction,firstWalletSendPermitted:true,
     serverMaySignOrBroadcast:false,sendAgainPermitted:false};
   }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}
   finally{c.release()}
  },
  async bind({issuer,txHash,rpc}){
   requireIssuer(issuer);
   strict(typeof txHash==='string'&&H32.test(txHash),
    'T1F_ORIGINAL_TRANSACTION_HASH_REQUIRED');
   strict(typeof rpc?.send==='function','T1F_READONLY_RPC_REQUIRED');
   const row=await read(pool);
   if(row.stage==='ISSUE_HASH_BOUND'||row.stage==='ISSUED'){
    strict(eq(row.issuer_tx_hash,txHash),
     'T1F_DIFFERENT_TRANSACTION_HASH_FORBIDDEN');
    return {alreadyBound:true,state:safeStatus(row)};
   }
   strict(row.stage==='ISSUE_UNKNOWN','T1F_ORIGINAL_NONCE_NOT_RESERVED');
   // Never bind an arbitrary submitted hash. The independent read-only RPC
   // must prove exact sender, calldata, nonce, destination, value, chain.
   const [chain,tx]=await Promise.all([
    rpc.send('eth_chainId',[]),rpc.send('eth_getTransactionByHash',[txHash])
   ]);
   strict(n(chain)===BigInt(CHAIN),'T1F_WRONG_CHAIN');
   strict(tx,'T1F_ORIGINAL_TRANSACTION_NOT_INDEXED');
   const rebuilt=rebuildReservedIssuerTransaction({claim:row});
   strict(eq(tx.hash,txHash)&&eq(tx.from,issuer)&&eq(tx.to,ESCROW)&&
    n(tx.nonce)===n(row.issuer_tx_nonce)&&
    n(tx.value??'0')===0n&&
    (tx.chainId==null||n(tx.chainId)===BigInt(CHAIN))&&
    eq(keccak256(tx.input??tx.data),keccak256(rebuilt.data)),
    'T1F_BOUND_TRANSACTION_MISMATCH');
   const c=await pool.connect();
   try{
    await c.query('BEGIN');
    const locked=await read(c,true);
    strict(locked.stage==='ISSUE_UNKNOWN'&&
     eq(locked.issuer_op_id,row.issuer_op_id)&&
     n(locked.issuer_tx_nonce)===n(row.issuer_tx_nonce)&&
     eq(locked.issuer_tx_data_hash,row.issuer_tx_data_hash),
     'T1F_ORIGINAL_RESERVATION_CHANGED');
    const saved=await c.query(
     'UPDATE mf_t1e.recipient_claims SET stage=\'ISSUE_HASH_BOUND\','+
     ' issuer_tx_hash=$2,revision=revision+1'+
     ' WHERE claim_id=$1::uuid AND stage=\'ISSUE_UNKNOWN\''+
     ' AND issuer_tx_hash IS NULL AND revision=$3 RETURNING '+COLS,
     [T1F_FIRST_CLAIM,txHash.toLowerCase(),locked.revision]);
    strict(saved.rowCount===1,'T1F_ORIGINAL_HASH_CAS_FAILED');
    await c.query(
     'INSERT INTO mf_t1e.claim_events(claim_id,event_type,original_tx_hash)'+
     ' VALUES($1::uuid,\'ISSUE_HASH_BOUND\',$2)',
     [T1F_FIRST_CLAIM,txHash.toLowerCase()]);
    await c.query('COMMIT');
    return {alreadyBound:false,state:safeStatus(saved.rows[0])};
   }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}
   finally{c.release()}
  },
  async reconcile({issuer,rpc,now}){
   requireIssuer(issuer);
   strict(typeof rpc?.send==='function','T1F_READONLY_RPC_REQUIRED');
   const row=await read(pool);
   if(row.stage==='ISSUED')return {alreadyIssued:true,state:safeStatus(row)};
   strict(row.stage==='ISSUE_HASH_BOUND','T1F_ORIGINAL_HASH_NOT_BOUND');
   const proof=await verifyOriginalIssuerReceipt({claim:row,rpc,now});
   if(proof.status!=='T1F_ORIGINAL_ISSUED_RECEIPT_INDEPENDENTLY_CONFIRMED')
    return {state:safeStatus(row),proof,sendAgainPermitted:false};
   strict(eq(proof.voucherId,row.voucher_id)&&
    eq(proof.originalTxHash,row.issuer_tx_hash),
    'T1F_CANONICAL_RECEIPT_OR_VOUCHER_CHANGED');
   const c=await pool.connect();
   try{
    await c.query('BEGIN');
    const locked=await read(c,true);
    strict(locked.stage==='ISSUE_HASH_BOUND'&&
     eq(locked.issuer_tx_hash,proof.originalTxHash),
     'T1F_ORIGINAL_RECEIPT_CONCURRENT_UPDATE');
    const res=await c.query(
     'UPDATE mf_t1e.recipient_claims SET stage=\'ISSUED\','+
     ' receipt_block=$2,receipt_block_hash=$3,revision=revision+1'+
     ' WHERE claim_id=$1::uuid AND stage=\'ISSUE_HASH_BOUND\''+
     ' AND revision=$4 RETURNING '+COLS,
     [T1F_FIRST_CLAIM,proof.blockNumber,proof.blockHash,locked.revision]);
    strict(res.rowCount===1,'T1F_ISSUED_CAS_CONFLICT');
    await c.query(
     'INSERT INTO mf_t1e.claim_events(claim_id,event_type,original_tx_hash)'+
     ' VALUES($1::uuid,\'ISSUE_CONFIRMED\',$2)',
     [T1F_FIRST_CLAIM,proof.originalTxHash]);
    await c.query('COMMIT');
    return {state:safeStatus(res.rows[0]),proof,sendAgainPermitted:false};
   }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}
   finally{c.release()}
  }
 });
}
