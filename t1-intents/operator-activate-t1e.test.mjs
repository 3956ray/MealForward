import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 validateOwnerDSN,checkRoles,checkIsolation,formatSecretFile
} from './operator-activate-t1e.mjs';
const host='aws-0-ap-southeast-2.pooler.supabase.com';
const project='ketfrukrcuosrqynnsay';
const admin='postgresql://postgres.'+project+':example-ci-password-not-live@'+host+':5432/postgres';
test('only exact separate staging PG17 session-pooler admin identity allowed',()=>{
 assert.equal(validateOwnerDSN(admin),true);
 for(const bad of [
  admin.replace('postgres.'+project,'mf_t1d_auth_runtime.'+project),
  admin.replace(host,'some-other-host.example'),
  admin.replace(':5432',':6543'),
  admin.replace('/postgres','/old_db'),
  admin.replace('postgresql://','https://'),
  admin+'?sslmode=disable'
 ])assert.throws(()=>validateOwnerDSN(bad),/T1E_ADMIN_/);
});
const roles=[
 {rolname:'mf_t1e_auth_runtime',rolcanlogin:false,rolsuper:false,rolbypassrls:false,rolcreaterole:false,rolcreatedb:false},
 {rolname:'mf_t1e_claim_runtime',rolcanlogin:false,rolsuper:false,rolbypassrls:false,rolcreaterole:false,rolcreatedb:false}
];
test('both private T1-E roles begin NOLOGIN, and no privilege grants leak',()=>{
 assert.equal(checkRoles(roles),true);
 assert.throws(()=>checkRoles([{...roles[0],rolcanlogin:true},roles[1]]),/T1E_ROLES_MUST_BE_NOLOGIN/);
 assert.throws(()=>checkRoles([roles[0],roles[0]]),/T1E_/);
 assert.throws(()=>checkRoles([{...roles[0],rolsuper:true},roles[1]]),/T1E_/);
 const grants={
  auth_can_read:true,auth_can_insert:true,claim_can_read:true,claim_can_insert:true,
  claim_can_stage:true,old_auth_sees_new:false,old_fund_sees_new:false,
  auth_sees_claims:false,claim_sees_auth:false,
  auth_sees_finance:false,claim_sees_finance:false,
  round_can_read:true,round_can_insert:true,
  round_can_update_state:true,round_can_rewrite_nonce:false,
  claim_can_reassign_recipient:false,claim_can_delete:false
 };
 assert.equal(checkIsolation(grants),true);
 for(const key of Object.keys(grants)){
  const fail={...grants,[key]:!grants[key]};
  assert.throws(()=>checkIsolation(fail),/T1E_ROLE_GRANTS_NOT_ISOLATED/);
 }
});
test('two random-only DSNs map to independent T1-E roles and are never printed',()=>{
 const a='a'.repeat(80),b='b'.repeat(80);
 const out=formatSecretFile(a,b);
 assert.equal(out.split('\n').filter(Boolean).length,2);
 assert.match(out,/T1E_AUTH_DB_URL=postgresql:\/\/mf_t1e_auth_runtime\./);
 assert.match(out,/T1E_CLAIM_DB_URL=postgresql:\/\/mf_t1e_claim_runtime\./);
 assert.ok(out.includes(a)&&out.includes(b));
 assert.ok(!out.includes('mf_t1d_auth_runtime'));
 assert.throws(()=>formatSecretFile(a,a),/T1E_/);
 assert.throws(()=>formatSecretFile('short',b),/T1E_/);
 const code=readFileSync(new URL('./operator-activate-t1e.mjs',import.meta.url),'utf8');
 for(const snippet of [
  "process.platform==='darwin'",
  'commitAttempted=true','ALTER ROLE',
  "fh.sync()",'0o600','ACTIVATE T1E TWO ROLES',
  'T1E_SUPABASE_ADMIN_DSN',
  'COMMIT attempted: do NOT retry'
 ])assert.ok(code.includes(snippet),snippet);
});
