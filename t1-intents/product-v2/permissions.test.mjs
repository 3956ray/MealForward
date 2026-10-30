import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyProductPermissions} from './permissions.mjs';
function fixture(){
  const result={
    role:[{name:'mf_product_v2_runtime',rolsuper:false,rolbypassrls:false,rolcreaterole:false,rolcreatedb:false,rolreplication:false,rolinherit:false}],
    members:[],schema:[{owned:false,can_use:true,can_create:false,can_create_schema:false}],legacy:[],routines:[],
    access:['state','pre_sessions','challenges','sessions','schema_version'].map(relname=>({relname,relkind:'r',relrowsecurity:true,owned:false,
      can_select:true,can_insert:relname!=='schema_version',can_update:relname!=='schema_version',can_delete:false,can_truncate:false,can_reference:false,can_trigger:false})),
    versions:[{version:1}],state:[{id:1}],
  },queries=[];
  const pool={async query(sql){queries.push(sql);assert.match(sql.trim(),/^SELECT\b/);assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|GRANT|REVOKE|CREATE)\s+(?:TABLE|SCHEMA|ROLE|ON|INTO|mf_)/i);
    const key=sql.includes('rolsuper')?'role':sql.includes("'MEMBER'")?'members':sql.includes('can_create_schema')?'schema':sql.includes("left(nspname,3)='mf_'")?'legacy':sql.includes('can_select')?'access':sql.includes('pg_proc')?'routines':sql.includes('schema_version ORDER BY')?'versions':sql.includes('SELECT id')?'state':null;
    assert.ok(key,sql);return {rows:structuredClone(result[key])};}};
  return {result,pool,queries};
}
test('exact least privilege product role passes only read-only checks',async()=>{
  const f=fixture();assert.equal(await verifyProductPermissions(f.pool),true);assert.equal(f.queries.length,8);
});
test('same name never substitutes for safe role flags',async()=>{
  for(const key of ['rolsuper','rolbypassrls','rolcreaterole','rolcreatedb','rolreplication','rolinherit']){
    const f=fixture();f.result.role[0][key]=true;await assert.rejects(verifyProductPermissions(f.pool),/UNSAFE_PRODUCT_DB_ROLE/);
  }
  const f=fixture();f.result.role[0].name='postgres';await assert.rejects(verifyProductPermissions(f.pool),/UNSAFE_PRODUCT_DB_ROLE/);
});
test('role escalation, legacy schema and schema creation privileges fail closed',async()=>{
  const member=fixture();member.result.members=[{rolname:'other_privileged_role'}];await assert.rejects(verifyProductPermissions(member.pool),/PRODUCT_ROLE_MEMBERSHIP_DENIED/);
  for(const key of ['owned','can_create','can_create_schema']){const f=fixture();f.result.schema[0][key]=true;await assert.rejects(verifyProductPermissions(f.pool),/UNSAFE_PRODUCT_SCHEMA_PRIVILEGES/);}
  const old=fixture();old.result.legacy=[{nspname:'mf_mvp_usdc'}];await assert.rejects(verifyProductPermissions(old.pool),/PRODUCT_LEGACY_OR_DDL_ACCESS/);
});
test('table owner, disabled RLS, destructive grants and schema-version writes denied',async()=>{
  for(const [field,value] of [['owned',true],['relrowsecurity',false],['relkind','v']]){const f=fixture();f.result.access[0][field]=value;await assert.rejects(verifyProductPermissions(f.pool),/UNSAFE_PRODUCT_TABLE/);}
  for(const field of ['can_delete','can_truncate','can_reference','can_trigger']){const f=fixture();f.result.access[0][field]=true;await assert.rejects(verifyProductPermissions(f.pool),/UNSAFE_PRODUCT_TABLE_PRIVILEGES/);}
  const f=fixture();f.result.access.at(-1).can_update=true;await assert.rejects(verifyProductPermissions(f.pool),/UNSAFE_PRODUCT_TABLE_PRIVILEGES/);
});
test('missing or added relations, callable routines and unexpected schema versions denied',async()=>{
  const a=fixture();a.result.access.pop();await assert.rejects(verifyProductPermissions(a.pool),/PRODUCT_TABLE_LAYOUT_REQUIRED/);
  const b=fixture();b.result.access[0].relname='unexpected';await assert.rejects(verifyProductPermissions(b.pool),/UNSAFE_PRODUCT_TABLE/);
  const c=fixture();c.result.routines=[{proname:'unreviewed_definer'}];await assert.rejects(verifyProductPermissions(c.pool),/PRODUCT_ROUTINES_NOT_REVIEWED/);
  const d=fixture();d.result.versions=[{version:2}];await assert.rejects(verifyProductPermissions(d.pool),/PRODUCT_SCHEMA_VERSION_REQUIRED/);
  const e=fixture();e.result.state=[];await assert.rejects(verifyProductPermissions(e.pool),/PRODUCT_STORE_NOT_INITIALIZED/);
});
