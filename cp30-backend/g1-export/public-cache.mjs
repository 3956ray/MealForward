/**
 * CP31 G1 public snapshot cache. SOURCE ONLY, NOT DEPLOYED.
 * A restricted PostgreSQL pool accepts Ed25519-signed public allowlisted
 * snapshots under a row lock. No private wallets, original CP30 database
 * credentials, business writers, or signer keys are used.
 */
import {verifyPublicG1Envelope} from './public-envelope.mjs';

const ROW='cp30-public-v1';
const ERRORS=new Set(['G1_PUBLIC_ENVELOPE_REJECTED','G1_PUBLIC_REPLAY','G1_PUBLIC_NOT_AVAILABLE']);
const noData=()=>Object.assign(new Error('G1_PUBLIC_NOT_AVAILABLE'),{code:'G1_PUBLIC_NOT_AVAILABLE'});
const replay=()=>Object.assign(new Error('G1_PUBLIC_REPLAY'),{code:'G1_PUBLIC_REPLAY'});
const invalid=()=>Object.assign(new Error('G1_PUBLIC_ENVELOPE_REJECTED'),{code:'G1_PUBLIC_ENVELOPE_REJECTED'});
const uint=/^(0|[1-9][0-9]{0,77})$/;

export function createG1PublicCache({
 pool,publicKey,keyId,audience,clock=()=>Math.floor(Date.now()/1000),
 enabled=false
}={}){
 if(!pool||typeof pool.connect!=='function'||typeof pool.query!=='function')throw Error('G1_RESTRICTED_DB_POOL_REQUIRED');
 if(!publicKey||typeof keyId!=='string'||typeof audience!=='string')throw Error('G1_PINNED_SOURCE_KEY_REQUIRED');
 const config={publicKey,expectedKeyId:keyId,expectedAudience:audience};
 const available=enabled===true;
 const now=()=>{const value=clock();if(!Number.isSafeInteger(value)||value<0)throw invalid();return value;};

 async function accept(envelope){
  if(!available)throw noData();
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const read=await client.query(
    'SELECT sequence FROM mf_g1_public_cache.snapshots WHERE source_id=$1 FOR UPDATE',
    [ROW]);
   if(read.rowCount!==1)throw noData();
   const sequence=String(read.rows[0].sequence);
   if(!uint.test(sequence))throw noData();
   const currentNow=now(); // Check expiry only AFTER acquiring the lock.
   if(typeof envelope?.sequence==='string'&&uint.test(envelope.sequence)&&
      BigInt(envelope.sequence)<=BigInt(sequence))throw replay();
   const verified=verifyPublicG1Envelope(envelope,{
    ...config,now:currentNow,previousSequence:sequence
   });
   const put=await client.query(
    'UPDATE mf_g1_public_cache.snapshots SET sequence=$2::numeric,'+
    'envelope=$3::jsonb,digest=$4,issued_at=$5,expires_at=$6,'+
    'accepted_at=$7 WHERE source_id=$1 AND sequence=$8::numeric',
    [ROW,verified.sequence,JSON.stringify(envelope),verified.receiptDigest,
     envelope.issuedAt,envelope.expiresAt,currentNow,sequence]);
   if(put.rowCount!==1)throw noData();
   await client.query('COMMIT');
   return {
    accepted:true,sequence:verified.sequence,receiptDigest:verified.receiptDigest,
    expiresAt:verified.expiresAt,chainFinalityIndependentlyVerified:false
   };
  }catch(error){
   await client.query('ROLLBACK').catch(()=>{});
   throw error;
  }finally{client.release()}
 }

 async function read(){
  if(!available)throw noData();
  const r=await pool.query(
   'SELECT sequence,envelope,digest FROM mf_g1_public_cache.snapshots WHERE source_id=$1',
   [ROW]);
  if(r.rowCount!==1||!r.rows[0].envelope)throw noData();
  const {sequence,envelope,digest}=r.rows[0];
  const seq=String(sequence);
  if(!uint.test(seq)||seq==='0'||envelope.sequence!==seq)throw noData();
  // Rechecking the source signature on every GET guards against forged
  // cache contents. A privileged DB rollback is a separate threat model.
  let verified;
  try{
   verified=verifyPublicG1Envelope(envelope,{
    ...config,now:now(),previousSequence:(BigInt(seq)-1n).toString()
   });
  }catch{throw noData()}
  if(verified.receiptDigest!==digest)throw noData();
  return {
   data:verified.data,sequence:seq,expiresAt:verified.expiresAt,
   receiptDigest:verified.receiptDigest,
   authenticatedPublicSource:true,
   chainFinalityIndependentlyVerified:false
  };
 }

 async function health(){
  try{
   if(!available)return false;
   const r=await pool.query(
    'SELECT count(*)::int AS n FROM mf_g1_public_cache.snapshots WHERE source_id=$1',[ROW]);
   return r.rows[0].n===1;
  }catch{return false}
 }
 return Object.freeze({accept,read,health,enabled:available});
}

const headers={
 'Content-Type':'application/json; charset=utf-8',
 'Cache-Control':'no-store',
 'X-Content-Type-Options':'nosniff',
 'Referrer-Policy':'no-referrer',
 'Cross-Origin-Resource-Policy':'same-origin'
};
const respond=(res,status,data)=>{
 res.writeHead(status,headers);
 res.end(JSON.stringify(data));
};
const parseUpload=async req=>{
 if((req.headers['content-type']||'').split(';',1)[0].trim()!=='application/json')
  throw Object.assign(Error('G1_JSON_REQUIRED'),{code:'G1_JSON_REQUIRED'});
 let length=0;const chunks=[];
 for await(const chunk of req){
  length+=chunk.length;
  if(length>131072)throw Object.assign(Error('G1_BODY_TOO_LARGE'),{code:'G1_BODY_TOO_LARGE'});
  chunks.push(chunk);
 }
 let value;
 try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'))}
 catch{throw invalid()}
 return value;
};

/** Offline HTTP candidate. Not mounted in the deployed Auth Pilot. */
export function makeG1PublicCacheHandler({cache,enabled=false,expectedAudience}={}){
 if(!cache||typeof cache.read!=='function'||typeof cache.accept!=='function')throw Error('G1_CACHE_REQUIRED');
 return async(req,res)=>{
  try{
   if(!enabled||!cache.enabled){
    respond(res,503,{error:'ORIGINAL_BUSINESS_NOT_CONNECTED'});
    return;
   }
   const raw=req.url||'/';
   if(!raw.startsWith('/')||raw.startsWith('//')){
    respond(res,400,{error:'INVALID_REQUEST'});return;
   }
   const u=new URL(raw,'http://127.0.0.1');
   if(u.search||u.hash){
    respond(res,400,{error:'INVALID_REQUEST'});return;
   }
   if(req.method==='GET'&&u.pathname==='/health'){
    const ok=await cache.health();
    respond(res,ok?200:503,{
     status:ok?'ready':'not_ready',mode:'G1_SIGNED_PUBLIC_CACHE_ONLY',
     privateBusinessConnected:false,walletTransactionsAllowed:false
    });
    return;
   }
   if(req.method==='POST'&&u.pathname==='/internal/g1/public-snapshot'){
    const incomingOrigin=req.headers.origin;
    if(incomingOrigin&&incomingOrigin!==expectedAudience){
     respond(res,403,{error:'G1_ORIGIN_DENIED'});return;
    }
    const envelope=await parseUpload(req);
    const result=await cache.accept(envelope);
    respond(res,202,{accepted:true,sequence:result.sequence,
     expiresAt:result.expiresAt,receiptDigest:result.receiptDigest,
     chainFinalityIndependentlyVerified:false});
    return;
   }
   if(req.method==='GET'&&(
     u.pathname==='/v1/stores'||u.pathname==='/v1/ledger'||
     /^\/v1\/stores\/[0-9a-f]{64}\/meals$/.test(u.pathname))){
    const result=await cache.read();
    if(u.pathname==='/v1/stores'){respond(res,200,result.data.stores);return}
    if(u.pathname==='/v1/ledger'){respond(res,200,result.data.ledger);return}
    const id=u.pathname.split('/')[3];
    if(!result.data.stores.items.some(s=>s.id===id)){
     respond(res,404,{error:'NOT_FOUND'});return;
    }
    respond(res,200,{items:result.data.meals.items.filter(m=>m.store===id)});
    return;
   }
   if(u.pathname.startsWith('/v1/my/')||u.pathname.startsWith('/v1/vouchers/')||
      u.pathname.startsWith('/v1/merchant/')){
    respond(res,503,{error:'ORIGINAL_PRIVATE_BUSINESS_NOT_CONNECTED'});return;
   }
   if(req.method!=='GET'&&req.method!=='POST'){
    respond(res,405,{error:'METHOD_NOT_ALLOWED'});return;
   }
   respond(res,404,{error:'NOT_FOUND'});
  }catch(error){
   // Never include an envelope, wallet, database error text or HTTP headers.
   const code=ERRORS.has(error?.code)?error.code:error?.code;
   if(code==='G1_PUBLIC_REPLAY')respond(res,409,{error:'G1_PUBLIC_REPLAY'});
   else if(code==='G1_PUBLIC_ENVELOPE_REJECTED')
    respond(res,403,{error:'G1_PUBLIC_ENVELOPE_REJECTED'});
   else if(code==='G1_JSON_REQUIRED')respond(res,415,{error:'JSON_REQUIRED'});
   else if(code==='G1_BODY_TOO_LARGE')respond(res,413,{error:'BODY_TOO_LARGE'});
   else respond(res,503,{error:'ORIGINAL_BUSINESS_NOT_CONNECTED'});
  }
 };
}
