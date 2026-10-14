import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderClaimFlow,renderMyMeals,renderLiveStore,supportState} from './dist/onboarding-view.mjs';
const source=readFileSync(new URL('./dist/app.js',import.meta.url),'utf8'),claim=source.slice(source.indexOf('function claimCurrent('));
const auth=source.split('\n').find(line=>line.startsWith('function isLiveAuthRejection('));
const wallet='0x'+'1'.repeat(40),store='a'.repeat(64),meal='b'.repeat(64),voucherId='0x'+'c'.repeat(64),intentId='original-issue';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function harness(){
 const calls=[],body={innerHTML:''},timers=[],qr=[],navigator={};
 const voucher={id:voucherId,voucherId,store,state:'R',expiresAt:'2000000000',terms:{name:'Rice',windows:[[0,1440]]},locked:false,pending:false,marked:false};
 const storageEntries=new Map(),sessionStorage={getItem:k=>storageEntries.get(k)??null,setItem:(k,v)=>storageEntries.set(k,String(v)),removeItem:k=>storageEntries.delete(k)};
 const live={generation:0,context:{session:{wallet}},claim:null,claimPending:null,vouchers:[],claimIntents:[],claimRecordsLoading:false,stores:[{id:store}],meals:{[store]:[{id:meal,name:'Rice',listed:true,available:1}]}};
 live.api={createClaimReview:async x=>{calls.push(['review',x]);return {reviewId:'original-review',review:{mealId:'0x'+meal,name:'Rice',windows:[[0,1440]]}};},confirmClaim:async id=>{calls.push(['confirm',id]);return {id:intentId,stage:'ACCEPTED'};},getClaimIntent:async id=>{calls.push(['intent',id]);return {id,stage:'ACCEPTED',result:null};},getVoucher:async id=>{calls.push(['voucher',id]);return voucher;},getMyVouchers:async()=>[voucher],getClaimIntents:async()=>[{id:intentId,stage:'ACCEPTED'}],prepareVoucherDisplay:async id=>{calls.push(['display',id]);return {display:'x'.repeat(43),displayUrl:'https://localhost:16443/#verify?code='+'x'.repeat(43),now:1000,validUntil:1120};}};
 const fn=new Function('live','body','renderClaimFlow','supportState','calls','timers','qr','navigator','sessionStorage',`${auth}const modal=html=>{body.innerHTML=html;},close=()=>{},renderLive=()=>{},closeSupportFlow=()=>{},liveMessage=e=>e.message,startMetaMaskLogin=async()=>calls.push(['login']);const location={origin:'https://localhost:16443'};const document={querySelector:()=>({})};const window={QRCode:class{static CorrectLevel={M:1};constructor(node,options){qr.push(options.text);}}};const setTimeout=(f,ms)=>{timers.push({f,ms});return timers.length;},clearTimeout=()=>{};function clearLiveIdentity(){live.generation++;closeClaimFlow();live.context.session=null;live.vouchers=[];live.claimIntents=[];live.claimPending=null;}${claim};return {handleClaimAction,closeClaimFlow,loadClaimRecords,clearLiveIdentity,showClaimFlow};`)(live,body,renderClaimFlow,supportState,calls,timers,qr,navigator,sessionStorage);
 return {live,calls,body,fn,voucher,timers,qr,navigator,storageEntries,act:(action,data={})=>fn.handleClaimAction(action,{dataset:{storeId:store,mealId:meal,...data}})};
}
test('claim requires explicit review and confirm, final result and matching real voucher before success',async()=>{
 const h=harness();await h.act('claim-start');assert.equal(h.calls.length,0);await h.act('claim-review');assert.equal(h.calls[0][0],'review');await h.act('claim-confirm');assert.equal(h.calls.filter(c=>c[0]==='confirm').length,1);assert.doesNotMatch(h.body.innerHTML,/voucher is ready/);
 h.live.api.getClaimIntent=async()=>({id:intentId,stage:'FINAL_SUCCEEDED',result:{result:voucherId}});await h.act('claim-check');assert.match(h.body.innerHTML,/voucher is ready/);assert.equal(h.live.claim.voucher.id,voucherId);assert.equal(h.calls.filter(c=>c[0]==='display').length,0);
});
test('final result without exact voucher reference or matching voucher does not show success',async()=>{
 for(const result of [null,{voucherId},{result:'untrusted'}]){const h=harness();await h.act('claim-open',{intentId});h.live.api.getClaimIntent=async()=>({id:intentId,stage:'FINAL_SUCCEEDED',result});await h.act('claim-check');assert.equal(h.live.claim.voucher,null);assert.doesNotMatch(h.body.innerHTML,/voucher is ready/);}
 const h=harness();h.live.api.getClaimIntent=async()=>({id:intentId,stage:'FINAL_SUCCEEDED',result:{result:voucherId}});h.live.api.getVoucher=async()=>({id:'other'});await h.act('claim-open',{intentId});assert.equal(h.live.claim.voucher,null);
});
test('lost confirmation is never repeated or replaced, and My meals restores original issue and voucher',async()=>{
 const h=harness();await h.act('claim-start');await h.act('claim-review');let attempts=0;h.live.api.confirmClaim=async()=>{attempts++;throw Error('Response lost');};await h.act('claim-confirm');await h.act('claim-confirm');await h.act('claim-close');await h.act('claim-start');await h.act('claim-review');assert.equal(attempts,1);assert.equal(h.calls.filter(c=>c[0]==='review').length,1);
 await h.act('claim-records');assert.equal(h.live.claimIntents[0].id,intentId);assert.equal(h.live.vouchers[0].id,voucherId);assert.match(renderMyMeals({session:{wallet},vouchers:h.live.vouchers,intents:h.live.claimIntents}),/My meals/);
});
test('private, unlisted, and empty public meals cannot start a claim',async()=>{
 for(const change of ['missing','unlisted','empty']){const h=harness();if(change==='missing')h.live.meals[store]=[];if(change==='unlisted')h.live.meals[store][0].listed=false;if(change==='empty')h.live.meals[store][0].available=0;await h.act('claim-start');assert.equal(h.live.claim,null);assert.equal(h.calls.length,0);}
 const h=harness();assert.match(renderLiveStore(h.live.stores[0],h.live.meals[store]),/data-live-action="claim-start"/);
});
test('closing or changing wallet discards late private review, voucher, and display results',async()=>{
 for(const mode of ['close','wallet'])for(const operation of ['review','voucher','display']){
  const h=harness(),wait=deferred();let promise,value;
  if(operation==='review'){await h.act('claim-start');h.live.api.createClaimReview=()=>wait.promise;promise=h.act('claim-review');value={reviewId:'late',review:{mealId:'0x'+meal}};}
  if(operation==='voucher'){h.live.api.getVoucher=()=>wait.promise;promise=h.act('claim-voucher',{voucherId});value=h.voucher;}
  if(operation==='display'){await h.act('claim-voucher',{voucherId});h.live.api.prepareVoucherDisplay=()=>wait.promise;promise=h.act('claim-display');value={display:'x'.repeat(43),now:1000,validUntil:1120};}
  mode==='wallet'?h.fn.clearLiveIdentity():h.fn.closeClaimFlow();wait.resolve(value);await promise;assert.equal(h.live.claim,null);assert.equal(h.body.innerHTML,'');assert.equal(h.qr.length,0);
 }
});
test('code uses local QR only after explicit click and is removed on expiry or close',async()=>{
 const h=harness();await h.act('claim-voucher',{voucherId});assert.equal(h.qr.length,0);await h.act('claim-display');assert.equal(h.calls.filter(c=>c[0]==='display').length,1);assert.equal(h.qr.length,1);assert.match(h.qr[0],/^https:\/\/localhost:16443\/#verify\?code=/);assert.equal(h.timers[0].ms,120000);
 await h.act('claim-display');assert.equal(h.calls.filter(c=>c[0]==='display').length,1);h.timers[0].f();assert.equal(h.live.claim.display,null);assert.doesNotMatch(h.body.innerHTML,/x{43}/);await h.act('claim-close');assert.equal(h.body.innerHTML,'');
 assert.doesNotMatch(claim,/localStorage|console\./); // Only wallet-scoped non-secret original references may be persisted.
});
test('wallet invalidation discards pending record list and auth failure clears all private records',async()=>{
 const h=harness(),wait=deferred();h.live.api.getMyVouchers=()=>wait.promise;const pending=h.fn.loadClaimRecords();h.fn.clearLiveIdentity();wait.resolve([h.voucher]);await pending;assert.deepEqual(h.live.vouchers,[]);
 const p=harness();p.live.api.getMyVouchers=async()=>{throw Object.assign(Error('unauthorized'),{status:401});};await p.fn.loadClaimRecords();assert.equal(p.live.context.session,null);assert.deepEqual(p.live.vouchers,[]);
});
test('invalid code, expired code, and off-site credential links never render a QR',async()=>{
 for(const change of [{display:'bad'},{validUntil:999},{displayUrl:'https://example.com/#verify?code='+'x'.repeat(43)},{redeemable:false,display:null}]){
  const h=harness();await h.act('claim-voucher',{voucherId});h.live.api.prepareVoucherDisplay=async()=>({display:'x'.repeat(43),now:1000,validUntil:1120,...change});await h.act('claim-display');assert.equal(h.live.claim.display,null);assert.equal(h.qr.length,0);
 }
});
test('auth failure in either records endpoint wins over other errors and anonymous render hides private records',async()=>{
 const h=harness();h.live.api.getMyVouchers=async()=>{throw Error('Unavailable');};h.live.api.getClaimIntents=async()=>{throw Object.assign(Error('Unauthorized'),{status:401});};await h.fn.loadClaimRecords();assert.equal(h.live.context.session,null);
 assert.doesNotMatch(renderMyMeals({session:null,vouchers:[h.voucher],intents:[{id:intentId}]}),new RegExp(voucherId+'|'+intentId));
});
test('stale confirmation permits only explicit same-review retry while keeping replacement claims locked',async()=>{
 const h=harness();await h.act('claim-start');await h.act('claim-review');const review=h.live.claim.review,confirm=h.live.api.confirmClaim;let attempts=0;
 h.live.api.confirmClaim=async id=>{assert.equal(id,review.reviewId);attempts++;throw Object.assign(Error('stale'),{code:'FINALIZED_FACTS_STALE',status:503});};
 await h.act('claim-confirm');assert.equal(attempts,1);assert.equal(h.live.claim.confirmAttempted,false);assert.equal(h.live.claim.review,review);assert.equal(h.live.claimPending.reviewId,review.reviewId);assert.match(h.body.innerHTML,/outcome is not yet verified/);assert.doesNotMatch(h.body.innerHTML,/No claim was created|voucher is ready/);
 await h.act('claim-review');assert.equal(h.calls.filter(c=>c[0]==='review').length,1);h.live.api.confirmClaim=confirm;await h.act('claim-confirm');assert.deepEqual(h.calls.find(c=>c[0]==='confirm'),['confirm',review.reviewId]);assert.equal(h.live.claimPending.intentId,intentId);
 const p=harness();await p.act('claim-start');await p.act('claim-review');p.live.api.confirmClaim=async()=>{throw Object.assign(Error('stale'),{code:'FINALIZED_FACTS_STALE'});};await p.act('claim-confirm');await p.act('claim-close');await p.act('claim-start');await p.act('claim-review');assert.equal(p.calls.filter(c=>c[0]==='review').length,1);assert.ok(p.live.claimPending);
});
test('stale after intent creation and unknown 503 confirmations never unlock confirmation',async()=>{
 const h=harness();await h.act('claim-start');await h.act('claim-review');h.live.api.getClaimIntent=async()=>{throw Object.assign(Error('stale'),{code:'FINALIZED_FACTS_STALE'});};await h.act('claim-confirm');await h.act('claim-confirm');assert.equal(h.live.claim.intent.id,intentId);assert.equal(h.live.claim.confirmAttempted,true);assert.equal(h.calls.filter(c=>c[0]==='confirm').length,1);
 const p=harness();await p.act('claim-start');await p.act('claim-review');let attempts=0;p.live.api.confirmClaim=async()=>{attempts++;throw Object.assign(Error('unavailable'),{status:503});};await p.act('claim-confirm');await p.act('claim-confirm');assert.equal(attempts,1);assert.equal(p.live.claim.confirmAttempted,true);
});
test('Show QRcode uses voucher-specific stale guidance without denying confirmed payment or claim',async()=>{
 const h=harness();await h.act('claim-voucher',{voucherId});assert.match(h.body.innerHTML,/>Show QRcode</);assert.doesNotMatch(h.body.innerHTML,/Show short-lived code/);
 h.live.api.prepareVoucherDisplay=async()=>{throw Object.assign(Error('stale'),{code:'FINALIZED_FACTS_STALE'});};await h.act('claim-display');
 assert.match(h.body.innerHTML,/On-chain voucher data needs refreshing/);assert.match(h.body.innerHTML,/confirmed payment and claim remain unchanged/);assert.doesNotMatch(h.body.innerHTML,/Payment is not confirmed|Payment not confirmed/);assert.equal(h.live.claim.voucher.id,voucherId);assert.equal(h.live.claim.voucher.state,'R');assert.equal(h.live.claim.display,null);assert.equal(h.qr.length,0);
});

test('copy private link writes only the current valid display URL and reports actual success',async()=>{
 const h=harness(),copied=[];h.navigator.clipboard={writeText:async value=>copied.push(value)};await h.act('claim-voucher',{voucherId});await h.act('claim-display');assert.match(h.body.innerHTML,/Copy private link/);assert.match(h.body.innerHTML,/Open private voucher link/);const url=h.live.claim.display.displayUrl;await h.act('claim-copy-link');assert.deepEqual(copied,[url]);assert.match(h.body.innerHTML,/>Copied</);assert.doesNotMatch(copied[0],/#mine|:~:text=/);
});
test('denied or missing clipboard shows a selectable readonly full link without claiming copied',async()=>{
 for(const denied of [true,false]){const h=harness();if(denied)h.navigator.clipboard={writeText:async()=>{throw Error('denied');}};await h.act('claim-voucher',{voucherId});await h.act('claim-display');await h.act('claim-copy-link');assert.match(h.body.innerHTML,/id="voucher-private-link" type="text" readonly/);assert.match(h.body.innerHTML,/Clipboard unavailable/);assert.doesNotMatch(h.body.innerHTML,/>Copied</);assert.ok(h.body.innerHTML.includes('value="'+h.live.claim.display.displayUrl+'"'));h.timers[0].f();assert.doesNotMatch(h.body.innerHTML,/voucher-private-link|Clipboard unavailable|x{43}/);}
});
test('expired or mismatched links are not copied, and late copy completion cannot restore closed private UI',async()=>{
 for(const change of ['expired','external','mismatch']){const h=harness();let writes=0;h.navigator.clipboard={writeText:async()=>writes++};await h.act('claim-voucher',{voucherId});await h.act('claim-display');if(change==='expired')h.live.claim.display.expiresLocally=Date.now()-1;else h.live.claim.display.displayUrl=change==='external'?'https://elsewhere.test/#verify?code='+'x'.repeat(43):'https://localhost:16443/#verify?code='+'y'.repeat(43);await h.act('claim-copy-link');assert.equal(writes,0);assert.doesNotMatch(h.body.innerHTML,/>Copied</);}
 for(const mode of ['close','wallet']){const h=harness(),wait=deferred();h.navigator.clipboard={writeText:()=>wait.promise};await h.act('claim-voucher',{voucherId});await h.act('claim-display');const pending=h.act('claim-copy-link');mode==='close'?h.fn.closeClaimFlow():h.fn.clearLiveIdentity();wait.resolve();await pending;assert.equal(h.live.claim,null);assert.equal(h.body.innerHTML,'');}
});

test('CP31 claim button submits one review + one original issue request in one click',async()=>{
 const h=harness();await h.act('claim-start');
 assert.match(h.body.innerHTML,/>Claim this meal</);
 await h.act('claim-one-tap');
 assert.deepEqual(h.calls.filter(c=>['review','confirm'].includes(c[0])).map(c=>c[0]),['review','confirm']);
 assert.equal(h.live.claim.intent.id,intentId);
 assert.equal(h.qr.length,0,'never produce a QR without finalized voucher');
 assert.equal(h.storageEntries.size,1,'only an original claim reference is retained');
 const stored=JSON.parse([...h.storageEntries.values()][0]);
 assert.equal(stored.reviewId,'original-review');assert.equal(stored.intentId,intentId);
 assert.equal(stored.access,undefined);assert.equal(stored.display,undefined);
 await h.act('claim-one-tap');assert.equal(h.calls.filter(c=>c[0]==='confirm').length,1);
});

test('CP31 a pending claim is recovered after closing its dialog; no replacement issue is created',async()=>{
 const h=harness();await h.act('claim-start');await h.act('claim-one-tap');
 await h.act('claim-close');await h.act('claim-start');
 assert.equal(h.live.claim.intent.id,intentId);
 assert.equal(h.calls.filter(c=>c[0]==='review').length,1);
 assert.equal(h.calls.filter(c=>c[0]==='confirm').length,1);
 assert.match(h.body.innerHTML,/Preparing your meal/);
});

test('CP31 finalized issue shows original voucher, clears pending reference and requires explicit QR display',async()=>{
 const h=harness();h.live.api.getClaimIntent=async id=>({id,stage:'FINAL_SUCCEEDED',result:{result:voucherId}});
 await h.act('claim-start');await h.act('claim-one-tap');
 assert.equal(h.live.claim.voucher.id,voucherId);
 assert.equal(h.live.claimPending,null);
 assert.equal(h.storageEntries.size,0);
 assert.equal(h.qr.length,0);
 assert.match(h.body.innerHTML,/>Show QRcode</);
});

test('CP31 no second issue is created after an ambiguous confirmation',async()=>{
 const h=harness();h.live.api.confirmClaim=async()=>{throw Error('Response lost');};
 await h.act('claim-start');await h.act('claim-one-tap');
 const first=JSON.parse([...h.storageEntries.values()][0]);
 assert.equal(first.reviewId,'original-review');assert.equal(first.intentId,null);
 await h.act('claim-close');await h.act('claim-start');
 assert.match(h.body.innerHTML,/>Continue original claim</);
 assert.equal(h.calls.filter(c=>c[0]==='review').length,1);
 assert.equal(h.calls.filter(c=>c[0]==='confirm').length,0);
});