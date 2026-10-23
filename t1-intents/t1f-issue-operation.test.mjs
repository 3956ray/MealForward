import test from 'node:test';
import assert from 'node:assert/strict';
import {AbiCoder,keccak256,toUtf8Bytes} from 'ethers';
import {readFileSync} from 'node:fs';
import {
 proposeOriginalIssuerOperation,inspectReservedIssuerOperation,
 verifyOriginalIssuerReceipt,receiptABI
} from './t1f-issue-operation.mjs';
import {t0,erc20,originalVoucherId,FIXED,QUOTE_ID}
 from './t1e-first-issue-readiness.mjs';
import {CHAIN,ESCROW,TOKEN,MEAL,TERMS,PRICE,QUOTE} from './core.mjs';

const TIME=1792740800,OP='0x'+'d'.repeat(64);
const TX_HASH='0x'+'a'.repeat(64),BLOCK_HASH='0x'+'c'.repeat(64);
const BATCH='0x'+'b'.repeat(64),OP_DOMAIN=keccak256(toUtf8Bytes('MealForwardOperationV1'));
const ZERO='0x'+'0'.repeat(64),ZERO_ADDR='0x'+'0'.repeat(40);
const VOUCHER=originalVoucherId(0,1n);
const aid='a3412d43-4047-4b8c-a349-bab111711711';
const proof={
 status:'T1E_ORIGINAL_FUNDED_UNIT_READONLY_ISSUE_GATE_PASS',
 chainId:CHAIN,escrow:ESCROW,mealId:MEAL,
 firstUnitSequence:0,nextGeneration:1,
 unitPrice:PRICE.toString(),originalIssuerAuthority:FIXED.issuerAuthority,
 originalQuoteUsed:true,verifiedFirstBatch:true,issuedOnchain:false,
 issueSimulatedWithoutSend:true,
 accounting:{availableUnits:'1',liabilityBaseUnits:PRICE.toString(),
  escrowBalanceBaseUnits:PRICE.toString()}
};
const claim=over=>({
 claim_id:aid,funding_intent:'2b9ae6f1-2bb7-4096-8136-70f30f302eea',
 chain_id:CHAIN,escrow:ESCROW,meal_id:MEAL,terms_hash:TERMS,
 unit_seq:0,generation:1,voucher_id:VOUCHER,
 beneficiary_wallet:'0x'+'7'.repeat(40),
 issuer_wallet:FIXED.issuerAuthority,
 consent_nonce:'0x'+'5'.repeat(64),
 consent_deadline:(TIME+480).toString(),
 consent_digest:'0x'+'6'.repeat(64),
 consent_signature_fingerprint:'0x'+'8'.repeat(64),
 stage:'CONSENT_VERIFIED',
 issuer_op_id:null,issuer_tx_nonce:null,issuer_tx_data_hash:null,issuer_tx_hash:null,
 ...over
});
const proposal=()=>proposeOriginalIssuerOperation({
 claim:claim(),operationId:OP,issuerPendingNonce:9,chainProof:proof,now:TIME
});
function reserved(stage='ISSUE_UNKNOWN'){
 const built=proposal();
 return claim({
  stage,issuer_op_id:OP,issuer_tx_nonce:'9',
  issuer_tx_data_hash:built.issuerCalldataHash,
  issuer_tx_hash:stage==='ISSUE_HASH_BOUND'?TX_HASH:null
 });
}
const error=fn=>assert.throws(fn,/T1F_/);

test('same immutable claim deadline gives exact Issue calldata for unit 0 and 7 Test USDC',()=>{
 const p=proposal();
 assert.equal(p.status,'T1F_ORIGINAL_ISSUE_PROPOSAL_ONLY');
 assert.equal(p.transaction.from,FIXED.issuerAuthority);
 assert.equal(p.transaction.to,ESCROW);
 assert.equal(p.transaction.chainId,'0x279f');
 assert.equal(p.transaction.value,'0x0');
 assert.equal(p.transaction.nonce,'0x9');
 assert.equal(keccak256(p.transaction.data),p.issuerCalldataHash);
 assert.equal(p.transaction.data.slice(0,10),t0.getFunction('issue').selector);
 assert.equal(p.expectedVoucherId,VOUCHER);
 assert.equal(p.persistISSUE_UNKNOWNBeforeWallet,true);
 assert.equal(p.mustNotBroadcastBeforeDbCommit,true);
 assert.equal(p.serverMaySignOrBroadcast,false);
 assert.equal(p.noRecipientBoundInContract,true);
 const parsed=t0.parseTransaction({data:p.transaction.data});
 assert.equal(parsed.name,'issue');
 assert.equal(parsed.args[0],OP);
 assert.equal(parsed.args[1].toLowerCase(),MEAL);
 assert.equal(parsed.args[2],0n);assert.equal(parsed.args[3],1n);
 assert.equal(parsed.args[4],TERMS);
 assert.equal(parsed.args[5],BigInt(TIME+480));
});
test('recipient and chain tampering or wrong wallet/expiry cannot propose a transaction',()=>{
 for(const [change,reason] of [
  [{funding_intent:'00000000-0000-4000-8000-000000000000'},/T1F_NOT_ORIGINAL_DONOR_FUNDED_CLAIM/],
  [{stage:'ISSUED'},/T1F_ISSUER_CLAIM_STAGE_NOT_ALLOWED/],
  [{unit_seq:1},/T1F_FIRST_VOUCHER_IDENTITY_CONFLICT/],
  [{generation:2},/T1F_FIRST_VOUCHER_IDENTITY_CONFLICT/],
  [{beneficiary_wallet:QUOTE},/T1F_BENEFICIARY_OR_ISSUER_ROLE_INVALID/],
  [{issuer_wallet:QUOTE},/T1F_BENEFICIARY_OR_ISSUER_ROLE_INVALID/],
  [{consent_digest:null},/T1F_DURABLE_CONSENT_EVIDENCE_REQUIRED/],
  [{consent_deadline:TIME-1},/T1F_RECIPIENT_CONSENT_EXPIRED/],
  [{issuer_op_id:OP},/T1F_ORIGINAL_ISSUER_OPERATION_ALREADY_RESERVED/]
 ]){
  assert.throws(()=>proposeOriginalIssuerOperation({
   claim:claim(change),operationId:OP,
   issuerPendingNonce:9,chainProof:proof,now:TIME
  }),reason);
 }
 for(const bogus of [
  {...proof,firstUnitSequence:1},
  {...proof,issuedOnchain:true},
  {...proof,originalIssuerAuthority:QUOTE},
  {...proof,accounting:{...proof.accounting,availableUnits:'0'}},
  {...proof,accounting:{...proof.accounting,escrowBalanceBaseUnits:'0'}},
  {...proof,issueSimulatedWithoutSend:false}
 ]){
  assert.throws(()=>proposeOriginalIssuerOperation({
   claim:claim(),operationId:OP,issuerPendingNonce:9,
   chainProof:bogus,now:TIME
  }),/T1F_FRESH_PINNED_READONLY_CHAIN_PROOF_REQUIRED/);
 }
 error(()=>proposeOriginalIssuerOperation({
  claim:claim(),operationId:ZERO,issuerPendingNonce:9,chainProof:proof,now:TIME
 }));
 error(()=>proposeOriginalIssuerOperation({
  claim:claim(),operationId:OP,issuerPendingNonce:-1,chainProof:proof,now:TIME
 }));
});
test('original reserved nonce/operation may be read after expiry but NEVER re-sent',()=>{
 const original=reserved();
 const out=inspectReservedIssuerOperation({claim:original,now:TIME+100000});
 assert.equal(out.status,'ISSUE_UNKNOWN_ORIGINAL_ONLY_DO_NOT_RESEND');
 assert.equal(out.sendAgainPermitted,false);
 assert.equal(out.operationId,OP);
 assert.equal(out.reservedNonce,'9');
 assert.equal(out.expectedCalldataHash,proposal().issuerCalldataHash);
 // Once an original nonce is written to PG17, the 009 immutable-row
 // trigger prevents editing it. A decoded SQL snapshot cannot independently
 // prove its earlier nonce, because nonce is NOT part of calldata hash.
 // A changed immutable operation ID, however, must fail the hash proof.
 error(()=>inspectReservedIssuerOperation({claim:{
  ...original,issuer_op_id:'0x'+'f'.repeat(64)
 },now:TIME+100000}));
 error(()=>inspectReservedIssuerOperation({claim:{
  ...original,issuer_tx_data_hash:'0x'+'0'.repeat(64)
 },now:TIME+100000}));
 error(()=>inspectReservedIssuerOperation({claim:{...original,stage:'CONSENT_VERIFIED'},now:TIME}));
});

function fakeChain(overrides={}){
 const original=reserved('ISSUE_HASH_BOUND');
 const txPlan=proposal().transaction;
 const includedAt=TIME+120;
 const opParams=keccak256(AbiCoder.defaultAbiCoder().encode(
  ['bytes32','uint8','uint256','bytes32','uint256'],
  [MEAL,0,1,TERMS,TIME+480]
 ));
 const opPayload=keccak256(AbiCoder.defaultAbiCoder().encode(
  ['bytes32','uint256','uint256','address','uint8','address','bytes32','bytes32'],
  [OP_DOMAIN,1,CHAIN,ESCROW,5,FIXED.issuerAuthority,OP,opParams]
 ));
 function event(name,args){
  const e=receiptABI.encodeEventLog(receiptABI.getEvent(name),args);
  return {address:ESCROW,topics:e.topics,data:e.data};
 }
 const receipt={
  transactionHash:TX_HASH,from:FIXED.issuerAuthority,to:ESCROW,
  blockHash:BLOCK_HASH,blockNumber:'0x1697c30',status:'0x1',
  logs:[
   event('Issued',[VOUCHER,0,1,TERMS,includedAt,includedAt+259200]),
   event('OperationExecuted',[OP,5,FIXED.issuerAuthority,opPayload,VOUCHER])
  ]
 };
 const tx={
  hash:TX_HASH,from:FIXED.issuerAuthority,to:ESCROW,
  blockHash:BLOCK_HASH,blockNumber:receipt.blockNumber,chainId:'0x279f',
  input:txPlan.data,nonce:txPlan.nonce,value:'0x0'
 };
 const account=[1,PRICE,[0,1,0,0,0],[0,PRICE,0,0,0],PRICE];
 const voucher=[
  0,1,TERMS,includedAt,includedAt+259200,FIXED.issuerAuthority,
  ZERO,0,ZERO_ADDR,ZERO_ADDR,ZERO,0,0,ZERO,ZERO,false
 ];
 const unit=[BATCH,0,QUOTE,MEAL,1,TERMS,PRICE,1,1,VOUCHER];
 const operation=[5,FIXED.issuerAuthority,opPayload,VOUCHER,includedAt];
 const overridesApplied={
  tx:{...tx,...overrides.tx},
  receipt:{...receipt,...overrides.receipt},
  block:{hash:BLOCK_HASH,timestamp:'0x'+includedAt.toString(16),...overrides.block}
 };
 const rpc={
  async send(method,args=[]){
   if(method==='eth_chainId')return '0x279f';
   if(method==='eth_getTransactionByHash')return overridesApplied.tx;
   if(method==='eth_getTransactionReceipt')return overrides.receiptNull?null:overridesApplied.receipt;
   if(method==='eth_blockNumber')return '0x1697c40';
   if(method==='eth_getBlockByNumber')return overridesApplied.block;
   if(method==='eth_call'){
    const [call]=args,iface=call.to.toLowerCase()===TOKEN?erc20:
      call.data.slice(0,10)===receiptABI.getFunction('getVoucher').selector||
      call.data.slice(0,10)===receiptABI.getFunction('getOperation').selector?
       receiptABI:t0;
    const decoded=iface.parseTransaction({data:call.data});
    const name=decoded.name;
    const value={getUnit:[unit],getAccounting:[account],
     getVoucher:[voucher],getOperation:[operation],
     quoteUses:['0x'+'1'.repeat(64),BATCH],balanceOf:[PRICE]}[name];
    assert.ok(value,'unreviewed RPC method '+name);
    return iface.encodeFunctionResult(name,value);
   }
   throw Error('UNEXPECTED_MOCK_RPC_'+method);
  }
 };
 return {rpc,claim:original,tx:txPlan};
}
test('synthetic but byte-exact original Issued receipt verifies canonical block, voucher, operation and liability',async()=>{
 const {rpc,claim}=fakeChain();
 const proof=await verifyOriginalIssuerReceipt({claim,rpc,now:TIME+2000});
 assert.equal(proof.status,'T1F_ORIGINAL_ISSUED_RECEIPT_INDEPENDENTLY_CONFIRMED');
 assert.equal(proof.voucherId,VOUCHER);
 assert.equal(proof.originalIssuerKeyUsedOnchain,true);
 assert.equal(proof.escrowBaseUnits,PRICE.toString());
 assert.equal(proof.escrowLiabilityBaseUnits,PRICE.toString());
 assert.equal(proof.onchainRecipientBinding,false);
 assert.equal(proof.merchantSettlementAllowed,false);
 assert.equal(proof.additionalTransactionsSent,0);
});
test('receipt verifier fail-closed on substituted nonce, chain receipt, hash or forged Issued event',async()=>{
 const altered=[
  {tx:{nonce:'0xa'}},
  {tx:{from:QUOTE}},
  {tx:{to:TOKEN}},
  {tx:{input:'0x12345678'}},
  {receipt:{status:'0x2'}},
  {receipt:{blockHash:'0x'+'0'.repeat(64)}},
  {block:{hash:'0x'+'0'.repeat(64)}},
  {receipt:{logs:[]}}
 ];
 for(const overrides of altered){
  const {rpc,claim}=fakeChain(overrides);
  await assert.rejects(
   ()=>verifyOriginalIssuerReceipt({claim,rpc,now:TIME+1200}),/T1F_/
  );
 }
 const {rpc,claim}=fakeChain({receiptNull:true});
 const pending=await verifyOriginalIssuerReceipt({rpc,claim,now:TIME+1200});
 assert.equal(pending.status,'PENDING_NO_REBROADCAST');
 const reverted=fakeChain({receipt:{status:'0x0'}});
 assert.equal((await verifyOriginalIssuerReceipt({rpc:reverted.rpc,claim:reverted.claim})).status,
  'REVERTED_NO_AUTORETRY');
});
test('T1-F source constructs calldata only, never broadcasts or handles Issuer secret keys',()=>{
 const source=readFileSync(new URL('./t1f-issue-operation.mjs',import.meta.url),'utf8');
 assert.ok(source.includes('ISSUE_UNKNOWN'));
 for(const forbidden of [
  'eth_sendTransaction','eth_sendRawTransaction','privateKeyToAccount',
  'Wallet.fromPrivateKey','process.env.PRIVATE_KEY'
 ])assert.ok(!source.includes(forbidden),'write primitive '+forbidden);
});
