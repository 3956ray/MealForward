import test from 'node:test';
import assert from 'node:assert/strict';
import {keccak256,Wallet} from 'ethers';
import {exactIssuerCall,attestIssuerReceipt,FIRST_VOUCHER_ID,issueEvent} from './t1e-issuer-original.mjs';
import {t0,FIXED} from './t1e-first-issue-readiness.mjs';
import {MEAL,ESCROW,TERMS,PRICE} from './core.mjs';

const opId='0x'+'a'.repeat(64),txHash='0x'+'b'.repeat(64);
const blockHash='0x'+'c'.repeat(64),wrong=Wallet.createRandom().address.toLowerCase();
const now=1792740000;
const claim={
 funding_intent:'2b9ae6f1-2bb7-4096-8136-70f30f302eea',
 stage:'CONSENT_VERIFIED',unit_seq:0,generation:1,
 voucher_id:FIRST_VOUCHER_ID,issuer_wallet:FIXED.issuerAuthority,
 consent_digest:'0x'+'d'.repeat(64),
 consent_signature_fingerprint:'0x'+'e'.repeat(64)
};
const call=exactIssuerCall({claim,opId,nonce:9,deadline:now+120,now});
test('only exact original issuer and immutable Unit 0 call can be built; never broadcast',()=>{
 assert.equal(call.from,FIXED.issuerAuthority);
 assert.equal(call.to,ESCROW);
 assert.equal(call.chainId,'0x279f');
 assert.equal(call.nonce,'0x9');
 assert.equal(call.value,'0x0');
 assert.equal(call.chainWritesPerformed,0);
 assert.equal(call.dataHash,keccak256(call.data));
 assert.equal(call.voucherId,FIRST_VOUCHER_ID);
 const decoded=t0.parseTransaction({data:call.data});
 assert.equal(decoded.name,'issue');
 assert.equal(decoded.args[0],opId);
 assert.equal(decoded.args[1].toLowerCase(),MEAL.toLowerCase());
 assert.equal(decoded.args[2],0n);
 assert.equal(decoded.args[3],1n);
 assert.equal(decoded.args[4].toLowerCase(),TERMS.toLowerCase());
 assert.equal(decoded.args[5],BigInt(now+120));
});
test('bad/altered recipient claim, nonce or issuer is rejected before reservation',()=>{
 for(const change of [
  {stage:'PREPARED'},{stage:'ISSUED'},{unit_seq:1},{generation:2},
  {voucher_id:'0x'+'1'.repeat(64)},{issuer_wallet:wrong},
  {funding_intent:'a-different-intent'},{consent_digest:null}
 ]){
  assert.throws(()=>exactIssuerCall({claim:{...claim,...change},
   opId,nonce:9,deadline:now+120,now}),/T1E_CONSENT_AND_ORIGINAL_CLAIM_REQUIRED/);
 }
 for(const [id,nonce,deadline] of [
  ['0x'+'0'.repeat(64),9,now+120],
  [opId,-1,now+120],
  [opId,9,now+601],
  [opId,9,now+3]
 ]){
  assert.throws(()=>exactIssuerCall({claim,opId:id,nonce,deadline,now}),/T1E_/);
 }
});
const original={
 ...claim,stage:'ISSUE_HASH_BOUND',
 issuer_op_id:opId,issuer_tx_nonce:'9',
 issuer_tx_data_hash:call.dataHash,issuer_tx_hash:txHash
};
const tx={
 hash:txHash,from:FIXED.issuerAuthority,to:ESCROW,nonce:'0x9',
 value:'0x0',input:call.data,blockHash,blockNumber:'0x99',chainId:'0x279f'
};
const receipt={
 transactionHash:txHash,from:FIXED.issuerAuthority,to:ESCROW,
 blockHash,blockNumber:'0x99',status:'0x1',logs:[],
};
function fakeRpc(over={}){
 return {async send(method,params){
  if(method==='eth_chainId')return over.chain||'0x279f';
  if(method==='eth_getTransactionByHash')return {...tx,...over.tx};
  if(method==='eth_getTransactionReceipt')return over.receipt===null?null:{...receipt,...over.receipt};
  if(method==='eth_blockNumber')return '0xa0';
  if(method==='eth_getBlockByNumber')return {hash:over.canonicalHash||blockHash};
  if(method==='eth_call')throw Error('UNEXPECTED_STATE_READ_BEFORE_EVENT');
  throw Error('UNREVIEWED_METHOD');
 }};
}
test('UNKNOWN receipt cannot be confused with a confirmed Issued voucher',async()=>{
 const result=await attestIssuerReceipt({rpc:fakeRpc({receipt:null}),original,txHash});
 assert.equal(result.status,'UNKNOWN');
 assert.equal(result.mustNotRetry,true);
});
test('wrong chain, tx payer, nonce, calldata and hash reservations fail closed',async()=>{
 for(const [rpc,record] of [
  [fakeRpc({chain:'0x1'}),original],
  [fakeRpc({tx:{from:wrong}}),original],
  [fakeRpc({tx:{nonce:'0xa'}}),original],
  [fakeRpc({tx:{input:'0x1234'}}),original],
  [fakeRpc(),{...original,issuer_tx_hash:'0x'+'f'.repeat(64)}],
  [fakeRpc(),{...original,stage:'CONSENT_VERIFIED'}]
 ]){
  await assert.rejects(()=>attestIssuerReceipt({rpc,original:record,txHash}),/T1E_/);
 }
});
test('receipt success with no Issued event is never an accepted issuance',async()=>{
 await assert.rejects(()=>attestIssuerReceipt({
  rpc:fakeRpc(),original,txHash
 }),/T1E_EXACTLY_ONE_ISSUED_EVENT_REQUIRED/);
});
test('an Issued event is not enough without independently proven post-state',async()=>{
 const log=issueEvent.encodeEventLog(issueEvent.getEvent('Issued'),[
  FIRST_VOUCHER_ID,0,1,TERMS,now,now+259200
 ]);
 const withLog={...receipt,logs:[{address:ESCROW,topics:log.topics,data:log.data}]};
 await assert.rejects(()=>attestIssuerReceipt({
  rpc:fakeRpc({receipt:withLog}),original,txHash
 }),/UNEXPECTED_STATE_READ_BEFORE_EVENT/);
});
