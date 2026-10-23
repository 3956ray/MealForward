import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {makeT1EClaimGateway} from './t1e-claim-http.mjs';
import {FIXED} from './t1e-first-issue-readiness.mjs';
import {PILOT_RECIPIENT} from './t1e-claim-store.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const issuer=FIXED.issuerAuthority,recipient=PILOT_RECIPIENT;
const token='a'.repeat(43),csrf='c'.repeat(43),recipientToken='b'.repeat(43);
let called=0,sendOperations=0;
const auth={
 async getSession(key){
  return key===sha(token)?{wallet:issuer}:
   key===sha(recipientToken)?{wallet:recipient}:null;
 },
 async getSessionWithCsrf(key,c){
  return c===sha(csrf)?this.getSession(key):null;
 }
};
const rpc={async send(method){
 if(method==='eth_getTransactionCount')return '0x9';
 if(method==='eth_chainId')return '0x279f';
 throw Error('T1F_NO_UNREVIEWED_RPC_'+method);
}};
const issueLedger={
 async status({issuer:who}){
  assert.equal(who,issuer);
  return {claimId:'fbab3b22-965d-44e2-b144-d7307b7aa8ea',
   stage:'CONSENT_VERIFIED',sendAgainPermitted:false};
 },
 async reserve({issuer:who,issuerPendingNonce,chainProof}){
  called++;
  assert.equal(who,issuer);
  assert.equal(issuerPendingNonce,'9');
  assert.equal(chainProof?.status,'T1E_ORIGINAL_FUNDED_UNIT_READONLY_ISSUE_GATE_PASS');
  return {created:true,firstWalletSendPermitted:true,
   issueTransaction:{from:issuer,to:'0x'+'c'.repeat(40),data:'0x1234'}};
 },
 async bind(){return {alreadyBound:true}},
 async reconcile(){return {state:{stage:'ISSUE_HASH_BOUND'}}}
};
const n=await new Promise(resolve=>{
 const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))});
});
const origin='http://127.0.0.1:'+n;
const handler=makeT1EClaimGateway({
 origin,stage:'CLAIM_CONSENT',issueEnabled:true,issuerLedger:issueLedger,
 issuerRpc:rpc,issuerReadiness:async()=>({
  status:'T1E_ORIGINAL_FUNDED_UNIT_READONLY_ISSUE_GATE_PASS'}),
 authStore:auth,claimStore:{},readiness:async()=>({}),
 loginHandler:(req,res)=>{res.writeHead(404);res.end()},
 clock:()=>1792749900
});
const server=createServer((req,res)=>handler(req,res));
await new Promise(resolve=>server.listen(n,'127.0.0.1',resolve));
after(async()=>new Promise(resolve=>server.close(resolve)));
async function send(path,{method='GET',role='anonymous',data,originOverride,csrfOverride}={}){
 const cookies={issuer:token,recipient:recipientToken};
 const headers={Accept:'application/json'};
 if(cookies[role])headers.Cookie='__Host-mcpay_c1_session='+cookies[role];
 if(method==='POST'){
  headers['Content-Type']='application/json';
  headers.Origin=originOverride??origin;
  if(csrfOverride!==false)headers['X-C1-CSRF']=csrfOverride??csrf;
 }
 const r=await fetch(origin+path,{method,headers,redirect:'manual',
  ...(method==='POST'?{body:JSON.stringify(data??{})}:{})});
 return {status:r.status,body:await r.json()};
}
test('issuer routes are invisible to unauthenticated and recipient wallets',async()=>{
 assert.equal((await send('/v1/t1f/issuer/status')).status,401);
 assert.equal((await send('/v1/t1f/issuer/status',{role:'recipient'})).status,403);
 assert.equal((await send('/v1/t1f/issuer/status',{role:'issuer'})).status,200);
 assert.equal((await send('/v1/t1f/issuer/prepare',{role:'recipient',method:'POST',
  data:{issuerPendingNonce:'9'}})).status,403);
 assert.equal(called,0);
});
test('server denies cross-origin, CSRF, wrong nonce before durable reservation',async()=>{
 assert.equal((await send('/v1/t1f/issuer/prepare',{role:'issuer',method:'POST',
  csrfOverride:false,data:{issuerPendingNonce:'9'}})).status,403);
 assert.equal((await send('/v1/t1f/issuer/prepare',{role:'issuer',method:'POST',
  originOverride:'https://untrusted.invalid',data:{issuerPendingNonce:'9'}})).status,403);
 assert.equal((await send('/v1/t1f/issuer/prepare',{role:'issuer',method:'POST',
  data:{issuerPendingNonce:'10'}})).status,409);
 assert.equal((await send('/v1/t1f/issuer/prepare',{role:'issuer',method:'POST',
  data:{wallet:issuer,issuerPendingNonce:'9'}})).status,422);
 assert.equal(called,0);
});
test('only authenticated issuer with exact pending nonce may receive one-time payload',async()=>{
 const result=await send('/v1/t1f/issuer/prepare',{role:'issuer',method:'POST',
  data:{issuerPendingNonce:'9'}});
 assert.equal(result.status,201);
 assert.equal(result.body.firstWalletSendPermitted,true);
 assert.equal(called,1);
 assert.equal(sendOperations,0);
 assert.equal((await send('/v1/t1f/issuer/issue',{role:'issuer',
  method:'POST'})).status,405);
});
test('funding/settlement endpoints remain blocked',async()=>{
 for(const route of ['/v1/t1e/issuer/issue','/v1/t1e/settle',
  '/v1/t1e/claim/report']){
  assert.equal((await send(route,{role:'issuer',method:'POST'})).status,405);
 }
});
