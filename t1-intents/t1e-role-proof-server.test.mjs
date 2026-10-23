import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {readFileSync} from 'node:fs';
import {Wallet} from 'ethers';
import {startT1ERoleProof,T1E_ORIGIN,AUTHORITY,proofWallet,validateT1EProofConfig} from './t1e-role-proof-server.mjs';

const sample=Wallet.createRandom(),other=Wallet.createRandom();
const fixed=await (async()=>{
 const selector=net.createServer();
 await new Promise(resolve=>selector.listen(0,'127.0.0.1',resolve));
 const port=selector.address().port;
 await new Promise(resolve=>selector.close(resolve));
 return {port,origin:'http://127.0.0.1:'+port}
})();
let now=1792740000;
const env={
 GITHUB_ACTIONS:'true',T1E_ROLE_PROOF_CI:'ack-loopback-only',
 T1E_DEPLOYMENT_STAGE:'ROLE_PROOF_ONLY',
 T1E_WALLET_TX_ENABLED:'false',T1E_CLAIM_WRITES_ENABLED:'false',
 T1E_SETTLEMENT_ENABLED:'false',
 PORT:String(fixed.port),PUBLIC_ORIGIN:fixed.origin
};
const runtime=await startT1ERoleProof({env,clock:()=>now});
const uri=fixed.origin;
async function request(path,{method='GET',body=null,headers={},expectJson=true}={}){
 const res=await fetch(uri+path,{
  method,redirect:'manual',headers:{
   ...(method==='POST'?{'Content-Type':'application/json',Origin:uri}:{}),
   ...headers
  },...(body===null?{}:{body:JSON.stringify(body)})
 });
 const text=await res.text();
 const payload=expectJson?JSON.parse(text):text;
 return {code:res.status,body:payload,headers:res.headers};
}
after(async()=>runtime.close());
test('T1-E exact zero-finance config and role prohibitions',()=>{
 const cfg=validateT1EProofConfig(env);
 assert.equal(cfg.origin,uri);
 for(const o of [
  {T1E_WALLET_TX_ENABLED:'true'},
  {T1E_CLAIM_WRITES_ENABLED:'true'},
  {T1E_SETTLEMENT_ENABLED:'true'},
  {T1E_DEPLOYMENT_STAGE:'FUNDING'},
  {T1E_AUTH_DB_URL:'postgresql://forbidden'},
  {T1C_AUTH_DB_URL:'postgresql://forbidden'},
  {PUBLIC_ORIGIN:'https://evil.invalid'}
 ]){
  assert.throws(()=>validateT1EProofConfig({...env,...o}),/T1E_/);
 }
 assert.equal(T1E_ORIGIN,'https://mealforward-t1e-role-proof-laodao.onrender.com');
 assert.equal(proofWallet('issuer',AUTHORITY.issuer),AUTHORITY.issuer);
 assert.throws(()=>proofWallet('issuer',sample.address),/ONLY_PINNED_ISSUER_ALLOWED/);
 for(const roleWallet of Object.values(AUTHORITY))
  assert.throws(()=>proofWallet('recipient',roleWallet),/RECIPIENT_MUST_BE_INDEPENDENT/);
});
test('public GET, optional ChatGPT referral parameters and security headers',async()=>{
 const h=await request('/health');
 assert.equal(h.code,200);
 assert.equal(h.body.noFunds,true);
 const status=await request('/v1/t1e/status');
 assert.equal(status.code,200);
 assert.equal(status.body.status,'T1E_ISSUER_RECIPIENT_WALLET_PROOF_READY');
 for(const key of ['walletProofOnly'])assert.equal(status.body[key],true);
 for(const key of ['claimWriteEnabled','onchainIssueEnabled','fundEnabled','settleEnabled'])
  assert.equal(status.body[key],false);
 const page=await request('/?utm_source=chatgpt.com',{expectJson:false});
 assert.equal(page.code,200);
 assert.match(page.body,/Issuer/);
 assert.match(page.body,/受助者/);
 assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
 assert.equal(page.headers.get('set-cookie'),null);
 assert.equal((await request('/t1e-role-proof.mjs',{expectJson:false})).code,200);
 assert.equal((await request('/t1e-role-proof.css',{expectJson:false})).code,200);
 const js=readFileSync(new URL('./public/t1e-role-proof.mjs',import.meta.url),'utf8');
 for(const unsafe of ['eth_sendTransaction','eth_sendRawTransaction','eth_signTypedData_v4','wallet_sendCalls','localStorage'])
  assert.equal(js.includes(unsafe),false,unsafe);
 assert.equal((await request('/t1e-role-proof.mjs?utm_source=chatgpt.com')).code,403);
});
test('independent recipient can complete authentic, single-use EIP191 control proof',async()=>{
 const first=await request('/v1/t1e/role/challenge',{
  method:'POST',body:{role:'recipient',address:sample.address}
 });
 assert.equal(first.code,200);
 assert.equal(first.body.noWalletTransaction,true);
 assert.match(first.body.message,/NOT A LOGIN. NOT A FUNDING QUOTE/);
 assert.match(first.body.message,/Monad Testnet chain ID: 10143/);
 assert.equal(first.body.address,sample.address.toLowerCase());
 const signature=await sample.signMessage(first.body.message);
 const verified=await request('/v1/t1e/role/verify',{
  method:'POST',body:{challengeId:first.body.challengeId,signature}
 });
 assert.equal(verified.code,200);
 assert.equal(verified.body.status,'RECIPIENT_WALLET_CONTROL_PROVED');
 assert.equal(verified.body.noClaimCreated,true);
 assert.equal(verified.body.noOnchainIssue,true);
 assert.equal(verified.body.noFundsTransaction,true);
 const replay=await request('/v1/t1e/role/verify',{
  method:'POST',body:{challengeId:first.body.challengeId,signature}
 });
 assert.equal(replay.code,409);
 assert.equal(replay.body.error,'CHALLENGE_MISSING_OR_EXPIRED');
});
test('a spoofed pinned Issuer fails even with a genuine signature from wrong private key',async()=>{
 const unauthorized=await request('/v1/t1e/role/challenge',{
  method:'POST',body:{role:'issuer',address:sample.address}
 });
 assert.equal(unauthorized.code,403);
 const challenge=await request('/v1/t1e/role/challenge',{
  method:'POST',body:{role:'issuer',address:AUTHORITY.issuer}
 });
 assert.equal(challenge.code,200);
 const forged=await request('/v1/t1e/role/verify',{
  method:'POST',body:{
   challengeId:challenge.body.challengeId,
   signature:await other.signMessage(challenge.body.message)
  }
 });
 assert.equal(forged.code,401);
 assert.equal(forged.body.error,'T1E_SIGNATURE_REJECTED');
 const expired=await request('/v1/t1e/role/verify',{
  method:'POST',body:{
   challengeId:challenge.body.challengeId,
   signature:await other.signMessage(challenge.body.message)
  }
 });
 assert.equal(expired.code,409);
});
test('expiration and cross-site wallet override are denied',async()=>{
 const challenge=await request('/v1/t1e/role/challenge',{
  method:'POST',body:{role:'recipient',address:other.address}
 });
 assert.equal(challenge.code,200);
 now+=182;
 const expired=await request('/v1/t1e/role/verify',{
  method:'POST',body:{
   challengeId:challenge.body.challengeId,
   signature:await other.signMessage(challenge.body.message)
  }
 });
 assert.equal(expired.code,409);
 const crossed=await request('/v1/t1e/role/challenge',{
  method:'POST',body:{role:'recipient',address:other.address},
  headers:{Origin:'https://chatgpt.com'}
 });
 assert.equal(crossed.code,403);
 const override=await request('/v1/t1e/status',{
  headers:{'X-Wallet-Address':sample.address}
 });
 assert.equal(override.code,403);
});
test('issuer issuance, money, claims and settlement are not exposed by standalone T1-E stage',async()=>{
 for(const path of [
  '/v1/t1e/claim/prepare','/v1/t1e/issuer/issue',
  '/v1/t1e/issuer/confirm',
  '/v1/t1e/merchant/lock',
  '/v1/t1e/report','/v1/t1e/settle','/v1/t1/fund/prepare'
 ]){
  const out=await request(path,{method:'POST',body:{}});
  assert.equal(out.code,405,path);
  assert.equal(out.body.error,'T1E_ROLE_PROOF_ONLY_NO_CLAIM_OR_ISSUE');
 }
});
