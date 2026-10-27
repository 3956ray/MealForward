/** Isolated synthetic RPC and in-memory durable-store behavior; no live calls. */
import assert from 'node:assert/strict';
import {approvalRpcFixture,fixture as oldFixture,HEX} from './t1f-approval-test-fixture.mjs';
import {executionRpcFixture} from './t1f-execution-test-fixture.mjs';
import {PHASE8_FIXED as F,buildRecoveryManifest} from './t1f-phase8-protocol.mjs';
import {makePhase8Service} from './t1f-phase8-service.mjs';
import {t0,originalVoucherId} from './t1e-first-issue-readiness.mjs';
export {HEX};
export const NOW=1793081010,CREATED=NOW-10,HEAD=74584004,FINAL=HEAD-4,ROUND='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const CHILD='dddddddd-dddd-4ddd-8ddd-dddddddddddd',RELEASE='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const hex=n=>'0x'+BigInt(n).toString(16),clone=structuredClone;
const block=n=>({number:hex(n),hash:HEX(n===HEAD?'b':n===FINAL?'a':'c'),timestamp:hex(NOW-1-(HEAD-n))});
export async function setupPhase8({withRound=true}={}){
 const observation={version:'T1F_PHASE8_OBSERVATION_V1',chainId:10143,issuer:F.issuer,escrow:F.escrow,finalizedBlockNumber:String(HEAD-20),finalizedBlockHash:HEX('c'),finalizedBlockTime:NOW-21,finalizedCanonical:true,observedBlockNumber:String(HEAD-10),observedBlockHash:HEX('c'),observedBlockTime:NOW-11,freshCanonical:true,issuerLatestNonce:'0',issuerPendingNonce:'0',originalOperationSeen:false,predecessorOperationSeen:false,unitAvailable:true,unitIssued:false,unitGeneration:'0',unitSeq:'0',mealId:F.mealId,termsHash:F.termsHash,codeAndAuthorityValid:true,accountingValid:true};
 const manifest=buildRecoveryManifest({predecessor:F.predecessor,observation,walletObservation:{value:'ISSUER_REPORTED_NO_PENDING_OR_SENT_TRANSACTIONS',observedAt:CREATED},now:CREATED,newOpId:HEX('d'),nonceDomain:HEX('e')});
 const row={round_id:ROUND,value:manifest.value,digest:manifest.digest,candidate_calldata_hash:manifest.candidateCalldataHash,created_at_epoch:CREATED,observed_block_time:observation.observedBlockTime,approvals:['owner','donor'].map(role=>({round_id:ROUND,role,wallet:F[role],fingerprint:HEX(role==='owner'?'4':'5'),digest:manifest.digest,verification_version:'T1F_PHASE8_EIP712_EOA_V1',verified_at_epoch:CREATED+1}))};
 const old=oldFixture();Object.assign(old.context.claim,{meal_id:F.mealId,terms_hash:F.termsHash,beneficiary_wallet:'0x2539fefe77a5ce4d09d2225c2e8a7517b22b9135',consent_nonce:HEX('2'),consent_deadline:NOW-100});old.context.review.review_id=F.reviewId;old.context.slot.attempt_id=F.slotId;
 const envelope={context:old.context,predecessor:{...F.predecessor},round:withRound?row:null,operation:null};
 const counts={create:0,record:0,consume:0,bind:0,reconcile:0};let lose=false,now=NOW,afterConsume=null,beforeStore=null;
 const store={context:async()=>clone(envelope),get:async()=>clone(envelope),
  async create({roundId,manifest,createdAt,observedBlockTime,beforeExecute}){await beforeStore?.('create');beforeExecute?.();counts.create++;envelope.round={round_id:roundId,value:manifest.value,digest:manifest.digest,candidate_calldata_hash:manifest.candidateCalldataHash,created_at_epoch:createdAt,observed_block_time:observedBlockTime,approvals:[]};return clone(envelope.round)},
  async record({beforeExecute}){await beforeStore?.('record');beforeExecute?.();counts.record++;throw Error('REAL_SIGNATURE_NEEDED');},
  async consume({roundId,digest,evidence,beforeExecute}){await beforeStore?.('consume');beforeExecute?.();assert.equal(roundId,envelope.round.round_id);assert.equal(digest,envelope.round.digest);assert.equal(evidence.simulationPassed,true);assert.equal(evidence.calldataHash,envelope.round.candidate_calldata_hash);counts.consume++;
   if(envelope.operation)return {created:false,operation:clone(envelope.operation)};
   const r=envelope.round;
   envelope.operation={successor_id:CHILD,release_id:RELEASE,round_id:r.round_id,predecessor_id:F.predecessor.successor_id,claim_id:F.claimId,slot_id:F.slotId,chain_id:10143,escrow:F.escrow,voucher_id:F.voucherId,issuer_wallet:F.issuer,operation_id:r.value.newOpId,issuer_nonce:0,issuer_issue_deadline:Number(r.value.newDeadline),calldata_hash:r.candidate_calldata_hash,stage:'ISSUE_UNKNOWN',revision:0,tx_hash:null,receipt_block:null,receipt_block_hash:null};
   afterConsume?.();if(lose)throw Error('LOST_COMMIT_RESPONSE');return {created:true,operation:clone(envelope.operation)};
  },
  async bind({successorId,revision,txHash,beforeExecute}){await beforeStore?.('bind');beforeExecute?.();assert.equal(successorId,CHILD);assert.equal(revision,envelope.operation.revision);counts.bind++;Object.assign(envelope.operation,{stage:'ISSUE_HASH_BOUND',tx_hash:txHash,revision:revision+1});return clone(envelope.operation)},
  async reconcile({successorId,revision,evidence,beforeExecute}){await beforeStore?.('reconcile');beforeExecute?.();assert.equal(successorId,CHILD);assert.equal(revision,envelope.operation.revision);counts.reconcile++;Object.assign(envelope.operation,{stage:'ISSUED',revision:revision+1,receipt_block:Number(evidence.blockNumber),receipt_block_hash:evidence.blockHash});return clone(envelope.operation)}
 };
 const base=await approvalRpcFixture({blockTime:NOW-1}),receipt=await executionRpcFixture({row,now:NOW});let receiptMode=false,onRpc=null;const calls=[];
 const rawRpc={async send(method,args=[]){
  calls.push([method,args]);await onRpc?.(method,args);
  if(receiptMode){
   let value=await receipt.rpc.send(method,args);
   if(method==='eth_blockNumber')return hex(HEAD+3);
   if(method==='eth_getBlockByNumber')return {...value,number:args[0],timestamp:hex(NOW+1)};
   if((method==='eth_getTransactionByHash'||method==='eth_getTransactionReceipt')&&value)value={...value,blockNumber:hex(HEAD+1)};
   return value;
  }
  if(method==='eth_blockNumber')return hex(HEAD);
  if(method==='eth_getBlockByNumber')return block(args[0]==='finalized'?FINAL:Number(BigInt(args[0])));
  if(method==='eth_call'&&args[0].data.startsWith(t0.getFunction('issue').selector))return t0.encodeFunctionResult('issue',[originalVoucherId(0,1n)]);
  return base.rpc.send(method,args);
 }};
 const service=()=>makePhase8Service({store,rpc:rawRpc,clock:()=>now});
 return {manifest,row,envelope,store,counts,calls,rpc:rawRpc,service:service(),makeService:service,body:()=>({roundId:envelope.round.round_id,digest:envelope.round.digest}),get now(){return now},setNow(v){now=v},lose(){lose=true},setBeforeStore(fn){beforeStore=fn},setAfterConsume(fn){afterConsume=fn},onRpc(fn){onRpc=fn},useReceipt(transaction,hash,mode='pending'){receipt.bind(transaction,hash);receipt.setMode(mode);receiptMode=true},setReceiptMode:receipt.setMode};
}
