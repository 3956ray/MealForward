import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {makeApprovalHttpHandler,validateApprovalConfig,verifyApprovalRuntime,approvalCapabilityPool} from './t1f-approval-server.mjs';
const env=()=>({T1F_APPROVAL_MODE:'COLLECTION_NO_RELEASE',T1F_APPROVAL_ORIGIN:'https://approval.example.org',PORT:'8080',T1F_APPROVAL_DB_URL:'postgresql://mf_t1f_approval_login.ketfrukrcuosrqynnsay:synthetic-long-password@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres'});
test('startup requires isolated explicit mode, origin, project, role and verified TLS',()=>{
 const cfg=validateApprovalConfig(env());assert.equal(cfg.testing,false);assert.equal(cfg.login,'mf_t1f_approval_login');
 for(const change of [{T1F_APPROVAL_MODE:undefined},{T1F_APPROVAL_ORIGIN:'http://localhost:8080'},{T1F_APPROVAL_ORIGIN:'https://approval.example.org/'},{DATABASE_URL:'private'},{T1E_AUTH_DB_URL:'private'},{T1F_APPROVAL_DB_URL:env().T1F_APPROVAL_DB_URL.replace('mf_t1f_approval_login','postgres')},{T1F_APPROVAL_DB_URL:env().T1F_APPROVAL_DB_URL+'?sslmode=no-verify'},{T1F_APPROVAL_DB_URL:env().T1F_APPROVAL_DB_URL.replace('ketfrukrcuosrqynnsay','otherproject')}])assert.throws(()=>validateApprovalConfig({...env(),...change}));
 assert.throws(()=>validateApprovalConfig({...env(),T1F_APPROVAL_ORIGIN:'http://127.0.0.1:8080'}));
});
test('catalog attestation refuses extra authority, unsafe role flags and missing capability',async()=>{
 const clean={session_user:'mf_t1f_approval_login',current_user:'mf_t1f_approval_runtime',role_safe:true,membership_safe:true,tables_safe:true,functions_safe:true,schema_safe:true};
 await verifyApprovalRuntime({query:async()=>({rows:[clean]})});
 for(const key of Object.keys(clean))await assert.rejects(()=>verifyApprovalRuntime({query:async()=>({rows:[{...clean,[key]:typeof clean[key]==='boolean'?false:'postgres'}]})}));
});
async function harness(t,override={}){
 let submits=0,statusReads=0,time=1000;
 const service={status:async()=>{statusReads++;return {status:'NO_ROUND',round:null,noRelease:true}},submit:async()=>{submits++;return {status:'COLLECTING',noRelease:true}},...override};
 const server=http.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port;
 server.on('request',makeApprovalHttpHandler({service,origin,testing:true,clock:()=>time}));
 t.after(()=>new Promise(r=>server.close(r)));
 const req=(path,method='GET',body,extra={})=>fetch(origin+path,{method,headers:{Origin:origin,'Sec-Fetch-Site':'same-origin',...(method==='POST'?{'Content-Type':'application/json'}:{}),...extra},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
 const session=async()=>{const r=await req('/v1/approval/session','POST',{});assert.equal(r.status,200);return {cookie:r.headers.get('set-cookie').split(';')[0],csrf:(await r.json()).csrf,header:r.headers.get('set-cookie')}};
 return {req,session,origin,get submits(){return submits},get reads(){return statusReads},advance(){time+=300}};
}
test('real HTTP session/CSRF readback survives new session and never creates round',async t=>{
 const h=await harness(t);assert.equal((await h.req('/v1/approval/state')).status,401);
 const s=await h.session();assert.match(s.header,/HttpOnly; SameSite=Strict/);
 const headers={Cookie:s.cookie,'X-Approval-CSRF':s.csrf};
 assert.equal((await h.req('/v1/approval/state','GET',undefined,headers)).status,200);
 assert.equal((await h.req('/v1/approval/submit','POST',{role:'owner',roundId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',digest:'0x'+'1'.repeat(64),signature:'0x'+'2'.repeat(130)},headers)).status,200);
 const s2=await h.session();assert.notEqual(s2.cookie,s.cookie);
 assert.equal((await h.req('/v1/approval/state','GET',undefined,{Cookie:s2.cookie,'X-Approval-CSRF':s2.csrf})).status,200);
 h.advance();assert.equal((await h.req('/v1/approval/state','GET',undefined,headers)).status,401);
 assert.equal(h.submits,1);assert.equal(h.reads,2);
});
test('cross-origin, queries, duplicate cookies, overrides, body and financial routes deny without service calls',async t=>{
 const h=await harness(t),s=await h.session(),headers={Cookie:s.cookie,'X-Approval-CSRF':s.csrf};
 for(const [path,method,body,extra] of [
 ['/v1/approval/session','POST',{}, {Origin:'https://evil.example'}],
 ['/v1/approval/session?wallet=x','POST',{},{}],
 ['/v1/approval/session','POST',{role:'owner'},{}],
 ['/v1/approval/state','GET',undefined,{...headers,Cookie:s.cookie+'; '+s.cookie}],
 ['/v1/approval/state','GET',undefined,{...headers,'Sec-Fetch-Site':'cross-site'}],
 ['/v1/approval/state','GET',undefined,{...headers,Authorization:'Bearer fake'}],
 ['/v1/approval/state','GET',undefined,{...headers,'X-Wallet-Address':'0x123'}],
 ['/v1/approval/submit','POST',{}, {Cookie:s.cookie}],
 ['/v1/approval/submit','POST','x'.repeat(2049),headers],
 ['/v1/approval/submit','POST','{"role":"owner",',headers],
 ['/v1/approval/create','POST',{},headers],['/issue','POST',{},headers],['/release','POST',{},headers],['/fund','POST',{},headers],['/settle','POST',{},headers]
 ]){
  const r=await h.req(path,method,body,extra);assert.ok(r.status>=400,path);assert.equal(r.headers.get('access-control-allow-origin'),null);
 }
 assert.equal(h.submits,0);assert.equal(h.reads,0);
});
test('HTTP errors are generic and sessions/rates bounded',async t=>{
 const h=await harness(t,{status:async()=>{throw Error('postgres://PRIVATE signature=secret')}}),s=await h.session();
 const r=await h.req('/v1/approval/state','GET',undefined,{Cookie:s.cookie,'X-Approval-CSRF':s.csrf});
 assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/PRIVATE|signature|postgres/);
 assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);
 for(let i=0;i<11;i++)await h.req('/v1/approval/session','POST',{});
 assert.equal((await h.req('/v1/approval/session','POST',{})).status,429);
});
test('HTTP disconnect propagates cancellation to pending submission; later continuation cannot write',async t=>{
 let enter,continueWork,writes=0;const entered=new Promise(r=>enter=r),wait=new Promise(r=>continueWork=r);
 const h=await harness(t,{submit:async(body,{signal})=>{enter();await wait;if(signal.aborted)throw Error('aborted');writes++;return {noRelease:true}}});
 const s=await h.session();
 const req=http.request(h.origin+'/v1/approval/submit',{method:'POST',headers:{Origin:h.origin,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json',Cookie:s.cookie,'X-Approval-CSRF':s.csrf}});req.on('error',()=>{});req.end(JSON.stringify({role:'owner',roundId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',digest:'0x'+'1'.repeat(64),signature:'0x'+'2'.repeat(130)}));
 await entered;req.destroy();await new Promise(r=>setTimeout(r,20));continueWork();await new Promise(r=>setTimeout(r,20));assert.equal(writes,0);
});
test('fixed static assets render with same-origin ethers and strict security headers',async t=>{
 const h=await harness(t);
 for(const path of ['/','/t1f-approval.mjs','/t1f-approval.css','/approval-ethers-6.15.0.mjs']){
  const r=await h.req(path);assert.equal(r.status,200,path);assert.equal(r.headers.get('cache-control'),'no-store');assert.match(r.headers.get('content-security-policy'),/script-src 'self'/);assert.ok((await r.text()).length>100);
 }
 const status=await new Promise((resolve,reject)=>{const req=http.request(h.origin+'/v1/approval/session',{method:'POST',headers:{Host:'evil.example',Origin:h.origin,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json'}},res=>{res.resume();resolve(res.statusCode)});req.on('error',reject);req.end('{}')});assert.equal(status,400);
});
test('session cookie coexists with unrelated host cookies while duplicate target remains denied',async t=>{
 const h=await harness(t),s=await h.session();
 const headers={Cookie:'__sites_local_auth=synthetic; '+s.cookie+'; edge_hint=ok','X-Approval-CSRF':s.csrf};
 assert.equal((await h.req('/v1/approval/state','GET',undefined,headers)).status,200);
 assert.equal((await h.req('/v1/approval/state','GET',undefined,{...headers,Cookie:headers.Cookie+'; '+s.cookie})).status,401);
});

test('pool explicitly selects runtime and time limits before every query even when startup options are ignored',async()=>{
 const calls=[],releases=[];let releaseSetup;
 const ready=new Promise(r=>releaseSetup=r);
 const client={query:async(sql,args)=>{calls.push([sql,args]);if(calls.length===1)await ready;return {rows:[{ok:true}]};},release:destroy=>releases.push(destroy)};
 const pool=approvalCapabilityPool({connect:async()=>client,end:async()=>calls.push(['end'])});
 const pending=pool.query('SELECT application_result',[]);
 await new Promise(r=>setImmediate(r));assert.equal(calls.length,1);assert.match(calls[0][0],/SET ROLE mf_t1f_approval_runtime/);assert.match(calls[0][0],/statement_timeout/);assert.match(calls[0][0],/lock_timeout/);
 releaseSetup();await pending;assert.equal(calls[1][0],'SELECT application_result');
 await pool.query('SELECT second_result');assert.match(calls[2][0],/SET ROLE mf_t1f_approval_runtime/);assert.equal(calls[3][0],'SELECT second_result');assert.deepEqual(releases,[false,false]);await pool.end();assert.equal(calls.at(-1)[0],'end');
});
test('failed runtime selection destroys the client before any application query',async()=>{
 const queries=[],releases=[];
 const pool=approvalCapabilityPool({connect:async()=>({query:async sql=>{queries.push(sql);throw Error('SET denied')},release:x=>releases.push(x)}),end:async()=>{}});
 await assert.rejects(()=>pool.query('SELECT forbidden_application_query'),/SET denied/);
 assert.equal(queries.length,1);assert.deepEqual(releases,[true]);
});
