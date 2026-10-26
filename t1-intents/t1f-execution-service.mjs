/** One atomic reservation, one response containing wallet bytes. Never broadcasts. */
import {keccak256} from 'ethers';
import {CHAIN,ESCROW,MEAL,TERMS} from './core.mjs';
import {FIXED,t0,originalVoucherId,firstVoucherCandidate} from './t1e-first-issue-readiness.mjs';
import {inspectExpiredOriginalIssuer} from './t1f-expired-issuer-readonly.mjs';
import {verifySuccessorReceiptReadOnly} from './t1f-successor-issue-protocol.mjs';
import {reconstructApproval,publicApproval,exactKeys,validRoundId,APPROVAL_WALLETS} from './t1f-approval-protocol.mjs';
import {validateConsumption,OBSERVATION_VERSION,BIND_VERSION,RECONCILE_VERSION} from './t1f-execution-contract.mjs';
import {makeExecutionPublicRpc,boundedExecutionRpc} from './t1f-execution-rpc.mjs';
const check=(ok,c)=>{if(!ok)throw Error('T1F_EXECUTION_'+c)};
const hex=n=>'0x'+BigInt(n).toString(16),dec=n=>BigInt(n).toString();
const hash=x=>typeof x==='string'&&/^0x[0-9a-f]{64}$/.test(x);
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const transaction=v=>({from:FIXED.issuerAuthority,to:ESCROW,chainId:hex(CHAIN),value:'0x0',nonce:hex(v.newNonce),data:t0.encodeFunctionData('issue',[v.newOpId,MEAL,0,1,TERMS,v.newDeadline])});
/** Deliberate allowlist: no claim privacy, signature fingerprints or transaction bytes. */
export function publicExecution({context,round,consumption,operation},now){
 if(consumption)validateConsumption(consumption,{context,operation});
 const collected=round?publicApproval({row:round,context:consumption?{...context,consumption}:context,now}):null;
 const o=operation;
 return {status:o?'RECOVERY_ONLY':!round?'NO_ROUND':now>=Number(round.value.approvalExpiresAt)-90?'PREPARE_WINDOW_CLOSED':collected.roles.owner&&collected.roles.donor?'READY_TO_PREPARE':'AWAIT_APPROVALS',
  originalClaimStage:'ISSUE_UNKNOWN',serverTime:now,chainId:CHAIN,issuer:FIXED.issuerAuthority,target:ESCROW,
  serverMayBroadcast:false,settlementEnabled:false,sendAgainPermitted:false,
  round:round?{id:round.round_id,digest:round.digest,expiresAt:Number(round.value.approvalExpiresAt),prepareBefore:Number(round.value.approvalExpiresAt)-90,candidateDeadline:Number(round.value.newDeadline),nonce:round.value.newNonce,roles:collected.roles}:null,
  operation:o?{id:o.successor_id,operationId:o.operation_id,stage:o.stage,revision:o.revision,nonce:String(o.issuer_nonce),deadline:Number(o.issuer_issue_deadline),calldataHash:o.calldata_hash,txHash:o.tx_hash??null,receiptBlock:o.receipt_block??null,receiptBlockHash:o.receipt_block_hash??null}:null};
}
async function observe(rpc,row,clock,data){
 const historical=await rpc.send('eth_getBlockByNumber',[hex(row.value.observedBlockNumber),false]);
 check(historical&&dec(historical.number)===row.value.observedBlockNumber&&historical.hash===row.value.observedBlockHash&&dec(historical.timestamp)===String(row.observed_block_time),'HISTORICAL_REORG');
 const head=await rpc.send('eth_blockNumber',[]),anchor=await rpc.send('eth_getBlockByNumber',[head,false]);
 check(anchor&&dec(anchor.number)===dec(head)&&hash(anchor.hash),'FRESH_ANCHOR');
 const pinned={send(method,params=[]){if(method==='eth_blockNumber')return Promise.resolve(head);return rpc.send(method,method==='eth_getTransactionCount'&&params[1]==='latest'?[params[0],head]:params)}};
 await firstVoucherCandidate({rpc:pinned,simulateIssuer:false});
 const chain=await inspectExpiredOriginalIssuer({rpc:pinned});
 check(chain.status==='T1F_EXPIRED_NO_ISSUE_OBSERVED_NOT_ABSENCE_PROOF'&&chain.issuerLatestNonce===row.value.newNonce&&chain.issuerPendingNonce===row.value.newNonce&&chain.originalOperationSeen===false&&chain.unitAvailable===true&&chain.unitIssued===false,'CHAIN_ACTIVITY');
 check(chain.observedBlockNumber===dec(head)&&chain.observedBlockHash===anchor.hash&&BigInt(head)>=BigInt(row.value.observedBlockNumber),'FRESH_ANCHOR');
 for(const wallet of Object.values(APPROVAL_WALLETS))check(await rpc.send('eth_getCode',[wallet,head])==='0x','EOA_REQUIRED');
 const raw=await rpc.send('eth_call',[{from:FIXED.issuerAuthority,to:ESCROW,value:'0x0',data},head]);
 check(same(t0.decodeFunctionResult('issue',raw)[0],originalVoucherId(0,1n)),'SIMULATION');
 const final=await rpc.send('eth_getBlockByNumber',[head,false]);
 const signed=await rpc.send('eth_getBlockByNumber',[hex(row.value.observedBlockNumber),false]);
 check(final?.hash===anchor.hash&&dec(final.timestamp)===dec(anchor.timestamp),'FRESH_REORG');
 check(signed?.hash===historical.hash&&dec(signed.timestamp)===String(row.observed_block_time),'HISTORICAL_REORG');
 const observed=Number(BigInt(anchor.timestamp)),now=clock();
 check(Number.isSafeInteger(observed)&&observed<=now&&now-observed<=120,'STALE_CHAIN');
 return {version:OBSERVATION_VERSION,roundId:row.round_id,digest:row.digest,signedBlockNumber:row.value.observedBlockNumber,signedBlockHash:row.value.observedBlockHash,observedBlockNumber:dec(head),observedBlockHash:anchor.hash,observedAt:String(observed),issuerLatestNonce:chain.issuerLatestNonce,issuerPendingNonce:chain.issuerPendingNonce,calldataHash:keccak256(data),historicalAnchorCanonical:true,freshAnchorCanonical:true,originalOperationSeen:false,unitAvailable:true,unitIssued:false,codeAndAuthorityValid:true,accountingValid:true,simulationPassed:true};
}
export function makeExecutionService({store,rpc=makeExecutionPublicRpc(),clock=()=>Math.floor(Date.now()/1000),rpcBudgetMs=45000}={}){
 check(['context','get','consume','bind','reconcile'].every(k=>typeof store?.[k]==='function'),'STORE');
 const dto=e=>publicExecution(e,clock());
 const run=async(signal,task)=>{const bounded=boundedExecutionRpc({rpc,signal,budgetMs:rpcBudgetMs});try{return await task(bounded)}finally{bounded.close()}};
 const guard=(bounded,signal)=>()=>{check(!signal?.aborted,'REQUEST_ABORTED');bounded.check()};
 const selected=async body=>{check(validRoundId(body.roundId),'ROUND');const e=await store.get(body.roundId);check(e?.context,'CONTEXT');return e};
 return Object.freeze({
  status:async()=>dto(await store.context()),
  prepare:async(body,{signal}={})=>{
   check(exactKeys(body,['roundId','digest'])&&hash(body.digest),'BODY');check(!signal?.aborted,'REQUEST_ABORTED');
   const e=await selected(body);
   if(e.operation)return {...dto(e),created:false};
   check(e.round?.digest===body.digest,'DIGEST');
   const margin=()=>check(clock()<Number(e.round.value.approvalExpiresAt)-90,'PREPARE_WINDOW_CLOSED');
   margin();const manifest=reconstructApproval({row:e.round,context:e.context,now:clock()});
   const approval=publicApproval({row:e.round,context:e.context,now:clock()});check(approval.roles.owner&&approval.roles.donor,'DUAL_APPROVAL_REQUIRED');
   const tx=transaction(manifest.value);check(keccak256(tx.data)===manifest.candidateCalldataHash,'CALLDATA');
   return run(signal,async bounded=>{
    const active=guard(bounded,signal),evidence=await observe(bounded.rpc,e.round,clock,tx.data);active();margin();
    const latest=await store.get(body.roundId);active();margin();
    if(latest.operation)return {...dto(latest),created:false};
    check(JSON.stringify(latest.context)===JSON.stringify(e.context)&&JSON.stringify(latest.round)===JSON.stringify(e.round),'CONTEXT_CHANGED');
    const result=await store.consume({...body,evidence,beforeExecute:()=>{active();margin()}});
    // This is deliberately not raced against a timeout. A lost COMMIT response
    // cannot authorize another send; next prepare reads the reserved operation.
    active();
    validateConsumption(result.consumption,{round:e.round,context:e.context,operation:result.operation});
    const out={...dto({...e,...result}),created:result.created===true};
    if(result.created===true){check(result.operation.calldata_hash===keccak256(tx.data)&&result.operation.operation_id===manifest.value.newOpId,'COMMITTED_OPERATION');out.transaction=tx;}
    return out;
   });
  },
  bind:async(body,{signal}={})=>{
   check(exactKeys(body,['roundId','successorId','revision','txHash'])&&validRoundId(body.successorId)&&Number.isSafeInteger(body.revision)&&body.revision>=0&&hash(body.txHash),'BODY');
   const e=await selected(body),o=e.operation;check(o?.successor_id===body.successorId,'OPERATION');
   if(o.tx_hash){check(o.tx_hash===body.txHash,'HASH_ALREADY_BOUND');return dto(e)}
   return run(signal,async bounded=>{const active=guard(bounded,signal);active();
    const [chain,tx]=await Promise.all([bounded.rpc.send('eth_chainId',[]),bounded.rpc.send('eth_getTransactionByHash',[body.txHash])]);active();
    check(BigInt(chain)===BigInt(CHAIN)&&tx&&same(tx.hash,body.txHash)&&same(tx.from,o.issuer_wallet)&&same(tx.to,o.escrow)&&tx.chainId!=null&&BigInt(tx.chainId)===BigInt(CHAIN)&&BigInt(tx.nonce)===BigInt(o.issuer_nonce)&&BigInt(tx.value)===0n&&keccak256(tx.input??tx.data)===o.calldata_hash,'TRANSACTION_IDENTITY');
    const evidence={version:BIND_VERSION,chainId:String(CHAIN),from:o.issuer_wallet,to:o.escrow,nonce:String(o.issuer_nonce),value:'0',calldataHash:o.calldata_hash,txHash:body.txHash};
    const operation=await store.bind({successorId:o.successor_id,revision:body.revision,txHash:body.txHash,evidence,beforeExecute:active});active();return dto({...e,operation});
   });
  },
  reconcile:async(body,{signal}={})=>{
   check(exactKeys(body,['roundId','successorId','revision'])&&validRoundId(body.successorId)&&Number.isSafeInteger(body.revision)&&body.revision>=0,'BODY');
   const e=await selected(body),o=e.operation;check(o?.successor_id===body.successorId,'OPERATION');
   if(o.stage!=='ISSUE_HASH_BOUND')return dto(e);
   return run(signal,async bounded=>{const active=guard(bounded,signal);active();
    const attempt={attempt_id:o.successor_id,claim_id:o.claim_id,stage:o.stage,security_release_id:o.release_id,original_operation_id:e.context.claim.issuer_op_id,original_issuer_nonce:e.context.claim.issuer_tx_nonce,original_deadline:e.context.claim.issuer_issue_deadline,original_calldata_hash:e.context.claim.issuer_tx_data_hash,successor_operation_id:o.operation_id,successor_nonce:o.issuer_nonce,successor_issue_deadline:o.issuer_issue_deadline,successor_calldata_hash:o.calldata_hash,successor_tx_hash:o.tx_hash,legacy_claim_rewrite_allowed:false};
    const proof=await verifySuccessorReceiptReadOnly({claim:e.context.claim,attempt,rpc:bounded.rpc,now:clock()});active();
    if(proof.status!=='T1F_SUCCESSOR_RECEIPT_VERIFIED_SOURCE_ONLY')return {...dto(e),receiptStatus:proof.successorAttemptStatus};
    const evidence={version:RECONCILE_VERSION,txHash:o.tx_hash,blockNumber:String(proof.blockNumber),blockHash:proof.blockHash,canonical:true,receiptSucceeded:true,expectedEventsValid:true,operationValid:true,accountingValid:true};
    const operation=await store.reconcile({successorId:o.successor_id,revision:body.revision,evidence,beforeExecute:active});active();return dto({...e,operation});
   });
  }
 });
}
