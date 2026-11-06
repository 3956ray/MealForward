import test from 'node:test';
import assert from 'node:assert/strict';
import {Wallet,keccak256,Transaction} from 'ethers';
import {makeAutoSettlement,settlementKey} from './auto-settlement.mjs';
import {redemptionCalldata} from './redemption-wire.mjs';
import {laneAvailable} from './platform-outbox.mjs';
function fixture(){
 const signer=Wallet.createRandom(),wallet=Wallet.createRandom().address.toLowerCase(),owner=Wallet.createRandom().address.toLowerCase(),id='0x'+'a'.repeat(64);
 let now=1000,nonce=0,paid=false,finalRevert=false,state={vouchers:{[id]:{id,generation:1,wallet,storeId:'store',state:'HANDED_OVER'}}},serial=Promise.resolve();const sends=[];
 const target={chainId:31337,escrow:'0x'+'b'.repeat(40),claimAuthority:signer.address.toLowerCase(),automaticSettlement:true,maxFeePerGas:'100',maxTransactionFee:'100000000'};
 const key=settlementKey(target,state.vouchers[id]);
 const store={read:async()=>structuredClone(state),transact(fn){const p=serial.then(async()=>{const s=structuredClone(state),v=await fn(s);state=s;return v;});serial=p.catch(()=>{});return p;}};
 const evidence={verified:true,finalized:true,voucherId:id,generation:1,recipient:wallet,owner,unitPrice:'100',chainTime:1000,settlementAvailableAt:900,blockNumber:1};
 const chain={target,voucherState:async()=>({...evidence,state:paid?'SETTLED':'HANDED_OVER'}),
 signAutoSettlement:async op=>{const raw=await signer.signTransaction({chainId:31337,to:target.escrow,nonce:nonce++,gasLimit:100000,gasPrice:1,value:0,data:redemptionCalldata(op)});return {verified:true,raw,hash:keccak256(raw)};},
 broadcastAutoSettlement:async raw=>{sends.push(Transaction.from(raw));return keccak256(raw);},
 verifyAutoSettlement:async op=>finalRevert?{verified:true,finalized:true,voucherId:id,generation:1,txHash:op.txHash,outcome:'REVERTED'}:{verified:false},
 findSettlement:async()=>paid?{verified:true,finalized:true,voucherId:id,generation:1,txHash:'0x'+'c'.repeat(64),receiver:owner,amount:'100',outcome:'CONFIRMED'}:{verified:false}};
 const queue=makeAutoSettlement({store,chain,clock:()=>now});
 return {store,chain,queue,key,sends,target,paid:()=>{paid=true;},revert:()=>{finalRevert=true;},advance:()=>{now+=30;},task:async()=>(await store.read()).autoSettlements[key]};
}
test('independent review: final revert retries only after delay, new nonce, bounded history',async()=>{
 const f=fixture();await f.queue.tick();f.revert();
 for(let n=0;n<4;n++){
  await f.queue.reconcile(f.key);assert.equal((await f.task()).state,'REVERTED');
  await f.queue.reconcile(f.key);
  if(n===3){assert.equal((await f.task()).state,'REVERTED');break;}
  assert.equal((await f.task()).state,'DELAYED');assert.equal((await f.task()).attempts.length,n+1);
  await f.queue.signNext();assert.equal(f.sends.length,n+1);f.advance();await f.queue.tick();
 }
 assert.deepEqual(f.sends.map(tx=>tx.nonce),[0,1,2,3]);assert.equal(laneAvailable(await f.store.read(),f.target),true);
});
test('independent review: third party payment before signing records payment without sending',async()=>{
 const f=fixture();f.paid();await f.queue.tick();assert.equal(f.sends.length,0);assert.equal((await f.task()).state,'CONFIRMED');
});
test('independent review: external payment cannot release uncertain original nonce',async()=>{
 const f=fixture();await f.queue.tick();f.paid();await f.queue.tick();
 assert.equal((await f.task()).state,'SEND_UNKNOWN');assert.equal(laneAvailable(await f.store.read(),f.target),false);assert.equal(f.sends.length,1);
 f.revert();await f.queue.tick();await f.queue.tick();assert.equal((await f.task()).state,'CONFIRMED');assert.equal(f.sends.length,1);
});
test('independent review: restart and simultaneous revert recovery schedule one retry',async()=>{
 const f=fixture();await f.queue.tick();f.revert();await f.queue.reconcile(f.key);
 const other=makeAutoSettlement({store:f.store,chain:f.chain,clock:()=>1000});
 await Promise.all([f.queue.reconcile(f.key),other.reconcile(f.key)]);assert.equal((await f.task()).attempts.length,1);
 f.advance();await f.queue.tick();assert.equal(f.sends.length,2);
});
test('independent review: stale retry proof cannot requeue a later reverted attempt',async()=>{
 const f=fixture();await f.queue.tick();f.revert();await f.queue.reconcile(f.key);
 const original=f.chain.voucherState;let release,entered,first=true;
 const started=new Promise(resolve=>{entered=resolve;});
 f.chain.voucherState=async v=>{if(first){first=false;entered();await new Promise(resolve=>{release=resolve;});}return original(v);};
 const late=f.queue.reconcile(f.key);await started;
 await f.queue.reconcile(f.key);f.advance();await f.queue.tick();await f.queue.reconcile(f.key);
 assert.equal((await f.task()).state,'REVERTED');const hash=(await f.task()).txHash;
 release();await late;
 assert.equal((await f.task()).state,'REVERTED');assert.equal((await f.task()).txHash,hash);assert.equal((await f.task()).attempts.length,1);
});
