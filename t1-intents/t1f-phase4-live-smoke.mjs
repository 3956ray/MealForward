/**
 * External Render HTTP negative gate for the isolated Owner+Donor proof
 * service. NO secret keys, cookies, signature, nonce reservation, DB writes
 * or blockchain RPC. Pass EXPECT_PHASE4_PROOF_ENABLED=true/false explicitly.
 */
const ORIGIN='https://mealforward-t1e-role-proof-laodao.onrender.com';
const allow=new Set([
 '/health','/','/?utm_source=chatgpt.com','/v1/t1e/status',
 '/t1f-phase4.html','/t1f-phase4.html?utm_source=chatgpt.com',
 '/t1f-phase4.html?utm_source=chatgpt.com&utm_medium=referral',
 '/t1f-phase4.html?wallet=0x123',
 '/t1f-phase4.html?utm_source=chatgpt.com&utm_source=forged',
 '/t1f-phase4.mjs','/t1f-phase4.mjs?utm_source=chatgpt.com',
 '/v1/t1f/phase4/status','/v1/t1f/phase4/status?wallet=0x123',
 '/v1/t1f/phase4/challenge','/v1/t1f/phase4/verify',
 '/v1/t1f/phase4/release','/v1/t1f/phase4/issue',
 '/v1/t1e/issuer/issue','/v1/t1e/claim/prepare',
 '/v1/t1e/settle','/v1/t1/fund/prepare'
]);
const ensure=(v,code)=>{if(!v)throw Error(code)};
export async function attestPhase4Live({
 fetchImpl=fetch,expect=process.env.EXPECT_PHASE4_PROOF_ENABLED
}={}){
 ensure(['true','false'].includes(expect),'T1F_PHASE4_LIVE_MODE_REQUIRED');
 ensure(typeof fetchImpl==='function','T1F_PHASE4_LIVE_FETCH_REQUIRED');
 const enabled=expect==='true';
 let requests=0;
 async function get(path,{method='GET',body,headers={}}={}){
  ensure(allow.has(path),'T1F_PHASE4_LIVE_ROUTE_NOT_ALLOWED');
  const r=await fetchImpl(ORIGIN+path,{
   method,cache:'no-store',redirect:'manual',
   headers:{Accept:'application/json',
    ...(method==='POST'?{'Content-Type':'application/json',Origin:ORIGIN}:{}),
    ...headers},
   ...(body===undefined?{}:{body:JSON.stringify(body)}),
   signal:AbortSignal.timeout(requests++===0?120000:40000)
  });
  ensure(r.headers.get('set-cookie')===null,'T1F_PHASE4_LIVE_SESSION_COOKIE_FORBIDDEN');
  const type=r.headers.get('content-type')||'';
  const content=type.startsWith('application/json')?await r.json():await r.text();
  return {status:r.status,body:content,headers:r.headers};
 }
 const [health,old]=await Promise.all([get('/health'),get('/v1/t1e/status')]);
 ensure(health.status===200&&health.body.noDatabase===true&&
  health.body.noFunds===true,'T1F_PHASE4_LIVE_HEALTH_NOT_ISOLATED');
 ensure(old.status===200&&old.body.walletProofOnly===true&&
  old.body.fundEnabled===false&&old.body.settleEnabled===false&&
  old.body.onchainIssueEnabled===false,
  'T1F_PHASE4_LIVE_T1E_LEGACY_PROOF_REGRESSED');
 const [status,page,tracked,multitracked,js,unsafe,duplicate,scriptTracked]=
  await Promise.all([
   get('/v1/t1f/phase4/status'),get('/t1f-phase4.html'),
   get('/t1f-phase4.html?utm_source=chatgpt.com'),
   get('/t1f-phase4.html?utm_source=chatgpt.com&utm_medium=referral'),
   get('/t1f-phase4.mjs'),get('/t1f-phase4.html?wallet=0x123'),
   get('/t1f-phase4.html?utm_source=chatgpt.com&utm_source=forged'),
   get('/t1f-phase4.mjs?utm_source=chatgpt.com')
  ]);
 if(enabled){
  ensure(status.status===200&&
   status.body.status==='T1F_PHASE4_OWNER_DONOR_SIWE_PROOF_ONLY'&&
   status.body.ownerWallet==='0xc4f8a468f10d5f98dcff3282516125e97f26433b'&&
   status.body.donorWallet==='0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952'&&
   status.body.chainId===10143&&
   status.body.noPersistentSessions===true&&
   status.body.databaseConnected===false&&
   status.body.eip712RecoveryReleaseEnabled===false&&
   status.body.successorIssueEnabled===false&&
   status.body.fundEnabled===false&&status.body.settleEnabled===false&&
   page.status===200&&tracked.status===200&&multitracked.status===200&&
   tracked.body===page.body&&multitracked.body===page.body&&
   page.body.includes('Owner')&&page.body.includes('Donor')&&
   page.headers.get('content-security-policy')?.includes("frame-ancestors 'none'")&&
   js.status===200&&js.body.includes('personal_sign')&&
   js.body.includes('wallet_requestPermissions')&&
   !js.body.includes('eth_sendTransaction')&&
   !js.body.includes('eth_signTypedData_v4'),
   'T1F_PHASE4_LIVE_ENABLED_UI_OR_SERVICE_NOT_ATTESTED');
 }else{
  ensure([404,405].includes(status.status)&&
   [404,405].includes(page.status)&&[404,405].includes(js.status),
   'T1F_PHASE4_LIVE_DISABLED_STAGE_EXPOSED');
 }
 ensure(unsafe.status===403&&duplicate.status===403&&scriptTracked.status===403,
  'T1F_PHASE4_LIVE_UNSAFE_TRACKING_OR_OVERRIDE_ALLOWED');
 const wrongWallet=await get('/v1/t1f/phase4/challenge',{
  method:'POST',body:{role:'owner',address:'0x'+'8'.repeat(40)}
 });
 ensure(enabled?wrongWallet.status===403:
  [404,405].includes(wrongWallet.status),
  'T1F_PHASE4_LIVE_WRONG_WALLET_NOT_BLOCKED');
 const wrongSignature=await get('/v1/t1f/phase4/verify',{
  method:'POST',body:{}
 });
 ensure(enabled?wrongSignature.status===422:
  [404,405].includes(wrongSignature.status),
  'T1F_PHASE4_LIVE_UNSIGNED_VERIFICATION_ACCEPTED');
 for(const path of ['/v1/t1f/phase4/release','/v1/t1f/phase4/issue',
  '/v1/t1e/issuer/issue','/v1/t1e/claim/prepare',
  '/v1/t1e/settle','/v1/t1/fund/prepare']){
  const r=await get(path,{method:'POST',body:{}});
  ensure(r.status===405,'T1F_PHASE4_LIVE_FINANCIAL_OR_RELEASE_API_OPEN');
 }
 const cross=await get('/v1/t1f/phase4/challenge',{
  method:'POST',body:{},headers:{Origin:'https://evil.invalid'}
 });
 ensure(cross.status===403,'T1F_PHASE4_LIVE_CROSS_ORIGIN_ALLOWED');
 const forged=await get('/v1/t1f/phase4/challenge',{
  method:'POST',body:{},
  headers:{'X-Wallet-Address':'0xc4f8a468f10d5f98dcff3282516125e97f26433b'}
 });
 ensure(forged.status===403,'T1F_PHASE4_LIVE_WALLET_HEADER_FORGED');
 const query=await get('/v1/t1f/phase4/status?wallet=0x123');
 ensure(query.status===403,'T1F_PHASE4_LIVE_QUERY_OVERRIDE_ALLOWED');
 return Object.freeze({
  status:enabled?'T1F_PHASE4_OWNER_DONOR_PUBLIC_PROOF_NEGATIVE_PASS':
   'T1F_PHASE4_PROOF_DISABLED_PUBLIC_NEGATIVE_PASS',
  enabled,requests,chainId:10143,nonceReservations:0,
  walletSignaturesCollected:0,newClaims:0,newFund:0,
  onchainTransactions:0,liveRecoveryReleased:false
 });
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 try{process.stdout.write(JSON.stringify(await attestPhase4Live())+'\n')}
 catch(e){
  process.stderr.write(
   typeof e?.message==='string'&&/^T1F_PHASE4_LIVE_[A-Z0-9_]{4,100}$/.test(e.message)?
    e.message:'T1F_PHASE4_LIVE_NOT_ATTESTED'
  +'\n');process.exitCode=1;
 }
}
