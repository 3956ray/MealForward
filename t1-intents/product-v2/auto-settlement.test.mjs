import test from 'node:test';
import assert from 'node:assert/strict';
import {Wallet,keccak256} from 'ethers';
import {makeAutoSettlement,settlementKey} from './auto-settlement.mjs';
import {redemptionCalldata} from './redemption-wire.mjs';
import {laneAvailable} from './platform-outbox.mjs';
const signer=Wallet.createRandom(),recipient=Wallet.createRandom().address.toLowerCase(),owner=Wallet.createRandom().address.toLowerCase();
function fixture(){
 let now=1000,chainTime=1179,sends=0,nonce=0,receipt=null,state={vouchers:{['0x'+'3'.repeat(64)]:{id:'0x'+'3'.repeat(64),generation:1,wallet:recipient,storeId:'k',state:'HANDED_OVER'}}},serial=Promise.resolve();
 const store={read:async()=>structuredClone(state),transact(fn){const result=serial.then(async()=>{const next=structuredClone(state),out=await fn(next);state=next;return out;});serial=result.catch(()=>{});return result;}};
 const target={chainId:31337,escrow:'0x'+'4'.repeat(40),claimAuthority:signer.address.toLowerCase(),automaticSettlement:true,maxFeePerGas:'100',maxTransactionFee:'100000000'};
 const chain={target,voucherState:async v=>({verified:true,finalized:true,voucherId:v.id,generation:1,recipient,owner,unitPrice:'1000000',state:receipt?.outcome==='CONFIRMED'?'SETTLED':'HANDED_OVER',settlementAvailableAt:1180,chainTime,blockNumber:50}),
 signAutoSettlement:async op=>{const raw=await signer.signTransaction({chainId:31337,to:target.escrow,nonce:nonce++,value:0,gasLimit:100000,gasPrice:1,data:redemptionCalldata(op)});return {verified:true,raw,hash:keccak256(raw)};},
 broadcastAutoSettlement:async raw=>{sends++;return keccak256(raw);},verifyAutoSettlement:async op=>receipt?{verified:true,finalized:true,txHash:op.txHash,voucherId:op.voucherId,generation:1,receiver:owner,amount:'1000000',...receipt}:{verified:false},findSettlement:async()=>({verified:false})};
 const queue=makeAutoSettlement({store,chain,clock:()=>now});return {store,chain,queue,target,setTime:t=>{chainTime=t;now=t;},sends:()=>sends,settle:r=>receipt=r,key:()=>settlementKey(target,Object.values(state.vouchers)[0])};
}
test('179 seconds does not sign; 180 seconds dispatches and finalized payment alone marks paid',async()=>{
 const f=fixture();await f.queue.tick();assert.equal(f.sends(),0);f.setTime(1180);await f.queue.tick();assert.equal(f.sends(),1);assert.equal((await f.store.read()).autoSettlements[f.key()].state,'SEND_UNKNOWN');
 await f.queue.tick();assert.equal(f.sends(),1);f.settle({outcome:'CONFIRMED'});await f.queue.tick();assert.equal((await f.store.read()).autoSettlements[f.key()].state,'CONFIRMED');assert.equal(laneAvailable(await f.store.read(),f.target),true);
});
test('two workers and restart share one persisted packet and never repeat unknown submission',async()=>{
 const f=fixture();f.setTime(1180);const second=makeAutoSettlement({store:f.store,chain:f.chain});await Promise.all([f.queue.tick(),second.tick()]);assert.equal(f.sends(),1);await second.tick();assert.equal(f.sends(),1);
});
test('a lost broadcast response keeps the nonce lane blocked without declaring paid',async()=>{
 const f=fixture();f.setTime(1180);let sends=0;f.chain.broadcastAutoSettlement=async()=>{sends++;throw Error('network lost');};await f.queue.tick();await f.queue.tick();assert.equal(sends,1);assert.equal(laneAvailable(await f.store.read(),f.target),false);assert.equal((await f.store.read()).autoSettlements[f.key()].state,'SEND_UNKNOWN');
});
test('claim nonce lane blocks settlement signing across targets',async()=>{
 const f=fixture();f.setTime(1180);await f.store.transact(s=>{s.platformOutbox={[`${f.target.chainId}:${f.target.claimAuthority}`]:{id:'claim-other-target',state:'SIGNED',nonce:0}};});await f.queue.tick();assert.equal(f.sends(),0);
});
test('wrong receiver evidence cannot release a signed packet or mark a voucher settled',async()=>{
 const f=fixture();f.setTime(1180);await f.queue.tick();f.settle({outcome:'CONFIRMED',receiver:recipient});await f.queue.tick();assert.equal((await f.store.read()).vouchers['0x'+'3'.repeat(64)].state,'HANDED_OVER');assert.equal(laneAvailable(await f.store.read(),f.target),false);
});
test('fee/balance refusal delays a task without broadcasting or allocating a nonce lane',async()=>{
 const f=fixture();f.setTime(1180);f.chain.signAutoSettlement=async()=>{throw Error('PLATFORM_BALANCE_LOW');};await f.queue.tick();assert.equal(f.sends(),0);const t=(await f.store.read()).autoSettlements[f.key()];assert.equal(t.state,'DELAYED');assert.equal(t.reason,'PLATFORM_BALANCE_LOW');assert.equal(laneAvailable(await f.store.read(),f.target),true);
});
test('old targets never enqueue or sign automatic settlements',async()=>{const f=fixture();f.chain.target={...f.target,automaticSettlement:false};const q=makeAutoSettlement({store:f.store,chain:f.chain});await q.tick();assert.equal((await f.store.read()).autoSettlements,undefined);assert.equal(f.sends(),0);});
