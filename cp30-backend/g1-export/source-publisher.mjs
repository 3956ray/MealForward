/**
 * CP31 G1 public-only source publisher, source candidate NOT DEPLOYED.
 *
 * The only source must be a separately reviewed, public-only projection
 * reader; never bind this module to CP30's mixed read/write live_api role.
 * The signer is an injected purpose-scoped signing interface: NO key material
 * or wallet/signer credential is imported, stored or logged by this module.
 *
 * Pending signed bytes are stored BEFORE network delivery, never re-signed
 * during retry. Only exact receiver read-back that independently confirms
 * the public cache+anchor may advance local ACK.
 *
 * Source authorization, original finalized chain state and signer-key
 * custody remain independent unreleased gates.
 */
import {KeyObject,createHash,createPublicKey} from 'node:crypto';
import {
  assertPublicG1Snapshot,canonicalPublicJson,publicEnvelopeSigningBytes,
  verifyPublicG1Envelope
} from './public-envelope.mjs';

const TABLE='mf_g1_publisher.outbox';
const UINT=/^(0|[1-9][0-9]{0,77})$/;
const HEX64=/^[0-9a-f]{64}$/;
const deny=(code='G1_PUBLISHER_REJECTED')=>{
 const error=new Error(code);error.code=code;throw error;
};
const timeOk=t=>Number.isSafeInteger(t)&&t>0;
const fields=(x,allowed)=>x!==null&&typeof x==='object'&&
 !Array.isArray(x)&&Object.keys(x).length===allowed.length&&
 allowed.every(k=>Object.hasOwn(x,k));
const MIN_SEQ=0n;
function exactTrust({publicKey,expectedKeyId,expectedAudience,expectedPublicKeyFingerprint}){
 if(typeof expectedKeyId!=='string'||expectedKeyId.length<8||expectedKeyId.length>128||
  typeof expectedAudience!=='string'||
  !/^https:\/\/[a-z0-9-]+\.onrender\.com$/.test(expectedAudience)||
  typeof expectedPublicKeyFingerprint!=='string'||
  !HEX64.test(expectedPublicKeyFingerprint))deny('G1_PUBLISHER_TRUST_NOT_PINNED');
 let key;
 try{
  key=publicKey instanceof KeyObject?publicKey:createPublicKey(publicKey);
  if(key.type!=='public'||key.asymmetricKeyType!=='ed25519')deny();
  const actual=createHash('sha256').update(
   key.export({type:'spki',format:'der'})
  ).digest('hex');
  if(actual!==expectedPublicKeyFingerprint)deny();
 }catch{deny('G1_PUBLISHER_TRUST_NOT_PINNED')}
 return key;
}
const load=async db=>{
 const query=await db.query('SELECT key_id,audience,last_ack_sequence,'+
  'last_ack_digest,last_ack_source_as_of,'+
  'pending_sequence,pending_receipt_digest,pending_source_as_of,'+
  'pending_expires_at,pending_signed_envelope FROM '+TABLE+
  ' WHERE singleton=1 FOR UPDATE');
 if(query.rowCount!==1)deny();
 return query.rows[0];
};
const queryValue=record=>{
 if(!record||typeof record.last_ack_sequence!=='string'||
  !UINT.test(record.last_ack_sequence)||BigInt(record.last_ack_sequence)<MIN_SEQ)deny();
 if(record.last_ack_sequence==='0'&&record.last_ack_digest!==null)deny();
 if(record.last_ack_sequence!=='0'&&
  (typeof record.last_ack_digest!=='string'||!HEX64.test(record.last_ack_digest)))deny();
 if(record.pending_sequence!==null){
  if(typeof record.pending_sequence!=='string'||!UINT.test(record.pending_sequence)||
   BigInt(record.pending_sequence)!==BigInt(record.last_ack_sequence)+1n||
   typeof record.pending_receipt_digest!=='string'||
   !HEX64.test(record.pending_receipt_digest)||
   !Number.isSafeInteger(Number(record.pending_source_as_of))||
   !timeOk(Number(record.pending_expires_at))||
   !record.pending_signed_envelope)deny();
 }else if(record.pending_receipt_digest!==null||
  record.pending_source_as_of!==null||
  record.pending_expires_at!==null||
  record.pending_signed_envelope!==null)deny();
 return record;
};
function signResultToString(value){
 if(Buffer.isBuffer(value)&&value.length===64)return value.toString('base64url');
 if(typeof value==='string'&&/^[A-Za-z0-9_-]{86}$/.test(value)&&
  Buffer.from(value,'base64url').length===64)return value;
 deny();
}
const publicCopy=value=>JSON.parse(canonicalPublicJson(assertPublicG1Snapshot(value)));
const signedResult=(doc,publicKey,expectedKeyId,expectedAudience,now,previous)=>{
 return verifyPublicG1Envelope(doc,{
  publicKey,expectedKeyId,expectedAudience,now,previousSequence:previous
 });
};

/**
 * transport object:
 *   async send(envelope): may throw or return 201/409 from pinned HTTPS
 *   async readBack(): returns receiver's authenticated ANCHORED public GET
 *
 * Never accept a bare send() 201 as final acknowledgement.
 */
export function makeG1SourcePublisher({
 pool,readPublicSource,signer,transport,independentCheckpoint,publicKey,
 expectedKeyId,expectedAudience,expectedPublicKeyFingerprint,
 clock=()=>Math.floor(Date.now()/1000)
}={}){
 if(typeof pool?.connect!=='function'||typeof pool?.query!=='function'||
  typeof readPublicSource!=='function'||
  signer?.purpose!=='G1_PUBLIC_DATA_ONLY_V1'||
  typeof signer?.signPublicEnvelope!=='function'||
  typeof transport?.send!=='function'||
  typeof transport?.readBack!=='function'||
  typeof independentCheckpoint?.current!=='function'||
  typeof independentCheckpoint?.advance==='function'||
  typeof clock!=='function')
  deny('G1_PUBLISHER_NOT_CONFIGURED');
 const key=exactTrust({publicKey,expectedKeyId,expectedAudience,
  expectedPublicKeyFingerprint});
 const assertRoot=row=>{
  queryValue(row);
  if(row.key_id!==expectedKeyId||row.audience!==expectedAudience)deny();
 };
 // This independent checkpoint reader must have strictly read-only rights.
 // No source publisher should be given independent anchor writer credentials.
 const confirmIndependent=async(sequence,digest,asOf)=>{
  let checkpoint;
  try{checkpoint=await independentCheckpoint.current()}catch{deny()}
  if(!fields(checkpoint,['sequence','receiptDigest','sourceAsOf'])||
   checkpoint.sequence!==sequence||
   checkpoint.receiptDigest!==digest||
   (asOf===null?checkpoint.sourceAsOf!==null:
      checkpoint.sourceAsOf!==asOf))deny();
 };
 async function transactional(work){
  let db,began=false;
  try{
   db=await pool.connect();
   await db.query('BEGIN');began=true;
   await db.query("SET LOCAL lock_timeout='3000ms'");
   await db.query("SET LOCAL statement_timeout='6000ms'");
   const row=await load(db);assertRoot(row);
   const result=await work(db,row);
   await db.query('COMMIT');began=false;
   return result;
  }catch{
   if(began&&db)await db.query('ROLLBACK').catch(()=>{});
   deny();
  }finally{db?.release()}
 }

 async function prepareNext(){
  return transactional(async(db,row)=>{
   if(row.pending_sequence!==null){
    // Never call the source reader or signer while an original signed
    // envelope is pending acknowledgement.
    return {prepared:false,pending:true,sequence:row.pending_sequence,
     receiptDigest:row.pending_receipt_digest};
   }
   // Detect a publisher database rollback before signing another sequence:
   // the independent receiver checkpoint must still match last durable ACK.
   await confirmIndependent(row.last_ack_sequence,row.last_ack_digest,
    row.last_ack_source_as_of===null?null:Number(row.last_ack_source_as_of));
   const now=clock();
   if(!timeOk(now))deny();
   const next=(BigInt(row.last_ack_sequence)+1n).toString();
   if(!UINT.test(next))deny();
   // This callback MUST be bound to the reviewed G1 PUBLIC SQL-only
   // projection on an authorized original source. No untrusted user JSON.
   const raw=await readPublicSource();
   const body=publicCopy(raw);
   if(body.asOf>now+5||now-body.asOf>120||
      row.last_ack_source_as_of!==null&&
        body.asOf<=Number(row.last_ack_source_as_of))deny();
   const unsigned={
    v:1,keyId:expectedKeyId,audience:expectedAudience,
    issuedAt:now,expiresAt:now+90,sequence:next,data:body
   };
   const signature=signResultToString(await signer.signPublicEnvelope(
    publicEnvelopeSigningBytes(unsigned)
   ));
   const envelope={...unsigned,signature};
   const checked=signedResult(envelope,key,expectedKeyId,expectedAudience,
    now,row.last_ack_sequence);
   const written=await db.query('UPDATE '+TABLE+' SET '+
    'pending_sequence=$1::numeric,pending_receipt_digest=$2,'+
    'pending_source_as_of=$3::bigint,pending_expires_at=$4::bigint,'+
    'pending_signed_envelope=$5::jsonb,pending_created_at=now() '+
    'WHERE singleton=1 AND pending_sequence IS NULL AND '+
    'last_ack_sequence=$6::numeric',
    [next,checked.receiptDigest,body.asOf,checked.expiresAt,
     JSON.stringify(envelope),row.last_ack_sequence]);
   if(written.rowCount!==1)deny();
   return {prepared:true,pending:true,sequence:next,
    receiptDigest:checked.receiptDigest};
  });
 }
 async function dispatchPending(){
  return transactional(async(db,row)=>{
   if(row.pending_sequence===null)
    return {delivered:false,pending:false,sequence:row.last_ack_sequence};
   const now=clock();
   if(!timeOk(now)||now>=Number(row.pending_expires_at))deny();
   const doc=row.pending_signed_envelope;
   const checked=signedResult(doc,key,expectedKeyId,expectedAudience,
    now,row.last_ack_sequence);
   if(checked.sequence!==row.pending_sequence||
    checked.receiptDigest!==row.pending_receipt_digest||
    checked.data.asOf!==Number(row.pending_source_as_of))deny();

   // A lost HTTP response is not proof of failure: the remote anchor may
   // already have committed. Always verify the receiver's current source
   // read-back, not only the potentially lost/forged POST acknowledgement.
   try{await transport.send(doc)}catch{}
   let remote;
   try{remote=await transport.readBack()}catch{deny()}
   if(!fields(remote,['status','sequence','receiptDigest','expiresAt',
    'asOf','authenticatedPublicSource','independentlyAnchored',
    'chainFinalityIndependentlyVerified','data']))deny();
   if(remote.status!=='G1_PUBLIC_SNAPSHOT_VERIFIED'||
      remote.authenticatedPublicSource!==true||
      remote.independentlyAnchored!==true||
      remote.chainFinalityIndependentlyVerified!==false||
      remote.sequence!==checked.sequence||
      remote.receiptDigest!==checked.receiptDigest||
      remote.expiresAt!==checked.expiresAt||
      remote.asOf!==checked.data.asOf||
      canonicalPublicJson(remote.data)!==canonicalPublicJson(checked.data))
    deny();
   // Network response is NOT an authority. A forged read-back cannot ACK.
   await confirmIndependent(checked.sequence,checked.receiptDigest,
    checked.data.asOf);
   const saved=await db.query('UPDATE '+TABLE+' SET '+
    'last_ack_sequence=$1::numeric,last_ack_digest=$2,'+
    'last_ack_source_as_of=$3::bigint,last_ack_at=now(),'+
    'pending_sequence=NULL,pending_receipt_digest=NULL,'+
    'pending_source_as_of=NULL,pending_expires_at=NULL,'+
    'pending_signed_envelope=NULL,pending_created_at=NULL '+
    'WHERE singleton=1 AND pending_sequence=$1::numeric AND '+
    'last_ack_sequence=$4::numeric',
    [checked.sequence,checked.receiptDigest,checked.data.asOf,
     row.last_ack_sequence]);
   if(saved.rowCount!==1)deny();
   return {delivered:true,pending:false,sequence:checked.sequence,
    receiptDigest:checked.receiptDigest};
  });
 }
 async function status(){
  const res=await pool.query('SELECT key_id,audience,last_ack_sequence,'+
   'last_ack_digest,last_ack_source_as_of,pending_sequence,'+
   'pending_receipt_digest,pending_source_as_of,pending_expires_at,'+
   'pending_signed_envelope FROM '+TABLE+' WHERE singleton=1');
  if(res.rowCount!==1)deny();
  const row=res.rows[0];assertRoot(row);
  return {lastAcknowledged:row.last_ack_sequence,
   lastDigest:row.last_ack_digest,pending:row.pending_sequence!==null,
   pendingSequence:row.pending_sequence,
   pendingExpiresAt:row.pending_expires_at===null?
    null:Number(row.pending_expires_at)};
 }
 return Object.freeze({prepareNext,dispatchPending,status});
}
