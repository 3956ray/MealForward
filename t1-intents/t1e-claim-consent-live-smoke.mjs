/**
 * T1-E real public HTTPS Claim Consent mode negative gate.
 * NO sessions or signatures, NO mock funding, NO wallet/send RPC, NO Claim
 * writes. Safe to run against live. This is NOT a human EIP712 acceptance.
 */
const ORIGIN='https://mealforward-t1e-claim-laodao.onrender.com';
const ensure=(ok,code)=>{if(!ok)throw Error(code)};
const allowed=new Set([
 '/','/?utm_source=chatgpt.com','/health','/v1/t1e/status',
 '/v1/identity/setup','/v1/t1e/me','/v1/t1e/claim/me',
 '/v1/t1e/issuer/readiness','/t1e-claim.mjs',
 '/v1/t1e/claim/prepare','/v1/t1e/claim/renew',
 '/v1/t1e/claim/consent','/v1/t1e/issuer/issue',
 '/v1/t1e/report','/v1/t1e/settle',
 '/v1/t1/fund/prepare','/v1/identity/wallet/challenge'
]);
export async function attestT1EConsentLive({fetchImpl=fetch}={}){
 ensure(typeof fetchImpl==='function','T1E_CONSENT_LIVE_FETCH_REQUIRED');
 let count=0;
 async function hit(path,{method='GET',body,headers={}}={}){
  ensure(allowed.has(path),'T1E_CONSENT_LIVE_ROUTE_NOT_ALLOWLISTED');
  const response=await fetchImpl(ORIGIN+path,{
   method,redirect:'manual',cache:'no-store',
   headers:{Accept:'application/json',
    ...(method==='POST'?{'Content-Type':'application/json',Origin:ORIGIN}:{}),
    ...headers},
   ...(body===undefined?{}:{body:JSON.stringify(body)}),
   signal:AbortSignal.timeout(count++===0?120000:35000)
  });
  ensure(!response.headers.get('set-cookie'),'T1E_CONSENT_LIVE_NO_SESSION_MAY_BE_CREATED');
  const ct=response.headers.get('content-type')||'';
  return {code:response.status,headers:response.headers,
   data:ct.startsWith('application/json')?await response.json():await response.text()};
 }
 const status=await hit('/v1/t1e/status');
 ensure(status.code===200&&
  status.data.status==='T1E_RECIPIENT_CONSENT_ONLY'&&
  status.data.chainId===10143&&
  status.data.walletLoginEnabled===true&&
  status.data.recipientClaimWriteEnabled===true&&
  status.data.issuerIssueEnabled===false&&
  status.data.fundEnabled===false&&
  status.data.settleEnabled===false&&
  status.data.beneficiaryEligibilityVerified===false&&
  status.data.onchainRecipientSignatureEnforced===false&&
  status.data.originalCp30Connected===false,
  'T1E_CONSENT_LIVE_EXACT_STAGE_NOT_ATTESTED');
 const health=await hit('/health');
 ensure(health.code===200&&health.data.status==='ready',
  'T1E_CONSENT_LIVE_AUTH_DB_NOT_READY');
 const setup=await hit('/v1/identity/setup');
 ensure(setup.code===200&&setup.data.walletLoginOrigin===ORIGIN&&
  setup.data.walletLoginChainId===10143,
  'T1E_CONSENT_LIVE_SIWE_NOT_PINNED');
 const [root,utm,js]=await Promise.all([
  hit('/'),hit('/?utm_source=chatgpt.com'),hit('/t1e-claim.mjs')
 ]);
 ensure(root.code===200&&utm.code===200&&
  typeof root.data==='string'&&root.data===utm.data&&
  root.data.includes('领取授权')&&root.data.includes('MetaMask')&&
  root.data.includes('id="choose-account"')&&
  root.headers.get('x-frame-options')==='DENY'&&
  root.headers.get('cache-control')?.includes('no-store')&&
  js.code===200&&typeof js.data==='string'&&
  js.data.includes('wallet_requestPermissions')&&
  js.data.includes('eth_signTypedData_v4')&&
  !js.data.includes('eth_sendTransaction')&&
  !js.data.includes('eth_sendRawTransaction'),
  'T1E_CONSENT_LIVE_WALLET_INTERFACE_NOT_SAFELY_DEPLOYED');
 for(const path of ['/v1/t1e/me','/v1/t1e/claim/me','/v1/t1e/issuer/readiness']){
  const r=await hit(path);
  ensure(r.code===401&&r.data.error==='UNAUTHENTICATED',
   'T1E_CONSENT_LIVE_UNAUTHENTICATED_PRIVATE_GET_EXPOSED');
 }
 // Consent-stage writes deliberately require real, role-pinned SIWE +
 // hashed session + CSRF; these probes create NO records.
 for(const path of [
  '/v1/t1e/claim/prepare','/v1/t1e/claim/renew',
  '/v1/t1e/claim/consent'
 ]){
  const r=await hit(path,{method:'POST',body:{}});
  ensure(r.code===401&&r.data.error==='UNAUTHENTICATED',
   'T1E_CONSENT_LIVE_UNAUTHENTICATED_CLAIM_MUTATION');
 }
 for(const path of [
  '/v1/t1e/issuer/issue','/v1/t1e/report','/v1/t1e/settle'
 ]){
  const r=await hit(path,{method:'POST',body:{}});
  ensure(r.code===405&&r.data.error==='T1E_ISSUE_AND_SETTLEMENT_DISABLED',
   'T1E_CONSENT_LIVE_ISSUE_OR_PAYOUT_EXPOSED');
 }
 const wrongOrigin=await hit('/v1/t1e/claim/prepare',{
  method:'POST',body:{},headers:{Origin:'https://attacker.invalid'}
 });
 ensure(wrongOrigin.code===403&&wrongOrigin.data.error==='T1E_ORIGIN_DENIED',
  'T1E_CONSENT_LIVE_CROSS_ORIGIN_POST_ALLOWED');
 const forgedWallet=await hit('/v1/t1e/claim/prepare',{
  method:'POST',body:{},
  headers:{'X-Wallet-Address':'0x2539fefe77a5ce4d09d2225c2e8a7517b22b9135'}
 });
 ensure(forgedWallet.code===403&&forgedWallet.data.error==='T1E_ORIGIN_DENIED',
  'T1E_CONSENT_LIVE_FORGED_WALLET_HEADER_ALLOWED');
 const fund=await hit('/v1/t1/fund/prepare',{method:'POST',body:{}});
 ensure(![200,201,202].includes(fund.code),
  'T1E_CONSENT_LIVE_FUND_ROUTE_OPEN');
 const challenge=await hit('/v1/identity/wallet/challenge',{
  method:'POST',body:{address:'0x2539fefe77a5ce4d09d2225c2e8a7517b22b9135'}
 });
 ensure(challenge.code===403&&challenge.data.error==='CSRF',
  'T1E_CONSENT_LIVE_NO_PRES_SESSION_CHALLENGE_ALLOWED');
 return Object.freeze({
  status:'T1E_LIVE_CLAIM_CONSENT_HTTP_NEGATIVE_PASS',
  requests:count,chainId:10143,
  sessionlessClaimWritesDenied:true,
  issuerIssueFundSettleDisabled:true,
  noOnchainTransactions:true,
  noClaimCreatedByThisProbe:true,
  humanConsentStillRequired:true
 });
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 try{process.stdout.write(JSON.stringify(await attestT1EConsentLive())+'\n')}
 catch(e){
  const code=typeof e?.message==='string'&&
   /^T1E_CONSENT_LIVE_[A-Z0-9_]{3,90}$/.test(e.message)?
   e.message:'T1E_CONSENT_LIVE_NOT_ATTESTED';
  process.stderr.write(code+'\n');process.exitCode=1;
 }
}
