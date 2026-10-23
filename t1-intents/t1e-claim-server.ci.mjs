/**
 * Disposable PostgreSQL17 E2E: real separate T1E Auth/Claim roles can login
 * ONLY after CI activates them with fixed synthetic passwords.
 *
 * The two real user accounts stay NOLOGIN in real Supabase.
 * No real wallet has signed an EIP191/EIP712 challenge in this test.
 * NO RPC writes, ERC20 transfers, Issue, Fund, Settlement or live DBs.
 */
import assert from 'node:assert/strict';
import net from 'node:net';
import pg from 'pg';
import {startT1EClaimServer} from './t1e-claim-server.mjs';
import {PILOT_RECIPIENT} from './t1e-claim-store.mjs';
const BASE='postgres://postgres:t1e-disposable-only@127.0.0.1:5435/postgres';
assert.equal(process.env.GITHUB_ACTIONS,'true');
assert.equal(process.env.MF_T1E_DISPOSABLE_ONLY,'ack-fresh-t1e-pg17');
assert.equal(process.env.DATABASE_URL,BASE);
const admin=new pg.Client({connectionString:BASE});
const authPassword='t1e-ci-auth-only-strong',claimPassword='t1e-ci-claim-only-strong';
let runtime;
try{
 await admin.connect();
 // After exact source migration SQL has already passed under Docker CI,
 // turn ONLY the two disposable PG roles into temporary LOGIN identities.
 const current=(await admin.query(`SELECT rolname,rolcanlogin
  FROM pg_roles WHERE rolname IN ('mf_t1e_auth_runtime','mf_t1e_claim_runtime')
  ORDER BY rolname`)).rows;
 assert.deepEqual(current.map(x=>x.rolcanlogin),[false,false]);
 await admin.query(`ALTER ROLE mf_t1e_auth_runtime LOGIN PASSWORD '${authPassword}';
  ALTER ROLE mf_t1e_claim_runtime LOGIN PASSWORD '${claimPassword}';`);
 const selector=net.createServer();
 await new Promise(resolve=>selector.listen(0,'127.0.0.1',resolve));
 const port=selector.address().port;
 await new Promise(resolve=>selector.close(resolve));
 const origin='http://127.0.0.1:'+port;
 const env={
  GITHUB_ACTIONS:'true',MF_T1E_DISPOSABLE_ONLY:'ack-fresh-t1e-pg17',
  MF_T1E_HTTP_DISPOSABLE_ONLY:'ack-claim-http-pg17',
  PUBLIC_ORIGIN:origin,PORT:String(port),
  T1E_DEPLOYMENT_STAGE:'CLAIM_SIWE_ONLY',
  T1E_AUTH_DB_URL:'postgres://mf_t1e_auth_runtime:'+authPassword+'@127.0.0.1:5435/postgres',
  T1E_CLAIM_DB_URL:'postgres://mf_t1e_claim_runtime:'+claimPassword+'@127.0.0.1:5435/postgres',
  T1E_CLAIM_WRITES_ENABLED:'false',
  T1E_WALLET_TX_ENABLED:'false',
  T1E_SETTLEMENT_ENABLED:'false'
 };
 runtime=await startT1EClaimServer({env});
 const run=async(path,{method='GET',headers={},data}={})=>{
  const response=await fetch(origin+path,{
   method,redirect:'manual',
   headers:{Accept:'application/json',
    ...(method==='POST'?{
     Origin:origin,'Content-Type':'application/json'
    }:{}),...headers},
   ...(data===undefined?{}:{body:JSON.stringify(data)})
  });
  const ct=response.headers.get('content-type')||'';
  return {status:response.status,headers:response.headers,
   data:ct.startsWith('application/json')?
    await response.json():await response.text()};
 };
 const status=await run('/v1/t1e/status');
 assert.equal(status.status,200);
 assert.equal(status.data.status,'T1E_ISOLATED_SIWE_READ_ONLY');
 assert.equal(status.data.recipientClaimWriteEnabled,false);
 assert.equal(status.data.issuerIssueEnabled,false);
 assert.equal(status.data.fundEnabled,false);
 assert.equal(status.data.settleEnabled,false);
 assert.equal((await run('/')).status,200);
 assert.equal((await run('/t1e-claim.mjs')).status,200);
 assert.equal((await run('/t1e-claim.css')).status,200);
 assert.equal((await run('/?utm_source=chatgpt.com')).status,200);
 assert.equal((await run('/v1/t1e/me')).status,401);
 assert.equal((await run('/v1/t1e/claim/me')).status,401);
 assert.equal((await run('/v1/t1e/issuer/readiness')).status,401);
 const noClaim=await run('/v1/t1e/claim/prepare',{method:'POST',data:{}});
 assert.equal(noClaim.status,405);
 assert.equal(noClaim.data.error,'T1E_CLAIM_WRITES_DISABLED');
 const pre=await run('/v1/auth/pre-session',{
  method:'POST',headers:{'x-c1-bootstrap':'1'},data:{}
 });
 assert.equal(pre.status,200);
 assert.match(pre.headers.get('set-cookie'),/__Host-mcpay_c1_pre=/);
 const challenge=await run('/v1/identity/wallet/challenge',{
  method:'POST',data:{address:PILOT_RECIPIENT},
  headers:{Cookie:pre.headers.get('set-cookie').split(';')[0],
   'X-C1-CSRF':pre.data.csrf}
 });
 assert.equal(challenge.status,200);
 assert.equal(challenge.data.address,PILOT_RECIPIENT);
 const login=await run('/v1/identity/wallet/login',{
  method:'POST',data:{challengeId:challenge.data.challengeId,
   signature:'0x'+'1'.repeat(130)},
  headers:{Cookie:pre.headers.get('set-cookie').split(';')[0],
   'X-C1-CSRF':pre.data.csrf}
 });
 assert.equal(login.status,401);
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM mf_t1e_auth.sessions')).rows[0].n,0);
 const counts=(await admin.query(`SELECT
  (SELECT count(*) FROM mf_t1e.recipient_claims) AS claims,
  (SELECT count(*) FROM mf_t1e.claim_events) AS events,
  (SELECT count(*) FROM mf_t1c.intents WHERE stage='FUNDED') AS funded`)).rows[0];
 assert.equal(counts.claims,'1'); // disposable fixture's synthetic Issued Claim only
 assert.equal(counts.funded,'1');
 console.log(JSON.stringify({
  status:'T1E_REAL_DUAL_ROLE_SIWE_READONLY_PG17_HTTP_PASS',
  twoIndependentLoginRoles:true,onlyTestPG:true,
  unauthenticatedPrivateAPIBlocked:true,
  invalidRecipientSIWESignatureRejected:true,
  claimWriteDisabled:true,
  issuerTransactionsDisabled:true,
  originalTestnetFundUnaffected:true,
  actualUserClaimCreated:false,realChainTxSent:0
 }));
}finally{
 if(runtime)await runtime.close().catch(()=>{});
 await admin.end().catch(()=>{});
}
