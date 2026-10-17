import test from 'node:test';
import assert from 'node:assert/strict';
import {probeAuthStorage} from './db.mjs';

function connection({failAt=null,wrongRead=false}={}){
  const events=[];
  const client={
    async query(sql,values){
      let stage=sql==='BEGIN'?'begin':sql==='ROLLBACK'?'rollback':
        sql.startsWith('INSERT INTO mf_cp31_auth_pilot.pre_sessions')?'pre_insert':
        sql.startsWith('SELECT pre_hash FROM mf_cp31_auth_pilot.pre_sessions')?'challenge_parent_lock':
        sql.startsWith('SELECT count(*)::int AS n FROM mf_cp31_auth_pilot.challenges')?'challenge_count':
        sql.startsWith('INSERT INTO mf_cp31_auth_pilot.challenges')?'challenge_insert':
        sql.startsWith('SELECT x.payload FROM mf_cp31_auth_pilot.challenges')?'challenge_read':'unexpected';
      events.push(stage);
      if(stage==='unexpected')throw Error('Unexpected SQL');
      if(stage===failAt)throw Object.assign(Error('secret sample from database'),{code:'42501'});
      if(stage==='challenge_parent_lock')return {rowCount:1};
      if(stage==='challenge_count')return {rows:[{n:0}]};
      if(stage==='challenge_insert')return {rowCount:1};
      if(stage==='challenge_read')return {rows:wrongRead?[]:[{payload:{challengeId:values[0]}}]};
      return {rowCount:1};
    },
    release(){events.push('release')}
  };
  return {events,pool:{connect:async()=>client}};
}
function build(args){return {...args,address:args.wallet,domain:'site.onrender.com',uri:args.origin,message:'unpersisted probe message'}}

test('auth database probe rolls back all synthetic records after successful SQL checks',async()=>{
  const x=connection();
  assert.equal(await probeAuthStorage(x.pool,build,'https://site.onrender.com'),true);
  assert.deepEqual(x.events,['begin','pre_insert','challenge_parent_lock','challenge_count','challenge_insert','challenge_read','rollback','release']);
});
test('auth database probe rolls back and surfaces only safe stage / SQLSTATE on failure',async()=>{
  const x=connection({failAt:'challenge_insert'});
  await assert.rejects(()=>probeAuthStorage(x.pool,build,'https://site.onrender.com'),e=>{
    assert.equal(e.message,'AUTH_SQL_PROBE_FAILED');
    assert.equal(e.stage,'challenge_insert');
    assert.equal(e.sqlstate,'42501');
    assert.ok(!JSON.stringify(e).includes('secret sample'));
    return true;
  });
  assert.deepEqual(x.events,['begin','pre_insert','challenge_parent_lock','challenge_count','challenge_insert','rollback','release']);
});
test('auth database probe detects unreadable original challenge without committing',async()=>{
  const x=connection({wrongRead:true});
  await assert.rejects(()=>probeAuthStorage(x.pool,build,'https://site.onrender.com'),e=>{
    assert.equal(e.stage,'challenge_read'); assert.equal(e.sqlstate,'NONE');return true;
  });
  assert.deepEqual(x.events,['begin','pre_insert','challenge_parent_lock','challenge_count','challenge_insert','challenge_read','rollback','release']);
});
