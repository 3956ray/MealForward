// Only the isolated, fake-account experience sandbox uses this helper.
// It is not a real recipient authorization, QR issuer, or production redemption.
import * as M from './model.mjs';
import {nextDemoServiceInstant} from './demo-service.mjs';

const DEMO_RECIPIENTS=['neighbor@mealforward.invalid','visitor@mealforward.invalid'];

function canDisplayAtNextWindow(voucher,now){
  if(voucher.status!=='issued'||now>=voucher.expires)return false;
  return !!M.inWindow(M.getStore(voucher.store),now,voucher.windows) ||
    nextDemoServiceInstant(voucher.windows,now,voucher.expires)!==null;
}

// Called ONLY inside an M.transaction clone after an explicit owner's click.
// A recipient's logout continues to revoke QR codes in the original model.
// Here the sandbox explicitly simulates that recipient showing a fresh code;
// no identity, wallet, secret or onchain operation is impersonated outside this
// browser-local fixture. The caller is still the original kitchen owner.
export function prepareKitchenDemoCode(state,storeId){
  M.authorize(state,storeId);
  const ownerSession=state.session;
  let now=M.nowFor(state);
  M.expire(state,now);
  const voucherCandidates=state.coupons.filter(c=>
    c.store===storeId&&DEMO_RECIPIENTS.includes(c.email)&&
    !state.ops.some(op=>M.isOpen(op)&&op.coupon===c.id)&&
    canDisplayAtNextWindow(c,now)
  );
  let voucher=voucherCandidates.at(-1),created=false,advancedClock=false;

  if(!voucher){
    const recipient=DEMO_RECIPIENTS.find(email=>
      !state.coupons.some(c=>c.email===email&&now<c.expires)&&
      !state.ops.some(op=>op.email===email&&op.kind==='claim'&&M.isOpen(op))
    );
    if(!recipient)throw Error('No eligible demo recipient is available. Existing voucher responsibilities are preserved. Use an existing issued test voucher or reset only the sandbox after reviewing your demo records.');
    const meal=M.mealsFor(state,storeId,true).find(item=>
      item.active===true&&M.stats(state,storeId,item.id).available>0
    );
    if(!meal)throw Error('This kitchen has no available published meal to issue as a sandbox fixture.');
    state.session={email:recipient};
    const issued=M.claim(state,storeId,now,meal.id);
    M.resolve(state,issued.id,'final',now);
    voucher=state.coupons.find(c=>c.id===issued.coupon);
    created=true;
  }

  if(!voucher||voucher.status!=='issued')throw Error('The original sandbox voucher is not eligible for verification.');
  if(!M.inWindow(M.getStore(storeId),now,voucher.windows)){
    const next=nextDemoServiceInstant(voucher.windows,now,voucher.expires);
    if(next===null)throw Error('The voucher has no remaining service window before its original expiry. No code was generated.');
    state.clockOffset=next-Date.now();
    now=M.nowFor(state);
    advancedClock=true;
  }

  let code;
  state.session={email:voucher.email};
  try{code=M.credential(state,voucher,now);}
  finally{state.session=ownerSession;}

  if(!code||voucher.token!==code)throw Error('A sandbox display code was not confirmed.');
  return {code,storeId,voucherId:voucher.id,created,advancedClock,expiresAt:voucher.tokenExpires,recipient:'simulated'};
}
