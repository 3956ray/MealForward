import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {readFileSync} from 'node:fs';
import {Wallet} from 'ethers';
import {createPhase4Proof,PHASE4_ROLES} from './t1f-phase4-proof.mjs';
import {startT1ERoleProof,validateT1EProofConfig,T1E_ORIGIN,
 safeT1FPhase4StaticQuery} from './t1e-role-proof-server.mjs';

const owner=Wallet.createRandom(),donor=Wallet.createRandom();
const fakePort=await new Promise(resolve=>{
 const server=net.createServer();
 server.listen(0,'127.0.0.1',()=>{
  const port=server.address().port;
  server.close(()=>resolve(port));
 });
});
const origin='http://127.0.0.1:'+fakePort;
let now=1792740000;
const env={
 GITHUB_ACTIONS:'true',T1E_ROLE_PROOF_CI:'ack-loopback-only',
 T1E_DEPLOYMENT_STAGE:'ROLE_PROOF_ONLY',
 T1E_WALLET_TX_ENABLED:'false',T1E_CLAIM_WRITES_ENABLED:'false',
 T1E_SETTLEMENT_ENABLED:'false',T1F_PHASE4_PROOF_ENABLED:'true',
 T1F_PHASE4_CI_ROLES:'ack-loopback-owner-donor',
 T1F_PHASE4_TEST_OWNER:owner.address,
 T1F_PHASE4_TEST_DONOR:donor.address,
 PORT:String(fakePort),PUBLIC_ORIGIN:origin
};
const runtime=await startT1ERoleProof({env,clock:()=>now});
after(async()=>runtime.close());
async function hit(path,{method='GET',body,headers={},text=false}={}){
 const res=await fetch(origin+path,{
  method,redirect:'manual',cache:'no-store',
  headers:{Accept:'application/json',
   ...(method==='POST'?{'Content-Type':'application/json',Origin:origin}:{}),
   ...headers},
  ...(body===undefined?{}:{body:JSON.stringify(body)})
 });
 const payload=text?await res.text():await res.json();
 return {code:res.status,body:payload,headers:res.headers};
}
test('Phase4 exact config is DB/signers-free and role fixtures never allowed in production',()=>{
 assert.equal(validateT1EProofConfig(env).phase4Enabled,true);
 assert.equal(PHASE4_ROLES.owner.toLowerCase(),
  '0xc4f8a468f10d5f98dcff3282516125e97f26433b');
 assert.equal(PHASE4_ROLES.donor.toLowerCase(),
  '0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952');
 for(const bad of [
  {T1F_PHASE4_PROOF_ENABLED:'yes'},
  {T1F_PHASE4_DB_URL:'postgresql://blocked'},
  {T1F_RELEASE_DB_URL:'postgresql://blocked'},
  {T1F_RELEASE_SIGNER_KEY:'forbidden'},
  {T1E_SETTLEMENT_ENABLED:'true'},
  {T1E_WALLET_TX_ENABLED:'true'},
  {PUBLIC_ORIGIN:'https://evil.invalid'}
 ])assert.throws(()=>validateT1EProofConfig({...env,...bad}),/T1[EF]_/);
 assert.throws(()=>createPhase4Proof({
  origin:T1E_ORIGIN,roleFixtures:{owner:owner.address,donor:donor.address}
 }),/T1F_PHASE4_LIVE_OVERRIDE_FORBIDDEN/);
 assert.throws(()=>createPhase4Proof({
  origin:T1E_ORIGIN,testing:true,
  roleFixtures:{owner:owner.address,donor:donor.address}
 }),/T1F_PHASE4_LIVE_OVERRIDE_FORBIDDEN/);
});
test('public Phase4 is EIP191 proof only, not approval, Fund, Issue, Settle or DB',async()=>{
 const s=await hit('/v1/t1f/phase4/status');
 assert.equal(s.code,200);
 assert.equal(s.body.status,'T1F_PHASE4_OWNER_DONOR_SIWE_PROOF_ONLY');
 assert.equal(s.body.ownerWallet,owner.address.toLowerCase());
 assert.equal(s.body.donorWallet,donor.address.toLowerCase());
 assert.equal(s.body.chainId,10143);
 for(const key of ['noPersistentSessions','siweFormat','eip191Only',
 'originalClaimPreserved','walletControlOnly'])assert.equal(s.body[key],true);
 for(const key of ['databaseConnected','eip712RecoveryReleaseEnabled',
 'successorIssueEnabled','fundEnabled','settleEnabled'])
  assert.equal(s.body[key],false);
 assert.equal(s.headers.get('set-cookie'),null);
 const doc=await hit('/t1f-phase4.html',{text:true});
 assert.equal(doc.code,200);
 assert.match(doc.body,/Owner/);
 assert.match(doc.body,/Donor/);
 assert.match(doc.body,/id="owner-proof"[^>]*disabled/);
 assert.match(doc.body,/id="donor-proof"[^>]*disabled/);
 assert.match(doc.headers.get('content-security-policy'),/frame-ancestors 'none'/);
 const tracked=await hit('/t1f-phase4.html?utm_source=chatgpt.com',{text:true});
 assert.equal(tracked.code,200);
 assert.equal(tracked.body,doc.body);
 const script=await hit('/t1f-phase4.mjs',{text:true});
 assert.equal(script.code,200);
 assert.match(script.body,/personal_sign/);
 assert.match(script.body,/wallet_requestPermissions/);
 const source=readFileSync(new URL('./public/t1f-phase4.mjs',import.meta.url),'utf8');
 for(const unsafe of [
 'eth_sendTransaction','eth_sendRawTransaction','eth_signTypedData_v4',
 'wallet_sendCalls','localStorage','sessionStorage','approve('
 ])assert.equal(source.includes(unsafe),false,unsafe);
 for(const path of ['/t1f-phase4.html?wallet=0x123',
 '/t1f-phase4.html?next=https%3A%2F%2Fevil.invalid',
 '/t1f-phase4.html?utm_source=chatgpt.com&utm_source=evil',
 '/t1f-phase4.mjs?utm_source=chatgpt.com']){
  assert.equal((await hit(path)).code,403,path);
 }
 assert.equal(safeT1FPhase4StaticQuery('/t1f-phase4.html',
 '?utm_source=chatgpt.com&utm_medium=referral'),true);
 assert.equal(safeT1FPhase4StaticQuery('/v1/t1f/phase4/status',
 '?wallet=0x123'),false);
});
test('original T1-E issuer/recipient proof routes still work and do not issue anything',async()=>{
 const status=await hit('/v1/t1e/status');
 assert.equal(status.code,200);
 assert.equal(status.body.status,'T1E_ISSUER_RECIPIENT_WALLET_PROOF_READY');
 for(const route of [
 '/v1/t1f/phase4/release','/v1/t1f/phase4/issue',
 '/v1/t1e/claim/prepare','/v1/t1f/issuer/issue',
 '/v1/t1e/settle','/v1/t1/fund/prepare'
 ]){
  const r=await hit(route,{method:'POST',body:{}});
  assert.equal(r.code,405,route);
 }
});
test('Owner and Donor complete separate real EIP191 SIWE signatures with no session or release',async()=>{
 const roleList=[['owner',owner],['donor',donor]];
 for(const [role,wallet] of roleList){
  const ch=await hit('/v1/t1f/phase4/challenge',{
   method:'POST',body:{role,address:wallet.address}
  });
  assert.equal(ch.code,200);
  assert.equal(ch.body.role,role);
  assert.equal(ch.body.address,wallet.address.toLowerCase());
  assert.equal(ch.body.noEip712Release,true);
  assert.equal(ch.body.noWalletTransaction,true);
  assert.match(ch.body.message,/WALLET CONTROL PROOF ONLY/);
  assert.match(ch.body.message,/Chain ID: 10143|Chain ID: 10143/i);
  assert.match(ch.body.message,new RegExp(role.toUpperCase()));
  const signature=await wallet.signMessage(ch.body.message);
  const done=await hit('/v1/t1f/phase4/verify',{
   method:'POST',body:{challengeId:ch.body.challengeId,signature}
  });
  assert.equal(done.code,200);
  assert.equal(done.body.role,role);
  assert.equal(done.body.noSessionCreated,true);
  assert.equal(done.body.noEip712Release,true);
  assert.equal(done.body.noOnchainIssue,true);
  assert.equal(done.body.noFundsTransaction,true);
  assert.equal(done.body.noSettlement,true);
  assert.equal(done.headers.get('set-cookie'),null);
  const replay=await hit('/v1/t1f/phase4/verify',{
   method:'POST',body:{challengeId:ch.body.challengeId,signature}
  });
  assert.equal(replay.code,409);
  assert.equal(replay.body.error,'T1F_PHASE4_CHALLENGE_EXPIRED_OR_USED');
 }
});
test('wrong address, donor impersonating Owner, cross-origin and wallet override denied',async()=>{
 for(const role of ['owner','donor']){
  const wrong=await hit('/v1/t1f/phase4/challenge',{
   method:'POST',body:{role,address:Wallet.createRandom().address}
  });
  assert.equal(wrong.code,403);
 }
 const ch=await hit('/v1/t1f/phase4/challenge',{
  method:'POST',body:{role:'owner',address:owner.address}
 });
 const forged=await hit('/v1/t1f/phase4/verify',{
  method:'POST',body:{
   challengeId:ch.body.challengeId,
   signature:await donor.signMessage(ch.body.message)
  }
 });
 assert.equal(forged.code,401);
 assert.equal(forged.body.error,'T1F_PHASE4_SIGNATURE_REJECTED');
 const replay=await hit('/v1/t1f/phase4/verify',{
  method:'POST',body:{
   challengeId:ch.body.challengeId,
   signature:await owner.signMessage(ch.body.message)
  }
 });
 assert.equal(replay.code,409);
 const cross=await hit('/v1/t1f/phase4/challenge',{
  method:'POST',body:{role:'owner',address:owner.address},
  headers:{Origin:'https://evil.invalid'}
 });
 assert.equal(cross.code,403);
 const override=await hit('/v1/t1f/phase4/status',{
  headers:{'X-Wallet-Address':owner.address}
 });
 assert.equal(override.code,403);
 const query=await hit('/v1/t1f/phase4/status?role=owner');
 assert.equal(query.code,403);
});
test('expired challenge and global bounded challenge admission fail closed',async()=>{
 const c=await hit('/v1/t1f/phase4/challenge',{
  method:'POST',body:{role:'owner',address:owner.address}
 });
 now+=182;
 const expired=await hit('/v1/t1f/phase4/verify',{
  method:'POST',body:{
   challengeId:c.body.challengeId,
   signature:await owner.signMessage(c.body.message)
  }
 });
 assert.equal(expired.code,409);
 const repeated=[];
 for(let i=0;i<33;i++){
  const r=await hit('/v1/t1f/phase4/challenge',{
   method:'POST',body:{role:'donor',address:donor.address}
  });
  repeated.push(r.code);
 }
 assert.ok(repeated.includes(429));
 assert.ok(repeated.every(v=>[200,429].includes(v)));
});
