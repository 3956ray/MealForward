/**
 * Independent REAL public Render HTTPS check for the T1-E role-only stage.
 * Uses disposable GitHub-runner EIP191 keys for a SYNTHETIC recipient test.
 * Does not store private keys, claim a voucher, sign actual Issuer, or send
 * blockchain transactions. Only the one literal Render origin is accepted.
 */
import {Wallet} from 'ethers';
const ORIGIN='https://mealforward-t1e-role-proof-laodao.onrender.com';
const check=(ok,c)=>{if(!ok)throw Error(c)};
export async function verifyT1ERoleProofCloud({fetchImpl=fetch}={}){
 check(typeof fetchImpl==='function','T1E_CLOUD_FETCH_REQUIRED');
 let calls=0;
 async function request(path,{method='GET',body=null,headers={}}={}){
  check([
   '/','/?utm_source=chatgpt.com',
   '/health','/v1/t1e/status',
   '/t1e-role-proof.mjs','/t1e-role-proof.css','/t1e-wallet-roles.mjs',
   '/v1/t1e/role/challenge','/v1/t1e/role/verify',
   '/v1/t1e/claim/prepare','/v1/t1e/issuer/issue',
   '/v1/t1e/report','/v1/t1e/settle','/v1/t1/fund/prepare'
  ].includes(path),'T1E_CLOUD_REVIEWED_ROUTE_ONLY');
  const response=await fetchImpl(ORIGIN+path,{
   method,cache:'no-store',redirect:'error',
   headers:{
    Accept:'application/json',
    ...(method==='POST'?{'Content-Type':'application/json',Origin:ORIGIN}:{}),
    ...headers
   },
   ...(body===null?{}:{body:JSON.stringify(body)}),
   signal:AbortSignal.timeout(calls++===0?110000:24000)
  });
  check(!response.headers.get('set-cookie'),'T1E_CLOUD_PUBLIC_COOKIE_UNEXPECTED');
  const ct=response.headers.get('content-type')||'';
  return {code:response.status,body:ct.startsWith('application/json')?
   await response.json():await response.text(),headers:response.headers};
 }
 const health=await request('/health');
 check(health.code===200&&health.body?.noDatabase===true&&health.body?.noFunds===true,
  'T1E_CLOUD_ROLE_ONLY_PROCESS_NOT_ALIVE');
 const status=await request('/v1/t1e/status');
 check(status.code===200&&
  status.body?.status==='T1E_ISSUER_RECIPIENT_WALLET_PROOF_READY'&&
  status.body?.walletProofOnly===true&&
  status.body?.claimWriteEnabled===false&&
  status.body?.onchainIssueEnabled===false&&
  status.body?.fundEnabled===false&&
  status.body?.settleEnabled===false&&
  status.body?.chainId===10143,
  'T1E_CLOUD_ROLE_PROOF_MODE_NOT_READY');
 for(const path of ['/','/?utm_source=chatgpt.com']){
  const home=await request(path);
  check(home.code===200&&typeof home.body==='string'&&
   home.body.includes('T1-E')&&home.body.includes('Issuer')&&
   home.body.includes('id="recipient-switch"')&&
   home.body.includes('id="recipient-current-wallet"')&&
   home.headers.get('x-frame-options')==='DENY'&&
   home.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"),
   'T1E_CLOUD_TRACKED_PUBLIC_SITE_DENIED');
 }
 for(const path of ['/t1e-role-proof.mjs','/t1e-role-proof.css','/t1e-wallet-roles.mjs']){
  const asset=await request(path);
  check(asset.code===200&&typeof asset.body==='string','T1E_CLOUD_ASSET_NOT_PUBLIC');
  if(path==='/t1e-role-proof.mjs')check(asset.body.includes('personal_sign')&&
   asset.body.includes('wallet_requestPermissions')&&
   asset.body.includes('classifyT1EWallet')&&
   asset.body.includes('recipient-current-wallet')&&
   !asset.body.includes('eth_sendTransaction')&&
   !asset.body.includes('eth_signTypedData_v4'),
   'T1E_CLOUD_UNSAFE_PUBLIC_WALLET_API');
  if(path==='/t1e-wallet-roles.mjs')check(
   asset.body.includes('RECIPIENT_MUST_BE_INDEPENDENT')&&
   asset.body.includes('REGISTERED_ROLES')&&
   !asset.body.includes('eth_sendTransaction'),
   'T1E_CLOUD_AUTHORITY_PREFLIGHT_NOT_DEPLOYED');
 }
 const fake=Wallet.createRandom();
 const challenge=await request('/v1/t1e/role/challenge',{
  method:'POST',body:{role:'recipient',address:fake.address}
 });
 check(challenge.code===200&&challenge.body?.noWalletTransaction===true,
  'T1E_CLOUD_RECIPIENT_CHALLENGE_DENIED');
 const signed=await fake.signMessage(challenge.body.message);
 const verified=await request('/v1/t1e/role/verify',{
  method:'POST',body:{challengeId:challenge.body.challengeId,signature:signed}
 });
 check(verified.code===200&&verified.body?.status==='RECIPIENT_WALLET_CONTROL_PROVED'&&
  verified.body?.noClaimCreated===true&&verified.body?.noOnchainIssue===true,
 'T1E_CLOUD_REAL_EIP191_PROOF_FAILED');
 const replay=await request('/v1/t1e/role/verify',{
  method:'POST',body:{challengeId:challenge.body.challengeId,signature:signed}
 });
 check(replay.code===409,'T1E_CLOUD_EIP191_REPLAY_UNSAFE');
 const fakeIssuer=await request('/v1/t1e/role/challenge',{
  method:'POST',body:{role:'issuer',address:fake.address}
 });
 check(fakeIssuer.code===403&&fakeIssuer.body?.error==='ONLY_PINNED_ISSUER_ALLOWED',
 'T1E_CLOUD_NONISSUER_CAN_PROVE_ROLE');
 const cross=await request('/v1/t1e/role/challenge',{
  method:'POST',body:{role:'recipient',address:fake.address},
  headers:{Origin:'https://untrusted.invalid'}
 });
 check(cross.code===403,'T1E_CLOUD_CROSS_ORIGIN_WRITE_OPEN');
 for(const path of [
  '/v1/t1e/claim/prepare','/v1/t1e/issuer/issue','/v1/t1e/report',
  '/v1/t1e/settle','/v1/t1/fund/prepare'
 ]){
  const denied=await request(path,{method:'POST',body:{}});
  check(denied.code===405&&
   denied.body?.error==='T1E_ROLE_PROOF_ONLY_NO_CLAIM_OR_ISSUE',
   'T1E_CLOUD_UNSAFE_FINANCIAL_ROUTE');
 }
 return Object.freeze({
  status:'T1E_REAL_RENDER_ROLE_ONLY_EIP191_PUBLIC_HTTP_PASS',
  publicRouteChecks:calls,chainId:10143,
  syntheticRecipientWalletPassed:true,syntheticIssuerImpersonationDenied:true,
  duplicateChallengeDenied:true,
  onchainIssueTransactions:0,claimsCreated:0,
  noDatabaseCredentials:true,
  ownerWalletAcceptanceStillRequired:true
 });
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 try{process.stdout.write(JSON.stringify(await verifyT1ERoleProofCloud())+'\n');}
 catch(e){
  const c=typeof e?.message==='string'&&/^T1E_CLOUD_[A-Z_0-9]+$/.test(e.message)?
   e.message:'T1E_CLOUD_ROLE_PROOF_UNAVAILABLE';
  process.stderr.write(c+'\n');process.exitCode=1;
 }
}
