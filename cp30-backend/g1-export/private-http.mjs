/**
 * G1-B original CP30 private GET HTTP adapter; SOURCE ONLY, NOT MOUNTED.
 *
 * This accepts ONLY original CP30 server-owned session cookies. NEVER
 * reuse the Render Auth Pilot Session as an original CP30 principal.
 * Actual data source must bind to reviewed, NOLOGIN, least-privilege
 * c1_g1_private_read.my_items() in the ORIGINAL CP30 database.
 * No money writes, keys, voucher secrets, raw SQL, wallet overrides.
 */
import {createHash} from 'node:crypto';
import {URL} from 'node:url';
import {
 verifiedContributions,verifiedClaimIntents,verifiedMyVouchers
} from '../../sites-frontend/dist/g1-read-contract.mjs';

const SESSION_COOKIE='__Host-mcpay_c1_session';
const COOKIE=/^[A-Za-z0-9_-]{43}$/;
const SECTIONS=Object.freeze({
 '/v1/my/orders':Object.freeze({section:'orders',verify:verifiedContributions}),
 '/v1/my/claims':Object.freeze({section:'claims',verify:verifiedClaimIntents}),
 '/v1/my/vouchers':Object.freeze({section:'vouchers',verify:verifiedMyVouchers})
});
const STATIC_HEADERS=Object.freeze({
 'Content-Type':'application/json; charset=utf-8',
 'Cache-Control':'no-store, private, max-age=0',
 'X-Content-Type-Options':'nosniff',
 'Referrer-Policy':'no-referrer',
 'Content-Security-Policy':"default-src 'none'",
 'Vary':'Cookie'
});
const deny=(code)=>{throw Error(code)};
const fail=(res,status,code)=>{
 res.writeHead(status,STATIC_HEADERS);
 res.end(JSON.stringify({error:code}));
};
function verifiedCookie(value){
 const parts=typeof value==='string'?value.split(';'):[];
 let found=null,seen=0;
 for(const part of parts){
  const idx=part.indexOf('=');
  if(idx<0)continue;
  const key=part.slice(0,idx).trim();
  if(key===SESSION_COOKIE){
   seen++;
   found=part.slice(idx+1).trim();
  }
 }
 return seen===1&&COOKIE.test(found)?found:null;
}
export function makeG1OriginalPrivateHttpHandler({source,origin}={}){
 if(source?.kind!=='ORIGINAL_CP30_PRIVATE_SOURCE_V1'||
  typeof source.readOriginalPrivate!=='function')
   deny('G1_B_ORIGINAL_SOURCE_REQUIRED');
 let pinned;
 try{pinned=new URL(origin)}catch{deny('G1_B_PINNED_ORIGIN_REQUIRED')}
 if(pinned.protocol!=='https:'||pinned.username||pinned.password||
  pinned.pathname!=='/'||pinned.search||pinned.hash)
  deny('G1_B_PINNED_ORIGIN_REQUIRED');
 const expectedHost=pinned.host;
 return async function handler(req,res){
  try{
   const target=new URL(req.url||'/',origin);
   if(req.headers.host!==expectedHost||target.host!==expectedHost||
    target.search||target.hash||target.username||target.password||
    req.headers.authorization||
    req.headers['x-wallet-address']||
    req.headers['x-recipient-key']||
    req.headers['sec-fetch-site']&&
      !['same-origin','none'].includes(req.headers['sec-fetch-site'])||
    req.headers.origin&&req.headers.origin!==origin)
    return fail(res,403,'G1_B_ORIGIN_OR_SUBJECT_DENIED');

   const scope=SECTIONS[target.pathname];
   if(!scope)return fail(res,404,'NOT_FOUND');
   if(req.method!=='GET')return fail(res,405,'METHOD_NOT_ALLOWED');
   const session=verifiedCookie(req.headers.cookie);
   if(!session)return fail(res,401,'UNAUTHENTICATED');

   // Hash the exact raw original CP30 Cookie, matching c1.application.digest.
   // The source receives NO asserted wallet address or recipient key.
   const sessionHash=createHash('sha256').update(session,'utf8').digest('hex');
   let value;
   try{
    value=await source.readOriginalPrivate({
     section:scope.section,originalSessionHash:sessionHash
    });
   }catch(error){
    if(error?.code==='UNAUTHENTICATED')
     return fail(res,401,'UNAUTHENTICATED');
    return fail(res,503,'G1_B_ORIGINAL_SOURCE_NOT_READY');
   }
   try{scope.verify(value)}
   catch{return fail(res,503,'G1_B_PRIVATE_DTO_INVALID')}
   res.writeHead(200,STATIC_HEADERS);
   res.end(JSON.stringify(value));
  }catch{
   if(!res.headersSent)fail(res,503,'G1_B_ORIGINAL_SOURCE_NOT_READY');
   else res.end();
  }
 };
}
