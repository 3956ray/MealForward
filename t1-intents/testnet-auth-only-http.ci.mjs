/**
 * Disposable PG17 SIWE-only T1-D E2E, never real Supabase/Render/wallet TX.
 * Must run AFTER exact 006/007/008 migration CI (which creates CI roles).
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {Wallet} from 'ethers';
import pg from 'pg';
import {pgStoreT1D} from './auth/t1d-db.mjs';
import {makeChallenge,verifyChallenge} from './auth/siwe.mjs';
import {makeT1CAuthenticatedGateway} from './http-auth-gateway.mjs';

assert.equal(process.env.GITHUB_ACTIONS,'true');
assert.equal(process.env.MF_T1C_DISPOSABLE_ONLY,'ack-fresh-t1c-postgres17');
assert.equal(process.env.MF_T1C_HTTP_DISPOSABLE_ONLY,'ack-original-siwe-pg17');
assert.equal(process.env.DATABASE_URL,
 'postgres://postgres:t1c-disposable-only@127.0.0.1:5433/mf_t1c_http_ci');
const connect=(user,password)=>new pg.Pool({
 connectionString:'postgres://'+user+':'+password+'@127.0.0.1:5433/postgres',
 max:4
});
const auth=connect('mf_t1d_ci_auth','t1d-ci-new-auth-only');
const fund=connect('mf_t1d_ci_fund','t1d-ci-new-fund-only');
let server=null;
try{
 assert.equal((await auth.query('SELECT current_user')).rows[0].current_user,'mf_t1d_ci_auth');
 assert.equal((await fund.query('SELECT current_user')).rows[0].current_user,'mf_t1d_ci_fund');
 await assert.rejects(
  ()=>auth.query('SELECT * FROM mf_cp31_auth_pilot.sessions LIMIT 0'),
  e=>e.code==='42501'
 );
 await assert.rejects(
  ()=>fund.query('SELECT * FROM mf_t1d_auth.sessions LIMIT 0'),
  e=>e.code==='42501'
 );
 server=http.createServer();
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 const handler=makeT1CAuthenticatedGateway({
  sessionPool:auth,intentPool:fund,authStore:pgStoreT1D(auth),
  siwe:{makeChallenge,verifyChallenge},origin,mode:'t1d_read_only'
 });
 server.on('request',handler);
 async function req(path,{method='GET',body=null,cookie=null,csrf=null,extra={}}={}){
  const response=await fetch(origin+path,{
   method,cache:'no-store',redirect:'manual',
   headers:{
    ...(method==='POST'?{'Content-Type':'application/json',Origin:origin}:{}),
    ...(cookie?{Cookie:cookie}:{}),
    ...(csrf?{'X-C1-CSRF':csrf}:{}),...extra
   },
   ...(body===null?{}:{body:JSON.stringify(body)})
  });
  return {
   status:response.status,
   value:await response.json(),
   cookie:response.headers.get('set-cookie')?.split(';')[0]??null
  };
 }
 const state=await req('/v1/t1/status');
 assert.equal(state.status,200);
 assert.equal(state.value.status,'READY_NO_FUNDS');
 assert.equal(state.value.mode,'T1D_ISOLATED_SIWE_READ_ONLY_GATE');
 assert.equal(state.value.fundingEnabled,false);
 assert.equal(state.value.transactionActionsEnabled,false);
 assert.equal(state.value.quoteSigningEnabled,false);
 assert.equal((await req('/v1/t1/my-intents')).status,401);
 async function signIn(w){
  const pre=await req('/v1/auth/pre-session',{
   method:'POST',body:{},extra:{'X-C1-Bootstrap':'1'}
  });
  assert.equal(pre.status,200);
  const ch=await req('/v1/identity/wallet/challenge',{
   method:'POST',body:{address:w.address.toLowerCase()},
   cookie:pre.cookie,csrf:pre.value.csrf
  });
  assert.equal(ch.status,200);
  assert.equal(ch.value.uri,origin);
  assert.equal(ch.value.chainId,10143);
  const sig=await w.signMessage(ch.value.message);
  const login=await req('/v1/identity/wallet/login',{
   method:'POST',body:{challengeId:ch.value.challengeId,signature:sig},
   cookie:pre.cookie,csrf:pre.value.csrf
  });
  assert.equal(login.status,200);
  assert.ok(login.cookie?.startsWith('__Host-mcpay_c1_session='));
  return {cookie:login.cookie,csrf:login.value.csrf,address:w.address.toLowerCase()};
 }
 const a=await signIn(Wallet.createRandom());
 const b=await signIn(Wallet.createRandom());
 assert.notEqual(a.address,b.address);
 for(const w of [a,b]){
  const me=await req('/v1/me',{cookie:w.cookie});
  assert.equal(me.status,200);
  assert.equal(me.value.walletAddress,w.address);
  const mine=await req('/v1/t1/my-intents',{cookie:w.cookie});
  assert.equal(mine.status,200);
  assert.deepEqual(mine.value.items,[]);
  assert.equal(mine.value.fundingEnabled,false);
  assert.equal((await req('/v1/t1/my-intents',{
   cookie:w.cookie,extra:{'X-Wallet-Address':a.address===w.address?b.address:a.address}
  })).status,403);
 }
 for(const p of [
  '/v1/t1/intents/prepare','/v1/t1/fund/prepare',
  '/v1/t1/fund/quote','/v1/t1/fund/approve-call',
  '/v1/t1/fund/build-call','/v1/t1/fund/reserve',
  '/v1/t1/fund/bind-hash','/v1/t1/fund/reconcile'
 ]){
  const out=await req(p,{method:'POST',cookie:a.cookie,csrf:a.csrf,body:{intentId:randomUUID()}});
  assert.ok([405,503].includes(out.status),p);
  assert.equal(out.value.error,'FUNDING_DISABLED',p);
 }
 const recovery=await req('/v1/t1/fund/quote/'+randomUUID(),{cookie:a.cookie});
 assert.equal(recovery.status,405);
 assert.equal(recovery.value.error,'FUNDING_DISABLED');
 const c=await fund.query(
  'SELECT (SELECT count(*)::int FROM mf_t1c.intents) AS intents,'+
  '(SELECT count(*)::int FROM mf_t1c.wallet_attempts) AS attempts,'+
  '(SELECT count(*)::int FROM mf_t1c.quote_authorizations) AS signed'
 );
 assert.deepEqual(c.rows[0],{intents:0,attempts:0,signed:0});
 const logout=await req('/v1/auth/logout',{
  method:'POST',cookie:a.cookie,csrf:a.csrf,body:{}
 });
 assert.equal(logout.status,200);
 assert.equal((await req('/v1/me',{cookie:a.cookie})).status,401);
 assert.equal((await req('/v1/me',{cookie:b.cookie})).status,200);
 console.log(JSON.stringify({
  status:'T1D_DISPOSABLE_PG17_SIWE_ONLY_AB_HTTP_PASS',
  separateAuthAndFundRoles:true,realEphemeralEip191Wallets:2,
  thirdPartyPayerDenied:true,noFundingRoutes:true,
  committedFundingIntents:0,transactionsBroadcast:0
 }));
}finally{
 if(server)await new Promise(resolve=>server.close(resolve));
 await Promise.allSettled([auth.end(),fund.end()]);
}
