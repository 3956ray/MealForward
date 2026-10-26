import test from 'node:test';
import assert from 'node:assert/strict';
import {Wallet} from 'ethers';
import {fixture,NOW,HEX,ROUND} from './t1f-approval-test-fixture.mjs';
import {makeApprovalService,validateObservation,boundedApprovalRpc,makeApprovalPublicRpc} from './t1f-approval-service.mjs';
const memory=()=>{const f=fixture();let writes=0;return {...f,get writes(){return writes},store:{context:async()=>f.context,current:async()=>f.row,get:async()=>f.row,record:async()=>{writes++;return f.row},create:async()=>{writes++;return f.row}}}};
test('status is durable, redacted, never creates, and frozen context changes fail closed',async()=>{
 const f=memory(),service=makeApprovalService({store:f.store,rpc:{send(){throw Error('no network on status')}},clock:()=>NOW});
 assert.equal((await service.status()).round.digest,f.row.digest);
 assert.equal((await makeApprovalService({store:f.store,clock:()=>NOW+300}).status()).status,'EXPIRED');
 assert.equal(f.writes,0);
 assert.doesNotMatch(JSON.stringify(await service.status()),/PRIVATE|consent|fingerprint/);
 f.context.claim.stage='ISSUED';await assert.rejects(()=>service.status());assert.equal(f.writes,0);
});
test('wrong/changed/cross-round/malformed synthetic signature cannot write',async()=>{
 const f=memory(),w=Wallet.createRandom(),signature=await w.signTypedData(f.manifest.domain,f.manifest.types,f.manifest.value);
 const service=makeApprovalService({store:f.store,rpc:{send(){throw Error('no valid pinned signer')}},clock:()=>NOW});
 const body={role:'owner',roundId:ROUND,digest:f.row.digest,signature};
 for(const value of [body,{...body,role:'donor'},{...body,digest:HEX('9')},{...body,roundId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'},{...body,signature:'0x12'},{...body,expectedSigner:w.address}])await assert.rejects(()=>service.submit(value));
 assert.equal(f.writes,0);
});
test('freshness and historical canonical checks are separate; later current block is allowed',()=>{
 const {chain,row}=fixture();
 const historical={number:'0x'+BigInt(row.value.observedBlockNumber).toString(16),hash:row.value.observedBlockHash,timestamp:'0x'+(NOW-10).toString(16)};
 assert.doesNotThrow(()=>validateObservation({chain:{...chain,observedBlockNumber:String(BigInt(chain.observedBlockNumber)+10n)},row,historical,now:NOW}));
 for(const change of [{observedBlockTime:NOW-121},{observedBlockTime:NOW+1},{issuerPendingNonce:'1'},{originalOperationSeen:true},{unitAvailable:false},{unitIssued:true},{observedBlockNumber:'1'}])assert.throws(()=>validateObservation({chain:{...chain,...change},row,historical,now:NOW}));
 assert.throws(()=>validateObservation({chain,row,historical:{...historical,hash:HEX('8')},now:NOW}));
 assert.throws(()=>validateObservation({chain,row,historical:{...historical,timestamp:'0x1'},now:NOW}));
});
test('total RPC deadline terminates work; delayed RPC cannot continue to a database write',async()=>{
 const f=memory();let calls=0;
 const rpc={send:async()=>{calls++;await new Promise(r=>setTimeout(r,40));return '0x279f'}};
 const service=makeApprovalService({store:f.store,rpc,clock:()=>NOW,rpcBudgetMs:10});
 await assert.rejects(()=>service.createRound({walletObservation:{value:'OWNER_REPORTED_NO_TRANSACTIONS_VISIBLE',observedAt:NOW}}),/TIMEOUT/);
 await new Promise(r=>setTimeout(r,60));assert.equal(f.writes,0);assert.equal(calls,1);
});
test('operator observation required and global single-pilot work cannot overlap',async()=>{
 const f=memory();let finish;f.store.current=()=>new Promise(r=>finish=r);
 const service=makeApprovalService({store:f.store,clock:()=>NOW});
 const pending=service.status();await assert.rejects(()=>service.status(),/BUSY/);finish(f.row);await pending;
 for(const observedAt of [NOW-121,NOW+1])await assert.rejects(()=>service.createRound({walletObservation:{value:'OWNER_REPORTED_NO_TRANSACTIONS_VISIBLE',observedAt}}));
 assert.equal(f.writes,0);
});
test('RPC wrapper refuses write methods and public transport caps response size',async()=>{
 const bounded=boundedApprovalRpc({rpc:{send:async()=>true},budgetMs:100});
 try{await assert.rejects(()=>bounded.rpc.send('eth_sendTransaction',[]),/RPC_METHOD/);}finally{bounded.close()}
 const rpc=makeApprovalPublicRpc({fetchImpl:async()=>new Response('x'.repeat(1048577),{headers:{'content-type':'application/json'}})});
 await assert.rejects(()=>rpc.send('eth_chainId',[]),/RPC_SIZE/);
});
test('full operator creation uses both real probes at ONE canonical block and commits before exposure',async()=>{
 const {approvalRpcFixture}=await import('./t1f-approval-test-fixture.mjs');const fake=await approvalRpcFixture(),f=memory();let proposal;
 f.store.create=async p=>{proposal=p;return {round_id:p.roundId,value:p.manifest.value,digest:p.manifest.digest,created_at_epoch:p.createdAt,observed_block_time:p.observedBlockTime,candidate_calldata_hash:p.manifest.candidateCalldataHash,approvals:[]}};
 const service=makeApprovalService({store:f.store,rpc:fake.rpc,clock:()=>NOW});
 const dto=await service.createRound({walletObservation:{value:'OWNER_REPORTED_NO_TRANSACTIONS_VISIBLE',observedAt:NOW}});
 assert.equal(dto.round.id,proposal.roundId);assert.equal(dto.round.digest,proposal.manifest.digest);assert.equal(dto.status,'COLLECTING');
 assert.equal(fake.calls.filter(([m])=>m==='eth_blockNumber').length,1,'all probes use one pinned head');
 assert.equal(new Set(fake.calls.filter(([m])=>m==='eth_call').map(([,p])=>p[1])).size,1);
 assert.ok(fake.calls.filter(([m])=>m==='eth_getTransactionCount').every(([,p])=>p[1]==='pending'||p[1]==='0x'+(73688845).toString(16)));
 assert.equal(proposal.manifest.value.approvalExpiresAt,String(NOW+300));
 assert.equal(proposal.manifest.value.newDeadline,String(NOW+480));
});
test('full observation stale block, changed pending nonce and reorg fail before create',async()=>{
 const {approvalRpcFixture}=await import('./t1f-approval-test-fixture.mjs');
 for(const opts of [{pending:1},{blockTime:NOW-121},{reorg:true}]){
  const fake=await approvalRpcFixture(opts),f=memory();
  await assert.rejects(()=>makeApprovalService({store:f.store,rpc:fake.rpc,clock:()=>NOW}).createRound({walletObservation:{value:'OWNER_REPORTED_NO_TRANSACTIONS_VISIBLE',observedAt:NOW}}));assert.equal(f.writes,0);
 }
});
test('aborted request cannot submit or start late writes',async()=>{
 const f=memory(),abort=new AbortController();abort.abort();
 await assert.rejects(()=>makeApprovalService({store:f.store,clock:()=>NOW}).submit({},{signal:abort.signal}),/REQUEST_ABORTED/);assert.equal(f.writes,0);
});
test('bounded read cancelled while in flight rejects its delayed continuation',async()=>{
 const abort=new AbortController();let release;const pending=new Promise(r=>release=r);
 const bounded=boundedApprovalRpc({rpc:{send:async()=>pending},budgetMs:100,signal:abort.signal});
 try{const work=bounded.rpc.send('eth_chainId',[]);await new Promise(r=>setTimeout(r,0));abort.abort();release('0x279f');await assert.rejects(()=>work,/TIMEOUT/)}finally{bounded.close()}
});
