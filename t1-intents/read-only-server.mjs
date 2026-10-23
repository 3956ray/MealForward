/**
 * Deploy-ready, STRICTLY READ-ONLY MONEY Testnet T1-C HTTPS service.
 *
 * THIS DOES NOT bootstrap/create/migrate PostgreSQL. Operators must separately
 * provision a new isolated PG17 instance and two disjoint least-privilege
 * identities. The historic CP30 Mac and already-accepted G0 Render database
 * MUST NEVER be passed as either connection.
 *
 * HTTP endpoints: original CP31 G0 SIWE login/logout and authenticated
 * GET /v1/t1/intents/:id. POST /v1/t1/intents/* remains blocked,
 * even with a valid donor wallet or valid Quote Authority signature.
 *
 * No funding, no wallet broadcaster, no Quote signer, no historical Journal.
 */
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {fileURLToPath} from 'node:url';
import {makeChallenge,verifyChallenge} from './auth/siwe.mjs';
import {pgStore} from './auth/db.mjs';
import {pgStoreT1D} from './auth/t1d-db.mjs';
import {makeT1CAuthenticatedGateway} from './http-auth-gateway.mjs';
import {verifiedSupabasePoolerTls} from './supabase-tls.mjs';
import {makeReadOnlyPublicRpc} from './testnet-readonly-rpc.mjs';
import {allowStaticFetchSite} from './static-fetch-policy.mjs';
import {assertRealT0IsOpen} from './testnet-funding-chain.mjs';
import {QUOTE} from './core.mjs';

const strict=(valid,reason)=>{if(!valid)throw Error(reason)};
const PRIVILEGE_DENIAL='42501';
const ALLOWED_PUBLIC=/^https:\/\/[a-z0-9-]+\.onrender\.com$/;
const ALLOWED_TEST=/^http:\/\/127\.0\.0\.1:[0-9]{2,5}$/;
const PROJECT='ketfrukrcuosrqynnsay';
const PROD_ROLE_AUTH='mf_t1c_auth_runtime';
const FUND_ROLE_AUTH='mf_t1d_auth_runtime';
const FUND_ORIGIN='https://mealforward-t1d-funding-laodao.onrender.com';
const PROD_ROLE_INTENT='mf_t1c_intent_runtime';
// Never grant writes to the T1-C live SELECT-only principal. T1-D has its own
// separately provisioned NOLOGIN-until-owner-activation database identity.
const PROD_ROLE_FUND='mf_t1d_fund_runtime';
// Only the project-approved Supabase IPv4 session pooler may hold the
// real financial database identities. Never use a generic direct DB host,
// user-supplied URL, transaction-mode pooler or old Render G0 database.
const POOLER_HOST='aws-0-ap-southeast-2.pooler.supabase.com';

function validateConfig(env){
 const testing=env.GITHUB_ACTIONS==='true'&&
  env.MF_T1C_DISPOSABLE_ONLY==='ack-fresh-t1c-postgres17'&&
  env.MF_T1C_HTTP_DISPOSABLE_ONLY==='ack-original-siwe-pg17';
 const requested=env.T1C_SERVER_MODE;
 strict(['READ_ONLY_NO_FUNDS','T1D_SIWE_READ_ONLY','TESTNET_SINGLE_SEVEN_USDC_FUND'].includes(requested),
  'UNAPPROVED_FINANCIAL_MODE');
 const funding=requested==='TESTNET_SINGLE_SEVEN_USDC_FUND';
 const identityOnly=requested==='T1D_SIWE_READ_ONLY';
 const t1d=funding||identityOnly;
 if(t1d&&!testing)strict(env.PUBLIC_ORIGIN===FUND_ORIGIN&&
  env.T1D_DEPLOYMENT_STAGE===(funding?'FUNDING':'SIWE_ONLY'),
  'T1D_EXACT_ORIGIN_AND_STAGE_REQUIRED');
 if(identityOnly)strict(env.T1C_TESTNET_FUND_SCOPE==='DISABLED',
  'T1D_IDENTITY_ONLY_FUNDS_SCOPE_REJECTED');
 if(funding){
  strict(env.T1C_FUNDING_ENABLED==='true' &&
   env.T1C_TESTNET_FUND_SCOPE==='ONE_QUOTE_AUTHORITY_WALLET_SEVEN_USDC',
   'TESTNET_SINGLE_FUND_POLICY_REQUIRED');
 }else strict(env.T1C_FUNDING_ENABLED!=='true',
  'NO_FUNDS_MODE_CANNOT_ENABLE_FUND');
 strict(env.T1C_QUOTE_SIGNER_ENABLED!=='true',
  'T1D_NO_PLATFORM_QUOTE_PRIVATE_KEY');
 const origin=env.PUBLIC_ORIGIN;
 strict(typeof origin==='string'&&(
  ALLOWED_PUBLIC.test(origin)||(testing&&ALLOWED_TEST.test(origin))
 ),'ORIGIN_MUST_BE_EXACT_PINNED_HTTPS');
 strict(typeof env.T1C_AUTH_DB_URL==='string'&&
  typeof env.T1C_INTENT_DB_URL==='string'&&
  env.T1C_AUTH_DB_URL!==env.T1C_INTENT_DB_URL,
 'TWO_DISTINCT_DATABASE_PRINCIPALS_REQUIRED');
 const originAuth=new URL(env.T1C_AUTH_DB_URL);
 const originIntent=new URL(env.T1C_INTENT_DB_URL);
 for(const item of [originAuth,originIntent]){
  strict(['postgres:','postgresql:'].includes(item.protocol)&&
   item.username&&item.password&&item.hostname&&
   item.pathname===(testing?(t1d?'/postgres':'/mf_t1c_http_ci'):'/postgres')&&
   !item.hash&&!item.search,
   'DATABASE_DSN_NOT_REVIEWABLE');
  // Reject IPv6 direct, generic postgres user, URLs outside the newly
  // authorized Supabase project, and insecure pooler transaction port.
  if(testing)strict(item.hostname==='127.0.0.1'&&item.port==='5433',
   'CI_MUST_USE_EXACT_DISPOSABLE_PG17');
  if(!testing)strict(item.hostname===POOLER_HOST&&item.port==='5432',
   'ONLY_PINNED_SUPABASE_SESSION_POOLER');
 }
 strict(originAuth.username!==originIntent.username,
  'SAME_PG_ROLE_REJECTED');
 if(!testing){
  strict(originAuth.username===(t1d?FUND_ROLE_AUTH:PROD_ROLE_AUTH)+'.'+PROJECT&&
   originIntent.username===(t1d?PROD_ROLE_FUND:PROD_ROLE_INTENT)+'.'+PROJECT,
   'WRONG_CLOUD_ROLE_OR_SUPABASE_TENANT');
  strict(originAuth.hostname===originIntent.hostname,
   'CROSS_PROJECT_POOLER_HOST_MISMATCH');
 }
 const port=Number(env.PORT);
 strict(Number.isSafeInteger(port)&&port>=1&&port<=65535,'HTTP_PORT_REQUIRED');
 return {origin,port,testing,funding,identityOnly,t1d,authUrl:env.T1C_AUTH_DB_URL,
  intentUrl:env.T1C_INTENT_DB_URL,
  expectedAuthRole:testing?(t1d?'mf_t1d_ci_auth':'mf_t1c_ci_auth'):
   (t1d?FUND_ROLE_AUTH:PROD_ROLE_AUTH),
  expectedIntentRole:testing?(identityOnly?'mf_t1d_ci_fund_e2e':funding?'mf_t1d_ci_fund':'mf_t1c_ci_intent_ro'):
   (t1d?PROD_ROLE_FUND:PROD_ROLE_INTENT)};
}
async function roleAudit(pool){
 const query=await pool.query(
  'SELECT current_user AS role,rolsuper,rolcreaterole,rolcreatedb,rolbypassrls '+
  'FROM pg_roles WHERE rolname=current_user'
 );
 strict(query.rowCount===1,'MISSING_DATABASE_PRINCIPAL');
 const row=query.rows[0];
 strict(!row.rolsuper&&!row.rolcreaterole&&!row.rolcreatedb&&!row.rolbypassrls,
  'SUPERUSER_OR_DDL_ROLE_FORBIDDEN');
 return row.role;
}
async function mustBeDenied(pool,query){
 try{
  await pool.query(query);
 }catch(error){
  if(error.code===PRIVILEGE_DENIAL)return;
  throw Error('ISOLATION_PRIVILEGE_CHECK_FAILED');
 }
 throw Error('ISOLATION_PRIVILEGE_ESCALATION');
}

export async function startT1ReadOnlyServer({env=process.env}={}){
 const cfg=validateConfig(env);
 const tls=cfg.testing?null:verifiedSupabasePoolerTls({host:new URL(cfg.authUrl).hostname});
 const opts=url=>({
  connectionString:url,
  ...(cfg.testing?{}:{ssl:tls}),
  max:cfg.testing?8:2,
  connectionTimeoutMillis:8000,
  idleTimeoutMillis:20000
 });
 const authPool=new pg.Pool(opts(cfg.authUrl));
 const intentPool=new pg.Pool(opts(cfg.intentUrl));
 let server=null;
 let bootStage='ROLE_CHECK';
 try{
  const [authRole,intentRole]=await Promise.all([
   roleAudit(authPool),roleAudit(intentPool)
  ]);
  strict(authRole===cfg.expectedAuthRole&&intentRole===cfg.expectedIntentRole,
   'UNREVIEWED_DATABASE_LOGIN_ROLE');
  strict(authRole!==intentRole,'DATABASE_ROLES_IDENTICAL');
  bootStage='SCHEMA_CHECK';
  const [authSchema,intentSchema]=await Promise.all([
   authPool.query(cfg.t1d?
    'SELECT 1 FROM mf_t1d_auth.schema_version WHERE version=1':
    'SELECT 1 FROM mf_cp31_auth_pilot.schema_version WHERE version=1'),
   intentPool.query("SELECT to_regclass('mf_t1c.intents') IS NOT NULL AS ready")
  ]);
  strict(authSchema.rowCount===1&&intentSchema.rows[0]?.ready===true,
   'T1_C_SCHEMA_NOT_READY');
  // These negative proofs are mandatory on every process restart. A
  // shared superuser connection would fail before any HTTP handler listens.
  bootStage='GRANT_CHECK';
  await Promise.all([
   mustBeDenied(authPool,'SELECT * FROM mf_t1c.intents LIMIT 0'),
   ...(cfg.t1d?[
    mustBeDenied(authPool,'SELECT * FROM mf_cp31_auth_pilot.sessions LIMIT 0'),
    mustBeDenied(intentPool,'SELECT * FROM mf_t1d_auth.sessions LIMIT 0')
   ]:[]),
   mustBeDenied(intentPool,'SELECT * FROM mf_cp31_auth_pilot.sessions LIMIT 0'),
   mustBeDenied(intentPool,'TRUNCATE mf_t1c.audit_events'),
   mustBeDenied(intentPool,'DELETE FROM mf_t1c.intents')
  ]);
  const perms=await intentPool.query(
   "SELECT has_table_privilege(current_user,'mf_t1c.intents','INSERT') AS insert_allowed,"+
   "has_column_privilege(current_user,'mf_t1c.intents','stage','UPDATE') AS stage_update,"+
   "has_column_privilege(current_user,'mf_t1c.intents','revision','UPDATE') AS revision_update,"+
   "has_column_privilege(current_user,'mf_t1c.wallet_attempts','status','UPDATE') AS attempt_update,"+
   "has_table_privilege(current_user,'mf_t1c.wallet_attempts','INSERT') AS attempt_insert,"+
   "has_table_privilege(current_user,'mf_t1c.audit_events','INSERT') AS audit_insert"
  );
  const grant=perms.rows[0];
  const allDml=grant.insert_allowed&&grant.stage_update&&grant.revision_update&&
   grant.attempt_update&&grant.attempt_insert&&grant.audit_insert;
  const anyDml=Object.values(grant).some(Boolean);
  if(cfg.t1d){
   strict(allDml,'T1D_DURABLE_INTENT_WRITER_GRANTS_REQUIRED');
  }else{
   strict(!anyDml,'T1C_FINANCIAL_WRITES_IMPROPERLY_ENABLED');
  }
  if(cfg.t1d){
   bootStage='SIGNED_QUOTE_STORE_GRANTS';
   const signed=await intentPool.query(
    "SELECT to_regclass('mf_t1c.quote_authorizations') IS NOT NULL AS ready,"+
    "has_table_privilege(current_user,'mf_t1c.quote_authorizations','SELECT') AS can_read,"+
    "has_table_privilege(current_user,'mf_t1c.quote_authorizations','INSERT') AS can_insert,"+
    "has_table_privilege(current_user,'mf_t1c.quote_authorizations','DELETE') AS can_delete"
   );
   strict(signed.rowCount===1&&signed.rows[0]?.ready===true&&
    signed.rows[0].can_read===true&&signed.rows[0].can_insert===true&&
    signed.rows[0].can_delete===false,
    'T1D_SIGNED_QUOTE_STORE_DENIED_OR_OVERPRIVILEGED');
  }
  let readOnlyRpc=null;
  if(cfg.funding){
   bootStage='REAL_T0_PREFLIGHT';
   readOnlyRpc=makeReadOnlyPublicRpc();
   const pre=await assertRealT0IsOpen({rpc:readOnlyRpc,payer:QUOTE});
   // The read-only recovery endpoint must remain available AFTER one
   // genuine Fund, even if capacity/balance changes. New submissions are
   // denied separately at prepare/reserve with the actual live state.
   strict(pre.chainId===10143&&pre.testnetOnly,
    'T1D_REAL_T0_FUND_NOT_READY');
  }
  bootStage='GATEWAY_INIT';
  const handler=makeT1CAuthenticatedGateway({
   sessionPool:authPool,intentPool,
   authStore:cfg.t1d?pgStoreT1D(authPool):pgStore(authPool),
   siwe:{makeChallenge,verifyChallenge},origin:cfg.origin,
   mode:cfg.funding?'testnet_fund':cfg.identityOnly?'t1d_read_only':'read_only',rpc:readOnlyRpc
  });
  // Public UI is a fixed allowlist of THREE immutable local files; no
  // arbitrary filesystem path, storage directory, SSR or API secrets.
  bootStage='ASSET_LOAD';
  const exposedFiles=[
   ['/',cfg.identityOnly?'t1d-identity.html':'index.html','text/html; charset=utf-8'],
   ['/ui.css','ui.css','text/css; charset=utf-8'],
   ['/ui.mjs','ui.mjs','text/javascript; charset=utf-8']
  ];
  if(cfg.funding)exposedFiles.push(
   ['/fund-testnet.html','fund-testnet.html','text/html; charset=utf-8'],
   ['/fund-testnet.mjs','fund-testnet.mjs','text/javascript; charset=utf-8']
  );
  const staticFiles=new Map(await Promise.all(exposedFiles.map(async([path,filename,type])=>[
    path,{bytes:await readFile(new URL('./public/'+filename,import.meta.url)),type}
  ])));
  server=http.createServer((req,res)=>{
   const u=new URL(req.url||'/',cfg.origin);
   const item=staticFiles.get(u.pathname);
   if(item&&(req.method==='GET'||req.method==='HEAD')){
    // These two HTML documents are invariant and unauthenticated, so do
    // not treat an optional Origin / Sec-Fetch header as authority to
    // reject a normal browser link. Every API path still goes through the
    // original strict SIWE Origin, CSRF and per-wallet permission checks.
    const publicDocument=u.pathname==='/'||u.pathname==='/fund-testnet.html';
    if(req.headers.host!==new URL(cfg.origin).host||u.search||u.hash||
     (!publicDocument&&req.headers.origin&&req.headers.origin!==cfg.origin)||
     !allowStaticFetchSite({path:u.pathname,method:req.method,headers:req.headers})){
     res.writeHead(403,{'Cache-Control':'no-store'});res.end();return;
    }
    res.writeHead(200,{
     'Content-Type':item.type,
     'Content-Length':item.bytes.length,
     'Cache-Control':'no-store',
     'X-Content-Type-Options':'nosniff',
     'Referrer-Policy':'no-referrer',
     'X-Frame-Options':'DENY',
     'Content-Security-Policy':"default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; connect-src 'self'; script-src 'self'; style-src 'self'"
    });
    res.end(req.method==='HEAD'?undefined:item.bytes);
    return;
   }
   return handler(req,res);
  });
  bootStage='HTTP_LISTEN';
  await new Promise((resolve,reject)=>{
   server.once('error',reject);
   server.listen(cfg.port,cfg.testing?'127.0.0.1':'0.0.0.0',resolve);
  });
  return {
   server,origin:cfg.origin,authRole,intentRole,
   fundingEnabled:cfg.funding,identityOnly:cfg.identityOnly,testnetOnly:true,
   async close(){
    await new Promise(resolve=>server.close(resolve));
    await Promise.all([authPool.end(),intentPool.end()]);
   }
  };
 }catch{
  if(server?.listening)await new Promise(resolve=>server.close(resolve));
  await Promise.allSettled([authPool.end(),intentPool.end()]);
  // Only a fixed stage label is observable; never reveal credentials,
  // database names, SQL text, stack or wallet sessions in logs.
  throw Error('T1_C_READONLY_BOOT_FAIL_CLOSED_'+bootStage);
 }
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 try{
  const runtime=await startT1ReadOnlyServer();
  process.stdout.write(JSON.stringify({
   status:runtime.fundingEnabled?'T1D_ONE_MEAL_TESTNET_WALLET_READY':
     runtime.identityOnly?'T1D_SIWE_READ_ONLY_PROCESS_READY':'T1_C_SAFE_READONLY_PROCESS_READY',
   fundingEnabled:runtime.fundingEnabled,origin:runtime.origin,
   distinctDatabasePrincipals:true
  })+'\n');
  let shuttingDown=false;
  const stop=async()=>{
   if(shuttingDown)return;
   shuttingDown=true;
   await runtime.close().catch(()=>{});
   process.exit(0);
  };
  process.on('SIGTERM',stop);
  process.on('SIGINT',stop);
 }catch(e){
  // Explicit static error allowlist: reveal neither DSN credentials, SQL,
  // raw server exceptions nor the certificate contents in startup logs.
  const codes=new Set(["FINANCIAL_WRITE_MODE_FORBIDDEN","T1C_WALLET_WRITE_FLAG_FORBIDDEN","ORIGIN_MUST_BE_EXACT_PINNED_HTTPS","TWO_DISTINCT_DATABASE_PRINCIPALS_REQUIRED","DATABASE_DSN_NOT_REVIEWABLE","ONLY_PINNED_SUPABASE_SESSION_POOLER","SAME_PG_ROLE_REJECTED","WRONG_CLOUD_ROLE_OR_SUPABASE_TENANT","CROSS_PROJECT_POOLER_HOST_MISMATCH","HTTP_PORT_REQUIRED","T1_C_TLS_UNTRUSTED_HOST","T1_C_SUPABASE_CA_B64_REQUIRED","T1_C_SUPABASE_CA_B64_INVALID","T1_C_SUPABASE_CA_PEM_INVALID","T1_C_SUPABASE_CA_EXPIRED_OR_NOT_YET_VALID","T1_C_SUPABASE_CA_CERT_INVALID"]);
  const message=typeof e?.message==='string'?e.message:'';
  const safe=codes.has(message)?'T1_C_CONFIG_'+message:
   /^T1_C_READONLY_BOOT_FAIL_CLOSED_[A-Z_]{3,40}$/.test(message)?
   message:'T1_C_READONLY_BOOT_FAIL_CLOSED';
  process.stderr.write(safe+'\n');
  process.exitCode=1;
 }
}
export {validateConfig};
