/** Separate bounded recovery capability. Runtime choice is an internal allowlist, never HTTP input. */
import {TypedDataEncoder,keccak256} from 'ethers';
import {PHASE8_DOMAIN,PHASE8_TYPES,PHASE8_FIXED} from './t1f-phase8-protocol.mjs';
import {t0} from './t1e-first-issue-readiness.mjs';
const KINDS=['operator','collector','execution'],GUARDED=Symbol('phase8CapabilityPool');
const runtime=kind=>{if(!KINDS.includes(kind))throw Error('T1F_PHASE8_CAPABILITY_KIND');return 'mf_t1f_phase8_'+kind+'_runtime'};
export function phase8CapabilityPool(raw,kind){const role=runtime(kind);return Object.freeze({[GUARDED]:true,async query(sql,args,{beforeExecute}={}){const c=await raw.connect();let failed=true;try{await c.query(`SET ROLE ${role}; SET statement_timeout='5s'; SET lock_timeout='2s'`);beforeExecute?.();const r=await c.query(sql,args);failed=false;return r}finally{c.release(failed)}},end:()=>raw.end()})}
export function makePhase8Store({pool}={}){
 if(typeof pool?.query!=='function')throw Error('T1F_PHASE8_POOL');
 const call=async(sql,args=[],guard)=>{if(guard!==undefined&&!pool[GUARDED])throw Error('T1F_PHASE8_GUARDED_POOL_REQUIRED');const r=await pool.query(sql,args,{beforeExecute:guard});if(r.rowCount!==1)throw Error('T1F_PHASE8_STORE_RESULT');return r.rows[0].result};
 return Object.freeze({
 context:()=>call('SELECT mf_t1f_phase8.context() result'),
 get:roundId=>call('SELECT mf_t1f_phase8.get_round($1::uuid) result',[roundId]),
 create:({roundId,manifest,createdAt,observedBlockTime,evidence,walletObservation,beforeExecute})=>{
  const digest=TypedDataEncoder.hash(PHASE8_DOMAIN,PHASE8_TYPES,manifest.value),data=t0.encodeFunctionData('issue',[manifest.value.newOpId,PHASE8_FIXED.mealId,0,1,PHASE8_FIXED.termsHash,manifest.value.newDeadline]);
  if(digest!==manifest.digest||keccak256(data)!==manifest.candidateCalldataHash)throw Error('T1F_PHASE8_MANIFEST_HASH');
  return call('SELECT mf_t1f_phase8.create_round($1::uuid,$2::jsonb,$3,$4::bigint,$5::bigint,$6,$7::jsonb,$8::jsonb) result',[roundId,JSON.stringify(manifest.value),digest,createdAt,observedBlockTime,manifest.candidateCalldataHash,JSON.stringify(evidence),JSON.stringify(walletObservation)],beforeExecute);
 },
 record:({roundId,digest,role,wallet,fingerprint,evidence,beforeExecute})=>call('SELECT mf_t1f_phase8.record_approval($1::uuid,$2,$3,$4,$5,$6::jsonb) result',[roundId,digest,role,wallet,fingerprint,JSON.stringify(evidence)],beforeExecute),
 consume:({roundId,digest,evidence,beforeExecute})=>call('SELECT mf_t1f_phase8.consume($1::uuid,$2,$3::jsonb) result',[roundId,digest,JSON.stringify(evidence)],beforeExecute),
 bind:({successorId,revision,txHash,evidence,beforeExecute})=>call('SELECT mf_t1f_phase8.bind($1::uuid,$2::bigint,$3,$4::jsonb) result',[successorId,revision,txHash,JSON.stringify(evidence)],beforeExecute),
 reconcile:({successorId,revision,evidence,beforeExecute})=>call('SELECT mf_t1f_phase8.reconcile($1::uuid,$2::bigint,$3::jsonb) result',[successorId,revision,JSON.stringify(evidence)],beforeExecute)
 });
}
export async function verifyPhase8Runtime(pool,kind){
 const role=runtime(kind),login='mf_t1f_phase8_'+kind+'_login';
 const signatures=['mf_t1f_phase8.context()','mf_t1f_phase8.get_round(uuid)',...(kind==='operator'?['mf_t1f_phase8.create_round(uuid,jsonb,text,bigint,bigint,text,jsonb,jsonb)']:kind==='collector'?['mf_t1f_phase8.record_approval(uuid,text,text,text,text,jsonb)']:['mf_t1f_phase8.consume(uuid,text,jsonb)','mf_t1f_phase8.bind(uuid,bigint,text,jsonb)','mf_t1f_phase8.reconcile(uuid,bigint,jsonb)'])];
 const {rows}=await pool.query(`WITH RECURSIVE members AS (SELECT oid FROM pg_roles WHERE rolname=$1 UNION SELECT m.roleid FROM pg_auth_members m JOIN members x ON x.oid=m.member), principals AS (SELECT oid FROM pg_roles WHERE rolname IN ($1,$2)), reviewed AS (SELECT unnest($3::text[])::regprocedure::oid oid)
 SELECT session_user,current_user,
 (SELECT count(*)=3 AND bool_and(NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolinherit AND rolcanlogin=(rolname=$1)) FROM pg_roles WHERE rolname IN ($1,$2,'mf_t1f_phase8_owner')) role_safe,
 (SELECT count(*)=2 AND bool_and(r.rolname IN ($1,$2)) FROM members m JOIN pg_roles r ON r.oid=m.oid) AND (SELECT count(*)=1 AND bool_and(NOT m.inherit_option AND m.set_option AND NOT m.admin_option) FROM pg_auth_members m WHERE m.member=(SELECT oid FROM pg_roles WHERE rolname=$1) AND m.roleid=(SELECT oid FROM pg_roles WHERE rolname=$2)) membership_safe,
 NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN principals r WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','f') AND (has_schema_privilege(r.oid,n.oid,'USAGE') OR n.nspname LIKE 'mf_%' OR c.relowner=r.oid OR EXISTS(SELECT 1 FROM aclexplode(c.relacl) a WHERE a.grantee=r.oid) OR EXISTS(SELECT 1 FROM pg_attribute col CROSS JOIN LATERAL aclexplode(col.attacl) a WHERE col.attrelid=c.oid AND a.grantee=r.oid)) AND (has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN principals r WHERE c.relkind='S' AND n.nspname NOT LIKE 'pg_%' AND has_sequence_privilege(r.oid,c.oid,'USAGE,SELECT,UPDATE')) tables_safe,
 (SELECT count(*)=cardinality($3::text[]) AND bool_and(p.prosecdef AND p.proowner=(SELECT oid FROM pg_roles WHERE rolname='mf_t1f_phase8_owner') AND p.proconfig @> ARRAY['search_path=pg_catalog','statement_timeout=5s','lock_timeout=2s'] AND has_function_privilege($2,p.oid,'EXECUTE')) FROM pg_proc p WHERE p.oid IN (SELECT oid FROM reviewed)) AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN principals r WHERE n.nspname LIKE 'mf_%' AND has_schema_privilege(r.oid,n.oid,'USAGE') AND has_function_privilege(r.oid,p.oid,'EXECUTE') AND NOT (r.oid=(SELECT oid FROM pg_roles WHERE rolname=$2) AND p.oid IN (SELECT oid FROM reviewed))) functions_safe,
 NOT has_database_privilege($1,current_database(),'CREATE') AND NOT has_database_privilege($2,current_database(),'CREATE') AND NOT EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN principals r WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND (has_schema_privilege(r.oid,n.oid,'CREATE') OR (n.nspname LIKE 'mf_%' AND has_schema_privilege(r.oid,n.oid,'USAGE') AND NOT(n.nspname='mf_t1f_phase8' AND r.oid=(SELECT oid FROM pg_roles WHERE rolname=$2))))) schema_safe`,[login,role,signatures]);
 const r=rows[0];if(rows.length!==1||r.session_user!==login||r.current_user!==role||!['role_safe','membership_safe','tables_safe','functions_safe','schema_safe'].every(k=>r[k]===true))throw Error('T1F_PHASE8_RUNTIME_CAPABILITY');
}
