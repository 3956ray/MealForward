/**
 * T1-F Phase 2: successor attempt REVIEW ONLY. No new Claim, wallet transfer,
 * transaction broadcaster, SQL writes, privileged release or reset.
 *
 * The original recipient_claims row is permanently ISSUE_UNKNOWN; 014 can
 * only insert one REVIEW_HOLD slot with all successor tx fields NULL.
 * A PREVIEW of a future operation is NOT sendable and never persisted.
 */
import {keccak256} from 'ethers';
import {CHAIN,ESCROW,MEAL,TERMS,PRICE} from './core.mjs';
import {t0,originalVoucherId,FIXED} from './t1e-first-issue-readiness.mjs';
import {verifyOriginalIssuerReceipt} from './t1f-issue-operation.mjs';
import {assessExpiredOriginalReview} from './t1f-expired-recovery-review.mjs';

export const ORIGINAL_CLAIM='fbab3b22-965d-44e2-b144-d7307b7aa8ea';
export const ORIGINAL_OPERATION='0x2e709dee8113d2dac73cbea53d016d6629fc3730c6f85325a17c98bc4777445b';
export const ORIGINAL_DATA_HASH='0x089cb2b0a35e81f31a9f9a658cd298ad7c9d3376ea01fac6fb77013451e1f0ed';
export const ORIGINAL_DEADLINE=1792765625n;
const HEX32=/^0x[0-9a-f]{64}$/i;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const eq=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const check=(v,msg)=>{if(!v)throw Error(msg)};
const uint=(v)=>{
 try{const n=BigInt(v);check(n>=0n,'T1F_PHASE2_NEGATIVE_VALUE');return n}
 catch{throw Error('T1F_PHASE2_UNSIGNED_VALUE_REQUIRED')}
};
const reservation=(claim)=>{
 check(claim?.claim_id===ORIGINAL_CLAIM&&claim.stage==='ISSUE_UNKNOWN'&&
  uint(claim.revision)===2n&&
  eq(claim.issuer_op_id,ORIGINAL_OPERATION)&&uint(claim.issuer_tx_nonce)===0n&&
  uint(claim.issuer_issue_deadline)===ORIGINAL_DEADLINE&&
  eq(claim.issuer_tx_data_hash,ORIGINAL_DATA_HASH)&&
  claim.issuer_tx_hash==null&&claim.receipt_block==null&&
  claim.receipt_block_hash==null&&
  Number(claim.chain_id)===CHAIN&&eq(claim.escrow,ESCROW)&&
  eq(claim.issuer_wallet,FIXED.issuerAuthority)&&
  Number(claim.unit_seq)===0&&uint(claim.generation)===1n&&
  eq(claim.voucher_id,originalVoucherId(0,1n)),
  'T1F_PHASE2_ORIGINAL_FROZEN_CLAIM_REQUIRED');
};
function reviewSlot(slot,claim,review){
 check(slot?.claim_id===claim.claim_id&&slot.stage==='REVIEW_HOLD'&&
  Number(slot.attempt_sequence)===2&&slot.review_id===review.review_id&&
  UUID.test(slot.attempt_id||'')&&UUID.test(review.review_id||'')&&
  eq(slot.original_operation_id,claim.issuer_op_id)&&
  uint(slot.original_issuer_nonce)===uint(claim.issuer_tx_nonce)&&
  uint(slot.original_deadline)===uint(claim.issuer_issue_deadline)&&
  eq(slot.original_calldata_hash,claim.issuer_tx_data_hash)&&
  slot.successor_operation_id==null&&
  slot.successor_nonce==null&&slot.successor_issue_deadline==null&&
  slot.successor_calldata_hash==null&&slot.successor_tx_hash==null&&
  slot.receipt_block==null&&slot.receipt_block_hash==null&&
  slot.security_release_id==null&&
  slot.may_prepare_wallet_tx===false&&
  slot.may_sign_or_broadcast===false&&
  slot.may_mark_issued===false&&
  slot.legacy_claim_rewrite_allowed===false,
  'T1F_PHASE2_SUCCESSOR_SLOT_MUST_REMAIN_HOLD');
 check(review.claim_id===ORIGINAL_CLAIM&&
  review.review_state==='MANUAL_REVIEW_ONLY_NO_NEW_ISSUE'&&
  review.wallet_observation==='OWNER_REPORTED_NO_TRANSACTIONS_VISIBLE'&&
  review.may_create_second_operation===false&&
  review.may_broadcast_transaction===false&&
  review.may_modify_original_claim===false,
  'T1F_PHASE2_EXPIRED_REVIEW_CANNOT_APPROVE_ISSUE');
}
const held=reason=>Object.freeze({
 status:'T1F_SUCCESSOR_DESIGN_PREVIEW_NO_RELEASE',
 reason,canUseWallet:false,canSign:false,canBroadcast:false,
 newOperationReserved:false,originalClaimPreserved:true,
 newFundsRequired:false,merchantSettlementEnabled:false,
 requiresDistinctOwnerApprovedPhase3:true
});

/**
 * Candidate is supplied from a disposable TEST fixture. NOT generated or
 * emitted in the live app. Hash-only offline calculation, NO raw tx/data.
 */
export function previewSuccessorIssue({
 claim,review,slot,chain,walletObservation,
 candidateOperationId,candidateNonce,candidateDeadline,now
}={}){
 check(Number.isSafeInteger(now)&&now>0,'T1F_PHASE2_VALID_CLOCK_REQUIRED');
 reservation(claim);
 reviewSlot(slot,claim,review);
 const assessed=assessExpiredOriginalReview({
  claim,chain,walletObservation,now
 });
 check(assessed.status==='T1F_REVIEWABLE_OFFLINE_SECURITY_REVIEW_ONLY',
  'T1F_PHASE2_INDEPENDENT_REVIEW_ONLY_REQUIRED');
 check(chain&&chain.chainId===CHAIN&&eq(chain.escrow,ESCROW)&&
  eq(chain.issuer,FIXED.issuerAuthority)&&
  eq(chain.originalOperationId,claim.issuer_op_id)&&
  chain.originalOperationSeen===false&&chain.unitAvailable===true&&
  chain.unitIssued===false&&chain.canIssueOrResetAutomatically===false&&
  chain.noPendingTxProven===false,
  'T1F_PHASE2_FRESH_PINNED_UNIT_READ_REQUIRED');
 check(uint(chain.issuerLatestNonce)===0n&&
  uint(chain.issuerPendingNonce)===0n&&
  uint(review.observed_issuer_latest_nonce)===0n&&
  uint(review.observed_issuer_pending_nonce)===0n&&
  uint(chain.observedBlockNumber)>=uint(review.observed_block_number),
  'T1F_PHASE2_NONCE_OR_REVIEW_HEAD_CHANGED');
 check(HEX32.test(candidateOperationId||'')&&
  !eq(candidateOperationId,ORIGINAL_OPERATION)&&
  !eq(candidateOperationId,'0x'+'0'.repeat(64)),
  'T1F_PHASE2_DISTINCT_SUCCESSOR_OPERATION_REQUIRED');
 check(uint(candidateNonce)===uint(chain.issuerPendingNonce),
  'T1F_PHASE2_CANDIDATE_NONCE_MUST_MATCH_FRESH_READ');
 const expiry=uint(candidateDeadline);
 check(expiry>=BigInt(now+120)&&expiry<=BigInt(now+600),
  'T1F_PHASE2_SHORT_CANDIDATE_DEADLINE_REQUIRED');
 const calldata=t0.encodeFunctionData('issue',[
  candidateOperationId,MEAL,0,1,TERMS,expiry
 ]);
 // There is no tx object, to/nonce/gas payload or send method returned.
 return Object.freeze({
  ...held('Potential second operation is a NON-SENDABLE sketch until new independent approval/migration.'),
  chainId:CHAIN,escrow:ESCROW,
  claimId:ORIGINAL_CLAIM,reviewId:review.review_id,
  successorSlotId:slot.attempt_id,
  candidateOperationId,
  candidateIssuerNonce:uint(candidateNonce).toString(),
  candidateDeadline:expiry.toString(),
  candidateCalldataHash:keccak256(calldata),
  originalOperationId:ORIGINAL_OPERATION,
  originalNonce:claim.issuer_tx_nonce.toString(),
  originalDeadline:ORIGINAL_DEADLINE.toString(),
  voucherId:originalVoucherId(0,1n),
  issuedQuantity:0,
  fundsToTransfer:'0',
  requiresRealtimeRevalidation:true,
  mayPersistProposedFieldsIn014:false
 });
}

/**
 * Safe read-only oracle adapter for a future Phase 3 approved, separately
 * persisted SUCCESSOR transaction. It never writes to either claim/attempt.
 * 014 cannot produce stage HASH_BOUND or security_release_id, so it cannot
 * be reached by a real database row until a distinct approved 015 release.
 *
 * Reuses original hardened receipt verifier after constructing an ephemeral
 * per-attempt projection. The ORIGINAL SQL claim remains ISSUE_UNKNOWN.
 */
export async function verifySuccessorReceiptReadOnly({
 claim,attempt,rpc,now
}={}){
 reservation(claim);
 check(attempt?.claim_id===claim.claim_id&&
  attempt?.stage==='ISSUE_HASH_BOUND'&&
  UUID.test(attempt.security_release_id||'')&&
  eq(attempt.original_operation_id,claim.issuer_op_id)&&
  uint(attempt.original_issuer_nonce)===uint(claim.issuer_tx_nonce)&&
  uint(attempt.original_deadline)===uint(claim.issuer_issue_deadline)&&
  eq(attempt.original_calldata_hash,claim.issuer_tx_data_hash)&&
  HEX32.test(attempt.successor_operation_id||'')&&
  !eq(attempt.successor_operation_id,ORIGINAL_OPERATION)&&
  uint(attempt.successor_nonce)>=0n&&
  uint(attempt.successor_issue_deadline)>ORIGINAL_DEADLINE&&
  HEX32.test(attempt.successor_calldata_hash||'')&&
  HEX32.test(attempt.successor_tx_hash||'')&&
  attempt.legacy_claim_rewrite_allowed===false,
  'T1F_PHASE3_APPROVED_BOUND_SUCCESSOR_REQUIRED');
 const data=t0.encodeFunctionData('issue',[
  attempt.successor_operation_id,MEAL,0,1,TERMS,
  uint(attempt.successor_issue_deadline)
 ]);
 check(eq(keccak256(data),attempt.successor_calldata_hash),
  'T1F_PHASE3_IMMUTABLE_SUCCESSOR_BYTES_REQUIRED');
 check(rpc&&typeof rpc.send==='function',
  'T1F_PHASE3_READONLY_RPC_REQUIRED');
 const projected=Object.freeze({
  ...claim,stage:'ISSUE_HASH_BOUND',
  issuer_op_id:attempt.successor_operation_id,
  issuer_tx_nonce:attempt.successor_nonce,
  issuer_issue_deadline:attempt.successor_issue_deadline,
  issuer_tx_data_hash:attempt.successor_calldata_hash,
  issuer_tx_hash:attempt.successor_tx_hash
 });
 const proof=await verifyOriginalIssuerReceipt({claim:projected,rpc,now});
 if(proof.status!=='T1F_ORIGINAL_ISSUED_RECEIPT_INDEPENDENTLY_CONFIRMED')
  return Object.freeze({
   status:'T1F_SUCCESSOR_NOT_ISSUED_DO_NOT_RESEND',
   originalClaimStage:'ISSUE_UNKNOWN',successorAttemptStatus:proof.status,
   automaticRetryAllowed:false
  });
 check(eq(proof.operationId,attempt.successor_operation_id)&&
  eq(proof.originalTxHash,attempt.successor_tx_hash)&&
  eq(proof.voucherId,claim.voucher_id),
  'T1F_PHASE3_SUCCESSOR_RECEIPT_CROSSCHECK_FAILED');
 return Object.freeze({
  ...held('Receipt was independently observed; Phase 3 database projection remains a separate reviewed operation.'),
  status:'T1F_SUCCESSOR_RECEIPT_VERIFIED_SOURCE_ONLY',
  originalClaimStage:'ISSUE_UNKNOWN',
  originalOperationId:ORIGINAL_OPERATION,
  successorAttemptId:attempt.attempt_id,
  successorOperationId:attempt.successor_operation_id,
  successorTxHash:proof.originalTxHash,
  voucherId:proof.voucherId,
  blockNumber:proof.blockNumber,blockHash:proof.blockHash,
  fundsStillEscrowed:proof.escrowBaseUnits,
  neverWriteOriginalClaim:true
 });
}
