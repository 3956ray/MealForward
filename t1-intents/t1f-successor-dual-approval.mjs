/**
 * Source-only T1-F Phase 3 EIP-712 dual release. NO wallet key, signer or
 * transaction broadcaster in the server. Owner + original Donor/Quote must
 * independently sign THE SAME pinned, fresh, one-Unit recovery manifest.
 *
 * A valid manifest is an OFFCHAIN SECURITY APPROVAL, NOT authorization to
 * apply 015 to real Supabase or send issue() from MetaMask. The DB release
 * stores ONLY verified typed digest and signature fingerprints.
 */
import {TypedDataEncoder,verifyTypedData,keccak256} from 'ethers';
import {CHAIN,ESCROW,QUOTE} from './core.mjs';
import {FIXED} from './t1e-first-issue-readiness.mjs';
import {
 previewSuccessorIssue,ORIGINAL_CLAIM,ORIGINAL_OPERATION,
 ORIGINAL_DATA_HASH,ORIGINAL_DEADLINE
} from './t1f-successor-issue-protocol.mjs';

const verify=(v,err)=>{if(!v)throw Error(err)};
const HEX32=/^0x[0-9a-f]{64}$/i, HEX_SIG=/^0x[0-9a-f]{130}$/i;
const ZERO='0x'+'0'.repeat(64);
const eq=(a,b)=>typeof a==='string'&&typeof b==='string'&&
 a.toLowerCase()===b.toLowerCase();
const u=x=>{try{
 const n=BigInt(x);verify(n>=0n,'T1F_RELEASE_UINT_REQUIRED');return n
}catch{throw Error('T1F_RELEASE_UINT_REQUIRED')}};
export const T1F_RELEASE_DOMAIN=Object.freeze({
 name:'MealForward T1F Recovery',version:'1',chainId:CHAIN,
 verifyingContract:ESCROW
});
export const T1F_RELEASE_TYPES=Object.freeze({
 SuccessorIssueRelease:Object.freeze([
  {name:'claimId',type:'string'},
  {name:'reviewId',type:'string'},
  {name:'slotId',type:'string'},
  {name:'voucherId',type:'bytes32'},
  {name:'originalOpId',type:'bytes32'},
  {name:'originalNonce',type:'uint256'},
  {name:'originalDeadline',type:'uint256'},
  {name:'originalDataHash',type:'bytes32'},
  {name:'newOpId',type:'bytes32'},
  {name:'newNonce',type:'uint256'},
  {name:'newDeadline',type:'uint256'},
  {name:'nonceDomain',type:'bytes32'},
  {name:'observedBlockNumber',type:'uint256'},
  {name:'observedBlockHash',type:'bytes32'},
  {name:'approvalExpiresAt',type:'uint256'}
 ])
});
export const T1F_RELEASE_OWNER=FIXED.owner;
export const T1F_RELEASE_DONOR=QUOTE;

export function buildSuccessorReleaseManifest({
 claim,review,slot,chain,walletObservation,nonceDomain,
 candidateOperationId,candidateNonce,candidateDeadline,
 approvalExpiresAt,now
}={}){
 verify(Number.isSafeInteger(now)&&now>0,'T1F_RELEASE_CLOCK_REQUIRED');
 const candidate=previewSuccessorIssue({
  claim,review,slot,chain,walletObservation,
  candidateOperationId,candidateNonce,candidateDeadline,now
 });
 verify(candidate.canBroadcast===false&&candidate.newOperationReserved===false,
  'T1F_RELEASE_CANNOT_BECOME_WALLET_OPERATION');
 verify(HEX32.test(nonceDomain||'')&&!eq(nonceDomain,ZERO),
  'T1F_RELEASE_UNIQUE_NONCE_DOMAIN_REQUIRED');
 verify(chain&&Number.isSafeInteger(chain.observedBlockTime)&&
  chain.observedBlockTime<=now&&now-chain.observedBlockTime<=120,
  'T1F_RELEASE_FRESH_CANONICAL_BLOCK_REQUIRED');
 const expiry=u(approvalExpiresAt);
 verify(expiry>=BigInt(now+90)&&
  expiry<=BigInt(now+300)&&
  expiry<=u(candidateDeadline),
  'T1F_RELEASE_SHORT_APPROVAL_WINDOW_REQUIRED');
 const value=Object.freeze({
  claimId:ORIGINAL_CLAIM,
  reviewId:review.review_id,slotId:slot.attempt_id,
  voucherId:candidate.voucherId,
  originalOpId:ORIGINAL_OPERATION,
  originalNonce:'0',
  originalDeadline:ORIGINAL_DEADLINE.toString(),
  originalDataHash:ORIGINAL_DATA_HASH,
  newOpId:candidate.candidateOperationId,
  newNonce:candidate.candidateIssuerNonce,
  newDeadline:candidate.candidateDeadline,
  nonceDomain,
  observedBlockNumber:String(chain.observedBlockNumber),
  observedBlockHash:chain.observedBlockHash,
  approvalExpiresAt:expiry.toString()
 });
 const digest=TypedDataEncoder.hash(T1F_RELEASE_DOMAIN,T1F_RELEASE_TYPES,value);
 return Object.freeze({
  domain:T1F_RELEASE_DOMAIN,types:T1F_RELEASE_TYPES,value,
  digest,candidateCalldataHash:candidate.candidateCalldataHash,
  newIssueAuthorized:false,noWalletTransaction:true,
  isOffchainReviewOnly:true
 });
}

function checkManifest({manifest,now}){
 verify(manifest?.domain?.name===T1F_RELEASE_DOMAIN.name&&
  manifest.domain.chainId===CHAIN&&
  eq(manifest.domain.verifyingContract,ESCROW)&&
  manifest.domain.version==='1'&&
  manifest.types===T1F_RELEASE_TYPES&&
  manifest.value?.claimId===ORIGINAL_CLAIM&&
  eq(manifest.value.originalOpId,ORIGINAL_OPERATION)&&
  u(manifest.value.originalNonce)===0n&&
  u(manifest.value.originalDeadline)===ORIGINAL_DEADLINE&&
  eq(manifest.value.originalDataHash,ORIGINAL_DATA_HASH)&&
  !eq(manifest.value.newOpId,ORIGINAL_OPERATION)&&
  HEX32.test(manifest.value.newOpId||'')&&
  HEX32.test(manifest.value.nonceDomain||'')&&
  HEX32.test(manifest.value.observedBlockHash||'')&&
  u(manifest.value.approvalExpiresAt)>BigInt(now)&&
  u(manifest.value.approvalExpiresAt)<=BigInt(now+300)&&
  u(manifest.value.newDeadline)>BigInt(now+90),
  'T1F_RELEASE_MANIFEST_PINNING_OR_EXPIRY_FAILED');
 const recomputed=TypedDataEncoder.hash(
  T1F_RELEASE_DOMAIN,T1F_RELEASE_TYPES,manifest.value
 );
 verify(eq(recomputed,manifest.digest),
  'T1F_RELEASE_MANIFEST_DIGEST_CHANGED');
}

/**
 * For ephemeral CI fixture addresses only, signers are caller supplied.
 * NEVER use this function as the authority gate in HTTP/live runtime;
 * only verifyPinnedSuccessorRelease binds production owner and donor.
 */
export function verifyDualSignaturesForTest({
 manifest,ownerSignature,donorSignature,expectedOwner,expectedDonor,now
}={}){
 verify(Number.isSafeInteger(now)&&now>0,'T1F_RELEASE_CLOCK_REQUIRED');
 checkManifest({manifest,now});
 verify(HEX_SIG.test(ownerSignature||'')&&HEX_SIG.test(donorSignature||''),
  'T1F_RELEASE_TWO_WALLET_SIGNATURES_REQUIRED');
 verify(typeof expectedOwner==='string'&&typeof expectedDonor==='string'&&
  /^0x[0-9a-f]{40}$/i.test(expectedOwner)&&
  /^0x[0-9a-f]{40}$/i.test(expectedDonor)&&
  !eq(expectedOwner,expectedDonor),
  'T1F_RELEASE_DISTINCT_ROLES_REQUIRED');
 let owner,donor;
 try{
  owner=verifyTypedData(
   T1F_RELEASE_DOMAIN,T1F_RELEASE_TYPES,manifest.value,ownerSignature
  );
  donor=verifyTypedData(
   T1F_RELEASE_DOMAIN,T1F_RELEASE_TYPES,manifest.value,donorSignature
  );
 }catch{throw Error('T1F_RELEASE_SIGNATURE_RECOVERY_FAILED')}
 verify(eq(owner,expectedOwner)&&eq(donor,expectedDonor)&&
  !eq(owner,FIXED.issuerAuthority)&&
  !eq(donor,FIXED.issuerAuthority),
  'T1F_RELEASE_OWNER_DONOR_SIGNATURES_INVALID');
 return Object.freeze({
  status:'T1F_DUAL_EIP712_SIGNATURES_VERIFIED_OFFCHAIN_ONLY',
  digest:manifest.digest,
  ownerWallet:owner.toLowerCase(),
  donorWallet:donor.toLowerCase(),
  ownerSignatureFingerprint:keccak256(ownerSignature),
  donorSignatureFingerprint:keccak256(donorSignature),
  candidateOperationId:manifest.value.newOpId,
  candidateNonce:manifest.value.newNonce,
  candidateDeadline:manifest.value.newDeadline,
  observedBlockNumber:manifest.value.observedBlockNumber,
  observedBlockHash:manifest.value.observedBlockHash,
  approvalExpiresAt:manifest.value.approvalExpiresAt,
  nonceDomain:manifest.value.nonceDomain,
  newIssueAuthorized:false,
  rawSignaturesStored:false,
  canBroadcast:false
 });
}
export function verifyPinnedSuccessorRelease(args){
 return verifyDualSignaturesForTest({
  ...args,expectedOwner:T1F_RELEASE_OWNER,
  expectedDonor:T1F_RELEASE_DONOR
 });
}
