/**
 * Candidate pinned HTTPS transport for the G1 PUBLIC-ONLY snapshot publisher.
 *
 * SOURCE-ONLY; no network request at import time, no listener, no cookies,
 * bearer tokens, wallet Session, RPC or original CP30 credentials.
 * The caller must provision exact reviewed HTTPS origin and Ed25519 public
 * verifier; the transport cannot choose alternate hosts or follow redirects.
 *
 * The remote GET alone is NOT authoritative: source-publisher.mjs must
 * additionally confirm the independently read-only anchor checkpoint.
 */
import {createHash,createPublicKey,KeyObject} from 'node:crypto';
import {
  verifyPublicG1Envelope,assertPublicG1Snapshot
} from './public-envelope.mjs';

const DENIED='G1_PUBLIC_TRANSPORT_REJECTED';
const HOST=/^https:\/\/[a-z0-9-]+\.onrender\.com$/;
const DIGEST=/^[0-9a-f]{64}$/;
const refusal=()=>{const e=new Error(DENIED);e.code=DENIED;throw e;};
const exactObject=(v,ks)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===ks.length&&ks.every(k=>Object.hasOwn(v,k));

export function makePinnedG1PublicTransport({
 expectedAudience,expectedKeyId,publicKey,expectedPublicKeyFingerprint,
 fetchImpl=globalThis.fetch,clock=()=>Math.floor(Date.now()/1000)
}={}){
 if(typeof expectedAudience!=='string'||!HOST.test(expectedAudience)||
  typeof expectedKeyId!=='string'||expectedKeyId.length<8||
  typeof expectedPublicKeyFingerprint!=='string'||
  !DIGEST.test(expectedPublicKeyFingerprint)||
  typeof fetchImpl!=='function'||typeof clock!=='function')refusal();
 let key;
 try{
  key=publicKey instanceof KeyObject?publicKey:createPublicKey(publicKey);
  if(key.type!=='public'||key.asymmetricKeyType!=='ed25519')refusal();
  const hash=createHash('sha256')
   .update(key.export({type:'spki',format:'der'})).digest('hex');
  if(hash!==expectedPublicKeyFingerprint)refusal();
 }catch{refusal()}
 const endpoint=expectedAudience+'/v1/g1/public-snapshot';

 async function request(method,raw){
  let res;
  try{
   res=await fetchImpl(endpoint,{
    method,redirect:'error',credentials:'omit',
    cache:'no-store',referrerPolicy:'no-referrer',
    headers:{
     Accept:'application/json',
     'Cache-Control':'no-store',
     ...(method==='POST'?{'Content-Type':'application/json'}:{})
    },
    ...(method==='POST'?{body:raw}:{}) ,
    signal:AbortSignal.timeout(5000)
   });
  }catch{refusal()}
  try{
   if(res.redirected||typeof res.url!=='string'||res.url!==endpoint||
      !res.headers?.get('content-type')?.toLowerCase().startsWith('application/json'))
    refusal();
   const expected=method==='GET'?200:null;
   if(expected!==null&&res.status!==expected)refusal();
   if(method==='POST'&&res.status!==201&&res.status!==409)refusal();
   if(!res.body||typeof res.body[Symbol.asyncIterator]!=='function')refusal();
   const chunks=[];let bytes=0;
   for await(const chunk of res.body){
    bytes+=chunk.length;
    if(bytes>65536)refusal();
    chunks.push(Buffer.from(chunk));
   }
   const body=Buffer.concat(chunks).toString('utf8');
   const value=JSON.parse(body);
   if(body!==JSON.stringify(value))refusal();
   return {status:res.status,value};
  }catch{refusal()}
 }

 async function send(envelope){
  try{
   const now=clock();
   if(!Number.isSafeInteger(now)||now<=0)refusal();
   const prev=(BigInt(envelope?.sequence)-1n).toString();
   // The transport has no permission to transmit arbitrary unverified
   // fields, even if a source publisher implementation is later replaced.
   verifyPublicG1Envelope(envelope,{
    publicKey:key,expectedKeyId,expectedAudience,now,previousSequence:prev
   });
   const raw=JSON.stringify(envelope);
   if(Buffer.byteLength(raw,'utf8')>48000)refusal();
   const receipt=await request('POST',raw);
   // Neither 201 nor 409 alone advances publisher ACK. Exact independent
   // anchored read-back remains mandatory in the publisher.
   return {status:receipt.status};
  }catch{refusal()}
 }

 async function readBack(){
  try{
   const result=await request('GET');
   const value=result.value;
   if(!exactObject(value,[
    'status','sequence','receiptDigest','expiresAt','asOf',
    'authenticatedPublicSource','independentlyAnchored',
    'chainFinalityIndependentlyVerified','data'
   ])||value.status!=='G1_PUBLIC_SNAPSHOT_VERIFIED'||
     value.authenticatedPublicSource!==true||
     value.independentlyAnchored!==true||
     value.chainFinalityIndependentlyVerified!==false||
     !DIGEST.test(value.receiptDigest))refusal();
   assertPublicG1Snapshot(value.data);
   return value;
  }catch{refusal()}
 }

 return Object.freeze({send,readBack});
}
