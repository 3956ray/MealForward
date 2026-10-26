/** Dedicated collector: read-only chain probes and immutable approval-store calls only. */
import {randomBytes,randomUUID} from 'node:crypto';
import {firstVoucherCandidate} from './t1e-first-issue-readiness.mjs';
import {inspectExpiredOriginalIssuer} from './t1f-expired-issuer-readonly.mjs';
import {assessExpiredOriginalReview} from './t1f-expired-recovery-review.mjs';
import {buildSuccessorReleaseManifest} from './t1f-successor-dual-approval.mjs';
import {requireApproval as check,exactKeys,reconstructApproval,verifyApprovalRole,publicApproval,validRoundId,WALLET_OBSERVATION,APPROVAL_WALLETS,collectorConsumption} from './t1f-approval-protocol.mjs';
const METHODS=new Set(['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getCode','eth_call','eth_getTransactionReceipt','eth_getTransactionCount']);
const integer=x=>{const n=Number(BigInt(x));check(Number.isSafeInteger(n)&&n>=0,'RPC_INTEGER');return n};
const tag=x=>'0x'+BigInt(x).toString(16);
const h32=x=>typeof x==='string'&&/^0x[0-9a-f]{64}$/.test(x);
/** Fixed public endpoint, one attempt, bounded response; never follows redirects. */
export function makeApprovalPublicRpc({fetchImpl=fetch}={}){
 let nextId=0;
 return {async send(method,params,signal){
  check(METHODS.has(method)&&Array.isArray(params),'RPC_METHOD');
  const id=++nextId;
  const response=await fetchImpl('https://testnet-rpc.monad.xyz',{method:'POST',headers:{'content-type':'application/json'},redirect:'error',signal,body:JSON.stringify({jsonrpc:'2.0',id,method,params})});
  check(response.ok&&response.body,'RPC_HTTP');
  const reader=response.body.getReader();let size=0;const parts=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;check(size<=1048576,'RPC_SIZE');parts.push(Buffer.from(value));}}
  finally{await reader.cancel().catch(()=>{})}
  let data;try{data=JSON.parse(Buffer.concat(parts).toString('utf8'))}catch{throw Error('T1F_APPROVAL_RPC_JSON')}
  check(data?.jsonrpc==='2.0'&&data.id===id&&!data.error&&Object.hasOwn(data,'result'),'RPC_RESPONSE');return data.result;
 }};
}
/** Cancellation also guards continuations when a test/custom transport ignores AbortSignal. */
export function boundedApprovalRpc({rpc,budgetMs=45000,signal}){
 check(typeof rpc?.send==='function'&&Number.isInteger(budgetMs)&&budgetMs>0&&budgetMs<=45000,'RPC_CONFIG');
 const ac=new AbortController();let calls=0,inflight=0,closed=false;
 const end=Date.now()+budgetMs;
 const alive=()=>check(!closed&&!ac.signal.aborted&&!signal?.aborted&&Date.now()<end,'RPC_TIMEOUT');
 const timer=setTimeout(()=>ac.abort(),budgetMs);
 return {check:alive,close(){closed=true;clearTimeout(timer);ac.abort()},rpc:{async send(method,params=[]){
  alive();check(METHODS.has(method)&&Array.isArray(params),'RPC_METHOD');check(++calls<=80&&inflight<8,'RPC_BUDGET');
  inflight++;let timeout;
  const remaining=Math.max(1,Math.min(6000,end-Date.now()));
  try{
   const result=await Promise.race([Promise.resolve().then(()=>{alive();return rpc.send(method,params,ac.signal)}),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('T1F_APPROVAL_RPC_TIMEOUT')),remaining)})]);
   alive();return result;
  }finally{clearTimeout(timeout);inflight--}
 }}};
}
export function validateObservation({chain,row,historical,now}){
 check(Number.isSafeInteger(chain?.observedBlockTime)&&chain.observedBlockTime<=now&&now-chain.observedBlockTime<=120,'STALE_CHAIN');
 check(chain.status==='T1F_EXPIRED_NO_ISSUE_OBSERVED_NOT_ABSENCE_PROOF'&&chain.issuerLatestNonce==='0'&&chain.issuerPendingNonce==='0'&&chain.originalOperationSeen===false&&chain.unitAvailable===true&&chain.unitIssued===false,'CHAIN_ACTIVITY');
 check(h32(chain.observedBlockHash),'CHAIN_BLOCK');
 if(row){
  check(BigInt(chain.observedBlockNumber)>=BigInt(row.value.observedBlockNumber),'CHAIN_BEHIND');
  check(historical&&integer(historical.number)===integer(row.value.observedBlockNumber)&&historical.hash===row.value.observedBlockHash&&integer(historical.timestamp)===Number(row.observed_block_time),'HISTORICAL_REORG');
 }
 return chain;
}
async function observe(rpc,row,now){
 // Pin both independent probes to one new canonical snapshot. Pending nonce remains live.
 const head=await rpc.send('eth_blockNumber',[]);
 const anchor=await rpc.send('eth_getBlockByNumber',[head,false]);
 check(anchor&&integer(anchor.number)===integer(head)&&h32(anchor.hash),'CHAIN_BLOCK');
 const pinned={send(method,params=[]){
  if(method==='eth_blockNumber')return Promise.resolve(head);
  if(method==='eth_getTransactionCount'&&params[1]==='latest')return rpc.send(method,[params[0],head]);
  return rpc.send(method,params);
 }};
 const candidate=await firstVoucherCandidate({rpc:pinned,simulateIssuer:false});
 const chain=await inspectExpiredOriginalIssuer({rpc:pinned});
 check(chain.observedBlockNumber===candidate.blockNumber&&chain.observedBlockHash===anchor.hash,'CHAIN_REORG');
 const block=await rpc.send('eth_getBlockByNumber',[tag(chain.observedBlockNumber),false]);
 check(block?.hash===chain.observedBlockHash&&integer(block.number)===integer(chain.observedBlockNumber),'CHAIN_REORG');
 const full={...chain,observedBlockTime:integer(block.timestamp)};
 const historical=row?await rpc.send('eth_getBlockByNumber',[tag(row.value.observedBlockNumber),false]):null;
 for(const wallet of Object.values(APPROVAL_WALLETS))check(await rpc.send('eth_getCode',[wallet,tag(chain.observedBlockNumber)])==='0x','EOA_REQUIRED');
 const final=await rpc.send('eth_getBlockByNumber',[tag(chain.observedBlockNumber),false]);
 check(final?.hash===chain.observedBlockHash,'CHAIN_REORG');
 return validateObservation({chain:full,row,historical,now:now()});
}
export function makeApprovalService({store,rpc=makeApprovalPublicRpc(),clock=()=>Math.floor(Date.now()/1000),rpcBudgetMs=45000}={}){
 check(['context','current','get','create','record'].every(k=>typeof store?.[k]==='function'),'STORE');
 let busy=false;
 const exclusive=async task=>{check(!busy,'BUSY');busy=true;try{return await task()}finally{busy=false}};
 const dto=async row=>publicApproval({row,context:await store.context(),now:clock()});
 return Object.freeze({
  status:()=>exclusive(async()=>dto(await store.current())),
  createRound:({walletObservation}={})=>exclusive(async()=>{
   const now=clock();
   check(exactKeys(walletObservation,['value','observedAt'])&&walletObservation.value===WALLET_OBSERVATION&&Number.isSafeInteger(walletObservation.observedAt)&&walletObservation.observedAt<=now&&now-walletObservation.observedAt<=120,'WALLET_OBSERVATION');
   const context=await store.context();collectorConsumption(null,context);check(!context.consumption,'CONSUMED');
   const bounded=boundedApprovalRpc({rpc,budgetMs:rpcBudgetMs});
   try{
    const chain=await observe(bounded.rpc,null,clock),createdAt=clock();
    check(createdAt-walletObservation.observedAt<=120,'WALLET_OBSERVATION');
    const freshContext=await store.context();bounded.check();collectorConsumption(null,freshContext);check(!freshContext.consumption,'CONSUMED');
    check(JSON.stringify(context)===JSON.stringify(freshContext),'CONTEXT_CHANGED');
    const manifest=buildSuccessorReleaseManifest({...freshContext,chain,walletObservation:walletObservation.value,nonceDomain:'0x'+randomBytes(32).toString('hex'),candidateOperationId:'0x'+randomBytes(32).toString('hex'),candidateNonce:'0',candidateDeadline:createdAt+480,approvalExpiresAt:createdAt+300,now:createdAt});
    bounded.check();
    // No Promise.race around writes. A transport loss is ambiguous: recover by read only.
    const row=await store.create({roundId:randomUUID(),manifest,createdAt,observedBlockTime:chain.observedBlockTime,beforeExecute:bounded.check});
    return await dto(row);
   }finally{bounded.close()}
  }),
  submit:(body,{signal}={})=>exclusive(async()=>{
   const end=Date.now()+60000;
   const active=()=>check(!signal?.aborted&&Date.now()<end,'REQUEST_ABORTED');
   active();
   check(exactKeys(body,['role','roundId','digest','signature'])&&validRoundId(body.roundId),'SUBMISSION');
   const row=await store.get(body.roundId);check(row?.round_id===body.roundId&&row.digest===body.digest,'ROUND_MISMATCH');
   const context=await store.context();collectorConsumption(row,context);check(!context.consumption,'CONSUMED');
   const manifest=reconstructApproval({row,context,now:clock()});
   const attestation=verifyApprovalRole({manifest,role:body.role,signature:body.signature});
   const bounded=boundedApprovalRpc({rpc,budgetMs:rpcBudgetMs,signal});
   try{
    active();
    const chain=await observe(bounded.rpc,row,clock);
    const freshContext=await store.context();bounded.check();collectorConsumption(null,freshContext);check(!freshContext.consumption,'CONSUMED');
    reconstructApproval({row,context:freshContext,now:clock()});
    check(assessExpiredOriginalReview({...freshContext,chain,walletObservation:WALLET_OBSERVATION,now:clock()}).status==='T1F_REVIEWABLE_OFFLINE_SECURITY_REVIEW_ONLY','CONTEXT_CHANGED');
    bounded.check();
    active();
    const accepted=await store.record({roundId:row.round_id,digest:manifest.digest,...attestation,beforeExecute:()=>{active();bounded.check()}});
    return await dto(accepted);
   }finally{bounded.close()}
  })
 });
}
