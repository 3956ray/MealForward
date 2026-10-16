import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveApi} from './dist/live-api.mjs';
// Existing pre-G1 fixture only: production adapter always validates full CP30 DTOs.
const legacyFixtureApi=options=>createLiveApi({...options,testOnlyAllowIncompleteReadFixtures:true});
const store='1'.repeat(64),account='0x'+'2'.repeat(40),meal='0x'+'3'.repeat(64),old='4'.repeat(64);
const draft='11111111-1111-4111-8111-111111111111',reviewId='22222222-2222-4222-8222-222222222222',intentId='33333333-3333-4333-8333-333333333333',childId='44444444-4444-4444-8444-444444444444';
async function fixture({owner=true,reviewChange={},late=false,lose=false,published=false,wrongIntent=false,storageValues=new Map([['mealforward-live-csrf-v1','csrf']])}={}){
 const calls=[],events={};let lost=false;
 const storage={getItem:k=>storageValues.get(k)||null,setItem:(k,v)=>storageValues.set(k,v),removeItem:k=>storageValues.delete(k)};
 const provider={on:(k,f)=>events[k]=f,removeListener(){},async request({method}){if(method==='eth_accounts')return [account];if(method==='eth_chainId')return '0x279f';throw Error('No wallet signing is part of catalog UI');}};
 const review={draftId:draft,draftRevision:2,mealId:meal,version:'1',name:'New meal',description:'Half dollar',unitPrice:'500000',price:'500000',windows:[[0,420]],collectionTimeZone:'Asia/Shanghai',imageDigest:'0x'+'5'.repeat(64),bodyDigest:'0x'+'6'.repeat(64),termsHash:'0x'+'7'.repeat(64),expectedControlRevision:'2',expiresAt:2000000000,needsListing:true,targetListed:true,...reviewChange};
 const original={id:intentId,intentId,store,draftId:draft,mealId:meal,version:'1',needsListing:true,targetListed:true,action:'publish',stage:'UNKNOWN',transactionHash:null};
 const child={...original,id:childId,intentId:childId,action:'setListed',parentIntentId:intentId};
 const prior={id:old,name:'Old meal',unitPrice:'7000000',version:'1',listed:true};
 const newMeal={id:meal.slice(2),mealId:meal,name:'New meal',unitPrice:'500000',version:'1',listed:true};
 const ok=value=>({ok:true,status:200,json:async()=>value});
 const fetchImpl=async(path,options)=>{calls.push({path,...options});
  if(path==='/v1/connection')return ok({assetDecimals:6});if(path==='/v1/identity/setup')return ok({});
  if(path==='/v1/me')return ok({walletAddress:account});
  if(path==='/v1/store-registrations')return ok({items:owner?[{registrationId:'0x'+store,storeId:'0x'+store,state:'CONFIRMED',businessReady:true}]:[]});
  if(path==='/v1/stores')return ok({items:[{id:store}]});if(path.endsWith('/meals'))return ok({items:published?[prior,newMeal]:[prior]});
  if(path.endsWith('/workbench'))return ok({items:published?[prior,newMeal]:[prior],catalogIntents:[original,child]});
  if(path.endsWith('/drafts'))return ok({items:[{id:draft,mealId:meal,draftRevision:2,saved:true,draft:{...review,price:'500000'}}],capabilities:{publish:true,listing:false}});
  if(path.endsWith('/review')){if(late)events.accountsChanged();return ok({reviewId,store,review});}
  if(path.endsWith('/publish')){if(lose&&!lost){lost=true;throw Error('lost');}return ok({...original,store:wrongIntent?'9'.repeat(64):store});}
  if(path==='/v1/intents/'+intentId)return ok(original);
  if(path==='/v1/intents/'+childId)return ok(child);
  throw Error('Unexpected route '+path);
 };
 const args={fetchImpl,storage,provider:()=>provider,origin:()=> 'https://localhost:16443'};
 const api=legacyFixtureApi(args);await api.getContext();return {api,calls,args,storageValues};
}
test('publication review freezes the saved half-dollar meal and Beijing half-hour window without wallet mutation',async()=>{
 const f=await fixture(),r=await f.api.createMealPublishReview({storeId:store,draftId:draft,expectedRevision:2});
 assert.equal(r.review.unitPrice,'500000');assert.deepEqual(r.review.windows,[[0,420]]);
 assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
 assert.deepEqual(JSON.parse(f.calls.at(-1).body),{expectedRevision:2});
 assert.ok(!f.calls.some(c=>c.path.endsWith('/publish')));
});
test('publication loss and reload retain the exact original confirmation; polling performs no mutation',async()=>{
 const f=await fixture({lose:true}),input={storeId:store,draftId:draft,reviewId};
 await assert.rejects(f.api.confirmMealPublish(input),{code:'CONNECTION_UNAVAILABLE'});
 const reloaded=legacyFixtureApi(f.args);await reloaded.getContext();
 assert.equal((await reloaded.confirmMealPublish(input)).stage,'UNKNOWN');
 const posts=f.calls.filter(c=>c.path.endsWith('/publish'));assert.equal(posts.length,2);assert.equal(posts[0].headers['Idempotency-Key'],posts[1].headers['Idempotency-Key']);
 const start=f.calls.length;assert.equal((await reloaded.getMealPublishIntent(store,intentId)).id,intentId);
 assert.equal((await reloaded.getMealPublishIntents(store,draft)).length,2);
 assert.ok(f.calls.slice(start).every(c=>c.method==='GET'));
});
test('owner menu merges canonical meal with its UUID draft without replacing the original seven-dollar meal',async()=>{
 const f=await fixture({published:true}),menu=await f.api.getOwnerMeals(store);
 assert.equal(menu.items.length,2);assert.equal(menu.items[0].unitPrice,'7000000');
 assert.equal(menu.items[1].id,meal.slice(2));assert.equal(menu.items[1].draftId,draft);assert.equal(menu.items[1].draft.price,'0.5');
 assert.equal(menu.capabilities.publish,true);assert.equal(menu.catalogIntents.length,2);
 const pending=await fixture(),pendingMenu=await pending.api.getOwnerMeals(store);
 assert.equal(pendingMenu.items[1].published,false);assert.equal(pendingMenu.items[1].listed,false);
});
test('foreign owner and late wallet responses cannot authorize publishing',async()=>{
 const f=await fixture({owner:false});await assert.rejects(f.api.createMealPublishReview({storeId:store,draftId:draft,expectedRevision:2}),{code:'OWNER_ACCESS_REQUIRED'});assert.ok(!f.calls.some(c=>c.method==='POST'));
 const late=await fixture({late:true});await assert.rejects(late.api.createMealPublishReview({storeId:store,draftId:draft,expectedRevision:2}),{code:'SESSION_CHANGED'});
 const wrong=await fixture({wrongIntent:true});await assert.rejects(wrong.api.confirmMealPublish({storeId:store,draftId:draft,reviewId}),{code:'PUBLICATION_MISMATCH'});
});
test('wrong draft revision, minute precision, price, time zone, or incomplete publication review is rejected',async()=>{
 for(const reviewChange of [{needsListing:undefined},{targetListed:undefined},{draftRevision:3},{draftId:reviewId},{mealId:null},{price:'7000000'},{windows:[[1,420]]},{windows:[[420,0]]},{windows:[[0,420],[390,600]]},{collectionTimeZone:'UTC'},{termsHash:null}]){
  const f=await fixture({reviewChange});await assert.rejects(f.api.createMealPublishReview({storeId:store,draftId:draft,expectedRevision:2}),{code:'PUBLICATION_MISMATCH'});
 }
});
