import {createHash} from 'node:crypto';
import {laneAvailable,reservePacket,updatePacket,platformPending} from './platform-outbox.mjs';
import {validateSettlementPacket} from './settlement-wire.mjs';
const copy=structuredClone;
const assert=(ok,message)=>{if(!ok)throw Error(message);};
export const settlementKey=(target,v)=>`${target.chainId}:${target.escrow.toLowerCase()}:${v.id}:${v.generation}`;
export function makeAutoSettlement({store,chain,clock=()=>Math.floor(Date.now()/1000)}){
 const target=chain.target,enabled=target.automaticSettlement===true;
 const publicTask=t=>({id:t.id,voucherId:t.voucherId,generation:t.generation,state:t.state,receiver:t.receiver,amount:t.amount,availableAt:t.availableAt,...(t.txHash?{txHash:t.txHash}:{}),...(t.reason?{reason:t.reason}:{}),updatedAt:t.updatedAt});
 function evidence(v,e){assert(e?.verified===true&&e.finalized===true&&e.voucherId===v.id&&e.generation===v.generation&&e.recipient?.toLowerCase()===v.wallet.toLowerCase()&&/^0x[0-9a-f]{40}$/i.test(e.owner||'')&&/^[1-9][0-9]*$/.test(e.unitPrice||''),'SETTLEMENT_EVIDENCE_UNVERIFIED');}
 async function scan(){if(!enabled)return;const snapshot=await store.read();
  for(const v of Object.values(snapshot.vouchers||{})){
   if(snapshot.autoSettlements?.[settlementKey(target,v)])continue;
   try{const e=await chain.voucherState(copy(v));evidence(v,e);if(!['HANDED_OVER','SETTLED'].includes(e.state))continue;
    await store.transact(s=>{s.autoSettlements||={};const key=settlementKey(target,v);if(s.autoSettlements[key])return;
     s.autoSettlements[key]={id:createHash('sha256').update(key).digest('hex'),key,targetId:`${target.chainId}:${target.escrow.toLowerCase()}`,kind:'settlement',voucherId:v.id,generation:v.generation,storeId:v.storeId,wallet:target.claimAuthority,receiver:e.owner.toLowerCase(),amount:e.unitPrice,availableAt:e.settlementAvailableAt,scanFrom:e.state==='HANDED_OVER'?e.blockNumber:undefined,state:'QUEUED',createdAt:clock(),updatedAt:clock()};
    });
   }catch{/* One unavailable voucher cannot block independent tasks. */}
  }
 }
 async function reconcile(key){const task=(await store.read()).autoSettlements?.[key];if(!task||task.state==='CONFIRMED')return;
  let result;if(platformPending(task.state))result=await chain.verifyAutoSettlement(copy(task));else result=await chain.findSettlement(copy(task));
  if(result?.verified!==true||result.finalized!==true){
   if(task.state==='REVERTED'&&(task.attempts?.length||0)<3){const v=(await store.read()).vouchers[task.voucherId],e=await chain.voucherState(copy(v));evidence(v,e);
    if(e.state==='HANDED_OVER')await store.transact(s=>{const t=s.autoSettlements[key];if(t.state!=='REVERTED'||t.txHash!==task.txHash||t.generation!==task.generation||t.receiver!==task.receiver||t.amount!==task.amount||(t.attempts?.length||0)>=3)return;t.attempts||=[];t.attempts.push({txHash:t.txHash,outcome:'REVERTED'});delete t.txHash;delete t.adapterBroadcastHash;t.state='DELAYED';t.retryAt=clock()+30;t.updatedAt=clock();});
   }return;
  }
  assert(result.voucherId===task.voucherId&&result.generation===task.generation,'SETTLEMENT_EVIDENCE_MISMATCH');
  await store.transact(s=>{const current=s.autoSettlements[key];if(!current||current.state==='CONFIRMED')return;
   if(result.outcome==='CONFIRMED'){
    assert(result.receiver?.toLowerCase()===current.receiver&&result.amount===current.amount&&/^0x[0-9a-f]{64}$/i.test(result.txHash||''),'SETTLEMENT_EVIDENCE_MISMATCH');
    // An already signed competing packet must still be reconciled before its nonce lane is released.
    if(platformPending(current.state))assert(result.txHash===current.txHash,'SETTLEMENT_ORIGINAL_TX_REQUIRED');
    updatePacket(s,target,current,'CONFIRMED');current.state='CONFIRMED';current.txHash=result.txHash;delete current.packet;delete current.reason;
    const voucher=s.vouchers[current.voucherId];if(voucher&&voucher.generation===current.generation){voucher.state='SETTLED';delete voucher.pendingSettlementId;}
   }else if(result.outcome==='REVERTED'){
    assert(result.txHash===current.txHash,'SETTLEMENT_ORIGINAL_TX_REQUIRED');updatePacket(s,target,current,'REVERTED');current.state='REVERTED';current.reason='交易未执行，正在核对结算状态';delete current.packet;
   }current.updatedAt=clock();
  });
 }
 async function signNext(){if(!enabled)return null;return store.transact(async s=>{
  s.autoSettlements||={};if(!laneAvailable(s,target))return null;
  const candidates=Object.values(s.autoSettlements).filter(t=>['QUEUED','DELAYED'].includes(t.state)&&(!t.retryAt||t.retryAt<=clock())).sort((a,b)=>a.createdAt-b.createdAt);
  for(const t of candidates){try{
   const v=s.vouchers[t.voucherId];assert(v&&v.generation===t.generation,'SETTLEMENT_VOUCHER_CHANGED');
   const e=await chain.voucherState(copy(v));evidence(v,e);assert(e.owner.toLowerCase()===t.receiver&&e.unitPrice===t.amount,'SETTLEMENT_TERMS_CHANGED');
   if(e.state==='SETTLED')continue;
   assert(e.state==='HANDED_OVER','SETTLEMENT_NOT_READY');if(e.chainTime<e.settlementAvailableAt)continue;
   const packet=await chain.signAutoSettlement(copy(t));assert(packet?.verified===true,'SETTLEMENT_PACKET_UNVERIFIED');validateSettlementPacket(t,target,packet);
   reservePacket(s,target,t,'settlement',packet);t.packet=packet.raw;t.txHash=packet.hash.toLowerCase();t.state='SIGNED';delete t.reason;t.updatedAt=clock();return publicTask(t);
  }catch(err){t.state='DELAYED';t.reason=['SETTLEMENT_GAS_BUDGET_EXCEEDED','PLATFORM_BALANCE_LOW'].includes(err.message)?err.message:'SETTLEMENT_CHECK_UNAVAILABLE';t.retryAt=clock()+30;t.updatedAt=clock();}}
  return null;
 });}
 async function dispatch(key){const packet=await store.transact(s=>{const t=s.autoSettlements?.[key];assert(t?.state==='SIGNED','SETTLEMENT_ALREADY_ATTEMPTED');t.state='SEND_UNKNOWN';t.updatedAt=clock();updatePacket(s,target,t,t.state);return {raw:t.packet,hash:t.txHash};});
  try{assert((await chain.broadcastAutoSettlement(packet.raw)).toLowerCase()===packet.hash,'SETTLEMENT_HASH_MISMATCH');}catch{/* Never create another packet after a broadcast uncertainty. */}
 }
 return {scan,reconcile,signNext,dispatch,async tick(){if(!enabled)return;await scan();const items=Object.values((await store.read()).autoSettlements||{});for(const t of items){try{if(t.state==='SIGNED')await dispatch(t.key);else await reconcile(t.key);}catch{}}const signed=await signNext();if(signed){const task=Object.values((await store.read()).autoSettlements||{}).find(t=>t.id===signed.id);await dispatch(task.key);}},async status(voucherId){const items=Object.values((await store.read()).autoSettlements||{}).filter(t=>t.voucherId===voucherId);return items.map(publicTask);}};
}
