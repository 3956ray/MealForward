/**
 * MealForward T1-D: Mac-owner-only activation of TWO NEW, NOLOGIN Supabase
 * application principals. Never run on Render, GitHub Actions or a hosted
 * agent. No privileged credentials or new role passwords travel through chat.
 *
 * Prepares a chmod 0600 local env file BEFORE any SQL changes; if COMMIT
 * becomes ambiguous, DO NOT retry and preserve that file for recovery.
 * The historic T1-C principals and old Mac CP30 Journal remain untouched.
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
const AUTH='mf_t1d_auth_runtime';
const FUND='mf_t1d_fund_runtime';
const T1D_ORIGIN='https://mealforward-t1d-funding-laodao.onrender.com';
const RENDER_URL='https://dashboard.render.com/web/srv-dbd0nl67bikc73a5grh0/env';
const safe=(pass,code)=>{if(!pass)throw Error(code)};
export function validateT1DAdminDsn(raw){
 safe(typeof raw==='string'&&raw.length<=2048,'T1D_ADMIN_DSN_REQUIRED');
 let u;
 try{u=new URL(raw)}catch{throw Error('T1D_ADMIN_DSN_INVALID')}
 safe(['postgres:','postgresql:'].includes(u.protocol),
  'T1D_ADMIN_PROTOCOL_DENIED');
 safe(u.hostname===HOST&&u.port==='5432'&&u.pathname==='/postgres'&&
  !u.search&&!u.hash&&!u.username.includes('@'),
  'T1D_ONLY_APPROVED_SUPABASE_SESSION_POOLER');
 safe(u.username==='postgres.'+PROJECT,
  'T1D_ORIGINAL_SUPABASE_ADMIN_ONLY');
 safe(u.password.length>0&&
  decodeURIComponent(u.password)!=='[YOUR-PASSWORD]'&&
  !decodeURIComponent(u.password).includes(' '),
  'T1D_ADMIN_PASSWORD_REQUIRED');
 return {host:HOST,project:PROJECT};
}
export function validateT1DRoles(rows){
 safe(Array.isArray(rows)&&rows.length===2,'T1D_EXPECT_EXACTLY_TWO_NEW_ROLES');
 const roles=new Map(rows.map(x=>[x.rolname,x]));
 safe(roles.size===2,'T1D_DUPLICATE_ROLE');
 for(const name of [AUTH,FUND]){
  const role=roles.get(name);
  safe(role&&!role.rolcanlogin&&!role.rolsuper&&!role.rolbypassrls&&
   !role.rolcreaterole&&!role.rolcreatedb,
   'T1D_NEW_ROLES_MUST_BE_NOLOGIN');
 }
 return true;
}
export function validateT1DGrants(r){
 safe(r&&r.auth_select&&r.auth_insert&&r.auth_update&&
  r.fund_select&&r.fund_insert&&r.fund_quote_read&&
  r.fund_quote_insert&&r.fund_attempt_insert&&
  !r.old_auth_sees_new&&!r.new_auth_sees_old&&
  !r.auth_sees_funds&&!r.fund_sees_auth&&
  !r.old_fund_can_write&&!r.old_fund_can_read_quote&&
  !r.fund_can_delete&&!r.fund_can_change_payer,
  'T1D_ISOLATED_ROLE_PRIVILEGES_NOT_VERIFIED');
 return true;
}
export function makeT1DPrivateEnv(authPassword,fundPassword){
 safe(/^[a-f0-9]{80}$/.test(authPassword)&&
  /^[a-f0-9]{80}$/.test(fundPassword)&&authPassword!==fundPassword,
  'T1D_RANDOM_SECRETS_REQUIRED');
 const dsn=(name,secret)=>
  'postgresql://'+name+'.'+PROJECT+':'+secret+'@'+HOST+':5432/postgres';
 return 'T1C_AUTH_DB_URL='+dsn(AUTH,authPassword)+'\n'+
  'T1C_INTENT_DB_URL='+dsn(FUND,fundPassword)+'\n';
}
function ownerOnly(){
 safe(process.platform==='darwin'&&process.stdin.isTTY&&
  process.stdout.isTTY&&!process.env.CI&&!process.env.GITHUB_ACTIONS&&
  !process.env.RENDER&&!process.env.RENDER_SERVICE_ID,
  'T1D_MAC_OWNER_TTY_REQUIRED');
}
export async function activateT1DRolesFromMac(){
 ownerOnly();
 const raw=process.env.T1D_SUPABASE_ADMIN_DSN;
 validateT1DAdminDsn(raw);
 const rl=createInterface({input:process.stdin,output:process.stdout});
 let confirmation='';
 try{
  confirmation=await rl.question(
   'T1-D testnet ONLY. Type ACTIVATE T1D TWO ROLES: '
  );
 }finally{rl.close()}
 safe(confirmation==='ACTIVATE T1D TWO ROLES',
  'T1D_OPERATOR_EXPLICIT_CONFIRMATION_REQUIRED');
 const tls=verifiedSupabasePoolerTls({host:HOST});
 const client=new pg.Client({
  connectionString:raw,ssl:tls,connectionTimeoutMillis:10000
 });
 let connected=false,transacting=false,commitAttempted=false;
 let path=null,phase='CONNECT';
 try{
  await client.connect();connected=true;
  phase='TRANSACTION';
  await client.query('BEGIN');transacting=true;
  phase='VERIFY_ROLES';
  const roles=await client.query(
   "SELECT rolname,rolcanlogin,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb "+
   "FROM pg_roles WHERE rolname IN ('"+AUTH+"','"+FUND+"')"
  );
  validateT1DRoles(roles.rows);
  phase='VERIFY_SCHEMA_AND_GRANTS';
  const grants=await client.query(
   "SELECT "+
   "has_table_privilege('"+AUTH+"','mf_t1d_auth.sessions','SELECT') AS auth_select,"+
   "has_table_privilege('"+AUTH+"','mf_t1d_auth.sessions','INSERT') AS auth_insert,"+
   "has_table_privilege('"+AUTH+"','mf_t1d_auth.sessions','UPDATE') AS auth_update,"+
   "has_table_privilege('"+FUND+"','mf_t1c.intents','SELECT') AS fund_select,"+
   "has_table_privilege('"+FUND+"','mf_t1c.intents','INSERT') AS fund_insert,"+
   "has_table_privilege('"+FUND+"','mf_t1c.quote_authorizations','SELECT') AS fund_quote_read,"+
   "has_table_privilege('"+FUND+"','mf_t1c.quote_authorizations','INSERT') AS fund_quote_insert,"+
   "has_table_privilege('"+FUND+"','mf_t1c.wallet_attempts','INSERT') AS fund_attempt_insert,"+
   "has_schema_privilege('mf_t1c_auth_runtime','mf_t1d_auth','USAGE') AS old_auth_sees_new,"+
   "has_schema_privilege('"+AUTH+"','mf_cp31_auth_pilot','USAGE') AS new_auth_sees_old,"+
   "has_schema_privilege('"+AUTH+"','mf_t1c','USAGE') AS auth_sees_funds,"+
   "has_schema_privilege('"+FUND+"','mf_t1d_auth','USAGE') AS fund_sees_auth,"+
   "has_table_privilege('mf_t1c_intent_runtime','mf_t1c.intents','INSERT') AS old_fund_can_write,"+
   "has_table_privilege('mf_t1c_intent_runtime','mf_t1c.quote_authorizations','SELECT') AS old_fund_can_read_quote,"+
   "has_table_privilege('"+FUND+"','mf_t1c.intents','DELETE') AS fund_can_delete,"+
   "has_column_privilege('"+FUND+"','mf_t1c.intents','payer','UPDATE') AS fund_can_change_payer"
  );
  safe(grants.rowCount===1,'T1D_ROLE_PRIVILEGE_ROWS');
  validateT1DGrants(grants.rows[0]);
  const empty=await client.query(
   "SELECT (SELECT count(*) FROM mf_t1d_auth.sessions) AS sessions,"+
   "(SELECT count(*) FROM mf_t1c.intents) AS intents,"+
   "(SELECT count(*) FROM mf_t1c.wallet_attempts) AS attempts,"+
   "(SELECT count(*) FROM mf_t1c.quote_authorizations) AS quotes"
  );
  safe(empty.rowCount===1&&Object.values(empty.rows[0]).every(x=>String(x)==='0'),
   'T1D_STAGING_NOT_EMPTY_REFUSE_NEW_CREDENTIALS');
  phase='WRITE_OWNER_LOCAL_SECRET';
  const authKey=randomBytes(40).toString('hex');
  const fundKey=randomBytes(40).toString('hex');
  const secretFile=makeT1DPrivateEnv(authKey,fundKey);
  const dir=join(homedir(),'Library','Application Support','MealForward');
  await mkdir(dir,{recursive:true,mode:0o700});
  const st=await lstat(dir);
  safe(st.isDirectory()&&!st.isSymbolicLink(),'T1D_UNSAFE_OWNER_SECRET_FOLDER');
  await chmod(dir,0o700);
  path=join(dir,'t1d-render-'+randomBytes(12).toString('hex')+'.env');
  const file=await open(path,'wx',0o600);
  try{
   await file.writeFile(secretFile,{encoding:'utf8'});
   await file.sync();
  }finally{await file.close()}
  // Fixed SQL role identifiers, hex-only randomly generated values.
  // No database logs, URLs or SQL content are echoed to stdout.
  phase='ALTER_ROLES';
  await client.query("ALTER ROLE "+AUTH+" LOGIN PASSWORD '"+authKey+"'");
  await client.query("ALTER ROLE "+FUND+" LOGIN PASSWORD '"+fundKey+"'");
  phase='COMMIT';
  commitAttempted=true;
  await client.query('COMMIT');transacting=false;
  phase='VERIFY_LOGIN';
  const verify=await client.query(
   "SELECT rolname,rolcanlogin,rolsuper,rolbypassrls "+
   "FROM pg_roles WHERE rolname IN ('"+AUTH+"','"+FUND+"')"
  );
  safe(verify.rowCount===2&&verify.rows.every(x=>
   x.rolcanlogin===true&&x.rolsuper===false&&x.rolbypassrls===false),
   'T1D_POST_COMMIT_LOGIN_NOT_CONFIRMED');
  process.stdout.write('\nT1D_OWNER_TWO_ROLE_LOGIN_READY\n');
  process.stdout.write('Secret file (private, chmod 0600): '+path+'\n');
  process.stdout.write('Render service: '+RENDER_URL+'\n');
  process.stdout.write('Only T1-D role DSNs are in this file. NEVER paste into chat.\n');
  process.stdout.write('Configure Render env ONLY after the next CI/release gate.\n');
  return {ready:true,noFundsBroadcast:true,origin:T1D_ORIGIN};
 }catch(e){
  if(transacting)await client.query('ROLLBACK').catch(()=>{});
  // Never delete a file when COMMIT was attempted: commit outcome may be
  // unknown even when the client reports an error. NEVER auto-retry.
  if(path&&!commitAttempted)await unlink(path).catch(()=>{});
  const reason=phase==='COMMIT'?'T1D_COMMIT_OUTCOME_UNKNOWN_DO_NOT_RETRY':
   'T1D_LOCAL_ACTIVATION_'+phase+'_FAILED';
  throw Error(reason);
 }finally{
  if(connected)await client.end().catch(()=>{});
 }
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 try{await activateT1DRolesFromMac()}
 catch(e){
  const message=/^T1D_[A-Z0-9_]{5,100}$/.test(e?.message||'')?
   e.message:'T1D_OPERATOR_ACTIVATION_DENIED';
  process.stderr.write(message+'\n');
  process.exitCode=1;
 }
}
