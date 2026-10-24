/**
 * Public HTTPS T1-F first-Issue release smoke; NO cookies, credentials,
 * wallet signatures, Claim writes, ERC20 operations or chain transactions.
 * Run in a fresh external CI job, never with real wallet credentials.
 * Explicit expected mode: T1F_EXPECT_ENABLED=true|false.
 */
const ORIGIN='https://mealforward-t1e-claim-laodao.onrender.com';
const allowlist=new Set([
 '/','/t1f-issuer.html','/t1f-issuer.mjs','/health',
 '/t1f-issuer.html?utm_source=chatgpt.com',
 '/t1f-issuer.html?utm_source=chatgpt.com&utm_medium=referral',
 '/t1f-issuer.html?wallet=0x123',
 '/t1f-issuer.html?utm_source=chatgpt.com&utm_source=evil.com',
 '/t1f-issuer.mjs?utm_source=chatgpt.com',
 '/v1/t1e/status','/v1/t1e/claim/me','/v1/t1e/issuer/readiness',
 '/v1/t1f/issuer/status','/v1/t1f/issuer/prepare',
 '/v1/t1f/issuer/bind','/v1/t1f/issuer/reconcile',
 '/v1/t1e/issuer/issue','/v1/t1e/report','/v1/t1e/settle',
 '/v1/t1/fund/prepare'
]);
const yes=(v,code)=>{if(!v)throw Error(code)};
const prefix='T1F_LIVE_';
export async function attestFirstIssuerLive({
 fetchImpl=fetch,expectEnabled=process.env.T1F_EXPECT_ENABLED
}={}){
 yes(expectEnabled==='true'||expectEnabled==='false',
  prefix+'EXPLICIT_EXPECTED_MODE_REQUIRED');
 yes(typeof fetchImpl==='function',prefix+'FETCH_REQUIRED');
 const enabled=expectEnabled==='true';
 let requests=0;
 async function ask(path,{method='GET',body,headers={}}={}){
  yes(allowlist.has(path),prefix+'ROUTE_NOT_ALLOWLISTED');
  const res=await fetchImpl(ORIGIN+path,{
   method,redirect:'manual',cache:'no-store',
   headers:{
    Accept:'application/json',
    ...(method==='POST'?{'Content-Type':'application/json',Origin:ORIGIN}:{}),
    ...headers
   },
   ...(body===undefined?{}:{body:JSON.stringify(body)}),
   signal:AbortSignal.timeout((requests++===0)?120000:35000)
  });
  yes(!res.headers.get('set-cookie'),prefix+'UNEXPECTED_SET_COOKIE');
  const ct=res.headers.get('content-type')||'';
  return {
   code:res.status,headers:res.headers,
   body:ct.startsWith('application/json')?await res.json():await res.text()
  };
 }
 const status=await ask('/v1/t1e/status');
 yes(status.code===200&&
  status.body.status==='T1E_RECIPIENT_CONSENT_ONLY'&&
  status.body.chainId===10143&&
  status.body.issuerIssueEnabled===enabled&&
  status.body.recipientClaimWriteEnabled===true&&
  status.body.fundEnabled===false&&
  status.body.settleEnabled===false&&
  status.body.onchainRecipientSignatureEnforced===false&&
  status.body.originalCp30Connected===false,
  prefix+'EXACT_STAGE_OR_FINANCE_FLAGS_INVALID');
 const health=await ask('/health');
 yes(health.code===200&&health.body.status==='ready',
  prefix+'PRIVATE_DATABASE_HEALTH_FAILED');
 const root=await ask('/');
 yes(root.code===200&&
  root.headers.get('cache-control')?.includes('no-store')&&
  root.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"),
  prefix+'PUBLIC_HTTPS_HEADERS_INVALID');
 const [page,js,tracked,multiTracked,unsafeWallet,duplicateTag,scriptTracking]=await Promise.all([
  ask('/t1f-issuer.html'),
  ask('/t1f-issuer.mjs'),
  ask('/t1f-issuer.html?utm_source=chatgpt.com'),
  ask('/t1f-issuer.html?utm_source=chatgpt.com&utm_medium=referral'),
  ask('/t1f-issuer.html?wallet=0x123'),
  ask('/t1f-issuer.html?utm_source=chatgpt.com&utm_source=evil.com'),
  ask('/t1f-issuer.mjs?utm_source=chatgpt.com')
 ]);
 if(enabled){
  yes(page.code===200&&js.code===200&&
   tracked.code===200&&multiTracked.code===200&&
   tracked.body===page.body&&multiTracked.body===page.body&&
   tracked.headers.get('cache-control')?.includes('no-store')&&
   unsafeWallet.code===403&&duplicateTag.code===403&&scriptTracking.code===403&&
   typeof page.body==='string'&&page.body.includes('fbab3b22-965d-44e2-b144-d7307b7aa8ea')&&
   page.body.includes('id="send" disabled')&&
   typeof js.body==='string'&&js.body.includes('eth_sendTransaction')&&
   js.body.includes('reservedTransaction=null;submitted=true')&&
   js.body.includes('function issueWindowOpen')&&
   js.body.includes('SEND_WINDOW_MIN_SEC=90')&&
   js.body.includes('latest.serverTimeUnix')&&
   !js.body.includes('eth_sendRawTransaction')&&
   !js.body.includes('privateKeyToAccount'),
   prefix+'ISSUER_WALLET_UI_NOT_EXACTLY_DEPLOYED');
 }else{
  yes(page.code!==200&&tracked.code!==200&&multiTracked.code!==200&&
   js.code!==200,
   prefix+'ISSUER_UI_MUST_BE_HIDDEN_BEFORE_RELEASE');
 }
 const mustBePrivate=['/v1/t1e/claim/me','/v1/t1e/issuer/readiness',
  '/v1/t1f/issuer/status'];
 for(const path of mustBePrivate){
  const r=await ask(path);
  // Old T1-E does not even register /v1/t1f; its safe fallback is
  // 503 ORIGINAL_BUSINESS_NOT_CONNECTED. New T1-F flag=false returns 405.
  const legacyDisabled=!enabled&&path.startsWith('/v1/t1f/');
  yes((legacyDisabled?[404,405,503]:[401]).includes(r.code)&&
   (legacyDisabled||r.body.error==='UNAUTHENTICATED'),
   prefix+'UNAUTHENTICATED_PRIVATE_API_LEAK');
 }
 for(const path of ['/v1/t1f/issuer/prepare','/v1/t1f/issuer/bind',
  '/v1/t1f/issuer/reconcile']){
  const r=await ask(path,{method:'POST',body:{}});
  yes((enabled?[401]:[404,405,503]).includes(r.code)&&
   (!enabled||r.body.error==='UNAUTHENTICATED'),
   prefix+'UNAUTHENTICATED_ISSUER_POST_ALLOWED');
 }
 const foreign=await ask('/v1/t1f/issuer/prepare',{
  method:'POST',body:{},headers:{Origin:'https://untrusted.invalid'}
 });
 yes(foreign.code===403,prefix+'CROSS_ORIGIN_ISSUER_POST_ALLOWED');
 const forged=await ask('/v1/t1f/issuer/prepare',{
  method:'POST',body:{},
  headers:{'X-Wallet-Address':'0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3'}
 });
 yes(forged.code===403,prefix+'FORGED_WALLET_HEADER_ALLOWED');
 for(const path of ['/v1/t1e/issuer/issue','/v1/t1e/report','/v1/t1e/settle']){
  const r=await ask(path,{method:'POST',body:{}});
  yes(r.code===405,prefix+'LEGACY_ISSUE_OR_PAYOUT_WRITE_OPEN');
 }
 const money=await ask('/v1/t1/fund/prepare',{method:'POST',body:{}});
 yes(![200,201,202].includes(money.code),prefix+'DONOR_FUND_OPEN');
 return Object.freeze({
  status:enabled?'T1F_ISSUER_HTTPS_RELEASE_NEGATIVE_PASS':
   'T1F_ISSUER_HTTPS_DISABLED_NEGATIVE_PASS',
  chainId:10143,issuerEnabled:enabled,requestCount:requests,
  originalFundingReused:true,
  onchainTransactionsSent:0,claimWritesPerformed:0,
  realHumanIssuerWalletStillRequired:true
 });
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 try{
  process.stdout.write(JSON.stringify(await attestFirstIssuerLive())+'\n');
 }catch(e){
  const code=typeof e?.message==='string'&&/^T1F_LIVE_[A-Z0-9_]{4,90}$/.test(e.message)?
   e.message:'T1F_LIVE_NOT_ATTESTED';
  process.stderr.write(code+'\n');process.exitCode=1;
 }
}
