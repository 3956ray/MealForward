/** New product domain. No access to the legacy MVP schema, signer or runtime.
 * The chain adapter supplies verified catalog/transaction evidence; it never sends.
 * This module is not mounted by the live MVP server.
 */
import { createHash, randomUUID } from 'node:crypto';
import {validateFundingTransaction} from './funding-wire.mjs';
import {kitchenStatus} from './kitchen-settings.mjs';

export const fail = (code, status = 409) => { throw Object.assign(new Error(code), {code, status}); };
const check = (value, code, status) => { if (!value) fail(code, status); };
const copy = value => structuredClone(value);
const stable = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const digest = value => createHash('sha256').update(stable(value)).digest('hex');
const id = value => { check(typeof value === 'string' && /^[a-zA-Z0-9_-]{1,96}$/.test(value), 'INVALID_ID', 422); return value; };
const wallet = value => { check(typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value) && BigInt(value) !== 0n, 'UNAUTHENTICATED', 401); return value.toLowerCase(); };
const uint = value => { check(typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value)<2n**256n, 'INVALID_INTEGER', 422); return BigInt(value); };
const positive = value => { const n = uint(value); check(n > 0n, 'INVALID_INTEGER', 422); return n; };
const time = value => { check(Number.isSafeInteger(value) && value >= 0, 'INVALID_TIME', 422); return value; };
const text = (value, max) => { check(typeof value === 'string' && value.trim().length > 0 && value.length <= max, 'INVALID_TEXT', 422); return value.trim(); };
const exact = (body, keys) => check(body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).sort().join() === keys.sort().join(), 'INVALID_REQUEST', 422);
const own = (catalog, address, storeId) => check(catalog.stores.some(s => s.id === storeId && s.owner.toLowerCase() === address), 'STORE_ACCESS_DENIED', 403);
export function emptyState() { return {drafts:{}, reviews:{}, intents:{}, requests:{}}; }

export function validateWindows(windows) {
  check(Array.isArray(windows) && windows.length >= 1 && windows.length <= 2, 'INVALID_WINDOWS', 422);
  let end = -1;
  for (const pair of windows) {
    check(Array.isArray(pair) && pair.length === 2 && pair.every(Number.isSafeInteger) && pair[0] >= 0 && pair[0] < pair[1] && pair[1] <= 1440 && pair[0] >= end, 'INVALID_WINDOWS', 422);
    end = pair[1];
  }
  return copy(windows);
}

function once(state, address, requestId, payload, create) {
  const key = `${address}:${id(requestId)}`, hash = digest(payload), previous = state.requests[key];
  if (previous) { check(previous.hash === hash, 'REQUEST_CONFLICT'); return copy(previous.result); }
  const result = create();
  state.requests[key] = {hash, result:copy(result)};
  return result;
}
const intentFor = (state, address, intentId) => {
  const intent = state.intents[id(intentId)];
  check(intent?.wallet === address, 'INTENT_NOT_FOUND', 404);
  return intent;
};
const dto = intent => {
  const {transaction, ...record} = intent;
  return {...copy(record), ...(intent.state === 'PREPARED' && transaction ? {transaction:copy(transaction)} : {})};
};

export function makeProductService({store, chain, clock = () => Math.floor(Date.now()/1000), newId = randomUUID}) {
  const allowance=async(address,amount)=>{
    check(typeof chain.fundingAllowance==='function','ALLOWANCE_UNVERIFIED',503);
    const a=await chain.fundingAllowance(address);
    check(/^0x[0-9a-f]{40}$/i.test(chain.target?.asset)&&a?.verified===true&&a.finalized===true&&Number.isSafeInteger(a.blockNumber)&&a.blockNumber>=0&&a.owner?.toLowerCase()===address&&a.asset?.toLowerCase()===chain.target.asset.toLowerCase()&&a.spender?.toLowerCase()===chain.target.escrow?.toLowerCase(),'ALLOWANCE_UNVERIFIED',503);
    check(uint(a.allowance)>=BigInt(amount),'INSUFFICIENT_ALLOWANCE');
  };
  check(store?.read && store?.transact && chain?.catalog, 'PRODUCT_ADAPTER_REQUIRED', 503);
  const catalog = async () => {
    const value = await chain.catalog();
    check(value?.verified===true && Array.isArray(value.stores) && Array.isArray(value.meals) && Number.isSafeInteger(value.blockNumber), 'CATALOG_UNVERIFIED', 503);
    return {...copy(value), fundingEnabled:chain.fundingEnabled === true, approvalEnabled:chain.approvalEnabled===true,publicationEnabled:chain.publicationEnabled === true,claimEnabled:chain.claimEnabled === true};
  };
  const held = (state, meal, block) => Object.values(state.intents).filter(o => o.kind === 'support' && o.storeId === meal.storeId && o.mealId === meal.id && o.version === meal.version &&
    (['AWAITING_HANDOVER','PREPARED','SEND_UNKNOWN','HASH_BOUND'].includes(o.state) || o.state === 'CONFIRMED' && o.confirmedBlock > block)).reduce((sum,o) => sum + BigInt(o.quantity), 0n);
  function available(state, snapshot, meal) {
    const remaining = uint(meal.remaining) - held(state, meal, snapshot.blockNumber);
    return remaining > 0n ? remaining : 0n;
  }
  function current(snapshot, storeId, mealId, version) {
    const meal = snapshot.meals.filter(m => m.storeId === storeId && m.id === mealId).sort((a,b)=>b.version-a.version)[0];
    check(Number.isSafeInteger(version)&&version>0,'INVALID_VERSION',422);
    check(meal && meal.version === version, 'MEAL_VERSION_CHANGED');
    check(meal.listed === true && time(meal.fundingDeadline) > clock(), 'FUNDING_CLOSED');
    positive(meal.unitPrice);
    check(/^0x[0-9a-f]{64}$/i.test(meal.termsHash), 'CATALOG_UNVERIFIED', 503);
    return meal;
  }
  return {
    async identity(address) {
      address=wallet(address);
      if(typeof chain.identity==='function'){
        const value=await chain.identity(address);
        check(value?.verified===true&&value.wallet===address&&Array.isArray(value.stores)&&value.stores.every(v=>typeof v==='string'),'IDENTITY_UNVERIFIED',503);
        return {wallet:address,stores:[...new Set(value.stores)]};
      }
      // Compatibility for isolated domain fixtures. The deployed adapter provides
      // identity separately so pending catalog reconciliation cannot block login.
      return {wallet:address,stores:(await catalog()).stores.filter(s=>s.owner.toLowerCase()===address).map(s=>s.id)};
    },
    async ledger() {
      const snapshot=await catalog(),fields=['funded','available','claimed','handedOver','settled','refundPending','refunded'],a=snapshot.accounting;
      check(a&&fields.every(k=>typeof a[k]==='string'&&/^(0|[1-9][0-9]*)$/.test(a[k])&&a[k].length<=78&&BigInt(a[k])<2n**256n),'ACCOUNTING_UNVERIFIED',503);
      check(BigInt(a.funded)===fields.slice(1).reduce((sum,k)=>sum+BigInt(a[k]),0n),'ACCOUNTING_UNVERIFIED',503);
      const state=await store.read(),items=Object.values(state.intents).filter(i=>i.kind==='support'&&i.state==='CONFIRMED'&&Number.isSafeInteger(i.confirmedBlock)&&i.confirmedBlock<=snapshot.blockNumber).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).slice(0,200).map(i=>({storeId:i.storeId,mealId:i.mealId,name:i.name,version:i.version,quantity:i.quantity,amount:i.amount,txHash:i.txHash}));
      return {verified:true,chainId:chain.target?.chainId,blockNumber:snapshot.blockNumber,blockHash:snapshot.blockHash,asset:{symbol:snapshot.asset.symbol,decimals:snapshot.asset.decimals},counts:Object.fromEntries(fields.map(k=>[k,a[k]])),items};
    },
    async catalog() {
      const snapshot = await catalog(), state = await store.read();
      const groups=new Map();for(const meal of snapshot.meals){const key=meal.storeId+':'+meal.id;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(meal);}
      const meals=[...groups.values()].map(versions=>{
        const current=[...versions].sort((a,b)=>b.version-a.version)[0];
        const claimable=versions.every(m=>typeof m.claimable==='string'&&/^(0|[1-9][0-9]*)$/.test(m.claimable))?versions.reduce((n,m)=>n+BigInt(m.claimable),0n).toString():undefined;
        return {...current,claimable,remaining:available(state,snapshot,current).toString()};
      });
      return {...snapshot,stores:snapshot.stores.map(s=>({...s,...kitchenStatus(state.kitchenSettings?.[s.id],clock())})),meals};
    },
    async drafts(address, storeId) {
      address = wallet(address); own(await catalog(),address,id(storeId));
      return {items:Object.values((await store.read()).drafts).filter(d => d.storeId === storeId && d.wallet === address).map(copy)};
    },
    async saveDraft(address, draftId, body) {
      address = wallet(address); id(draftId);
      exact(body,['storeId','expectedRevision','requestId','name','description','unitPrice','windows','quantity','fundingDeadline']);
      const snapshot = await catalog(); own(snapshot,address,id(body.storeId));
      positive(body.unitPrice); positive(body.quantity); time(body.expectedRevision);
      check(time(body.fundingDeadline) > clock(), 'FUNDING_DEADLINE_PASSED', 422);
      const values = {storeId:body.storeId,name:text(body.name,100),description:text(body.description,2000),unitPrice:body.unitPrice,windows:validateWindows(body.windows),quantity:body.quantity,fundingDeadline:body.fundingDeadline};
      return store.transact(state => once(state,address,body.requestId,{action:'saveDraft',draftId,...body},() => {
        const previous = state.drafts[draftId];
        check(!previous || previous.wallet === address && previous.storeId === body.storeId,'DRAFT_ACCESS_DENIED',403);
        check((previous?.revision ?? 0) === body.expectedRevision,'DRAFT_REVISION_CHANGED');
        const result = {...values,id:draftId,wallet:address,revision:body.expectedRevision+1};
        state.drafts[draftId] = result;
        return result;
      }));
    },
    async reviewPublication(address, body) {
      address = wallet(address); exact(body,['draftId','revision','requestId']);
      const snapshot = await catalog();
      return store.transact(state => once(state,address,body.requestId,{action:'reviewPublication',...body},() => {
        const draft = state.drafts[id(body.draftId)];
        check(draft?.wallet === address,'DRAFT_NOT_FOUND',404); own(snapshot,address,draft.storeId);
        check(draft.revision === body.revision,'DRAFT_REVISION_CHANGED');
        check(draft.fundingDeadline > clock(),'FUNDING_DEADLINE_PASSED');
        const review = {...copy(draft),id:newId(),draftId:draft.id,kind:'publication',expiresAt:Math.min(clock()+600,draft.fundingDeadline)};
        state.reviews[review.id] = review; return review;
      }));
    },
    async reviewSupport(address, body) {
      address = wallet(address); exact(body,['storeId','mealId','version','quantity','requestId']);
      positive(body.quantity);
      const snapshot = await catalog(), meal = current(snapshot,id(body.storeId),id(body.mealId),body.version);
      const amount=(BigInt(meal.unitPrice)*BigInt(body.quantity)).toString();uint(amount);
      let approvalRequired=null;
      if(chain.fundingEnabled===true){try{await allowance(address,amount);approvalRequired=false;}catch(e){if(e.code!=='INSUFFICIENT_ALLOWANCE')throw e;approvalRequired=true;}}
      return store.transact(state => once(state,address,body.requestId,{action:'reviewSupport',...body},() => {
        check(BigInt(body.quantity) <= available(state,snapshot,meal),'INSUFFICIENT_INVENTORY');
        const review = {...copy(meal),id:newId(),kind:'support',wallet:address,mealId:meal.id,quantity:body.quantity,amount,approvalRequired,expiresAt:Math.min(clock()+120,meal.fundingDeadline)};
        state.reviews[review.id] = review; return review;
      }));
    },
    async confirmSupport(address, body) {
      address = wallet(address); exact(body,['reviewId','requestId']);
      // Capability off is a hard server gate, never a frontend-only hiding rule.
      check(chain.fundingEnabled === true && chain.prepareFunding,'FUNDING_NOT_CONNECTED',503);
      const snapshot = await catalog();
      return store.transact(async state => {
        const requestKey = `${address}:${id(body.requestId)}`, payload = {action:'confirmSupport',...body};
        const original = state.requests[requestKey];
        if (original) { check(original.hash === digest(payload),'REQUEST_CONFLICT'); return dto(intentFor(state,address,original.result.id)); }
        const review = state.reviews[id(body.reviewId)];
        check(review?.wallet === address && review.kind === 'support','REVIEW_NOT_FOUND',404);
        if (review.intentId) {
          state.requests[requestKey]={hash:digest(payload),result:{id:review.intentId}};
          return dto(intentFor(state,address,review.intentId));
        }
        check(!Object.values(state.intents).some(o=>o.wallet===address && ['AWAITING_HANDOVER','PREPARED','SEND_UNKNOWN','HASH_BOUND'].includes(o.state)),'WALLET_OPERATION_PENDING');
        check(![...Object.values(state.redemptions||{}),...Object.values(state.publications||{}),...Object.values(state.approvals||{})].some(o=>o.wallet===address&&['AWAITING_HANDOVER','PREPARED','SEND_UNKNOWN','HASH_BOUND'].includes(o.state)),'WALLET_OPERATION_PENDING');
        check(review.expiresAt > clock(),'REVIEW_EXPIRED');
        const meal = current(snapshot,review.storeId,review.mealId,review.version);
        check(meal.termsHash === review.termsHash && meal.unitPrice === review.unitPrice,'MEAL_VERSION_CHANGED');
        check(BigInt(review.quantity) <= available(state,snapshot,meal),'INSUFFICIENT_INVENTORY');
        await allowance(address,review.amount);
        const intent = {...copy(review),id:newId(),reviewId:review.id,kind:'support',state:'PREPARED',createdAt:clock()};
        // Adapter only constructs and verifies calldata; it must not sign/send.
        intent.transaction = await chain.prepareFunding(copy(intent));
        try {intent.transaction=validateFundingTransaction(intent,chain.target,intent.transaction);} catch {fail('TRANSACTION_UNVERIFIED',503);}
        state.intents[intent.id] = intent; review.intentId = intent.id;
        state.requests[requestKey] = {hash:digest(payload),result:{id:intent.id}};
        return dto(intent);
      });
    },
    async intent(address, intentId) { return dto(intentFor(await store.read(),wallet(address),intentId)); },
    async orders(address) { address=wallet(address); return {items:Object.values((await store.read()).intents).filter(i => i.wallet===address && i.kind==='support').map(dto)}; },
    async attempt(address, intentId) {
      address=wallet(address); check(chain.fundingEnabled === true,'FUNDING_NOT_CONNECTED',503);
      return store.transact(async state => {
        const intent=intentFor(state,address,intentId);
        check(intent.state==='PREPARED','ALREADY_ATTEMPTED');
        check(intent.expiresAt>clock(),'REVIEW_EXPIRED');
        await allowance(address,intent.amount);
        intent.state='SEND_UNKNOWN'; intent.attemptedAt=clock();
        // The caller retains the transaction fetched before admission. No resend DTO.
        return {allowed:true,intent:dto(intent)};
      });
    },
    async cancel(address,intentId) {
      address=wallet(address);
      return store.transact(state => {
        const intent=intentFor(state,address,intentId);
        check(['PREPARED','CANCELLED'].includes(intent.state),'ATTEMPTED_OPERATION_CANNOT_CANCEL');
        intent.state='CANCELLED'; return dto(intent);
      });
    },
    async recordHash(address,intentId,txHash) {
      address=wallet(address); check(/^0x[0-9a-f]{64}$/i.test(txHash),'INVALID_HASH',422);
      txHash=txHash.toLowerCase();
      return store.transact(state => {
        const intent=intentFor(state,address,intentId);
        check(['SEND_UNKNOWN','HASH_BOUND','CONFIRMED','REVERTED'].includes(intent.state),'ATTEMPT_REQUIRED');
        check(!intent.txHash || intent.txHash===txHash,'HASH_CONFLICT');
        // An unverified pasted/provider hash is not authority. Keep every
        // candidate for recovery while allowing correction until one is bound.
        intent.candidateHashes=[...new Set([...(intent.candidateHashes||[]),txHash])];
        intent.candidateHash=txHash; return dto(intent);
      });
    },
    async reconcile(address,intentId) {
      address=wallet(address); const original=intentFor(await store.read(),address,intentId);
      if (!original.candidateHash || !['SEND_UNKNOWN','HASH_BOUND'].includes(original.state)) return dto(original);
      check(typeof chain.verifyFunding==='function','VERIFIER_NOT_CONNECTED',503);
      // verifyFunding must bind sender/nonce/input/value/chain/target, finalized
      // canonical receipt and exact batch/payment event. "Not found" is UNKNOWN.
      const evidence=await chain.verifyFunding(copy(original),original.candidateHash);
      return store.transact(state => {
        const intent=intentFor(state,address,intentId);
        if (!['SEND_UNKNOWN','HASH_BOUND'].includes(intent.state)) return dto(intent);
        check(intent.candidateHash===original.candidateHash,'HASH_CONFLICT');
        if (!evidence?.verified) return dto(intent);
        check(evidence.txHash===intent.candidateHash,'EVIDENCE_MISMATCH');
        intent.txHash=evidence.txHash; intent.state='HASH_BOUND';
        if (evidence.finalized===true) {
          check(Number.isSafeInteger(evidence.blockNumber) && evidence.blockNumber>=0,'EVIDENCE_MISMATCH');
          check(['CONFIRMED','REVERTED'].includes(evidence.outcome),'EVIDENCE_MISMATCH');
          if (evidence.outcome==='CONFIRMED') check(evidence.amount===intent.amount && evidence.quantity===intent.quantity && evidence.termsHash===intent.termsHash,'EVIDENCE_MISMATCH');
          intent.state=evidence.outcome; intent.confirmedBlock=evidence.blockNumber;
        }
        return dto(intent);
      });
    },
  };
}
