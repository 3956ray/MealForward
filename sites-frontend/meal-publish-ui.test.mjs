import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderMealPublishFlow,renderLiveKitchen} from './dist/onboarding-view.mjs';
const setup={assetDecimals:6,assetSymbol:'USDC'},review={draftId:'draft-uuid',revision:3,mealId:'new-meal',version:'1',name:'test_for_mealforward',description:'New meal',unitPrice:'500000',windows:[[0,420]],targetListed:true};
test('private draft has a disabled publish entry instead of List meal; published listing remains independent',()=>{
 const context={session:{stores:['store']},store:{id:'store'},setup};
 const draft=renderLiveKitchen({context,view:'meals',meals:[{id:'draft-uuid',published:false,listed:false,draft:review}]});assert.match(draft,/Publish meal/);assert.doesNotMatch(draft,/>List meal</);assert.match(draft,/data-live-action="meal-publish-review"[^>]*disabled/);
 const existing=renderLiveKitchen({context,view:'meals',meals:[{id:'old-meal',published:true,listed:false}]});assert.match(existing,/>List meal</);
});
test('local review separates draft ID from meal ID and preserves price and Beijing-time windows',()=>{
 const before=JSON.stringify(review),html=renderMealPublishFlow({review},setup);for(const value of ['draft-uuid','new-meal','0.5 USDC','00:00–07:00','Beijing time (UTC+8)','original meal version'])assert.ok(html.includes(value));assert.equal(JSON.stringify(review),before);assert.match(html,/data-live-action="meal-publish-confirm" disabled/);
});
test('publish and listing have separate progress and hashes; only exact public version confirms availability',()=>{
 const publish={id:'original-publish',stage:'FINAL_SUCCEEDED',transactionHash:'publish-hash'},listing={stage:'UNKNOWN',transactionHash:'listing-hash'},publicMeal={id:'new-meal',version:1,listed:true};
 let html=renderMealPublishFlow({review,publish,listing,publicMeal},setup);assert.ok(html.includes('publish-hash'));assert.ok(html.includes('listing-hash'));assert.doesNotMatch(html,/<h2 id="dialog-title">Meal published and listed/);
 listing.stage='FINAL_SUCCEEDED';html=renderMealPublishFlow({review,publish,listing,publicMeal},setup);assert.match(html,/<h2 id="dialog-title">Meal published and listed/);
 for(const wrong of [{...publicMeal,id:'original-7USDC-meal'},{...publicMeal,version:2},{...publicMeal,listed:false}])assert.doesNotMatch(renderMealPublishFlow({review,publish,listing,publicMeal:wrong},setup),/<h2 id="dialog-title">Meal published and listed/);
});
test('later publication retains unlisted state and unknown confirmation offers no new confirmation',()=>{
 const html=renderMealPublishFlow({review:{...review,targetListed:false},publish:{stage:'FINAL_SUCCEEDED'},publicMeal:{id:'new-meal',version:1,listed:false}},setup);assert.match(html,/Meal published · Unlisted/);assert.doesNotMatch(html,/Meal published and listed/);
 assert.match(renderMealPublishFlow({review,connected:true,confirmAttempted:true},setup),/data-live-action="meal-publish-confirm" disabled/);
});

import {readFileSync} from 'node:fs';
import {hasOwnedKitchen} from './dist/onboarding-view.mjs';
const app=readFileSync(new URL('./dist/app.js',import.meta.url),'utf8'),handlers=app.slice(app.indexOf('function mealPublishCurrent(')),auth=app.split('\n').find(s=>s.startsWith('function isLiveAuthRejection('));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function harness(){
 const calls=[],body={innerHTML:''},state={stage:'ACCEPTED',listing:'ACCEPTED',public:false};
 const row={id:'draft-uuid',draftId:'draft-uuid',draftRevision:3,published:false,saved:true,listed:false},live={generation:0,context:{session:{wallet:'owner',stores:['store']},store:{id:'store'},setup},ownerMeals:[row],mealCapabilities:{publish:true},mealPublish:null,mealPublishPending:{},meals:{store:[]}};
 const original=()=>({id:'publish-intent',action:'publish',draftId:row.draftId,mealId:review.mealId,version:'1',needsListing:true,stage:state.stage});
 live.api={getMealPublishIntents:async()=>state.records??[],createMealPublishReview:async args=>{calls.push(['review',args]);return {reviewId:'review-id',store:'store',review:{...review,draftRevision:3,needsListing:true}};},confirmMealPublish:async args=>{calls.push(['confirm',args]);state.records=[original(),{id:'listing-intent',action:'setListed',parentIntentId:'publish-intent',stage:state.listing}];return original();},getMealPublishIntent:async()=>original(),getStoreMeals:async()=>state.public?[{id:review.mealId,version:'1',listed:true}]:[]};
 const fn=new Function('live','body','renderMealPublishFlow','hasOwnedKitchen',`${auth}const modal=html=>{body.innerHTML=html;},close=()=>{},closeLiveMealEditor=()=>{},loadLiveKitchen=async()=>{},renderLive=()=>{},liveMessage=e=>e.message,clearLiveIdentity=()=>{live.generation++;closeMealPublish();live.context.session=null;},mealEditorCurrent=()=>true,readLiveMealEditor=()=>{},renderLiveMealDialog=()=>{};${handlers};return {handleMealPublishAction,closeMealPublish,clearLiveIdentity};`)(live,body,renderMealPublishFlow,hasOwnedKitchen);
 return {live,calls,body,state,original,fn,act:(action,extra={})=>fn.handleMealPublishAction(action,{dataset:{mealId:row.id,...extra}})};
}
test('saved revision review and explicit confirmation track original publish and its own listing before public success',async()=>{
 const h=harness();await h.act('meal-publish-review');assert.deepEqual(h.calls,[['review',{storeId:'store',draftId:'draft-uuid',expectedRevision:3}]]);await h.act('meal-publish-confirm');await h.act('meal-publish-confirm');assert.equal(h.calls.filter(c=>c[0]==='confirm').length,1);assert.doesNotMatch(h.body.innerHTML,/<h2 id="dialog-title">Meal published and listed/);
 h.state.stage='FINAL_SUCCEEDED';h.state.public=true;h.state.records=[h.original(),{action:'setListed',parentIntentId:'wrong-publish',stage:'FINAL_SUCCEEDED'}];await h.act('meal-publish-check');assert.doesNotMatch(h.body.innerHTML,/<h2 id="dialog-title">Meal published and listed/);
 h.state.records=[h.original(),{action:'setListed',parentIntentId:'publish-intent',stage:'FINAL_SUCCEEDED'}];await h.act('meal-publish-check');assert.match(h.body.innerHTML,/<h2 id="dialog-title">Meal published and listed/);
});
test('lost confirmation keeps draft locked and restores original publication instead of recreating',async()=>{
 const h=harness();await h.act('meal-publish-review');let attempts=0;h.live.api.confirmMealPublish=async()=>{attempts++;throw Error('lost');};await h.act('meal-publish-confirm');await h.act('meal-publish-confirm');await h.act('meal-publish-close');h.state.records=[h.original()];await h.act('meal-publish-review');assert.equal(attempts,1);assert.equal(h.calls.filter(c=>c[0]==='review').length,1);await h.act('meal-publish-restore',{intentId:'publish-intent'});assert.equal(h.live.mealPublish.publish.id,'publish-intent');
});
test('late publication reviews are discarded on close or wallet switch, unsaved form cannot publish',async()=>{
 for(const mode of ['close','wallet']){const h=harness(),wait=deferred();h.live.api.createMealPublishReview=()=>wait.promise;const pending=h.act('meal-publish-review');await Promise.resolve();await Promise.resolve();mode==='close'?h.fn.closeMealPublish():h.fn.clearLiveIdentity();wait.resolve({reviewId:'late',review:{...review,draftRevision:3}});await pending;assert.equal(h.live.mealPublish,null);assert.equal(h.body.innerHTML,'');}
 const h=harness();h.live.mealEditor={canPublish:true,mealId:'draft-uuid',revision:3,values:{name:'changed'},initial:JSON.stringify({name:'saved'})};await h.act('meal-publish');assert.equal(h.calls.length,0);assert.match(h.live.mealEditor.error,/Save all draft changes/);
});
test('needsListing false retains existing listed status without waiting for a new listing child',()=>{
 const html=renderMealPublishFlow({review:{...review,needsListing:false,targetListed:true},publish:{stage:'FINAL_SUCCEEDED'},publicMeal:{id:'new-meal',version:1,listed:true}},setup);assert.match(html,/<h2 id="dialog-title">Meal published and listed/);assert.doesNotMatch(html,/Waiting for publication/);
});
test('first review renders verified DTO details and enables confirmation without any intent variable',async()=>{
 for(const targetListed of [undefined,false,true]){
  const h=harness();h.live.api.createMealPublishReview=async()=>{const r={...review,draftRevision:3,needsListing:targetListed!==false};if(targetListed===undefined)delete r.targetListed;else r.targetListed=targetListed;return {reviewId:'first-review',store:'store',review:r};};
  await h.act('meal-publish-review');assert.equal(h.live.mealPublish.error,'');assert.equal(h.live.mealPublish.reviewId,'first-review');assert.ok(h.live.mealPublish.review);assert.equal(h.live.mealPublish.review.needsListing,targetListed!==false);assert.equal(h.live.mealPublish.review.targetListed,targetListed??true);assert.match(h.body.innerHTML,/test_for_mealforward/);assert.match(h.body.innerHTML,/0\.5 USDC/);assert.match(h.body.innerHTML,/00:00–07:00/);assert.match(h.body.innerHTML,/data-live-action="meal-publish-confirm"\s*>Confirm meal publication/);assert.equal(h.live.mealPublish.publish,null);
 }
});
