import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AbiCoder,keccak256,toUtf8Bytes} from 'ethers';
import {CHAIN,ESCROW,TOKEN,MEAL,TERMS,PRICE,QUOTE} from './core.mjs';
import {t0,erc20,originalVoucherId,FIXED,QUOTE_ID} from './t1e-first-issue-readiness.mjs';
import {receiptABI} from './t1f-issue-operation.mjs';
import {
 ORIGINAL_OPERATION,ORIGINAL_CLAIM,ORIGINAL_DEADLINE,ORIGINAL_DATA_HASH,
 previewSuccessorIssue,verifySuccessorReceiptReadOnly
} from './t1f-successor-issue-protocol.mjs';
const TIME=1792792000,NEWOP='0x'+'e'.repeat(64),TX='0x'+'a'.repeat(64);
const BLOCK='0x'+'c'.repeat(64),BATCH='0x'+'b'.repeat(64),ZERO='0x'+'0'.repeat(64);
const REVID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SLOTID='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADDRESS0='0x'+'0'.repeat(40);
const claim=override=>({
 claim_id:ORIGINAL_CLAIM,
 funding_intent:'2b9ae6f1-2bb7-4096-8136-70f30f302eea',
 chain_id:CHAIN,escrow:ESCROW,meal_id:MEAL,terms_hash:TERMS,
 unit_seq:0,generation:1,
 voucher_id:originalVoucherId(0,1n),
 beneficiary_wallet:'0x2539fefe77a5ce4d09d2225c2e8a7517b22b9135',
 issuer_wallet:FIXED.issuerAuthority,
 consent_nonce:'0x'+'2'.repeat(64),consent_deadline:'1792761000',
 consent_digest:'0x'+'3'.repeat(64),
 consent_signature_fingerprint:'0x'+'4'.repeat(64),
 stage:'ISSUE_UNKNOWN',revision:2,
 issuer_op_id:ORIGINAL_OPERATION,
 issuer_tx_nonce:'0',issuer_issue_deadline:ORIGINAL_DEADLINE.toString(),
 issuer_tx_data_hash:ORIGINAL_DATA_HASH,issuer_tx_hash:null,
 receipt_block:null,receipt_block_hash:null,
 ...override
});
const review=override=>({
 review_id:REVID,claim_id:ORIGINAL_CLAIM,original_operation_id:ORIGINAL_OPERATION,
 original_issuer_nonce:'0',original_deadline:ORIGINAL_DEADLINE.toString(),
 original_calldata_hash:ORIGINAL_DATA_HASH,
 review_state:'MANUAL_REVIEW_ONLY_NO_NEW_ISSUE',
 wallet_observation:'OWNER_REPORTED_NO_TRANSACTIONS_VISIBLE',
 observed_issuer_latest_nonce:'0',observed_issuer_pending_nonce:'0',
 observed_block_number:'73688844',observed_block_hash:'0x'+'f'.repeat(64),
 may_create_second_operation:false,
 may_broadcast_transaction:false,may_modify_original_claim:false,
 ...override
});
const slot=override=>({
 attempt_id:SLOTID,review_id:REVID,claim_id:ORIGINAL_CLAIM,
 attempt_sequence:2,stage:'REVIEW_HOLD',
 original_operation_id:ORIGINAL_OPERATION,original_issuer_nonce:'0',
 original_deadline:ORIGINAL_DEADLINE.toString(),original_calldata_hash:ORIGINAL_DATA_HASH,
 successor_operation_id:null,successor_nonce:null,successor_issue_deadline:null,
 successor_calldata_hash:null,successor_tx_hash:null,
 receipt_block:null,receipt_block_hash:null,security_release_id:null,
 may_prepare_wallet_tx:false,may_sign_or_broadcast:false,
 may_mark_issued:false,legacy_claim_rewrite_allowed:false,
 ...override
});
const chain=override=>({
 status:'T1F_EXPIRED_NO_ISSUE_OBSERVED_NOT_ABSENCE_PROOF',
 chainId:CHAIN,issuer:FIXED.issuerAuthority,escrow:ESCROW,
 originalOperationId:ORIGINAL_OPERATION,reservedOriginalNonce:'0',
 originalImmutableDeadline:ORIGINAL_DEADLINE.toString(),
 observedBlockNumber:'73688845',observedBlockHash:'0x'+'f'.repeat(64),
 issuerLatestNonce:'0',issuerPendingNonce:'0',
 originalOperationSeen:false,unitAvailable:true,unitIssued:false,
 issuerTransactionHashFound:false,noPendingTxProven:false,
 userWalletActivityMustBeChecked:true,canIssueOrResetAutomatically:false,
 ...override
});
const preview=(overrides={})=>previewSuccessorIssue({
 claim:claim(),review:review(),slot:slot(),chain:chain(),
 walletObservation:'OWNER_REPORTED_NO_TRANSACTIONS_VISIBLE',
 candidateOperationId:NEWOP,candidateNonce:'0',
 candidateDeadline:TIME+480,now:TIME,...overrides
});

test('a reviewed source-only second operation returns its hash but NEVER a sendable transaction',()=>{
 const p=preview();
 assert.equal(p.status,'T1F_SUCCESSOR_DESIGN_PREVIEW_NO_RELEASE');
 assert.equal(p.canSign,false);
 assert.equal(p.canBroadcast,false);
 assert.equal(p.canUseWallet,false);
 assert.equal(p.newOperationReserved,false);
 assert.equal(p.mayPersistProposedFieldsIn014,false);
 assert.equal(p.originalOperationId,ORIGINAL_OPERATION);
 assert.equal(p.candidateOperationId,NEWOP);
 assert.equal(p.candidateIssuerNonce,'0');
 assert.equal(p.voucherId,originalVoucherId(0,1n));
 const calldata=t0.encodeFunctionData('issue',[NEWOP,MEAL,0,1,TERMS,BigInt(TIME+480)]);
 assert.equal(p.candidateCalldataHash,keccak256(calldata));
 assert.equal(p.transaction,undefined);
 assert.equal(p.data,undefined);
 assert.equal(p.issueTransaction,undefined);
 assert.equal(p.merchantSettlementEnabled,false);
});

test('cannot reuse original operation or trust a guessed nonce, expired deadline, altered review or claim',()=>{
 const overrides=[
  {candidateOperationId:ORIGINAL_OPERATION},
  {candidateOperationId:ZERO},
  {candidateNonce:1},
  {candidateDeadline:TIME+119},
  {candidateDeadline:TIME+601},
  {claim:claim({issuer_tx_hash:TX})},
  {claim:claim({revision:3})},
  {slot:slot({may_sign_or_broadcast:true})},
  {slot:slot({stage:'ISSUE_HASH_BOUND'})},
  {slot:slot({successor_nonce:'0'})},
  {review:review({may_broadcast_transaction:true})},
  {chain:chain({issuerPendingNonce:'1'})},
  {chain:chain({issuerLatestNonce:'1',issuerPendingNonce:'1'})},
  {chain:chain({originalOperationSeen:true})},
  {chain:chain({unitAvailable:false,unitIssued:true})},
  {chain:chain({observedBlockNumber:'73688843'})},
  {walletObservation:'OWNER_FOUND_ORIGINAL_TRANSACTION'}
 ];
 for(const x of overrides)assert.throws(()=>preview(x),/T1F_/);
});

// Prove the independent adapter is capable of validating the exact original
// StoreEscrow issue receipt, but ONLY when given a synthetically released
// successor. Real SQL 014 cannot represent the released/bound state at all.
function mockSuccessorChain(opts={}){
 const inclusion=TIME+100, expiry=TIME+480, voucher=originalVoucherId(0,1n);
 const opParams=keccak256(AbiCoder.defaultAbiCoder().encode(
  ['bytes32','uint8','uint256','bytes32','uint256'],
  [MEAL,0,1,TERMS,expiry]
 ));
 const payload=keccak256(AbiCoder.defaultAbiCoder().encode(
  ['bytes32','uint256','uint256','address','uint8','address','bytes32','bytes32'],
  [keccak256(toUtf8Bytes('MealForwardOperationV1')),1,CHAIN,ESCROW,5,
   FIXED.issuerAuthority,NEWOP,opParams]
 ));
 const calldata=t0.encodeFunctionData('issue',[NEWOP,MEAL,0,1,TERMS,BigInt(expiry)]);
 const attempt={
  attempt_id:SLOTID,claim_id:ORIGINAL_CLAIM,
  stage:'ISSUE_HASH_BOUND',
  security_release_id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  original_operation_id:ORIGINAL_OPERATION,
  original_issuer_nonce:'0',original_deadline:ORIGINAL_DEADLINE.toString(),
  original_calldata_hash:ORIGINAL_DATA_HASH,
  successor_operation_id:NEWOP,successor_nonce:'0',
  successor_issue_deadline:String(expiry),
  successor_calldata_hash:keccak256(calldata),
  successor_tx_hash:TX,
  legacy_claim_rewrite_allowed:false,...opts.attempt
 };
 const event=(name,args)=>{
  const e=receiptABI.encodeEventLog(receiptABI.getEvent(name),args);
  return {address:ESCROW,topics:e.topics,data:e.data};
 };
 const blockNum='0x203030';
 const transaction={
  hash:TX,from:FIXED.issuerAuthority,to:ESCROW,
  nonce:'0x0',value:'0x0',chainId:'0x279f',input:calldata,
  blockNumber:blockNum,blockHash:BLOCK,...opts.transaction
 };
 const receipt={
  transactionHash:TX,from:FIXED.issuerAuthority,to:ESCROW,
  blockNumber:blockNum,blockHash:BLOCK,status:'0x1',
  logs:[
   event('Issued',[voucher,0,1,TERMS,inclusion,inclusion+259200]),
   event('OperationExecuted',[NEWOP,5,FIXED.issuerAuthority,payload,voucher])
  ],...opts.receipt
 };
 const unit=[BATCH,0,QUOTE,MEAL,1,TERMS,PRICE,1,1,voucher];
 const accounting=[1,PRICE,[0,1,0,0,0],[0,PRICE,0,0,0],PRICE];
 const vouch=[0,1,TERMS,inclusion,inclusion+259200,FIXED.issuerAuthority,
   ZERO,0,ADDRESS0,ADDRESS0,ZERO,0,0,ZERO,ZERO,false];
 const operation=[5,FIXED.issuerAuthority,payload,voucher,inclusion];
 const rpc={
  async send(method,args=[]){
   if(method==='eth_chainId')return '0x279f';
   if(method==='eth_getTransactionByHash')return transaction;
   if(method==='eth_getTransactionReceipt')return opts.nullReceipt?null:receipt;
   if(method==='eth_blockNumber')return '0x203040';
   if(method==='eth_getBlockByNumber')return {
    hash:BLOCK,timestamp:'0x'+inclusion.toString(16),...opts.block
   };
   if(method==='eth_call'){
    const [call]=args;
    const iface=call.to.toLowerCase()===TOKEN?erc20:
      [receiptABI.getFunction('getVoucher').selector,
       receiptABI.getFunction('getOperation').selector].includes(call.data.slice(0,10))?
       receiptABI:t0;
    const name=iface.parseTransaction({data:call.data}).name;
    const value={
     getUnit:[unit],getAccounting:[accounting],
     getVoucher:[vouch],getOperation:[operation],
     quoteUses:['0x'+'1'.repeat(64),BATCH],balanceOf:[PRICE]
    }[name];
    assert.ok(value,'no unreviewed RPC call: '+name);
    return iface.encodeFunctionResult(name,value);
   }
   throw Error('UNEXPECTED_RPC_METHOD_'+method);
  }
 };
 return {attempt,rpc};
}
test('014 review hold cannot be passed to a release/receipt verifier',async()=>{
 const {rpc}=mockSuccessorChain();
 await assert.rejects(
  ()=>verifySuccessorReceiptReadOnly({claim:claim(),attempt:slot(),rpc,now:TIME+900}),
  /T1F_PHASE3_APPROVED_BOUND_SUCCESSOR_REQUIRED/
 );
});
test('a SYNTHETIC successor receipt is bound to a distinct operation, block and original voucher',async()=>{
 const {attempt,rpc}=mockSuccessorChain();
 const p=await verifySuccessorReceiptReadOnly({claim:claim(),attempt,rpc,now:TIME+900});
 assert.equal(p.status,'T1F_SUCCESSOR_RECEIPT_VERIFIED_SOURCE_ONLY');
 assert.equal(p.originalClaimStage,'ISSUE_UNKNOWN');
 assert.equal(p.originalOperationId,ORIGINAL_OPERATION);
 assert.equal(p.successorOperationId,NEWOP);
 assert.equal(p.successorTxHash,TX);
 assert.equal(p.voucherId,originalVoucherId(0,1n));
 assert.equal(p.canBroadcast,false);
 assert.equal(p.neverWriteOriginalClaim,true);
});
test('fake successor receipt or wrong calldata and canonical hash are rejected',async()=>{
 for(const opts of [
  {attempt:{successor_calldata_hash:'0x'+'1'.repeat(64)}},
  {attempt:{successor_operation_id:ORIGINAL_OPERATION}},
  {attempt:{security_release_id:null}},
  {transaction:{nonce:'0x1'}},
  {transaction:{from:QUOTE}},
  {transaction:{input:'0x12345678'}},
  {receipt:{logs:[]}},
  {block:{hash:'0x'+'0'.repeat(64)}}
 ]){
  const {attempt,rpc}=mockSuccessorChain(opts);
  await assert.rejects(
   ()=>verifySuccessorReceiptReadOnly({claim:claim(),attempt,rpc,now:TIME+900}),
   /T1F_/
  );
 }
 const pending=mockSuccessorChain({nullReceipt:true});
 const p=await verifySuccessorReceiptReadOnly({claim:claim(),
  attempt:pending.attempt,rpc:pending.rpc,now:TIME+900});
 assert.equal(p.status,'T1F_SUCCESSOR_NOT_ISSUED_DO_NOT_RESEND');
 assert.equal(p.automaticRetryAllowed,false);
});
test('source contains no wallet broadcaster, server SQL writer or recipient Consent renewal',()=>{
 const s=readFileSync(new URL('./t1f-successor-issue-protocol.mjs',import.meta.url),'utf8');
 for(const token of [
  'eth_sendTransaction','eth_sendRawTransaction',
  'privateKeyToAccount','Wallet.fromPrivateKey',
  'UPDATE mf_t1e','INSERT INTO mf_t1e','DELETE FROM mf_t1e',
  'wallet_requestPermissions','personal_sign'
 ])assert.equal(s.includes(token),false,token);
});
