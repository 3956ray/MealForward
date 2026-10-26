/** Standalone Phase6 collector. No legacy router, signer or migration activation. */
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import pg from 'pg';
import {verifiedSupabasePoolerTls} from './supabase-tls.mjs';
import {makeApprovalStore} from './t1f-approval-store.mjs';
import {makeApprovalService} from './t1f-approval-service.mjs';
import {requireApproval as check,exactKeys} from './t1f-approval-protocol.mjs';
const HOST='aws-0-ap-southeast-2.pooler.supabase.com',PROJECT='ketfrukrcuosrqynnsay';
const LOGIN='mf_t1f_approval_login',ROLE='mf_t1f_approval_runtime';
const HASH=x=>createHash('sha256').update(x).digest('hex');
function validOrigin(origin,testing){
 let u;try{u=new URL(origin)}catch{return false}
 return u.origin===origin&&!u.username&&!u.password&&
  (testing?u.protocol==='http:'&&u.hostname==='127.0.0.1'&&/^\d{2,5}$/.test(u.port):u.protocol==='https:'&&!u.port&&u.hostname.includes('.')&&!['mealforward-t1e-claim-laodao.onrender.com','mealforward-t1e-role-proof-laodao.onrender.com'].includes(u.hostname));
}
export function validateApprovalConfig(env=process.env){
 const testing=env.MF_T1F_APPROVAL_FIXTURE==='ack-local-phase6-fixture';
 check(env.T1F_APPROVAL_MODE==='COLLECTION_NO_RELEASE','MODE');
 const origin=env.T1F_APPROVAL_ORIGIN,port=Number(env.PORT);
 check(validOrigin(origin,testing)&&Number.isInteger(port)&&port>0&&port<=65535&&(!testing||new URL(origin).port===String(port)),'ORIGIN_CONFIG');
 for(const [key,value] of Object.entries(env))if(value&&key!=='T1F_APPROVAL_DB_URL'&&(/(?:DATABASE_URL|DB_URL|DSN)$/.test(key)||/PRIVATE_KEY|SERVICE_ROLE_KEY|SUPABASE.*KEY/.test(key)))check(false,'LEGACY_CREDENTIALS');
 check(!env.PGOPTIONS&&!env.PGSSLMODE&&!env.NODE_TLS_REJECT_UNAUTHORIZED,'TLS_OVERRIDE');
 let u;try{u=new URL(env.T1F_APPROVAL_DB_URL)}catch{throw Error('T1F_APPROVAL_DB_CONFIG')}
 check(['postgres:','postgresql:'].includes(u.protocol)&&u.pathname==='/postgres'&&!u.search&&!u.hash&&u.password.length>=12,'DB_CONFIG');
 check(testing?u.hostname==='127.0.0.1'&&u.port==='15439'&&u.username===LOGIN:u.hostname===HOST&&u.port==='5432'&&u.username===LOGIN+'.'+PROJECT,'DB_IDENTITY');
 return Object.freeze({origin,port,testing,login:LOGIN,dbUrl:env.T1F_APPROVAL_DB_URL});
}
/** Actual catalog capability audit, including PUBLIC and indirect role memberships.
 * Inaccessible ambient PUBLIC table grants do not confer access. Explicit grants,
 * ownership and legacy application-table privileges remain forbidden even when
 * schema USAGE is absent. No platform-wide ACLs are changed or allowlisted.
 */
export async function verifyApprovalRuntime(pool){
 const {rows}=await pool.query(`WITH RECURSIVE memberships AS (
  SELECT oid FROM pg_roles WHERE rolname='mf_t1f_approval_login'
  UNION SELECT m.roleid FROM pg_auth_members m JOIN memberships x ON m.member=x.oid
 ), principals AS (SELECT oid FROM pg_roles WHERE rolname IN ('mf_t1f_approval_login','mf_t1f_approval_runtime'))
 SELECT session_user,current_user,
 (SELECT count(*)=3 AND bool_and(NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolinherit AND rolcanlogin=(rolname='mf_t1f_approval_login')) FROM pg_roles WHERE rolname IN ('mf_t1f_approval_login','mf_t1f_approval_runtime','mf_t1f_approval_owner')) AS role_safe,
 (SELECT count(*)=2 AND bool_and(r.rolname IN ('mf_t1f_approval_login','mf_t1f_approval_runtime')) FROM memberships m JOIN pg_roles r ON r.oid=m.oid) AS membership_safe,
 NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN principals r WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','f')
 AND (has_schema_privilege(r.oid,n.oid,'USAGE') OR n.nspname LIKE 'mf_%' OR c.relowner=r.oid
  OR EXISTS(SELECT 1 FROM aclexplode(c.relacl) acl WHERE acl.grantee=r.oid)
  OR EXISTS(SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) acl WHERE a.attrelid=c.oid AND acl.grantee=r.oid))
 AND (has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN principals r WHERE c.relkind='S' AND n.nspname NOT LIKE 'pg_%' AND has_sequence_privilege(r.oid,c.oid,'USAGE,SELECT,UPDATE')) AS tables_safe,
 ((SELECT count(*)=5 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='mf_t1f_recovery' AND has_function_privilege('mf_t1f_approval_runtime',p.oid,'EXECUTE') AND p.proname IN ('context','current_round','get_round','create_round','record_approval') AND p.prosecdef AND p.proowner=(SELECT oid FROM pg_roles WHERE rolname='mf_t1f_approval_owner') AND p.proconfig @> ARRAY['search_path=pg_catalog','statement_timeout=5s','lock_timeout=2s'])
 AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN principals r WHERE n.nspname LIKE 'mf_%' AND has_schema_privilege(r.oid,n.oid,'USAGE') AND has_function_privilege(r.oid,p.oid,'EXECUTE') AND NOT (r.oid=(SELECT oid FROM pg_roles WHERE rolname='mf_t1f_approval_runtime') AND n.nspname='mf_t1f_recovery' AND p.proname IN ('context','current_round','get_round','create_round','record_approval')))) AS functions_safe,
 NOT EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN principals r WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND (has_schema_privilege(r.oid,n.oid,'CREATE') OR (n.nspname LIKE 'mf_%' AND has_schema_privilege(r.oid,n.oid,'USAGE') AND NOT (n.nspname='mf_t1f_recovery' AND r.oid=(SELECT oid FROM pg_roles WHERE rolname='mf_t1f_approval_runtime'))))) AS schema_safe`);
 const r=rows[0];check(rows.length===1&&r?.session_user===LOGIN&&r.current_user===ROLE&&['role_safe','membership_safe','tables_safe','functions_safe','schema_safe'].every(k=>r[k]===true),'RUNTIME_CAPABILITY');
}
/** Session poolers may ignore startup options. Await least-privilege selection
 * on the acquired connection before each application query; never use an async
 * Pool connect-event listener whose completion is not awaited by borrowers.
 */
export function approvalCapabilityPool(raw){
 return Object.freeze({
  async query(sql,args){
   const client=await raw.connect();let failed=true;
   try{
    await client.query("SET ROLE mf_t1f_approval_runtime; SET statement_timeout='5s'; SET lock_timeout='2s'");
    const result=await client.query(sql,args);failed=false;return result;
   }finally{client.release(failed)}
  },
  end:()=>raw.end()
 });
}
export async function openApprovalRuntime({env=process.env}={}){
 const cfg=validateApprovalConfig(env);
 const rawPool=new pg.Pool({connectionString:cfg.dbUrl,max:2,connectionTimeoutMillis:5000,idleTimeoutMillis:20000,...(cfg.testing?{ssl:false}:{ssl:verifiedSupabasePoolerTls({host:HOST})})});
 // Suppress raw database error events. Request handlers expose only generic errors.
 rawPool.on('error',()=>{});
 const pool=approvalCapabilityPool(rawPool);
 try{await verifyApprovalRuntime(pool);const store=makeApprovalStore({pool});await store.context();return {cfg,pool,service:makeApprovalService({store})}}
 catch{await pool.end();throw Error('T1F_APPROVAL_RUNTIME_UNAVAILABLE')}
}
const HEADERS=Object.freeze({'Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; connect-src 'self'; script-src 'self'; style-src 'self'",'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Permissions-Policy':'camera=(),microphone=(),geolocation=()','Strict-Transport-Security':'max-age=31536000'});
const ASSETS=new Map([['/',['t1f-approval.html','text/html']],['/t1f-approval.html',['t1f-approval.html','text/html']],['/t1f-approval.mjs',['t1f-approval.mjs','text/javascript']],['/t1f-approval.css',['t1f-approval.css','text/css']],['/approval-ethers-6.15.0.mjs',['../node_modules/ethers/dist/ethers.min.js','text/javascript']]]);
const httpError=status=>Object.assign(Error('REQUEST_REJECTED'),{status});
async function jsonBody(req){
 if(req.headers['content-type']!=='application/json'||req.headers['content-encoding']||Number(req.headers['content-length']||0)>2048)throw httpError(400);
 let size=0;const parts=[];
 for await(const part of req){size+=part.length;if(size>2048)throw httpError(400);parts.push(part)}
 try{const body=JSON.parse(Buffer.concat(parts).toString('utf8'));if(!body||typeof body!=='object'||Array.isArray(body))throw Error();return body}catch{throw httpError(400)}
}
export function makeApprovalHttpHandler({service,origin,testing=false,clock=()=>Math.floor(Date.now()/1000)}={}){
 check(validOrigin(origin,testing)&&service?.status&&service?.submit,'HTTP_CONFIG');
 const host=new URL(origin).host,cookieName=testing?'mf_t1f_approval_fixture':'__Host-mf_t1f_approval';
 const sessions=new Map();let minute=-1,requests=0,created=0,active=0;
 return async(req,res)=>{
  const abort=new AbortController();req.on('aborted',()=>abort.abort());res.on('close',()=>{if(!res.writableEnded)abort.abort()});
  const deadline=setTimeout(()=>{abort.abort();if(!res.writableEnded)res.destroy()},75000);
  const send=(status,value,extra={})=>{if(!res.destroyed&&!res.writableEnded){res.writeHead(status,{...HEADERS,'Content-Type':'application/json; charset=utf-8',...extra});res.end(JSON.stringify(value))}};
  let entered=false;
  try{
   if(req.headers.host!==host||req.url.includes('?')||req.url.includes('#')||req.url.length>100||Object.keys(req.headers).some(k=>k==='authorization'||/^x-(?:wallet|address|role|user|auth)(?:-|$)/.test(k)))throw httpError(400);
   const now=clock(),bucket=Math.floor(now/60);if(bucket!==minute){minute=bucket;requests=0;created=0}
   for(const [key,s] of sessions)if(s.expires<=now)sessions.delete(key);
   if(++requests>120||active>=8)throw httpError(429);active++;entered=true;
   if(req.headers.origin&&req.headers.origin!==origin)throw httpError(403);
   if(req.method==='GET'&&req.url==='/health'){send(200,{status:'APPROVAL_COLLECTOR',noRelease:true});return}
   if(req.method==='GET'&&ASSETS.has(req.url)){
    const [file,type]=ASSETS.get(req.url),bytes=await readFile(new URL('./public/'+file,import.meta.url));
    if(!res.destroyed){res.writeHead(200,{...HEADERS,'Content-Type':type+'; charset=utf-8'});res.end(bytes)}return;
   }
   if(req.headers['sec-fetch-site']!=='same-origin')throw httpError(403);
   if(req.method==='POST'&&req.headers.origin!==origin)throw httpError(403);
   if(req.method==='POST'&&req.url==='/v1/approval/session'){
    if(!exactKeys(await jsonBody(req),[]))throw httpError(400);
    if(++created>12||sessions.size>=32)throw httpError(429);
    const token=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');
    sessions.set(HASH(token),{csrf:HASH(csrf),expires:now+300,submits:0});
    send(200,{csrf,expiresAt:now+300},{'Set-Cookie':cookieName+'='+token+'; Path=/; Max-Age=300; '+(testing?'':'Secure; ')+'HttpOnly; SameSite=Strict'});return;
   }
   if(!((req.method==='GET'&&req.url==='/v1/approval/state')||(req.method==='POST'&&req.url==='/v1/approval/submit')))throw httpError(405);
   const cookie=req.headers.cookie,csrf=req.headers['x-approval-csrf'];
   if(typeof cookie!=='string'||cookie.length>4096||typeof csrf!=='string'||!/^[0-9a-f]{64}$/.test(csrf))throw httpError(401);
   const pieces=cookie.split(';').map(s=>s.trim());
   if(pieces.length>32||pieces.some(s=>!/^[-!#$%&'*+.^_`|~0-9A-Za-z]+=[\x21-\x3a\x3c-\x7e]*$/.test(s)))throw httpError(401);
   const own=pieces.filter(s=>s.startsWith(cookieName+'='));
   if(own.length!==1||!new RegExp('^'+cookieName+'=[0-9a-f]{64}$').test(own[0]))throw httpError(401);
   const session=sessions.get(HASH(own[0].slice(cookieName.length+1)));
   if(!session||session.expires<=now||!timingSafeEqual(Buffer.from(HASH(csrf),'hex'),Buffer.from(session.csrf,'hex')))throw httpError(401);
   if(req.method==='GET'){send(200,await service.status());return}
   if(++session.submits>6)throw httpError(429);
   const body=await jsonBody(req);if(!exactKeys(body,['role','roundId','digest','signature']))throw httpError(400);
   if(abort.signal.aborted)throw httpError(408);
   send(200,await service.submit(body,{signal:abort.signal}));
  }catch(e){send(e?.status||503,{error:e?.status?'REQUEST_REJECTED':'APPROVAL_NOT_CONFIRMED_REFRESH_STATE',noRelease:true})}
  finally{clearTimeout(deadline);if(entered)active--}
 };
}
export async function startApprovalServer({env=process.env}={}){
 const runtime=await openApprovalRuntime({env});
 const server=http.createServer({maxHeaderSize:8192},makeApprovalHttpHandler({...runtime.cfg,service:runtime.service}));
 server.requestTimeout=6000;server.headersTimeout=5000;server.keepAliveTimeout=5000;server.maxConnections=32;
 try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(runtime.cfg.port,runtime.cfg.testing?'127.0.0.1':'0.0.0.0',resolve)})}
 catch{await runtime.pool.end();throw Error('T1F_APPROVAL_LISTEN_FAILED')}
 return {server,close:async()=>{await new Promise(r=>server.close(r));await runtime.pool.end()}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const running=await startApprovalServer();process.stdout.write('T1F_APPROVAL_COLLECTION_READY_NO_RELEASE\n');for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{running.close().then(()=>process.exit(0)).catch(()=>process.exit(1))})}
 catch{process.stderr.write('T1F_APPROVAL_STARTUP_FAILED\n');process.exitCode=1}
}
