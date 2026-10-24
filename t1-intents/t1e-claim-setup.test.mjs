import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {validateSetupOnly,startT1ESafeSetup} from './t1e-claim-entrypoint.mjs';
const socket=net.createServer();
await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
const origin='http://127.0.0.1:'+port;
const e={
 GITHUB_ACTIONS:'true',T1E_SETUP_CI:'ack-disposable-loopback',
 PUBLIC_ORIGIN:origin,PORT:String(port),T1E_DEPLOYMENT_STAGE:'SETUP_ONLY',
 T1E_CLAIM_WRITES_ENABLED:'false',T1E_WALLET_TX_ENABLED:'false',
 T1E_SETTLEMENT_ENABLED:'false'
};
const app=await startT1ESafeSetup({env:e});
after(()=>app.close());
async function http(path,method='GET',headers={}){
 const r=await fetch(origin+path,{
  method,headers,redirect:'manual',cache:'no-store'
 });
 const text=await r.text(),type=r.headers.get('content-type')||'';
 return {status:r.status,text,headers:r.headers,
  body:type.startsWith('application/json')?JSON.parse(text):text};
}
test('setup-only stage absolutely refuses any DB DSN, finance flag or issuer writes',()=>{
 assert.equal(validateSetupOnly(e).origin,origin);
 for(const altered of [
  {T1E_DEPLOYMENT_STAGE:'CLAIM_CONSENT'},
  {T1E_CLAIM_WRITES_ENABLED:'true'},
  {T1E_WALLET_TX_ENABLED:'true'},
  {T1E_SETTLEMENT_ENABLED:'true'},
  {T1E_AUTH_DB_URL:'postgresql://unused:bad@example.com/db'},
  {T1E_CLAIM_DB_URL:'postgresql://unused:bad@example.com/db'},
  {T1C_INTENT_DB_URL:'postgresql://unused:bad@example.com/db'},
  {T1E_SUPABASE_ADMIN_DSN:'postgresql://unused:bad@example.com/db'},
  {PUBLIC_ORIGIN:'https://evil.invalid'}
 ]){
  assert.throws(()=>validateSetupOnly({...e,...altered}),/T1E_/);
 }
});
test('plain public page + tracked ChatGPT source works without any wallet scripts',async()=>{
 const status=await http('/v1/t1e/status');
 assert.equal(status.status,200);
 assert.equal(status.body.status,'T1E_SAFE_SETUP_ONLY_NO_SESSIONS');
 for(const k of ['claimWriteEnabled','issuerIssueEnabled','fundingEnabled','settleEnabled',
  'independentRecipientLoginEnabled'])assert.equal(status.body[k],false,k);
 const home=await http('/');
 const track=await http('/?utm_source=chatgpt.com');
 assert.equal(home.status,200);
 assert.equal(track.status,200);
 assert.equal(home.text,track.text);
 assert.equal(home.headers.get('x-frame-options'),'DENY');
 assert.match(home.headers.get('content-security-policy'),/default-src 'none'/);
 assert.ok(home.text.includes('T1E_SAFE_SETUP_ONLY'));
 assert.ok(home.text.includes('7 Test USDC'));
 assert.equal(home.headers.get('set-cookie'),null);
 assert.equal(home.text.includes('<script'),false);
 const css=await http('/t1e-claim.css');
 assert.equal(css.status,200);
 assert.ok(css.text.includes('.hero'));
 assert.equal((await http('/t1e-claim.mjs')).status,404);
 assert.equal((await http('/t1e-claim.css?utm_source=chatgpt.com')).status,403);
});
test('all business/Auth/write URLs are closed; no origin override or external account injection',async()=>{
 assert.equal((await http('/health')).body.noDatabase,true);
 for(const path of [
  '/v1/auth/pre-session','/v1/identity/wallet/challenge',
  '/v1/t1e/claim/prepare','/v1/t1e/claim/renew',
  '/v1/t1e/claim/consent','/v1/t1e/issuer/issue',
  '/v1/t1e/merchant/settle','/v1/t1/fund/prepare'
 ]){
  const r=await http(path,'POST');
  assert.equal(r.status,405,path);
  assert.equal(r.body.error,'T1E_SETUP_ALL_WRITES_DISABLED');
 }
 const forged=await http('/v1/t1e/status','GET',{
  'X-Wallet-Address':'0x'+'1'.repeat(40)
 });
 assert.equal(forged.status,403);
});
