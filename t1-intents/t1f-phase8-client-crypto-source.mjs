/** Browser-only V2 verifier. Build injects public protocol constants, never server modules. */
import {TypedDataEncoder,verifyTypedData,keccak256,Interface} from 'ethers';
import {validateExecution} from './public/t1f-execution-controller.mjs';
const {fixed:F,domain:DOMAIN,types:TYPES}=__PHASE8_CONFIG__;
export const PHASE8_WALLETS=Object.freeze({owner:F.owner,donor:F.donor,issuer:F.issuer});
const check=x=>{if(!x)throw Error('PHASE8_VALIDATION_FAILED')};
const exact=(x,k)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join()===k.slice().sort().join();
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const hash=x=>typeof x==='string'&&/^0x[0-9a-f]{64}$/.test(x)&&x!=='0x'+'0'.repeat(64);
const dec=x=>typeof x==='string'&&/^(0|[1-9][0-9]{0,15})$/.test(x)&&Number.isSafeInteger(Number(x));
const domainFields=[{name:'name',type:'string'},{name:'version',type:'string'},{name:'chainId',type:'uint256'},{name:'verifyingContract',type:'address'}];
const abi=new Interface(['function issue(bytes32 opId,bytes32 mealId,uint8 expectedUnitSeq,uint256 expectedNextGeneration,bytes32 expectedTermsHash,uint256 deadline) returns (bytes32 voucherId)']);
export const hashData=keccak256;
export const hashTypedData=t=>TypedDataEncoder.hash(t.domain,{RecoveryChildIssueRelease:t.types.RecoveryChildIssueRelease},t.message);
export const recoverApproval=(typedData,signature)=>{check(typeof signature==='string'&&/^0x[0-9a-fA-F]{130}$/.test(signature));return verifyTypedData(typedData.domain,{RecoveryChildIssueRelease:typedData.types.RecoveryChildIssueRelease},typedData.message,signature).toLowerCase()};
export const candidateHash=m=>keccak256(abi.encodeFunctionData('issue',[m.newOpId,F.mealId,0,1,F.termsHash,m.newDeadline]));
export function validatePhase8(s,now,{prepare=false}={}){
 check(s&&s.version==='T1F_PHASE8_PUBLIC_V1');
 check(equal(s.predecessor,{id:F.predecessor.successor_id,operationId:F.predecessor.operation_id,deadline:F.predecessor.issuer_issue_deadline,calldataHash:F.predecessor.calldata_hash,roundId:F.predecessorRoundId,digest:F.predecessorDigest,stage:'ISSUE_UNKNOWN',txHash:null}));
 const {version,predecessor,round,...base}=s;
 let strippedRound=null;
 if(round!==null){
  check(exact(round,['id','digest','expiresAt','prepareBefore','candidateDeadline','nonce','roles','typedData']));
  const {typedData:t,...r}=round;strippedRound=r;
  check(exact(t,['domain','types','primaryType','message'])&&equal(t.domain,DOMAIN)&&equal(t.types,{EIP712Domain:domainFields,...TYPES})&&t.primaryType==='RecoveryChildIssueRelease');
  const m=t.message;check(exact(m,TYPES.RecoveryChildIssueRelease.map(f=>f.name)));
  for(const {name,type} of TYPES.RecoveryChildIssueRelease)check(type==='uint256'?dec(m[name]):type==='bytes32'?hash(m[name]):typeof m[name]==='string');
  const pins={claimId:F.claimId,reviewId:F.reviewId,slotId:F.slotId,voucherId:F.voucherId,originalOpId:F.originalOperationId,originalNonce:'0',originalDeadline:F.originalDeadline,originalDataHash:F.originalDataHash,predecessorId:F.predecessor.successor_id,predecessorOpId:F.predecessor.operation_id,predecessorNonce:'0',predecessorDeadline:String(F.predecessor.issuer_issue_deadline),predecessorDataHash:F.predecessor.calldata_hash,predecessorRoundId:F.predecessorRoundId,predecessorDigest:F.predecessorDigest};
  for(const [k,v] of Object.entries(pins))check(m[k]===v);
  const created=Number(m.approvalExpiresAt)-300;
  check(Number.isSafeInteger(created)&&created>0&&created<=now&&m.newNonce==='0'&&r.nonce==='0'&&r.expiresAt===created+300&&r.prepareBefore===created+210&&r.candidateDeadline===created+480&&m.newDeadline===String(r.candidateDeadline));
  check(m.newOpId!==m.originalOpId&&m.newOpId!==m.predecessorOpId&&Number(m.finalizedBlockNumber)>0&&BigInt(m.observedBlockNumber)>=BigInt(m.finalizedBlockNumber)&&Number(m.finalizedBlockTime)>=F.predecessor.issuer_issue_deadline&&Number(m.observedBlockTime)>=Number(m.finalizedBlockTime)&&Number(m.observedBlockTime)<=created&&created-Number(m.observedBlockTime)<=120);
  check(m.finalizedBlockNumber!==m.observedBlockNumber||(m.finalizedBlockHash===m.observedBlockHash&&m.finalizedBlockTime===m.observedBlockTime));
  check(hashTypedData(t)===r.digest);
  if(s.operation){const o=s.operation;check(r.roles.owner===true&&r.roles.donor===true&&o.operationId===m.newOpId&&o.calldataHash===candidateHash(m)&&o.revision===['ISSUE_UNKNOWN','ISSUE_HASH_BOUND','ISSUED'].indexOf(o.stage)&&o.revision>=0);check(o.stage==='ISSUE_UNKNOWN'?o.txHash===null:hash(o.txHash));check(o.stage==='ISSUED'?Number.isSafeInteger(o.receiptBlock)&&o.receiptBlock>0&&hash(o.receiptBlockHash):o.receiptBlock===null&&o.receiptBlockHash===null);}
 }
 validateExecution({...base,round:strippedRound},{now,prepare});
 return s;
}
export function executionDTO(s,now,options){validatePhase8(s,now,options);const {version,predecessor,round,...base}=s;const {typedData,...r}=round||{};return {...base,round:round?r:null};}
