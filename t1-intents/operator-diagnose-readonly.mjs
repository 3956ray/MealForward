/**
 * MealForward T1-C — OWNER MAC DIAGNOSTIC ONLY.
 * READ-ONLY DATABASE CONNECTION. NO login activation, ALTER ROLE,
 * password generation, HTTP calls, wallet operations or secret logging.
 *
 * Consumes hidden T1C_SUPABASE_ADMIN_DSN environment variable entered
 * in the owner's LOCAL terminal. Prints only safe error categories.
 */
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {validateAdminConnection} from './operator-activate-readonly.mjs';

const HOST='aws-0-ap-southeast-2.pooler.supabase.com';
const safeCode=e=>{
 const known={
  '28P01':'PASSWORD_AUTH_FAILED',
  'ENOTFOUND':'DNS_FAILURE',
  'EAI_AGAIN':'DNS_TEMPORARY_FAILURE',
  'ETIMEDOUT':'NETWORK_TIMEOUT',
  'ECONNREFUSED':'CONNECTION_REFUSED',
  'ECONNRESET':'NETWORK_RESET',
  'ERR_TLS_CERT_ALTNAME_INVALID':'TLS_HOSTNAME_MISMATCH',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE':'TLS_CA_UNVERIFIED',
  'SELF_SIGNED_CERT_IN_CHAIN':'TLS_CA_UNVERIFIED',
  'CERT_HAS_EXPIRED':'TLS_CERT_EXPIRED',
  '42501':'PG_INSUFFICIENT_PRIVILEGE',
  '3D000':'DATABASE_NOT_FOUND'
 };
 return known[e?.code]||'UNCLASSIFIED_CONNECTION_ERROR';
};
export async function diagnose(){
 if(!process.stdin.isTTY||!process.stdout.isTTY||
  process.env.CI||process.env.GITHUB_ACTIONS||process.env.RENDER)
  throw Error('LOCAL_INTERACTIVE_MAC_ONLY');
 let phase='VALIDATE_URL';
 const url=process.env.T1C_SUPABASE_ADMIN_DSN;
 let client=null,connected=false;
 try{
  validateAdminConnection(url);
  phase='CONNECT_TLS';
  client=new pg.Client({
   connectionString:url,
   ssl:{rejectUnauthorized:true,servername:HOST},
   connectionTimeoutMillis:8000
  });
  await client.connect();
  connected=true;
  phase='VERIFY_DB_ROLE';
  const user=(await client.query(
   'SELECT current_user AS username,current_database() AS database'
  )).rows[0];
  if(user.username!=='postgres'||user.database!=='postgres')
   throw Error('ADMIN_DB_ROLE_NOT_EXPECTED');
  phase='READ_ROLE_STATE';
  const res=await client.query(
   "SELECT rolname,rolcanlogin,rolsuper,rolcreaterole,rolcreatedb,rolbypassrls "+
   "FROM pg_roles WHERE rolname IN ('mf_t1c_auth_runtime','mf_t1c_intent_runtime')"
  );
  if(res.rowCount!==2)throw Error('RESTRICTED_ROLES_MISSING');
  if(res.rows.some(r=>r.rolsuper||r.rolcreaterole||r.rolcreatedb||r.rolbypassrls))
   throw Error('RESTRICTED_ROLES_TOO_POWERFUL');
  phase='REVIEW_ROLE_GRANTS';
  const rights=(await client.query(
   "SELECT "+
   "has_table_privilege('mf_t1c_auth_runtime','mf_cp31_auth_pilot.sessions','SELECT') AS a_auth,"+
   "has_table_privilege('mf_t1c_auth_runtime','mf_t1c.intents','SELECT') AS a_intent,"+
   "has_table_privilege('mf_t1c_intent_runtime','mf_t1c.intents','SELECT') AS i_intent,"+
   "has_table_privilege('mf_t1c_intent_runtime','mf_cp31_auth_pilot.sessions','SELECT') AS i_auth,"+
   "has_table_privilege('mf_t1c_intent_runtime','mf_t1c.intents','INSERT') AS i_insert"
  )).rows[0];
  if(!rights.a_auth||rights.a_intent||!rights.i_intent||rights.i_auth||rights.i_insert)
   throw Error('ROLE_GRANTS_MISMATCH');
  process.stdout.write('T1C_DIAGNOSTIC_PASS_DATABASE_CONNECTED\n');
  process.stdout.write('T1C_DIAGNOSTIC_PASS_RESTRICTED_ROLES_AND_GRANTS\n');
  process.stdout.write('T1C_ROLE_LOGIN_STATE_'+(
   res.rows.every(x=>!x.rolcanlogin)?'BOTH_NOLOGIN':
   res.rows.every(x=>x.rolcanlogin)?'BOTH_LOGIN':'PARTIAL_REVIEW_REQUIRED'
  )+'\n');
  return true;
 }catch(e){
  // A safe high-level code only. Absolutely no secret-containing pg error
  // message, user input, SQL, username, certificate bytes or stack.
  const specific=typeof e?.message==='string'&&
    /^[A-Z_]{10,60}$/.test(e.message) ? e.message : safeCode(e);
  process.stdout.write('T1C_DIAGNOSTIC_FAILED_'+phase+'_'+specific+'\n');
  return false;
 }finally{
  if(connected)await client.end().catch(()=>{});
 }
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 const ok=await diagnose();
 if(!ok)process.exitCode=1;
}
