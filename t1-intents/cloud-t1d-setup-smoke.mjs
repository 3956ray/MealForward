/**
 * Public HTTPS acceptance for the isolated T1-D SETUP_ONLY Render Free service.
 * No cookies, keys, signatures, DB credentials or token transactions.
 * The host is literal, not user-provided; setup must fail every money path.
 */
const PINNED='https://mealforward-t1d-funding-laodao.onrender.com';
const CI_LOCAL=/^http:\/\/127\.0\.0\.1:[0-9]{2,5}$/;
const check=(ok,code)=>{if(!ok)throw Error(code)};
export async function verifyT1DCloudSetup({
 origin=PINNED,fetchImpl=fetch,ciLoopback=false
}={}){
 check(origin===PINNED||(ciLoopback&&CI_LOCAL.test(origin)),
  'T1D_SETUP_UNTRUSTED_PUBLIC_ORIGIN');
 check(typeof fetchImpl==='function','T1D_SETUP_FETCH_REQUIRED');
 let calls=0;
 async function request(path,method='GET'){
  check(/^\/(?:[a-z0-9/_-]+)?$/.test(path),
   'T1D_SETUP_UNKNOWN_TEST_PATH');
  check(['GET','HEAD','POST'].includes(method),'T1D_SETUP_HTTP_METHOD_DENIED');
  const res=await fetchImpl(origin+path,{
   method,redirect:'error',cache:'no-store',
   headers:{
    Accept:'application/json',
    ...(method==='POST'?{Origin:origin,'Content-Type':'application/json'}:{})
   },
   ...(method==='POST'?{body:'{}'}:{}),
   // Free Render can sleep. Only the FIRST, fixed-host request has extra
   // time; the remaining requests stay strict and sequential.
   signal:AbortSignal.timeout(calls===0?100000:15000)
  }).catch(e=>{
   throw Error('T1D_SETUP_FETCH_FAILED_STEP_'+(calls+1)+'_'+
    (e?.name==='TimeoutError'?'TIMEOUT':'NETWORK'));
  });
  calls++;
  check(res?.headers&&Number.isInteger(res.status),
   'T1D_SETUP_RESPONSE_INVALID');
  check(!res.headers.get('set-cookie'),'T1D_SETUP_UNEXPECTED_SESSION_COOKIE');
  check((res.headers.get('cache-control')||'').includes('no-store'),
   'T1D_SETUP_CACHE_POLICY_MISSING');
  const ct=res.headers.get('content-type')||'';
  // HEAD can advertise application/json but has no body. Do not parse it.
  const body=method==='HEAD'?null:
   ct.startsWith('application/json')?await res.json():await res.text();
  return {status:res.status,body,headers:res.headers};
 }
 const health=await request('/health');
 check(health.status===200&&
  health.body?.status==='T1D_SETUP_PROCESS_ALIVE'&&
  health.body?.fundingEnabled===false,
 'T1D_SETUP_PUBLIC_HEALTH_NOT_READY');
 const head=await request('/health','HEAD');
 check(head.status===200&&head.body===null,
  'T1D_SETUP_HEALTH_HEAD_INVALID');
 const home=await request('/');
 check(home.status===200&&typeof home.body==='string'&&
  home.body.includes('T1-D')&&
  (home.headers.get('content-security-policy')||'').includes("default-src 'none'"),
 'T1D_SETUP_STATIC_ONLY_PAGE_MISSING');
 const status=await request('/v1/t1/status');
 check(status.status===503&&
  status.body?.status==='T1D_OWNER_SETUP_REQUIRED'&&
  status.body?.fundingEnabled===false&&
  status.body?.transactionActionsEnabled===false&&
  status.body?.quoteSigningEnabled===false&&
  status.body?.authEnabled===false&&
  status.body?.originalCp30DataConnected===false,
 'T1D_SETUP_PUBLIC_FUNDING_IMPROPERLY_ENABLED');
 const blocked=[
  ['/v1/me','GET'],['/v1/auth/pre-session','POST'],
  ['/v1/t1/my-intents','GET'],
  ['/v1/t1/fund/prepare','POST'],
  ['/v1/t1/fund/quote','POST'],
  ['/v1/t1/fund/approve-call','POST'],
  ['/v1/t1/fund/build-call','POST'],
  ['/v1/t1/fund/reserve','POST'],
  ['/v1/t1/fund/quote/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','GET'],
  ['/fund-testnet.html','GET']
 ];
 for(const [path,method] of blocked){
  const out=await request(path,method);
  check(out.status===503&&out.body?.error==='T1D_SETUP_NO_FUNDS'&&
   out.body?.fundingEnabled===false,'T1D_SETUP_ROUTE_OPEN_'+path.replaceAll('/','_'));
 }
 return {
  status:'T1D_REAL_RENDER_SETUP_ONLY_HTTP_PASS',
  origin,noFunds:true,authDisabled:true,signingDisabled:true,
  noOriginalMacCp30:true,requests:calls,onchainTransactions:0
 };
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 try{
  const out=await verifyT1DCloudSetup();
  process.stdout.write(JSON.stringify(out,null,2)+'\n');
 }catch(e){
  // Only static, whitelist-owned error codes are printed; no URL bodies,
  // credentials, cookies, tokens or freeform upstream exception messages.
  const reason=typeof e?.message==='string'&&
   /^T1D_SETUP_[A-Z0-9_-]{3,120}$/i.test(e.message)?
   e.message:'T1D_SETUP_PUBLIC_HTTP_NETWORK_ERROR';
  process.stderr.write(reason+'\n');
  process.exitCode=1;
 }
}
