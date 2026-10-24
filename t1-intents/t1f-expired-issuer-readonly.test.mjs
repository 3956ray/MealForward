import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {receiptABI} from './t1f-issue-operation.mjs';
import {t0,FIXED,QUOTE_ID} from './t1e-first-issue-readiness.mjs';
import {ESCROW,MEAL,TERMS,PRICE} from './core.mjs';
import {inspectExpiredOriginalIssuer} from './t1f-expired-issuer-readonly.mjs';

const id='0x2e709dee8113d2dac73cbea53d016d6629fc3730c6f85325a17c98bc4777445b';
const hex=n=>'0x'+n.toString(16);
const hash='0x'+'d'.repeat(64),zero='0x'+'0'.repeat(64);
function fake({latest=0,pending=0,opKind=0,bucket=0,blockHash=hash}={}){
 const methods=[];
 const rpc={async send(method,params){
  methods.push(method);
  if(method==='eth_chainId')return '0x279f';
  if(method==='eth_blockNumber')return '0x46';
  if(method==='eth_getBlockByNumber')return {hash:blockHash,number:'0x46'};
  if(method==='eth_getTransactionCount'){
   assert.equal(params[0],FIXED.issuerAuthority);
   return hex(params[1]==='latest'?latest:pending)
  }
  if(method==='eth_call'){
   assert.equal(params[0].to,ESCROW);
   assert.equal(params[1],'0x46');
   const sel=params[0].data.slice(0,10);
   if(sel===receiptABI.getFunction('getOperation').selector){
    const call=receiptABI.decodeFunctionData('getOperation',params[0].data);
    assert.equal(call[0],id);
    return receiptABI.encodeFunctionResult('getOperation',[
     [opKind,opKind?FIXED.issuerAuthority:'0x'+'0'.repeat(40),
      zero,zero,0]
    ]);
   }
   if(sel===t0.getFunction('getUnit').selector)
    return t0.encodeFunctionResult('getUnit',[
     ['0x'+'f'.repeat(64),0,FIXED.issuerAuthority,MEAL,1,TERMS,PRICE,
      bucket,0,zero]
    ]);
  }
  throw Error('UNREVIEWED_RPC_'+method)
 }};
 return {rpc,methods};
}
test('reads reserved original wallet nonce without Claim writes or tx broadcast',async()=>{
 const {rpc,methods}=fake();
 const p=await inspectExpiredOriginalIssuer({rpc});
 assert.equal(p.status,'T1F_EXPIRED_NO_ISSUE_OBSERVED_NOT_ABSENCE_PROOF');
 assert.equal(p.originalOperationSeen,false);
 assert.equal(p.unitAvailable,true);
 assert.equal(p.issuerLatestNonce,'0');
 assert.equal(p.issuerPendingNonce,'0');
 assert.equal(p.canIssueOrResetAutomatically,false);
 assert.equal(p.noPendingTxProven,false);
 assert.equal(p.userWalletActivityMustBeChecked,true);
 assert.equal(p.sendOrWalletActionsPerformed,0);
 assert.ok(methods.includes('eth_getTransactionCount'));
 assert.ok(!methods.includes('eth_sendTransaction'));
});
test('pending/latest nonce ambiguity or operation change NEVER authorizes retry',async()=>{
 for(const options of [{pending:1},{latest:1,pending:1}]){
  const x=await inspectExpiredOriginalIssuer(fake(options));
  assert.equal(x.status,'T1F_EXPIRED_CHAIN_ACTIVITY_MANUAL_INVESTIGATION_REQUIRED');
  assert.equal(x.canIssueOrResetAutomatically,false);
 }
 await assert.rejects(
  ()=>inspectExpiredOriginalIssuer(fake({latest:2,pending:1})),
  /T1F_EXPIRED_PENDING_NONCE_BEHIND_LATEST/
 );
 await assert.rejects(
  ()=>inspectExpiredOriginalIssuer(fake({opKind:5})),
  /T1F_EXPIRED_ORIGINAL_OPERATION_UNKNOWN/
 );
});
test('no secret keys or onchain broadcaster in expired read-only diagnostic',()=>{
 const code=readFileSync(new URL('./t1f-expired-issuer-readonly.mjs',import.meta.url),'utf8');
 assert.equal(code.includes('new Wallet('),false);
 assert.equal(code.includes('privateKeyToAccount'),false);
 assert.equal(code.includes("method:'eth_send"),false);
 assert.equal(code.includes('pg.Pool'),false);
});
