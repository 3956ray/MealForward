/** Read-only Phase8 attestation. Caller supplies a bounded read-only RPC.
 * No finalized fallback, no wallet report fabrication, and no issue simulation.
 * Both old operation identities and unit0 are checked at finalized and latest.
 */
import {CHAIN,ESCROW,MEAL,TERMS,PRICE,QUOTE} from './core.mjs';
import {firstVoucherCandidate,t0,FIXED} from './t1e-first-issue-readiness.mjs';
import {receiptABI} from './t1f-issue-operation.mjs';
import {PHASE8_FIXED as F,validateRecoveryObservation} from './t1f-phase8-protocol.mjs';
const check=(v,c)=>{if(!v)throw Error('T1F_PHASE8_'+c)};
const dec=v=>BigInt(v).toString(),hex=v=>'0x'+BigInt(v).toString(16);
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const hash=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v)&&v!=='0x'+'0'.repeat(64);
const uint=v=>typeof v==='string'&&/^0x(0|[1-9a-f][0-9a-f]*)$/.test(v);
const zero='0x'+'0'.repeat(64);
function block(b){check(b&&uint(b.number)&&BigInt(b.number)>0n&&uint(b.timestamp)&&hash(b.hash)&&Number.isSafeInteger(Number(BigInt(b.timestamp))),'BLOCK');return b;}
const unchanged=(a,b)=>a.number===b.number&&a.hash===b.hash&&a.timestamp===b.timestamp;
async function tuple(rpc,iface,name,args,tag){return iface.decodeFunctionResult(name,await rpc.send('eth_call',[{to:ESCROW,data:iface.encodeFunctionData(name,args)},tag]))[0];}
async function atAnchor(rpc,tag){
 const [original,predecessor,unit]=await Promise.all([
  tuple(rpc,receiptABI,'getOperation',[F.originalOperationId],tag),
  tuple(rpc,receiptABI,'getOperation',[F.predecessor.operation_id],tag),
  tuple(rpc,t0,'getUnit',[0],tag)
 ]);
 for(const op of [original,predecessor])check(op.kind===0n&&op.caller==='0x'+'0'.repeat(40)&&op.payloadHash===zero&&op.result===zero&&op.executedAt===0n,'OPERATION_SEEN');
 check(unit.bucket===0n&&unit.generation===0n&&unit.voucherId===zero&&unit.localIndex===0n&&unit.version===1n&&same(unit.payer,QUOTE)&&same(unit.mealId,MEAL)&&same(unit.termsHash,TERMS)&&unit.unitPrice===PRICE,'UNIT_CHANGED');
 return unit;
}
export async function observeRecovery({rpc,row=null,clock=()=>Math.floor(Date.now()/1000)}={}){
 check(typeof rpc?.send==='function'&&typeof clock==='function','RPC');
 check(BigInt(await rpc.send('eth_chainId',[]))===BigInt(CHAIN),'CHAIN');
 // Unsupported finalized is an error; never substitute latest.
 const finalized=block(await rpc.send('eth_getBlockByNumber',['finalized',false]));
 const head=await rpc.send('eth_blockNumber',[]),fresh=block(await rpc.send('eth_getBlockByNumber',[head,false]));
 check(fresh.number===head&&BigInt(finalized.number)<=BigInt(head)&&BigInt(finalized.timestamp)>=BigInt(F.predecessor.issuer_issue_deadline)&&BigInt(finalized.timestamp)<=BigInt(fresh.timestamp),'EXPIRY_ANCHOR');
 const pinned={send(method,params=[]){if(method==='eth_blockNumber')return Promise.resolve(head);return rpc.send(method,params)}};
 const candidate=await firstVoucherCandidate({rpc:pinned,simulateIssuer:false});
 check(candidate.blockNumber===dec(head)&&candidate.rpcWriteMethodsCalled===0&&candidate.issueSimulatedWithoutSend===false,'CANDIDATE');
 await atAnchor(rpc,finalized.number);await atAnchor(rpc,head);
 const [latestNonce,pendingNonce,ownerCode,donorCode]=await Promise.all([
  rpc.send('eth_getTransactionCount',[FIXED.issuerAuthority,head]),
  rpc.send('eth_getTransactionCount',[FIXED.issuerAuthority,'pending']),
  rpc.send('eth_getCode',[F.owner,head]),rpc.send('eth_getCode',[F.donor,head])
 ]);
 check(uint(latestNonce)&&uint(pendingNonce)&&BigInt(latestNonce)===0n&&BigInt(pendingNonce)===0n,'NONCE_CHANGED');
 check(ownerCode==='0x'&&donorCode==='0x','APPROVER_EOA');
 if(row){
  for(const prefix of ['finalized','observed']){
   const v=row.value;check(v&&/^[1-9][0-9]*$/.test(v[prefix+'BlockNumber'])&&hash(v[prefix+'BlockHash'])&&/^[1-9][0-9]*$/.test(v[prefix+'BlockTime']),'HISTORICAL_ANCHOR');
   const old=block(await rpc.send('eth_getBlockByNumber',[hex(v[prefix+'BlockNumber']),false]));
   check(dec(old.number)===v[prefix+'BlockNumber']&&old.hash===v[prefix+'BlockHash']&&dec(old.timestamp)===v[prefix+'BlockTime']&&BigInt(old.number)<=BigInt(prefix==='finalized'?finalized.number:head),'HISTORICAL_REORG');
  }
 }
 const finalAgain=block(await rpc.send('eth_getBlockByNumber',[finalized.number,false]));
 const headAgain=block(await rpc.send('eth_getBlockByNumber',[head,false]));
 check(unchanged(finalized,finalAgain)&&unchanged(fresh,headAgain),'ANCHOR_REORG');
 const o={version:'T1F_PHASE8_OBSERVATION_V1',chainId:CHAIN,issuer:FIXED.issuerAuthority,escrow:ESCROW,
 finalizedBlockNumber:dec(finalized.number),finalizedBlockHash:finalized.hash,finalizedBlockTime:Number(BigInt(finalized.timestamp)),finalizedCanonical:true,
 observedBlockNumber:dec(head),observedBlockHash:fresh.hash,observedBlockTime:Number(BigInt(fresh.timestamp)),freshCanonical:true,
 issuerLatestNonce:dec(latestNonce),issuerPendingNonce:dec(pendingNonce),originalOperationSeen:false,predecessorOperationSeen:false,unitAvailable:true,unitIssued:false,unitGeneration:'0',unitSeq:'0',mealId:MEAL,termsHash:TERMS,codeAndAuthorityValid:true,accountingValid:true};
 validateRecoveryObservation({predecessor:F.predecessor,observation:o,now:clock()});
 return Object.freeze(o);
}
