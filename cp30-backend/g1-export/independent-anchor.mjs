/**
 * CP31 G1 independent high-watermark trust domain (source-only candidate).
 *
 * The caller supplies a DIFFERENT PostgreSQL pool/database from the cache,
 * a pinned public Ed25519 verifier key and immutable out-of-band fingerprint.
 * No DB, RPC, wallet, production key, HTTP server or original CP30 is started.
 *
 * Advance is anchor-FIRST. When cache COMMIT later fails, the same exact signed
 * envelope may fill the one-step gap; another envelope or older cache cannot.
 * Full cache/anchor co-rollback remains a separate production threat.
 */
import {KeyObject,createPublicKey,createHash} from 'node:crypto';
import {verifyPublicG1Envelope} from './public-envelope.mjs';

const TABLE='mf_g1_independent_anchor.checkpoint';
const UINT=/^(0|[1-9][0-9]{0,77})$/;
const DIGEST=/^[0-9a-f]{64}$/;
const error=()=>{
 const exception=new Error('G1_INDEPENDENT_ANCHOR_REJECTED');
 exception.code='G1_INDEPENDENT_ANCHOR_REJECTED';
 throw exception;
};
const validTime=n=>Number.isSafeInteger(n)&&n>0;

export function makeIndependentG1PublicAnchor({
 pool,publicKey,expectedPublicKeyFingerprint,expectedAudience,expectedKeyId,
 clock=()=>Math.floor(Date.now()/1000)
}={}){
 if(!pool||typeof pool.connect!=='function'||typeof pool.query!=='function'||
  typeof clock!=='function'||typeof expectedKeyId!=='string'||
  expectedKeyId.length<8||expectedKeyId.length>128||
  typeof expectedAudience!=='string'||
  !/^https:\/\/[a-z0-9-]+\.onrender\.com$/.test(expectedAudience)||
  !DIGEST.test(expectedPublicKeyFingerprint))error();
 let verifier;
 try{
  verifier=publicKey instanceof KeyObject?publicKey:createPublicKey(publicKey);
  if(verifier.type!=='public'||verifier.asymmetricKeyType!=='ed25519')error();
  const fingerprint=createHash('sha256')
    .update(verifier.export({type:'spki',format:'der'})).digest('hex');
  if(fingerprint!==expectedPublicKeyFingerprint)error();
 }catch{error()}

 function validateCheckpoint(row){
  if(!row||row.key_id!==expectedKeyId||
   row.audience!==expectedAudience||
   typeof row.last_sequence!=='string'||!UINT.test(row.last_sequence)||
   (row.last_sequence==='0' && row.receipt_digest!==null)||
   (row.last_sequence!=='0' && !DIGEST.test(row.receipt_digest)))error();
  return {
   sequence:row.last_sequence,receiptDigest:row.receipt_digest,
   sourceAsOf:row.source_as_of===null?null:Number(row.source_as_of)
  };
 }
 async function current(){
  try{
   const response=await pool.query(
    'SELECT key_id,audience,last_sequence,receipt_digest,source_as_of FROM '+
    TABLE+' WHERE singleton=1');
   if(response.rowCount!==1)error();
   return validateCheckpoint(response.rows[0]);
  }catch{error()}
 }

 async function advance({envelope,expectedPreviousSequence,expectedPreviousDigest,now}={}){
  const time=now??clock();
  if(!validTime(time)||typeof expectedPreviousSequence!=='string'||
    !UINT.test(expectedPreviousSequence)||
    !(expectedPreviousDigest===null||DIGEST.test(expectedPreviousDigest))||
    typeof envelope?.sequence!=='string'||!UINT.test(envelope.sequence)||
    BigInt(envelope.sequence)!==BigInt(expectedPreviousSequence)+1n)error();
  let checked;
  try{
   checked=verifyPublicG1Envelope(envelope,{
     publicKey:verifier,expectedKeyId,expectedAudience,now:time,
     previousSequence:expectedPreviousSequence
   });
  }catch{error()}
  let conn,began=false;
  try{
   conn=await pool.connect();
   await conn.query('BEGIN');began=true;
   const lookup=await conn.query(
     'SELECT key_id,audience,last_sequence,receipt_digest,source_as_of '+
     'FROM '+TABLE+' WHERE singleton=1 FOR UPDATE');
   if(lookup.rowCount!==1)error();
   const anchor=validateCheckpoint(lookup.rows[0]);
   // Normal strictly-forward advance from exactly the cache's last
   // independently recorded digest (NULL for sequence zero).
   if(anchor.sequence===expectedPreviousSequence&&
      anchor.receiptDigest===expectedPreviousDigest){
    if(anchor.sourceAsOf!==null&&checked.data.asOf<anchor.sourceAsOf)error();
    const updated=await conn.query(
      'UPDATE '+TABLE+' SET last_sequence=$1::numeric,receipt_digest=$2,'+
      'source_as_of=$3::bigint,signed_expires_at=$4::bigint,accepted_at=now() '+
      'WHERE singleton=1 AND last_sequence=$5::numeric',
      [checked.sequence,checked.receiptDigest,checked.data.asOf,
       checked.expiresAt,anchor.sequence]);
    if(updated.rowCount!==1)error();
    await conn.query('COMMIT');began=false;
    return {anchored:true,recoveryMatch:false,sequence:checked.sequence,
      receiptDigest:checked.receiptDigest};
   }
   // If the anchor's COMMIT succeeded but the cache COMMIT crashed, the
   // identical signed envelope may complete the cache update exactly once.
   if(anchor.sequence===checked.sequence&&
      anchor.receiptDigest===checked.receiptDigest&&
      anchor.sourceAsOf===checked.data.asOf){
    await conn.query('COMMIT');began=false;
    return {anchored:true,recoveryMatch:true,sequence:checked.sequence,
      receiptDigest:checked.receiptDigest};
   }
   error();
  }catch{
   if(began&&conn)await conn.query('ROLLBACK').catch(()=>{});
   error();
  }finally{conn?.release()}
 }
 return Object.freeze({current,advance});
}
