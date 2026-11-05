/** Internal persistence adapter. Never expose globalRecords/platformOutbox in HTTP DTOs.
 * All target transactions use the same root transaction/row lock. No chain IO here.
 */
const check=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code,status:409});};
const claimPending=new Set(['QUEUED','SIGNED','SEND_UNKNOWN','HASH_BOUND']);
const walletPending=new Set(['AWAITING_HANDOVER','PREPARED','SEND_UNKNOWN','HASH_BOUND']);
const walletCollections=['intents','approvals','publications','redemptions'];
const entityCollections=['kitchens','publishedMeals','drafts','reviews','intents','requests','approvals','approvalRequests','publications','publicationReviews','publicationRequests','claims','claimReviews','claimRequests','vouchers','displays','verificationHandles','redemptions','redemptionReviews','redemptionRequests','kitchenSettings','kitchenSettingRequests','indexedBatches','autoSettlements'];
const reserved=new Set(['targetStates','platformOutbox','redemptionRates','impactProjection']);
export const TARGET_SCOPE=Symbol.for('mealforward.product.targetScope');
const address=value=>{check(typeof value==='string'&&/^0x[0-9a-f]{40}$/i.test(value),'INVALID_WALLET');return value.toLowerCase();};
export function makeTargetStore({store,registry,targetId,clock=()=>Math.floor(Date.now()/1000)}) {
  registry.get(targetId);check(store?.read&&store?.transact,'ROOT_STORE_REQUIRED');
  const roots=new WeakMap();
  function states(root){
    const result=[{targetId:registry.legacyTargetId,state:root}];
    for(const [id,state] of Object.entries(root.targetStates||{})){
      registry.get(id);check(id!==registry.legacyTargetId,'DUPLICATE_LEGACY_STATE');
      result.push({targetId:id,state});
    }return result;
  }
  function globalRecords(view,collection){
    const root=roots.get(view);check(root,'TARGET_TRANSACTION_REQUIRED');
    return states(root).flatMap(({targetId:id,state})=>Object.values((id===targetId?view:state)[collection]||{}).map(record=>{
      check(record&&typeof record==='object'&&(record.targetId===undefined?(id===registry.legacyTargetId||id===targetId):record.targetId===id),'TARGET_RECORD_MISMATCH');
      return {...structuredClone(record),targetId:id};
    }));
  }
  function globalClaimStatus(view,wallet,{now=clock()}={}){
    wallet=address(wallet);check(Number.isSafeInteger(now)&&now>=0,'INVALID_CLOCK');
    const pending=globalRecords(view,'claims').filter(c=>c.wallet?.toLowerCase()===wallet&&claimPending.has(c.state));
    let nextEligibleAt=0;
    for(const v of globalRecords(view,'vouchers'))if(v.wallet?.toLowerCase()===wallet&&v.state!=='CANCELLED'){
      check(Number.isSafeInteger(v.claimedAt)&&v.claimedAt>=0,'INVALID_CLAIM_HISTORY');
      nextEligibleAt=Math.max(nextEligibleAt,v.claimedAt+registry.get(v.targetId).policySeconds);
    }
    return {pending:pending.map(c=>({id:c.id,targetId:c.targetId,state:c.state})),nextEligibleAt,eligible:pending.length===0&&nextEligibleAt<=now};
  }
  function assertClaimEligible(view,wallet,options){
    const status=globalClaimStatus(view,wallet,options);check(status.pending.length===0,'CLAIM_PENDING');check(status.nextEligibleAt<=(options?.now??clock()),'CLAIM_COOLDOWN');return status;
  }
  function viewOf(root){
    states(root);
    const bucket=targetId===registry.legacyTargetId?root:((root.targetStates||={})[targetId]||={drafts:{},reviews:{},intents:{},requests:{}});
    for(const collection of entityCollections)for(const record of Object.values(bucket[collection]||{}))check(record.targetId===targetId||record.targetId===undefined&&targetId===registry.legacyTargetId,'TARGET_RECORD_MISMATCH');
    const view=Object.fromEntries(Object.entries(bucket).filter(([key])=>!reserved.has(key)));
    for(const shared of ['platformOutbox','redemptionRates'])Object.defineProperty(view,shared,{enumerable:true,get:()=>root[shared],set:value=>{root[shared]=value;}});
    Object.defineProperty(view,TARGET_SCOPE,{value:{hasPendingPlatformTransactions:()=>hasPendingPlatformTransactions(view),globalClaimStatus:(wallet,options)=>globalClaimStatus(view,wallet,options),globalRecords:collection=>globalRecords(view,collection)}});
    roots.set(view,root);return {view,bucket};
  }
  function hasPendingPlatformTransactions(view){return ['claims','autoSettlements'].some(collection=>globalRecords(view,collection).some(o=>['SIGNED','SEND_UNKNOWN','HASH_BOUND'].includes(o.state)));}
  function flush(view,bucket){
    for(const key of Object.keys(bucket))if(!reserved.has(key)&&!Object.hasOwn(view,key))delete bucket[key];
    for(const [key,value] of Object.entries(view))if(!reserved.has(key))bucket[key]=value;
  }
  function stampResult(value){
    if(!value||typeof value!=='object')return value;
    if(Array.isArray(value)){value.forEach(stampResult);return value;}
    if(typeof value.id==='string'){check(value.targetId===undefined||value.targetId===targetId,'TARGET_RECORD_MISMATCH');value.targetId=targetId;}
    for(const nested of Object.values(value))if(nested&&typeof nested==='object')stampResult(nested);
    return value;
  }
  return {targetId,globalRecords,globalClaimStatus,assertClaimEligible,hasPendingPlatformTransactions,
    async read(){const root=structuredClone(await store.read());return viewOf(root).view;},
    async transact(change){return store.transact(async root=>{
      const {view,bucket}=viewOf(root),before=structuredClone(view),result=await change(view);
      check(!Object.hasOwn(view,'targetStates'),'TARGET_NAMESPACE_RESERVED');
      // Stamp before publishing a new bucket so every new persisted entity has a target.
      for(const collection of entityCollections)for(const [id,record] of Object.entries(view[collection]||{})){
        check(record&&typeof record==='object'&&!Array.isArray(record),'INVALID_TARGET_RECORD');
        const old=before[collection]?.[id];
        check(record.targetId===undefined||record.targetId===targetId,'TARGET_RECORD_MISMATCH');
        if(old?.targetId!==undefined)check(record.targetId===old.targetId,'TARGET_RECORD_MISMATCH');
        if(!old||targetId!==registry.legacyTargetId)record.targetId=targetId;
      }
      flush(view,bucket);
      for(const [id,c] of Object.entries(view.claims||{}))if(!before.claims?.[id]&&claimPending.has(c.state)){
        const status=globalClaimStatus(view,c.wallet);
        check(status.pending.every(p=>p.targetId===targetId&&p.id===c.id),'CLAIM_PENDING');
        check(status.nextEligibleAt<=clock(),'CLAIM_COOLDOWN');
      }
      // Ordinary wallet nonce admission also spans targets; keep original queries/recovery free.
      for(const collection of walletCollections)for(const [id,op] of Object.entries(view[collection]||{}))if(!before[collection]?.[id]&&walletPending.has(op.state)){
        const w=address(op.wallet);
        const conflicts=walletCollections.flatMap(k=>globalRecords(view,k).filter(o=>o.wallet?.toLowerCase()===w&&walletPending.has(o.state)&&!(k===collection&&o.id===op.id&&o.targetId===targetId)));
        check(conflicts.length===0,'WALLET_OPERATION_PENDING');
      }
      return stampResult(result);
    });},
  };
}
