/**
 * G1 public-only snapshot cache. SOURCE ONLY; no HTTP listener, schema setup,
 * source signing key, wallet or original CP30 connector.
 * Caller supplies separately provisioned PostgreSQL and pinned Ed25519
 * PUBLIC key/fingerprint. A source signature is not on-chain finality.
 */
import {KeyObject,createPublicKey,createHash} from 'node:crypto';
import {
  verifyPublicG1Envelope,canonicalPublicJson,assertPublicG1Snapshot
} from './public-envelope.mjs';

const CACHE_TABLE='mf_g1_public_cache.active';
const HEX64=/^[0-9a-f]{64}$/;
const SEQUENCE=/^(0|[1-9][0-9]{0,77})$/;
const refuse=(code='G1_CACHE_REJECTED')=>{
  const error=new Error(code);error.code=code;throw error;
};
const isNow=n=>Number.isSafeInteger(n)&&n>0;

function validateTrust({publicKey,expectedKeyId,expectedAudience,expectedPublicKeyFingerprint}){
  if(typeof expectedKeyId!=='string'||expectedKeyId.length<8||
     expectedKeyId.length>128||
     typeof expectedAudience!=='string'||
     !/^https:\/\/[a-z0-9-]+\.onrender\.com$/.test(expectedAudience)||
     typeof expectedPublicKeyFingerprint!=='string'||
     !HEX64.test(expectedPublicKeyFingerprint))refuse('G1_CACHE_TRUST_ROOT_REQUIRED');
  let key;
  try{
    key=publicKey instanceof KeyObject ? publicKey : createPublicKey(publicKey);
    if(key.type!=='public'||key.asymmetricKeyType!=='ed25519')
      refuse('G1_CACHE_TRUST_ROOT_REQUIRED');
    const observed=createHash('sha256')
      .update(key.export({type:'spki',format:'der'})).digest('hex');
    if(observed!==expectedPublicKeyFingerprint)
      refuse('G1_CACHE_TRUST_ROOT_REQUIRED');
  }catch{
    refuse('G1_CACHE_TRUST_ROOT_REQUIRED');
  }
  return key;
}
function unchangedOrMonotone(previous,next){
  if(next.asOf<previous.asOf)refuse();
  // Same original snapshot timestamp cannot describe different materials.
  if(next.asOf===previous.asOf &&
     canonicalPublicJson(next)!==canonicalPublicJson(previous))refuse();
  const oldStore=previous.stores.items[0],newStore=next.stores.items[0];
  if(oldStore){
    if(!newStore||newStore.id!==oldStore.id)refuse();
    const oldTotals=previous.ledger.items[0]?.financial;
    const newTotals=next.ledger.items[0]?.financial;
    if(!oldTotals||!newTotals)refuse();
    // Funded and settled cumulative quantities/amounts cannot decrease
    // for the same original escrow. Other buckets may move.
    for(const k of ['F','S']){
      if(BigInt(newTotals.counts[k])<BigInt(oldTotals.counts[k])||
         BigInt(newTotals[k])<BigInt(oldTotals[k]))refuse();
    }
  }
}

export function makeG1PublicSnapshotCache({
  pool,publicKey,expectedKeyId,expectedAudience,
  expectedPublicKeyFingerprint,clock=()=>Math.floor(Date.now()/1000)
}={}){
  if(typeof pool?.connect!=='function'||typeof pool?.query!=='function'||
     typeof clock!=='function')refuse('G1_CACHE_CONFIGURATION_REQUIRED');
  const key=validateTrust({
    publicKey,expectedKeyId,expectedAudience,expectedPublicKeyFingerprint
  });
  const verify=(envelope,now,previousSequence)=>
    verifyPublicG1Envelope(envelope,{
      publicKey:key,expectedKeyId,expectedAudience,now,previousSequence
    });
  const verifyStored=(row,time)=>{
    if(!row||typeof row.last_sequence!=='string'||
       !SEQUENCE.test(row.last_sequence)||row.last_sequence==='0'||
       row.key_id!==expectedKeyId||row.audience!==expectedAudience||
       !row.signed_envelope||!HEX64.test(row.receipt_digest))refuse();
    const baseline=(BigInt(row.last_sequence)-1n).toString();
    const result=verify(row.signed_envelope,time,baseline);
    if(row.last_sequence!==result.sequence||
       String(row.source_as_of)!==String(result.data.asOf)||
       String(row.signed_issued_at)!==String(row.signed_envelope.issuedAt)||
       String(row.signed_expires_at)!==String(result.expiresAt)||
       row.receipt_digest!==result.receiptDigest)refuse();
    return result;
  };

  async function ingest(envelope){
    const time=clock();
    if(!isNow(time))refuse('G1_CACHE_CLOCK_INVALID');
    // Reject oversized/malformed bodies before opening the database.
    let bodyBytes;
    try{bodyBytes=Buffer.byteLength(JSON.stringify(envelope),'utf8')}
    catch{refuse()}
    if(bodyBytes>48_000||bodyBytes<50)refuse();
    let db,began=false;
    try{
      db=await pool.connect();
      await db.query('BEGIN');began=true;
      const found=await db.query('SELECT key_id,audience,last_sequence,'+
        'signed_envelope,source_as_of,signed_issued_at,signed_expires_at,'+
        'receipt_digest FROM '+CACHE_TABLE+' WHERE singleton=1 FOR UPDATE');
      if(found.rowCount!==1)refuse('G1_CACHE_NOT_PROVISIONED');
      const prior=found.rows[0];
      if(prior.key_id!==expectedKeyId||
         prior.audience!==expectedAudience||!SEQUENCE.test(prior.last_sequence))
        refuse('G1_CACHE_TRUST_ROOT_CHANGED');
      // Reverify prior envelope, preventing unsigned DB JSONB modification.
      let old=null;
      if(prior.last_sequence!=='0')
        old=verifyStored(prior,Number(prior.signed_issued_at));
      else if(prior.signed_envelope!==null||prior.receipt_digest!==null)refuse();
      const checked=verify(envelope,time,prior.last_sequence);
      // Deliberately require contiguous sequence: no silent missing snapshot.
      if(BigInt(checked.sequence)!==BigInt(prior.last_sequence)+1n)refuse();
      if(old)unchangedOrMonotone(old.data,checked.data);
      const updated=await db.query('UPDATE '+CACHE_TABLE+' SET '+
        'last_sequence=$1::numeric,source_as_of=$2::bigint,'+
        'signed_issued_at=$3::bigint,signed_expires_at=$4::bigint,'+
        'receipt_digest=$5,signed_envelope=$6::jsonb,accepted_at=now() '+
        'WHERE singleton=1 AND last_sequence=$7::numeric',
        [checked.sequence,checked.data.asOf,envelope.issuedAt,
         checked.expiresAt,checked.receiptDigest,
         JSON.stringify(envelope),prior.last_sequence]);
      if(updated.rowCount!==1)refuse();
      await db.query('COMMIT');began=false;
      return {
        accepted:true,sequence:checked.sequence,
        receiptDigest:checked.receiptDigest,expiresAt:checked.expiresAt,
        authenticatedPublicSource:true,chainFinalityIndependentlyVerified:false
      };
    }catch{
      if(began&&db)await db.query('ROLLBACK').catch(()=>{});
      refuse('G1_CACHE_REJECTED');
    }finally{db?.release()}
  }

  async function current(){
    const time=clock();
    if(!isNow(time))refuse('G1_CACHE_CLOCK_INVALID');
    try{
      const rows=await pool.query('SELECT key_id,audience,last_sequence,'+
        'signed_envelope,source_as_of,signed_issued_at,signed_expires_at,'+
        'receipt_digest FROM '+CACHE_TABLE+' WHERE singleton=1');
      if(rows.rowCount!==1)refuse();
      // Every GET verifies the cached signature again. Expired data is NOT
      // served as though it were a current original chain projection.
      const verified=verifyStored(rows.rows[0],time);
      assertPublicG1Snapshot(verified.data);
      return {
        status:'G1_PUBLIC_SNAPSHOT_VERIFIED',
        sequence:verified.sequence,receiptDigest:verified.receiptDigest,
        expiresAt:verified.expiresAt,asOf:verified.data.asOf,
        authenticatedPublicSource:true,
        chainFinalityIndependentlyVerified:false,
        data:verified.data
      };
    }catch{
      refuse('G1_CACHE_NOT_READY');
    }
  }
  return Object.freeze({ingest,current});
}
