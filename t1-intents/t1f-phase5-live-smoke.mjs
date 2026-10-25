/**
 * Public HTTPS Phase5 typed EIP712 PRACTICE negative gate, no private key,
 * no cookie, no valid owner/donor signature, no DB or blockchain mutation.
 */
const ORIGIN='https://mealforward-t1e-role-proof-laodao.onrender.com';
const ROUTES=new Set([
 '/health','/v1/t1e/status','/v1/t1f/phase4/status',
 '/t1f-phase5.html','/t1f-phase5.html?utm_source=chatgpt.com',
 '/t1f-phase5.html?wallet=0x123',
 '/t1f-phase5.html?utm_source=chatgpt.com&utm_source=forged',
 '/t1f-phase5.mjs','/t1f-phase5.mjs?utm_source=chatgpt.com',
 '/v1/t1f/phase5/status','/v1/t1f/phase5/status?wallet=0x123',
 '/v1/t1f/phase5/challenge','/v1/t1f/phase5/verify',
 '/v1/t1f/phase5/release','/v1/t1f/phase5/issue',
 '/v1/t1e/issuer/issue','/v1/t1e/claim/prepare',
 '/v1/t1e/settle','/v1/t1/fund/prepare'
]);
function assert(v,code){if(!v)throw Error(code)}
export async function attestPhase5Live({
 fetchImpl=fetch,expected=process.env.EXPECT_PHASE5_TYPED_PRACTICE
}={}){
 assert(['true','false'].includes(expected),'T1F_PHASE5_EXPECTATION_MISSING');
 const enabled=expected==='true';let requests=0;
 async function get(path,{method='GET',body,headers={}}={}){
  assert(ROUTES.has(path),'T1F_PHASE5_UNREVIEWED_ROUTE');
  const res=await fetchImpl(ORIGIN+path,{
   method,cache:'no-store',redirect:'manual',
   headers:{Accept:'application/json',
    ...(method==='POST'?{'Content-Type':'application/json',Origin:ORIGIN}:{}),
    ...headers},
   ...(body===undefined?{}:{body:JSON.stringify(body)}),
   signal:AbortSignal.timeout(requests++===0?120000:40000)
  });
  assert(!res.headers.get('set-cookie'),'T1F_PHASE5_COOKIE_FORBIDDEN');
  const content=(res.headers.get('content-type')||'').startsWith('application/json')?
   await res.json():await res.text();
  return {status:res.status,body:content,headers:res.headers};
 }
 const [h,old,phase4,page,tracked,script]=await Promise.all([
  get('/health'),get('/v1/t1e/status'),get('/v1/t1f/phase4/status'),
  get('/t1f-phase5.html'),
  get('/t1f-phase5.html?utm_source=chatgpt.com'),
  get('/t1f-phase5.mjs')
 ]);
 assert(h.status===200&&h.body.noDatabase===true&&h.body.noFunds===true,
  'T1F_PHASE5_HEALTH_NOT_ISOLATED');
 assert(old.status===200&&old.body.fundEnabled===false&&
  old.body.settleEnabled===false&&old.body.onchainIssueEnabled===false,
  'T1F_PHASE5_OLD_ROLE_PROOF_CHANGED');
 assert(phase4.status===200&&phase4.body.eip712RecoveryReleaseEnabled===false,
  'T1F_PHASE5_PHASE4_COMPATIBILITY_FAILED');
 const status=await get('/v1/t1f/phase5/status');
 if(enabled){
  assert(status.status===200&&
   status.body.status==='T1F_PHASE5_TYPED_WALLET_PRACTICE_ONLY'&&
   status.body.chainId===10143&&
   status.body.ownerWallet==='0xc4f8a468f10d5f98dcff3282516125e97f26433b'&&
   status.body.donorWallet==='0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952'&&
   status.body.typedDataDomain==='MealForward Phase5 Typed Wallet Practice'&&
   status.body.liveReleaseDomainMatch===false&&
   status.body.createsRecoveryApproval===false&&
   status.body.canIssue===false&&status.body.canFund===false&&
   status.body.canSettle===false&&status.body.databaseConnected===false&&
   status.body.storesSignature===false&&
   page.status===200&&tracked.status===200&&page.body===tracked.body&&
   page.body.includes('PRACTICE')&&page.body.includes('Owner')&&
   page.body.includes('Donor')&&
   page.headers.get('content-security-policy')?.includes("frame-ancestors 'none'")&&
   script.status===200&&script.body.includes('eth_signTypedData_v4')&&
   !script.body.includes('eth_sendTransaction')&&
   !script.body.includes('eth_sendRawTransaction'),
   'T1F_PHASE5_ENABLED_PUBLIC_REQUIREMENTS_FAILED');
 }else{
  assert([404,405].includes(status.status)&&
   [404,405].includes(page.status)&&[404,405].includes(script.status),
   'T1F_PHASE5_MUST_STAY_HIDDEN_WHEN_OFF');
 }
 for(const unsafe of ['/t1f-phase5.html?wallet=0x123',
  '/t1f-phase5.html?utm_source=chatgpt.com&utm_source=forged',
  '/t1f-phase5.mjs?utm_source=chatgpt.com',
  '/v1/t1f/phase5/status?wallet=0x123']){
  assert((await get(unsafe)).status===403,
   'T1F_PHASE5_WALLET_QUERY_OR_SCRIPT_OVERRIDE_ALLOWED');
 }
 const forbidden=await get('/v1/t1f/phase5/challenge',{method:'POST',
  body:{role:'owner',address:'0x'+'8'.repeat(40)}});
 assert(enabled?forbidden.status===403:[404,405].includes(forbidden.status),
  'T1F_PHASE5_WRONG_WALLET_CHALLENGE_ALLOWED');
 const unsigned=await get('/v1/t1f/phase5/verify',{method:'POST',body:{}});
 assert(enabled?unsigned.status===422:[404,405].includes(unsigned.status),
  'T1F_PHASE5_UNAUTHENTICATED_SIGNATURE_VERIFIED');
 for(const path of ['/v1/t1f/phase5/release','/v1/t1f/phase5/issue',
  '/v1/t1e/issuer/issue','/v1/t1e/claim/prepare',
  '/v1/t1e/settle','/v1/t1/fund/prepare']){
  assert((await get(path,{method:'POST',body:{}})).status===405,
   'T1F_PHASE5_FINANCIAL_ROUTE_ENABLED');
 }
 assert((await get('/v1/t1f/phase5/challenge',{method:'POST',
  body:{},headers:{Origin:'https://attacker.invalid'}})).status===403,
  'T1F_PHASE5_CROSS_ORIGIN_POST');
 assert((await get('/v1/t1f/phase5/challenge',{method:'POST',
  body:{},headers:{'X-Wallet-Address':'0xc4f8a468f10d5f98dcff3282516125e97f26433b'}})).status===403,
  'T1F_PHASE5_FORGED_WALLET_HEADER_ALLOWED');
 return Object.freeze({
  status:enabled?'T1F_PHASE5_TYPED_PRACTICE_PUBLIC_NEGATIVE_PASS':
   'T1F_PHASE5_DISABLED_PUBLIC_NEGATIVE_PASS',
  enabled,requests,realWalletSignaturesCollected:0,
  dbWrites:0,onchainTransactions:0,recoveryApproved:false
 });
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 try{process.stdout.write(JSON.stringify(await attestPhase5Live())+'\n')}
 catch(e){process.stderr.write('T1F_PHASE5_LIVE_NOT_ATTESTED: '+
  String(e?.message||'unknown')+'\n');process.exitCode=1}
}
