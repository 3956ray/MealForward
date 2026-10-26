/** Dedicated SQL capability adapter. Capability pool must select runtime before beforeExecute. */
import {validateExecutionEvidence} from './t1f-execution-contract.mjs';
const CAPABILITY_POOL=Symbol('executionCapabilityPool');
export function makeExecutionStore({pool}={}){
 if(typeof pool?.query!=='function')throw Error('T1F_EXECUTION_POOL_REQUIRED');
 const call=async(sql,args=[],beforeExecute)=>{
  if(beforeExecute!==undefined&&pool[CAPABILITY_POOL]!==true)throw Error('T1F_EXECUTION_GUARDED_POOL_REQUIRED');
  const r=await (beforeExecute===undefined?pool.query(sql,args):pool.query(sql,args,{beforeExecute}));
  if(r.rowCount!==1)throw Error('T1F_EXECUTION_STORE_RESULT_INVALID');
  return r.rows[0].result;
 };
 return Object.freeze({
  context:()=>call('SELECT mf_t1f_execution.execution_context() AS result'),
  get:roundId=>call('SELECT mf_t1f_execution.execution_round($1::uuid) AS result',[roundId]),
  consume:({roundId,digest,evidence,beforeExecute})=>call('SELECT mf_t1f_execution.consume_round_and_reserve($1::uuid,$2,$3::jsonb) AS result',[roundId,digest,JSON.stringify(evidence==null?null:validateExecutionEvidence(evidence,'observation'))],beforeExecute),
  bind:({successorId,revision,txHash,evidence,beforeExecute})=>call('SELECT mf_t1f_execution.bind_successor($1::uuid,$2::bigint,$3,$4::jsonb) AS result',[successorId,revision,txHash,JSON.stringify(validateExecutionEvidence(evidence,'bind'))],beforeExecute),
  reconcile:({successorId,revision,evidence,beforeExecute})=>call('SELECT mf_t1f_execution.reconcile_successor($1::uuid,$2::bigint,$3::jsonb) AS result',[successorId,revision,JSON.stringify(validateExecutionEvidence(evidence,'reconcile'))],beforeExecute)
 });
}

export async function verifyExecutionRuntime(pool){
 const {rows}=await pool.query(`WITH RECURSIVE memberships AS (
  SELECT oid FROM pg_roles WHERE rolname='mf_t1f_execution_login'
  UNION SELECT m.roleid FROM pg_auth_members m JOIN memberships x ON m.member=x.oid
 ), principals AS (SELECT oid FROM pg_roles WHERE rolname IN ('mf_t1f_execution_login','mf_t1f_execution_runtime'))
 SELECT session_user,current_user,
 (SELECT count(*)=3 AND bool_and(NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolinherit AND rolcanlogin=(rolname='mf_t1f_execution_login')) FROM pg_roles WHERE rolname IN ('mf_t1f_execution_login','mf_t1f_execution_runtime','mf_t1f_execution_owner')) AS role_safe,
 (SELECT count(*)=2 AND bool_and(r.rolname IN ('mf_t1f_execution_login','mf_t1f_execution_runtime')) FROM memberships m JOIN pg_roles r ON r.oid=m.oid) AS membership_safe,
 NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN principals r WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','f')
 AND (has_schema_privilege(r.oid,n.oid,'USAGE') OR n.nspname LIKE 'mf_%' OR c.relowner=r.oid
  OR EXISTS(SELECT 1 FROM aclexplode(c.relacl) acl WHERE acl.grantee=r.oid)
  OR EXISTS(SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) acl WHERE a.attrelid=c.oid AND acl.grantee=r.oid))
 AND (has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN principals r WHERE c.relkind='S' AND n.nspname NOT LIKE 'pg_%' AND has_sequence_privilege(r.oid,c.oid,'USAGE,SELECT,UPDATE')) AS tables_safe,
 ((SELECT count(*)=5 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='mf_t1f_execution' AND has_function_privilege('mf_t1f_execution_runtime',p.oid,'EXECUTE') AND p.proname IN ('execution_context','execution_round','consume_round_and_reserve','bind_successor','reconcile_successor') AND p.prosecdef AND p.proowner=(SELECT oid FROM pg_roles WHERE rolname='mf_t1f_execution_owner') AND p.proconfig @> ARRAY['search_path=pg_catalog','statement_timeout=5s','lock_timeout=2s'])
 AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN principals r WHERE n.nspname LIKE 'mf_%' AND has_schema_privilege(r.oid,n.oid,'USAGE') AND has_function_privilege(r.oid,p.oid,'EXECUTE') AND NOT (r.oid=(SELECT oid FROM pg_roles WHERE rolname='mf_t1f_execution_runtime') AND n.nspname='mf_t1f_execution' AND p.proname IN ('execution_context','execution_round','consume_round_and_reserve','bind_successor','reconcile_successor')))) AS functions_safe,
 NOT EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN principals r WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND (has_schema_privilege(r.oid,n.oid,'CREATE') OR (n.nspname LIKE 'mf_%' AND has_schema_privilege(r.oid,n.oid,'USAGE') AND NOT (n.nspname='mf_t1f_execution' AND r.oid=(SELECT oid FROM pg_roles WHERE rolname='mf_t1f_execution_runtime'))))) AS schema_safe`);
 const r=rows[0];if(!(rows.length===1&&r?.session_user==='mf_t1f_execution_login'&&r.current_user==='mf_t1f_execution_runtime'&&['role_safe','membership_safe','tables_safe','functions_safe','schema_safe'].every(k=>r[k]===true)))throw Error('T1F_EXECUTION_RUNTIME_CAPABILITY');
}
/** Session poolers may ignore startup options. Await least-privilege selection
 * on the acquired connection before each application query; never use an async
 * Pool connect-event listener whose completion is not awaited by borrowers.
 */
export function executionCapabilityPool(raw){
 return Object.freeze({
  [CAPABILITY_POOL]:true,
  async query(sql,args,{beforeExecute}={}){
   const client=await raw.connect();let failed=true;
   try{
    await client.query("SET ROLE mf_t1f_execution_runtime; SET statement_timeout='5s'; SET lock_timeout='2s'");
    // Synchronous guard runs after every awaited acquisition/setup step.
    beforeExecute?.();
    const result=await client.query(sql,args);failed=false;return result;
   }finally{client.release(failed)}
  },
  end:()=>raw.end()
 });
}
