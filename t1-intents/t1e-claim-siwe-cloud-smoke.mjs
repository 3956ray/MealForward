/**
 * T1-E REAL Render HTTPS acceptance: the owner-configured CLAIM_SIWE_ONLY
 * is LIVE and every account-bound endpoint is private.
 *
 * ALL requests are read-only GETs or deliberate unauthenticated POST denials.
 * No session creation, no Claim, no EIP712, no chain writes, no signer key.
 * The target is a single hard-coded Render origin; no external URLs accepted.
 */
const ORIGIN='https://mealforward-t1e-claim-laodao.onrender.com';
const CHECK=(ok,code)=>{if(!ok)throw Error(code)};
const ALLOWED=new Set([
 '/','/?utm_source=chatgpt.com','/health','/v1/t1e/status',
 '/v1/t1e/status?wallet=untrusted','/v1/identity/setup','/v1/me',
 '/v1/t1e/me','/v1/t1e/claim/me','/v1/t1e/issuer/readiness',
 '/t1e-claim.mjs','/t1e-claim.css','/v1/t1e/claim/prepare',
 '/v1/t1e/claim/consent','/v1/t1e/claim/renew',
 '/v1/t1e/issuer/issue','/v1/t1e/report','/v1/t1e/settle',
 '/v1/t1/fund/prepare','/v1/identity/wallet/challenge'
]);
export async function attestT1ESiweReadOnlyCloud({fetchImpl=fetch}={}){
 CHECK(typeof fetchImpl==='function','T1E_READONLY_CLOUD_FETCH_REQUIRED');
 let requestCount=0;
 async function call(path,{method='GET',body,headers={}}={}){
  CHECK(ALLOWED.has(path),'T1E_READONLY_CLOUD_UNREVIEWED_ROUTE');
  const res=await fetchImpl(ORIGIN+path,{
   method,cache:'no-store',redirect:'manual',
   headers:{
    Accept:'application/json',
    ...(method==='POST'?{'Content-Type':'application/json',Origin:ORIGIN}:{}),
    ...headers
   },
   ...(body===undefined?{}:{body:JSON.stringify(body)}),
   signal:AbortSignal.timeout(requestCount++===0?120000:35000)
  });
  CHECK(!res.headers.get('set-cookie'),'T1E_READONLY_CLOUD_UNEXPECTED_SESSION_COOKIE');
  const contentType=res.headers.get('content-type')||'';
  const payload=contentType.startsWith('application/json')?
   await res.json():await res.text();
  return {code:res.status,data:payload,headers:res.headers};
 }
 const status=await call('/v1/t1e/status');
 CHECK(status.code===200&&
  status.data?.status==='T1E_ISOLATED_SIWE_READ_ONLY'&&
  status.data?.chainId===10143&&
  status.data?.walletLoginEnabled===true&&
  status.data?.recipientClaimWriteEnabled===false&&
  status.data?.issuerIssueEnabled===false&&
  status.data?.fundEnabled===false&&
  status.data?.settleEnabled===false&&
  status.data?.beneficiaryEligibilityVerified===false&&
  status.data?.onchainRecipientSignatureEnforced===false&&
  status.data?.originalCp30Connected===false,
  'T1E_READONLY_CLOUD_STRICT_STAGE_NOT_CONFIRMED');
 const health=await call('/health');
 CHECK(health.code===200&&health.data?.status==='ready',
  'T1E_READONLY_CLOUD_PRIVATE_AUTH_DB_HEALTH_FAILED');
 const setup=await call('/v1/identity/setup');
 CHECK(setup.code===200&&setup.data?.walletLoginChainId===10143&&
  setup.data?.walletLoginOrigin===ORIGIN,
  'T1E_READONLY_CLOUD_PINNED_SIWE_SETUP_INVALID');
 const root=await call('/');
 const tracked=await call('/?utm_source=chatgpt.com');
 CHECK(root.code===200&&tracked.code===200&&
  typeof root.data==='string'&&root.data===tracked.data&&
  root.data.includes('T1-E')&&root.data.includes('MetaMask')&&
  root.data.includes('领取授权')&&
  root.headers.get('cache-control')?.includes('no-store')&&
  root.headers.get('x-frame-options')==='DENY'&&
  root.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"),
  'T1E_READONLY_CLOUD_PUBLIC_CLAIM_HTML_MISSING');
 const js=await call('/t1e-claim.mjs');
 const css=await call('/t1e-claim.css');
 CHECK(js.code===200&&css.code===200&&
  typeof js.data==='string'&&
  js.data.includes('personal_sign')&&
  js.data.includes("mode!=='CLAIM_CONSENT'")&&
  js.data.includes('eth_signTypedData_v4')&&
  !js.data.includes('eth_sendTransaction')&&
  !js.data.includes('eth_sendRawTransaction')&&
  css.data?.includes('.hero'),
  'T1E_READONLY_CLOUD_WALLET_UI_UNSAFE');
 for(const path of [
  '/v1/me','/v1/t1e/me','/v1/t1e/claim/me',
  '/v1/t1e/issuer/readiness'
 ]){
  const result=await call(path);
  CHECK(result.code===401&&result.data?.error==='UNAUTHENTICATED',
   'T1E_READONLY_CLOUD_PRIVATE_ENDPOINT_NOT_401');
 }
 for(const path of [
  '/v1/t1e/claim/prepare','/v1/t1e/claim/consent',
  '/v1/t1e/claim/renew','/v1/t1e/issuer/issue',
  '/v1/t1e/report','/v1/t1e/settle'
 ]){
  const result=await call(path,{method:'POST',body:{}});
  CHECK(result.code===405&&[
   'T1E_CLAIM_WRITES_DISABLED',
   'T1E_ISSUE_AND_SETTLEMENT_DISABLED'
  ].includes(result.data?.error),
   'T1E_READONLY_CLOUD_ANY_FINANCIAL_OR_CLAIM_POST_ACCEPTED');
 }
 const originalFund=await call('/v1/t1/fund/prepare',{method:'POST',body:{}});
 CHECK(originalFund.code!==200&&originalFund.code!==201&&
  originalFund.code!==202,'T1E_READONLY_CLOUD_FUND_ROUTE_MUST_DENY');
 const wrongQuery=await call('/v1/t1e/status?wallet=untrusted');
 CHECK(wrongQuery.code===403,'T1E_READONLY_CLOUD_QUERY_PAYER_OVERRIDE_OPEN');
 const wrongWallet=await call('/v1/t1e/me',{
  headers:{'X-Wallet-Address':'0x2539fefe77a5ce4d09d2225c2e8a7517b22b9135'}
 });
 CHECK(wrongWallet.code===403,'T1E_READONLY_CLOUD_WALLET_HEADER_OVERRIDE_OPEN');
 const wrongOrigin=await call('/v1/t1e/claim/prepare',{
  method:'POST',body:{},headers:{Origin:'https://untrusted.invalid'}
 });
 CHECK(wrongOrigin.code===403,'T1E_READONLY_CLOUD_CROSS_ORIGIN_POST_OPEN');
 const challenge=await call('/v1/identity/wallet/challenge',{
  method:'POST',body:{address:'0x2539fefe77a5ce4d09d2225c2e8a7517b22b9135'}
 });
 CHECK(challenge.code===403&&challenge.data?.error==='CSRF',
  'T1E_READONLY_CLOUD_CHALLENGE_WITHOUT_PRE_SESSION_ALLOWED');
 return Object.freeze({
  status:'T1E_LIVE_CLAIM_SIWE_ONLY_HTTPS_GATE_PASS',
  chainId:10143,requests:requestCount,
  privateAuthDBHealth:true,sameOriginSIWEConfigured:true,
  unauthenticatedPrivateDataDenied:true,
  accountOverrideDenied:true,
  actualRecipientLoginNotYetTested:true,
  claimsCreated:0,transactionsBroadcast:0,
  originalFundingUntouched:true
 });
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 try{process.stdout.write(JSON.stringify(await attestT1ESiweReadOnlyCloud())+'\n')}
 catch(e){
  const code=typeof e?.message==='string'&&
   /^T1E_READONLY_CLOUD_[A-Z0-9_]{3,80}$/.test(e.message)?
   e.message:'T1E_READONLY_CLOUD_NOT_ATTESTED';
  process.stderr.write(code+'\n');process.exitCode=1;
 }
}
