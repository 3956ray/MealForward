/** New catalog mutations: explicit wallet transactions, immutable reviews and final receipts. */
import {randomUUID,createHash} from 'node:crypto';
import {keccak256,toUtf8Bytes} from 'ethers';
import {fail,validateWindows} from './service.mjs';
import {publicationTermsHash,validatePublicationTransaction} from './publication-wire.mjs';
const check=(ok,code,status=409)=>{if(!ok)fail(code,status);};
const copy=x=>structuredClone(x);
const ref=x=>{check(typeof x==='string'&&/^[a-zA-Z0-9_-]{1,96}$/.test(x),'INVALID_ID',422);return x;};
const wallet=x=>{check(typeof x==='string'&&/^0x[0-9a-f]{40}$/i.test(x)&&BigInt(x)!==0n,'UNAUTHENTICATED',401);return x.toLowerCase();};
const exact=(v,keys)=>check(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.sort().join(),'INVALID_REQUEST',422);
const uint=x=>{check(typeof x==='string'&&/^[1-9][0-9]{0,77}$/.test(x)&&BigInt(x)<2n**256n,'INVALID_INTEGER',422);return x;};
const version=x=>check(Number.isSafeInteger(x)&&x>0,'INVALID_VERSION',422);
const pending=o=>['AWAITING_HANDOVER','PREPARED','SEND_UNKNOWN','HASH_BOUND'].includes(o.state);
const initialize=s=>{for(const k of ['publications','publicationReviews','publicationRequests','kitchens','publishedMeals'])s[k]||={};};
const fingerprint=x=>createHash('sha256').update(JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v)).digest('hex');
const dto=o=>{const {transaction,...rest}=o;return {...copy(rest),...(o.state==='PREPARED'?{transaction:copy(transaction)}:{})};};
const current=(snapshot,storeId,mealId)=>snapshot.meals.filter(m=>m.storeId===storeId&&m.id===mealId).sort((a,b)=>b.version-a.version)[0];
const own=(snapshot,w,storeId)=>{const item=snapshot.stores.find(s=>s.id===storeId&&s.owner.toLowerCase()===w);check(item,'STORE_ACCESS_DENIED',403);check(!item.closed,'STORE_CLOSED');};
const operationFor=(s,w,id)=>{const o=s.publications?.[ref(id)];check(o?.wallet===w,'PUBLICATION_NOT_FOUND',404);return o;};
export function makePublicationService({store,chain,clock=()=>Math.floor(Date.now()/1000),newId=randomUUID,defaultImageDigest}){
 const enabled=()=>check(chain.publicationEnabled===true,'PUBLICATION_NOT_CONNECTED',503);
 const catalog=async()=>{const c=await chain.catalog();check(c?.verified===true&&Number.isSafeInteger(c.blockNumber)&&Array.isArray(c.stores)&&Array.isArray(c.meals),'CATALOG_UNVERIFIED',503);return c;};
 const requestKey=(w,id)=>`${w}:${ref(id)}`;
 const deadline=d=>check(Number.isSafeInteger(d)&&d>clock(),'FUNDING_DEADLINE_PASSED',422);
 const availableWallet=(s,w)=>check(!['publications','intents','redemptions','approvals'].some(k=>Object.values(s[k]||{}).some(o=>o.wallet===w&&pending(o))),'WALLET_OPERATION_PENDING');
 function previous(s,w,body,action){const r=s.publicationRequests[requestKey(w,body.requestId)];if(!r)return null;check(r.hash===fingerprint({action,...body}),'REQUEST_CONFLICT');return r;}
 async function create(s,w,body,action,fields){
  const old=previous(s,w,body,action);if(old)return dto(operationFor(s,w,old.id));
  availableWallet(s,w);
  const op={...copy(fields),id:newId(),kind:action,wallet:w,requestId:body.requestId,state:'PREPARED',createdAt:clock()};
  const tx=await chain.preparePublicationOperation(copy(op));
  try{op.transaction=validatePublicationTransaction(op,chain.target,tx);}catch{fail('TRANSACTION_UNVERIFIED',503);}
  s.publications[op.id]=op;s.publicationRequests[requestKey(w,body.requestId)]={hash:fingerprint({action,...body}),id:op.id};return dto(op);
 }
 async function control(w,body,kind){
  w=wallet(w);enabled();exact(body,kind==='listing'?['storeId','mealId','version','listed','requestId']:['storeId','mealId','version','quantity','fundingDeadline','requestId']);
  const recovered=await replay(w,body,kind);if(recovered)return recovered;
  ref(body.storeId);ref(body.mealId);version(body.version);
  if(kind==='listing')check(typeof body.listed==='boolean','INVALID_LISTING',422);else{uint(body.quantity);deadline(body.fundingDeadline);}
  const snapshot=await catalog();
  return store.transact(async s=>{initialize(s);const old=previous(s,w,body,kind);if(old)return dto(operationFor(s,w,old.id));own(snapshot,w,body.storeId);
   const meal=current(snapshot,body.storeId,body.mealId);check(meal?.version===body.version,'MEAL_VERSION_CHANGED');check(/^0x[0-9a-f]{64}$/i.test(meal.termsHash||'')&&BigInt(meal.termsHash)!==0n,'CATALOG_UNVERIFIED',503);
   return create(s,w,body,kind,{...body,name:meal.name,termsHash:meal.termsHash});});
 }
 async function replay(w,body,action){const s=await store.read();initialize(s);const r=previous(s,w,body,action);return r?dto(operationFor(s,w,r.id)):null;}
 const api={
  async prepareClosure(w,body){
   w=wallet(w);enabled();exact(body,['storeId','acknowledge','requestId']);ref(body.storeId);check(body.acknowledge===true,'CLOSURE_ACKNOWLEDGEMENT_REQUIRED',422);
   const recovered=await replay(w,body,'closure');if(recovered)return recovered;const snapshot=await catalog();own(snapshot,w,body.storeId);check(!snapshot.stores.find(s=>s.id===body.storeId).closed,'STORE_ALREADY_CLOSED');
   return store.transact(async s=>{initialize(s);return create(s,w,body,'closure',{storeId:body.storeId,name:snapshot.stores.find(s=>s.id===body.storeId).name,acknowledge:true,expiresAt:clock()+120});});
  },
  async refunds(w,storeId){
   w=wallet(w);ref(storeId);check(typeof chain.refundableBatches==='function','REFUNDS_NOT_CONNECTED',503);
   const result=await chain.refundableBatches(storeId,w);check(result?.verified===true&&result.storeId===storeId&&Array.isArray(result.items),'REFUND_EVIDENCE_REQUIRED',503);return result;
  },
  async prepareRefund(w,body){
   w=wallet(w);enabled();exact(body,['storeId','batchId','requestId']);ref(body.storeId);check(/^0x[0-9a-f]{64}$/i.test(body.batchId),'INVALID_BATCH',422);
   const recovered=await replay(w,body,'refund');if(recovered)return recovered;
   const e=await chain.refundState(body.batchId);check(e?.verified===true&&e.storeId===body.storeId&&e.owner?.toLowerCase()===w,'STORE_ACCESS_DENIED',403);
   check(e.closed===true&&!e.refunded,'REFUND_UNAVAILABLE');uint(e.quantity);uint(e.amount);const payer=wallet(e.payer);
   return store.transact(async s=>{initialize(s);return create(s,w,body,'refund',{storeId:body.storeId,batchId:body.batchId,payer,quantity:e.quantity,amount:e.amount,expiresAt:clock()+120});});
  },
  async reviewRegistration(w,body){w=wallet(w);exact(body,['name','requestId']);check(typeof body.name==='string'&&body.name.trim().length>0&&body.name.length<=100,'INVALID_NAME',422);
   return store.transact(s=>{initialize(s);const old=previous(s,w,body,'registration-review');if(old)return copy(s.publicationReviews[old.id]);
    const r={id:newId(),storeId:newId(),name:body.name.trim(),wallet:w,expiresAt:clock()+600};s.publicationReviews[r.id]=r;s.publicationRequests[requestKey(w,body.requestId)]={hash:fingerprint({action:'registration-review',...body}),id:r.id};return copy(r);});},
  async confirmRegistration(w,body){w=wallet(w);enabled();exact(body,['reviewId','requestId']);const recovered=await replay(w,body,'registration');if(recovered)return recovered;
   return store.transact(async s=>{initialize(s);const old=previous(s,w,body,'registration');if(old)return dto(operationFor(s,w,old.id));const r=s.publicationReviews[ref(body.reviewId)];check(r?.wallet===w,'REVIEW_NOT_FOUND',404);
    if(r.operationId){s.publicationRequests[requestKey(w,body.requestId)]={hash:fingerprint({action:'registration',...body}),id:r.operationId};return dto(operationFor(s,w,r.operationId));}
    check(r.expiresAt>clock(),'REVIEW_EXPIRED');const op=await create(s,w,body,'registration',{storeId:r.storeId,name:r.name,reviewId:r.id,expiresAt:r.expiresAt});r.operationId=op.id;return op;});},
  async confirmPublication(w,body){w=wallet(w);enabled();exact(body,['reviewId','requestId']);const recovered=await replay(w,body,'publication');if(recovered)return recovered;const snapshot=await catalog();
   return store.transact(async s=>{initialize(s);const old=previous(s,w,body,'publication');if(old)return dto(operationFor(s,w,old.id));const r=s.reviews?.[ref(body.reviewId)];check(r?.wallet===w&&r.kind==='publication','REVIEW_NOT_FOUND',404);
    if(r.operationId){s.publicationRequests[requestKey(w,body.requestId)]={hash:fingerprint({action:'publication',...body}),id:r.operationId};return dto(operationFor(s,w,r.operationId));}
    check(r.expiresAt>clock(),'REVIEW_EXPIRED');own(snapshot,w,r.storeId);uint(r.unitPrice);uint(r.quantity);deadline(r.fundingDeadline);const windows=validateWindows(r.windows);
    const imageDigest=r.imageDigest||defaultImageDigest;check(/^0x[0-9a-f]{64}$/i.test(imageDigest||'')&&BigInt(imageDigest)!==0n,'IMAGE_DIGEST_REQUIRED',422);
    const mealId=ref(r.mealId||r.draftId),currentMeal=current(snapshot,r.storeId,mealId);const expectedVersion=currentMeal?.version||0;check(Number.isSafeInteger(expectedVersion)&&expectedVersion>=0,'CATALOG_UNVERIFIED',503);
    const fields={storeId:r.storeId,mealId,draftId:r.draftId,reviewId:r.id,name:r.name,description:r.description,unitPrice:r.unitPrice,windows,quantity:r.quantity,fundingDeadline:r.fundingDeadline,version:expectedVersion+1,expectedVersion,listed:currentMeal?.listed??true,expiresAt:r.expiresAt,
     terms:{unitPrice:r.unitPrice,bodyDigest:keccak256(toUtf8Bytes(JSON.stringify({name:r.name,description:r.description}))),imageDigest,windowCount:windows.length,startMinute0:windows[0][0],endMinute0:windows[0][1],startMinute1:windows[1]?.[0]||0,endMinute1:windows[1]?.[1]||0}};
    try{fields.termsHash=publicationTermsHash(chain.target,fields);}catch{fail('PRODUCT_TARGET_UNVERIFIED',503);}
    const op=await create(s,w,body,'publication',fields);r.operationId=op.id;return op;});},
  supplement:(w,b)=>control(w,b,'supplement'),setListed:(w,b)=>control(w,b,'listing'),
  async operation(w,id){return dto(operationFor(await store.read(),wallet(w),id));},
  async operations(w){w=wallet(w);return {items:Object.values((await store.read()).publications||{}).filter(o=>o.wallet===w).map(dto)};},
  async byRequest(w,id){w=wallet(w);const s=await store.read(),r=s.publicationRequests?.[requestKey(w,id)];check(r&&s.publications?.[r.id],'PUBLICATION_NOT_FOUND',404);return dto(operationFor(s,w,r.id));},
  async attempt(w,id){w=wallet(w);enabled();return store.transact(s=>{const o=operationFor(s,w,id);check(o.state==='PREPARED','ALREADY_ATTEMPTED');if(o.expiresAt)check(o.expiresAt>clock(),'REVIEW_EXPIRED');if(o.fundingDeadline)deadline(o.fundingDeadline);o.state='SEND_UNKNOWN';o.attemptedAt=clock();return {allowed:true,operation:dto(o)};});},
  async cancel(w,id){w=wallet(w);return store.transact(s=>{const o=operationFor(s,w,id);check(['PREPARED','CANCELLED'].includes(o.state),'ATTEMPTED_OPERATION_CANNOT_CANCEL');o.state='CANCELLED';return dto(o);});},
  async recordHash(w,id,hash){w=wallet(w);check(/^0x[0-9a-f]{64}$/i.test(hash),'INVALID_HASH',422);hash=hash.toLowerCase();return store.transact(s=>{const o=operationFor(s,w,id);check(['SEND_UNKNOWN','HASH_BOUND','CONFIRMED','REVERTED'].includes(o.state),'ATTEMPT_REQUIRED');check(!o.txHash||o.txHash===hash,'HASH_CONFLICT');o.candidateHashes=[...new Set([...(o.candidateHashes||[]),hash])];o.candidateHash=hash;return dto(o);});},
  async reconcile(w,id){w=wallet(w);const original=operationFor(await store.read(),w,id);if(!original.candidateHash||!['SEND_UNKNOWN','HASH_BOUND'].includes(original.state))return dto(original);const e=await chain.verifyPublication(copy(original),original.candidateHash);
   return store.transact(s=>{initialize(s);const o=operationFor(s,w,id);if(!['SEND_UNKNOWN','HASH_BOUND'].includes(o.state))return dto(o);check(o.candidateHash===original.candidateHash,'HASH_CONFLICT');if(e?.verified!==true)return dto(o);
    check(e.txHash===o.candidateHash&&e.transaction&&Object.keys(e.transaction).sort().join()===Object.keys(o.transaction).sort().join()&&Object.keys(o.transaction).every(k=>String(e.transaction[k]).toLowerCase()===String(o.transaction[k]).toLowerCase()),'EVIDENCE_MISMATCH');o.txHash=e.txHash;o.state='HASH_BOUND';if(e.finalized!==true)return dto(o);
    check(Number.isSafeInteger(e.blockNumber)&&e.blockNumber>=0&&['CONFIRMED','REVERTED'].includes(e.outcome),'EVIDENCE_MISMATCH');
    if(e.outcome==='CONFIRMED'){
     check(e.kind===o.kind&&e.storeId===o.storeId&&e.owner?.toLowerCase()===w,'EVIDENCE_MISMATCH');
     if(['publication','supplement','listing'].includes(o.kind)){check(e.mealId===o.mealId&&e.version===o.version&&e.termsHash===o.termsHash,'EVIDENCE_MISMATCH');}
     if(['publication','supplement'].includes(o.kind))check(e.quantity===o.quantity&&e.fundingDeadline===o.fundingDeadline,'EVIDENCE_MISMATCH');
     if(['publication','listing'].includes(o.kind))check(e.listed===o.listed,'EVIDENCE_MISMATCH');
     if(o.kind==='closure')check(e.closed===true,'EVIDENCE_MISMATCH');
     if(o.kind==='refund')check(e.batchId===o.batchId&&e.payer?.toLowerCase()===o.payer&&e.quantity===o.quantity&&e.amount===o.amount&&e.refunded===true,'EVIDENCE_MISMATCH');
     if(o.kind==='registration')s.kitchens[o.storeId]={id:o.storeId,name:o.name,owner:w,confirmedBlock:e.blockNumber};
     if(o.kind==='publication')s.publishedMeals[`${o.storeId}:${o.mealId}:${o.version}`]={id:o.mealId,storeId:o.storeId,version:o.version,name:o.name,description:o.description,unitPrice:o.unitPrice,windows:copy(o.windows),termsHash:o.termsHash,imageDigest:o.terms.imageDigest,quantity:o.quantity,fundingDeadline:o.fundingDeadline,listed:o.listed,confirmedBlock:e.blockNumber};
    }
    if(o.kind==='refund'&&e.alreadyRefunded===true)o.alreadyRefunded=true;
    o.state=e.outcome;o.confirmedBlock=e.blockNumber;return dto(o);
   });},
 };
 return api;
}
