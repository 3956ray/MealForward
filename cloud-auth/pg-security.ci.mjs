/**
 * G0 genuine PostgreSQL 17 security gate, isolated from the live Render DB.
 * Real EIP-191 signatures use ephemeral local keys; no wallet, RPC, secrets,
 * original CP30 data, signer or customer session is accessed.
 */
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
import {privateKeyToAccount,generatePrivateKey} from 'viem/accounts';
import {makePilotHandler} from './core.mjs';
import {makeChallenge,verifyChallenge} from './siwe.mjs';
import {initializeSchema,pgStore} from './db.mjs';

const EXPECTED='postgres://postgres:gha-g0-ci-only@127.0.0.1:5432/mealforward_g0_ci_only';
let pool,server,origin,now=1800000000;
const HEADERS={ 'Content-Type':'application/json' };
const getCookie=response=>{
  const raw=response.headers.get('set-cookie');
  assert.equal(typeof raw,'string');
  return raw.split(';',1)[0];
};
const hash=text=>createHash('sha256').update(text).digest('hex');
async function invoke(method,path,data,{cookie,csrf,bootstrap=false,originHeader=origin}={}){
  const headers={...HEADERS};
  if(method!=='GET')headers.Origin=originHeader;
  if(cookie)headers.Cookie=cookie;
  if(csrf)headers['X-C1-CSRF']=csrf;
  if(bootstrap)headers['X-C1-Bootstrap']='1';
  const response=await fetch(origin+path,{
    method,headers,
    ...(method==='GET'?{}:{body:JSON.stringify(data)}),
    redirect:'error'
  });
  return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';',1)[0]};
}
async function pre(){
  const value=await invoke('POST','/v1/auth/pre-session',{}, {bootstrap:true});
  assert.equal(value.status,200);
  assert.ok(value.cookie?.startsWith('__Host-mcpay_c1_pre='));
  return {pre:value.cookie,csrf:value.body.csrf};
}
async function challenge(account,session){
  const value=await invoke('POST','/v1/identity/wallet/challenge',{address:account.address.toLowerCase()},{cookie:session.pre,csrf:session.csrf});
  return value;
}
async function attempt(account,session,challengeDto){
  const signature=await account.signMessage({message:challengeDto.message});
  return invoke('POST','/v1/identity/wallet/login',{challengeId:challengeDto.challengeId,signature},{cookie:session.pre,csrf:session.csrf});
}
async function signedIn(account){
  const session=await pre();
  const ch=await challenge(account,session);
  assert.equal(ch.status,200);
  const result=await attempt(account,session,ch.body);
  assert.equal(result.status,200);
  assert.ok(result.cookie?.startsWith('__Host-mcpay_c1_session='));
  return {...session,challenge:ch.body,login:result};
}
const account=()=>privateKeyToAccount(generatePrivateKey());

before(async()=>{
  if(process.env.GITHUB_ACTIONS!=='true'||
     process.env.MF_G0_PG_DISPOSABLE_ONLY!=='ack-local-ci-auth-postgres-17'||
     process.env.DATABASE_URL!==EXPECTED)
    throw Error('DISPOSABLE_GITHUB_POSTGRES_ONLY');
  pool=new pg.Pool({connectionString:EXPECTED,max:16,connectionTimeoutMillis:3000});
  const version=await pool.query('SHOW server_version_num');
  assert.ok(Number(version.rows[0].server_version_num)>=170000&&Number(version.rows[0].server_version_num)<180000,'PG17 required');
  const schemas=await pool.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'c1\\_%' ESCAPE '\\' LIMIT 1");
  assert.equal(schemas.rowCount,0,'original CP30 schema must not be present');
  const existing=await pool.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name='mf_cp31_auth_pilot'");
  assert.equal(existing.rowCount,0,'fresh disposable auth schema required');
  await initializeSchema(pool);
  let handler;
  server=http.createServer((req,res)=>handler(req,res));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  origin='http://127.0.0.1:'+server.address().port;
  handler=makePilotHandler({store:pgStore(pool),siwe:{makeChallenge,verifyChallenge},origin,clock:()=>now});
});
after(async()=>{
  if(server)await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
  if(pool)await pool.end();
});

test('server persists SHA-256 token hashes, never raw session or CSRF values',async()=>{
  const user=account(),logged=await signedIn(user);
  const rawPre=logged.pre.slice(logged.pre.indexOf('=')+1);
  const actual=await pool.query('SELECT pre_hash,csrf_hash FROM mf_cp31_auth_pilot.pre_sessions WHERE pre_hash=$1',[hash(rawPre)]);
  assert.equal(actual.rowCount,1);
  assert.equal(actual.rows[0].pre_hash,hash(rawPre));
  assert.notEqual(actual.rows[0].csrf_hash,logged.csrf);
  const rawSession=logged.login.cookie.split('=')[1];
  const saved=await pool.query('SELECT token_hash,csrf_hash,wallet FROM mf_cp31_auth_pilot.sessions WHERE token_hash=$1',[hash(rawSession)]);
  assert.equal(saved.rowCount,1);
  assert.notEqual(saved.rows[0].token_hash,rawSession);
  assert.notEqual(saved.rows[0].csrf_hash,logged.login.body.csrf);
  assert.equal(saved.rows[0].wallet,user.address.toLowerCase());
});

test('independently signed wallets A and B produce isolated bearer sessions',async()=>{
  const a=account(),b=account();
  const [sa,sb]=await Promise.all([signedIn(a),signedIn(b)]);
  const [ra,rb]=await Promise.all([
    invoke('GET','/v1/me',null,{cookie:sa.login.cookie}),
    invoke('GET','/v1/me',null,{cookie:sb.login.cookie})
  ]);
  assert.equal(ra.status,200);assert.equal(rb.status,200);
  assert.equal(ra.body.walletAddress,a.address.toLowerCase());
  assert.equal(rb.body.walletAddress,b.address.toLowerCase());
  assert.notEqual(ra.body.walletAddress,rb.body.walletAddress);
  assert.equal((await invoke('GET','/v1/me',null,{cookie:'__Host-mcpay_c1_session='+'a'.repeat(43)})).status,401);
  assert.equal((await invoke('GET','/v1/my/vouchers',null,{cookie:sa.login.cookie})).status,503);
  assert.equal((await invoke('GET','/v1/my/vouchers',null,{cookie:sb.login.cookie})).status,503);
});

test('parallel replay of ONE original signed challenge authorizes ONE and only ONE session',async()=>{
  const user=account(),session=await pre(),ch=await challenge(user,session);
  assert.equal(ch.status,200);
  const sig=await user.signMessage({message:ch.body.message});
  const baseline=await pool.query('SELECT count(*)::int AS n FROM mf_cp31_auth_pilot.sessions WHERE wallet=$1',[user.address.toLowerCase()]);
  const result=await Promise.all(Array.from({length:12},()=>
    invoke('POST','/v1/identity/wallet/login',{challengeId:ch.body.challengeId,signature:sig},{cookie:session.pre,csrf:session.csrf})));
  assert.equal(result.filter(x=>x.status===200).length,1);
  assert.ok(result.filter(x=>[401,409].includes(x.status)).length===11);
  const after=await pool.query('SELECT count(*)::int AS n FROM mf_cp31_auth_pilot.sessions WHERE wallet=$1',[user.address.toLowerCase()]);
  assert.equal(after.rows[0].n-baseline.rows[0].n,1);
});

test('foreign signer, foreign pre-session and invalid origin never authenticate',async()=>{
  const a=account(),b=account(),p=await pre(),ch=await challenge(a,p);
  assert.equal(ch.status,200);
  const foreign=await attempt(b,p,ch.body);
  assert.equal(foreign.status,401);
  const different=await pre();
  const wrong=await attempt(a,different,ch.body);
  assert.equal(wrong.status,401);
  const unrelated=await invoke('POST','/v1/identity/wallet/challenge',{address:a.address.toLowerCase()},{cookie:p.pre,csrf:p.csrf,originHeader:'https://evil.example'});
  assert.equal(unrelated.status,403);
  const correct=await attempt(a,p,ch.body);
  assert.equal(correct.status,200);
});

test('challenge expires exactly at original deadline; expired signed requests do not create sessions',async()=>{
  const user=account(),p=await pre(),ch=await challenge(user,p);
  assert.equal(ch.status,200);
  const original=now;
  try{
    now=ch.body.expiresAt;
    const expired=await attempt(user,p,ch.body);
    assert.equal(expired.status,401);
    const count=await pool.query('SELECT count(*)::int AS n FROM mf_cp31_auth_pilot.sessions WHERE wallet=$1',[user.address.toLowerCase()]);
    assert.equal(count.rows[0].n,0);
  }finally{now=original;}
});

test('session logout requires exact CSRF and does not revoke another wallet',async()=>{
  const a=account(),b=account();
  const [sa,sb]=await Promise.all([signedIn(a),signedIn(b)]);
  const invalid=await invoke('POST','/v1/auth/logout',{}, {cookie:sa.login.cookie,csrf:'b'.repeat(43)});
  assert.equal(invalid.status,401);
  assert.equal((await invoke('GET','/v1/me',null,{cookie:sa.login.cookie})).status,200);
  const ok=await invoke('POST','/v1/auth/logout',{}, {cookie:sa.login.cookie,csrf:sa.login.body.csrf});
  assert.equal(ok.status,200);
  assert.equal((await invoke('GET','/v1/me',null,{cookie:sa.login.cookie})).status,401);
  const stillB=await invoke('GET','/v1/me',null,{cookie:sb.login.cookie});
  assert.equal(stillB.status,200);
  assert.equal(stillB.body.walletAddress,b.address.toLowerCase());
});

test('one pre-session cannot obtain more than 3 challenges under parallel access',async()=>{
  const p=await pre(),user=account();
  const challenges=await Promise.all(Array.from({length:12},()=>
    challenge(user,p)));
  assert.ok(challenges.every(x=>[200,409].includes(x.status)));
  assert.equal(challenges.filter(x=>x.status===200).length,3,
    'Atomic cap must survive parallel POST challenges for one pre-session');
  const raw=p.pre.split('=')[1],preHash=hash(raw);
  const row=await pool.query('SELECT count(*)::int AS n FROM mf_cp31_auth_pilot.challenges WHERE pre_hash=$1',[preHash]);
  assert.equal(row.rows[0].n,3);
});
