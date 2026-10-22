/**
 * Public HTTPS attestation: T1-D real Supabase roles + SIWE_ONLY gateway.
 * No cookies, private wallet keys, EIP191 signatures, Auth challenge POST,
 * Quote authorization or original Test USDC transactions are performed.
 *
 * The immutable Render hostname is the only allowed remote target.
 * Stop BEFORE financial POST checks if funding appears enabled.
 */
import https from 'node:https';
const PINNED='https://mealforward-t1d-funding-laodao.onrender.com';
const fail=(ok,reason)=>{if(!ok)throw Error(reason)};
export async function attestPublicSiweOnly({origin=PINNED,fetcher=fetch}={}){
 fail(origin===PINNED,'T1D_SIWE_REMOTE_ORIGIN_NOT_PINNED');
 fail(typeof fetcher==='function','T1D_SIWE_FETCH_REQUIRED');
 let requests=0;
 const request=async(path,method='GET',body=null,extra={})=>{
  fail(/^\/(?:v1\/[a-z0-9/_-]+|(?:ui\.mjs|ui\.css|fund-testnet\.html))?$/.test(path),
   'T1D_SIWE_UNEXPECTED_TEST_PATH');
  const init={
   method,redirect:'error',cache:'no-store',
   headers:{
    Accept:'application/json',
    ...(method==='POST'?{
     'Content-Type':'application/json',Origin:origin
    }:{}),...extra
   },
   ...(body===null?{}:{body:JSON.stringify(body)}),
   signal:AbortSignal.timeout(requests===0?105000:20000)
  };
  const response=await fetcher(origin+path,init);
  requests++;
  fail(Number.isInteger(response.status),'T1D_SIWE_MISSING_HTTP_STATUS');
  const headers=response.headers;
  const ct=headers.get('content-type')||'';
  const output=ct.startsWith('application/json')?
   await response.json():await response.text();
  fail(!headers.get('set-cookie'),'T1D_SIWE_UNEXPECTED_PUBLIC_COOKIE');
  return {code:response.status,body:output,headers};
 };
 const status=await request('/v1/t1/status');
 fail(status.code===200&&
  status.body?.status==='READY_NO_FUNDS'&&
  status.body?.mode==='T1D_ISOLATED_SIWE_READ_ONLY_GATE'&&
  status.body?.network===10143&&
  status.body?.testnetOnly===true&&
  status.body?.fundingEnabled===false&&
  status.body?.quoteSigningEnabled===false&&
  status.body?.transactionActionsEnabled===false&&
  status.body?.originalCp30DataConnected===false,
 'T1D_SIWE_LIVE_NO_FUNDS_GATE_FAILED');
 const html=await request('/');
 fail(html.code===200&&typeof html.body==='string'&&
  html.body.includes('T1-D 独立登录验收')&&
  html.body.includes('data-expected-mode="T1D_ISOLATED_SIWE_READ_ONLY_GATE"')&&
  (html.headers.get('content-security-policy')||'').includes("default-src 'none'"),
 'T1D_SIWE_WRONG_LANDING_PAGE');
 // Render is already warm after the status+HTML probes above. Send
 // actual Chromium-style cross-site navigation metadata over strict HTTPS:
 // the ChatGPT link MUST navigate, but foreign iframe/script/API must not.
 const rawGet=(path,headers)=>new Promise((resolve,reject)=>{
  const req=https.request(origin+path,{
   method:'GET',headers,
   rejectUnauthorized:true,servername:new URL(origin).hostname
  },response=>{
   response.resume();
   response.on('end',()=>resolve({
    code:response.statusCode,headers:response.headers
   }));
  });
  req.setTimeout(20000,()=>req.destroy(Error('NAVIGATION_TIMEOUT')));
  req.on('error',reject);req.end();
 });
 const externalHeaders={
  'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'navigate',
  'Sec-Fetch-Dest':'document','Sec-Fetch-User':'?1'
 };
 const externalClick=await rawGet('/',externalHeaders);
 fail(externalClick.code===200,'T1D_SIWE_EXTERNAL_LINK_NAVIGATION_403');
 fail(externalClick.headers['x-frame-options']==='DENY'&&
  externalClick.headers['content-security-policy']?.includes("frame-ancestors 'none'"),
  'T1D_SIWE_EMBED_GUARD_MISSING');
 for(const [path,headers] of [
  ['/',{...externalHeaders,'Sec-Fetch-Dest':'iframe'}],
  ['/',{...externalHeaders,'Sec-Fetch-Mode':'cors','Sec-Fetch-Dest':'empty'}],
  ['/ui.mjs',{...externalHeaders,'Sec-Fetch-Dest':'script'}],
  ['/ui.css',{...externalHeaders,'Sec-Fetch-Dest':'style'}],
  ['/',{...externalHeaders,Origin:'https://chatgpt.com'}]
 ]){
  const denied=await rawGet(path,headers);
  fail(denied.code===403,'T1D_SIWE_EXTERNAL_SUBRESOURCE_ORIGIN_BYPASS');
 }
 const javascript=await request('/ui.mjs');
 fail(javascript.code===200&&typeof javascript.body==='string'&&
  !javascript.body.includes('eth_sendTransaction')&&
  !javascript.body.includes('eth_signTypedData_v4')&&
  javascript.body.includes('personal_sign'),
 'T1D_SIWE_PUBLIC_UI_WALLET_METHOD_UNSAFE');
 const me=await request('/v1/me');
 fail(me.code===401&&me.body?.error==='UNAUTHENTICATED',
  'T1D_SIWE_UNAUTHENTICATED_PRINCIPAL_LEAK');
 const mine=await request('/v1/t1/my-intents');
 fail(mine.code===401&&mine.body?.error==='UNAUTHENTICATED',
  'T1D_SIWE_UNAUTHENTICATED_INTENT_LEAK');
 const original=await request('/v1/stores');
 fail(original.code===503&&original.body?.error==='ORIGINAL_BUSINESS_NOT_CONNECTED',
  'T1D_SIWE_OLD_CP30_ROUTE_OPEN');
 const forbiddenOrigin=await request('/v1/t1/status','GET',null,{
  Origin:'https://untrusted.invalid'
 });
 fail(forbiddenOrigin.code===403&&
  forbiddenOrigin.body?.error==='ORIGIN_OR_SUBJECT_DENIED',
 'T1D_SIWE_ORIGIN_GUARD_BYPASSED');

 // Only AFTER GET/read-only checks establish that all funding is disabled
 // may we test that the corresponding POST endpoints reject without mutation.
 const paths=[
  ['/v1/t1/intents/prepare',503],
  ['/v1/t1/fund/prepare',405],
  ['/v1/t1/fund/quote',405],
  ['/v1/t1/fund/approve-call',405],
  ['/v1/t1/fund/build-call',405],
  ['/v1/t1/fund/reserve',405],
  ['/v1/t1/fund/bind-hash',405],
  ['/v1/t1/fund/reconcile',405],
  ['/v1/t1/sign-quote',405],
  ['/v1/t1/intents/fund',405]
 ];
 for(const [path,code] of paths){
  const item=await request(path,'POST',{});
  fail(item.code===code&&item.body?.error==='FUNDING_DISABLED',
   'T1D_SIWE_UNSAFE_MONEY_ROUTE_'+path.replaceAll('/','_'));
 }
 const recovered=await request('/v1/t1/fund/quote/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 fail(recovered.code===405&&recovered.body?.error==='FUNDING_DISABLED',
  'T1D_SIWE_SIGNED_QUOTE_RECOVERY_PUBLICLY_OPEN');
 const fundingPage=await request('/fund-testnet.html');
 fail(fundingPage.code!==200,
  'T1D_SIWE_PAYMENT_HTML_EXPOSED');
 return {
  status:'T1D_LIVE_SIWE_READ_ONLY_PUBLIC_HTTP_PASS',
  source:'REAL_RENDER_TLS',
  requests,chainId:10143,siweMode:true,
  moneyEnabled:false,
  unauthenticatedPrincipalDenied:true,
  unauthenticatedIntentDenied:true,
  privateSignedQuoteDenied:true,
  originalCp30Connected:false,
  walletTransactionBroadcasts:0
 };
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 try{process.stdout.write(JSON.stringify(await attestPublicSiweOnly())+'\n')}
 catch(e){
  const text=typeof e?.message==='string'&&
   /^T1D_SIWE_[A-Z0-9_]{3,100}$/.test(e.message)?
   e.message:'T1D_SIWE_PUBLIC_GATE_NETWORK_UNAVAILABLE';
  process.stderr.write(text+'\n');process.exitCode=1;
 }
}
