/** Independent public HTTPS safety attestation for exact T1-E Claim staging host.
 * Real Render origin only; absolutely NO secret, signer or user wallet.
 * GET and unauthenticated negative POST only, no financial or Claim writes.
 */
const ORIGIN='https://mealforward-t1e-claim-laodao.onrender.com';
const check=(x,c)=>{if(!x)throw Error(c)};
export async function attestPublicT1EClaimSetup({fetchImpl=fetch}={}){
 check(typeof fetchImpl==='function','T1E_SETUP_CLOUD_FETCH_REQUIRED');
 let calls=0;
 const routes=new Set([
  '/','/?utm_source=chatgpt.com','/health','/v1/t1e/status',
  '/t1e-claim.css','/t1e-claim.mjs',
  '/v1/auth/pre-session','/v1/identity/wallet/challenge',
  '/v1/t1e/claim/prepare','/v1/t1e/claim/renew',
  '/v1/t1e/claim/consent','/v1/t1e/issuer/issue',
  '/v1/t1e/report','/v1/t1e/settle','/v1/t1/fund/prepare'
 ]);
 const request=async(path,method='GET')=>{
  check(routes.has(path),'T1E_CLOUD_ONLY_REVIEWED_ROUTES');
  const r=await fetchImpl(ORIGIN+path,{
   method,cache:'no-store',redirect:'error',
   headers:method==='POST'?{
    Origin:ORIGIN,Accept:'application/json',
    'Content-Type':'application/json'
   }:{Accept:'application/json'},
   ...(method==='POST'?{body:'{}'}:{}),
   signal:AbortSignal.timeout(calls++===0?120000:25000)
  });
  check(!r.headers.get('set-cookie'),'T1E_CLOUD_SETUP_SESSION_COOKIE_FORBIDDEN');
  const t=r.headers.get('content-type')||'';
  return {code:r.status,payload:t.startsWith('application/json')?
   await r.json():await r.text(),headers:r.headers};
 };
 const status=await request('/v1/t1e/status');
 check(status.code===200&&
  status.payload?.status==='T1E_SAFE_SETUP_ONLY_NO_SESSIONS'&&
  status.payload?.chainId===10143&&
  status.payload?.independentRecipientLoginEnabled===false&&
  status.payload?.claimWriteEnabled===false&&
  status.payload?.issuerIssueEnabled===false&&
  status.payload?.fundingEnabled===false&&
  status.payload?.settleEnabled===false&&
  status.payload?.originalCp30Connected===false,
  'T1E_CLOUD_SETUP_SCOPE_NOT_SAFE');
 const health=await request('/health');
 check(health.code===200&&health.payload?.noDatabase===true,
  'T1E_CLOUD_SETUP_NO_DATABASE_GATE_FAILED');
 const home=await request('/');
 const tracked=await request('/?utm_source=chatgpt.com');
 check(home.code===200&&tracked.code===200&&
  home.payload===tracked.payload&&
  home.payload.includes('T1E_SAFE_SETUP_ONLY')&&
  !home.payload.includes('<script')&&
  home.headers.get('x-frame-options')==='DENY'&&
  home.headers.get('content-security-policy')?.includes("default-src 'none'"),
  'T1E_CLOUD_SETUP_PUBLIC_HTML_MISMATCH');
 const css=await request('/t1e-claim.css');
 check(css.code===200&&css.payload.includes('.hero'),
  'T1E_CLOUD_SETUP_CSS_INACCESSIBLE');
 const javascript=await request('/t1e-claim.mjs');
 check(javascript.code===404,'T1E_CLOUD_SETUP_WALLET_JS_EXPOSED');
 for(const path of [
  '/v1/auth/pre-session','/v1/identity/wallet/challenge',
  '/v1/t1e/claim/prepare','/v1/t1e/claim/renew',
  '/v1/t1e/claim/consent','/v1/t1e/issuer/issue',
  '/v1/t1e/report','/v1/t1e/settle','/v1/t1/fund/prepare'
 ]){
  const reject=await request(path,'POST');
  check(reject.code===405&&
   reject.payload?.error==='T1E_SETUP_ALL_WRITES_DISABLED',
   'T1E_CLOUD_SETUP_UNAUTHORIZED_BUSINESS_WRITE_'+path.replaceAll('/','_'));
 }
 return Object.freeze({
  status:'T1E_REAL_PUBLIC_SAFE_SETUP_NO_DATABASE_HTTP_PASS',
  requests:calls,chainId:10143,noPrivateDatabase:true,
  noWalletLogin:true,noClaims:true,noIssue:true,noFunds:true,noSettle:true,
  originalFundingUntouched:true
 });
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 try{process.stdout.write(JSON.stringify(await attestPublicT1EClaimSetup())+'\n')}
 catch(e){
  const code=typeof e?.message==='string'&&/^T1E_CLOUD_[A-Z0-9_]{4,100}$/.test(e.message)?
   e.message:'T1E_CLOUD_SETUP_NOT_ATTESTED';
  process.stderr.write(code+'\n');process.exitCode=1;
 }
}
