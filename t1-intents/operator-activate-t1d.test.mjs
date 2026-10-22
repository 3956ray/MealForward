import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 validateT1DAdminDsn,validateT1DRoles,validateT1DGrants,
 makeT1DPrivateEnv,activateT1DRolesFromMac
} from './operator-activate-t1d.mjs';

const ADMIN='postgresql://postgres.ketfrukrcuosrqynnsay:fake-admin-only-test'+
 '@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres';
const ROLE_AUTH={rolname:'mf_t1d_auth_runtime',rolcanlogin:false,
 rolsuper:false,rolbypassrls:false,rolcreaterole:false,rolcreatedb:false};
const ROLE_FUND={...ROLE_AUTH,rolname:'mf_t1d_fund_runtime'};
const GRANTS=Object.freeze({
 auth_select:true,auth_insert:true,auth_update:true,
 fund_select:true,fund_insert:true,
 fund_quote_read:true,fund_quote_insert:true,
 fund_attempt_insert:true,
 old_auth_sees_new:false,new_auth_sees_old:false,
 auth_sees_funds:false,fund_sees_auth:false,
 old_fund_can_write:false,old_fund_can_read_quote:false,
 fund_can_delete:false,fund_can_change_payer:false
});
test('only exact privileged Supabase admin session pooler is accepted',()=>{
 assert.deepEqual(validateT1DAdminDsn(ADMIN),{
  host:'aws-0-ap-southeast-2.pooler.supabase.com',
  project:'ketfrukrcuosrqynnsay'
 });
 for(const wrong of [
  ADMIN.replace('aws-0-','aws-1-'),
  ADMIN.replace(':5432/',':6543/'),
  ADMIN.replace('postgres.ketfrukrcuosrqynnsay','mf_t1d_fund_runtime.ketfrukrcuosrqynnsay'),
  ADMIN.replace('postgres.ketfrukrcuosrqynnsay','postgres.otherproject'),
  ADMIN.replace('pooler.supabase.com','attacker.invalid'),
  ADMIN.replace('postgresql:','http:'),
  ADMIN.replace('/postgres','/cp30'),
  ADMIN+'?sslmode=disable',
  ADMIN+'#fragment',
  ''
 ]){
  assert.throws(()=>validateT1DAdminDsn(wrong),/^Error: T1D_/);
 }
});
test('owner activation only accepts exactly both NOLOGIN least-privilege roles',()=>{
 assert.equal(validateT1DRoles([ROLE_AUTH,ROLE_FUND]),true);
 for(const bad of [
  [],[ROLE_AUTH],[ROLE_AUTH,ROLE_AUTH],
  [ROLE_AUTH,{...ROLE_FUND,rolcanlogin:true}],
  [ROLE_AUTH,{...ROLE_FUND,rolsuper:true}],
  [ROLE_AUTH,{...ROLE_FUND,rolbypassrls:true}],
  [ROLE_AUTH,{...ROLE_FUND,rolcreaterole:true}],
  [ROLE_AUTH,{...ROLE_FUND,rolcreatedb:true}]
 ]){
  assert.throws(()=>validateT1DRoles(bad),/^Error: T1D_/);
 }
});
test('privilege probe refuses any cross-service old T1-C or Auth/Finance privilege drift',()=>{
 assert.equal(validateT1DGrants(GRANTS),true);
 for(const key of Object.keys(GRANTS)){
  assert.throws(()=>validateT1DGrants({
   ...GRANTS,[key]:!GRANTS[key]
  }),/T1D_ISOLATED_ROLE_PRIVILEGES_NOT_VERIFIED/);
 }
});
test('local secrets are random hex only and rendered for ONLY original two role names',()=>{
 const auth='a'.repeat(80),fund='b'.repeat(80);
 const out=makeT1DPrivateEnv(auth,fund);
 const lines=out.trimEnd().split('\n');
 assert.equal(lines.length,2);
 assert.ok(lines[0].startsWith('T1C_AUTH_DB_URL=postgresql://mf_t1d_auth_runtime.ketfrukrcuosrqynnsay:'+auth+'@'));
 assert.ok(lines[1].startsWith('T1C_INTENT_DB_URL=postgresql://mf_t1d_fund_runtime.ketfrukrcuosrqynnsay:'+fund+'@'));
 assert.ok(lines.every(x=>x.endsWith('@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres')));
 assert.ok(!out.includes('mf_t1c_auth_runtime'));
 assert.ok(!out.includes('mf_t1c_intent_runtime'));
 assert.ok(!out.includes('T1D_SUPABASE_ADMIN_DSN'));
 for(const [a,b] of [[auth,auth],['x'.repeat(80),fund],[auth,''],['',fund]]){
  assert.throws(()=>makeT1DPrivateEnv(a,b),/T1D_RANDOM_SECRETS_REQUIRED/);
 }
});
test('the owner activation cannot execute on GitHub, Render or noninteractive worker',async()=>{
 await assert.rejects(()=>activateT1DRolesFromMac(),
  /T1D_MAC_OWNER_TTY_REQUIRED/);
 const source=readFileSync(new URL('./operator-activate-t1d.mjs',import.meta.url),'utf8');
 assert.match(source,/verifiedSupabasePoolerTls/);
 assert.match(source,/randomBytes\(40\)/);
 assert.match(source,/file\.sync\(\)/);
 assert.match(source,/open\(path,'wx',0o600\)/);
 assert.match(source,/T1D_COMMIT_OUTCOME_UNKNOWN_DO_NOT_RETRY/);
 assert.match(source,/T1D_STAGING_NOT_EMPTY_REFUSE_NEW_CREDENTIALS/);
 assert.ok(!source.includes('NODE_TLS_REJECT_UNAUTHORIZED'));
 assert.ok(!source.includes('rejectUnauthorized:false'));
 assert.ok(!source.includes('eth_sendTransaction'));
 assert.ok(!source.includes('privateKeyToAccount'));
});
