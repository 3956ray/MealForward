import test from 'node:test';
import assert from 'node:assert/strict';
import {approvalRpcFixture,HEX} from './t1f-approval-test-fixture.mjs';
import {receiptABI} from './t1f-issue-operation.mjs';
import {t0} from './t1e-first-issue-readiness.mjs';
import {MEAL,TERMS,PRICE,QUOTE} from './core.mjs';
import {PHASE8_FIXED as F,PHASE8_OBSERVATION_KEYS,buildRecoveryManifest} from './t1f-phase8-protocol.mjs';
import {observeRecovery} from './t1f-phase8-observe.mjs';
const NOW=1793081000,HEAD=74584004,FINAL=74584000,hex=n=>'0x'+n.toString(16);
async function fixture({mode,kind,anchor,mutate}={}){
 const base=await approvalRpcFixture({blockTime:NOW-1}),calls=[],counts=new Map();
 const rpc={async send(method,args=[]){calls.push([method,args]);
  if(method==='eth_blockNumber')return hex(HEAD);
  if(method==='eth_getBlockByNumber'){
   if(args[0]==='finalized'&&mode==='unsupported')throw Error('finalized unsupported');
   const n=args[0]==='finalized'?FINAL:Number(BigInt(args[0])),count=(counts.get(n)||0)+1;counts.set(n,count);
   const b={number:hex(n),hash:HEX(n===FINAL?'a':n===HEAD?'b':'c'),timestamp:hex(n===FINAL?NOW-3:NOW-1)};
   if(mode==='unexpired'&&n===FINAL)b.timestamp=hex(F.predecessor.issuer_issue_deadline-1);
   if(mode==='stale')b.timestamp=hex(NOW-121);
   if(mode==='reorg'&&n===FINAL&&count>1)b.hash=HEX('f');
   if(mode==='historical-reorg'&&n===HEAD-10)b.hash=HEX('f');
   return b;
  }
  if(method==='eth_getTransactionCount'&&mode==='nonce')return '0x1';
  if(method==='eth_call'){
   const at=Number(BigInt(args[1])),tx=args[0];
   if(tx.data.startsWith(receiptABI.getFunction('getOperation').selector)){
    const op=receiptABI.decodeFunctionData('getOperation',tx.data)[0];
    if(mode==='seen'&&at===(anchor==='finalized'?FINAL:HEAD)&&op===(kind==='original'?F.originalOperationId:F.predecessor.operation_id))return receiptABI.encodeFunctionResult('getOperation',[[5,F.issuer,HEX('d'),F.voucherId,NOW-10]]);
   }
   if(mode==='generation'&&tx.data.startsWith(t0.getFunction('getUnit').selector)&&at===FINAL)return t0.encodeFunctionResult('getUnit',[[HEX('f'),0,QUOTE,MEAL,1,TERMS,PRICE,0,1,HEX('0')]]);
  }
  const result=await base.rpc.send(method,args);return mutate?mutate(method,args,result):result;
 }};
 return {rpc,calls};
}
test('observes exact protocol evidence with finalized expiry and fresh head; no wallet/simulation/broadcast',async()=>{
 const f=await fixture(),o=await observeRecovery({rpc:f.rpc,clock:()=>NOW});
 assert.deepEqual(Object.keys(o).sort(),[...PHASE8_OBSERVATION_KEYS].sort());assert.equal(o.finalizedBlockNumber,String(FINAL));assert.equal(o.observedBlockNumber,String(HEAD));assert.equal(o.originalOperationSeen,false);assert.equal(o.predecessorOperationSeen,false);
 assert.equal(buildRecoveryManifest({predecessor:F.predecessor,observation:o,walletObservation:{value:'ISSUER_REPORTED_NO_PENDING_OR_SENT_TRANSACTIONS',observedAt:NOW},now:NOW,newOpId:HEX('d'),nonceDomain:HEX('e')}).domain.version,'2');
 assert.ok(f.calls.every(([m])=>!m.includes('send')&&!m.includes('sign')));
 assert.equal(f.calls.filter(([m,a])=>m==='eth_getTransactionCount'&&a[1]===hex(HEAD)).length,1);
 assert.equal(f.calls.filter(([m,a])=>m==='eth_call'&&a[0].data.startsWith(t0.getFunction('issue').selector)).length,0);
});
test('finalized unavailable never falls back, expiry/staleness/generation/nonce/reorg block',async()=>{
 for(const mode of ['unsupported','unexpired','stale','generation','nonce','reorg']){const f=await fixture({mode});await assert.rejects(observeRecovery({rpc:f.rpc,clock:()=>NOW}));}
});
test('any original or predecessor operation at finalized or head blocks',async()=>{
 for(const kind of ['original','predecessor'])for(const anchor of ['finalized','head']){const f=await fixture({mode:'seen',kind,anchor});await assert.rejects(observeRecovery({rpc:f.rpc,clock:()=>NOW}),/OPERATION_SEEN/);}
});
test('stored signed anchors are checked by identity and time, never accepted from row alone',async()=>{
 const row={value:{finalizedBlockNumber:String(FINAL),finalizedBlockHash:HEX('a'),finalizedBlockTime:String(NOW-3),observedBlockNumber:String(HEAD-10),observedBlockHash:HEX('c'),observedBlockTime:String(NOW-1)}};
 let f=await fixture();await observeRecovery({rpc:f.rpc,row,clock:()=>NOW});
 f=await fixture({mode:'historical-reorg'});await assert.rejects(observeRecovery({rpc:f.rpc,row,clock:()=>NOW}),/HISTORICAL/);
 f=await fixture();await assert.rejects(observeRecovery({rpc:f.rpc,row:{value:{...row.value,finalizedBlockTime:String(NOW-2)}},clock:()=>NOW}),/HISTORICAL/);
});
