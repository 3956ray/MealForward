import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FIXED,originalVoucherId} from './t1e-first-issue-readiness.mjs';
import {CHAIN,ESCROW,MEAL,TERMS} from './core.mjs';
import {makeSuccessorIssuerLedger} from './t1f-successor-issuer-ledger.mjs';
import {ORIGINAL_OPERATION,ORIGINAL_DATA_HASH,ORIGINAL_DEADLINE,ORIGINAL_CLAIM}
 from './t1f-successor-issue-protocol.mjs';

const original={
 claim_id:ORIGINAL_CLAIM,
 funding_intent:'2b9ae6f1-2bb7-4096-8136-70f30f302eea',
 stage:'ISSUE_UNKNOWN',revision:2,issuer_op_id:ORIGINAL_OPERATION,
 issuer_tx_nonce:'0',issuer_issue_deadline:ORIGINAL_DEADLINE.toString(),
 issuer_tx_data_hash:ORIGINAL_DATA_HASH,issuer_tx_hash:null,
 receipt_block:null,receipt_block_hash:null,
 chain_id:CHAIN,escrow:ESCROW,meal_id:MEAL,terms_hash:TERMS,
 unit_seq:0,generation:1,
 beneficiary_wallet:'0x2539fefe77a5ce4d09d2225c2e8a7517b22b9135',
 issuer_wallet:FIXED.issuerAuthority,voucher_id:originalVoucherId(0,1n),
 consent_digest:'0x'+'2'.repeat(64),
 consent_signature_fingerprint:'0x'+'3'.repeat(64)
};
const successor={
 successor_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 claim_id:ORIGINAL_CLAIM,slot_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 release_id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
 chain_id:CHAIN,escrow:ESCROW,voucher_id:original.voucher_id,
 issuer_wallet:FIXED.issuerAuthority,operation_id:'0x'+'f'.repeat(64),
 issuer_nonce:'0',issuer_issue_deadline:'1792892000',
 calldata_hash:'0x'+'9'.repeat(64),stage:'ISSUE_UNKNOWN',
 revision:'0',tx_hash:null,receipt_block:null,receipt_block_hash:null
};
function make({withSuccessor=false}={}){
 const queries=[];
 const pool={
  async query(sql,args){
   queries.push({sql,args});
   if(sql.includes('FROM mf_t1e.recipient_claims'))
    return {rowCount:1,rows:[original]};
   if(sql.includes('FROM mf_t1e.successor_issue_operations'))
    return {rowCount:withSuccessor?1:0,rows:withSuccessor?[successor]:[]};
   throw Error('UNREVIEWED_SQL_'+sql);
  },
  async connect(){throw Error('WALLET_OR_DB_RELEASE_MUST_NOT_BE_USED_IN_READ_TEST')}
 };
 const rpc={async send(){throw Error('READ_ONLY_CHAIN_NOT_NEEDED_FOR_ALREADY_RESERVED')}};
 return {ledger:makeSuccessorIssuerLedger({pool,rpc}),queries};
}
test('unregistered recipient, quote and operator cannot even inspect issuer successor',async()=>{
 const {ledger,queries}=make();
 for(const issuerWallet of [
  '0x2539fefe77a5ce4d09d2225c2e8a7517b22b9135',
  '0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952',
  FIXED.operatorAuthority
 ]){
  await assert.rejects(()=>ledger.state({issuerWallet}),
   /T1F_PHASE3_PINNED_ISSUER_SIWE_REQUIRED/);
  await assert.rejects(()=>ledger.reserve({issuerWallet}),
   /T1F_PHASE3_PINNED_ISSUER_SIWE_REQUIRED/);
 }
 assert.equal(queries.length,0,'wrong wallets cannot reach PG');
});
test('Issuer can only read original frozen Claim; no successor means no wallet tx',async()=>{
 const {ledger,queries}=make();
 const state=await ledger.state({issuerWallet:FIXED.issuerAuthority});
 assert.equal(state.status,'T1F_PHASE3_NO_SUCCESSOR_OPERATION');
 assert.equal(state.originalClaimStage,'ISSUE_UNKNOWN');
 assert.equal(state.maySend,false);
 assert.equal(queries.length,2);
});
test('already reserved successor returns recovery only and never a second send payload',async()=>{
 const {ledger,queries}=make({withSuccessor:true});
 const s=await ledger.reserve({issuerWallet:FIXED.issuerAuthority});
 assert.equal(s.created,false);
 assert.equal(s.recoveryOnly,true);
 assert.equal(s.issueTransaction,undefined);
 assert.equal(s.state.canSendAgain,false);
 assert.equal(s.state.legacyClaimUnchanged,true);
 assert.equal(s.state.operationId,successor.operation_id);
 assert.equal(queries.length,2);
});
test('legacy original Claim tampering aborts before any new release',async()=>{
 const s={...original,consent_digest:null};
 const pool={
  async query(sql){
   if(sql.includes('recipient_claims'))return {rowCount:1,rows:[s]};
   return {rowCount:0,rows:[]}
  },
  async connect(){throw Error('UNEXPECTED_WRITE')}
 };
 const ledger=makeSuccessorIssuerLedger({
  pool,rpc:{send:async()=>{throw Error('UNEXPECTED_RPC')}}
 });
 await assert.rejects(
  ()=>ledger.state({issuerWallet:FIXED.issuerAuthority}),
  /T1F_PHASE3_ORIGINAL_ISSUE_UNKNOWN_IMMUTABLE/
 );
});
test('source contains no backend broadcaster or legacy Claim mutation',()=>{
 const s=readFileSync(new URL('./t1f-successor-issuer-ledger.mjs',import.meta.url),'utf8');
 for(const val of [
  'eth_sendTransaction','eth_sendRawTransaction',
  'privateKeyToAccount','Wallet.fromPrivateKey',
  'UPDATE mf_t1e.recipient_claims','DELETE FROM mf_t1e.recipient_claims'
 ])assert.equal(s.includes(val),false,val);
 assert.match(s,/FOR UPDATE/);
 assert.match(s,/firstHumanWalletSendOnly:true/);
 assert.match(s,/T1F_PHASE5_SUCCESSOR_RELEASE_HOLD_NOT_CLEARED/);
 assert.match(s,/release\.rows\[0\]\?\.stage==='RELEASED_FOR_ONE_ISSUE'/);
 assert.match(s,/recoveryOnly:true,issueTransaction:undefined/);
});
