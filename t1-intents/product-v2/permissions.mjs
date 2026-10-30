/** Read-only startup gate. No grants, schema changes or legacy data reads. */
const expectedRole='mf_product_v2_runtime';
const mutable=new Set(['state','pre_sessions','challenges','sessions']);
const tables=new Set([...mutable,'schema_version']);
const check=(condition,code)=>{if(!condition)throw Object.assign(Error(code),{code,status:503});};

export async function verifyProductPermissions(pool){
  const role=(await pool.query(`SELECT current_user AS name,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,rolreplication,rolinherit
    FROM pg_roles WHERE rolname=current_user`)).rows[0];
  check(role?.name===expectedRole&&['rolsuper','rolbypassrls','rolcreaterole','rolcreatedb','rolreplication','rolinherit'].every(k=>role[k]===false),'UNSAFE_PRODUCT_DB_ROLE');
  const memberships=await pool.query(`SELECT rolname FROM pg_roles
    WHERE rolname<>current_user AND pg_has_role(current_user,oid,'MEMBER')`);
  check(memberships.rows.length===0,'PRODUCT_ROLE_MEMBERSHIP_DENIED');
  const schema=(await pool.query(`SELECT nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owned,
    has_schema_privilege(current_user,oid,'USAGE') AS can_use,
    has_schema_privilege(current_user,oid,'CREATE') AS can_create,
    has_database_privilege(current_user,current_database(),'CREATE') AS can_create_schema
    FROM pg_namespace WHERE nspname='mf_product_v2'`)).rows;
  check(schema.length===1&&schema[0].owned===false&&schema[0].can_use===true&&schema[0].can_create===false&&schema[0].can_create_schema===false,'UNSAFE_PRODUCT_SCHEMA_PRIVILEGES');
  const legacy=await pool.query(`SELECT nspname FROM pg_namespace
    WHERE (left(nspname,3)='mf_' AND nspname<>'mf_product_v2' AND has_schema_privilege(current_user,oid,'USAGE'))
      OR (left(nspname,3)<>'pg_' AND nspname<>'information_schema' AND has_schema_privilege(current_user,oid,'CREATE'))`);
  check(legacy.rows.length===0,'PRODUCT_LEGACY_OR_DDL_ACCESS');
  const access=(await pool.query(`SELECT c.relname,c.relkind,c.relrowsecurity,
    c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owned,
    has_table_privilege(current_user,c.oid,'SELECT') AS can_select,
    CASE WHEN c.relname='schema_version' THEN has_any_column_privilege(current_user,c.oid,'INSERT') ELSE has_table_privilege(current_user,c.oid,'INSERT') END AS can_insert,
    CASE WHEN c.relname='schema_version' THEN has_any_column_privilege(current_user,c.oid,'UPDATE') ELSE has_table_privilege(current_user,c.oid,'UPDATE') END AS can_update,
    has_table_privilege(current_user,c.oid,'DELETE') AS can_delete,
    has_table_privilege(current_user,c.oid,'TRUNCATE') AS can_truncate,
    has_any_column_privilege(current_user,c.oid,'REFERENCES') AS can_reference,
    has_table_privilege(current_user,c.oid,'TRIGGER') AS can_trigger
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='mf_product_v2' AND c.relkind IN ('r','p','v','m','f')`)).rows;
  check(access.length===tables.size&&new Set(access.map(r=>r.relname)).size===tables.size,'PRODUCT_TABLE_LAYOUT_REQUIRED');
  for(const table of access){
    check(tables.has(table.relname)&&table.relkind==='r'&&table.relrowsecurity===true&&table.owned===false,'UNSAFE_PRODUCT_TABLE');
    check(table.can_select===true&&table.can_insert===mutable.has(table.relname)&&table.can_update===mutable.has(table.relname)
      &&['can_delete','can_truncate','can_reference','can_trigger'].every(k=>table[k]===false),'UNSAFE_PRODUCT_TABLE_PRIVILEGES');
  }
  // This schema has no SQL RPC/SECURITY DEFINER surface in version 1.
  const routines=await pool.query(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='mf_product_v2' AND has_function_privilege(current_user,p.oid,'EXECUTE')`);
  check(routines.rows.length===0,'PRODUCT_ROUTINES_NOT_REVIEWED');
  const versions=(await pool.query('SELECT version FROM mf_product_v2.schema_version ORDER BY version')).rows;
  check(versions.length===1&&versions[0].version===1,'PRODUCT_SCHEMA_VERSION_REQUIRED');
  const state=(await pool.query('SELECT id FROM mf_product_v2.state WHERE id=1')).rows;
  check(state.length===1&&state[0].id===1,'PRODUCT_STORE_NOT_INITIALIZED');
  return true;
}
