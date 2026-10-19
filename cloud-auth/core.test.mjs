import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {makePilotHandler} from './core.mjs';

const addr='0x'+'a'.repeat(40),sign='0x'+'b'.repeat(130);
const hash=v=>createHash('sha256').update(v).digest('hex');
function memoryStore(){
 const pre=new Map(),challenge=new Map(),sessions=new Map();
 return {
  async health(){return true},
  async createPre(x){pre.set(x.preHash,{...x,used:false})},
  async createChallenge(x){const p=pre.get(x.preHash);if(!p||p.used||p.csrfHash!==x.csrfHash)return false;challenge.set(x.challenge.challengeId,{...x,used:false});return true},
  async getChallenge({preHash,csrfHash,challengeId,now}){const x=challenge.get(challengeId),p=pre.get(preHash);return x&&!x.used&&x.preHash===preHash&&x.csrfHash===csrfHash&&p&&!p.used&&x.challenge.expiresAt>now?x.challenge:null},
  async consumeAndCreateSession(x){const p=pre.get(x.preHash),z=challenge.get(x.challenge.challengeId);if(!p||p.used||!z||z.used||z.challenge!==x.challenge)return false;p.used=true;z.used=true;sessions.set(x.sessionHash,{wallet:x.wallet,csrf:x.sessionCsrfHash,expiresAt:x.expiresAt,revoked:false});return true},
  async getSession(sh,now){let s=sessions.get(sh);return s&&!s.revoked&&s.expiresAt>now?s:null},
  async revokeSession(sh,csrf,now){let s=sessions.get(sh);if(!s||s.revoked||s.csrf!==csrf||s.expiresAt<=now)return false;s.revoked=true;return true},
 };
}
async function fixture(){
 const st=memoryStore(),log=[];let time=1760000000;
 let origin,handle;
 const server=http.createServer((req,res)=>handle(req,res));
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 origin=`http://127.0.0.1:${server.address().port}`;
 handle=makePilotHandler({store:st,origin,clock:()=>time,newId:()=>'11111111-1111-4111-8111-111111111111',issueToken:(()=>{let i=0;return()=>Buffer.alloc(32,++i).toString('base64url')})(),siwe:{
   makeChallenge:args=>({challengeId:args.challengeId,address:args.wallet,chainId:args.chainId,nonce:args.nonce,domain:new URL(args.origin).host,uri:args.origin,issuedAt:args.issuedAt,expiresAt:args.expiresAt,message:'fixed test SIWE'}),
   verifyChallenge:async(challenge,sig,now)=>{log.push(['verify',now]);if(sig!==sign)throw Error('bad signature');return challenge.address}
 }});
 const call=async(method,path,data,options={})=>{
   const headers={...(method==='POST'?{'Origin':origin,'Content-Type':'application/json'}:{}),...options.headers};
   const reply=await fetch(origin+path,{method,headers,body:method==='POST'?JSON.stringify(data):undefined});
   const result=await reply.json();return {status:reply.status,body:result,cookie:reply.headers.get('set-cookie')};
 };
 return {call,log,advance:sec=>{time+=sec},stop:()=>new Promise((ok,fail)=>server.close(e=>e?fail(e):ok()))};
}

test('public setup is marked auth-only, no user is silently authenticated',async()=>{
 const f=await fixture();try{
  const c=await f.call('GET','/v1/connection');assert.equal(c.status,200);assert.equal(c.body.mode,'CP31_AUTH_PILOT_ONLY');assert.equal(c.body.transactionActionsEnabled,false);
  const id=await f.call('GET','/v1/identity/setup');assert.equal(id.body.walletLoginEnabled,true);
  assert.equal((await f.call('GET','/v1/me')).status,401);
  assert.equal((await f.call('POST','/v1/support/intents',{})).status,503);
  const catalog=await f.call('GET','/v1/stores');
  assert.equal(catalog.status,503);
  assert.equal(catalog.body.error,'ORIGINAL_BUSINESS_NOT_CONNECTED');
  for(const path of ['/v1/ledger','/v1/my/orders','/v1/my/claims','/v1/my/vouchers']){
    const result=await f.call('GET',path);
    assert.equal(result.status,503);
    assert.equal(result.body.error,'ORIGINAL_BUSINESS_NOT_CONNECTED');
    assert.equal(result.body.mode,'CP31_AUTH_PILOT_ONLY');
  }
  assert.equal(c.body.businessSourceConnected,false);
  assert.equal(c.body.originalPrincipalCompatible,false);
 }finally{await f.stop()}
});

test('wallet challenge and signature produce a real server-side session, consumed once',async()=>{
 const f=await fixture();try{
  const pre=await f.call('POST','/v1/auth/pre-session',{}, {headers:{'X-C1-Bootstrap':'1'}});assert.equal(pre.status,200);assert.ok(pre.cookie.startsWith('__Host-mcpay_c1_pre='));
  const preCookie=pre.cookie.split(';')[0],c=pre.body.csrf;
  const ask=await f.call('POST','/v1/identity/wallet/challenge',{address:addr},{headers:{Cookie:preCookie,'X-C1-CSRF':c}});
  assert.equal(ask.status,200);assert.equal(ask.body.address,addr);
  const login=await f.call('POST','/v1/identity/wallet/login',{challengeId:ask.body.challengeId,signature:sign},{headers:{Cookie:preCookie,'X-C1-CSRF':c}});
  assert.equal(login.status,200);assert.ok(login.cookie.startsWith('__Host-mcpay_c1_session='));
  const sessCookie=login.cookie.split(';')[0];
  const me=await f.call('GET','/v1/me',null,{headers:{Cookie:sessCookie}});
  assert.equal(me.status,200);assert.equal(me.body.walletAddress,addr);
  const replay=await f.call('POST','/v1/identity/wallet/login',{challengeId:ask.body.challengeId,signature:sign},{headers:{Cookie:preCookie,'X-C1-CSRF':c}});
  assert.equal(replay.status,401);assert.equal(replay.body.error,'CHALLENGE_EXPIRED_OR_CONSUMED');
  const logout=await f.call('POST','/v1/auth/logout',{}, {headers:{Cookie:sessCookie,'X-C1-CSRF':login.body.csrf}});
  assert.equal(logout.status,200);
  assert.equal((await f.call('GET','/v1/me',null,{headers:{Cookie:sessCookie}})).status,401);
  assert.equal(f.log.length,1);
 }finally{await f.stop()}
});

test('wrong Origin, absent CSRF and invalid signature cannot establish session',async()=>{
 const f=await fixture();try{
  const bad=await f.call('POST','/v1/auth/pre-session',{}, {headers:{Origin:'https://attacker.invalid','X-C1-Bootstrap':'1'}});
  assert.equal(bad.status,403);
  const pre=await f.call('POST','/v1/auth/pre-session',{}, {headers:{'X-C1-Bootstrap':'1'}}),p=pre.cookie.split(';')[0];
  const none=await f.call('POST','/v1/identity/wallet/challenge',{address:addr},{headers:{Cookie:p}});
  assert.equal(none.status,403);
  const a=await f.call('POST','/v1/identity/wallet/challenge',{address:addr},{headers:{Cookie:p,'X-C1-CSRF':pre.body.csrf}});
  const invalid=await f.call('POST','/v1/identity/wallet/login',{challengeId:a.body.challengeId,signature:'0x'+'e'.repeat(130)},{headers:{Cookie:p,'X-C1-CSRF':pre.body.csrf}});
  assert.equal(invalid.status,401);assert.equal(invalid.body.error,'WALLET_LOGIN_REJECTED');assert.ok(!invalid.cookie); // no session created.
  assert.equal((await f.call('GET','/v1/me')).status,401);
 }finally{await f.stop()}
});

test('expired challenge cannot log in even with previously valid format',async()=>{
 const f=await fixture();try{
  const pre=await f.call('POST','/v1/auth/pre-session',{}, {headers:{'X-C1-Bootstrap':'1'}}),p=pre.cookie.split(';')[0];
  const c=await f.call('POST','/v1/identity/wallet/challenge',{address:addr},{headers:{Cookie:p,'X-C1-CSRF':pre.body.csrf}});
  f.advance(181);
  const r=await f.call('POST','/v1/identity/wallet/login',{challengeId:c.body.challengeId,signature:sign},{headers:{Cookie:p,'X-C1-CSRF':pre.body.csrf}});
  assert.equal(r.status,401);assert.equal(r.body.error,'CHALLENGE_EXPIRED_OR_CONSUMED');assert.equal(f.log.length,0);
 }finally{await f.stop()}
});

test('wrong session CSRF and forged cookie never mutate authenticated state',async()=>{
 const f=await fixture();try{
  const pre=await f.call('POST','/v1/auth/pre-session',{}, {headers:{'X-C1-Bootstrap':'1'}}),p=pre.cookie.split(';')[0];
  const c=await f.call('POST','/v1/identity/wallet/challenge',{address:addr},{headers:{Cookie:p,'X-C1-CSRF':pre.body.csrf}});
  const ok=await f.call('POST','/v1/identity/wallet/login',{challengeId:c.body.challengeId,signature:sign},{headers:{Cookie:p,'X-C1-CSRF':pre.body.csrf}});
  const session=ok.cookie.split(';')[0];
  const bad=await f.call('POST','/v1/auth/logout',{}, {headers:{Cookie:session,'X-C1-CSRF':'0'.repeat(43)}});
  assert.equal(bad.status,401);
  assert.equal((await f.call('GET','/v1/me',null,{headers:{Cookie:session}})).status,200);
  assert.equal((await f.call('GET','/v1/me',null,{headers:{Cookie:session+'x'}})).status,401);
 }finally{await f.stop()}
});
