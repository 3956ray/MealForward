import test from 'node:test';
import assert from 'node:assert/strict';
import {Wallet} from 'ethers';
import {CHAIN,ESCROW} from './core.mjs';
import {FIXED,originalVoucherId} from './t1e-first-issue-readiness.mjs';
import {
 ORIGINAL_CLAIM,ORIGINAL_OPERATION,ORIGINAL_DATA_HASH,ORIGINAL_DEADLINE
} from './t1f-successor-issue-protocol.mjs';
import {
 T1F_RELEASE_DOMAIN,T1F_RELEASE_OWNER,T1F_RELEASE_DONOR,
 buildSuccessorReleaseManifest,verifyDualSignaturesForTest,
 verifyPinnedSuccessorRelease
} from './t1f-successor-dual-approval.mjs';
const NOW=1792792000;
const OP='0x'+'e'.repeat(64);
const REVIEW='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SLOT='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CLAIM={
 claim_id:ORIGINAL_CLAIM,
 funding_intent:'2b9ae6f1-2bb7-4096-8136-70f30f302eea',
 stage:'ISSUE_UNKNOWN',revision:2,chain_id:CHAIN,escrow:ESCROW,
 unit_seq:0,generation:1,voucher_id:originalVoucherId(0,1n),
 issuer_wallet:FIXED.issuerAuthority,
 issuer_op_id:ORIGINAL_OPERATION,issuer_tx_nonce:'0',
 issuer_issue_deadline:ORIGINAL_DEADLINE.toString(),
 issuer_tx_data_hash:ORIGINAL_DATA_HASH,issuer_tx_hash:null,
 receipt_block:null,receipt_block_hash:null,
 consent_digest:'0x'+'2'.repeat(64),
 consent_signature_fingerprint:'0x'+'3'.repeat(64)
};
const REVIEW_ROW={
 review_id:REVIEW,claim_id:ORIGINAL_CLAIM,
 review_state:'MANUAL_REVIEW_ONLY_NO_NEW_ISSUE',
 wallet_observation:'OWNER_REPORTED_NO_TRANSACTIONS_VISIBLE',
 observed_block_number:'73688844',
 observed_issuer_latest_nonce:'0',observed_issuer_pending_nonce:'0',
 may_create_second_operation:false,may_broadcast_transaction:false,
 may_modify_original_claim:false
};
const SLOT_ROW={
 attempt_id:SLOT,claim_id:ORIGINAL_CLAIM,review_id:REVIEW,attempt_sequence:2,
 stage:'REVIEW_HOLD',original_operation_id:ORIGINAL_OPERATION,
 original_issuer_nonce:'0',original_deadline:ORIGINAL_DEADLINE.toString(),
 original_calldata_hash:ORIGINAL_DATA_HASH,
 successor_operation_id:null,successor_nonce:null,
 successor_issue_deadline:null,successor_calldata_hash:null,
 successor_tx_hash:null,receipt_block:null,receipt_block_hash:null,
 security_release_id:null,
 may_prepare_wallet_tx:false,may_sign_or_broadcast:false,
 may_mark_issued:false,legacy_claim_rewrite_allowed:false
};
const CHAIN_STATE={
 status:'T1F_EXPIRED_NO_ISSUE_OBSERVED_NOT_ABSENCE_PROOF',
 chainId:10143,issuer:FIXED.issuerAuthority,escrow:ESCROW,
 originalOperationId:ORIGINAL_OPERATION,reservedOriginalNonce:'0',
 originalImmutableDeadline:ORIGINAL_DEADLINE.toString(),
 observedBlockNumber:'73688845',observedBlockHash:'0x'+'4'.repeat(64),
 observedBlockTime:NOW-10,
 issuerLatestNonce:'0',issuerPendingNonce:'0',
 originalOperationSeen:false,unitAvailable:true,unitIssued:false,
 issuerTransactionHashFound:false,noPendingTxProven:false,
 userWalletActivityMustBeChecked:true,canIssueOrResetAutomatically:false
};
const body=(over={})=>({
 claim:CLAIM,review:REVIEW_ROW,slot:SLOT_ROW,chain:CHAIN_STATE,
 walletObservation:'OWNER_REPORTED_NO_TRANSACTIONS_VISIBLE',
 nonceDomain:'0x'+'5'.repeat(64),
 candidateOperationId:OP,candidateNonce:'0',
 candidateDeadline:NOW+480,approvalExpiresAt:NOW+180,
 now:NOW,...over
});
const fixtureOwner=Wallet.createRandom(),fixtureDonor=Wallet.createRandom();
const signed=async overrides=>{
 const manifest=buildSuccessorReleaseManifest(body(overrides));
 const ownerSignature=await fixtureOwner.signTypedData(
  manifest.domain,manifest.types,manifest.value
 );
 const donorSignature=await fixtureDonor.signTypedData(
  manifest.domain,manifest.types,manifest.value
 );
 return {manifest,ownerSignature,donorSignature};
};
test('immutable recovery release binds original op, new op, nonce, block, voucher and two distinct wallets',async()=>{
 const p=await signed();
 assert.equal(p.manifest.domain.chainId,CHAIN_STATE.chainId);
 assert.equal(p.manifest.domain.verifyingContract,ESCROW);
 assert.equal(p.manifest.value.originalOpId,ORIGINAL_OPERATION);
 assert.equal(p.manifest.value.originalDataHash,ORIGINAL_DATA_HASH);
 assert.equal(p.manifest.value.newOpId,OP);
 assert.equal(p.manifest.value.newNonce,'0');
 const verified=verifyDualSignaturesForTest({
  ...p,expectedOwner:fixtureOwner.address,
  expectedDonor:fixtureDonor.address,now:NOW
 });
 assert.equal(verified.status,'T1F_DUAL_EIP712_SIGNATURES_VERIFIED_OFFCHAIN_ONLY');
 assert.equal(verified.rawSignaturesStored,false);
 assert.equal(verified.canBroadcast,false);
 assert.equal(verified.newIssueAuthorized,false);
 assert.notEqual(verified.ownerSignatureFingerprint,p.ownerSignature);
 assert.notEqual(verified.donorSignatureFingerprint,p.donorSignature);
 assert.equal(T1F_RELEASE_OWNER,FIXED.owner);
 assert.notEqual(T1F_RELEASE_DONOR,FIXED.issuerAuthority);
});
test('source-only signer simulation CANNOT impersonate pinned Owner and Donor in runtime',async()=>{
 const p=await signed();
 assert.throws(()=>verifyPinnedSuccessorRelease({...p,now:NOW}),
  /T1F_RELEASE_OWNER_DONOR_SIGNATURES_INVALID/);
 assert.throws(()=>verifyDualSignaturesForTest({
  ...p,expectedOwner:fixtureDonor.address,
  expectedDonor:fixtureOwner.address,now:NOW
 }),/T1F_RELEASE_OWNER_DONOR_SIGNATURES_INVALID/);
 assert.throws(()=>verifyDualSignaturesForTest({
  ...p,expectedOwner:fixtureOwner.address,
  expectedDonor:fixtureOwner.address,now:NOW
 }),/T1F_RELEASE_DISTINCT_ROLES_REQUIRED/);
});
test('replay, swapped signatures, typed-data change, cutoff and quote mismatch all fail closed',async()=>{
 const p=await signed();
 const expectedOwner=fixtureOwner.address,expectedDonor=fixtureDonor.address;
 for(const overrides of [
  {ownerSignature:p.donorSignature},
  {donorSignature:p.ownerSignature},
  {ownerSignature:'0x12'},
  {manifest:{...p.manifest,value:{...p.manifest.value,newOpId:'0x'+'9'.repeat(64)}}},
  {manifest:{...p.manifest,digest:'0x'+'9'.repeat(64)}},
  {manifest:{...p.manifest,domain:{...T1F_RELEASE_DOMAIN,chainId:1}}},
  {manifest:{...p.manifest,value:{...p.manifest.value,nonceDomain:'0x'+'0'.repeat(64)}}},
 ]){
  assert.throws(()=>verifyDualSignaturesForTest({
   ...p,...overrides,expectedOwner,expectedDonor,now:NOW
  }),/T1F_RELEASE_/);
 }
 assert.throws(()=>verifyDualSignaturesForTest({
  ...p,expectedOwner,expectedDonor,now:NOW+181
 }),/T1F_RELEASE_/);
});
test('future EIP712 approval cannot be built from stale or insufficient chain evidence',()=>{
 for(const override of [
  {chain:{...CHAIN_STATE,observedBlockTime:NOW-121}},
  {chain:{...CHAIN,observedBlockTime:NOW+1}},
  {chain:{...CHAIN_STATE,issuerPendingNonce:'1'}},
  {chain:{...CHAIN_STATE,unitIssued:true,unitAvailable:false}},
  {claim:{...CLAIM,stage:'ISSUED'}},
  {candidateOperationId:ORIGINAL_OPERATION},
  {candidateNonce:'1'},
  {candidateDeadline:NOW+601},
  {approvalExpiresAt:NOW+301},
  {approvalExpiresAt:NOW+89},
  {nonceDomain:'0x'+'0'.repeat(64)}
 ]){
  assert.throws(()=>buildSuccessorReleaseManifest(body(override)),/T1F_/);
 }
});
