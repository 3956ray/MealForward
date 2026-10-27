import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRecoveryManifest,recoveryTypedData,PHASE8_FIXED as F} from './t1f-phase8-protocol.mjs';
import {phase8Public} from './t1f-phase8-service.mjs';
import {fixture,NOW,ROUND} from './t1f-phase8-client-fixture.mjs';
test('browser validates exact V2 predecessor, typed data and digest before adapting execution DTO',async()=>{
 const crypto=await import('./public/t1f-phase8-crypto.mjs');const {envelope}=fixture(),dto=phase8Public(envelope,NOW);
 const v=crypto.validatePhase8(dto,NOW);assert.equal(v.round.digest,dto.round.digest);
 for(const mutate of [s=>s.predecessor.id=ROUND,s=>s.round.typedData.domain.version='1',s=>s.round.typedData.message.newNonce='1',s=>s.round.digest='0x'+'9'.repeat(64),s=>s.round.typedData.message.predecessorDataHash='0x'+'8'.repeat(64),s=>s.serverMayBroadcast=true,s=>s.extra=true]){const bad=structuredClone(dto);mutate(bad);assert.throws(()=>crypto.validatePhase8(bad,NOW));}
 assert.equal(crypto.hashTypedData(dto.round.typedData),dto.round.digest);assert.deepEqual(dto.round.typedData,recoveryTypedData(fixture().manifest));
});
test('role inspection and refresh never sign or send; wrong chain and expiry block approvals',async()=>{
 const crypto=await import('./public/t1f-phase8-crypto.mjs');const {createPhase8Controller}=await import('./public/t1f-phase8-controller.mjs');const {envelope}=fixture();let now=NOW,chain='0x279f',account=F.owner;const calls=[];
 const provider={on(){},async request(q){calls.push(q.method);if(q.method==='eth_accounts')return [account];if(q.method==='eth_chainId')return chain;throw Error('UNEXPECTED_WALLET_ACTION')}};
 const c=createPhase8Controller({provider,crypto,clock:()=>now,origin:'http://127.0.0.1:15449',request:async()=>phase8Public(envelope,now)});
 await c.inspect();await c.refresh();assert.equal(c.snapshot().role,'owner');assert.equal(c.snapshot().canApprove,true);assert.equal(calls.some(x=>/sign|send/i.test(x)),false);
 chain='0x1';await c.inspect();assert.equal(c.snapshot().canApprove,false);await assert.rejects(()=>c.approve());assert.equal(calls.some(x=>/sign|send/i.test(x)),false);
 chain='0x279f';account=F.donor;await c.inspect();now=NOW+210;assert.equal(c.snapshot().canApprove,false);await assert.rejects(()=>c.approve());
 c.invalidate();
});
test('fresh approvals and issuer login/prepare require separate explicit send and retain original hash recovery',async()=>{
 const realCrypto=await import('./public/t1f-phase8-crypto.mjs'),{createPhase8Controller}=await import('./public/t1f-phase8-controller.mjs');
 const {makeChallenge}=await import('./auth/siwe.mjs'),{t0}=await import('./t1e-first-issue-readiness.mjs');
 const {manifest,envelope}=fixture(),calls=[],requests=[],listeners={};let account=F.owner,failBind=true;const CSRF='a'.repeat(43),H='0x'+'7'.repeat(64),ORIGIN='http://127.0.0.1:15449';
 const provider={on(e,f){(listeners[e]??=[]).push(f)},async request(q){calls.push(q);if(q.method==='eth_accounts')return [account];if(q.method==='eth_chainId')return '0x279f';if(q.method==='eth_signTypedData_v4'||q.method==='personal_sign')return '0x'+'a'.repeat(130);if(q.method==='eth_sendTransaction')return H;throw Error(q.method)}};
 const change=a=>{account=a;for(const f of listeners.accountsChanged||[])f()};
 const request=async(path,method,body)=>{requests.push({path,method,body});if(path.endsWith('pre-session'))return {csrf:CSRF};if(path.endsWith('challenge'))return makeChallenge({wallet:F.issuer,origin:ORIGIN,chainId:10143,nonce:'a'.repeat(64),challengeId:envelope.round.round_id,issuedAt:NOW,expiresAt:NOW+180});if(path.endsWith('login'))return {csrf:CSRF,authPilot:true};if(path.endsWith('/approval')){envelope.round.approvals.push({round_id:ROUND,digest:manifest.digest,verification_version:'T1F_PHASE8_EIP712_EOA_V1',verified_at_epoch:NOW,role:body.role,wallet:F[body.role],fingerprint:'0x'+'8'.repeat(64)});return phase8Public(envelope,NOW)}if(path.endsWith('/prepare')){envelope.operation={round_id:ROUND,predecessor_id:F.predecessor.successor_id,receipt_block:null,receipt_block_hash:null,successor_id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',release_id:'ffffffff-ffff-4fff-8fff-ffffffffffff',claim_id:F.claimId,slot_id:F.slotId,operation_id:manifest.value.newOpId,issuer_nonce:0,issuer_issue_deadline:NOW+480,calldata_hash:manifest.candidateCalldataHash,issuer_wallet:F.issuer,escrow:F.escrow,chain_id:10143,voucher_id:F.voucherId,stage:'ISSUE_UNKNOWN',revision:0,tx_hash:null};return {...phase8Public(envelope,NOW),created:true,transaction:{from:F.issuer,to:F.escrow,chainId:'0x279f',value:'0x0',nonce:'0x0',data:t0.encodeFunctionData('issue',[manifest.value.newOpId,F.mealId,0,1,F.termsHash,NOW+480])}};}if(path.endsWith('/bind')){if(failBind)throw Error('LOST_BIND');envelope.operation.tx_hash=body.txHash;envelope.operation.stage='ISSUE_HASH_BOUND';envelope.operation.revision=1;}return phase8Public(envelope,NOW)};
 // Wallet signature return is a boundary stub; the production recovery primitive is tested separately.
 const crypto={...realCrypto,recoverApproval:()=>account};const c=createPhase8Controller({provider,request,crypto,clock:()=>NOW,origin:ORIGIN});
 await c.inspect();await c.refresh();assert.equal(calls.some(q=>q.method==='eth_signTypedData_v4'),false);await c.approve();assert.equal(c.snapshot().state.round.roles.owner,true);
 change(F.donor);await c.inspect();await c.approve();assert.equal(c.snapshot().state.round.roles.donor,true);assert.equal(calls.filter(q=>q.method==='eth_signTypedData_v4').length,2);assert.equal(calls.some(q=>q.method==='eth_sendTransaction'),false);
 change(F.issuer);await c.inspect();await c.issuer.challenge();await c.issuer.login();await c.refresh();await c.issuer.prepare();assert.equal(c.snapshot().issuer.canSend,true);assert.doesNotMatch(JSON.stringify(c.snapshot()),/"transaction"|"data"/);assert.equal(calls.some(q=>q.method==='eth_sendTransaction'),false);
 await assert.rejects(()=>c.issuer.send());assert.equal(c.snapshot().issuer.receivedHash,H);assert.equal(calls.filter(q=>q.method==='eth_sendTransaction').length,1);assert.equal(c.snapshot().issuer.canSend,false);
 failBind=false;await c.issuer.bind();await c.issuer.reconcile();assert.equal(c.snapshot().state.operation.txHash,H);assert.equal(calls.filter(q=>q.method==='eth_sendTransaction').length,1);assert.ok(requests.filter(q=>/prepare|bind|reconcile/.test(q.path)&&!q.path.includes('/auth/')).every(q=>q.path.startsWith('/v1/t1f/phase8/')));
 assert.doesNotMatch(JSON.stringify(c.snapshot()),/"signature"|"transaction"|"data"/);c.invalidate();
});
test('browser signature recovery rejects wrong signer before submit',async()=>{
 const crypto=await import('./public/t1f-phase8-crypto.mjs'),{Wallet}=await import('ethers'),{createPhase8Controller}=await import('./public/t1f-phase8-controller.mjs');const {manifest,envelope}=fixture(),typed=recoveryTypedData(manifest),wallet=Wallet.createRandom();
 const signature=await wallet.signTypedData(typed.domain,{RecoveryChildIssueRelease:typed.types.RecoveryChildIssueRelease},typed.message);assert.equal(crypto.recoverApproval(typed,signature),wallet.address.toLowerCase());
 const requests=[];const provider={on(){},async request(q){if(q.method==='eth_accounts')return [F.owner];if(q.method==='eth_chainId')return '0x279f';if(q.method==='eth_signTypedData_v4')return signature;throw Error(q.method)}};
 const c=createPhase8Controller({provider,crypto,clock:()=>NOW,origin:'http://127.0.0.1:15449',request:async p=>{requests.push(p);return phase8Public(envelope,NOW)}});await c.inspect();await c.refresh();await assert.rejects(()=>c.approve());assert.equal(requests.some(p=>p.endsWith('/approval')),false);c.invalidate();
});
test('approval races never submit after account change, expiry, or replaced round',async()=>{
 const crypto=await import('./public/t1f-phase8-crypto.mjs'),{createPhase8Controller}=await import('./public/t1f-phase8-controller.mjs');
 for(const failure of ['account','chain','expired','replacedRound']){
  const {envelope}=fixture();let now=NOW,account=F.owner,chain='0x279f',reads=0;const listeners={},calls=[],requests=[];
  const provider={on(e,f){(listeners[e]??=[]).push(f)},async request(q){calls.push(q.method);if(q.method==='eth_accounts')return [account];if(q.method==='eth_chainId')return chain;if(q.method==='eth_signTypedData_v4'){if(failure==='account'){account=F.donor;for(const f of listeners.accountsChanged||[])f()}if(failure==='chain')chain='0x1';if(failure==='expired')now=NOW+210;return '0x'+'a'.repeat(130)}throw Error(q.method)}};
  const c=createPhase8Controller({provider,crypto:{...crypto,recoverApproval:()=>F.owner},clock:()=>now,origin:'http://127.0.0.1:15449',request:async p=>{requests.push(p);const dto=phase8Public(envelope,now);if(++reads>1&&failure==='replacedRound')dto.round.id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';return dto}});
  await c.inspect();await c.refresh();await assert.rejects(()=>c.approve());assert.equal(requests.some(p=>p.endsWith('/approval')),false);assert.equal(calls.filter(x=>x==='eth_signTypedData_v4').length,failure==='replacedRound'?0:1);assert.equal(calls.some(x=>x==='eth_sendTransaction'),false);c.invalidate();
 }
});
test('browser rejects forged issued state without bound hash, receipt or both approvals',async()=>{
 const crypto=await import('./public/t1f-phase8-crypto.mjs'),{envelope,manifest}=fixture(),dto=phase8Public(envelope,NOW);dto.status='RECOVERY_ONLY';dto.round.roles={owner:true,donor:true};dto.operation={id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',operationId:manifest.value.newOpId,stage:'ISSUED',revision:2,nonce:'0',deadline:NOW+480,calldataHash:manifest.candidateCalldataHash,txHash:null,receiptBlock:null,receiptBlockHash:null};
 assert.throws(()=>crypto.validatePhase8(dto,NOW));dto.operation.txHash='0x'+'a'.repeat(64);assert.throws(()=>crypto.validatePhase8(dto,NOW));dto.operation.receiptBlock=1;dto.operation.receiptBlockHash='0x'+'b'.repeat(64);assert.doesNotThrow(()=>crypto.validatePhase8(dto,NOW));dto.round.roles.owner=false;assert.throws(()=>crypto.validatePhase8(dto,NOW));
});
test('late status and prepare responses cannot replace wrapper state after account change or retirement',async()=>{
 const crypto=await import('./public/t1f-phase8-crypto.mjs'),{createPhase8Controller}=await import('./public/t1f-phase8-controller.mjs'),{makeChallenge}=await import('./auth/siwe.mjs'),{t0}=await import('./t1e-first-issue-readiness.mjs');
 for(const action of ['status','prepare'])for(const change of ['account','retire']){
  const {envelope,manifest}=fixture(),listeners={},calls=[];let release,delay=false;const ORIGIN='http://127.0.0.1:15449',CSRF='a'.repeat(43);
  envelope.round.approvals=['owner','donor'].map(role=>({round_id:ROUND,digest:manifest.digest,verification_version:'T1F_PHASE8_EIP712_EOA_V1',verified_at_epoch:NOW,role,wallet:F[role],fingerprint:'0x'+'8'.repeat(64)}));
  const provider={on(e,f){(listeners[e]??=[]).push(f)},async request(q){calls.push(q.method);if(q.method==='eth_accounts')return [F.issuer];if(q.method==='eth_chainId')return '0x279f';if(q.method==='personal_sign')return '0x'+'a'.repeat(130);throw Error('UNEXPECTED_WALLET_ACTION')}};
  const request=async path=>{
   if(path.endsWith('pre-session'))return {csrf:CSRF};if(path.endsWith('challenge'))return makeChallenge({wallet:F.issuer,origin:ORIGIN,chainId:10143,nonce:'a'.repeat(64),challengeId:ROUND,issuedAt:NOW,expiresAt:NOW+180});if(path.endsWith('login'))return {csrf:CSRF,authPilot:true};
   let dto=phase8Public(envelope,NOW);
   if(path.endsWith('/prepare')){dto={...dto,status:'RECOVERY_ONLY',created:true,operation:{id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',operationId:manifest.value.newOpId,stage:'ISSUE_UNKNOWN',revision:0,nonce:'0',deadline:NOW+480,calldataHash:manifest.candidateCalldataHash,txHash:null,receiptBlock:null,receiptBlockHash:null},transaction:{from:F.issuer,to:F.escrow,chainId:'0x279f',value:'0x0',nonce:'0x0',data:t0.encodeFunctionData('issue',[manifest.value.newOpId,F.mealId,0,1,F.termsHash,NOW+480])}};}
   if(delay&&path.endsWith('/'+action)){if(action==='status'){dto.status='AWAIT_APPROVALS';dto.round.roles.owner=false;}return new Promise(resolve=>{release=()=>resolve(dto)});}return dto;
  };
  const c=createPhase8Controller({provider,crypto,request,clock:()=>NOW,origin:ORIGIN});await c.inspect();await c.issuer.challenge();await c.issuer.login();await c.refresh();delay=true;
  const pending=action==='status'?c.refresh():c.issuer.prepare();const rejected=assert.rejects(()=>pending);
  for(let count=0;!release&&count<100;count++)await new Promise(r=>setTimeout(r,0));assert.ok(release);const before=c.snapshot().state;
  if(change==='account')for(const f of listeners.accountsChanged||[])f();else c.invalidate();release();await rejected;
  assert.deepEqual(c.snapshot().state,before);assert.equal(c.snapshot().issuer.canSend,false);assert.equal(calls.includes('eth_sendTransaction'),false);c.invalidate();
 }
});
