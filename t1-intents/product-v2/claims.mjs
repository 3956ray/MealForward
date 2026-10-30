/** Wallet-bound claims. Platform outbox is internal; no signer/secret in HTTP DTOs. */
import {createHmac,randomInt,randomUUID} from 'node:crypto';
import {fail,validateWindows} from './service.mjs';
import {validateClaimPacket} from './claim-wire.mjs';
const check=(v,c,s=409)=>{if(!v)fail(c,s);};
const copy=v=>structuredClone(v);
const address=v=>{check(typeof v==='string'&&/^0x[0-9a-fA-F]{40}$/.test(v)&&BigInt(v)!==0n,'UNAUTHENTICATED',401);return v.toLowerCase();};
const ref=v=>{check(typeof v==='string'&&/^[a-zA-Z0-9_-]{1,96}$/.test(v),'INVALID_ID',422);return v;};
const initialize=s=>{for(const field of ['claimReviews','claimRequests','claims','vouchers','displays'])s[field]||={};return s;};
const publicClaim=c=>({id:c.id,state:c.state,reviewId:c.reviewId,requestId:c.requestId,...(c.voucherId?{voucherId:c.voucherId}:{}),...(c.txHash?{txHash:c.txHash}:{})});
const pending=c=>['QUEUED','SIGNED','SEND_UNKNOWN','HASH_BOUND'].includes(c.state);
const unitKey=c=>`${c.batchId}:${c.unitIndex}`;
function windowEnd(windows,now) {
  const shifted=now+480*60,dayStart=Math.floor(shifted/86400)*86400-480*60,minute=Math.floor((shifted%86400)/60);
  const interval=windows.find(([start,end])=>minute>=start&&minute<end);
  return interval?dayStart+interval[1]*60:0;
}
function ownedVoucher(s,wallet,id) {const v=s.vouchers?.[ref(id)];check(v?.wallet===wallet,'VOUCHER_NOT_FOUND',404);return v;}
const publicVoucher=v=>({id:v.id,claimId:v.claimId,storeId:v.storeId,mealId:v.mealId,name:v.name,version:v.version,windows:copy(v.windows),state:v.state,claimedAt:v.claimedAt,expiresAt:v.expiresAt});

export function makeClaimService({store,chain,policySeconds,pepper,clock=()=>Math.floor(Date.now()/1000),newId=randomUUID}) {
  check([7200,259200].includes(policySeconds),'INVALID_CLAIM_POLICY',503);
  check(typeof pepper==='string'&&pepper.length>=32,'CREDENTIAL_KEY_REQUIRED',503);
  const hash=code=>createHmac('sha256',pepper).update(code).digest('hex');
  const claimFor=(s,w,id)=>{const c=s.claims?.[ref(id)];check(c?.wallet===w,'CLAIM_NOT_FOUND',404);return c;};
  const candidate=async(storeId,mealId)=>{
    const c=await chain.claimCandidate(storeId,mealId);
    check(c?.verified===true&&c.storeId===storeId&&c.mealId===mealId,'CLAIM_UNAVAILABLE');
    check(typeof c.batchId==='string'&&/^0x[0-9a-f]{64}$/i.test(c.batchId)&&typeof c.termsHash==='string'&&/^0x[0-9a-f]{64}$/i.test(c.termsHash)&&Number.isSafeInteger(c.version)&&c.version>0&&/^(0|[1-9][0-9]*)$/.test(c.unitIndex)&&BigInt(c.unitIndex)<2n**256n&&Number.isSafeInteger(c.expectedGeneration)&&c.expectedGeneration>=1,'CANDIDATE_UNVERIFIED',503);
    validateWindows(c.windows);return c;
  };
  const enabled=()=>check(chain.claimEnabled===true,'CLAIM_NOT_CONNECTED',503);
  const key=(wallet,requestId)=>`${wallet}:${ref(requestId)}`;
  async function syncCancelled(wallet){
    if(typeof chain.voucherState!=='function')return;
    const candidates=Object.values((await store.read()).vouchers||{}).filter(v=>v.wallet===wallet&&v.state==='ISSUED');
    for(const saved of candidates){
      const e=await chain.voucherState(copy(saved));
      if(e?.verified!==true||e.finalized!==true||e.state!=='CANCELLED')continue;
      check(e.voucherId===saved.id&&e.generation===saved.generation&&e.recipient?.toLowerCase()===wallet,'VOUCHER_EVIDENCE_MISMATCH',503);
      await store.transact(s=>{const v=ownedVoucher(s,wallet,saved.id);if(v.state==='ISSUED'&&v.generation===e.generation){v.state='CANCELLED';delete s.displays?.[v.id];}});
    }
  }
  return {
    async review(wallet,body) {
      wallet=address(wallet);enabled();
      check(Object.keys(body||{}).sort().join()==='mealId,requestId,storeId','INVALID_REQUEST',422);
      const c=await candidate(ref(body.storeId),ref(body.mealId));
      await syncCancelled(wallet);
      const eligibility=await chain.eligibility(wallet);
      check(eligibility.verified===true&&eligibility.policySeconds===policySeconds,'POLICY_UNVERIFIED',503);
      check(eligibility.nextEligibleAt<=clock(),'CLAIM_COOLDOWN');
      return store.transact(s=>{
        initialize(s);const request=key(wallet,body.requestId),original=s.claimRequests[request];
        if(original){check(original.action==='review'&&original.storeId===body.storeId&&original.mealId===body.mealId,'REQUEST_CONFLICT');return copy(s.claimReviews[original.id]);}
        check(!Object.values(s.claims).some(i=>i.wallet===wallet&&pending(i)),'CLAIM_PENDING');
        const review={...copy(c),id:newId(),wallet,expiresAt:clock()+120,lifetimeSeconds:policySeconds};
        s.claimReviews[review.id]=review;s.claimRequests[request]={action:'review',storeId:body.storeId,mealId:body.mealId,id:review.id};
        return copy(review);
      });
    },
    async confirm(wallet,body) {
      wallet=address(wallet);enabled();
      check(Object.keys(body||{}).sort().join()==='requestId,reviewId','INVALID_REQUEST',422);
      await syncCancelled(wallet);
      const eligibility=await chain.eligibility(wallet);
      check(eligibility.verified===true&&eligibility.policySeconds===policySeconds,'POLICY_UNVERIFIED',503);
      return store.transact(s=>{
        initialize(s);const request=key(wallet,body.requestId),original=s.claimRequests[request];
        if(original){check(original.action==='confirm'&&original.reviewId===body.reviewId,'REQUEST_CONFLICT');return publicClaim(s.claims[original.id]);}
        const review=s.claimReviews[ref(body.reviewId)];check(review?.wallet===wallet,'REVIEW_NOT_FOUND',404);
        if(review.claimId){s.claimRequests[request]={action:'confirm',reviewId:review.id,id:review.claimId};return publicClaim(s.claims[review.claimId]);}
        check(review.expiresAt>clock(),'REVIEW_EXPIRED');
        check(eligibility.nextEligibleAt<=clock()&&!Object.values(s.vouchers).some(v=>v.wallet===wallet&&v.state!=='CANCELLED'&&v.claimedAt+policySeconds>clock()),'CLAIM_COOLDOWN');
        check(!Object.values(s.claims).some(i=>i.wallet===wallet&&pending(i)),'CLAIM_PENDING');
        check(!Object.values(s.claims).some(i=>unitKey(i)===unitKey(review)&&pending(i)),'UNIT_RESERVED');
        const previous=Object.values(s.vouchers).filter(v=>unitKey(v)===unitKey(review));
        check(previous.every(v=>!v.pendingRedemptionId&&['ISSUED','EXPIRED'].includes(v.state)&&v.expiresAt<=clock()),'UNIT_RESERVED');
        if(previous.length)check(review.expectedGeneration===Math.max(...previous.map(v=>v.generation))+1,'UNIT_GENERATION_CHANGED');
        const intent={...copy(review),id:newId(),reviewId:review.id,requestId:body.requestId,state:'QUEUED',createdAt:clock()};
        s.claims[intent.id]=intent;review.claimId=intent.id;
        s.claimRequests[request]={action:'confirm',reviewId:review.id,id:intent.id};
        return publicClaim(intent);
      });
    },
    async get(wallet,id){return publicClaim(claimFor(await store.read(),address(wallet),id));},
    async byRequest(wallet,requestId){wallet=address(wallet);const s=await store.read(),record=s.claimRequests?.[key(wallet,requestId)];check(record?.action==='confirm','CLAIM_NOT_FOUND',404);return publicClaim(claimFor(s,wallet,record.id));},
    // Internal worker only. signClaim must validate full immutable calldata and
    // return a signed packet/hash without broadcasting; packet stays server-side.
    async signNext() {
      enabled();
      return store.transact(async s=>{
        initialize(s);
        if(Object.values(s.claims).some(c=>['SIGNED','SEND_UNKNOWN','HASH_BOUND'].includes(c.state)))return null;
        const intent=Object.values(s.claims).find(c=>c.state==='QUEUED');if(!intent)return null;
        const packet=await chain.signClaim(copy(intent));
        if(packet?.verified===true&&packet.unavailable===true&&packet.reason==='STORE_CLOSED'&&!packet.raw&&!packet.hash){check(packet.finalized===true&&Number.isSafeInteger(packet.blockNumber)&&packet.blockNumber>=0&&/^0x[0-9a-f]{64}$/i.test(packet.blockHash||'')&&packet.storeId===intent.storeId&&packet.batchId===intent.batchId&&packet.unitIndex===intent.unitIndex&&packet.expectedGeneration===intent.expectedGeneration,'CLAIM_CLOSURE_UNVERIFIED',503);intent.state='REJECTED';intent.reason='STORE_CLOSED';return publicClaim(intent);}
        check(packet?.verified===true&&/^0x[0-9a-f]{64}$/i.test(packet.hash)&&typeof packet.raw==='string'&&/^0x[0-9a-f]+$/i.test(packet.raw),'CLAIM_PACKET_UNVERIFIED',503);
        try{validateClaimPacket(intent,chain.target,packet);}catch{fail('CLAIM_PACKET_UNVERIFIED',503);}
        intent.packet=packet.raw;intent.txHash=packet.hash.toLowerCase();intent.state='SIGNED';return publicClaim(intent);
      });
    },
    async dispatch(id) {
      enabled();const packet=await store.transact(s=>{
        const intent=s.claims?.[ref(id)];check(intent?.state==='SIGNED','CLAIM_ALREADY_ATTEMPTED');
        intent.state='SEND_UNKNOWN';intent.attemptedAt=clock();return {raw:intent.packet,hash:intent.txHash};
      });
      // Admission is persisted before a single broadcast. A thrown/lost response
      // never clears the hash or schedules a second send. Recovery is read-only.
      try {const returned=await chain.broadcastClaim(packet.raw);check(returned.toLowerCase()===packet.hash,'CLAIM_HASH_MISMATCH',503);} catch { /* original hash is already durable */ }
      return {id,state:'SEND_UNKNOWN'};
    },
    async reconcile(wallet,id) {
      wallet=address(wallet);const original=claimFor(await store.read(),wallet,id);
      if(!['SIGNED','SEND_UNKNOWN','HASH_BOUND'].includes(original.state))return publicClaim(original);
      const evidence=await chain.verifyClaim(copy(original));
      return store.transact(s=>{
        const intent=claimFor(s,wallet,id);if(['CONFIRMED','REVERTED'].includes(intent.state))return publicClaim(intent);
        if(evidence?.verified!==true)return publicClaim(intent);
        check(evidence.txHash===intent.txHash,'CLAIM_EVIDENCE_MISMATCH');
        intent.state='HASH_BOUND';
        if(evidence.finalized===true){
          check(['CONFIRMED','REVERTED'].includes(evidence.outcome),'CLAIM_EVIDENCE_MISMATCH');
          if(evidence.outcome==='CONFIRMED') {
            check(evidence.recipient?.toLowerCase()===wallet&&evidence.termsHash===intent.termsHash&&evidence.batchId===intent.batchId&&evidence.unitIndex===intent.unitIndex&&evidence.generation===intent.expectedGeneration&&Number.isSafeInteger(evidence.claimedAt)&&evidence.expiresAt===evidence.claimedAt+policySeconds,'CLAIM_EVIDENCE_MISMATCH');
            const voucherId=ref(evidence.voucherId);
            check(!s.vouchers[voucherId]||s.vouchers[voucherId].claimId===intent.id,'VOUCHER_CONFLICT');
            s.vouchers[voucherId]={id:voucherId,claimId:intent.id,wallet,storeId:intent.storeId,mealId:intent.mealId,name:intent.name,version:intent.version,windows:copy(intent.windows),termsHash:intent.termsHash,batchId:intent.batchId,unitIndex:intent.unitIndex,generation:evidence.generation,state:evidence.state==='CANCELLED'?'CANCELLED':'ISSUED',claimedAt:evidence.claimedAt,expiresAt:evidence.expiresAt};
            intent.voucherId=voucherId;
          }
          intent.state=evidence.outcome;delete intent.packet;
        }
        return publicClaim(intent);
      });
    },
    async vouchers(wallet){wallet=address(wallet);await syncCancelled(wallet);return {items:Object.values((await store.read()).vouchers||{}).filter(v=>v.wallet===wallet).map(v=>publicVoucher({...v,state:v.state==='ISSUED'&&v.expiresAt<=clock()?'EXPIRED':v.state}))};},
    async voucher(wallet,id){wallet=address(wallet);ownedVoucher(await store.read(),wallet,id);await syncCancelled(wallet);const v=ownedVoucher(await store.read(),address(wallet),id);return publicVoucher({...v,state:v.state==='ISSUED'&&v.expiresAt<=clock()?'EXPIRED':v.state});},
    async display(wallet,id){
      wallet=address(wallet);const saved=ownedVoucher(await store.read(),wallet,id);
      const evidence=await chain.voucherState(copy(saved));
      check(evidence?.verified===true&&evidence.voucherId===saved.id&&evidence.state==='ISSUED'&&evidence.recipient?.toLowerCase()===wallet&&evidence.generation===saved.generation,'VOUCHER_UNAVAILABLE');
      return store.transact(s=>{
        initialize(s);const v=ownedVoucher(s,wallet,id),now=clock(),end=windowEnd(v.windows,now);
        check(!v.pendingRedemptionId,'REDEMPTION_PENDING');
        check(v.state==='ISSUED'&&v.expiresAt>now,'VOUCHER_EXPIRED');check(end>now,'OUTSIDE_SERVICE_WINDOW');
        let code,hashed;
        for(let tries=0;tries<20;tries++){
          code=String(randomInt(0,1000000)).padStart(6,'0');hashed=hash(code);
          if(!Object.values(s.displays).some(d=>d.hash===hashed&&d.expiresAt>now))break;
          code=null;
        }
        check(code,'DISPLAY_UNAVAILABLE',503);
        const expiresAt=Math.min(now+120,v.expiresAt,end);
        s.displays[id]={hash:hashed,expiresAt,generation:(s.displays[id]?.generation||0)+1};
        return {code,expiresAt};
      });
    },
  };
}
