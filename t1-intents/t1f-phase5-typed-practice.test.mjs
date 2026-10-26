import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {Wallet} from 'ethers';
import {readFileSync} from 'node:fs';
import {startT1ERoleProof,validateT1EProofConfig} from './t1e-role-proof-server.mjs';
import {PHASE5_TYPED_PRACTICE_DOMAIN,makePhase5TypedPractice}
 from './t1f-phase5-typed-practice.mjs';

const owner=Wallet.createRandom(),donor=Wallet.createRandom();
const port=await new Promise(resolve=>{
 const s=net.createServer();
 s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))});
});
const origin='http://127.0.0.1:'+port;
let now=1792740000;
const env={
 GITHUB_ACTIONS:'true',T1E_ROLE_PROOF_CI:'ack-loopback-only',
 T1E_DEPLOYMENT_STAGE:'ROLE_PROOF_ONLY',
 T1E_CLAIM_WRITES_ENABLED:'false',T1E_WALLET_TX_ENABLED:'false',
 T1E_SETTLEMENT_ENABLED:'false',
 T1F_PHASE4_PROOF_ENABLED:'true',T1F_PHASE5_TYPED_PRACTICE_ENABLED:'true',
 T1F_PHASE4_CI_ROLES:'ack-loopback-owner-donor',
 T1F_PHASE4_TEST_OWNER:owner.address,T1F_PHASE4_TEST_DONOR:donor.address,
 PORT:String(port),PUBLIC_ORIGIN:origin
};
const runtime=await startT1ERoleProof({env,clock:()=>now});
after(async()=>runtime.close());
async function request(path,{method='GET',body,headers={},text=false}={}){
 const res=await fetch(origin+path,{method,redirect:'manual',cache:'no-store',
  headers:{Accept:'application/json',
   ...(method==='POST'?{'Content-Type':'application/json',Origin:origin}:{}),
   ...headers},
  ...(body===undefined?{}:{body:JSON.stringify(body)})
 });
 return {code:res.status,body:text?await res.text():await res.json(),
  headers:res.headers};
}
test('exact phase 5 is opt-in only, no DB/signer, no source-override production',()=>{
 assert.equal(validateT1EProofConfig(env).phase5Enabled,true);
 assert.equal(validateT1EProofConfig({
  ...env,T1F_PHASE5_TYPED_PRACTICE_ENABLED:'false'
 }).phase5Enabled,false);
 for(const extra of [
  {T1F_PHASE5_TYPED_PRACTICE_ENABLED:'enabled'},
  {T1F_PHASE4_PROOF_ENABLED:'false'},
  {T1F_PHASE5_DB_URL:'postgresql://blocked.invalid/db'},
  {T1F_PHASE5_SIGNER_KEY:'blocked'},
  {T1E_WALLET_TX_ENABLED:'true'}
 ])assert.throws(()=>validateT1EProofConfig({...env,...extra}),/T1[EF]_/);
 assert.throws(()=>makePhase5TypedPractice({
  origin:'https://mealforward-t1e-role-proof-laodao.onrender.com',
  roleFixtures:{owner:owner.address,donor:donor.address}
 }),/T1F_PHASE5_PRODUCTION_ROLE_OVERRIDE_FORBIDDEN/);
});
test('public practice stage and static HTML are isolated from real approval',async()=>{
 const [status,html,tracked,js]=await Promise.all([
  request('/v1/t1f/phase5/status'),
  request('/t1f-phase5.html',{text:true}),
  request('/t1f-phase5.html?utm_source=chatgpt.com',{text:true}),
  request('/t1f-phase5.mjs',{text:true})
 ]);
 assert.equal(status.code,200);
 assert.equal(status.body.status,'T1F_PHASE5_TYPED_WALLET_PRACTICE_ONLY');
 assert.equal(status.body.typedDataDomain,'MealForward Phase5 Typed Wallet Practice');
 assert.equal(status.body.typedDataVersion,'0');
 assert.equal(status.body.liveReleaseDomainMatch,false);
 assert.equal(status.body.eip712PracticeOnly,true);
 for(const x of ['createsRecoveryApproval','canIssue','canFund','canSettle',
  'databaseConnected','hasSession','storesSignature'])
  assert.equal(status.body[x],false,x);
 assert.equal(status.headers.get('set-cookie'),null);
 assert.equal(html.code,200);assert.equal(js.code,200);
 assert.equal(html.body,tracked.body);
 assert.match(html.body,/Owner/);assert.match(html.body,/Donor/);
 assert.match(html.body,/id="owner-sign"[^>]*disabled/);
 assert.match(html.body,/id="donor-sign"[^>]*disabled/);
 assert.match(html.headers.get('content-security-policy'),/frame-ancestors 'none'/);
 assert.match(js.body,/eth_signTypedData_v4/);
 assert.match(js.body,/wallet_requestPermissions/);
 for(const unsafe of ['eth_sendTransaction','eth_sendRawTransaction',
  'wallet_sendCalls','localStorage','sessionStorage','approve(']){
  assert.equal(js.body.includes(unsafe),false,unsafe);
 }
 for(const path of [
  '/t1f-phase5.html?wallet=0x123',
  '/t1f-phase5.html?next=https%3A%2F%2Fevil.invalid',
  '/t1f-phase5.html?utm_source=chatgpt.com&utm_source=evil',
  '/t1f-phase5.mjs?utm_source=chatgpt.com',
  '/v1/t1f/phase5/status?role=owner']){
  assert.equal((await request(path)).code,403,path);
 }
 const old=await request('/v1/t1f/phase4/status');
 assert.equal(old.code,200);
 assert.equal(old.body.eip712RecoveryReleaseEnabled,false);
});
test('actual EIP712 signatures of independent synthetic Owner and Donor pass exactly once',async()=>{
 const sigs=new Set();
 for(const [role,wallet] of [['owner',owner],['donor',donor]]){
  const challenge=await request('/v1/t1f/phase5/challenge',{
   method:'POST',body:{role,address:wallet.address}
  });
  assert.equal(challenge.code,200);
  assert.equal(challenge.body.role,role);
  assert.equal(challenge.body.notRecoveryRelease,true);
  assert.equal(challenge.body.notTransaction,true);
  assert.equal(challenge.body.typedData.domain.name,
   PHASE5_TYPED_PRACTICE_DOMAIN.name);
  assert.notEqual(challenge.body.typedData.domain.name,
   'MealForward T1F Recovery');
  assert.equal(challenge.body.typedData.domain.version,'0');
  assert.equal(challenge.body.typedData.primaryType,'PracticeControl');
  assert.equal(challenge.body.typedData.message.role,role.toUpperCase());
  assert.match(challenge.body.typedData.message.purpose,/PRACTICE ONLY/);
  sigs.add(challenge.body.typedData.message.nonce);
  const signature=await wallet.signTypedData(
   challenge.body.typedData.domain,{PracticeControl:challenge.body.typedData.types.PracticeControl},
   challenge.body.typedData.message
  );
  const verified=await request('/v1/t1f/phase5/verify',{method:'POST',body:{
   challengeId:challenge.body.challengeId,signature
  }});
  assert.equal(verified.code,200);
  assert.equal(verified.body.status,'T1F_PHASE5_'+role.toUpperCase()+'_TYPED_PRACTICE_PASS');
  assert.equal(verified.body.address,wallet.address.toLowerCase());
  assert.equal(verified.body.releaseApproved,false);
  assert.equal(verified.body.signaturePersisted,false);
  assert.equal(verified.body.noFundsOrChainWrites,true);
  assert.equal(verified.headers.get('set-cookie'),null);
  const replay=await request('/v1/t1f/phase5/verify',{method:'POST',body:{
   challengeId:challenge.body.challengeId,signature
  }});
  assert.equal(replay.code,409);
 }
 assert.equal(sigs.size,2,'roles must not share the same EIP712 nonce');
});
test('forged signatures, role swap, URL injection and origin override are denied',async()=>{
 const wrong=await request('/v1/t1f/phase5/challenge',{method:'POST',body:{
  role:'owner',address:donor.address
 }});
 assert.equal(wrong.code,403);
 const chal=await request('/v1/t1f/phase5/challenge',{method:'POST',body:{
  role:'owner',address:owner.address
 }});
 const sig=await donor.signTypedData(chal.body.typedData.domain,
  {PracticeControl:chal.body.typedData.types.PracticeControl},chal.body.typedData.message);
 const mismatch=await request('/v1/t1f/phase5/verify',{method:'POST',body:{
  challengeId:chal.body.challengeId,signature:sig
 }});
 assert.equal(mismatch.code,401);
 const ownerSig=await owner.signTypedData(chal.body.typedData.domain,
  {PracticeControl:chal.body.typedData.types.PracticeControl},chal.body.typedData.message);
 assert.equal((await request('/v1/t1f/phase5/verify',{method:'POST',body:{
  challengeId:chal.body.challengeId,signature:ownerSig
 }})).code,409,'invalid attempt consumes nonce');
 assert.equal((await request('/v1/t1f/phase5/challenge',{
  method:'POST',body:{role:'owner',address:owner.address},
  headers:{Origin:'https://evil.invalid'}
 })).code,403);
 assert.equal((await request('/v1/t1f/phase5/challenge',{
  method:'POST',body:{role:'owner',address:owner.address},
  headers:{'X-Wallet-Address':owner.address}
 })).code,403);
 for(const path of ['/v1/t1f/phase5/release','/v1/t1f/phase5/issue',
  '/v1/t1e/issuer/issue','/v1/t1e/settle','/v1/t1/fund/prepare']){
  assert.equal((await request(path,{method:'POST',body:{}})).code,405);
 }
});
test('typed proof expires and bounds outstanding challenges',async()=>{
 const first=await request('/v1/t1f/phase5/challenge',{method:'POST',body:{
  role:'owner',address:owner.address
 }});
 assert.equal(first.code,200);
 now+=121;
 const signature=await owner.signTypedData(first.body.typedData.domain,
  {PracticeControl:first.body.typedData.types.PracticeControl},first.body.typedData.message);
 const old=await request('/v1/t1f/phase5/verify',{method:'POST',body:{
  challengeId:first.body.challengeId,signature
 }});
 assert.equal(old.code,409);
 const codes=[];
 for(let i=0;i<25;i++){
  const v=await request('/v1/t1f/phase5/challenge',{method:'POST',body:{
   role:'donor',address:donor.address
  }});
  codes.push(v.code);
 }
 assert.ok(codes.includes(429));
 assert.ok(codes.every(n=>[200,429].includes(n)));
});
