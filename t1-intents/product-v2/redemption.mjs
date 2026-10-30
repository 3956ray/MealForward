/** Owner-authorized handover/settlement. This service NEVER sends transactions.
 * Only explicit wallet attempt admission can release one send; recovery is read-only.
 */
import {createHmac,createHash,randomUUID} from 'node:crypto';
import {fail,validateWindows} from './service.mjs';
import {validatePermitSignature,validateRedemptionTransaction} from './redemption-wire.mjs';
const check=(v,c,s=409)=>{if(!v)fail(c,s);};
const copy=v=>structuredClone(v);
const address=v=>{check(typeof v==='string'&&/^0x[0-9a-f]{40}$/i.test(v)&&BigInt(v)!==0n,'UNAUTHENTICATED',401);return v.toLowerCase();};
const ref=v=>{check(typeof v==='string'&&/^[a-zA-Z0-9_-]{1,96}$/.test(v),'INVALID_ID',422);return v;};
const exact=(body,keys)=>check(body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).sort().join()===keys.sort().join(),'INVALID_REQUEST',422);
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const hash=v=>createHash('sha256').update(canonical(v)).digest('hex');
const pending=o=>['AWAITING_HANDOVER','PREPARED','SEND_UNKNOWN','HASH_BOUND'].includes(o.state);
const initialize=s=>{for(const k of ['redemptions','verificationHandles','redemptionReviews','redemptionRequests','redemptionRates'])s[k]||={};return s;};
function publicOperation(o,session){
  return {id:o.id,kind:o.kind,state:o.state,storeId:o.storeId,voucherId:o.voucherId,generation:o.generation,name:o.name,version:o.version,
    unitPrice:o.unitPrice,amount:o.amount,receiver:o.receiver,createdAt:o.createdAt,windows:copy(o.windows),...(o.recoveredFrom?{handoverPreviouslyConfirmed:true,recoveredFrom:o.recoveredFrom}:{}),...(o.expiresAt?{expiresAt:o.expiresAt}:{}),
    ...(o.state==='AWAITING_HANDOVER'?{canConfirmHandover:o.session===session,...(o.session===session?{handle:o.handle}:{})}:{}),
    ...(o.txHash?{txHash:o.txHash}:{}),...(o.candidateHash?{candidateHash:o.candidateHash}:{}),
    ...(o.state==='PREPARED'?{transaction:copy(o.transaction)}:{})};
}
function windowEnd(windows,now){
  validateWindows(windows);const local=now+480*60,minute=Math.floor(local%86400/60),start=Math.floor(local/86400)*86400-480*60;
  const interval=windows.find(([a,b])=>minute>=a&&minute<b);return interval?start+interval[1]*60:0;
}

export function makeRedemptionService({store,chain,pepper,clock=()=>Math.floor(Date.now()/1000),newId=randomUUID}){
  check(typeof pepper==='string'&&pepper.length>=32,'CREDENTIAL_KEY_REQUIRED',503);
  const codeHash=code=>createHmac('sha256',pepper).update(code).digest('hex');
  const scope=value=>{check(typeof value==='string'&&value.length>0&&value.length<=256,'SESSION_REQUIRED',401);return codeHash('session:'+value);};
  const requestKey=(wallet,id)=>`${wallet}:${ref(id)}`;
  const owned=(s,w,id)=>{const o=s.redemptions?.[ref(id)];check(o?.wallet===w,'OPERATION_NOT_FOUND',404);return o;};
  const enabled=()=>check(chain.redemptionEnabled===true,'REDEMPTION_NOT_CONNECTED',503);
  async function owner(wallet,storeId){
    const catalog=await chain.catalog();check(catalog?.verified===true,'CATALOG_UNVERIFIED',503);check(catalog.stores?.some(s=>s.id===storeId&&s.owner.toLowerCase()===wallet),'STORE_ACCESS_DENIED',403);
  }
  async function evidence(v,wallet){
    const e=await chain.voucherState(copy(v));
    check(e?.verified===true&&e.voucherId===v.id&&e.generation===v.generation&&e.storeId===v.storeId&&e.owner?.toLowerCase()===wallet&&e.recipient?.toLowerCase()===v.wallet
      &&Number.isSafeInteger(e.chainTime)&&e.chainTime>=0&&typeof e.unitPrice==='string'&&/^[1-9][0-9]{0,77}$/.test(e.unitPrice)&&BigInt(e.unitPrice)<2n**256n,'VOUCHER_EVIDENCE_UNVERIFIED',503);
    return e;
  }
  function uniqueWallet(s,wallet){
    check(![...Object.values(s.intents||{}),...Object.values(s.redemptions||{}),...Object.values(s.publications||{}),...Object.values(s.approvals||{})].some(o=>o.wallet===wallet&&pending(o)),'WALLET_OPERATION_PENDING');
  }
  function original(s,wallet,requestId,payload){
    const r=s.redemptionRequests[requestKey(wallet,requestId)];if(!r)return null;
    check(r.hash===hash(payload),'REQUEST_CONFLICT');return owned(s,wallet,r.id);
  }
  function remember(s,wallet,requestId,payload,id){s.redemptionRequests[requestKey(wallet,requestId)]={hash:hash(payload),id};}
  function base(v,wallet,e,kind){return {id:newId(),kind,state:'PREPARED',wallet,storeId:v.storeId,voucherId:v.id,name:v.name,version:v.version,
    generation:v.generation,windows:copy(v.windows),unitPrice:e.unitPrice,amount:e.unitPrice,receiver:wallet,createdAt:clock()};}
  const api={
    async check(wallet,sessionScope,body){
      wallet=address(wallet);const session=scope(sessionScope);exact(body,['storeId','code']);ref(body.storeId);
      await owner(wallet,body.storeId);
      // Commit guessing counters even when validation, lookup or evidence fails.
      const allowed=await store.transact(s=>{initialize(s);const bucket=Math.floor(clock()/60);
        const bump=key=>{const old=s.redemptionRates[key],count=old?.bucket===bucket?old.count+1:1;s.redemptionRates[key]={bucket,count};return count;};
        const personal=bump(wallet+':'+session),global=bump('global');return personal<=10&&global<=30;});
      check(allowed,'RATE_LIMIT',429);check(typeof body.code==='string'&&/^\d{6}$/.test(body.code),'INVALID_CODE',422);
      return store.transact(async s=>{
        initialize(s);const now=clock(),h=codeHash(body.code),matches=Object.entries(s.displays||{}).filter(([,d])=>d.hash===h&&d.expiresAt>now);
        check(matches.length===1,'INVALID_CODE',404);const [voucherId,display]=matches[0],v=s.vouchers?.[voucherId];
        check(v?.storeId===body.storeId&&v.state==='ISSUED'&&v.expiresAt>now&&!v.pendingRedemptionId,'VOUCHER_UNAVAILABLE');
        const e=await evidence(v,wallet);check(e.state==='ISSUED','VOUCHER_UNAVAILABLE');
        const end=windowEnd(v.windows,e.chainTime);check(end>0,'OUTSIDE_SERVICE_WINDOW');
        const expiresAt=Math.min(display.expiresAt,v.expiresAt,end);check(expiresAt>e.chainTime,'INVALID_CODE');
        const handle=newId();s.verificationHandles[handle]={wallet,session,voucherId,displayGeneration:display.generation,displayHash:display.hash,expiresAt,consumed:false};
        return {handle,name:v.name,version:v.version,windows:copy(v.windows),unitPrice:e.unitPrice,expiresAt,state:'VALID'};
      });
    },
    async reserveHandover(wallet,sessionScope,body){
      wallet=address(wallet);const session=scope(sessionScope);exact(body,['handle','requestId']);
      return store.transact(async s=>{
        initialize(s);const payload={action:'handover-reserve',session,...body},prior=original(s,wallet,body.requestId,payload);if(prior)return publicOperation(prior,session);
        enabled();const h=s.verificationHandles[ref(body.handle)];
        check(h?.wallet===wallet&&h.session===session,'CHECK_HANDLE_INVALID');
        if(h.operationId){const op=owned(s,wallet,h.operationId);check(pending(op),'CHECK_HANDLE_INVALID');remember(s,wallet,body.requestId,payload,op.id);return publicOperation(op,session);}
        check(!h.consumed&&h.expiresAt>clock(),'CHECK_HANDLE_INVALID');
        const v=s.vouchers?.[h.voucherId],d=s.displays?.[h.voucherId];
        check(v?.state==='ISSUED'&&!v.pendingRedemptionId&&d?.generation===h.displayGeneration&&d.hash===h.displayHash,'CHECK_HANDLE_INVALID');
        await owner(wallet,v.storeId);uniqueWallet(s,wallet);const e=await evidence(v,wallet);
        check(e.state==='ISSUED'&&v.expiresAt>e.chainTime,'VOUCHER_UNAVAILABLE');
        const end=windowEnd(v.windows,e.chainTime);check(end>0,'OUTSIDE_SERVICE_WINDOW');
        check(Math.min(v.expiresAt,end,h.expiresAt,d.expiresAt)>e.chainTime,'CHECK_HANDLE_INVALID');
        const op={...base(v,wallet,e,'handover'),state:'AWAITING_HANDOVER',handle:body.handle,session,displayGeneration:h.displayGeneration,expiresAt:v.expiresAt};
        h.consumed=true;h.operationId=op.id;v.pendingRedemptionId=op.id;delete s.displays[v.id];
        s.redemptions[op.id]=op;remember(s,wallet,body.requestId,payload,op.id);return publicOperation(op,session);
      });
    },
    async prepareHandover(wallet,sessionScope,body){
      wallet=address(wallet);const session=scope(sessionScope);exact(body,['handle','requestId','handedOver']);
      check(body.handedOver===true,'HANDOVER_CONFIRMATION_REQUIRED',422);
      return store.transact(async s=>{
        initialize(s);const payload={action:'handover',session,...body},prior=original(s,wallet,body.requestId,payload);if(prior)return publicOperation(prior,session);
        enabled();const h=s.verificationHandles[ref(body.handle)],op=h?.operationId?s.redemptions[h.operationId]:null;
        check(h?.wallet===wallet&&h.session===session&&op?.wallet===wallet&&op.session===session&&op.handle===body.handle,'HANDOVER_LOCK_REQUIRED');
        const v=s.vouchers?.[op.voucherId];
        check(v?.pendingRedemptionId===op.id&&v.generation===op.generation&&h.displayGeneration===op.displayGeneration&&pending(op),'HANDOVER_LOCK_REQUIRED');
        if(op.state!=='AWAITING_HANDOVER'){remember(s,wallet,body.requestId,payload,op.id);return publicOperation(op,session);}
        await owner(wallet,v.storeId);const e=await evidence(v,wallet);
        check(v.state==='ISSUED'&&e.state==='ISSUED'&&v.expiresAt>clock()&&v.expiresAt>e.chainTime,'VOUCHER_UNAVAILABLE');
        const end=windowEnd(v.windows,e.chainTime);check(end>0,'OUTSIDE_SERVICE_WINDOW');
        // The durable lock survives the original display/check expiry. Only
        // the same handler can now confirm physical handover and obtain a permit.
        op.expiresAt=Math.min(e.chainTime+120,v.expiresAt,end);
        op.permit={voucherId:v.id,generation:v.generation,owner:wallet,issuedAt:e.chainTime,deadline:op.expiresAt};
        op.permitSignature=await chain.signRedemptionPermit(copy(op.permit));
        try{validatePermitSignature(op.permit,op.permitSignature,chain.target);}catch{fail('REDEMPTION_SIGNATURE_UNVERIFIED',503);}
        op.transaction=validateRedemptionTransaction(op,chain.target,await chain.prepareHandover(copy(op)));
        op.state='PREPARED';op.handedOverConfirmedAt=clock();remember(s,wallet,body.requestId,payload,op.id);return publicOperation(op,session);
      });
    },
    async payouts(wallet,storeId){
      wallet=address(wallet);ref(storeId);await owner(wallet,storeId);const s=await store.read(),items=[];
      for(const v of Object.values(s.vouchers||{}).filter(v=>v.storeId===storeId)){
        const e=await evidence(v,wallet);if(!['HANDED_OVER','SETTLED'].includes(e.state))continue;
        items.push({voucherId:v.id,name:v.name,version:v.version,unitPrice:e.unitPrice,amount:e.unitPrice,receiver:wallet,state:e.state,
          chainTime:e.chainTime,settlementAvailableAt:e.settlementAvailableAt,canSettle:e.state==='HANDED_OVER'&&e.chainTime>=e.settlementAvailableAt});
      }return {items};
    },
    async reviewSettlement(wallet,body){
      wallet=address(wallet);exact(body,['voucherId','requestId']);
      return store.transact(async s=>{
        initialize(s);const key=requestKey(wallet,body.requestId),payload={action:'settlement-review',...body},prior=s.redemptionRequests[key];
        if(prior){check(prior.hash===hash(payload),'REQUEST_CONFLICT');return copy(s.redemptionReviews[prior.id]);}
        const v=s.vouchers?.[ref(body.voucherId)];check(v,'VOUCHER_NOT_FOUND',404);await owner(wallet,v.storeId);const e=await evidence(v,wallet);
        check(e.state==='HANDED_OVER','NOT_AWAITING_SETTLEMENT');check(Number.isSafeInteger(e.settlementAvailableAt)&&e.chainTime>=e.settlementAvailableAt,'SETTLEMENT_TOO_EARLY');
        const review={id:newId(),wallet,storeId:v.storeId,voucherId:v.id,generation:v.generation,name:v.name,version:v.version,unitPrice:e.unitPrice,amount:e.unitPrice,receiver:wallet,expiresAt:clock()+120};
        s.redemptionReviews[review.id]=review;s.redemptionRequests[key]={hash:hash(payload),id:review.id};return copy(review);
      });
    },
    async confirmSettlement(wallet,body){
      wallet=address(wallet);exact(body,['reviewId','requestId']);
      return store.transact(async s=>{
        initialize(s);const payload={action:'settlement-confirm',...body},prior=original(s,wallet,body.requestId,payload);if(prior)return publicOperation(prior);
        enabled();const r=s.redemptionReviews[ref(body.reviewId)];check(r?.wallet===wallet,'REVIEW_NOT_FOUND',404);
        if(r.operationId){remember(s,wallet,body.requestId,payload,r.operationId);return publicOperation(owned(s,wallet,r.operationId));}
        check(r.expiresAt>clock(),'REVIEW_EXPIRED');const v=s.vouchers?.[r.voucherId];check(v&&!v.pendingSettlementId,'SETTLEMENT_PENDING');
        await owner(wallet,v.storeId);uniqueWallet(s,wallet);const e=await evidence(v,wallet);
        check(e.state==='HANDED_OVER','NOT_AWAITING_SETTLEMENT');check(Number.isSafeInteger(e.settlementAvailableAt)&&e.chainTime>=e.settlementAvailableAt,'SETTLEMENT_TOO_EARLY');
        check(e.unitPrice===r.unitPrice&&v.generation===r.generation,'SETTLEMENT_REVIEW_CHANGED');
        const op=base(v,wallet,e,'settlement');op.transaction=validateRedemptionTransaction(op,chain.target,await chain.prepareSettlement(copy(op)));
        v.pendingSettlementId=op.id;r.operationId=op.id;s.redemptions[op.id]=op;remember(s,wallet,body.requestId,payload,op.id);return publicOperation(op);
      });
    },
    async operation(wallet,id,sessionScope){return publicOperation(owned(await store.read(),address(wallet),id),sessionScope===undefined?undefined:scope(sessionScope));},
    async byRequest(wallet,requestId,sessionScope){wallet=address(wallet);const s=await store.read(),r=s.redemptionRequests?.[requestKey(wallet,requestId)];check(r,'OPERATION_NOT_FOUND',404);return publicOperation(owned(s,wallet,r.id),sessionScope===undefined?undefined:scope(sessionScope));},
    async operations(wallet,sessionScope){wallet=address(wallet);const session=scope(sessionScope),s=await store.read();return {items:Object.values(s.redemptions||{}).filter(o=>o.wallet===wallet).map(o=>publicOperation(o,session))};},
    async resumeHandover(wallet,id,sessionScope,body){
      wallet=address(wallet);const session=scope(sessionScope);exact(body,['previousDeviceStopped']);
      check(body.previousDeviceStopped===true,'PREVIOUS_DEVICE_CONFIRMATION_REQUIRED',422);
      return store.transact(async s=>{
        const op=owned(s,wallet,id);check(op.kind==='handover'&&op.state==='AWAITING_HANDOVER','HANDOVER_LOCK_NOT_RESUMABLE');
        const v=s.vouchers?.[op.voucherId],h=s.verificationHandles?.[op.handle];
        check(v?.pendingRedemptionId===op.id&&v.generation===op.generation&&h?.operationId===op.id&&h.wallet===wallet,'REDEMPTION_RESPONSIBILITY_CHANGED');
        await owner(wallet,v.storeId);const e=await evidence(v,wallet);
        check(e.finalized===true&&e.state==='ISSUED'&&e.chainTime<v.expiresAt,'HANDOVER_RESUME_UNVERIFIED');
        // Explicitly transfer the existing lock; never issue a second permit,
        // replace its operation ID, or implicitly unlock another device.
        op.session=session;h.session=session;op.resumedAt=clock();
        return publicOperation(op,session);
      });
    },
    async attempt(wallet,id){
      wallet=address(wallet);enabled();return store.transact(async s=>{
        const op=owned(s,wallet,id);check(op.state==='PREPARED','ALREADY_ATTEMPTED');
        const v=s.vouchers[op.voucherId],e=await evidence(v,wallet);
        if(op.kind==='handover')check(e.state==='ISSUED'&&op.expiresAt>clock()&&op.expiresAt>e.chainTime,'HANDOVER_AUTHORIZATION_EXPIRED');
        else check(e.state==='HANDED_OVER'&&e.chainTime>=e.settlementAvailableAt,'SETTLEMENT_UNAVAILABLE');
        op.state='SEND_UNKNOWN';op.attemptedAt=clock();return {allowed:true,operation:publicOperation(op)};
      });
    },
    async cancel(wallet,id,sessionScope,requireInvalidated=false){
      wallet=address(wallet);return store.transact(async s=>{
        const op=owned(s,wallet,id);
        if(op.state==='CANCELLED')return publicOperation(op);
        check(op.kind==='handover'&&['AWAITING_HANDOVER','PREPARED'].includes(op.state),'ATTEMPTED_OPERATION_CANNOT_CANCEL');
        const v=s.vouchers[op.voucherId];check(v?.pendingRedemptionId===op.id&&v.id===op.voucherId&&v.generation===op.generation,'REDEMPTION_RESPONSIBILITY_CHANGED');
        await owner(wallet,v.storeId);const e=await evidence(v,wallet);
        // Finalized chain time past this immutable permit proves it can no
        // longer authorize a handover. Local clock/UNKNOWN are never enough.
        const expired=e.state==='EXPIRED'&&e.chainTime>=v.expiresAt,cancelled=e.state==='CANCELLED';
        if(requireInvalidated)check(expired||cancelled,'VOUCHER_STILL_VALID');
        check(e.finalized===true&&(e.state==='ISSUED'||expired||cancelled)&&(cancelled||op.state==='AWAITING_HANDOVER'||e.chainTime>op.permit.deadline),'CANCELLATION_NOT_YET_SAFE');
        if(op.recoveredFrom&&!expired&&!cancelled)check(false,'HANDOVER_RESPONSIBILITY_MUST_CONTINUE');
        if(op.state==='AWAITING_HANDOVER'&&!expired&&!cancelled)check(op.session===scope(sessionScope),'HANDOVER_LOCK_REQUIRED');
        if(expired)v.state='EXPIRED';if(cancelled)v.state='CANCELLED';
        op.state='CANCELLED';op.cancelledAt=clock();delete v.pendingRedemptionId;delete s.displays[v.id];
        return publicOperation(op);
      });
    },
    async recordHash(wallet,id,txHash){
      wallet=address(wallet);check(typeof txHash==='string'&&/^0x[0-9a-f]{64}$/i.test(txHash),'INVALID_HASH',422);txHash=txHash.toLowerCase();
      return store.transact(s=>{const op=owned(s,wallet,id);check(['SEND_UNKNOWN','HASH_BOUND','CONFIRMED','REVERTED'].includes(op.state),'ATTEMPT_REQUIRED');
        check(!op.txHash||op.txHash===txHash,'HASH_CONFLICT');op.candidateHash=txHash;op.candidateHashes=[...new Set([...(op.candidateHashes||[]),txHash])];return publicOperation(op);});
    },
    async reconcile(wallet,id){
      wallet=address(wallet);const prior=owned(await store.read(),wallet,id);
      if(!prior.candidateHash||!['SEND_UNKNOWN','HASH_BOUND'].includes(prior.state))return publicOperation(prior);
      const e=await chain.verifyRedemption(copy(prior),prior.candidateHash);
      return store.transact(s=>{
        const op=owned(s,wallet,id);if(!['SEND_UNKNOWN','HASH_BOUND'].includes(op.state))return publicOperation(op);check(op.candidateHash===prior.candidateHash,'HASH_CONFLICT');
        if(e?.verified!==true)return publicOperation(op);
        check(e.txHash===op.candidateHash,'REDEMPTION_EVIDENCE_MISMATCH');op.txHash=e.txHash;op.state='HASH_BOUND';
        if(e.finalized===true){
          check(['CONFIRMED','REVERTED'].includes(e.outcome)&&Number.isSafeInteger(e.blockNumber)&&e.blockNumber>=0,'REDEMPTION_EVIDENCE_MISMATCH');
          const v=s.vouchers[op.voucherId];
          if(e.outcome==='CONFIRMED'){
            check(e.voucherId===op.voucherId&&e.generation===op.generation&&e.owner?.toLowerCase()===wallet,'REDEMPTION_EVIDENCE_MISMATCH');
            if(op.kind==='handover'){
              check(e.state==='HANDED_OVER'&&Number.isSafeInteger(e.handedOverAt)&&e.settlementAvailableAt===e.handedOverAt+180,'REDEMPTION_EVIDENCE_MISMATCH');
              v.state='HANDED_OVER';v.settlementAvailableAt=e.settlementAvailableAt;
            }else{check(e.state==='SETTLED'&&e.amount===op.amount&&e.receiver?.toLowerCase()===wallet,'REDEMPTION_EVIDENCE_MISMATCH');v.state='SETTLED';}
          }
          if(op.kind==='handover'&&v.pendingRedemptionId===op.id){delete v.pendingRedemptionId;delete s.displays[v.id];}
          if(op.kind==='settlement'&&v.pendingSettlementId===op.id)delete v.pendingSettlementId;
          op.state=e.outcome;op.confirmedBlock=e.blockNumber;
        }return publicOperation(op);
      });
    },
  };
  return api;
}
