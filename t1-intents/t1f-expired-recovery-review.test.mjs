import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {originalVoucherId,FIXED} from './t1e-first-issue-readiness.mjs';
import {CHAIN,ESCROW} from './core.mjs';
import {assessExpiredOriginalReview} from './t1f-expired-recovery-review.mjs';
const OP='0x2e709dee8113d2dac73cbea53d016d6629fc3730c6f85325a17c98bc4777445b';
const H='0x089cb2b0a35e81f31a9f9a658cd298ad7c9d3376ea01fac6fb77013451e1f0ed';
const DEADLINE='1792765625';
const claim=()=>({
 claim_id:'fbab3b22-965d-44e2-b144-d7307b7aa8ea',
 funding_intent:'2b9ae6f1-2bb7-4096-8136-70f30f302eea',
 stage:'ISSUE_UNKNOWN',revision:2,
 issuer_op_id:OP,issuer_tx_nonce:'0',issuer_issue_deadline:DEADLINE,
 issuer_tx_data_hash:H,issuer_tx_hash:null,
 receipt_block:null,receipt_block_hash:null,
 issuer_wallet:FIXED.issuerAuthority,voucher_id:originalVoucherId(0,1n),
 consent_digest:'0x'+'a'.repeat(64),
 consent_signature_fingerprint:'0x'+'b'.repeat(64)
});
const chain=()=>({
 status:'T1F_EXPIRED_NO_ISSUE_OBSERVED_NOT_ABSENCE_PROOF',
 chainId:CHAIN,issuer:FIXED.issuerAuthority,escrow:ESCROW,
 originalOperationId:OP,reservedOriginalNonce:'0',
 originalImmutableDeadline:DEADLINE,
 issuerLatestNonce:'0',issuerPendingNonce:'0',
 observedBlockNumber:'73645548',
 observedBlockHash:'0x'+'c'.repeat(64),
 originalOperationSeen:false,unitAvailable:true,unitIssued:false,
 issuerTransactionHashFound:false,noPendingTxProven:false,
 userWalletActivityMustBeChecked:true,canIssueOrResetAutomatically:false
});
const go=(p={})=>assessExpiredOriginalReview({
 claim:claim(),chain:chain(),now:Number(DEADLINE)+1800,
 walletObservation:'OWNER_REPORTED_NO_TRANSACTIONS_VISIBLE',...p
});
test('the owner reported no MetaMask tx but this STILL NEVER authorizes a new Issue',()=>{
 const r=go();
 assert.equal(r.status,'T1F_REVIEWABLE_OFFLINE_SECURITY_REVIEW_ONLY');
 assert.equal(r.newIssueAuthorized,false);
 assert.equal(r.mayCreateSecondOperation,false);
 assert.equal(r.mayBroadcastTransaction,false);
 assert.equal(r.mayModifyOriginalClaim,false);
 assert.equal(r.walletReportIsChainProof,false);
 assert.equal(r.originalIssuerNonce,'0');
 assert.equal(r.originalCalldataHash,H);
 assert.equal(r.migrationAppliedToLive,false);
});
test('wallet uncertainty or an observed original tx always holds review',()=>{
 for(const w of [undefined,'OWNER_FOUND_ORIGINAL_TRANSACTION',
 'OWNER_ACTIVITY_NOT_CHECKED']){
  assert.equal(go({walletObservation:w}).status,
   'T1F_REVIEW_HOLD_OWNER_WALLET_EVIDENCE');
 }
 for(const overrides of [{issuerLatestNonce:'1',issuerPendingNonce:'1'},
  {issuerPendingNonce:'1'}, {originalOperationSeen:true},
  {unitIssued:true,unitAvailable:false},{unitAvailable:false},
  {status:'T1F_EXPIRED_CHAIN_ACTIVITY_MANUAL_INVESTIGATION_REQUIRED'}]){
  const r=go({chain:{...chain(),...overrides}});
  assert.equal(r.status,'T1F_REVIEW_BLOCKED_CHAIN_ACTIVITY');
  assert.equal(r.mayBroadcastTransaction,false);
 }
});
test('invalid chain or changed immutable original reservation stops the policy',()=>{
 for(const change of [{revision:3},{issuer_op_id:'0x'+'0'.repeat(64)},
  {issuer_tx_nonce:1},{issuer_issue_deadline:'1792765626'},
  {issuer_tx_hash:'0x'+'1'.repeat(64)},{stage:'ISSUED'},
  {consent_digest:null}]){
  assert.throws(()=>go({claim:{...claim(),...change}}),/T1F_/);
 }
 for(const change of [{chainId:1},{issuer:'0x'+'1'.repeat(40)},
  {originalOperationId:'0x'+'1'.repeat(64)},
  {noPendingTxProven:true},{observedBlockHash:'x'}]){
  assert.throws(()=>go({chain:{...chain(),...change}}),/T1F_/);
 }
 assert.throws(()=>go({now:Number(DEADLINE)}),/T1F_REVIEW_RESERVATION_NOT_EXPIRED/);
});
test('evidence-review source cannot send funds, change PG or construct a wallet tx',()=>{
 const source=readFileSync(new URL('./t1f-expired-recovery-review.mjs',import.meta.url),'utf8');
 for(const forbidden of ['eth_sendTransaction','eth_sendRawTransaction',
  'Wallet.fromPrivateKey','privateKeyToAccount','UPDATE mf_t1e',
  'process.env.PRIVATE_KEY'])
  assert.equal(source.includes(forbidden),false,forbidden);
});
