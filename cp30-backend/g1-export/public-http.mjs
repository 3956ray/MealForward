/**
 * Isolated G1 PUBLIC snapshot HTTP adapter (candidate, NOT deployed).
 * Does not integrate with CP30 nor with the existing Render SIWE Auth Pilot.
 * Caller must mount it on its OWN reviewed public-snapshot cache service.
 * Incoming bodies carry only strict signed public snapshot data; no session,
 * wallet, private voucher endpoint, signer or database credentials here.
 */
import {URL} from 'node:url';

const GENERIC='G1_PUBLIC_ENVELOPE_REJECTED';
const readyError='G1_PUBLIC_SOURCE_NOT_READY';
const headers=Object.freeze({
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
  'Content-Security-Policy':"default-src 'none'",
  'Access-Control-Allow-Origin':'null'
});
const exactOrigin=s=>typeof s==='string'&&
 /^https:\/\/[a-z0-9-]+\.onrender\.com$/.test(s);

export function makeG1PublicCacheHttpHandler({cache,origin}={}){
 if(typeof cache?.ingest!=='function'||typeof cache?.current!=='function'||
   !exactOrigin(origin))throw Error('G1_HTTP_ORIGIN_NOT_PINNED');
 const host=new URL(origin).host;
 const respond=(res,status,value)=>{
  res.writeHead(status,headers);
  res.end(JSON.stringify(value));
 };
 return async function handler(req,res){
  try{
   const target=new URL(req.url||'/',origin);
   if(req.headers.host!==host||target.host!==host||
     target.search||target.username||target.password){
    respond(res,403,{error:GENERIC});return;
   }
   // This protocol is signed-source only, never a browser or wallet Session.
   // It does not accept Cookies or bearer headers as alternative authority.
   if(req.headers.cookie||req.headers.authorization||
     req.headers.origin&&req.headers.origin!==origin||
     req.headers['sec-fetch-site']&&
       !['same-origin','none'].includes(req.headers['sec-fetch-site'])){
    respond(res,403,{error:GENERIC});return;
   }
   if(target.pathname!=='/v1/g1/public-snapshot'){
    respond(res,404,{error:'NOT_FOUND'});return;
   }
   if(req.method==='GET'){
    try{
     const value=await cache.current();
     respond(res,200,value);
    }catch{
     respond(res,503,{error:readyError});
    }
    return;
   }
   if(req.method!=='POST'){
    respond(res,405,{error:'METHOD_NOT_ALLOWED'});return;
   }
   if((req.headers['content-type']||'').split(';',1)[0].trim()!=='application/json'){
    respond(res,415,{error:GENERIC});return;
   }
   if(req.headers['content-encoding']&&
      req.headers['content-encoding']!=='identity'){
    respond(res,415,{error:GENERIC});return;
   }
   let bytes=0,chunks=[];
   try{
    for await(const part of req){
     bytes+=part.length;
     if(bytes>48000){
      respond(res,413,{error:GENERIC});
      return;
     }
     chunks.push(part);
    }
   }catch{
    respond(res,400,{error:GENERIC});return;
   }
   if(bytes<50){
    respond(res,400,{error:GENERIC});return;
   }
   let payload;
   try{
    const raw=Buffer.concat(chunks).toString('utf8');
    payload=JSON.parse(raw);
    // Prevent JSON duplicate-key/escape ambiguity between source, cache
    // and any subsequent reader. Sender must use JSON.stringify(data).
    if(raw!==JSON.stringify(payload)){
     respond(res,400,{error:GENERIC});return;
    }
   }catch{
    respond(res,400,{error:GENERIC});return;
   }
   try{
    const receipt=await cache.ingest(payload);
    respond(res,201,{
      accepted:receipt.accepted,sequence:receipt.sequence,
      receiptDigest:receipt.receiptDigest,
      authenticatedPublicSource:true,
      chainFinalityIndependentlyVerified:false
    });
   }catch{
    respond(res,409,{error:GENERIC});
   }
  }catch{
   if(!res.headersSent)respond(res,503,{error:readyError});
   else res.end();
  }
 };
}
