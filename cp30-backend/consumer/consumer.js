import {renderCode,clearQR} from './assets/qr.js';
import {createCollectionLink,consumeCollectionLink} from './collection-link.mjs';
import {priceDisplay} from './assets/wallet.js';
let collectionEntry=consumeCollectionLink({location:window.location,history:window.history});
const collectionArrival=performance.now();
'use strict';
const $ = id => document.getElementById(id);
const state = {mode:null,asset:null,csrf:null, store:null, meal:null, draftRevision:0, controlRevision:0, review:null, access:new Map(), display:null, code:null, codeGeneration:0, stores:new Map(), draftStore:null, requests:new Map()};
const key = () => crypto.randomUUID();
const pendingRequests = new Map();
const path = value => encodeURIComponent(value);
const storePath = () => {if(!state.store) throw new Error('Choose a store first.');return `/v1/stores/${path(state.store)}`;};
const rows = value => Array.isArray(value) ? value : value?.items || value?.stores || value?.meals || value?.orders || value?.vouchers || value?.payouts || [];
const reference = value => value.id || value.storeId || value.mealId || value.meal || value.orderId || value.voucherId || value.payoutId || value.caseId || value.intentId;
const notify = message => {$('notice').textContent=message;};
const statusText = status => ({WAIT_ACTOR:state.mode==='C1_SYNTHETIC_LOOPBACK'?'Awaiting separate execution confirmation.':'Review this original request with your personal wallet.',OBSERVE_ONLY:'Waiting for the original payment result.',UNKNOWN:'The result is still being checked. Your original request is retained.',AWAITING_OUTCOME:'The original result is still being checked.',DISPATCH_STARTED:'Confirmation is being checked.',PENDING:'Your request is awaiting confirmation.',ACCEPTED:'Your request has been received.',FINAL_SUCCEEDED:state.mode==='C1_SYNTHETIC_LOOPBACK'?'Original local synthetic result confirmed.':'Original finalized chain result confirmed.',FINAL_REVERT:'This request could not be completed.',DEFINITELY_UNEXECUTED:'This request was not completed.',CONFIRMED:'Confirmed.',FINAL:'Confirmed.',FAILED:'This request could not be completed.',CANCELLED:'This request was cancelled.',CANCELLATION_PENDING:'Cancellation is being checked.',LOCKED:'Collection reserved at the store.',USED:'Meal collected.',EXPIRED:'The collection period has ended.',UNAVAILABLE:'This meal is currently unavailable.',A:'Available',R:'Reserved for collection',H:'Collected; payment pending',S:'Collected and paid',X:'Refunded',OLD_GENERATION:'Past collection'}[status] || 'Details updated.');
const errors={401:'Please sign in again.',403:'This action is unavailable for your account. Please verify your sign-in and try again.',404:'This item is unavailable.',409:'Something changed. Refresh the details and review your request again.',410:'This code or collection period has ended.',413:'Please choose a smaller photo.',415:'Choose a PNG, JPEG, or WebP photo.',422:'Please check the information and try again.',429:'Please wait a moment before trying again.',503:'This service is temporarily unavailable. Your existing request is retained.'};
async function request(method,url,body={},extra={},control={}) {
  if(control.expectedCsrf!==undefined && state.csrf!==control.expectedCsrf)throw Object.assign(new Error('Login session was superseded.'),{code:'LOGIN_SESSION_SUPERSEDED'});
  const headers={...extra};
  const retryFingerprint=method!=='GET' && !(body instanceof Blob) ? JSON.stringify([method,url,body]) : null;
  const options={method,credentials:'same-origin',cache:'no-store',headers};
  if(method!=='GET') {
    headers['Idempotency-Key']=retryFingerprint ? (pendingRequests.get(retryFingerprint) || key()) : key();
    if(retryFingerprint)pendingRequests.set(retryFingerprint,headers['Idempotency-Key']);
    const csrf=control.expectedCsrf===undefined?state.csrf:control.expectedCsrf;
    if(csrf) headers['X-C1-CSRF']=csrf;
    if(body instanceof File || body instanceof Blob) {headers['Content-Type']=body.type;options.body=body;}
    else {headers['Content-Type']='application/json';options.body=JSON.stringify(body);}
  }
  let response;
  try{response=await fetch(url,options);}catch{throw new Error('The result has not reached you yet. Your original request may still be pending.');}
  let data;try{data=await response.json();}catch{throw new Error('The service could not return these details. Please try again.');}
  if(!response.ok) {
    if(!control.silent && (response.status===401 || response.status===403)){state.access.clear();clearCode();}
    if(response.status<500 && retryFingerprint)pendingRequests.delete(retryFingerprint);
    const error=new Error(errors[response.status] || 'This action could not be completed.');
    if(control.silent)error.status=response.status;
    if(['/v1/identity/login','/v1/identity/wallet/challenge','/v1/identity/wallet/login'].includes(url) && typeof data.error==='string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(data.error)){error.code=data.error;error.status=response.status;}
    throw error;
  }
  if(retryFingerprint)pendingRequests.delete(retryFingerprint);
  if(!control.silent && typeof data.csrf==='string') state.csrf=data.csrf;
  if(!control.silent && typeof data.csrfToken==='string') state.csrf=data.csrfToken;
  if(!control.silent && (data.status || data.stage)) notify(statusText(data.status || data.stage));
  return data;
}
async function list(url) {
  const items=[], seen=new Set();let cursor=null;
  for(let page=0;page<20;page++){
    const data=await request('GET',url+'?limit=50'+(cursor?'&cursor='+path(cursor):''));
    items.push(...rows(data));cursor=data.cursor;
    if(!cursor)return {...data,items};
    if(seen.has(cursor))throw new Error('The list could not be continued. Refresh it.');
    seen.add(cursor);
  }
  throw new Error('This list is too large to display at once.');
}
function panel(id){for(const element of document.querySelectorAll('.panel'))element.hidden=element.id!==id;}
function clearCode(){state.codeGeneration++;if(state.code)clearInterval(state.code.timer);state.code=null;state.display=null;clearQR();$('collection-code').textContent='';$('code-validity').textContent='';$('display-code').hidden=true;}
function observeVoucher(value){
  const code=state.code;
  if(code && value.id===code.voucher && (value.state!=='R' || value.locked || value.marked || value.pending || value.accessEpoch!==code.accessEpoch || value.displayEpoch!==code.displayEpoch || value.provenance?.stale || value.provenance?.halted)){
    state.access.delete(code.voucher);clearCode();notify('This collection code is no longer available. Check the original voucher.');
  }
}
function showCode(data,voucher,accessEpoch,store){
  const remaining=Math.min(120000,Number(data.validUntil)*1000-Date.now());
  if(!/^[A-Za-z0-9_-]{43}$/.test(data.display || '') || !Number.isFinite(remaining) || remaining<=0)throw new Error('No valid new collection code was returned. Recover access and check the voucher again.');
  const code={voucher,accessEpoch,displayEpoch:data.displayEpoch,validUntil:Number(data.validUntil)*1000,deadline:performance.now()+remaining,ticks:0,checking:false,timer:null};
  const link=createCollectionLink({origin:window.location.origin,store:data.store || store,display:data.display});
  renderCode(link);state.display=data.display;code.link=link;state.code=code;
  $('collection-code').textContent=data.display;$('code-validity').textContent='Valid until '+new Date(code.validUntil).toLocaleString()+'. A new code replaces the previous one.';$('display-code').hidden=false;
  code.timer=setInterval(()=>{
    if(state.code!==code)return;
    if(Date.now()>=code.validUntil || performance.now()>=code.deadline){clearCode();notify('Your collection code has expired. Check the voucher before requesting a new code.');return;}
    if(++code.ticks%5!==0 || code.checking)return;
    code.checking=true;
    request('GET','/v1/vouchers/'+path(voucher)).then(value=>{if(state.code===code)observeVoucher(value);}).catch(()=>{if(state.code===code){clearCode();notify('The collection code could not be checked. Check the voucher before showing a new code.');}}).finally(()=>{code.checking=false;});
  },1000);
}
document.addEventListener('visibilitychange',()=>{if(document.hidden)clearCode();});
window.addEventListener('pagehide',()=>{collectionEntry=null;state.access.clear();clearCode();});
function run(action) {return async event=>{event?.preventDefault();const button=event?.submitter || event?.currentTarget;if(button instanceof HTMLButtonElement) button.disabled=true;try{await action(event);}catch(error){notify(error instanceof Error?error.message:'This action could not be completed.');}finally{if(button instanceof HTMLButtonElement)button.disabled=false;}};}
function text(tag,value){const element=document.createElement(tag);element.textContent=value;return element;}
function button(label,action){const element=text('button',label);element.type='button';element.addEventListener('click',run(action));return element;}
function money(value){if(state.mode==='C1_SYNTHETIC_LOOPBACK')return String(value)+' local DU';return state.asset?priceDisplay(String(value),state.asset.decimals,state.asset.symbol):'Verified amount details unavailable';}
function details(value) {
  const dl=document.createElement('dl');
  const labels={id:'Reference',store:'Store',meal:'Meal reference',version:'Original version',action:'Request type',name:'Meal',description:'Description',price:'Price',unitPrice:'Original price',quantity:'Meals funded',amount:'Amount',status:'Status',stage:'Request progress',state:'Collection status',deadline:'Authorization deadline (UTC)',expiresAt:'Expires',validUntil:'Code valid until',valid:'Code accepted',locked:'Collection reserved',marked:'Meal handover confirmed',funded:'Meals funded',available:'Meals available',eligible:'Available meals',reported:'Meals collected',paidAmount:'Paid amount',settled:'Paid',refunded:'Refunded'};
  for(const [field,label] of Object.entries(labels)) {
    const item=value?.[field] ?? value?.terms?.[field];
    if(item===undefined || item===null || typeof item==='object')continue;
    const shown=['status','stage','state'].includes(field)?statusText(item):['deadline','expiresAt','validUntil'].includes(field)?new Date(Number(item)*1000).toUTCString():typeof item==='boolean'?(item?'Yes':'No'):['price','unitPrice','amount','paidAmount'].includes(field)?money(item):String(item);
    dl.append(text('dt',label),text('dd',shown));
  }
  const windows=value?.windows || value?.terms?.windows;
  if(Array.isArray(windows))dl.append(text('dt','Collection hours (UTC)'),text('dd',windows.map(([a,b])=>[a,b].map(v=>String(Math.floor(v/60)).padStart(2,'0')+':'+String(v%60).padStart(2,'0')).join('–')).join(', ')));
  const financialLabels={F:'Contributed',A:'Available',R:'Reserved',H:'Collected, payment pending',S:'Settled',X:'Refunded',L:'Held for refund'};
  for(const [field,label] of Object.entries(financialLabels))if(typeof value?.financial?.[field]==='string')dl.append(text('dt',label),text('dd',money(value.financial[field])));
  if(value?.provenance?.halted)dl.append(text('dt','Service'),text('dd','Paused; existing records remain available where permitted.'));
  if(value?.provenance?.stale) dl.append(text('dt','Freshness'),text('dd','Awaiting verified updates.'));
  return dl;
}
function show(target,value){$(target).replaceChildren(details(value));}
function setOptions(id,items,label){const select=$(id);select.replaceChildren();for(const item of items){const option=text('option',item.name || `${label} ${items.indexOf(item)+1}`);option.value=reference(item);select.append(option);}}
function chooseStore(id){if(state.store!==id){state.draftStore=null;state.draftRevision=0;$('draft').reset();$('control-meal').replaceChildren();}state.store=id;state.controlRevision=state.stores.get(id)?.controlRevision ?? 0;}
async function loadStores(){const data=await list('/v1/stores');const items=rows(data),previous=state.store;state.stores=new Map(items.map(item=>[reference(item),item]));setOptions('store',items,'Store');if(items.some(item=>reference(item)===previous))$('store').value=previous;if(items.length)chooseStore($('store').value);else chooseStore(null);$('store-summary').replaceChildren();notify(items.length?'Choose a store to view its meals.':'No stores are available yet.');}
async function loadMeals(){chooseStore($('store').value);const base=storePath(),items=rows(await list(base+'/meals'));const offered=items.filter(item=>item.listed!==false && item.available!==false);setOptions('support-meal',offered,'Meal');setOptions('claim-meal',offered,'Meal');show('store-summary',state.stores.get(state.store));$('meals').replaceChildren();for(const meal of offered){const article=document.createElement('article');article.append(text('h2',meal.name || 'Meal'),details(meal));if(/^0x[0-9a-fA-F]{64}$/.test(meal.imageDigest || '')){const image=document.createElement('img');image.alt=meal.name || 'Meal photo';image.src='/v1/images/'+path(meal.imageDigest.slice(2));article.prepend(image);}article.append(button('View meal',async()=>show('public-ledger',await request('GET',`${base}/meals/${path(reference(meal))}`))));$('meals').append(article);}notify(offered.length?'Meals updated.':'This store has no available meals.');}
function openReview(title,data,confirm,note='Check the original meal and amount before confirming.') {
  state.review={data,confirm};$('review-error').textContent='';$('review-title').textContent=title;$('review-details').replaceChildren(details(data.review || data));$('review-note').textContent=note;$('review').showModal();
}
function confirmation(review) {
  const source=review.review || review;
  return {reviewId:source.reviewId || source.id};
}
async function track(data,target='public-ledger',context={}) {
  if(!data.stage && data.replay && data.result?.stage)data=data.result;
  const intentId=data.intentId || data.intent?.id || (data.stage ? data.id : null);
  const known=intentId ? state.requests.get(intentId) : null;
  const original={...known,...context,store:context.store || known?.store || state.store,target};
  if(intentId)state.requests.set(intentId,original);
  show(target,data);
  if(data.stage)notify(statusText(data.stage));
  if(intentId){$(target).append(text('p','Keep this request reference to check the original result after a reload: '+intentId),button('Check this request',async()=>track(await request('GET','/v1/intents/'+path(intentId)),target,original)));}
  const action=data.action || original.action;
  if(state.mode!=='CP30_TESTNET_CONNECTION' && intentId && action==='fund' && ['ACCEPTED','WAIT_ACTOR'].includes(data.stage))$(target).append(button('Cancel pending contribution',async()=>track(await request('POST',`/v1/support/intents/${path(intentId)}/cancel`,{}),target,original)));
  if(['fund','settle'].includes(action) && state.mode==='CP30_TESTNET_CONNECTION'){
    $(target).append(text('p',data.stage==='FINAL_SUCCEEDED'?'The original finalized receipt is verified.':'Payment remains pending until the original finalized receipt is verified.'));
    if(intentId && data.stage!=='FINAL_SUCCEEDED')$(target).append(button('Review my original wallet request',async()=>{panel('mine');window.dispatchEvent(new CustomEvent('c1-wallet-review',{detail:{id:intentId}}));}));
  }
  const lockId=data.result?.result;
  if(action==='lock' && data.stage==='FINAL_SUCCEEDED' && typeof lockId==='string' && /^0x[0-9a-f]{64}$/.test(lockId))$(target).append(button('View collection',async()=>{panel('owner');await openCase(lockId,original.store);}));
  if(action==='issue' && data.stage==='FINAL_SUCCEEDED')$(target).append(button('View my vouchers',async()=>{panel('mine');await loadVouchers();}));
  if(action==='handover' && data.stage==='FINAL_SUCCEEDED')$(target).append(text('p','The handover marker is recorded. Check the original collection for the subsequent report; settlement is a separate step.'),button('Refresh collection',async()=>openCase(original.caseId,original.store)));
  if(data.stage==='UNKNOWN' || data.stage==='AWAITING_OUTCOME')$(target).append(text('p','Check this original request. Its outcome is not confirmed.'));
}
$('confirm-review').addEventListener('click',run(async()=>{if(!state.review)return;const review=state.review;try{await review.confirm(review.data);if(state.review===review)state.review=null;$('review').close();}catch(error){$('review-error').textContent=error.message;throw error;}}));
for(const element of document.querySelectorAll('[data-panel]'))element.addEventListener('click',()=>panel(element.dataset.panel));
$('restore-request').addEventListener('submit',run(async()=>{const id=new FormData($('restore-request')).get('intent').trim();if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))throw new Error('Enter the original request reference.');await track(await request('GET','/v1/intents/'+path(id)),'request-status',{store:state.store});}));
$('store').addEventListener('change',()=>chooseStore($('store').value));
$('load-stores').addEventListener('click',run(loadStores));$('load-meals').addEventListener('click',run(loadMeals));
$('ledger').addEventListener('click',run(async()=>{const data=await list('/v1/ledger');$('public-ledger').replaceChildren(...(rows(data).length?rows(data).map(details):[details(data)]));}));
function clearPrivate(){state.review=null;if($('review').open)$('review').close();window.dispatchEvent(new Event('c1-session-cleared'));state.access.clear();clearCode();for(const id of ['orders','order-details','vouchers','workspace','checked','case','payments','request-status'])$(id).replaceChildren();$('draft').reset();state.draftStore=null;}
$('sign-in').addEventListener('submit',run(async()=>{clearPrivate();await request('POST','/v1/auth/pre-session',{}, {'X-C1-Bootstrap':'1'});const data=await request('POST','/v1/auth/login',{assertion:new FormData($('sign-in')).get('assertion')});clearPrivate();$('sign-in').reset();const me=await request('GET','/v1/me');$('account-name').textContent=me.displayName || 'Signed in';notify('You are signed in.');if(data.status)notify(statusText(data.status));}));
$('reauth').addEventListener('submit',run(async()=>{state.access.clear();clearCode();await request('POST','/v1/auth/reauth',{assertion:new FormData($('reauth')).get('assertion')});state.access.clear();clearCode();$('reauth').reset();notify('Your sign-in has been verified.');}));
$('logout').addEventListener('click',run(async()=>{collectionEntry=null;clearPrivate();await request('POST','/v1/auth/logout');state.csrf=null;clearPrivate();$('account-name').textContent='Signed out';notify('You are signed out.');}));
$('support').addEventListener('submit',run(async()=>{const data=await request('POST','/v1/support/reviews',{store:state.store,meal:$('support-meal').value,quantity:Number(new FormData($('support')).get('quantity'))});openReview('Review your contribution',data,async review=>track(await request('POST','/v1/support/intents',confirmation(review)), 'public-ledger',{action:'fund',store:state.store}),'After you confirm, payment still requires the payer’s separate confirmation.');}));
$('claim').addEventListener('submit',run(async()=>{const data=await request('POST','/v1/claims/reviews',{store:state.store,meal:$('claim-meal').value});openReview('Review your meal',data,async review=>track(await request('POST','/v1/claims/intents',confirmation(review)),'public-ledger',{action:'issue',store:state.store}));}));
async function loadOrders(){const items=rows(await list('/v1/my/orders'));$('orders').replaceChildren();for(const order of items){const id=reference(order),article=document.createElement('article');article.append(text('h2',order.name || order.terms?.name || 'Contribution'),details(order),button('View contribution',async()=>show('order-details',await request('GET','/v1/orders/'+path(id)))),...(state.mode==='CP30_TESTNET_CONNECTION'?[]:[button('Review a refund',async()=>{const review=await request('POST',`/v1/orders/${path(id)}/refund-reviews`,{});openReview('Review original refund',review,async data=>track(await request('POST','/v1/refund-intents',confirmation(data)),'orders'),'Only eligible uncollected meals can be refunded. The original payer confirms the refund separately.');})]));if(state.mode!=='CP30_TESTNET_CONNECTION' && order.intentId)article.append(button('Cancel pending contribution',async()=>track(await request('POST',`/v1/support/intents/${path(order.intentId)}/cancel`,{}),'orders')));$('orders').append(article);}}
async function loadVouchers(){const items=rows(await list('/v1/my/vouchers'));$('vouchers').replaceChildren();for(const voucher of items){const id=reference(voucher),article=document.createElement('article'),summary=details(voucher);article.append(text('h2',voucher.name || voucher.terms?.name || 'Meal voucher'),summary,button('View voucher',async()=>{const data=await request('GET','/v1/vouchers/'+path(id));observeVoucher(data);summary.replaceChildren(details(data));}),button('Recover collection access',async()=>{state.access.clear();clearCode();const generation=state.codeGeneration;const data=await request('POST',`/v1/vouchers/${path(id)}/recover`,{});if(generation!==state.codeGeneration)return;if(typeof data.access==='string')state.access.set(id,{value:data.access,epoch:data.accessEpoch});summary.replaceChildren(details({...voucher,...data}));notify(data.redeemable?'Collection access recovered. You can show your code during the original collection window.':'This voucher remains in your history. Collection access is unavailable.');}),button('Show collection code',async()=>{const access=state.access.get(id);if(!access)throw new Error('Recover collection access first.');clearCode();const generation=state.codeGeneration;const data=await request('POST',`/v1/vouchers/${path(id)}/display`,{access:access.value});if(generation!==state.codeGeneration)return;showCode(data,id,access.epoch,voucher.store);summary.replaceChildren(details({...voucher,...data}));}));$('vouchers').append(article);}}
$('my-orders').addEventListener('click',run(loadOrders));$('my-vouchers').addEventListener('click',run(loadVouchers));$('copy-code').addEventListener('click',run(async()=>{if(state.display){await navigator.clipboard.writeText(state.code.link);notify('Short-lived collection link copied.');}}));
function revisions(data){state.draftRevision=data.draftRevision ?? data.revision ?? state.draftRevision;state.controlRevision=data.controlRevision ?? state.controlRevision;}
function fillDraft(data){const draft=data.draft || data;for(const name of ['name','description','price'])if(draft[name]!==undefined)$('draft').elements[name].value=draft[name];if(Array.isArray(draft.windows)){for(const [i,names] of [[0,['start','end']],[1,['start2','end2']]])for(const [j,name] of names.entries()){$('draft').elements[name].value=draft.windows[i]?`${String(Math.floor(draft.windows[i][j]/60)%24).padStart(2,'0')}:${String(draft.windows[i][j]%60).padStart(2,'0')}`:'';}for(const [i,name] of [[0,'midnight'],[1,'midnight2']])$('draft').elements[name].checked=draft.windows[i]?.[1]===1440;}}
$('workbench').addEventListener('click',run(async()=>{const data=await request('GET',storePath()+'/workbench');revisions(data);const meals=data.meals || [];setOptions('control-meal',meals,'Meal');show('workspace',data);for(const meal of [...(data.drafts || []),...meals.filter(meal=>!(data.drafts || []).some(draft=>draft.meal===meal.meal))])$('workspace').append(button('Edit '+(meal.name || 'meal'),async()=>{$('draft').elements.meal.value=reference(meal);state.draftStore=state.store;const draft=await request('GET',draftPath());revisions(draft);fillDraft(draft);show('workspace',draft);}));}));
$('new-meal').addEventListener('click',run(async()=>{storePath();$('draft').reset();$('draft').elements.meal.value=crypto.randomUUID();state.draftStore=state.store;state.draftRevision=0;notify('Fill in the new meal details, then save.');$('draft').elements.name.focus();}));
const draftPath=()=>{const meal=new FormData($('draft')).get('meal');if(!meal || state.draftStore!==state.store)throw new Error('Open a meal from your workspace, or add a new meal.');return storePath()+'/drafts/'+path(meal);};
$('open-draft').addEventListener('click',run(async()=>{const data=await request('GET',draftPath());revisions(data);fillDraft(data);show('workspace',data);}));
const minute = value => {const [h,m]=value.split(':').map(Number);return h*60+m;};
$('draft').addEventListener('submit',run(async()=>{const form=new FormData($('draft')),windows=[[minute(form.get('start')),form.get('midnight')?1440:minute(form.get('end'))]];if(form.get('start2') || form.get('end2')){if(!form.get('start2') || !form.get('end2'))throw new Error('Fill in both ends of the second collection window.');windows.push([minute(form.get('start2')),form.get('midnight2')?1440:minute(form.get('end2'))]);}const data=await request('PUT',draftPath(),{name:form.get('name'),description:form.get('description'),price:form.get('price'),windows,expectedRevision:state.draftRevision});revisions(data);show('workspace',data);notify('Your private meal changes have been saved.');}));
$('upload').addEventListener('submit',run(async()=>{const file=new FormData($('upload')).get('image');if(!file || file.size>5*1024*1024)throw new Error('Choose a photo smaller than 5 MB.');const data=await request('PUT',draftPath()+'/image',file,{'X-C1-Draft-Revision':String(state.draftRevision)});revisions(data);show('workspace',data);$('upload').reset();notify('Your meal photo has been saved.');}));
$('review-publish').addEventListener('click',run(async()=>{const base=draftPath(),store=state.store;const data=await request('POST',base+'/review',{expectedRevision:state.draftRevision});openReview('Review meal publication',data,async review=>track(await request('POST',base+'/publish',confirmation(review)),'workspace',{action:'publish',store}),'Your public menu updates after the original publication is confirmed.');}));
$('controls').addEventListener('submit',run(async event=>{const action=event.submitter.value,form=new FormData($('controls'));const body={expectedRevision:state.controlRevision};let route=action;if(action==='list' || action==='unlist'){route='list';body.meal=form.get('meal');body.listed=action==='list';}if(action==='pause' || action==='resume'){route='pause';body.paused=action==='pause';}if(action==='close'){openReview('Close this store',body,async()=>{const data=await request('POST',storePath()+'/close',body);revisions(data);await track(data,'workspace');},'Closing is permanent. Existing collection and payment responsibilities remain.');return;}const data=await request('POST',storePath()+'/'+route,body);revisions(data);await track(data,'workspace');}));
$('check').addEventListener('submit',run(async()=>{const store=state.store,base=storePath(),display=new FormData($('check')).get('display');const data=await request('POST',base+'/checks',{display});show('checked',data);if(data.valid===true)$('checked').append(button('Reserve this collection',async()=>{openReview('Reserve this collection',data,async()=>{if(state.display===display)clearCode();await track(await request('POST',base+'/locks',{display}),'checked',{action:'lock',store});$('check').reset();},'Checking a code does not reserve or hand over the meal. Confirm to reserve this collection.');}));}));
async function openCase(id,store=state.store){if(!store || typeof id!=='string' || !/^0x[0-9a-f]{64}$/.test(id))throw new Error('Choose the original store and enter its collection reference.');const base='/v1/stores/'+path(store),data=await request('GET',base+'/cases/'+path(id));if(state.code?.voucher===data.voucher && (data.marked || data.pending || data.state!=='R'))clearCode();show('case',data);$('case').append(button('Refresh collection',async()=>openCase(id,store)));if(data.id && data.state==='R' && !data.marked && !data.pending)$('case').append(button('Confirm meal handed over',async()=>openReview('Confirm the handover',data,async()=>track(await request('POST',base+'/cases/'+path(data.id)+'/handover-intents',{}),'case',{action:'handover',store,caseId:data.id}),'Only confirm while handing the meal to the person collecting it. Wait for the original confirmation; checking or reserving alone does not record handover.')));if(data.marked)$('case').append(text('p','Handover is marked. Earlier collection codes cannot be used for another collection. Refresh to see the subsequent report and payment state.'));}
$('open-case').addEventListener('submit',run(async()=>openCase(new FormData($('open-case')).get('case').trim())));
$('payouts').addEventListener('click',run(async()=>{const store=state.store,base=storePath(),items=rows(await list(base+'/payouts'));$('payments').replaceChildren();if(!items.length)$('payments').append(text('p','No reported meals are awaiting settlement.'));for(const payout of items){const id=reference(payout),article=document.createElement('article');article.append(text('h2','Original payment'),details(payout),...(payout.state==='S'?[]:[button('Review payment',async()=>{const review=await request('POST',base+'/payouts/'+path(id)+'/settle-reviews',{});openReview('Review original payment',review,async data=>track(await request('POST',base+'/settle-intents',confirmation(data)),'payments',{action:'settle',store}),'This creates a settlement request. Your verified wallet signs the original settlement separately; review alone does not establish payment.');})]));$('payments').append(article);}}));
run(loadStores)();


function configureLive(data){
  state.mode=data.mode;state.asset=data.assetVerified===true?{decimals:data.assetDecimals,symbol:data.assetSymbol}:null;
  const live=state.mode==='CP30_TESTNET_CONNECTION';
  const synthetic=state.mode==='C1_SYNTHETIC_LOOPBACK';
  $('sign-in').hidden=!synthetic;$('reauth').hidden=!synthetic;
  document.querySelector('.demo-note').hidden=live;
  if(synthetic)document.querySelector('.demo-note').textContent='Local demonstration · Synthetic identity and funds';
  document.querySelector('footer').textContent=live?'MealForward · Original results verified on the configured test network':'MealForward · Local demonstration';
  for(const id of ['new-meal','draft','upload','review-publish','controls'])$(id).hidden=live;
}
async function sessionEstablished({isCurrent=()=>true}={}){
  const me=await request('GET','/v1/me');if(!isCurrent())return false;
  state.access.clear();clearCode();$('account-name').textContent=me.displayName || 'Signed in';
  if(collectionEntry){
    const entry=collectionEntry;collectionEntry=null;
    if(performance.now()-collectionArrival<120000){chooseStore(entry.store);if(state.stores.has(entry.store))$('store').value=entry.store;$('check').elements.display.value=entry.display;panel('owner');notify('Short-lived code loaded. Check it online after choosing your original store. No collection was reserved.');}
    else notify('This short-lived link has expired. Ask for a fresh collection code.');
  }
  window.dispatchEvent(new Event('c1-session-established'));
  return true;
}
async function revokeCommittedLogin(csrf){
  if(typeof csrf!=='string' || !/^[A-Za-z0-9_-]{43}$/.test(csrf))return {revoked:false,code:'LOGIN_REVOKE_FAILED'};
  if(state.csrf!==csrf)return {revoked:false,superseded:true,code:'LOGIN_SESSION_SUPERSEDED'};
  try{await request('POST','/v1/auth/logout',{}, {'X-C1-Preserve-Session-Cookie':'1'},{expectedCsrf:csrf,silent:true});}
  catch(error){if(error.status!==401)return {revoked:false,superseded:state.csrf!==csrf,code:'LOGIN_REVOKE_FAILED'};}
  if(state.csrf!==csrf)return {revoked:true,superseded:true};
  state.csrf=null;clearPrivate();$('account-name').textContent='Signed out';return {revoked:true};
}
window.addEventListener('c1-connection-setup',event=>configureLive(event.detail));

export {request,notify,openReview,sessionEstablished,revokeCommittedLogin};
