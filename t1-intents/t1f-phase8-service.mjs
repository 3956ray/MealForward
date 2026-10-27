/** Phase8 source-only service. No wallet provider or transaction broadcaster. */
import {randomBytes,randomUUID} from 'node:crypto';
import {keccak256} from 'ethers';
import {CHAIN,ESCROW,MEAL,TERMS} from './core.mjs';
import {t0,originalVoucherId} from './t1e-first-issue-readiness.mjs';
import {PHASE8_FIXED as F,buildRecoveryManifest,reconstructRecoveryManifest,recoveryTypedData,verifyRecoveryApproval,validateRecoveryPredecessor,validateRecoveryObservation} from './t1f-phase8-protocol.mjs';
import {makeExecutionPublicRpc,boundedExecutionRpc} from './t1f-execution-rpc.mjs';
import {observeRecovery} from './t1f-phase8-observe.mjs';
import {verifySuccessorReceiptReadOnly} from './t1f-successor-issue-protocol.mjs';
import {BIND_VERSION,RECONCILE_VERSION} from './t1f-execution-contract.mjs';
const check=(x,c)=>{if(!x)throw Error('T1F_PHASE8_'+c)};
const exact=(x,k)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join()===k.slice().sort().join();
const hash=x=>typeof x==='string'&&/^0x[0-9a-f]{64}$/.test(x);
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(x);
const hex=x=>'0x'+BigInt(x).toString(16);
const txFor=m=>({from:F.issuer,to:ESCROW,chainId:hex(CHAIN),value:'0x0',nonce:hex(m.value.newNonce),data:t0.encodeFunctionData('issue',[m.value.newOpId,MEAL,0,1,TERMS,m.value.newDeadline])});
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
function inspect(e,now){
 validateRecoveryPredecessor(e?.predecessor);
 const r=e.round,m=r?reconstructRecoveryManifest({row:r,predecessor:e.predecessor,now,allowExpired:true}):null;
 const roles={owner:false,donor:false};
 if(r){check(uuid(r.round_id)&&Array.isArray(r.approvals)&&r.approvals.length<=2,'ROUND');for(const a of r.approvals){check(Object.hasOwn(roles,a.role)&&!roles[a.role]&&a.wallet===F[a.role]&&hash(a.fingerprint)&&a.round_id===r.round_id&&a.digest===r.digest&&a.verification_version==='T1F_PHASE8_EIP712_EOA_V1'&&Number.isSafeInteger(a.verified_at_epoch)&&a.verified_at_epoch>=r.created_at_epoch&&a.verified_at_epoch<Number(m.value.approvalExpiresAt)&&a.verified_at_epoch<=now,'APPROVAL');roles[a.role]=true;}}
 const o=e.operation;
 if(o){check(r&&roles.owner&&roles.donor&&uuid(o.successor_id)&&uuid(o.release_id)&&o.round_id===r.round_id&&o.predecessor_id===F.predecessor.successor_id&&o.claim_id===F.claimId&&o.slot_id===F.slotId&&o.operation_id===m.value.newOpId&&String(o.issuer_nonce)===m.value.newNonce&&String(o.issuer_issue_deadline)===m.value.newDeadline&&o.calldata_hash===m.candidateCalldataHash&&o.issuer_wallet===F.issuer&&o.escrow===ESCROW&&Number(o.chain_id)===CHAIN&&o.voucher_id===F.voucherId&&Number.isSafeInteger(o.revision)&&o.revision===['ISSUE_UNKNOWN','ISSUE_HASH_BOUND','ISSUED'].indexOf(o.stage)&&o.revision>=0,'OPERATION');check(o.stage==='ISSUE_UNKNOWN'?o.tx_hash===null:hash(o.tx_hash),'OPERATION_HASH');check(o.stage==='ISSUED'?Number.isSafeInteger(o.receipt_block)&&o.receipt_block>0&&hash(o.receipt_block_hash):o.receipt_block===null&&o.receipt_block_hash===null,'RECEIPT');}
 return {r,m,roles,o};
}
export function phase8Public(e,now){
 const {r,m,roles,o}=inspect(e,now);
 return {version:'T1F_PHASE8_PUBLIC_V1',status:o?'RECOVERY_ONLY':!r?'NO_ROUND':now>=m.prepareBefore?'PREPARE_WINDOW_CLOSED':roles.owner&&roles.donor?'READY_TO_PREPARE':'AWAIT_APPROVALS',originalClaimStage:'ISSUE_UNKNOWN',serverTime:now,chainId:CHAIN,issuer:F.issuer,target:ESCROW,serverMayBroadcast:false,settlementEnabled:false,sendAgainPermitted:false,
 predecessor:{id:F.predecessor.successor_id,operationId:F.predecessor.operation_id,deadline:F.predecessor.issuer_issue_deadline,calldataHash:F.predecessor.calldata_hash,roundId:F.predecessorRoundId,digest:F.predecessorDigest,stage:e.predecessor.stage,txHash:e.predecessor.tx_hash},
 round:r?{id:r.round_id,digest:m.digest,expiresAt:Number(m.value.approvalExpiresAt),prepareBefore:m.prepareBefore,candidateDeadline:Number(m.value.newDeadline),nonce:m.value.newNonce,roles,typedData:recoveryTypedData(m)}:null,
 operation:o?{id:o.successor_id,operationId:o.operation_id,stage:o.stage,revision:o.revision,nonce:String(o.issuer_nonce),deadline:Number(o.issuer_issue_deadline),calldataHash:o.calldata_hash,txHash:o.tx_hash,receiptBlock:o.receipt_block??null,receiptBlockHash:o.receipt_block_hash??null}:null};
}
export function makePhase8Service({store,rpc=makeExecutionPublicRpc(),clock=()=>Math.floor(Date.now()/1000),rpcBudgetMs=45000}={}){
 check(['context','get','create','record','consume','bind','reconcile'].every(k=>typeof store?.[k]==='function'),'STORE');
 const dto=e=>phase8Public(e,clock());
 const run=async(signal,fn)=>{const b=boundedExecutionRpc({rpc,signal,budgetMs:rpcBudgetMs});try{return await fn(b)}finally{b.close()}};
 const selected=async body=>{check(uuid(body?.roundId),'ROUND');const e=await store.get(body.roundId);check(e?.round?.round_id===body.roundId,'ROUND');inspect(e,clock());return e};
 const unchanged=(a,b)=>check(JSON.stringify(a)===JSON.stringify(b),'CONTEXT_CHANGED');
 const fresh=async(b,e)=>{const observation=await observeRecovery({rpc:b.rpc,row:e.round,clock});validateRecoveryObservation({predecessor:e.predecessor,observation,now:clock()});b.check();return observation};
 return Object.freeze({
  status:async()=>dto(await store.context()),
  // Operator-only: never mounted in HTTP. New user report needed before invocation.
  createRound:async({walletObservation}={})=>run(null,async b=>{
   const e=await store.context();inspect(e,clock());check(!e.operation,'CONSUMED');
   const observation=await fresh(b,e),createdAt=clock();
   const manifest=buildRecoveryManifest({predecessor:e.predecessor,observation,walletObservation,now:createdAt,newOpId:'0x'+randomBytes(32).toString('hex'),nonceDomain:'0x'+randomBytes(32).toString('hex')});
   unchanged(e,await store.context());b.check();
   await store.create({roundId:randomUUID(),manifest,createdAt,observedBlockTime:observation.observedBlockTime,evidence:observation,walletObservation,beforeExecute:b.check});return dto(await store.context());
  }),
  submit:async(body,{signal}={})=>run(signal,async b=>{
   check(exact(body,['roundId','digest','role','signature'])&&hash(body.digest),'BODY');const e=await selected(body);check(!e.operation&&e.round.digest===body.digest,'CONSUMED_OR_DIGEST');
   const m=reconstructRecoveryManifest({row:e.round,predecessor:e.predecessor,now:clock()}),approval=verifyRecoveryApproval({manifest:m,role:body.role,signature:body.signature});
   const evidence=await fresh(b,e);unchanged(e,await store.get(body.roundId));b.check();
   await store.record({roundId:body.roundId,digest:body.digest,...approval,evidence,beforeExecute:()=>{b.check();check(clock()<Number(m.value.approvalExpiresAt),'EXPIRED')}});return dto(await store.get(body.roundId));
  }),
  prepare:async(body,{signal}={})=>{
   check(exact(body,['roundId','digest'])&&hash(body.digest),'BODY');check(!signal?.aborted,'ABORTED');const e=await selected(body);check(e.round.digest===body.digest,'DIGEST');
   if(e.operation)return {...dto(e),created:false};
   const {m,roles}=inspect(e,clock()),margin=()=>check(clock()<m.prepareBefore,'PREPARE_WINDOW_CLOSED');margin();check(roles.owner&&roles.donor,'DUAL_APPROVAL');
   return run(signal,async b=>{
    const observation=await fresh(b,e);margin();const transaction=txFor(m);check(keccak256(transaction.data)===m.candidateCalldataHash,'CALLDATA');
    const raw=await b.rpc.send('eth_call',[{from:F.issuer,to:ESCROW,value:'0x0',data:transaction.data},hex(observation.observedBlockNumber)]);
    check(same(t0.decodeFunctionResult('issue',raw)[0],originalVoucherId(0,1n)),'SIMULATION');
    const anchor=await b.rpc.send('eth_getBlockByNumber',[hex(observation.observedBlockNumber),false]);check(anchor?.hash===observation.observedBlockHash&&Number(BigInt(anchor.timestamp))===observation.observedBlockTime,'REORG');
    const latest=await store.get(body.roundId);b.check();margin();if(latest.operation)return {...dto(latest),created:false};unchanged(e,latest);
    const evidence={...observation,simulationPassed:true,calldataHash:m.candidateCalldataHash,signedAnchorCanonical:true,signedFinalizedCanonical:true};
    const result=await store.consume({...body,evidence,beforeExecute:()=>{b.check();margin()}});b.check();
    const out=dto({...e,operation:result.operation});return {...out,created:result.created===true,...(result.created===true?{transaction}: {})};
   });
  },
  bind:async(body,{signal}={})=>{
   check(exact(body,['roundId','successorId','revision','txHash'])&&uuid(body.successorId)&&Number.isSafeInteger(body.revision)&&body.revision>=0&&hash(body.txHash),'BODY');
   const e=await selected(body),o=e.operation;check(o?.successor_id===body.successorId,'OPERATION');
   if(o.tx_hash){check(o.tx_hash===body.txHash,'HASH_ALREADY_BOUND');return dto(e)}
   return run(signal,async b=>{const [chain,tx]=await Promise.all([b.rpc.send('eth_chainId',[]),b.rpc.send('eth_getTransactionByHash',[body.txHash])]);
    check(BigInt(chain)===BigInt(CHAIN)&&tx&&same(tx.hash,body.txHash)&&same(tx.from,F.issuer)&&same(tx.to,ESCROW)&&tx.chainId!=null&&BigInt(tx.chainId)===BigInt(CHAIN)&&BigInt(tx.nonce)===BigInt(o.issuer_nonce)&&BigInt(tx.value)===0n&&keccak256(tx.input??tx.data)===o.calldata_hash,'TRANSACTION_IDENTITY');
    const evidence={version:BIND_VERSION,chainId:String(CHAIN),from:F.issuer,to:ESCROW,nonce:String(o.issuer_nonce),value:'0',calldataHash:o.calldata_hash,txHash:body.txHash};
    const operation=await store.bind({successorId:o.successor_id,revision:body.revision,txHash:body.txHash,evidence,beforeExecute:b.check});b.check();return dto({...e,operation});});
  },
  reconcile:async(body,{signal}={})=>{
   check(exact(body,['roundId','successorId','revision'])&&uuid(body.successorId)&&Number.isSafeInteger(body.revision)&&body.revision>=0,'BODY');const e=await selected(body),o=e.operation;check(o?.successor_id===body.successorId,'OPERATION');if(o.stage!=='ISSUE_HASH_BOUND')return dto(e);
   return run(signal,async b=>{
    const attempt={attempt_id:o.successor_id,claim_id:o.claim_id,stage:o.stage,security_release_id:o.release_id,original_operation_id:F.originalOperationId,original_issuer_nonce:0,original_deadline:F.originalDeadline,original_calldata_hash:F.originalDataHash,successor_operation_id:o.operation_id,successor_nonce:o.issuer_nonce,successor_issue_deadline:o.issuer_issue_deadline,successor_calldata_hash:o.calldata_hash,successor_tx_hash:o.tx_hash,legacy_claim_rewrite_allowed:false};
    const proof=await verifySuccessorReceiptReadOnly({claim:e.context.claim,attempt,rpc:b.rpc,now:clock()});b.check();
    if(proof.status!=='T1F_SUCCESSOR_RECEIPT_VERIFIED_SOURCE_ONLY')return {...dto(e),receiptStatus:proof.successorAttemptStatus};
    const evidence={version:RECONCILE_VERSION,txHash:o.tx_hash,blockNumber:String(proof.blockNumber),blockHash:proof.blockHash,canonical:true,receiptSucceeded:true,expectedEventsValid:true,operationValid:true,accountingValid:true};
    const operation=await store.reconcile({successorId:o.successor_id,revision:body.revision,evidence,beforeExecute:b.check});b.check();return dto({...e,operation});
   });
  }
 });
}
