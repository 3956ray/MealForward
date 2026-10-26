/** Public Phase6 pre-round gate. No wallet, valid signature, round or durable write.
 * Sessions are transient transport state. Database immutability and actual deployed
 * commit must be checked independently; this probe cannot certify either remotely.
 */
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
export const APPROVAL_PUBLIC_ORIGIN='https://mealforward-t1f-approval-laodao.onrender.com';
const ASSETS=Object.freeze({
 '/t1f-approval.html':'./public/t1f-approval.html',
 '/t1f-approval.mjs':'./public/t1f-approval.mjs',
 '/t1f-approval.css':'./public/t1f-approval.css',
 '/approval-ethers-6.15.0.mjs':'./node_modules/ethers/dist/ethers.min.js'
});
const WALLETS=Object.freeze({owner:'0xc4f8a468f10d5f98dcff3282516125e97f26433b',donor:'0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952'});
const FORBIDDEN=['/v1/approval/create','/issue','/release','/fund','/settle','/v1/t1e/issuer/issue','/v1/t1e/claim/prepare'];
const ROUTES=new Set(['/health','/',...Object.keys(ASSETS),'/v1/approval/session','/v1/approval/state','/v1/approval/state?wallet=x','/v1/approval/submit',...FORBIDDEN]);
const check=(v,code)=>{if(!v)throw Error('T1F_APPROVAL_SMOKE_'+code)};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function target(origin,fixture){
 let u;try{u=new URL(origin)}catch{throw Error('T1F_APPROVAL_SMOKE_ORIGIN')}
 check(u.origin===origin&&!u.username&&!u.password&&(origin===APPROVAL_PUBLIC_ORIGIN&&!fixture||fixture===true&&u.protocol==='http:'&&u.hostname==='127.0.0.1'&&/^[1-9][0-9]{1,4}$/.test(u.port)),'ORIGIN');
}
function cleanError(e){return Error(/^T1F_APPROVAL_SMOKE_[A-Z_]+$/.test(e?.message??'')?e.message:'T1F_APPROVAL_SMOKE_NETWORK')}
function transport({origin,fixture,fetchImpl,budgetMs,maxRequests}){
 target(origin,fixture);check(typeof fetchImpl==='function'&&Number.isInteger(budgetMs)&&budgetMs>0&&budgetMs<=120000,'CONFIG');
 const end=Date.now()+budgetMs;let count=0;
 return {get count(){return count},async request(path,{method='GET',headers={},body,rawBody,timeoutMs=10000}={}){
  check(ROUTES.has(path)&&['GET','POST'].includes(method)&&++count<=maxRequests,'REQUEST_BOUND');
  const remaining=Math.min(timeoutMs,end-Date.now());check(remaining>0,'TIMEOUT');
  const ac=new AbortController();let timer;
  const work=async()=>{
   const response=await fetchImpl(origin+path,{method,cache:'no-store',redirect:'manual',signal:ac.signal,
    headers:{Accept:'application/json','Sec-Fetch-Site':'same-origin',...(method==='POST'?{Origin:origin,'Content-Type':'application/json'}:{}),...headers},
    ...(rawBody!==undefined?{body:rawBody}:body===undefined?{}:{body:JSON.stringify(body)})});
   check(response?.headers&&response.body,'RESPONSE');
   check(response.status<300||response.status>=400,'REDIRECT');
   const reader=response.body.getReader();let size=0;const chunks=[];
   try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;check(size<=1048576,'BODY_LIMIT');chunks.push(Buffer.from(value));}}
   finally{await reader.cancel().catch(()=>{})}
   const bytes=Buffer.concat(chunks);let data;
   if((response.headers.get('content-type')||'').startsWith('application/json')){
    try{data=JSON.parse(bytes.toString('utf8'))}catch{throw Error('T1F_APPROVAL_SMOKE_JSON')}
   }
   return {status:response.status,headers:response.headers,bytes,data};
  };
  try{return await Promise.race([Promise.resolve().then(work),new Promise((_,reject)=>{timer=setTimeout(()=>{ac.abort();reject(Error('T1F_APPROVAL_SMOKE_TIMEOUT'))},remaining)})]);}
  catch(e){throw cleanError(e)}finally{clearTimeout(timer);ac.abort()}
 }};
}
function security(response,{session=false,fixture=false}={}){
 const h=response.headers;
 check(h.get('cache-control')==='no-store'&&h.get('content-security-policy')?.includes("frame-ancestors 'none'")&&h.get('x-content-type-options')==='nosniff'&&!h.has('access-control-allow-origin'),'HEADERS');
 if(!fixture)check(h.get('strict-transport-security')?.includes('max-age='),'HEADERS');
 if(!session)check(!h.has('set-cookie'),'COOKIE_UNEXPECTED');
}
function health(r,fixture){security(r,{fixture});check(r.status===200&&r.data?.status==='APPROVAL_COLLECTOR'&&r.data.noRelease===true,'HEALTH')}
/** Optional cold-start warmup, one request and120s maximum. No auto-retry. */
export async function warmApprovalHealth({origin=APPROVAL_PUBLIC_ORIGIN,fixture=false,fetchImpl=fetch}={}){
 const t=transport({origin,fixture,fetchImpl,budgetMs:120000,maxRequests:1});
 try{health(await t.request('/health',{timeoutMs:120000}),fixture);return {status:'T1F_APPROVAL_HEALTH_READY',requests:1,noRelease:true}}
 catch(e){throw cleanError(e)}
}
/** Main probe starts after warmup, ≤44requests/90s; never submits a signature. */
export async function attestApprovalLive({origin=APPROVAL_PUBLIC_ORIGIN,fixture=false,fetchImpl=fetch,budgetMs=90000,expectedAssetHashes}={}){
 check(Number.isInteger(budgetMs)&&budgetMs>0&&budgetMs<=90000,'CONFIG');
 const t=transport({origin,fixture,fetchImpl,budgetMs,maxRequests:44});
 try{
  health(await t.request('/health'),fixture);
  const expected=expectedAssetHashes??Object.fromEntries(await Promise.all(Object.entries(ASSETS).map(async([path,file])=>[path,hash(await readFile(new URL(file,import.meta.url)))])));
  check(expected&&Object.keys(expected).sort().join(',')===Object.keys(ASSETS).sort().join(',')&&Object.values(expected).every(x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x)),'ASSET_EXPECTATION');
  const assetSha256={};
  for(const path of Object.keys(ASSETS)){
   const r=await t.request(path);security(r,{fixture});check(r.status===200&&hash(r.bytes)===expected[path],'ASSET');assetSha256[path]=hash(r.bytes);
  }
  const page=await t.request('/');security(page,{fixture});
  const rootHashes=[expected['/t1f-approval.html'],hash(await readFile(new URL('./public/wallet-v2.html',import.meta.url)))];
  check(page.status===200&&rootHashes.includes(hash(page.bytes)),'ASSET');
  const cookieName=fixture?'mf_t1f_approval_fixture':'__Host-mf_t1f_approval';
  const session=async()=>{
   const r=await t.request('/v1/approval/session',{method:'POST',body:{}});security(r,{session:true,fixture});
   check(r.status===200&&typeof r.data?.csrf==='string'&&/^[0-9a-f]{64}$/.test(r.data.csrf)&&Number.isSafeInteger(r.data.expiresAt),'SESSION');
   const cookie=r.headers.get('set-cookie')||'';
   check(new RegExp('^'+cookieName+'=[0-9a-f]{64};').test(cookie)&&/; Path=\/(?:;|$)/.test(cookie)&&/; Max-Age=300(?:;|$)/.test(cookie)&&/; HttpOnly(?:;|$)/.test(cookie)&&/; SameSite=Strict(?:;|$)/.test(cookie)&&!/;\s*Domain=/i.test(cookie)&&(fixture||/; Secure(?:;|$)/.test(cookie)),'SESSION_COOKIE');
   return {Cookie:cookie.split(';')[0],'X-Approval-CSRF':r.data.csrf};
  };
  const state=async headers=>{
   const r=await t.request('/v1/approval/state',{headers});security(r,{fixture});const d=r.data;
   check(r.status===200&&d?.noRelease===true&&d.canIssue===false&&d.chainId===10143&&d.status==='NO_ROUND'&&d.round===null&&d.roles?.owner===false&&d.roles?.donor===false&&d.wallets?.owner===WALLETS.owner&&d.wallets?.donor===WALLETS.donor&&Number.isSafeInteger(d.serverTime),'STATE');
   check(Object.keys(d).sort().join(',')==='canIssue,chainId,noRelease,roles,round,serverTime,status,wallets','STATE');
  };
  const auth=await session();await state(auth);
  const reject=async(path,options,status)=>{
   const r=await t.request(path,options);security(r,{fixture});check(r.status===status&&r.data?.error==='REQUEST_REJECTED'&&r.data.noRelease===true,'NEGATIVE');
  };
  await reject('/v1/approval/state',{},401);
  await reject('/v1/approval/state',{headers:{...auth,'X-Approval-CSRF':'0'.repeat(64)}},401);
  await reject('/v1/approval/state',{headers:{...auth,Cookie:auth.Cookie+'; '+auth.Cookie}},401);
  await reject('/v1/approval/state',{headers:{...auth,'Sec-Fetch-Site':'cross-site'}},403);
  await reject('/v1/approval/state',{headers:{...auth,Origin:'https://invalid.example'}},403);
  await reject('/v1/approval/state',{headers:{...auth,'X-Wallet-Address':'0x123'}},400);
  await reject('/v1/approval/state?wallet=x',{headers:auth},400);
  await reject('/v1/approval/session',{method:'POST',body:{},headers:{Origin:'https://invalid.example'}},403);
  await reject('/v1/approval/session',{method:'POST',body:{role:'owner'}},400);
  await reject('/v1/approval/submit',{method:'POST',body:{},headers:{Cookie:auth.Cookie}},401);
  await reject('/v1/approval/submit',{method:'POST',body:{},headers:auth},400);
  await reject('/v1/approval/submit',{method:'POST',rawBody:'{"role":',headers:auth},400);
  await reject('/v1/approval/submit',{method:'POST',rawBody:'x'.repeat(2049),headers:auth},400);
  for(const path of FORBIDDEN)await reject(path,{method:'POST',body:{},headers:auth},405);
  await state(auth);await state(await session());
  return {status:'T1F_PHASE6_PUBLIC_NO_ROUND_NEGATIVE_PASS',origin,requests:t.count,assetSha256,noRelease:true,realSignatures:0,onchainTransactions:0,durableWritesRequested:0,verification:'HTTPS only; database audit and deployed commit require independent verification'};
 }catch(e){throw cleanError(e)}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{await warmApprovalHealth();process.stdout.write(JSON.stringify(await attestApprovalLive())+'\n')}
 catch(e){process.stderr.write(cleanError(e).message+'\n');process.exitCode=1}
}
