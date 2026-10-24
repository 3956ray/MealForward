/**
 * One original expired Issue review policy. Pure, never writes private DB,
 * signs, broadcasts, recreates a voucher, changes EOA nonce or returns tx
 * calldata. The owner's MetaMask activity report is SELF-REPORTED only.
 *
 * A review-ready result authorizes a human SECURITY REVIEW, not a reissue.
 * 013 is REVIEW-ONLY. No later step is implemented in this module.
 */
import {originalVoucherId,FIXED} from './t1e-first-issue-readiness.mjs';
import {CHAIN,ESCROW} from './core.mjs';

const CLAIM='fbab3b22-965d-44e2-b144-d7307b7aa8ea';
const OP='0x2e709dee8113d2dac73cbea53d016d6629fc3730c6f85325a17c98bc4777445b';
const HASH='0x089cb2b0a35e81f31a9f9a658cd298ad7c9d3376ea01fac6fb77013451e1f0ed';
const DEADLINE=1792765625n;
const FIRST_INTENT='2b9ae6f1-2bb7-4096-8136-70f30f302eea';
const H32=/^0x[0-9a-f]{64}$/i;
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const ok=(x,c)=>{if(!x)throw Error(c)};
const b=x=>{try{const v=BigInt(x);ok(v>=0n,'T1F_REVIEW_NONNEGATIVE_INTEGER_REQUIRED');return v}
 catch{throw Error('T1F_REVIEW_NONNEGATIVE_INTEGER_REQUIRED')}};
const stop=(status,reason)=>Object.freeze({
 status,reason,newIssueAuthorized:false,
 mayModifyOriginalClaim:false,mayCreateSecondOperation:false,
 mayBroadcastTransaction:false,originalOperationPreserved:true
});

export function assessExpiredOriginalReview({
 claim,chain,walletObservation,now
}={}){
 ok(Number.isSafeInteger(now)&&now>0,'T1F_REVIEW_SERVER_CLOCK_REQUIRED');
 ok(claim&&claim.claim_id===CLAIM&&
  claim.stage==='ISSUE_UNKNOWN'&&b(claim.revision)===2n&&
  claim.funding_intent===FIRST_INTENT&&
  same(claim.issuer_op_id,OP)&&b(claim.issuer_tx_nonce)===0n&&
  b(claim.issuer_issue_deadline)===DEADLINE&&
  same(claim.issuer_tx_data_hash,HASH)&&
  claim.issuer_tx_hash==null&&claim.receipt_block==null&&
  claim.receipt_block_hash==null&&
  same(claim.voucher_id,originalVoucherId(0,1n))&&
  same(claim.issuer_wallet,FIXED.issuerAuthority)&&
  claim.consent_digest&&H32.test(claim.consent_digest)&&
  claim.consent_signature_fingerprint&&H32.test(claim.consent_signature_fingerprint),
  'T1F_REVIEW_ORIGINAL_IMMUTABLE_CLAIM_REQUIRED');
 ok(BigInt(now)>DEADLINE,'T1F_REVIEW_RESERVATION_NOT_EXPIRED');
 if(walletObservation!=='OWNER_REPORTED_NO_TRANSACTIONS_VISIBLE')
  return stop('T1F_REVIEW_HOLD_OWNER_WALLET_EVIDENCE',
   'Owner must independently inspect MetaMask Activity for the original nonce.');
 ok(chain&&chain.chainId===CHAIN&&same(chain.issuer,FIXED.issuerAuthority)&&
  same(chain.escrow,ESCROW)&&same(chain.originalOperationId,OP)&&
  b(chain.reservedOriginalNonce)===0n&&
  b(chain.originalImmutableDeadline)===DEADLINE&&
  typeof chain.observedBlockHash==='string'&&H32.test(chain.observedBlockHash)&&
  b(chain.observedBlockNumber)>0n&&chain.canIssueOrResetAutomatically===false,
  'T1F_REVIEW_PINNED_READONLY_CHAIN_EVIDENCE_REQUIRED');
 if(chain.originalOperationSeen!==false||chain.unitAvailable!==true||
    chain.unitIssued!==false||
    b(chain.issuerLatestNonce)!==0n||b(chain.issuerPendingNonce)!==0n||
    chain.status!=='T1F_EXPIRED_NO_ISSUE_OBSERVED_NOT_ABSENCE_PROOF')
  return stop('T1F_REVIEW_BLOCKED_CHAIN_ACTIVITY',
   'The original onchain operation, nonce or Unit state needs independent investigation.');
 // No public RPC can establish universal absence from other mempools.
 ok(chain.noPendingTxProven===false&&
  chain.userWalletActivityMustBeChecked===true&&
  chain.issuerTransactionHashFound===false,
  'T1F_REVIEW_NO_ABSENCE_PROOF_CAN_BE_CLAIMED');
 return Object.freeze({
  ...stop('T1F_REVIEWABLE_OFFLINE_SECURITY_REVIEW_ONLY',
   'Only the original expiry and absence of observed activity are supported.'),
  walletObservation:'OWNER_REPORTED_NO_TRANSACTIONS_VISIBLE',
  walletReportIsChainProof:false,
  originalClaimId:CLAIM,originalOperationId:OP,
  originalIssuerNonce:'0',originalDeadline:DEADLINE.toString(),
  originalCalldataHash:HASH,chainId:CHAIN,
  observedBlockNumber:String(chain.observedBlockNumber),
  observedBlockHash:chain.observedBlockHash,
  observedIssuerLatestNonce:String(chain.issuerLatestNonce),
  observedIssuerPendingNonce:String(chain.issuerPendingNonce),
  originalOperationSeen:false,originalUnitAvailable:true,
  reviewLedgerMigrationReadyForSourceReview:true,
  migrationAppliedToLive:false,runbookRequiresSeparateHumanRelease:true
 });
}
