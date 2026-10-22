/**
 * ONE-TIME LOCAL OPERATOR ONLY — activation of already-provisioned
 * MealForward T1-C minimal-permission Supabase PostgreSQL roles.
 *
 * NEVER run in Render, CI, ChatGPT tools or cloud functions.
 * Secrets are generated on the owner's Mac using crypto.randomBytes,
 * sent over verified PostgreSQL TLS, and printed ONCE to the owner's
 * interactive terminal to paste directly into Render Secret env vars.
 *
 * Does not store passwords in GitHub, SQL Editor history or files.
 */
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline/promises';
import pg from 'pg';

const PROJECT='ketfrukrcuosrqynnsay';
const HOST='aws-0-ap-southeast-2.pooler.supabase.com';
const ORIGIN='https://mealforward-t1c-readonly-laodao.onrender.com';
const AUTH='mf_t1c_auth_runtime';
const INTENT='mf_t1c_intent_runtime';
const check=(ok,code)=>{if(!ok)throw Error(code)};

export function validateAdminConnection(raw){
 check(typeof raw==='string'&&raw.length<=2048,'T1C_ADMIN_DSN_REQUIRED');
 const url=new URL(raw);
 check(['postgres:','postgresql:'].includes(url.protocol),'T1C_ADMIN_PROTOCOL');
 check(url.hostname===HOST&&url.port==='5432'&&url.pathname==='/postgres',
  'T1C_WRONG_SUPABASE_POOLER');
 check(url.username==='postgres.'+PROJECT,'T1C_ADMIN_ROLE_REQUIRED');
 check(url.password.length>0,'T1C_ADMIN_PASSWORD_REQUIRED');
 check(!url.search&&!url.hash,'T1C_ADMIN_DSN_QUERY_FORBIDDEN');
 return {host:HOST,project:PROJECT,origin:ORIGIN};
}
function grantProbe(rows){
 const names=new Map(rows.map(r=>[r.rolname,r]));
 check(names.size===2,'T1C_RESTRICTED_ROLES_MISSING');
 for(const name of [AUTH,INTENT]){
  const a=names.get(name);
  check(a&&!a.rolcanlogin&&!a.rolsuper&&!a.rolcreaterole&&
   !a.rolcreatedb&&!a.rolbypassrls,
   'T1C_ROLE_DRIFT_BEFORE_ACTIVATION');
 }
}
const makeDsn=(name,password)=>
 'postgresql://'+name+'.'+PROJECT+':'+password+'@'+HOST+':5432/postgres';

export async function activateFromTerminal(){
 check(process.stdin.isTTY&&process.stdout.isTTY&&
  !process.env.CI&&!process.env.GITHUB_ACTIONS&&
  !process.env.RENDER&&!process.env.RENDER_SERVICE_ID,
 'T1C_ONLY_INTERACTIVE_OWNER_TERMINAL');
 const admin=process.env.T1C_SUPABASE_ADMIN_DSN;
 validateAdminConnection(admin);
 const rl=createInterface({input:process.stdin,output:process.stdout});
 const confirmed=await rl.question(
  'T1-C staging ONLY. Type ACTIVATE READONLY to enable two login roles: '
 );
 rl.close();
 check(confirmed==='ACTIVATE READONLY','T1C_OPERATOR_DID_NOT_CONFIRM');
 const authSecret=randomBytes(40).toString('hex');
 const intentSecret=randomBytes(40).toString('hex');
 check(authSecret!==intentSecret&&
  /^[0-9a-f]{80}$/.test(authSecret)&&
  /^[0-9a-f]{80}$/.test(intentSecret),'T1C_RANDOM_GENERATOR_FAILURE');
 const client=new pg.Client({
  connectionString:admin,
  ssl:{rejectUnauthorized:true,servername:HOST},
  connectionTimeoutMillis:9000
 });
 let opened=false,committed=false;
 try{
  await client.connect();
  opened=true;
  await client.query('BEGIN');
  const roleQuery=await client.query(
   "SELECT rolname,rolcanlogin,rolsuper,rolcreaterole,rolcreatedb,rolbypassrls "+
   "FROM pg_roles WHERE rolname IN ('mf_t1c_auth_runtime','mf_t1c_intent_runtime')"
  );
  grantProbe(roleQuery.rows);
  const rights=await client.query(
   "SELECT "+
   "has_table_privilege('mf_t1c_auth_runtime','mf_cp31_auth_pilot.sessions','SELECT') AS a_auth,"+
   "has_table_privilege('mf_t1c_auth_runtime','mf_t1c.intents','SELECT') AS a_intent,"+
   "has_table_privilege('mf_t1c_intent_runtime','mf_t1c.intents','SELECT') AS i_intent,"+
   "has_table_privilege('mf_t1c_intent_runtime','mf_cp31_auth_pilot.sessions','SELECT') AS i_auth,"+
   "has_table_privilege('mf_t1c_intent_runtime','mf_t1c.intents','INSERT') AS i_insert"
  );
  const r=rights.rows[0];
  check(r.a_auth&&!r.a_intent&&r.i_intent&&!r.i_auth&&!r.i_insert,
   'T1C_CROSS_SCHEMA_ISOLATION_NOT_PROVEN');
  // Passwords are generated strictly as crypto-random hexadecimal; they
  // cannot contain SQL metacharacters or come from request parameters.
  await client.query("ALTER ROLE "+AUTH+" LOGIN PASSWORD '"+authSecret+"'");
  await client.query("ALTER ROLE "+INTENT+" LOGIN PASSWORD '"+intentSecret+"'");
  await client.query('COMMIT');
  committed=true;
 }catch{
  if(opened&&!committed)await client.query('ROLLBACK').catch(()=>{});
  throw Error('T1C_ROLE_ACTIVATION_FAILED_NO_SECRETS_PRINTED');
 }finally{
  if(opened)await client.end().catch(()=>{});
 }
 // The ONLY credential disclosure: owner's local interactive terminal.
 // Do not screenshot, copy into chat, publish in an issue or retain logs.
 process.stdout.write('\nT1C_TWO_ROLE_LOGIN_READY\n');
 process.stdout.write('Render environment: https://dashboard.render.com/web/srv-dbclmetg1s2s73dnl5h0\n');
 process.stdout.write('T1C_AUTH_DB_URL='+makeDsn(AUTH,authSecret)+'\n');
 process.stdout.write('T1C_INTENT_DB_URL='+makeDsn(INTENT,intentSecret)+'\n');
 process.stdout.write('PUBLIC_ORIGIN='+ORIGIN+'\n');
 process.stdout.write('T1C_SERVER_MODE=READ_ONLY_NO_FUNDS\n');
 process.stdout.write('T1C_FUNDING_ENABLED=false\n');
 process.stdout.write('T1C_QUOTE_SIGNER_ENABLED=false\n');
 process.stdout.write(
  '\nCopy only TWO URLs into Render > Environment, close the terminal. '+
  'Never send these secrets in ChatGPT, GitHub, a screenshot or logs.\n'
 );
 return {activated:true,noFunding:true,project:PROJECT};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 try{await activateFromTerminal()}
 catch(e){
  process.stderr.write(/^T1C_[A-Z_]{5,70}$/.test(e.message||'')?
   e.message+'\n':'T1C_OPERATOR_SETUP_DENIED\n');
  process.exitCode=1;
 }
}
