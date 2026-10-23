/**
 * Mac owner T1-E activation. Not a Render, CI or assistant action.
 * Two NEW, independently restricted Supabase roles are NOLOGIN until a
 * real human signs off. Secret database role passwords are generated on the
 * owner's Mac, written ONLY to an fsync'd 0600 file and never printed.
 *
 * NEVER run against frozen Mac CP30, original T1-C or T1-D credentials.
 */
import {randomBytes} from 'node:crypto';
import {mkdir,lstat,chmod,open,unlink} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createInterface} from 'node:readline/promises';
import pg from 'pg';
import {verifiedSupabasePoolerTls} from './supabase-tls.mjs';

const PROJECT='ketfrukrcuosrqynnsay';
const HOST='aws-0-ap-southeast-2.pooler.supabase.com';
const AUTH='mf_t1e_auth_runtime';
const CLAIM='mf_t1e_claim_runtime';
const RENDER='https://dashboard.render.com/web/srv-dbdeuft9fdbs73atbvh0/env';
const assert=(x,c)=>{if(!x)throw Error(c)};
export function validateOwnerDSN(raw){
 let u;
 try{u=new URL(raw)}catch{throw Error('T1E_ADMIN_DSN_REQUIRED')}
 assert((u.protocol==='postgres:'||u.protocol==='postgresql:')&&
  u.hostname===HOST&&u.port==='5432'&&u.pathname==='/postgres'&&
  u.username==='postgres.'+PROJECT&&
  u.password.length>=8&&!u.search&&!u.hash,
  'T1E_ADMIN_DSN_MUST_MATCH_APPROVED_STAGING_SESSION_POOLER');
 return true;
}
export function checkRoles(rows){
 assert(Array.isArray(rows)&&rows.length===2,'T1E_TWO_ROLES_REQUIRED');
 const values=new Map(rows.map(x=>[x.rolname,x]));
 assert(values.size===2,'T1E_ROLE_IDENTITY_CONFLICT');
 for(const name of [AUTH,CLAIM]){
  const x=values.get(name);
  assert(x&&x.rolcanlogin===false&&x.rolsuper===false&&
   x.rolbypassrls===false&&x.rolcreaterole===false&&
   x.rolcreatedb===false,'T1E_ROLES_MUST_BE_NOLOGIN');
 }
 return true;
}
export function checkIsolation(row){
 assert(row&&
  row.auth_can_read===true&&row.auth_can_insert===true&&
  row.claim_can_read===true&&row.claim_can_insert===true&&
  row.claim_can_stage===true&&
  row.old_auth_sees_new===false&&row.old_fund_sees_new===false&&
  row.auth_sees_claims===false&&row.claim_sees_auth===false&&
  row.auth_sees_finance===false&&row.claim_sees_finance===false&&
  row.claim_can_reassign_recipient===false&&
  row.claim_can_delete===false,'T1E_ROLE_GRANTS_NOT_ISOLATED');
 return true;
}
export function formatSecretFile(authKey,claimKey){
 assert(/^[a-f0-9]{80}$/.test(authKey)&&
  /^[a-f0-9]{80}$/.test(claimKey)&&authKey!==claimKey,
  'T1E_TWO_UNIQUE_80CHAR_KEYS_REQUIRED');
 const addr=(who,password)=>
  'postgresql://'+who+'.'+PROJECT+':'+password+'@'+HOST+':5432/postgres';
 return 'T1E_AUTH_DB_URL='+addr(AUTH,authKey)+'\n'+
  'T1E_CLAIM_DB_URL='+addr(CLAIM,claimKey)+'\n';
}
function ownerMacOnly(){
 assert(process.platform==='darwin'&&process.stdin.isTTY&&
  process.stdout.isTTY&&!process.env.CI&&!process.env.GITHUB_ACTIONS&&
  !process.env.RENDER&&!process.env.RENDER_SERVICE_ID,
  'T1E_OWNER_MAC_INTERACTIVE_ONLY');
}
export async function activateT1EFromMac(){
 ownerMacOnly();
 validateOwnerDSN(process.env.T1E_SUPABASE_ADMIN_DSN);
 const rl=createInterface({input:process.stdin,output:process.stdout});
 let accepted='';
 try{accepted=await rl.question(
  'T1-E private Recipient and Issuer login ONLY. Type ACTIVATE T1E TWO ROLES: '
 )}finally{rl.close()}
 assert(accepted==='ACTIVATE T1E TWO ROLES',
  'T1E_EXPLICIT_OWNER_APPROVAL_REQUIRED');
 const dsn=process.env.T1E_SUPABASE_ADMIN_DSN;
 const c=new pg.Client({
  connectionString:dsn,ssl:verifiedSupabasePoolerTls({host:HOST}),
  connectionTimeoutMillis:10000
 });
 let started=false,commitAttempted=false,filePath=null,phase='CONNECT';
 try{
  await c.connect();
  await c.query('BEGIN');started=true;
  phase='CHECK_DATABASE';
  const meta=(await c.query(`SELECT
   current_database() AS db,current_user AS who,
   current_setting('server_version_num')::int AS pg_version,
   (SELECT count(*) FROM mf_t1e.recipient_claims) AS claims,
   (SELECT count(*) FROM mf_t1e.claim_events) AS claim_events,
   (SELECT count(*) FROM mf_t1e_auth.sessions) AS sessions,
   (SELECT count(*) FROM mf_t1c.intents WHERE stage='FUNDED') AS funded,
   (SELECT count(*) FROM mf_t1c.wallet_attempts WHERE status='CONFIRMED') AS attempts`)).rows[0];
  assert(meta?.db==='postgres'&&meta.who==='postgres'&&
   meta.pg_version>=170000&&meta.pg_version<180000&&
   meta.claims==='0'&&meta.claim_events==='0'&&meta.sessions==='0'&&
   meta.funded==='1'&&meta.attempts==='2',
   'T1E_STAGING_STATE_NOT_SAFE_FOR_FIRST_LOGIN');
  phase='ROLE_CHECK';
  const roles=await c.query(`SELECT rolname,rolcanlogin,rolsuper,rolbypassrls,
   rolcreaterole,rolcreatedb FROM pg_roles
   WHERE rolname IN ('mf_t1e_auth_runtime','mf_t1e_claim_runtime')`);
  checkRoles(roles.rows);
  phase='PRIVILEGES';
  const priv=(await c.query(`SELECT
   has_table_privilege('mf_t1e_auth_runtime','mf_t1e_auth.sessions','SELECT') AS auth_can_read,
   has_table_privilege('mf_t1e_auth_runtime','mf_t1e_auth.sessions','INSERT') AS auth_can_insert,
   has_table_privilege('mf_t1e_claim_runtime','mf_t1e.recipient_claims','SELECT') AS claim_can_read,
   has_table_privilege('mf_t1e_claim_runtime','mf_t1e.recipient_claims','INSERT') AS claim_can_insert,
   has_column_privilege('mf_t1e_claim_runtime','mf_t1e.recipient_claims','stage','UPDATE') AS claim_can_stage,
   has_schema_privilege('mf_t1d_auth_runtime','mf_t1e_auth','USAGE') AS old_auth_sees_new,
   has_schema_privilege('mf_t1d_fund_runtime','mf_t1e','USAGE') AS old_fund_sees_new,
   has_schema_privilege('mf_t1e_auth_runtime','mf_t1e','USAGE') AS auth_sees_claims,
   has_schema_privilege('mf_t1e_claim_runtime','mf_t1e_auth','USAGE') AS claim_sees_auth,
   has_schema_privilege('mf_t1e_auth_runtime','mf_t1c','USAGE') AS auth_sees_finance,
   has_schema_privilege('mf_t1e_claim_runtime','mf_t1c','USAGE') AS claim_sees_finance,
   has_column_privilege('mf_t1e_claim_runtime','mf_t1e.recipient_claims','beneficiary_wallet','UPDATE') AS claim_can_reassign_recipient,
   has_table_privilege('mf_t1e_claim_runtime','mf_t1e.recipient_claims','DELETE') AS claim_can_delete`)).rows[0];
  checkIsolation(priv);
  phase='LOCAL_SECRET_WRITE';
  const keyA=randomBytes(40).toString('hex');
  const keyC=randomBytes(40).toString('hex');
  const content=formatSecretFile(keyA,keyC);
  const dir=join(homedir(),'Library','Application Support','MealForward');
  await mkdir(dir,{recursive:true,mode:0o700});
  const stat=await lstat(dir);
  assert(stat.isDirectory()&&!stat.isSymbolicLink(),
   'T1E_OWNER_SECRET_DIRECTORY_INVALID');
  await chmod(dir,0o700);
  filePath=join(dir,'t1e-render-'+randomBytes(12).toString('hex')+'.env');
  const fh=await open(filePath,'wx',0o600);
  try{await fh.writeFile(content,{encoding:'utf8'});await fh.sync()}
  finally{await fh.close()}
  phase='ALTER_ROLES';
  await c.query("ALTER ROLE "+AUTH+" LOGIN PASSWORD '"+keyA+"'");
  await c.query("ALTER ROLE "+CLAIM+" LOGIN PASSWORD '"+keyC+"'");
  phase='COMMIT';
  commitAttempted=true;
  await c.query('COMMIT');started=false;
  phase='VERIFY_LOGIN';
  const verified=await c.query(`SELECT rolname,rolcanlogin,rolsuper,rolbypassrls
   FROM pg_roles WHERE rolname IN ('mf_t1e_auth_runtime','mf_t1e_claim_runtime')`);
  assert(verified.rowCount===2&&verified.rows.every(x=>
   x.rolcanlogin&&!x.rolsuper&&!x.rolbypassrls),
   'T1E_POST_COMMIT_LOGIN_NOT_CONFIRMED');
  process.stdout.write('T1E_TWO_PRIVATE_ROLES_LOGIN_READY\n');
  process.stdout.write('Local secret file 0600: '+filePath+'\n');
  process.stdout.write('T1-E Render environment: '+RENDER+'\n');
  process.stdout.write('Never share database credentials, wallet keys or full DSNs.\n');
  return Object.freeze({ok:true,financeUnaffected:true});
 }catch(e){
  if(started)await c.query('ROLLBACK').catch(()=>{});
  if(filePath&&!commitAttempted)await unlink(filePath).catch(()=>{});
  const message=typeof e?.message==='string'&&/^T1E_[A-Z0-9_]{6,100}$/.test(e.message)?
   e.message:'T1E_OWNER_ACTIVATION_UNAVAILABLE';
  process.stderr.write(message+' (phase '+phase+')\n');
  if(commitAttempted)process.stderr.write(
   'COMMIT attempted: do NOT retry. Preserve the local 0600 file and reconcile the exact two role identities.\n'
  );
  throw Error(message);
 }finally{await c.end().catch(()=>{})}
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 activateT1EFromMac().catch(()=>{process.exitCode=1});
}
