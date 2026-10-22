import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateAdminConnection,activateFromTerminal} from './operator-activate-readonly.mjs';

const DSN='postgresql://postgres.ketfrukrcuosrqynnsay:dummy-test-password@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres';
test('owner role activation pin accepts ONLY Supabase project original admin session pooler',()=>{
 const value=validateAdminConnection(DSN);
 assert.equal(value.host,'aws-0-ap-southeast-2.pooler.supabase.com');
 assert.equal(value.project,'ketfrukrcuosrqynnsay');
 assert.throws(()=>validateAdminConnection(
  DSN.replace('dummy-test-password','[YOUR-PASSWORD]')
 ),/T1C_REPLACE_PASSWORD_PLACEHOLDER/);
 assert.equal(value.origin,'https://mealforward-t1c-readonly-laodao.onrender.com');
 for(const wrong of [
  DSN.replace('aws-0','aws-1'),
  DSN.replace(':5432/',':6543/'),
  DSN.replace('postgres.ketfrukrcuosrqynnsay','postgres.qygnwgovbwltffsytnje'),
  DSN.replace('postgres.ketfrukrcuosrqynnsay','mf_t1c_auth_runtime.ketfrukrcuosrqynnsay'),
  DSN.replace('/postgres','/mf_old_cp30'),
  DSN+'?sslmode=disable'
 ]){
  assert.throws(()=>validateAdminConnection(wrong),/^.*T1C_/);
 }
});
test('credential activation is disabled in GitHub Actions, Render, non-interactive host',async()=>{
 await assert.rejects(()=>activateFromTerminal(),
  /T1C_ONLY_INTERACTIVE_OWNER_TERMINAL/);
 const script=readFileSync(new URL('./operator-activate-readonly.mjs',import.meta.url),'utf8');
 assert.match(script,/randomBytes\(40\)/);
 assert.match(script,/T1C_CROSS_SCHEMA_ISOLATION_NOT_PROVEN/);
 assert.match(script,/process\.stdin\.isTTY&&process\.stdout\.isTTY/);
 assert.ok(!script.includes('localStorage'));
 assert.ok(!script.includes('eth_sendTransaction'));
 assert.ok(!script.includes('privateKeyToAccount'));
});
