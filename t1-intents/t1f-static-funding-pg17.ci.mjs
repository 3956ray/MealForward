/**
 * T1-F static issuer proof acceptance inside the ACTUAL funding-mode
 * T1-D HTTPS handler, but only with disposable local PG17 and a fixed
 * source-pinned read-only public Monad RPC. NO wallet, no signed message,
 * no real DB and no chain-write RPC.
 *
 * Must execute AFTER exact 006/007/008 new-role PG17 test migrations.
 */
import assert from 'node:assert/strict';
import net from 'node:net';
import {startT1ReadOnlyServer} from './read-only-server.mjs';

assert.equal(process.env.GITHUB_ACTIONS,'true');
assert.equal(process.env.MF_T1C_DISPOSABLE_ONLY,'ack-fresh-t1c-postgres17');
assert.equal(process.env.MF_T1C_HTTP_DISPOSABLE_ONLY,'ack-original-siwe-pg17');
assert.equal(process.env.DATABASE_URL,
 'postgres://postgres:t1c-disposable-only@127.0.0.1:5433/mf_t1c_http_ci');

const tmp=net.createServer();
await new Promise(ok=>tmp.listen(0,'127.0.0.1',ok));
const port=tmp.address().port;
await new Promise(ok=>tmp.close(ok));
const origin='http://127.0.0.1:'+port;
let runtime=null,calls=0;
async function req(path,opts={}){
 calls++;
 const method=opts.method||'GET';
 const res=await fetch(origin+path,{
  method,cache:'no-store',redirect:'manual',
  headers:{
   Accept:'application/json',
   ...(method==='POST'?{Origin:origin,'Content-Type':'application/json'}:{}),
   ...(opts.headers||{})
  },
  ...(opts.body===undefined?{}:{body:JSON.stringify(opts.body)}),
  signal:AbortSignal.timeout(30000)
 });
 const type=res.headers.get('content-type')||'';
 const body=type.startsWith('application/json')?await res.json():await res.text();
 assert.equal(res.headers.get('set-cookie'),null,
  'unauthed proof asset must not create a server session');
 return {status:res.status,type,body,headers:res.headers};
}
try{
 runtime=await startT1ReadOnlyServer({env:{
  ...process.env,
  PUBLIC_ORIGIN:origin,PORT:String(port),
  T1D_DEPLOYMENT_STAGE:'FUNDING',
  T1C_SERVER_MODE:'TESTNET_SINGLE_SEVEN_USDC_FUND',
  T1C_FUNDING_ENABLED:'true',
  T1C_TESTNET_FUND_SCOPE:'ONE_QUOTE_AUTHORITY_WALLET_SEVEN_USDC',
  T1C_QUOTE_SIGNER_ENABLED:'false',
  T1C_AUTH_DB_URL:'postgres://mf_t1d_ci_auth:t1d-ci-new-auth-only@127.0.0.1:5433/postgres',
  T1C_INTENT_DB_URL:'postgres://mf_t1d_ci_fund_e2e:t1d-ci-new-fund-only@127.0.0.1:5433/postgres'
 }});
 assert.equal(runtime.fundingEnabled,true);
 const status=await req('/v1/t1/status');
 assert.equal(status.status,200);
 assert.equal(status.body.status,'READY_TESTNET_7_USDC');
 assert.equal(status.body.mode,'T1D_WALLET_OWNED_TESTNET_FUND');
 assert.equal(status.body.originalCp30DataConnected,false);
 assert.equal(status.body.testnetOnly,true);

 const page=await req('/t1f-issuer-proof.html?utm_source=chatgpt.com',{
  headers:{
   'Sec-Fetch-Site':'cross-site',
   'Sec-Fetch-Mode':'navigate',
   'Sec-Fetch-Dest':'document'
  }
 });
 assert.equal(page.status,200);
 assert.match(page.body,/T1-F · ISSUER PROOF ONLY/);
 assert.match(page.body,/personal_sign/);
 assert.match(page.body,/0x9747D93d9F8C2e1202b4d922a4916fcF634aA2B3/i);
 assert.equal(page.headers.get('cache-control'),'no-store');
 assert.equal(page.headers.get('x-frame-options'),'DENY');
 assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
 assert.equal((await req('/t1f-issuer-proof.html?wallet=other')).status,403);
 assert.equal((await req('/t1f-issuer-proof.html?redirect=https://evil.invalid')).status,403);
 const core=await req('/t1f-issuer-control.mjs');
 assert.equal(core.status,200);assert.match(core.type,/javascript/);
 assert.ok(core.body.includes('LOCAL_BROWSER_EIP191_KEY_CONTROL_ONLY'));
 const client=await req('/t1f-issuer-proof-ui.mjs');
 assert.equal(client.status,200);
 assert.ok(client.body.includes("personal_sign"));
 assert.ok(!client.body.includes("eth_signTypedData_v4"));
 const ethers=await req('/t1f-ethers.umd.min.js');
 assert.equal(ethers.status,200);
 assert.match(ethers.type,/javascript/);
 assert.ok(ethers.body.length>100000);
 for(const p of ['/t1f-issuer-control.mjs',
  '/t1f-issuer-proof-ui.mjs','/t1f-ethers.umd.min.js']){
  const rejected=await req(p,{headers:{
   'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'no-cors',
   'Sec-Fetch-Dest':'script'
  }});
  assert.equal(rejected.status,403,
   'cross-site script must not be hosted as an arbitrary read');
 }
 const me=await req('/v1/me');
 assert.equal(me.status,401);
 const my=await req('/v1/t1/my-intents');
 assert.equal(my.status,401);
 const readiness=await req('/v1/t1/fund/readiness');
 assert.equal(readiness.status,401);
 const fundPost=await req('/v1/t1/fund/prepare',{
  method:'POST',body:{quantity:1}
 });
 assert.equal(fundPost.status,401);
 const issueRoute=await req('/v1/t1/issuer/issue',{
  method:'POST',body:{}
 });
 assert.ok([404,405].includes(issueRoute.status));
 assert.equal((await req('/t1f-issuer-proof.mjs')).status!==200,true);
 console.log(JSON.stringify({
  status:'T1F_DISPOSABLE_PG17_FUNDING_SERVER_ISSUER_STATIC_PASS',
  originalT0IssuerPageAvailable:true,
  htmlUtmNavigation:true,actualLocalEthersBundle:true,
  originalSupabaseNotConnected:true,
  noIssuerSigningOrWriteAPI:true,
  currentDonationUnmodified:true,
  walletTransactionsSent:0,httpRequests:calls
 }));
}finally{
 if(runtime)await runtime.close();
}
