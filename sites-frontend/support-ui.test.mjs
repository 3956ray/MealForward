// Actual UI handlers with a deterministic adapter: no network, wallet or browser.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createLiveApi} from './dist/live-api.mjs';
import {renderSupportFlow,renderContributions,renderLiveKitchen,renderLiveStore,supportState} from './dist/onboarding-view.mjs';
// Existing pre-G1 fixture only: production adapter always validates full CP30 DTOs.
const legacyFixtureApi=options=>createLiveApi({...options,testOnlyAllowIncompleteReadFixtures:true});
const source=readFileSync(new URL('./dist/app.js',import.meta.url),'utf8'),support=source.slice(source.indexOf('function supportCurrent('));
const authGuard=source.split('\n').find(line=>line.startsWith('function isLiveAuthRejection('));
const wallet='0x'+'1'.repeat(40),intentId='original-intent';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function harness(){
 const meal={id:'published-meal',name:'Rice',description:'Public recipe',unitPrice:'7000000',listed:true,windows:[[660,780]]};
 const live={context:{session:{wallet},setup:{assetDecimals:6,assetSymbol:'USDC'}},generation:0,support:null,supportAttempts:{},supportOrders:[],supportOrdersLoading:false,stores:[{id:'store',name:'Kitchen'}],meals:{store:[meal]},error:''};
 const calls=[],dialog={open:false},body={innerHTML:''},state={stage:'PENDING',approve:false,quotePending:false};
 live.api={createSupportReview:async input=>{calls.push(['review',input]);return {reviewId:'original-review',review:{name:'Rice',unitPrice:'7000000',quantity:input.quantity,amount:String(input.quantity*7000000),payer:wallet}};},confirmSupport:async id=>{calls.push(['confirm',id]);return {id:intentId,stage:'PENDING'};},getSupportIntent:async id=>{calls.push(['intent',id]);return {id,stage:state.stage};},getSupportOrders:async()=>[{intentId,stage:state.stage}],getSupportWalletPreparation:async()=>{if(state.quotePending)throw Object.assign(Error('Quote pending'),{code:'ORIGINAL_QUOTE_PENDING'});return {actions:[{kind:'approve',account:wallet,amount:'14000000',allowed:!state.approve},{kind:'fund',account:wallet,amount:'14000000',allowed:state.approve}]};},sendSupportTransaction:async(id,kind)=>{calls.push(['send',id,kind]);if(kind==='approve')state.approve=true;return {transactionHash:'0x'+'2'.repeat(64),status:'PENDING'};},retrySupportTransactionRecord:async(id,kind)=>{calls.push(['record',id,kind]);return {};}};
 const fn=new Function('live','body','dialog','calls','renderSupportFlow','supportState',`const modal=html=>{dialog.open=true;body.innerHTML=html;};const close=()=>{dialog.open=false;};const renderLive=()=>{};const showLiveError=()=>{};const liveMessage=error=>error.message;${authGuard}const currentLiveResult=async(p,g)=>{const v=await p;if(g!==live.generation)throw Error('stale');return v;};const loadLiveCatalog=async()=>{calls.push(['catalog']);};const clearLiveIdentity=message=>{live.generation++;closeSupportFlow();live.context.session=null;live.error=message;live.supportOrders=[];live.supportAttempts={};};const startMetaMaskLogin=async()=>{calls.push(['login-choice']);};${support};return {handleSupportAction,closeSupportFlow,loadSupportOrders,clearLiveIdentity};`)(live,body,dialog,calls,renderSupportFlow,supportState);
 return {live,calls,body,dialog,state,fn,act:(action,data={})=>fn.handleSupportAction(action,{dataset:{storeId:'store',mealId:'published-meal',...data}})};
}
test('support requires review, original intent, then separate explicit approve and fund clicks; only final success refreshes catalog',async()=>{
 const h=harness();await h.act('support-start');assert.equal(h.calls.length,0);h.live.support.quantity=2;await h.act('support-review');assert.equal(h.calls[0][0],'review');assert.equal(h.calls.filter(c=>c[0]==='send').length,0);await h.act('support-confirm');assert.equal(h.calls.filter(c=>c[0]==='confirm').length,1);await h.act('support-send',{kind:'fund'});assert.equal(h.calls.filter(c=>c[0]==='send').length,0);
 await h.act('support-send',{kind:'approve'});await h.act('support-send',{kind:'approve'});assert.equal(h.calls.filter(c=>c[0]==='send').length,1);await h.act('support-send',{kind:'fund'});assert.equal(h.calls.filter(c=>c[0]==='send').length,2);assert.equal(h.calls.filter(c=>c[0]==='catalog').length,0);assert.ok(!h.body.innerHTML.includes('Support confirmed'));
 h.state.stage='FINAL_SUCCEEDED';await h.act('support-check');assert.equal(h.calls.filter(c=>c[0]==='catalog').length,1);assert.ok(h.body.innerHTML.includes('Support confirmed'));
});
test('quantity bounds and private meal never create support review',async()=>{
 const h=harness();await h.act('support-start',{mealId:'private-draft'});assert.equal(h.live.support,null);assert.equal(h.calls.length,0);await h.act('support-start');h.live.support.quantity=11;await h.act('support-review');assert.equal(h.calls.length,0);assert.match(h.live.support.error,/1 and 10/);
});
test('lost confirmation is not repeated and quote pending only permits checking original progress',async()=>{
 const h=harness();await h.act('support-start');await h.act('support-review');let confirmations=0;h.live.api.confirmSupport=async()=>{confirmations++;throw Error('Response lost');};await h.act('support-confirm');await h.act('support-confirm');assert.equal(confirmations,1);assert.ok(h.live.support.confirmAttempted);
 const p=harness();p.state.quotePending=true;await p.act('support-open',{intentId});assert.match(p.live.support.status,/quote is being prepared/);assert.equal(p.live.support.preparation,null);assert.equal(p.calls.filter(c=>c[0]==='send').length,0);
});
test('PAYER_REQUIRED leaves the same review retryable and does not claim a contribution was submitted',async()=>{
 const h=harness();await h.act('support-start');await h.act('support-review');const review=h.live.support.review,confirm=h.live.api.confirmSupport;let rejected=0;
 h.live.api.confirmSupport=async id=>{assert.equal(id,review.reviewId);rejected++;throw Object.assign(Error('PAYER_REQUIRED'),{code:'PAYER_REQUIRED',status:400});};
 await h.act('support-confirm');assert.equal(rejected,1);assert.equal(h.live.support.confirmAttempted,false);assert.equal(h.live.support.intent,null);assert.equal(h.live.support.review,review);
 assert.match(h.body.innerHTML,/No contribution was created/);assert.match(h.body.innerHTML,/same review/);assert.match(h.body.innerHTML,/review has expired/);assert.doesNotMatch(h.body.innerHTML,/original confirmation was submitted/);assert.match(h.body.innerHTML,/data-live-action="support-confirm" data-kind="" >Confirm contribution/);assert.equal(h.calls.filter(c=>c[0]==='send').length,0);
 h.live.api.confirmSupport=confirm;await h.act('support-confirm');assert.equal(h.calls.filter(c=>c[0]==='review').length,1);assert.deepEqual(h.calls.find(c=>c[0]==='confirm'),['confirm',review.reviewId]);assert.equal(h.live.support.intent.id,intentId);
});
test('confirmation conflicts and unknown failures keep the original request locked',async()=>{
 for(const error of [Object.assign(Error('Original request conflict'),{code:'CONFLICT',status:409}),Object.assign(Error('Stale review'),{code:'STALE_REVIEW',status:409}),Object.assign(Error('Service unavailable'),{status:503}),Error('Response lost')]){
  const h=harness();await h.act('support-start');await h.act('support-review');let attempts=0;h.live.api.confirmSupport=async()=>{attempts++;throw error;};
  await h.act('support-confirm');await h.act('support-confirm');await h.act('support-review');assert.equal(attempts,1);assert.equal(h.live.support.confirmAttempted,true);assert.equal(h.calls.filter(c=>c[0]==='review').length,1);assert.match(h.body.innerHTML,/do not create a replacement/);assert.doesNotMatch(h.body.innerHTML,/No contribution was created/);
 }
});
test('stale confirmation retries the same review and actual adapter key, recovering an existing intent',async()=>{
 const h=harness();await h.act('support-start');await h.act('support-review');const review=h.live.support.review;review.reviewId='11111111-1111-4111-8111-111111111111';
 const data=new Map([['mealforward-live-csrf-v1','csrf']]),storage={getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)},requests=[];
 const provider={request:async({method})=>method==='eth_accounts'?[wallet]:'0x279f'};
 const response=(value,status=200)=>({ok:status<400,status,json:async()=>value});
 const api=legacyFixtureApi({storage,provider:()=>provider,origin:()=> 'https://localhost:16443',fetchImpl:async(path,options)=>{
  if(path==='/v1/support/intents'){requests.push(options);return requests.length===1?response({error:'FINALIZED_FACTS_STALE'},503):response({id:intentId,stage:'PENDING'});}
  if(path==='/v1/me')return response({walletAddress:wallet});
  if(path==='/v1/connection')return response({});
  if(path==='/v1/identity/setup')return response({walletLoginEnabled:true,walletLoginChainId:10143,walletLoginOrigin:'https://localhost:16443'});
  if(path==='/v1/store-registrations'||path==='/v1/stores')return response({items:[]});
  throw Error('Unexpected path: '+path);
 }});
 await api.getContext();h.live.api.confirmSupport=api.confirmSupport;
 await h.act('support-confirm');assert.equal(requests.length,1);assert.equal(h.live.support.confirmAttempted,false);assert.equal(h.live.support.review,review);assert.equal(h.live.support.intent,null);
 assert.match(h.body.innerHTML,/确认结果尚未核实/);assert.match(h.body.innerHTML,/稍后重试原确认，勿另建支持/);assert.doesNotMatch(h.body.innerHTML,/confirmation was submitted|No contribution was created/);
 await h.act('support-review');assert.equal(h.calls.filter(c=>c[0]==='review').length,1);
 await h.act('support-confirm');assert.equal(requests.length,2);assert.equal(requests[0].body,requests[1].body);assert.equal(JSON.parse(requests[1].body).reviewId,review.reviewId);assert.ok(requests[0].headers['Idempotency-Key']);assert.equal(requests[0].headers['Idempotency-Key'],requests[1].headers['Idempotency-Key']);
 assert.equal(h.live.support.intent.id,intentId);assert.ok(h.calls.some(c=>c[0]==='intent'&&c[1]===intentId));assert.equal(h.calls.filter(c=>c[0]==='send').length,0);
 await api.confirmSupport(review.reviewId);assert.equal(requests[1].headers['Idempotency-Key'],requests[2].headers['Idempotency-Key']);
});
test('stale status lookup after successful confirmation preserves the original intent and never reconfirms',async()=>{
 const h=harness();await h.act('support-start');await h.act('support-review');const getIntent=h.live.api.getSupportIntent;
 h.live.api.getSupportIntent=async()=>{throw Object.assign(Error('FINALIZED_FACTS_STALE'),{code:'FINALIZED_FACTS_STALE',status:503});};
 await h.act('support-confirm');assert.equal(h.live.support.intent.id,intentId);assert.equal(h.live.support.confirmAttempted,true);await h.act('support-confirm');assert.equal(h.calls.filter(c=>c[0]==='confirm').length,1);
 h.live.api.getSupportIntent=getIntent;await h.act('support-check');assert.equal(h.live.support.intent.id,intentId);assert.equal(h.calls.filter(c=>c[0]==='send').length,0);
});
test('uncertain wallet attempt is never resent, even after closing and restoring its intent',async()=>{
 const h=harness();await h.act('support-open',{intentId});let sends=0;h.live.api.sendSupportTransaction=async()=>{sends++;throw Error('Wallet response unknown');};await h.act('support-send',{kind:'approve'});await h.act('support-close');await h.act('support-open',{intentId});await h.act('support-send',{kind:'approve'});assert.equal(sends,1);assert.equal(h.live.support.attempted.approve,true);
 h.state.stage='UNKNOWN';await h.act('support-check');await h.act('support-send',{kind:'fund'});assert.equal(sends,1);
});
test('explicit preflight failure removes only the new step lock and requires checking original progress',async()=>{
 const h=harness();h.state.approve=true;h.live.supportAttempts[intentId]={approve:true};await h.act('support-open',{intentId});let attempts=0;
 h.live.api.sendSupportTransaction=async()=>{attempts++;throw Object.assign(Error('CODEC_UNAVAILABLE'),{code:'CODEC_UNAVAILABLE',walletStepNotStarted:true});};
 await h.act('support-send',{kind:'fund'});assert.equal(attempts,1);assert.equal(h.live.supportAttempts[intentId].fund,undefined);assert.equal(h.live.support.attempted.fund,undefined);assert.equal(h.live.support.attempted.approve,true);
 assert.match(h.body.innerHTML,/Wallet request was not started\. Resolve the preparation error and check original progress\./);assert.doesNotMatch(h.body.innerHTML,/original wallet step is pending or uncertain/);assert.equal(h.live.support.preparation,null);
 await h.act('support-send',{kind:'fund'});assert.equal(attempts,1);await h.act('support-check');await h.act('support-send',{kind:'fund'});assert.equal(attempts,2);
});
test('codec errors without the exact preflight flag and existing attempts remain locked',async()=>{
 for(const flag of [undefined,false,'true']){
  const h=harness();await h.act('support-open',{intentId});let attempts=0;h.live.api.sendSupportTransaction=async()=>{attempts++;throw Object.assign(Error('CODEC_UNAVAILABLE'),{code:'CODEC_UNAVAILABLE',walletStepNotStarted:flag});};
  await h.act('support-send',{kind:'approve'});await h.act('support-check');await h.act('support-send',{kind:'approve'});assert.equal(attempts,1);assert.equal(h.live.supportAttempts[intentId].approve,true);
 }
 const h=harness();await h.act('support-open',{intentId});h.live.supportAttempts[intentId]={approve:true};let attempts=0;h.live.api.sendSupportTransaction=async()=>{attempts++;throw Object.assign(Error('preflight'),{walletStepNotStarted:true});};
 await h.act('support-send',{kind:'approve'});assert.equal(attempts,0);assert.equal(h.live.supportAttempts[intentId].approve,true);
});
test('post-send refresh failure cannot clear a completed wallet request even with a preflight flag',async()=>{
 const h=harness();await h.act('support-open',{intentId});h.live.api.getSupportIntent=async()=>{throw Object.assign(Error('refresh failed'),{walletStepNotStarted:true});};
 await h.act('support-send',{kind:'approve'});assert.equal(h.calls.filter(c=>c[0]==='send').length,1);assert.equal(h.live.supportAttempts[intentId].approve,true);assert.match(h.live.support.status,/pending or uncertain/);assert.ok(h.live.support.knownHashes.approve);
});
test('canRetryRecord performs reporting only, never rebroadcasting',async()=>{
 const h=harness();h.live.api.getSupportWalletPreparation=async()=>({actions:[{kind:'approve',account:wallet,amount:'7000000',allowed:false,canRetryRecord:true}]});await h.act('support-open',{intentId});assert.ok(h.body.innerHTML.includes('Retry recording approve transaction'));await h.act('support-record',{kind:'approve'});assert.equal(h.calls.filter(c=>c[0]==='record').length,1);assert.equal(h.calls.filter(c=>c[0]==='send').length,0);
});
test('expired quote clears preparation and offers no approval or payment actions',async()=>{
 const h=harness();await h.act('support-open',{intentId});assert.ok(h.live.support.preparation);
 h.live.api.getSupportWalletPreparation=async()=>{throw Object.assign(Error('QUOTE_EXPIRED'),{code:'QUOTE_EXPIRED',status:409});};
 await h.act('support-check');assert.equal(h.live.support.preparation,null);assert.match(h.body.innerHTML,/This quote has expired; do not approve or pay it\./);assert.doesNotMatch(h.body.innerHTML,/data-live-action="support-send"/);assert.match(h.body.innerHTML,/My contributions/);
 await h.act('support-send',{kind:'approve'});await h.act('support-send',{kind:'fund'});assert.equal(h.calls.filter(c=>['send','review','confirm'].includes(c[0])).length,0);assert.equal(h.live.support.intent.id,intentId);
});
test('wallet change and closed dialog discard late support review without signing',async()=>{
 for(const change of ['wallet','close']){const h=harness(),wait=deferred();await h.act('support-start');h.live.api.createSupportReview=()=>wait.promise;const pending=h.act('support-review');change==='wallet'?h.fn.clearLiveIdentity('changed'):h.fn.closeSupportFlow();wait.resolve({reviewId:'old',review:{payer:wallet}});await pending;assert.equal(h.live.support,null);assert.equal(h.dialog.open,false);assert.equal(h.calls.filter(c=>c[0]==='send').length,0);}
});
test('restored contributions keep original identifiers, public support entry is absent from owner draft rows',()=>{
 const html=renderContributions({session:{wallet},orders:[{intentId,stage:'UNKNOWN'}]});assert.ok(html.includes(`data-intent-id="${intentId}"`));assert.ok(!html.includes('Support confirmed'));
 const meal={id:'public',name:'Rice',listed:true,unitPrice:'7000000'};assert.ok(renderLiveStore({id:'store',name:'Kitchen'},[meal]).includes('data-live-action="support-start"'));
 assert.ok(!renderLiveKitchen({context:{session:{wallet,stores:['store']},store:{id:'store'}},view:'meals',meals:[{id:'private',published:false,draft:{name:'Private'}}]}).includes('support-start'));
});
test('UNKNOWN intent uses per-step server authorization: confirmed approval allows one fund, pending approval does not',async()=>{
 const h=harness();h.state.stage='UNKNOWN';await h.act('support-open',{intentId});await h.act('support-send',{kind:'fund'});assert.equal(h.calls.filter(c=>c[0]==='send').length,0);
 h.state.approve=true;h.live.supportAttempts[intentId]={approve:true};await h.act('support-check');assert.match(h.body.innerHTML,/data-live-action="support-send" data-kind="fund" >Send meal payment/);
 await h.act('support-send',{kind:'fund'});assert.equal(h.calls.filter(c=>c[0]==='send'&&c[2]==='fund').length,1);
 await h.act('support-check');await h.act('support-send',{kind:'fund'});assert.equal(h.calls.filter(c=>c[0]==='send'&&c[2]==='fund').length,1);assert.match(h.body.innerHTML,/data-live-action="support-send" data-kind="fund" disabled/);
});

test('payer binding rejection clears support identity while stale review/facts retain it',async()=>{
 for(const code of ['PAYER_BINDING_CHANGED','STALE_REVIEW','FINALIZED_FACTS_STALE']){
  const h=harness();await h.act('support-start');h.live.api.createSupportReview=async()=>{throw Object.assign(Error(code),{status:409,code});};await h.act('support-review');
  if(code==='PAYER_BINDING_CHANGED'){assert.equal(h.live.context.session,null);assert.equal(h.live.support,null);}else{assert.equal(h.live.context.session.wallet,wallet);assert.equal(h.live.support.error,code);}
 }
});

test('expired restored contribution explicitly opens a fresh review flow for its exact current public meal',async()=>{
 const h=harness(),meal=h.live.meals.store[0],store='a'.repeat(64);meal.id='b'.repeat(64);h.live.stores=[{id:store}];h.live.meals={[store]:[meal]};h.live.supportOrders=[{id:intentId}];h.live.supportAttempts[intentId]={approve:true};
 h.live.api.getSupportIntent=async()=>({id:intentId,store,mealId:'0x'+meal.id,quantity:'3',stage:'WAIT_ACTOR'});
 h.live.api.getSupportWalletPreparation=async()=>{throw Object.assign(Error('expired'),{code:'QUOTE_EXPIRED'});};
 await h.act('support-open',{intentId});assert.match(h.body.innerHTML,/Quote expired/);assert.match(h.body.innerHTML,/Review support again/);assert.doesNotMatch(h.body.innerHTML,/WAIT_ACTOR|Payment is not confirmed yet|Check original progress/);
 assert.equal(h.calls.filter(c=>['review','confirm','send'].includes(c[0])).length,0);
 await h.act('support-review-again');assert.equal(h.live.support.meal,meal);assert.equal(h.live.support.quantity,3);assert.equal(h.live.support.intent,null);assert.equal(h.live.support.review,null);assert.equal(h.live.supportOrders[0].id,intentId);assert.equal(h.live.supportAttempts[intentId].approve,true);assert.equal(h.calls.filter(c=>['review','confirm','send'].includes(c[0])).length,0);
 await h.act('support-review');assert.equal(h.calls.filter(c=>c[0]==='review').length,1);assert.equal(h.calls.filter(c=>['confirm','send'].includes(c[0])).length,0);
});
test('expired recovery never guesses an unavailable or missing original meal',async()=>{
 for(const mealId of [undefined,'missing','published-meal']){
  const h=harness();if(mealId==='published-meal')h.live.meals.store[0].listed=false;
  h.live.api.getSupportIntent=async()=>({id:intentId,store:'store',mealId,quantity:99,stage:'WAIT_ACTOR'});h.live.api.getSupportWalletPreparation=async()=>{throw Object.assign(Error('expired'),{code:'QUOTE_EXPIRED'});};
  await h.act('support-open',{intentId});assert.doesNotMatch(h.body.innerHTML,/data-live-action="support-review-again"/);await h.act('support-review-again');assert.equal(h.live.support.intent.id,intentId);assert.equal(h.calls.filter(c=>['review','confirm','send'].includes(c[0])).length,0);
 }
});
test('quote countdown uses server time plus elapsed time and expiry blocks a previously available send',async()=>{
 const h=harness();h.live.api.getSupportWalletPreparation=async()=>({now:1000,material:{signedQuote:{quote:{deadline:'1120'}}},actions:[{kind:'approve',account:wallet,allowed:true}]});
 await h.act('support-open',{intentId});assert.match(h.body.innerHTML,/Quote deadline/);assert.match(h.body.innerHTML,/Time remaining/);assert.match(h.body.innerHTML,/2m 0s/);assert.equal(h.live.support.quoteExpired,false);
 h.live.support.quoteClock.receivedAt=Date.now()-121000;await h.act('support-send',{kind:'approve'});assert.equal(h.calls.filter(c=>c[0]==='send').length,0);assert.equal(h.live.support.quoteExpired,true);assert.doesNotMatch(h.body.innerHTML,/data-live-action="support-send"|Check original progress/);assert.match(h.body.innerHTML,/Quote expired/);
});

test('CP31 simplified checkout shows one business payment action and transparent total',()=>{
 const wallet='0x'+'1'.repeat(40);
 const review={reviewId:'review-1',review:{name:'Rice',quantity:3,unitPrice:'500000',amount:'1500000',payer:wallet}};
 const html=renderSupportFlow({review,meal:{name:'Rice',unitPrice:'500000'},store:{name:'Kitchen'},quantity:3,confirmAttempted:false},{assetDecimals:6,assetSymbol:'USDC'});
 assert.match(html,/1\.5 USDC/);
 assert.match(html,/0\.5 USDC/);
 assert.match(html,/Confirm &amp; pay/);
 assert.match(html,/wallet may ask for two confirmations/i);
 assert.ok(html.indexOf('Confirm &amp; pay')<html.indexOf('Technical details'));
 assert.match(html,/<details class="ux-technical">/);
});

test('CP31 one payment confirmation orchestrates approve and fund only after verified allowance',async()=>{
 const h=harness();await h.act('support-start');h.live.support.quantity=2;await h.act('support-review');
 assert.match(h.body.innerHTML,/Confirm &amp; pay/);
 await h.act('support-pay');
 assert.deepEqual(h.calls.filter(c=>c[0]==='send').map(c=>c[2]),['approve','fund']);
 assert.equal(h.live.supportAttempts[intentId].approve,true);
 assert.equal(h.live.supportAttempts[intentId].fund,true);
 assert.equal(h.calls.filter(c=>c[0]==='catalog').length,0,'wallet hash is not finality');
 h.state.stage='FINAL_SUCCEEDED';await h.act('support-check');
 assert.match(h.body.innerHTML,/Support confirmed/);
});

test('CP31 checkout never sends a duplicate after uncertain approval',async()=>{
 const h=harness();await h.act('support-start');await h.act('support-review');
 h.live.api.sendSupportTransaction=async()=>{throw Object.assign(Error('Wallet result unknown'),{code:'ORIGINAL_PAYMENT_UNKNOWN'});};
 await h.act('support-pay');
 assert.equal(h.live.supportAttempts[intentId].approve,true);
 assert.equal(h.live.supportAttempts[intentId].fund,undefined);
 assert.match(h.live.support.error,/Wallet result unknown/);
 assert.match(h.body.innerHTML,/My contributions/);
});

test('CP31 order card shows order amount first, technical reference inside details',()=>{
 const id='b'.repeat(36),hash='0x'+'3'.repeat(64);
 const html=renderContributions({session:{wallet:'0x'+'1'.repeat(40)},orders:[{intentId:id,name:'Rice',quantity:3,amount:'1500000',stage:'FINAL_SUCCEEDED',transactionHash:hash}],setup:{assetDecimals:6,assetSymbol:'USDC'}});
 assert.match(html,/3 meals/);assert.match(html,/1\.5 USDC/);
 assert.match(html,/href="https:\/\/testnet\.monadscan\.com\/tx\/0x3{64}"/);
 assert.match(html,/<details class="ux-technical">/);
 assert.ok(html.indexOf('1.5 USDC')<html.indexOf(id));
});