/** Mounted only after the T1-E trusted cookie/SIWE principal lookup. */
import {FIXED} from './t1e-first-issue-readiness.mjs';
const write=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(JSON.stringify(body))};
export function makeExecutionHttp({enabled=false,service,origin,clock=()=>Date.now()}={}){
 if(enabled&&(!origin||!['status','prepare','bind','reconcile'].every(k=>typeof service?.[k]==='function')))throw Error('T1F_EXECUTION_HTTP_CONFIG');
 let inFlight=0;const rates=new Map();
 return async({request:req,response:res,issuer,path,method,readBody})=>{
  try{
   if(!enabled)return write(res,405,{error:'T1F_EXECUTION_DISABLED'});
   if(issuer!==FIXED.issuerAuthority)return write(res,403,{error:'T1F_EXECUTION_ISSUER_REQUIRED'});
   if(req.headers.host!==new URL(origin).host||req.headers.authorization||req.headers['x-wallet-address']||req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin'||method==='POST'&&(req.headers.origin!==origin||req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin'))return write(res,403,{error:'T1F_EXECUTION_ORIGIN_DENIED'});
   const action=path.slice('/v1/t1f/successor/'.length);
   if(!['status','prepare','bind','reconcile'].includes(action)||method!==(action==='status'?'GET':'POST'))return write(res,405,{error:'T1F_EXECUTION_METHOD'});
   const now=clock(),bucket=Math.floor(now/60000);if(!rates.has(bucket)){rates.clear();rates.set(bucket,0)}
   if(rates.get(bucket)>=30||inFlight>=4)return write(res,429,{error:'T1F_EXECUTION_RATE_LIMIT'});
   rates.set(bucket,rates.get(bucket)+1);inFlight++;
   const ac=new AbortController(),timer=setTimeout(()=>{ac.abort();if(!req.complete)req.destroy()},60000);
   const abort=()=>ac.abort();req.once('aborted',abort);res.once('close',abort);
   try{
    const body=action==='status'?undefined:await readBody(req);
    if(ac.signal.aborted)throw Error('T1F_EXECUTION_REQUEST_ABORTED');
    const value=await service[action](body,{signal:ac.signal});
    if(!ac.signal.aborted&&!res.destroyed)write(res,value.created?201:200,value);
   }finally{clearTimeout(timer);req.off('aborted',abort);res.off('close',abort);inFlight--}
  }catch(e){
   const bodyError=[400,413,415,422].includes(e?.status);
   const known=typeof e?.message==='string'&&/^T1F_EXECUTION_[A-Z_]{3,80}$/.test(e.message);
   if(!res.destroyed)write(res,bodyError?e.status:known?409:503,{error:bodyError?'T1F_EXECUTION_BODY':known?e.message:'T1F_EXECUTION_UNAVAILABLE'});
  }
 };
}
