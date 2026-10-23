import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import net from 'node:net';
import {TypedDataEncoder} from 'ethers';
import {TypedDataUtils,SignTypedDataVersion} from '@metamask/eth-sig-util';
import {makeT1EClaimGateway} from './t1e-claim-http.mjs';
import {validateT1EClaimConfig} from './t1e-claim-server.mjs';
import {consentFromClaim} from './t1e-consent-payload.mjs';
import {PILOT_RECIPIENT,ORIGINAL_INTENT,FIRST_VOUCHER} from './t1e-claim-store.mjs';
import {FIXED} from './t1e-first-issue-readiness.mjs';
import {MEAL,TERMS,ESCROW} from './core.mjs';
const NOW=1792740000;
let FAKE_NOW=NOW;
const token='a'.repeat(43),csrf='c'.repeat(43),issuerToken='b'.repeat(43);
const hash=s=>createHash('sha256').update(s).digest('hex');
let prepared=0,verified=0;
const row={
 claim_id:'2b9ae6f1-2bb7-4096-8136-70f30f302eee',funding_intent:ORIGINAL_INTENT,
 chain_id:10143,escrow:ESCROW,meal_id:MEAL,terms_hash:TERMS,
 unit_seq:0,generation:'1',voucher_id:FIRST_VOUCHER,
 issuer_wallet:FIXED.issuerAuthority,beneficiary_wallet:PILOT_RECIPIENT,
 consent_nonce:'0x'+'a'.repeat(64),consent_deadline:String(NOW+420),
 round:{claim_id:'2b9ae6f1-2bb7-4096-8136-70f30f302eee',seq:1,nonce:'0x'+'a'.repeat(64),deadline:String(NOW+420),state:'PENDING'},
 consent_digest:null,consent_signature_fingerprint:null,stage:'PREPARED',revision:'0',
 issuer_tx_hash:null
};
const store={
 async own(wallet){assert.equal(wallet,PILOT_RECIPIENT);return row},
 async prepare({wallet,now,proof}){
  assert.equal(wallet,PILOT_RECIPIENT);
  assert.equal(now,NOW);
  assert.equal(proof.status,'T1E_ORIGINAL_FUNDED_UNIT_READONLY_ISSUE_GATE_PASS');
  return {row,created:++prepared===1}
 },
 async renew({wallet,now,proof}){
  assert.equal(wallet,PILOT_RECIPIENT);
  assert.equal(now,NOW);
  assert.equal(proof.status,'T1E_ORIGINAL_FUNDED_UNIT_READONLY_ISSUE_GATE_PASS');
  assert.equal(row.round.state,'PENDING');
  assert.ok(Number(row.round.deadline)<NOW);
  row.round={...row.round,seq:2,nonce:'0x'+'b'.repeat(64),
   deadline:String(NOW+420)};
  return row;
 },
 async issuerReadiness(){return {claimStage:row.stage,consentVerified:false}},
 async verifyConsent(){verified++;throw Error('WRONG_SIGNATURE_MUST_NOT_TOUCH_DB')}
};
const auth={
 async getSession(h){return h===hash(token)?{wallet:PILOT_RECIPIENT}:
  h===hash(issuerToken)?{wallet:FIXED.issuerAuthority}:null},
 async getSessionWithCsrf(h,c){
  return c===hash(csrf)?this.getSession(h):null;
 }
};
const socket=net.createServer();
await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
const port=socket.address().port;
await new Promise(resolve=>socket.close(resolve));
const origin='http://127.0.0.1:'+port;
const env={
 GITHUB_ACTIONS:'true',MF_T1E_DISPOSABLE_ONLY:'ack-fresh-t1e-pg17',
 MF_T1E_HTTP_DISPOSABLE_ONLY:'ack-claim-http-pg17',
 PUBLIC_ORIGIN:origin,PORT:String(port),T1E_DEPLOYMENT_STAGE:'CLAIM_SIWE_ONLY',
 T1E_CLAIM_WRITES_ENABLED:'false',T1E_WALLET_TX_ENABLED:'false',
 T1E_SETTLEMENT_ENABLED:'false',
 T1E_AUTH_DB_URL:'postgres://mf_t1e_auth_runtime:auth-ci-password-only@127.0.0.1:5435/postgres',
 T1E_CLAIM_DB_URL:'postgres://mf_t1e_claim_runtime:claim-ci-password-only@127.0.0.1:5435/postgres'
};
const createGate=mode=>makeT1EClaimGateway({
 origin,stage:mode,authStore:auth,claimStore:store,
 clock:()=>NOW,
 readiness:async()=>({status:'T1E_ORIGINAL_FUNDED_UNIT_READONLY_ISSUE_GATE_PASS'}),
 loginHandler:(req,res)=>{
  res.writeHead(404,{'Content-Type':'application/json'});
  res.end(JSON.stringify({error:'UNLISTED'}));
 }
});
let currentGate=createGate('CLAIM_SIWE_ONLY');
const server=createServer((req,res)=>currentGate(req,res));
await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
async function stage(mode){
 // Real production stage changes require a new deployment. The CI gate
 // swaps only an in-memory test handler so pooled fetch sockets never reset.
 currentGate=createGate(mode);
}
after(async()=>{if(server)await new Promise(resolve=>server.close(resolve))});
async function req(path,role='anonymous',method='GET',body={},headers={}){
 const h={Accept:'application/json',...headers};
 if(role==='recipient')h.Cookie='__Host-mcpay_c1_session='+token;
 if(role==='issuer')h.Cookie='__Host-mcpay_c1_session='+issuerToken;
 if(method==='POST'){
  h['Content-Type']='application/json';
  if(!Object.hasOwn(h,'Origin'))h.Origin=origin;
  if(!Object.hasOwn(h,'X-C1-CSRF'))h['X-C1-CSRF']=csrf;
 }
 const r=await fetch(origin+path,{method,headers:h,redirect:'manual',
  ...(method==='POST'?{body:JSON.stringify(body)}:{})});
 return {status:r.status,body:await r.json()};
}
test('cloud stage and two distinct DSNs strictly reviewed',()=>{
 assert.equal(validateT1EClaimConfig(env).stage,'CLAIM_SIWE_ONLY');
 for(const change of [
  {T1E_CLAIM_WRITES_ENABLED:'true'},{T1E_WALLET_TX_ENABLED:'true'},
  {T1E_SETTLEMENT_ENABLED:'true'},{T1E_DEPLOYMENT_STAGE:'ISSUE'},
  {T1E_CLAIM_DB_URL:env.T1E_AUTH_DB_URL},
  {T1C_AUTH_DB_URL:'postgres://old'},{PUBLIC_ORIGIN:'https://untrusted.invalid'}
 ])assert.throws(()=>validateT1EClaimConfig({...env,...change}),/T1E_/);
});
test('EIP712 exact bytes roundtrip and original beneficiary pinned',()=>{
 const p=consentFromClaim(row,NOW);
 assert.equal(p.message.recipient.toLowerCase(),PILOT_RECIPIENT);
 assert.equal(p.message.voucherId,FIRST_VOUCHER);
 assert.equal(TypedDataEncoder.hash(p.domain,p.types,p.message),p.digest);
 assert.equal('0x'+Buffer.from(TypedDataUtils.eip712Hash(
  p.metaMaskV4,SignTypedDataVersion.V4)).toString('hex'),p.digest);
 assert.throws(()=>consentFromClaim(row,NOW+422),/T1E_/);
});
test('private authentication and role isolation on read-only stage',async()=>{
 assert.equal((await req('/v1/t1e/me')).status,401);
 assert.equal((await req('/v1/t1e/claim/me')).status,401);
 assert.equal((await req('/v1/t1e/issuer/readiness')).status,401);
 assert.equal((await req('/v1/t1e/status')).body.recipientClaimWriteEnabled,false);
 assert.equal((await req('/v1/t1e/me','recipient')).body.walletAddress,PILOT_RECIPIENT);
 assert.equal((await req('/v1/t1e/me','issuer')).body.role,'issuer');
 assert.equal((await req('/v1/t1e/claim/me','issuer')).status,403);
 assert.equal((await req('/v1/t1e/issuer/readiness','recipient')).status,403);
 assert.equal((await req('/v1/t1e/issuer/readiness','issuer')).status,200);
 assert.equal((await req('/v1/t1e/claim/me','recipient')).body.consent.message.nonce,row.consent_nonce);
 assert.equal((await req('/v1/t1e/claim/prepare','recipient','POST',{})).status,405);
 assert.equal(prepared,0);
});
test('even Consent stage rejects CSRF, wrong wallet, foreign Origin and Issue',async()=>{
 await stage('CLAIM_CONSENT');
 assert.equal((await req('/v1/t1e/status')).body.recipientClaimWriteEnabled,true);
 assert.equal((await req('/v1/t1e/claim/prepare','recipient','POST',{},
  {'X-C1-CSRF':'wrong'})).status,403);
 assert.equal((await req('/v1/t1e/claim/prepare','issuer','POST',{})).status,403);
 assert.equal((await req('/v1/t1e/claim/prepare','anonymous','POST',{})).status,401);
 assert.equal((await req('/v1/t1e/claim/prepare','recipient','POST',{wallet:PILOT_RECIPIENT})).status,422);
 assert.equal((await req('/v1/t1e/claim/prepare','recipient','POST',{},
  {Origin:'https://fake.invalid'})).status,403);
 assert.equal((await req('/v1/t1e/issuer/issue','issuer','POST',{})).status,405);
 assert.equal((await req('/v1/t1e/settle','issuer','POST',{})).status,405);
 assert.equal(prepared,0);
});
test('single original claim can be recovered, wrong consent cannot change database',async()=>{
 const one=await req('/v1/t1e/claim/prepare','recipient','POST',{});
 assert.equal(one.status,201);
 const two=await req('/v1/t1e/claim/prepare','recipient','POST',{});
 assert.equal(two.status,200);
 assert.equal(one.body.claim.claimId,two.body.claim.claimId);
 assert.equal(one.body.consent.digest,two.body.consent.digest);
 const bad=await req('/v1/t1e/claim/consent','recipient','POST',{
  claimId:row.claim_id,signature:'0x'+'1'.repeat(130)
 });
 assert.equal(bad.status,422);
 assert.equal(bad.body.error,'T1E_CONSENT_CRYPTO_DENIED');
 assert.equal(verified,0);
});

test('expired consent recovers SAME original Claim and changes ONLY private nonce round',async()=>{
 assert.equal(row.stage,'PREPARED');
 const originalId=row.claim_id,firstNonce=row.consent_nonce;
 row.round={...row.round,deadline:String(NOW-2)};
 const view=await req('/v1/t1e/claim/me','recipient');
 assert.equal(view.status,200);
 assert.equal(view.body.consent,null);
 assert.equal(view.body.consentNeedsRenewal,true);
 const unauthorized=await req('/v1/t1e/claim/renew','issuer','POST',{});
 assert.equal(unauthorized.status,403);
 const badOrigin=await req('/v1/t1e/claim/renew','recipient','POST',{},
  {Origin:'https://attacker.invalid'});
 assert.equal(badOrigin.status,403);
 const recovered=await req('/v1/t1e/claim/renew','recipient','POST',{});
 assert.equal(recovered.status,200);
 assert.equal(recovered.body.originalClaimReused,true);
 assert.equal(recovered.body.claim.claimId,originalId);
 assert.equal(recovered.body.claim.consentRound,2);
 assert.equal(recovered.body.consent.message.nonce,row.round.nonce);
 assert.notEqual(row.round.nonce,firstNonce);
 assert.equal(row.consent_nonce,firstNonce);
 assert.equal(recovered.body.issuerIssueEnabled,false);
 assert.equal(prepared,2);
});
