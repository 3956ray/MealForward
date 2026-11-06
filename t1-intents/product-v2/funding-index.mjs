/** Bounded, read-only canonical funding ingestion for application-registered stores.
 * No signer or broadcast interface. One store and at most ten blocks per call. */
import {fundingInterface,chainReference} from './funding-wire.mjs';
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const check=(value,code='FUNDING_INDEX_EVIDENCE')=>{if(!value)throw Object.assign(Error(code),{code,status:503});};
const normalize=x=>Array.isArray(x)?x.map(normalize):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,normalize(v)])):x;
const stable=x=>JSON.stringify(normalize(x));
const hash=x=>typeof x==='string'&&/^0x[0-9a-f]{64}$/i.test(x);
export function makeFundingIndex({provider,store,target,deploymentBlock,context,verifyLog,maxRecords=4096,pageBlocks=10,clock=()=>Date.now()}){
 check(Number.isSafeInteger(deploymentBlock)&&deploymentBlock>=0&&Number.isSafeInteger(pageBlocks)&&pageBlocks>0&&pageBlocks<=10&&Number.isSafeInteger(maxRecords)&&maxRecords>0&&maxRecords<=10000,'FUNDING_INDEX_CONFIGURATION');
 const identity={chainId:target.chainId,escrow:target.escrow.toLowerCase(),asset:target.asset.toLowerCase(),deploymentBlock};
 const identityJSON=stable(identity),failures=new Map();let auditPosition=0;
 function backoff(id){const count=Math.min((failures.get(id)?.count??0)+1,5);failures.set(id,{count,retryAt:clock()+Math.min(5000*2**(count-1),60000)});}
 async function canonical(block){check(block&&Number.isSafeInteger(block.number)&&hash(block.hash),'FUNDING_INDEX_BLOCK');const current=await provider.getBlock(block.number);check(current&&same(current.hash,block.hash),'FUNDING_INDEX_REORG');}
 return {async sync(){
  const ctx=await context(),s=await store.read();await canonical(ctx.block);
  check(!s.fundingIndex||stable(s.fundingIndex.target)===identityJSON,'FUNDING_INDEX_TARGET_CHANGED');
  const registrations=Object.values(s.publications||{}).filter(p=>p.kind==='registration'&&p.state==='CONFIRMED'&&p.confirmedBlock<=ctx.block.number);
  const unique=[...new Map(registrations.map(p=>[p.storeId,p])).values()];check(unique.length<=maxRecords,'FUNDING_INDEX_STORE_LIMIT');
  const storeIds=new Set(unique.map(p=>p.storeId));for(const id of failures.keys())if(!storeIds.has(id))failures.delete(id);
  async function validateCursor(p,cursor){check(Number.isSafeInteger(cursor.throughBlock)&&cursor.throughBlock>=Math.max(deploymentBlock,p.confirmedBlock)&&cursor.throughBlock<=ctx.block.number&&hash(cursor.blockHash),'FUNDING_INDEX_CURSOR');await canonical({number:cursor.throughBlock,hash:cursor.blockHash});}
  // Recheck a bounded rotating cursor even after catch-up. A finalized fork or
  // a future cursor cannot silently become a successful no-op forever.
  const audit=unique.filter(p=>s.fundingIndex?.stores?.[p.storeId]&&(failures.get(p.storeId)?.retryAt??0)<=clock());
  if(audit.length){const p=audit[auditPosition++%audit.length];try{await validateCursor(p,s.fundingIndex.stores[p.storeId]);}catch(error){backoff(p.storeId);throw error;}}
  const candidates=unique.map(p=>({p,start:Math.max(deploymentBlock,p.confirmedBlock),cursor:s.fundingIndex?.stores?.[p.storeId]})).filter(x=>(x.cursor?.throughBlock??x.start-1)<ctx.block.number);
  const available=candidates.filter(x=>(failures.get(x.p.storeId)?.retryAt??0)<=clock()).sort((a,b)=>(a.cursor?.throughBlock??a.start-1)-(b.cursor?.throughBlock??b.start-1)||a.p.storeId.localeCompare(b.p.storeId));
  if(!available.length)return {verified:true,advanced:false,finalizedBlock:ctx.block.number,...(candidates.length||failures.size?{reason:'BACKOFF'}:{})};
  const {p,cursor,start}=available[0],fromBlock=(cursor?.throughBlock??start-1)+1,toBlock=Math.min(fromBlock+pageBlocks-1,ctx.block.number);
  try {
  if(cursor)await validateCursor(p,cursor);
  const end=await provider.getBlock(toBlock);await canonical(end);
  const logs=await provider.getLogs({address:target.escrow,fromBlock,toBlock,topics:[fundingInterface.getEvent('Funded').topicHash,null,chainReference(p.storeId)]});
  check(Array.isArray(logs)&&logs.length<=2048,'FUNDING_INDEX_PAGE_LIMIT');const rows=[],seen=new Set();
  for(const log of logs){check(log.removed!==true&&log.blockNumber>=fromBlock&&log.blockNumber<=toBlock&&same(log.address,target.escrow)&&hash(log.transactionHash),'FUNDING_INDEX_LOG');const parsed=fundingInterface.parseLog(log);check(parsed?.name==='Funded'&&parsed.args.storeId===chainReference(p.storeId),'FUNDING_INDEX_LOG');const id=`${log.transactionHash}:${log.index??log.logIndex}`;check(!seen.has(id),'FUNDING_INDEX_DUPLICATE_LOG');seen.add(id);
   const row=await verifyLog(log,p,ctx);check(row?.batchId===parsed.args.batchId&&row.storeId===p.storeId&&row.confirmedBlock===log.blockNumber&&same(row.blockHash,log.blockHash)&&same(row.txHash,log.transactionHash),'FUNDING_INDEX_EVIDENCE');rows.push(row);
  }
  await canonical(end);await canonical(ctx.block);
  const result=await store.transact(state=>{
   check(!state.fundingIndex||stable(state.fundingIndex.target)===identityJSON,'FUNDING_INDEX_TARGET_CHANGED');
   const previous=state.fundingIndex?.stores?.[p.storeId];if(stable(previous)!==stable(cursor))return {advanced:false,reason:'CURSOR_CHANGED'};
   check(Object.values(state.publications||{}).some(r=>r.kind==='registration'&&r.state==='CONFIRMED'&&r.storeId===p.storeId&&same(r.wallet,p.wallet)),'FUNDING_INDEX_STORE_CHANGED');
   state.indexedBatches??={};const existing=Object.values(state.indexedBatches).filter(r=>r.storeId===p.storeId),newIds=new Set(rows.map(r=>r.batchId));for(const r of existing)newIds.add(r.batchId);check(newIds.size<=maxRecords,'FUNDING_INDEX_BATCH_LIMIT');
   for(const row of rows){const old=state.indexedBatches[row.batchId];check(!old||stable(old)===stable(row),'FUNDING_INDEX_BATCH_CONFLICT');state.indexedBatches[row.batchId]=row;}
   state.fundingIndex??={target:identity,stores:{}};state.fundingIndex.stores[p.storeId]={throughBlock:toBlock,blockHash:end.hash};return {advanced:true,storeId:p.storeId,fromBlock,toBlock,imported:rows.length,caughtUp:toBlock===ctx.block.number};
  });failures.delete(p.storeId);return {verified:true,finalizedBlock:ctx.block.number,...result};
  } catch(error) {
   backoff(p.storeId);throw error;
  }
 }};
}
