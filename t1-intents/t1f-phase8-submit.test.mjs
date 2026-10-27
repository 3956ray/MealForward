/** Service orchestration with a test-only authorization boundary in an isolated child.
 * Synthetic signatures are really recovered. Only their role mapping is mocked;
 * production fixed-signer enforcement is covered by unmocked protocol tests.
 * No network, real key, production signer override, or live database is used.
 */
import test, {mock} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const execute=promisify(execFile);

if(process.argv[2]==='isolated-submit'){
 const mode=process.argv[3];
 const actual=await import('./t1f-phase8-protocol.mjs');
 const {Wallet}=await import('ethers');
 const wallets={owner:Wallet.createRandom(),donor:Wallet.createRandom()};
 let verifications=0;
 mock.module(new URL('./t1f-phase8-protocol.mjs',import.meta.url).href,{namedExports:{...actual,
  verifyRecoveryApproval({manifest,role,signature}){
   assert.ok(Object.hasOwn(wallets,role));
   const recovered=actual.recoverRecoveryApproval({manifest,signature});
   assert.equal(recovered.wallet,wallets[role].address.toLowerCase());
   verifications++;
   return {role,wallet:actual.PHASE8_FIXED[role],fingerprint:recovered.fingerprint};
  }
 }});
 const {setupPhase8,NOW}=await import('./t1f-phase8-service-fixture.mjs');
 const {makePhase8Service}=await import('./t1f-phase8-service.mjs');
 const {phase8Failure}=await import('./t1f-phase8-diagnostics.mjs');
 const f=await setupPhase8();f.envelope.round.approvals=[];
 let reads=0,writes=0;
 const stored=[];
 const store={...f.store,
  async get(id){assert.equal(id,f.row.round_id);reads++;if(mode==='readback'&&writes)throw Object.assign(Error('PRIVATE_DATABASE_MESSAGE'),{code:'08006'});return structuredClone(f.envelope)},
  async record({roundId,digest,role,wallet,fingerprint,evidence,beforeExecute}){
   beforeExecute();
   assert.equal(roundId,f.row.round_id);assert.equal(digest,f.manifest.digest);
   assert.equal(wallet,actual.PHASE8_FIXED[role]);assert.equal(evidence.version,'T1F_PHASE8_OBSERVATION_V1');
   assert.equal(evidence.originalOperationSeen,false);assert.equal(evidence.predecessorOperationSeen,false);
   if(mode==='database')throw Object.assign(Error('PRIVATE_DATABASE_MESSAGE'),{code:'42501'});
   writes++;stored.push({role,fingerprint});
   f.envelope.round.approvals.push({round_id:roundId,digest,role,wallet,fingerprint,verified_at_epoch:NOW,verification_version:'T1F_PHASE8_EIP712_EOA_V1'});
  }
 };
 const rpc=mode==='rpc'?{async send(){throw Error('T1F_EXECUTION_RPC_TIMEOUT')}}:f.rpc;
 const service=makePhase8Service({store,rpc,clock:()=>NOW});
 const body=async role=>({...f.body(),role,signature:await wallets[role].signTypedData(f.manifest.domain,f.manifest.types,f.manifest.value)});
 if(mode==='success'){
  const owner=await service.submit(await body('owner'));
  assert.deepEqual(owner.round.roles,{owner:true,donor:false});assert.equal(owner.status,'AWAIT_APPROVALS');
  const donor=await service.submit(await body('donor'));
  assert.deepEqual(donor.round.roles,{owner:true,donor:true});assert.equal(donor.status,'READY_TO_PREPARE');
  assert.equal(writes,2);assert.equal(reads,6);assert.equal(verifications,2);
  assert.equal(new Set(stored.map(x=>x.fingerprint)).size,2);
  assert.ok(f.calls.length>0);assert.equal(donor.operation,null);assert.equal(donor.transaction,undefined);
  assert.deepEqual((await service.status()).round.roles,{owner:true,donor:true});
 }else{
  const request=await body('owner');let caught;
  try{await service.submit(request)}catch(e){caught=e}
  assert.ok(caught);
  const expected=mode==='rpc'?{status:503,error:'T1F_PHASE8_RPC_TIMEOUT',stage:'observe_chain'}:mode==='database'?{status:503,error:'T1F_PHASE8_DATABASE_PERMISSION',stage:'record_approval'}:{status:503,error:'T1F_PHASE8_DATABASE_CONNECTION',stage:'readback'};
  const safe=phase8Failure(caught);assert.deepEqual(safe,expected);
  assert.equal(JSON.stringify(safe).includes(request.signature),false);
  assert.doesNotMatch(JSON.stringify(safe),/PRIVATE_DATABASE_MESSAGE|fingerprint|stack/);
  assert.equal(writes,mode==='readback'?1:0);assert.equal(verifications,1);
  assert.equal(f.envelope.round.approvals.length,mode==='readback'?1:0);
  // A lost readback does not pretend the durable record failed or send anything.
  assert.equal(f.envelope.operation,null);
  if(mode==='readback')assert.deepEqual((await service.status()).round.roles,{owner:true,donor:false});
 }
 assert.equal(f.counts.consume,0);assert.equal(f.counts.bind,0);assert.equal(f.counts.reconcile,0);
 mock.restoreAll();console.log('ISOLATED_SUBMIT_PASS');
}else{
 for(const [mode,label] of [['success','both synthetic approvals traverse real service observation, record and readback'],['rpc','RPC failure is classified at observe_chain without recording'],['database','PG permission failure is classified at record_approval without recording'],['readback','readback failure preserves recorded approval and identifies the failed stage']]){
  test(`isolated submit: ${label}`,async()=>{
   const {stdout}=await execute(process.execPath,['--experimental-test-module-mocks',fileURLToPath(import.meta.url),'isolated-submit',mode],{timeout:30000,maxBuffer:1024*1024});
   assert.match(stdout,/ISOLATED_SUBMIT_PASS/);
  });
 }
}
