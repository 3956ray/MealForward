/** Public signature collector; Issuer writes require trusted SIWE+CSRF gateway. No create-round route. */
import {phase8Failure} from './t1f-phase8-diagnostics.mjs';
import {FIXED} from './t1e-first-issue-readiness.mjs';
const write=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(JSON.stringify(body))};
export function makePhase8Http({enabled=false,service,origin,clock=()=>Date.now(),requestTimeoutMs=60000}={}){
 if(!Number.isInteger(requestTimeoutMs)||requestTimeoutMs<1||requestTimeoutMs>60000)throw Error('T1F_PHASE8_HTTP_CONFIG');
 if(enabled&&(!origin||!['status','submit','prepare','bind','reconcile'].every(k=>typeof service?.[k]==='function')))throw Error('T1F_PHASE8_HTTP_CONFIG');
 let inFlight=0;const rates=new Map();
 return async({request:req,response:res,issuer,path,method,readBody})=>{
  try{
   if(!enabled)return write(res,405,{error:'T1F_PHASE8_DISABLED'});
   if(req.headers.host!==new URL(origin).host||req.headers.authorization||req.headers['x-wallet-address']||req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin'||method==='POST'&&(req.headers.origin!==origin||req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin'))return write(res,403,{error:'T1F_PHASE8_ORIGIN_DENIED'});
   const action=path.slice('/v1/t1f/phase8/'.length);
   if(!['status','approval','prepare','bind','reconcile'].includes(action)||method!==(action==='status'?'GET':'POST'))return write(res,405,{error:'T1F_PHASE8_METHOD'});
   if(!['status','approval'].includes(action)&&issuer!==FIXED.issuerAuthority)return write(res,403,{error:'T1F_PHASE8_ISSUER_REQUIRED'});
   if(action==='approval'&&req.headers['x-phase8-intent']!=='signed-approval')return write(res,403,{error:'T1F_PHASE8_APPROVAL_INTENT_REQUIRED'});
   const now=clock(),bucket=Math.floor(now/60000);if(!rates.has(bucket)){rates.clear();rates.set(bucket,0)}
   if(rates.get(bucket)>=30||inFlight>=4)return write(res,429,{error:'T1F_PHASE8_RATE_LIMIT'});
   rates.set(bucket,rates.get(bucket)+1);inFlight++;
   const ac=new AbortController(),timer=setTimeout(()=>{
    ac.abort();
    // A complete request body says nothing about whether its response ended.
    // Close that response now, even if an underlying store promise is stuck.
    if(!res.destroyed&&!res.writableEnded)write(res,504,{error:'T1F_PHASE8_REQUEST_TIMEOUT'});
    if(!req.complete)req.destroy();
   },requestTimeoutMs);
   const abort=()=>ac.abort();req.once('aborted',abort);res.once('close',abort);
   try{
    const body=action==='status'?undefined:await readBody(req);
    if(ac.signal.aborted)throw Error('T1F_PHASE8_REQUEST_ABORTED');
    const value=await service[action==='approval'?'submit':action](body,{signal:ac.signal});
    if(!ac.signal.aborted&&!res.destroyed&&!res.writableEnded)write(res,value.created?201:200,value);
   }finally{
    // Keep timed-out work counted until it actually settles. Releasing early
    // would permit an unlimited backlog of unresolved durable operations.
    clearTimeout(timer);req.off('aborted',abort);res.off('close',abort);inFlight--;
   }
  }catch(e){
   const bodyError=[400,413,415,422].includes(e?.status);
   const failure=phase8Failure(e);
   if(!bodyError)console.warn(JSON.stringify({event:'PHASE8_REQUEST_FAILED',...failure}));
   if(!res.destroyed&&!res.writableEnded)write(res,bodyError?e.status:failure.status,bodyError?{error:'T1F_PHASE8_BODY'}:{error:failure.error,stage:failure.stage});
  }
 };
}
