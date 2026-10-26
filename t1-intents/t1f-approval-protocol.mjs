import {validateConsumption} from './t1f-execution-contract.mjs';
/** Formal Recovery approvals only. This module cannot release or prepare Issue. */
import {verifyTypedData,keccak256} from 'ethers';
import {CHAIN,ESCROW} from './core.mjs';
import {FIXED} from './t1e-first-issue-readiness.mjs';
import {ORIGINAL_OPERATION,ORIGINAL_DEADLINE} from './t1f-successor-issue-protocol.mjs';
import {buildSuccessorReleaseManifest,T1F_RELEASE_DOMAIN,T1F_RELEASE_TYPES,T1F_RELEASE_OWNER,T1F_RELEASE_DONOR} from './t1f-successor-dual-approval.mjs';
export const APPROVAL_WALLETS=Object.freeze({owner:T1F_RELEASE_OWNER,donor:T1F_RELEASE_DONOR});
export const WALLET_OBSERVATION='OWNER_REPORTED_NO_TRANSACTIONS_VISIBLE';
export const DOMAIN_FIELDS=Object.freeze([{name:'name',type:'string'},{name:'version',type:'string'},{name:'chainId',type:'uint256'},{name:'verifyingContract',type:'address'}]);
export const requireApproval=(ok,code='INVALID')=>{if(!ok)throw Error('T1F_APPROVAL_'+code)};
export const exactKeys=(obj,keys)=>!!obj&&typeof obj==='object'&&!Array.isArray(obj)&&Object.keys(obj).sort().join(',')===[...keys].sort().join(',');
const H32=/^0x[0-9a-f]{64}$/,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const validRoundId=x=>typeof x==='string'&&UUID.test(x);
/** Reconstruction evidence is NOT a live observation; the service separately reobserves chain. */
function historicalStructure(row){return {
 status:'T1F_EXPIRED_NO_ISSUE_OBSERVED_NOT_ABSENCE_PROOF',chainId:CHAIN,escrow:ESCROW,
 issuer:FIXED.issuerAuthority,originalOperationId:ORIGINAL_OPERATION,
 reservedOriginalNonce:'0',originalImmutableDeadline:String(ORIGINAL_DEADLINE),
 observedBlockNumber:row.value.observedBlockNumber,observedBlockHash:row.value.observedBlockHash,
 observedBlockTime:Number(row.observed_block_time),issuerLatestNonce:'0',issuerPendingNonce:'0',
 originalOperationSeen:false,unitAvailable:true,unitIssued:false,issuerTransactionHashFound:false,
 noPendingTxProven:false,userWalletActivityMustBeChecked:true,canIssueOrResetAutomatically:false
 };}
export function reconstructApproval({row,context,now,allowExpired=false}){
 requireApproval(Number.isSafeInteger(now)&&now>0,'CLOCK');
 requireApproval(validRoundId(row?.round_id)&&exactKeys(row.value,T1F_RELEASE_TYPES.SuccessorIssueRelease.map(x=>x.name)),'ROW');
 const v=row.value,created=Number(row.created_at_epoch),observed=Number(row.observed_block_time);
 requireApproval(Number.isSafeInteger(created)&&created>0&&created<=now&&Number.isSafeInteger(observed)&&observed<=created&&observed>=created-120,'CREATION_TIME');
 for(const {name,type} of T1F_RELEASE_TYPES.SuccessorIssueRelease){
  requireApproval(typeof v[name]==='string','CANONICAL_VALUE');
  if(type==='uint256')requireApproval(/^(0|[1-9][0-9]{0,15})$/.test(v[name]),'CANONICAL_UINT');
  if(type==='bytes32')requireApproval(H32.test(v[name])&&v[name]!=='0x'+'0'.repeat(64),'CANONICAL_BYTES');
 }
 requireApproval(v.approvalExpiresAt===String(created+300)&&v.newDeadline===String(created+480),'WINDOW');
 const m=buildSuccessorReleaseManifest({...context,chain:historicalStructure(row),walletObservation:WALLET_OBSERVATION,
  candidateOperationId:v.newOpId,candidateNonce:v.newNonce,candidateDeadline:v.newDeadline,
  nonceDomain:v.nonceDomain,approvalExpiresAt:v.approvalExpiresAt,now:created});
 requireApproval(Object.keys(m.value).every(k=>m.value[k]===v[k])&&m.digest===row.digest&&m.candidateCalldataHash===row.candidate_calldata_hash,'HASH_OR_CONTEXT');
 if(!allowExpired)requireApproval(now<Number(v.approvalExpiresAt),'EXPIRED');
 return m;
}
export function approvalTypedData(manifest){return {
 domain:{...T1F_RELEASE_DOMAIN},types:{EIP712Domain:DOMAIN_FIELDS,SuccessorIssueRelease:T1F_RELEASE_TYPES.SuccessorIssueRelease},
 primaryType:'SuccessorIssueRelease',message:{...manifest.value}
 };}
/** Generic crypto primitive, not an authorization decision. */
export function recoverApproval({manifest,signature}){
 requireApproval(typeof signature==='string'&&/^0x[0-9a-f]{130}$/i.test(signature),'SIGNATURE');
 try{return {wallet:verifyTypedData(T1F_RELEASE_DOMAIN,T1F_RELEASE_TYPES,manifest.value,signature).toLowerCase(),fingerprint:keccak256(signature)}}
 catch{throw Error('T1F_APPROVAL_SIGNATURE')}
}
export function verifyApprovalRole({manifest,role,signature}){
 requireApproval(Object.hasOwn(APPROVAL_WALLETS,role),'ROLE');
 const recovered=recoverApproval({manifest,signature});
 requireApproval(recovered.wallet===APPROVAL_WALLETS[role],'SIGNER');
 return {role,...recovered};
}
export function collectorConsumption(row,context){
 const c=context?.consumption,r=row?.consumption;
 if(context&&Object.hasOwn(context,'consumption'))validateConsumption(c,{context});
 if(row&&Object.hasOwn(row,'consumption'))validateConsumption(r,{round:row,context});
 if(r)requireApproval(!!c&&Object.keys(r).every(k=>r[k]===c[k]),'CONSUMPTION_CONTEXT');
 if(c&&row?.round_id===c.round_id){validateConsumption(c,{round:row,context});return c;}
 return null;
}
export function publicApproval({row,context,now}){
 const base={noRelease:true,canIssue:false,chainId:CHAIN,wallets:APPROVAL_WALLETS,roles:{owner:false,donor:false},serverTime:now};
 const consumption=collectorConsumption(row,context);
 if(!row){requireApproval(!context?.consumption,'CONSUMPTION_ROUND');return {...base,status:'NO_ROUND',round:null};}
 const m=reconstructApproval({row,context,now,allowExpired:true});
 requireApproval(Array.isArray(row.approvals)&&row.approvals.length<=2,'APPROVAL_ROWS');
 for(const a of row.approvals){
  requireApproval(Object.hasOwn(APPROVAL_WALLETS,a.role)&&a.wallet===APPROVAL_WALLETS[a.role]&&!base.roles[a.role]&&H32.test(a.fingerprint),'APPROVAL_ROW');
  base.roles[a.role]=true;
 }
 if(consumption)requireApproval(base.roles.owner&&base.roles.donor,'CONSUMPTION_APPROVALS');
 const expired=now>=Number(m.value.approvalExpiresAt);
 return {...base,...(consumption?{consumption}:{}),status:consumption?'CONSUMED_NO_RELEASE':expired?'EXPIRED':base.roles.owner&&base.roles.donor?'COLLECTED_NO_RELEASE':'COLLECTING',
  round:{id:row.round_id,digest:m.digest,expiresAt:Number(m.value.approvalExpiresAt),typedData:approvalTypedData(m)}};
}
