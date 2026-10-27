/** Bounded child of one expired Phase7 reservation. Pure policy: no persistence,
 * wallet access, transaction packet output, automatic send or absence proof.
 * Trusted observation flags must be produced by the server's pinned RPC probe,
 * never supplied by an HTTP caller. All old rows remain immutable.
 */
import {TypedDataEncoder,verifyTypedData,keccak256} from 'ethers';
import {CHAIN,ESCROW,MEAL,TERMS,QUOTE} from './core.mjs';
import {FIXED,t0,originalVoucherId} from './t1e-first-issue-readiness.mjs';
import {ORIGINAL_CLAIM,ORIGINAL_OPERATION,ORIGINAL_DATA_HASH,ORIGINAL_DEADLINE} from './t1f-successor-issue-protocol.mjs';
const check=(ok,c)=>{if(!ok)throw Error('T1F_PHASE8_'+c)};
const hash=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v)&&v!=='0x'+'0'.repeat(64);
const dec=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,15})$/.test(v);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.slice().sort().join();
const time=v=>Number.isSafeInteger(v)&&v>0;
const oldOp='0xa26a490285c09acf65c4970a05c69574bc1502e6d92e8e1538b7da84ef21443b';
const oldDeadline=1793079867;
const data=(op,deadline)=>t0.encodeFunctionData('issue',[op,MEAL,0,1,TERMS,deadline]);
export const PHASE8_FIXED=Object.freeze({
 claimId:ORIGINAL_CLAIM,reviewId:'bc78fcf5-a76c-4301-b0c3-5fcd37411d30',slotId:'e197f0cb-412e-4412-b8d5-9c15059e21e7',
 issuer:FIXED.issuerAuthority,owner:FIXED.owner,donor:QUOTE,escrow:ESCROW,mealId:MEAL,termsHash:TERMS,voucherId:originalVoucherId(0,1n),
 originalOperationId:ORIGINAL_OPERATION,originalDeadline:String(ORIGINAL_DEADLINE),originalDataHash:ORIGINAL_DATA_HASH,
 predecessorRoundId:'cb9ca0dc-d466-4a6f-83e1-53b0d50f07c0',predecessorDigest:'0xebcf24ea5e1738f09e0093881e7058b55e660c45a815d597c9b16a7dde72ad58',
 predecessor:Object.freeze({successor_id:'8872119f-8c4c-4f0d-8c3a-10c841f1018f',operation_id:oldOp,issuer_nonce:0,issuer_issue_deadline:oldDeadline,calldata_hash:keccak256(data(oldOp,oldDeadline)),stage:'ISSUE_UNKNOWN',tx_hash:null,revision:0})
});
export const PHASE8_WALLET_OBSERVATION='ISSUER_REPORTED_NO_PENDING_OR_SENT_TRANSACTIONS';
export const PHASE8_OBSERVATION_KEYS=Object.freeze(['version','chainId','issuer','escrow','finalizedBlockNumber','finalizedBlockHash','finalizedBlockTime','finalizedCanonical','observedBlockNumber','observedBlockHash','observedBlockTime','freshCanonical','issuerLatestNonce','issuerPendingNonce','originalOperationSeen','predecessorOperationSeen','unitAvailable','unitIssued','unitGeneration','unitSeq','mealId','termsHash','codeAndAuthorityValid','accountingValid']);
export const PHASE8_DOMAIN=Object.freeze({name:'MealForward T1F Recovery',version:'2',chainId:CHAIN,verifyingContract:ESCROW});
const field=(name,type)=>Object.freeze({name,type});
export const PHASE8_TYPES=Object.freeze({RecoveryChildIssueRelease:Object.freeze([
 field('claimId','string'),field('reviewId','string'),field('slotId','string'),field('voucherId','bytes32'),
 field('originalOpId','bytes32'),field('originalNonce','uint256'),field('originalDeadline','uint256'),field('originalDataHash','bytes32'),
 field('predecessorId','string'),field('predecessorOpId','bytes32'),field('predecessorNonce','uint256'),field('predecessorDeadline','uint256'),field('predecessorDataHash','bytes32'),field('predecessorRoundId','string'),field('predecessorDigest','bytes32'),
 field('newOpId','bytes32'),field('newNonce','uint256'),field('newDeadline','uint256'),field('nonceDomain','bytes32'),
 field('finalizedBlockNumber','uint256'),field('finalizedBlockHash','bytes32'),field('finalizedBlockTime','uint256'),
 field('observedBlockNumber','uint256'),field('observedBlockHash','bytes32'),field('observedBlockTime','uint256'),field('approvalExpiresAt','uint256')
])});
const domainFields=Object.freeze([field('name','string'),field('version','string'),field('chainId','uint256'),field('verifyingContract','address')]);
export function validateRecoveryPredecessor(p){
 check(p&&typeof p==='object'&&!Array.isArray(p),'PREDECESSOR');
 for(const [k,v] of Object.entries(PHASE8_FIXED.predecessor))check(p[k]===v,'PREDECESSOR');
 // Real DB projections may contain more immutable columns. If present they must agree.
 for(const [k,v] of Object.entries({claim_id:PHASE8_FIXED.claimId,slot_id:PHASE8_FIXED.slotId,voucher_id:PHASE8_FIXED.voucherId,issuer_wallet:PHASE8_FIXED.issuer,escrow:ESCROW,chain_id:CHAIN,receipt_block:null,receipt_block_hash:null}))if(Object.hasOwn(p,k))check(p[k]===v,'PREDECESSOR');
 return p;
}
export function validateRecoveryObservation({predecessor,observation:o,now}={}){
 check(time(now),'CLOCK');validateRecoveryPredecessor(predecessor);
 check(exact(o,PHASE8_OBSERVATION_KEYS)&&o.version==='T1F_PHASE8_OBSERVATION_V1'&&o.chainId===CHAIN&&o.issuer===PHASE8_FIXED.issuer&&o.escrow===ESCROW,'OBSERVATION');
 check(dec(o.finalizedBlockNumber)&&BigInt(o.finalizedBlockNumber)>0n&&dec(o.observedBlockNumber)&&BigInt(o.observedBlockNumber)>=BigInt(o.finalizedBlockNumber)&&hash(o.finalizedBlockHash)&&hash(o.observedBlockHash)&&o.finalizedCanonical===true&&o.freshCanonical===true,'CANONICAL');
 check(o.finalizedBlockNumber!==o.observedBlockNumber||(o.finalizedBlockHash===o.observedBlockHash&&o.finalizedBlockTime===o.observedBlockTime),'ANCHOR_CONFLICT');
 check(time(o.finalizedBlockTime)&&o.finalizedBlockTime>=oldDeadline&&time(o.observedBlockTime)&&o.observedBlockTime>=o.finalizedBlockTime&&o.observedBlockTime<=now&&now-o.observedBlockTime<=120,'EXPIRY_ANCHOR');
 check(o.issuerLatestNonce==='0'&&o.issuerPendingNonce==='0'&&o.originalOperationSeen===false&&o.predecessorOperationSeen===false&&o.unitAvailable===true&&o.unitIssued===false&&o.unitGeneration==='0'&&o.unitSeq==='0'&&o.mealId===MEAL&&o.termsHash===TERMS&&o.codeAndAuthorityValid===true&&o.accountingValid===true,'CHAIN_ACTIVITY');
 return Object.freeze({status:'ELIGIBLE_FOR_FRESH_DUAL_APPROVAL',noPendingTxProven:false,walletReportIsChainProof:false,mayBroadcast:false,originalRecordsPreserved:true});
}
export function assessRecovery({predecessor,observation,walletObservation:w,now}={}){
 const summary=validateRecoveryObservation({predecessor,observation,now});
 check(exact(w,['value','observedAt'])&&w.value===PHASE8_WALLET_OBSERVATION&&time(w.observedAt)&&w.observedAt<=now&&now-w.observedAt<=120,'WALLET_REPORT');
 return summary;
}
function pinnedValue(){const f=PHASE8_FIXED,p=f.predecessor;return {claimId:f.claimId,reviewId:f.reviewId,slotId:f.slotId,voucherId:f.voucherId,originalOpId:ORIGINAL_OPERATION,originalNonce:'0',originalDeadline:String(ORIGINAL_DEADLINE),originalDataHash:ORIGINAL_DATA_HASH,predecessorId:p.successor_id,predecessorOpId:p.operation_id,predecessorNonce:'0',predecessorDeadline:String(p.issuer_issue_deadline),predecessorDataHash:p.calldata_hash,predecessorRoundId:f.predecessorRoundId,predecessorDigest:f.predecessorDigest};}
function manifest(value,created){
 check(time(created),'CREATION');
 check(exact(value,PHASE8_TYPES.RecoveryChildIssueRelease.map(f=>f.name)),'VALUE_SCHEMA');
 for(const {name,type} of PHASE8_TYPES.RecoveryChildIssueRelease)check(type==='uint256'?dec(value[name]):type==='bytes32'?hash(value[name]):typeof value[name]==='string','VALUE_CANONICAL');
 for(const [k,v] of Object.entries(pinnedValue()))check(value[k]===v,'VALUE_PIN');
 check(value.newNonce==='0'&&value.newDeadline===String(created+480)&&value.approvalExpiresAt===String(created+300),'WINDOW');
 check(value.newOpId!==ORIGINAL_OPERATION&&value.newOpId!==oldOp,'OPERATION_REUSE');
 check(BigInt(value.finalizedBlockNumber)>0n&&BigInt(value.observedBlockNumber)>=BigInt(value.finalizedBlockNumber)&&BigInt(value.finalizedBlockTime)>=BigInt(oldDeadline)&&BigInt(value.observedBlockTime)>=BigInt(value.finalizedBlockTime)&&BigInt(value.observedBlockTime)<=BigInt(created)&&BigInt(created)-BigInt(value.observedBlockTime)<=120n,'VALUE_ANCHOR');
 check(value.finalizedBlockNumber!==value.observedBlockNumber||(value.finalizedBlockHash===value.observedBlockHash&&value.finalizedBlockTime===value.observedBlockTime),'VALUE_ANCHOR_CONFLICT');
 return Object.freeze({domain:PHASE8_DOMAIN,types:PHASE8_TYPES,value:Object.freeze({...value}),digest:TypedDataEncoder.hash(PHASE8_DOMAIN,PHASE8_TYPES,value),candidateCalldataHash:keccak256(data(value.newOpId,value.newDeadline)),prepareBefore:created+210,sendBefore:created+210});
}
export function buildRecoveryManifest({predecessor,observation,walletObservation,now,newOpId,nonceDomain}={}){
 assessRecovery({predecessor,observation,walletObservation,now});
 const o=observation;
 return manifest({...pinnedValue(),newOpId,newNonce:'0',newDeadline:String(now+480),nonceDomain,finalizedBlockNumber:o.finalizedBlockNumber,finalizedBlockHash:o.finalizedBlockHash,finalizedBlockTime:String(o.finalizedBlockTime),observedBlockNumber:o.observedBlockNumber,observedBlockHash:o.observedBlockHash,observedBlockTime:String(o.observedBlockTime),approvalExpiresAt:String(now+300)},now);
}
/** Stored reconstruction checks shape/history only; it is never a live chain assessment. */
export function reconstructRecoveryManifest({row,predecessor,now,allowExpired=false}={}){
 check(time(now),'CLOCK');validateRecoveryPredecessor(predecessor);
 check(row&&time(row.created_at_epoch)&&row.created_at_epoch<=now,'CREATION');
 const m=manifest(row.value,row.created_at_epoch);
 check(row.digest===m.digest&&row.candidate_calldata_hash===m.candidateCalldataHash,'STORED_HASH');
 if(!allowExpired)check(now<Number(m.value.approvalExpiresAt),'EXPIRED');
 return m;
}
function checkedManifest(m){
 check(m?.value&&dec(m.value.approvalExpiresAt),'MANIFEST');
 const expected=manifest(m.value,Number(m.value.approvalExpiresAt)-300);
 check(m.digest===expected.digest&&m.candidateCalldataHash===expected.candidateCalldataHash&&JSON.stringify(m.domain)===JSON.stringify(PHASE8_DOMAIN)&&JSON.stringify(m.types)===JSON.stringify(PHASE8_TYPES),'MANIFEST');
 return expected;
}
export function recoveryTypedData(m){const x=checkedManifest(m);return {domain:x.domain,types:{EIP712Domain:domainFields,...x.types},primaryType:'RecoveryChildIssueRelease',message:x.value};}
export function recoverRecoveryApproval({manifest:m,signature}={}){
 const x=checkedManifest(m);check(typeof signature==='string'&&/^0x[0-9a-fA-F]{130}$/.test(signature),'SIGNATURE');
 try{return {wallet:verifyTypedData(PHASE8_DOMAIN,PHASE8_TYPES,x.value,signature).toLowerCase(),fingerprint:keccak256(signature)}}catch{throw Error('T1F_PHASE8_SIGNATURE')}
}
export function verifyRecoveryApproval({manifest,role,signature}={}){
 check(role==='owner'||role==='donor','ROLE');const r=recoverRecoveryApproval({manifest,signature});check(r.wallet===PHASE8_FIXED[role],'SIGNER');return {role,...r};
}
