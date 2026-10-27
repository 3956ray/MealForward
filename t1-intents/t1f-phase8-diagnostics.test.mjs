import test from 'node:test';import assert from 'node:assert/strict';
import {phase8Failure,phase8Step} from './t1f-phase8-diagnostics.mjs';
test('operational errors retain safe class and stage, never raw credentials or signature',async()=>{
 for(const [e,code] of [[Error('T1F_EXECUTION_RPC_HTTP'),'RPC_HTTP'],[Error('T1F_EXECUTION_RPC_TIMEOUT'),'RPC_TIMEOUT'],[Object.assign(Error('secret DSN signature'),{code:'42501'}),'DATABASE_PERMISSION'],[Error('secret DSN signature'),'UNAVAILABLE']]){
  try{await phase8Step('record_approval',()=>{throw e})}catch(caught){assert.deepEqual(phase8Failure(caught),{status:503,error:'T1F_PHASE8_'+code,stage:'record_approval'});assert.ok(!JSON.stringify(phase8Failure(caught)).includes('secret'))}
 }
 assert.deepEqual(phase8Failure(Object.assign(Error('T1F_PHASE8_SIGNER'),{phase8Stage:'signature secret'})),{status:409,error:'T1F_PHASE8_SIGNER',stage:'request'});
});
test('actual browser request preserves safe failure stage and discards raw response text',async()=>{
 const {readFile}=await import('node:fs/promises');const source=await readFile(new URL('./public/t1f-phase8-page.mjs',import.meta.url),'utf8');
 const code=source.slice(source.indexOf('const request='),source.indexOf('const proxy='));
 for(const [body,expected] of [[{error:'T1F_PHASE8_RPC_TIMEOUT',stage:'observe_chain'},'PHASE8_RPC_TIMEOUT_AT_OBSERVE_CHAIN'],[{error:'postgres://secret',stage:'signature secret'},'PHASE8_HTTP_503']]){
  const request=new Function('fetch',code+';return request;')(async()=>({ok:false,status:503,json:async()=>body}));
  await assert.rejects(request('/v1/t1f/phase8/approval','POST',{}),e=>e.message===expected);
 }
});
