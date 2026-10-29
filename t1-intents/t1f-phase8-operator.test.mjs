import test from 'node:test';import assert from 'node:assert/strict';
test('operator configuration rejects cloud cross-role, expired report, permissions and unrecognized keys',async()=>{
 const {validatePhase8OperatorConfig}=await import('./t1f-phase8-operator.mjs');
 const now=1793081000,config={operatorDatabaseUrl:'postgres://mf_t1f_phase8_operator_login.ketfrukrcuosrqynnsay:synthetic-password@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres'};
 assert.ok(validatePhase8OperatorConfig(config,{mode:0o100600,observedAt:now,now}));
 for(const opts of [{mode:0o100644,observedAt:now,now},{mode:0o100600,observedAt:now-121,now},{mode:0o100600,observedAt:now+1,now}])assert.throws(()=>validatePhase8OperatorConfig(config,opts));
 for(const cfg of [{...config,extra:true},{operatorDatabaseUrl:config.operatorDatabaseUrl.replace('operator_login','execution_login')},{operatorDatabaseUrl:config.operatorDatabaseUrl+'?sslmode=disable'}])assert.throws(()=>validatePhase8OperatorConfig(cfg,{mode:0o100600,observedAt:now,now}));
});
