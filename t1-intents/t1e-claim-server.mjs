/**
 * T1-E dedicated Auth+Claim service, NEVER bundled into T1-D.
 * Two independent Supabase private PG roles and source-pinned TLS.
 * Only ROLE_PROOF_ONLY runs without credentials. This module is loaded
 * solely for isolated stages after owner-Mac local role activation.
 *
 * No Issuer wallet signing, no tx broadcaster, no fund/settle route.
 */
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {makePilotHandler} from './auth/core.mjs';
import {makeChallenge,verifyChallenge} from './auth/siwe.mjs';
import {pgStoreT1E} from './auth/t1e-db.mjs';
import {claimStore} from './t1e-claim-store.mjs';
import {makeT1EClaimGateway} from './t1e-claim-http.mjs';
import {firstVoucherCandidate} from './t1e-first-issue-readiness.mjs';
import {verifiedSupabasePoolerTls} from './supabase-tls.mjs';
import {T1E_ORIGIN} from './t1e-role-proof-server.mjs';
const PROJECT='ketfrukrcuosrqynnsay';
const DB_HOST='aws-0-ap-southeast-2.pooler.supabase.com';
const AUTH_ROLE='mf_t1e_auth_runtime';
const CLAIM_ROLE='mf_t1e_claim_runtime';
const FAIL=(x,c)=>{if(!x)throw Error(c)};
const ci=(e)=>e.GITHUB_ACTIONS==='true'&&
 e.MF_T1E_DISPOSABLE_ONLY==='ack-fresh-t1e-pg17'&&
 e.MF_T1E_HTTP_DISPOSABLE_ONLY==='ack-claim-http-pg17';
const URL_RULE=/^https:\/\/[a-z0-9-]+\.onrender\.com$/;
export function validateT1EClaimConfig(e=process.env){
 const testing=ci(e);
 const stage=e.T1E_DEPLOYMENT_STAGE;
 FAIL(['CLAIM_SIWE_ONLY','CLAIM_CONSENT'].includes(stage),
  'T1E_CLAIM_STAGE_NOT_REVIEWED');
 const origin=e.PUBLIC_ORIGIN,port=Number(e.PORT);
 FAIL(origin===T1E_ORIGIN||
  testing&&/^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(origin||''),
  'T1E_CLAIM_PUBLIC_ORIGIN_NOT_PINNED');
 FAIL(Number.isSafeInteger(port)&&port>=1&&port<=65535&&
  (!testing||origin.endsWith(':'+port)),
  'T1E_CLAIM_PORT_INVALID');
 FAIL(e.T1E_CLAIM_WRITES_ENABLED===(stage==='CLAIM_CONSENT'?'true':'false')&&
  e.T1E_WALLET_TX_ENABLED==='false'&&
  e.T1E_SETTLEMENT_ENABLED==='false',
  'T1E_NO_ISSUE_OR_MERCHANT_WRITES_ALLOWED');
 for(const flag of ['T1C_AUTH_DB_URL','T1C_INTENT_DB_URL',
  'T1E_SUPABASE_ADMIN_DSN','T1C_SUPABASE_ADMIN_DSN']){
  FAIL(!e[flag],'T1E_OLD_DB_OR_ADMIN_SECRETS_FORBIDDEN');
 }
 const urls=[
  ['T1E_AUTH_DB_URL',AUTH_ROLE],
  ['T1E_CLAIM_DB_URL',CLAIM_ROLE]
 ];
 const chosen=[];
 for(const [key,role] of urls){
  let u;
  try{u=new URL(e[key]);}catch{throw Error('T1E_REVIEWED_DSN_REQUIRED')}
  FAIL(['postgres:','postgresql:'].includes(u.protocol)&&
   u.pathname==='/postgres'&&!u.search&&!u.hash&&
   u.password.length>=12,
   'T1E_PRIVATE_DSN_INVALID');
  if(testing){
   FAIL(u.hostname==='127.0.0.1'&&u.port==='5435'&&u.username===role,
    'T1E_CI_ONLY_DISPOSABLE_DB_REQUIRED');
  }else{
   FAIL(u.hostname===DB_HOST&&u.port==='5432'&&
    u.username===role+'.'+PROJECT,
    'T1E_CROSS_PROJECT_OR_ROLE_DENIED');
  }
  chosen.push(e[key]);
 }
 FAIL(chosen[0]!==chosen[1],'T1E_TWO_DISTINCT_PRIVATE_DB_ROLES_REQUIRED');
 return Object.freeze({
  stage,origin,port,testing,authUrl:chosen[0],claimUrl:chosen[1],
  expectedAuth:AUTH_ROLE,expectedClaim:CLAIM_ROLE
 });
}
const STATIC_HEADERS={
 'Cache-Control':'no-store',
 'Content-Security-Policy':"default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; connect-src 'self'; script-src 'self'; style-src 'self'",
 'Referrer-Policy':'no-referrer',
 'X-Content-Type-Options':'nosniff',
 'X-Frame-Options':'DENY',
 'Permissions-Policy':'camera=(),microphone=(),geolocation=()'
};
export async function startT1EClaimServer({env=process.env}={}){
 const cfg=validateT1EClaimConfig(env);
 const tls=cfg.testing?null:verifiedSupabasePoolerTls({host:DB_HOST});
 const options=u=>({
  connectionString:u,...(cfg.testing?{}:{ssl:tls}),
  max:cfg.testing?5:2,connectionTimeoutMillis:8000,
  idleTimeoutMillis:20000
 });
 const authPool=new pg.Pool(options(cfg.authUrl));
 const claimPool=new pg.Pool(options(cfg.claimUrl));
 let server;
 try{
  const [a,b]=await Promise.all([
   authPool.query('SELECT current_user AS who'),
   claimPool.query('SELECT current_user AS who')
  ]);
  FAIL(a.rows[0]?.who===AUTH_ROLE&&b.rows[0]?.who===CLAIM_ROLE,
   'T1E_RUNTIME_DATABASE_PRINCIPAL_MISMATCH');
  const [authCheck,claimCheck]=await Promise.all([
   authPool.query(`SELECT
     has_schema_privilege(current_user,'mf_t1e_auth','USAGE') AS own,
     has_table_privilege(current_user,'mf_t1e_auth.sessions','SELECT') AS session_read,
     has_schema_privilege(current_user,'mf_t1e','USAGE') AS claim,
     has_schema_privilege(current_user,'mf_t1c','USAGE') AS money,
     has_schema_privilege(current_user,'mf_t1d_auth','USAGE') AS old_auth`),
   claimPool.query(`SELECT
     has_schema_privilege(current_user,'mf_t1e','USAGE') AS own,
     has_table_privilege(current_user,'mf_t1e.recipient_claims','INSERT') AS claim_write,
     has_column_privilege(current_user,'mf_t1e.recipient_claims','beneficiary_wallet','UPDATE') AS identity_rewrite,
     has_schema_privilege(current_user,'mf_t1e_auth','USAGE') AS auth,
     has_schema_privilege(current_user,'mf_t1c','USAGE') AS money,
     has_table_privilege(current_user,'mf_t1e.recipient_claims','DELETE') AS erase`)
  ]);
  const x=authCheck.rows[0],y=claimCheck.rows[0];
  FAIL(x.own&&x.session_read&&!x.claim&&!x.money&&!x.old_auth&&
   y.own&&y.claim_write&&!y.identity_rewrite&&!y.auth&&!y.money&&!y.erase,
   'T1E_LEAST_PRIVILEGE_CROSS_SCHEMA_VIOLATION');
  const auth=pgStoreT1E(authPool),claims=claimStore(claimPool);
  FAIL(await auth.health()&&await claims.health(),
   'T1E_PRIVATE_AUTH_OR_CLAIM_SCHEMA_MISSING');
  const siwe={
   makeChallenge(args){
    const normalized=args.wallet?.toLowerCase();
    const admitted=new Set([
     '0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3',
     '0x2539fefe77a5ce4d09d2225c2e8a7517b22b9135'
    ]);
    FAIL(admitted.has(normalized),'T1E_ONLY_TWO_PILOT_WALLETS_ALLOWED');
    return makeChallenge(args);
   },verifyChallenge
  };
  const handler=makePilotHandler({store:auth,siwe,origin:cfg.origin});
  const app=makeT1EClaimGateway({
   origin:cfg.origin,stage:cfg.stage,
   authStore:auth,claimStore:claims,loginHandler:handler,
   readiness:()=>firstVoucherCandidate()
  });
  const files=new Map(await Promise.all([
   ['/','t1e-claim.html','text/html; charset=utf-8'],
   ['/t1e-claim.mjs','t1e-claim.mjs','text/javascript; charset=utf-8'],
   ['/t1e-claim.css','t1e-claim.css','text/css; charset=utf-8']
  ].map(async([url,file,type])=>[
   url,{bytes:await readFile(new URL('./public/'+file,import.meta.url)),type}
  ])));
  server=http.createServer((req,res)=>{
   const u=new URL(req.url||'/',cfg.origin);
   const item=files.get(u.pathname);
   if(item&&(req.method==='GET'||req.method==='HEAD')){
    if(req.headers.host!==new URL(cfg.origin).host||
     (u.pathname!=='/'&&u.search)||u.search.length>400){
     res.writeHead(403,{'Cache-Control':'no-store'});res.end();return;
    }
    res.writeHead(200,{...STATIC_HEADERS,'Content-Type':item.type,
     'Content-Length':item.bytes.length});
    res.end(req.method==='HEAD'?undefined:item.bytes);
    return;
   }
   void app(req,res);
  });
  await new Promise((resolve,reject)=>{
   server.once('error',reject);
   server.listen(cfg.port,cfg.testing?'127.0.0.1':'0.0.0.0',resolve);
  });
  return Object.freeze({
   server,config:cfg,
   async close(){
    await new Promise(resolve=>server.close(resolve));
    await Promise.all([authPool.end(),claimPool.end()]);
   }
  });
 }catch(e){
  await Promise.all([authPool.end().catch(()=>{}),claimPool.end().catch(()=>{})]);
  throw e;
 }
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 try{
  const app=await startT1EClaimServer();
  process.stdout.write(JSON.stringify({
   status:'T1E_ISOLATED_CLAIM_SERVICE_READY',
   stage:app.config.stage,
   claimWritesEnabled:app.config.stage==='CLAIM_CONSENT',
   fundEnabled:false,issuerTransactionsEnabled:false,settleEnabled:false,
   originalCp30Connected:false
  })+'\n');
  let closing=false;
  const close=async()=>{if(closing)return;closing=true;await app.close();process.exit(0)};
  process.on('SIGINT',close);process.on('SIGTERM',close);
 }catch(e){
  // Don't reveal a DSN, SQL error, signature, cookie, auth token or stack.
  const msg=typeof e?.message==='string'&&/^T1E_[A-Z_]{4,100}$/.test(e.message)?
   e.message:'T1E_CLAIM_BOOT_FAIL_CLOSED';
  process.stderr.write(msg+'\n');process.exitCode=1;
 }
}
