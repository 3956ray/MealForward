import * as M from './model.mjs';
import {normalizeUpload,verifyStoredImages} from './image.mjs';
import {renderRegistration,renderLiveCards,renderLiveKitchen,renderLiveStore,validateDraft,hasOwnedKitchen,renderLiveMealEditor,priceLabel,halfHourOptions,renderWalletChooser,renderSupportFlow,renderContributions,supportState,renderClaimFlow,renderMyMeals,renderVerificationEntry,renderSettlementFlow,renderMealPublishFlow} from './onboarding-view.mjs';
const LIVE_MODE=true;
const live={api:null,context:{},busy:false,error:'',blocked:true,signed:false,draft:{windows:[['','']]},errors:{},preview:'',stores:[],meals:{},overview:null,loading:true,catalogError:'',generation:0,reloginRequired:false,ownerMeals:[],ownerMealStoreId:null,mealCapabilities:{},mealUnavailableReasons:{},mealEditor:null,mealListing:null,walletChooser:null,mealPublish:null,mealPublishPending:{},settlement:null,payouts:null,payoutStoreId:null,payoutsLoading:false,settlementAttempts:{},settlementPending:{},verification:null,claim:null,claimPending:null,vouchers:[],claimIntents:[],claimRecordsLoading:false,support:null,supportOrders:[],supportOrdersLoading:false,supportAttempts:{}};
const {STORES,getStore,stats,displayText:english,money,nowFor}=M;
const main=document.querySelector('#main'),dialog=document.querySelector('#dialog'),body=document.querySelector('#dialog-body');
let restoring=true,state,storageError='',filter='all',checkout=null,checkedId='',nextResult='final',resume=null,dialogKind='',dialogTrigger=null,resetConfirmButton=null,toastTimer,editorInitial='',editorValues=null,verificationInput='',claimSelection=null,replacement=null,editorEpoch=0,imageRequest=0,uploadPending=false,editorImage='';
state=M.initialState();
let savedRaw=null,storageEpoch=0,externalAuthorityLost=false;
async function restoreSaved(external=false){const epoch=++storageEpoch;let raw=null;restoring=true;if(external){externalAuthorityLost=true;M.signOut(state);clearIdentityContext(true);close(true);body.innerHTML='';document.querySelector('#signin-button').textContent='Sign in';document.querySelector('#signin-button').setAttribute('aria-label','Sign in');document.querySelector('#signout-button').hidden=true;document.querySelector('#workspace-link').hidden=true;}render();try{raw=localStorage.getItem(M.KEY);if(external&&raw===null)throw Error('Shared demo data was removed. Explicitly review reset or restore the original records.');const candidate=raw!==null?M.restore(raw):M.initialState();await verifyStoredImages(candidate);if(epoch!==storageEpoch)return;if(localStorage.getItem(M.KEY)!==raw){restoreSaved(true);return;}if(!external&&raw!==null){const cleared=JSON.stringify(candidate);localStorage.setItem(M.KEY,cleared);raw=cleared;}state=candidate;savedRaw=raw;storageError='';if(external)toast('Shared demo data changed. Sign in again and review your selection before any new action.');}catch(err){if(epoch!==storageEpoch)return;savedRaw=raw;storageError='Saved demo data needs verification: '+err.message+' Original saved bytes have not been replaced.';}finally{if(epoch===storageEpoch){restoring=false;render();}}}
function requireCurrentSnapshot(){if(localStorage.getItem(M.KEY)!==savedRaw){restoreSaved(true);throw Error('Shared demo data changed. Wait for verification, then sign in and review again.');}}

const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=t=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(t));
const btn=(text,action,id='',style='',disabled=false)=>`<button class="button ${style}" data-action="${action}" data-id="${e(id)}" ${disabled?'disabled':''}>${text}</button>`;
const notice=(text,warning=false)=>`<div class="notice ${warning?'warning':''}">${text}</div>`;
const errorBox='<p class="error" id="form-error" role="alert"></p>';
const pageHead=(title,sub,crumb=title)=>`<div class="breadcrumb"><a href="#home">MealForward home</a> / ${e(crumb)}</div><div class="page-heading"><h1>${e(title)}</h1><p>${e(sub)}</p></div>`;
const facts=items=>`<dl class="facts">${items.map(([k,v])=>`<div><dt>${e(k)}</dt><dd>${e(v)}</dd></div>`).join('')}</dl>`;
const empty=(title,text)=>`<section class="empty"><h2>${e(title)}</h2><p>${e(text)}</p></section>`;
const status=c=>({issued:'Ready to use',locked:'Processing right confirmed',reported:'Handoff reported · Simulated',expired:'Voucher expired'}[c.status]??'Needs verification');
const hours=c=>c.windows.map(([a,b])=>`${String(Math.floor(a/60)).padStart(2,'0')}:${String(a%60).padStart(2,'0')}–${String(Math.floor(b/60)).padStart(2,'0')}:${String(b%60).padStart(2,'0')}`).join(' / ');
const mealSnapshot=c=>`<div class="checkout-item"><img src="${e(M.imageSrc(c.image))}" width="75" height="75" alt="Illustrative ${e(english(c.meal))}"><p>${e(english(c.description))}</p></div>`;
function toast(text){const el=document.querySelector('#toast');el.textContent=text;el.classList.add('toast-visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('toast-visible'),4000);}
function error(text){const el=document.querySelector('#form-error')??document.querySelector('#page-error');if(el)el.textContent=text;else toast(text);}
function mutate(fn,reauthenticate=false){if(restoring)throw Error('Wait for saved images to finish checking.');if(storageError)throw Error(storageError);if(externalAuthorityLost&&!reauthenticate)throw Error('Sign in again before changing shared demo data.');requireCurrentSnapshot();const next=M.transaction(state,fn),raw=JSON.stringify(next);requireCurrentSnapshot();try{localStorage.setItem(M.KEY,raw);}catch{storageError='Local storage is unavailable. Saved data has not been reset; operations are paused.';throw Error(storageError);}savedRaw=raw;state=next;if(reauthenticate)externalAuthorityLost=false;return state;}
function modal(html,kind=''){editorEpoch++;imageRequest++;uploadPending=false;if(!dialog.open)dialogTrigger=document.activeElement;dialogKind=kind;resetConfirmButton=null;body.innerHTML=html;if(kind==='reset')resetConfirmButton=body.querySelector('[data-action="reset-confirm"]');dialog.showModal();const focus=body.querySelector('[autofocus],input,select,button');(focus??document.querySelector('.dialog-close')).focus();}
function close(force=false){if(!force&&dialogKind==='edit'&&editorDirty()){discardEditor();return;}editorEpoch++;imageRequest++;uploadPending=false;dialog.close();dialogKind='';resetConfirmButton=null;if(dialogTrigger?.isConnected)dialogTrigger.focus();else main.focus({preventScroll:true});}
function requireSignIn(action){if(!state.session){resume=action;signInModal();return false;}return true;}
function signInModal(){modal(`<h2 id="dialog-title">Sign in to MealForward</h2><p class="dialog-subtitle">Prototype sign-in. No email is sent.</p><div class="form-field"><label for="demo-email">Demo email</label><select id="demo-email">${M.EMAILS.map(email=>`<option>${email}</option>`).join('')}</select></div>${notice('One sign-in for supporting and receiving meals. Only invited demo accounts can manage their own kitchen. No real email, OTP or wallet access.')}${errorBox}${btn('Continue','signin-confirm','','full')}`,'signin');}
function storeCard(store){const t=stats(state,store.id),c=M.mealsFor(state,store.id,true).find(m=>m.active)??M.mealsFor(state,store.id,true)[0]??{...store,id:M.legacyMealId(store.id),active:false,version:0},available=stats(state,store.id,c.id).available;return `<article class="store-card" data-meal-id="${e(c.id)}" data-menu-version="${c.version}"><a class="store-photo" href="#store/${store.id}" aria-label="Explore ${store.name}"><img src="${e(M.imageSrc(c.image))}" width="400" height="240" alt="Illustrative ${e(english(c.meal))}" loading="lazy"><div class="store-tag"><span>Simulated kitchen</span><span>${store.type==='meat'?'Home-style cooking':'Vegetable meals'}</span></div><span class="store-number">${store.english}</span></a><div class="store-body"><div class="store-heading"><h3><a href="#store/${store.id}">${store.name}</a></h3><span>${store.area}</span></div><p class="store-description">${c.version?e(english(c.description)):store.description}</p><p class="meal-name">${c.version?e(english(c.meal)):'No published meals yet'} <span class="version">${c.version?'v'+c.version:''}</span></p><p class="store-time">Service Time · Selected meal ${c.version?hours(c)+' · Asia/Shanghai':'No published service times'}</p><div class="progress-heading"><span>Meals supported <b>${t.F}</b> / 10</span><span>${available} available</span></div><div class="progress" aria-hidden="true"><div style="width:${t.F*10}%"></div></div><p class="pill">${state.configs[store.id].paused?'Safety pause':c.active?'Listed':'Unlisted'}</p><div class="store-bottom"><div class="price"><strong>${c.version?c.price.toFixed(2):'Not published'}</strong><small>${c.version?'test USDC / meal':'No meals listed yet'}</small></div>${btn('Support a meal','support',c.id,'',!c.active||state.configs[store.id].paused||t.F>=10)}</div>${btn('Claim a meal','claim',c.id,'outline claim-link',!c.active||state.configs[store.id].paused||!available)}</div></article>`;}
function home(){const t=stats(state);main.innerHTML=`<div class="container"><section class="hero"><div class="hero-copy"><div class="eyebrow">A LITTLE KINDNESS, FORWARD</div><h1>A warm meal.<br>A little <span>kindness.</span></h1><p>You leave a meal. A small kitchen prepares it.<br>Someone else can eat well, without explaining why.</p><div class="hero-ctas"><a class="button" href="#stores">Support a meal</a>${btn('I need a meal','choose-claim','','outline')}</div><div class="hero-note">No wallet needed to claim · No personal story required</div></div><figure class="hero-visual"><img class="hero-image" src="/assets/hero-meal.jpg" width="600" height="490" alt="Illustrative chicken, rice and vegetables" fetchpriority="high"><div class="round-stamp"><small>GOOD FOOD</small><strong>Share a meal</strong><small>PASS IT FORWARD</small></div><figcaption class="photo-caption"><div><strong>For the next person.</strong><small>One meal. A kind gesture.</small></div></figcaption><span class="visual-label">Illustrative meal · Not real delivery</span></figure></section><div class="summary-strip"><div class="summary-intro">A small meal. Shared with care.</div><div class="summary-item"><strong>3</strong><small>Independent<br>simulated kitchens</small></div><div class="summary-item"><strong>${t.F}</strong><small>Lifetime supported meals<br>Final simulated payments</small></div><div class="summary-item"><strong>72<small>h</small></strong><small>Original voucher<br>validity</small></div></div><section class="section" id="stores"><div class="section-head"><div><div class="eyebrow">THE NEIGHBORHOOD TABLE</div><h2>Leave a meal at a kitchen you love.</h2><p>Three small kitchens. Three familiar flavors. One kind gesture.</p></div><div class="filters" role="group" aria-label="Filter meal types">${[['all','All kitchens'],['meat','Home-style'],['veg','Vegetables']].map(([id,label])=>`<button data-action="filter" data-id="${id}" class="${filter===id?'selected':''}" aria-pressed="${filter===id}">${label}</button>`).join('')}</div></div><div class="store-grid">${STORES.filter(s=>filter==='all'||s.type===filter).map(storeCard).join('')}</div><p class="section-foot">Lifetime limit: 10 meals per kitchen across all versions. One kitchen per order. Test assets have no real dollar value.</p></section></div><section class="how-section" id="how"><div class="container how-layout"><div class="how-intro"><div class="eyebrow">A LITTLE KINDNESS, FORWARD</div><h2>A meal for<br>the next person.</h2><p>Two simple paths: support or claim.<br>Every meal has a clear place in the ledger.</p></div><div class="how-steps">${[['01','Choose a kitchen','Support its meal. Only final simulated payment adds available portions. Follow progress in your original order.'],['02','Sign in and claim','Use a built-in demo email, without a wallet. One meal across all kitchens every 72 hours. Recovery keeps the original expiry.'],['03','Visit during service hours','Show your short-lived code within the original 72 hours. The invited owner checks, locks and reports handover. Payout is separate.']].map(([n,title,text])=>`<div><div class="step-number">${n}</div><h3>${title}</h3><p>${text}</p></div>`).join('')}</div></div></section><div class="container"><section class="ledger-teaser"><div><div class="eyebrow">EVERY MEAL, ACCOUNTED FOR</div><h2>Kindness, with a clear record.</h2><p>Support, vouchers, handovers, payouts and refunds, by kitchen.</p></div><a class="button outline" href="#ledger">View meal ledger</a></section><div class="closing">A warm meal for an ordinary day.<span>A WARM MEAL. A KINDER DAY.</span></div></div>`;}
function detail(id){const store=getStore(id);if(!store)return missing();const meals=M.mealsFor(state,id,true),total=stats(state,id);main.innerHTML=`<div class="container page">${pageHead(store.name,store.description,'Kitchens / '+store.name)}<p class="status-line">Simulated kitchen · ${total.F} / 10 lifetime supported meals across this kitchen · ${state.configs[id].paused?'Safety pause':'Meal listings below'}</p><div class="public-meal-list">${meals.map(c=>{const t=stats(state,id,c.id);return `<article class="detail-grid" data-meal-id="${e(c.id)}" data-menu-version="${c.version}"><img class="detail-image" src="${e(M.imageSrc(c.image))}" width="600" height="370" alt="Illustrative ${e(english(c.meal))}"><div class="detail-copy"><h2>${e(english(c.meal))}</h2><p class="muted">${e(english(c.description))}</p>${facts([['Current unit price',money(c.price)],['Meals supported',`${t.F} · Lifetime`],['Service hours',`${hours(c)} · Asia/Shanghai`],['Available to claim',`${t.available} meals · Current menu v${c.version}`]])}<p class="pill">${c.active?'Listed':'Unlisted · Existing obligations retained'}</p><div class="detail-buttons">${btn('Support a meal','support',c.id,'',!c.active||state.configs[id].paused||total.F>=10)}${btn('Claim a meal','claim',c.id,'outline',!c.active||state.configs[id].paused||!t.available)}</div></div></article>`}).join('')||empty('No published meals yet','Drafts are not visible in Kitchens.')}</div>${notice('One kitchen and one selected meal per order. Original voucher terms remain unchanged. All meals and handovers are simulated.')}<a class="text-button" href="#ledger">View the meal ledger</a></div>`;}
function operationPanel(o){const original=o.terms??state.coupons.find(c=>c.id===o.coupon)??state.orders.find(order=>order.id===o.order||state.units.some(u=>u.order===order.id&&o.units?.includes(u.id))),purpose={support:'support',refund:'refund',payout:'payout'}[o.kind],connected=!purpose||(state.wallet?.email===state.session?.email&&state.wallet.purpose===purpose&&(purpose!=='payout'||state.wallet.store===o.store));return `<section class="operation panel"><h3>${e({support:'Support payment',claim:'Voucher issuance',lock:'Processing right',report:'Handoff report',payout:'Owner payout',refund:'Original-payer refund'}[o.kind])}</h3><p class="pill">${o.status==='unknown'?'Needs verification':o.status==='pending'?'Pending · Simulated':o.status==='final'?'Confirmed · Simulated':'Request declined'}</p><p>${getStore(o.store).name} · Original operation ${e(o.id)}</p>${original?mealSnapshot(original)+facts([['Original meal',english(original.meal)],['Original menu version','v'+original.version],['Original unit price',money(original.price)],['Original service hours',hours(original)+' · Asia/Shanghai']]):''}${M.isOpen(o)?`${notice('Only this original intent will be checked. Its resources and responsibilities remain held. No automatic success or replacement operation.')}${!connected?btn('Connect demo wallet','restore-wallet',o.id,'outline'):''}${btn('Check original operation','resolve',o.id,'',!connected)}`:''}</section>`;}
function mine(tab='coupons'){const email=state.session?.email,orders=state.orders.filter(o=>o.email===email&&email),coupons=state.coupons.filter(c=>c.email===email&&email);main.innerHTML=`<div class="container page">${pageHead('My meals','Your vouchers and original support orders, stored only in this browser.')}<nav class="tabs" aria-label="My meals sections"><a href="#mine/coupons" ${tab==='coupons'?'aria-current="page" class="active"':''}>My vouchers</a><a href="#mine/orders" ${tab==='orders'?'aria-current="page" class="active"':''}>Support orders</a></nav>${!email?`${empty('Sign in to view your meals','Use your original built-in demo email. No wallet is needed to view vouchers.')}${btn('Sign in','signin')}`:tab==='orders'?`${orders.length?orders.toReversed().map(orderCard).join(''):empty('No support orders yet','Choose a kitchen and leave a meal. Wallet connection happens in payment review only.')}${state.ops.filter(o=>o.email===email&&['support','refund'].includes(o.kind)&&M.isOpen(o)).map(operationPanel).join('')}`:`${coupons.length?coupons.toReversed().map(c=>`<article class="order-card"><h2>${getStore(c.store).name} · ${e(english(c.meal))}</h2><p class="pill">${status(c)}</p><p>Valid until ${date(c.expires)} · Asia/Shanghai · Original v${c.version}</p><a class="button outline" href="#coupon/${c.id}">Open my voucher</a></article>`).join(''):empty('A meal for you','No wallet required. Choose a kitchen, then claim one meal.')}${state.ops.filter(o=>o.email===email&&o.kind==='claim'&&M.isOpen(o)).map(operationPanel).join('')}<div class="order-actions">${btn('Claim a meal','choose-claim')}${btn('Recover my voucher','recover','','outline')}</div>`}${state.orders.some(o=>o.email===null&&o.owner!=='seed')||state.coupons.some(c=>c.email===null)?notice('Legacy record needs verification. Historical data is retained, but cannot be assigned to an arbitrary new email.'):''}${notice('Sign-in is a prototype only. Recovery keeps the original expiry. Records belong to their original demo email and payer.')}</div>`;}
function orderCard(o){const units=state.units.filter(u=>u.order===o.id),count=k=>units.filter(u=>k.includes(u.status)).length;return `<article class="order-card"><div class="order-top"><div><h2>${getStore(o.store).name} · ${e(english(o.meal))}</h2><small>${e(o.id)} · ${date(o.time)} · Original v${o.version}</small></div><span class="pill">Support confirmed · Simulated</span></div><div class="order-metrics">${[['Supported',o.quantity],['Handoffs reported',count('HS')],['Awaiting meal',count('AR')],['Refunded',count('X')]].map(([k,v])=>`<div><strong>${v}</strong><small>${k}</small></div>`).join('')}</div><p>Original unit price ${money(o.price)} · Awaiting payout ${money(count('H')*o.price)} · Received ${money(count('S')*o.price)}</p>${mealSnapshot(o)}<p class="muted">Original service hours · ${hours(o)} · Asia/Shanghai</p><p class="muted">Original payer: ${e(o.owner)}</p><div class="order-actions">${btn('Review safe refund','refund',o.id,'outline',!units.some(u=>u.status==='A'&&!M.reserved(state,u.id)))}</div><div class="thank-card"><div><h3>A note of thanks</h3><p>${o.nft==='queued'?'Optional thank-you NFT queued · Simulated, not minted':o.nft==='failed'?'Thank-you failed · Support remains final':o.nft==='hidden'?'Thank-you hidden':o.nft?'Historical thank-you sample':'Thank-you NFT declined'}</p>${o.nft==='queued'?`${btn('Decline thank-you','stop-nft',o.id,'outline compact')}${btn('Simulate NFT failure','fail-nft',o.id,'outline compact')}`:''}<a class="text-button" href="#nft">View public sample</a></div></div></article>`;}
function couponPage(id){const c=state.coupons.find(c=>c.id===id);if(!c)return missing();if(!state.session||c.email!==state.session.email){main.innerHTML=`<div class="container page">${pageHead('Voucher access','Sign in with the original demo email. Legacy records need verification.')}${btn('Sign in','signin')}</div>`;return;}main.innerHTML=`<div class="container page"><div class="breadcrumb"><a href="#mine/coupons">My vouchers</a> / ${e(c.id)}</div><article class="coupon"><div class="coupon-head"><small>MEALFORWARD · A MEAL FOR YOU</small><h1>${getStore(c.store).name}</h1><p>${e(english(c.meal))}</p></div><div class="coupon-body"><p class="pill">${status(c)}</p>${voucherFacts(c)}${c.status==='issued'?btn('Show verification code','credential',c.id,'full'):notice(c.status==='locked'?'This voucher has a unique processing right. Expiry does not release the responsibility. Check the original operation.':c.status==='reported'?'Handoff reported · Simulated. Payout remains separate.':'Original voucher expired. Recovery cannot reopen it.')}${state.ops.filter(o=>o.coupon===c.id&&M.isOpen(o)&&o.email===state.session.email).map(operationPanel).join('')}${notice('Code lasts at most 120 seconds and ends earlier at the original expiry or window end. Checking does not use the voucher.')}${btn('Recover my voucher','recover','','outline full')}</div></article></div>`;}
function voucherFacts(c){return mealSnapshot(c)+facts([['Meal',english(c.meal)],['Original quantity','1 meal'],['Original unit price',money(c.price)],['Original menu version',`v${c.version}`],['Valid until',`${date(c.expires)} · Asia/Shanghai`],['Service hours',`${hours(c)} · Asia/Shanghai`]]);}
const merchantViews=[['overview','Overview'],['meals','Meals'],['verify','Verify & hand over'],['payouts','Payouts']];
function verification(id){const checked=state.coupons.find(c=>c.id===checkedId&&c.store===id),open=state.ops.filter(o=>o.store===id&&o.email===state.session.email&&['lock','report'].includes(o.kind)&&M.isOpen(o));return `<section class="verification-tool">${open.length?'<h2>Continue original operation</h2>'+open.map(operationPanel).join(''):''}<h2>Check a voucher</h2><p class="muted">Checking does not use the voucher or transfer funds.</p><div class="form-field"><label for="token-input">Demo verification code</label><textarea id="token-input" rows="2" placeholder="Paste demo code">${e(verificationInput)}</textarea></div>${errorBox}${btn('Check voucher','check-token',id)}<details><summary>Use a demo voucher · Local scenario</summary><label for="demo-voucher">Original demo voucher</label><select id="demo-voucher"><option value="">Choose a record</option>${state.coupons.filter(c=>c.store===id&&c.email===state.session.email&&c.status==='issued').map(c=>`<option value="${c.id}">${e(english(c.meal))} · ${e(c.id)}</option>`).join('')}</select>${btn('Use demo voucher code','demo-code',id,'outline')}</details>${checked?`<div class="verification-case"><h2>Current voucher</h2><p class="pill">Voucher checked. Not used yet.</p>${voucherFacts(checked)}${btn('Reserve for handover','lock',checked.id)}</div>`:''}${state.coupons.filter(c=>c.store===id&&c.status==='locked').map(c=>`<div class="verification-case"><h2>Current handover · ${e(c.id)}</h2><p class="pill">Processing right confirmed</p>${voucherFacts(c)}<p>Confirm the physical handover. Payout is separate.</p>${btn('Confirm handoff & report','report',c.id,'',state.ops.some(o=>o.coupon===c.id&&M.isOpen(o)))}</div>`).join('')}</section>`;}
function merchantMetrics(id){const t=stats(state,id);return `<section class="metrics-section"><h2>Kitchen at a glance</h2><p class="muted">As of ${date(nowFor(state))} · Asia/Shanghai</p><div class="merchant-metrics">${[['Meals supported',t.F,'Lifetime · max 10'],['Available to claim',t.available,'Current free portions'],['Claimed, awaiting meal',t.R,'Current allocation'],['Awaiting payout',money(t.amounts.H),'Original reported price'],['Received',money(t.amounts.S),'Final simulated payouts']].map(([label,value,scope])=>`<section class="stat"><h3>${label}</h3><strong>${typeof value==='string'?value.replace(' test USDC','<span class="metric-currency"> test USDC</span>'):value}</strong><small>${scope}</small></section>`).join('')}</div></section>`;}
function mealRow(c){const d=c.version?c:c.draft,t=stats(state,c.store,c.id),vouchers=state.coupons.filter(v=>v.mealId===c.id&&['issued','locked'].includes(v.status)).length;return `<article class="meal-row" id="meal-row-${e(c.id)}" tabindex="-1" data-meal-id="${e(c.id)}"><img src="${e(M.imageSrc(d.image))}" width="80" height="64" alt="Illustrative ${e(english(d.meal))}"><div class="meal-row-copy"><h2>${e(english(d.meal))}</h2><p>${e(english(d.description))}</p><p class="meal-price">${c.version?money(c.price)+' · Published v'+c.version:'Draft · Not published'}</p>${c.version?`<p class="muted">Service Time · ${hours(c)} · Asia/Shanghai</p>`:''}<p class="muted">Supported · Lifetime ${t.F} · Available to claim ${t.available}</p><span class="pill">${!c.version?'Draft':c.active?'Listed':'Unlisted'}</span>${c.version&&c.draft?'<small> · Future draft saved</small>':''}${vouchers||t.H||t.pending?`<p class="obligations">Existing vouchers: ${vouchers} · Awaiting payout: ${money(t.amounts.H)} · ${t.pending} unresolved operations <a href="#merchant/verify">View original responsibilities</a></p>`:''}</div><div class="meal-row-actions">${btn('Edit meal','edit-menu',c.id,'outline')}${c.version?btn(c.active?'Unlist meal':'List meal','listing',c.id,'outline'):btn('Review & publish','edit-menu',c.id,'outline')}</div></article>`;}
function focusMeal(id){requestAnimationFrame(()=>{const row=document.getElementById('meal-row-'+id);if(row){row.focus();row.scrollIntoView({block:'nearest',behavior:'instant'});}});}
function merchant(view='overview',requested){const id=M.merchantStore(state);if(!id||requested&&requested!==id){main.innerHTML=`<div class="container page">${pageHead('Kitchen workspace',state.session?'This demo account cannot manage this kitchen.':'Sign in with an invited demo account to manage its kitchen.')}<p>Store access is separate from email sign-in and wallet connection.</p>${btn('Sign in','signin')}<a class="button outline" href="#stores">Return to kitchens</a></div>`;return;}if(!merchantViews.some(([v])=>v===view))view='overview';const store=getStore(id),c=state.configs[id],t=stats(state,id);let content='';
 if(view==='overview')content=`<div class="overview-grid">${verification(id)}${merchantMetrics(id)}</div>${state.ops.filter(o=>o.store===id&&o.email===state.session.email&&M.isOpen(o)&&!['lock','report'].includes(o.kind)).map(operationPanel).join('')}<section class="recent-activity"><h2>Recent activity</h2>${activity(id,3)}</section><details class="safety-details"><summary>${c.paused?'Safety pause is active':'Safety pause · Separate from meal listing'}</summary><p>Original locks, handovers and payouts remain.</p>${btn(c.paused?'Review resume':'Review safety pause','pause',id,'outline')}</details>`;
 if(view==='verify')content=verification(id);
 if(view==='meals'){const meals=M.mealsFor(state,id);content=`<div class="meals-toolbar">${btn('+ Add meal','add-meal',id)}</div><div class="meal-list">${meals.map(mealRow).join('')||empty('No meals yet','Add your first meal.')}</div>${meals.every(m=>!m.version)?notice('Drafts are not visible in Kitchens.'):''}`;}
 if(view==='payouts')content=`<section class="funds-summary"><h2>Kitchen funds</h2>${facts([['Awaiting payout',money(t.amounts.H)],['Received',money(t.amounts.S)],['Recipient',M.ownerWallet(id)]])}<p>Each original meal is paid separately at its original price.</p></section>${state.units.filter(u=>u.store===id&&['H','S'].includes(u.status)).map(u=>{const order=state.orders.find(o=>o.id===u.order);return `<article class="payout-item"><h2>Original meal #${u.id}</h2>${mealSnapshot(order)}${facts([['Meal',english(order.meal)],['Menu version',`v${u.version}`],['Original service hours',hours(order)+' · Asia/Shanghai'],['Original amount',money(u.price)],['Bound recipient',M.ownerWallet(id)],['Status',u.status==='S'?'Payment received · Simulated':'Reported · Awaiting payout']])}${u.status==='H'?btn('Review payout','payout',String(u.id),'',M.reserved(state,u.id)):''}</article>`;}).join('')}${state.ops.filter(o=>o.store===id&&o.email===state.session.email&&o.kind==='payout'&&M.isOpen(o)).map(operationPanel).join('')}`;
 const subtitles={overview:'Check a voucher and hand over a meal.',meals:'Manage this kitchen’s meals.',verify:'Check, reserve and report the original meal.',payouts:'Original meals. Individual payouts.'};
 main.innerHTML=`<div class="merchant-shell"><aside class="merchant-sidebar"><h2>${store.name}</h2><p>Invited demo account · ${c.paused?'Safety pause':'Simulated kitchen'}</p><nav aria-label="Kitchen workspace">${merchantViews.map(([v,label])=>`<a href="#merchant/${v}" aria-label="${label}" ${view===v?'aria-current="page"':''}>${v==='verify'?'Verify':label}</a>`).join('')}</nav><a class="text-button" href="#stores">Return to kitchens</a></aside><section class="merchant-content"><header class="workspace-heading"><h1>${merchantViews.find(([v])=>v===view)[1]}</h1><p>${subtitles[view]}</p></header>${content}</section></div>`;
}
function activity(id,count=12){const events=state.events.filter(v=>!id||v.store===id).slice(0,count);return events.length?events.map(v=>`<div class="activity-row"><small>${date(v.time)}</small><span>${e(v.mealId?english(M.getMeal(state,v.mealId)?.meal??M.getMeal(state,v.mealId)?.draft?.meal):getStore(v.store)?.name??'Legacy kitchen')} · ${/\p{Script=Han}/u.test(v.label)?'Legacy activity · Original record retained':e(v.label)}</span><span>${v.qty} meals</span></div>`).join(''):'<p>No recent activity.</p>';}
function ledger(){const t=stats(state);main.innerHTML=`<div class="container page">${pageHead('Every meal, accounted for','Public meal counts and original-price funds. No email or verification code is shown.','Meal ledger')}<p class="status-line">As of ${date(nowFor(state))} · Asia/Shanghai · Local simulated state</p><div class="ledger-stats">${[['Meals supported',t.F,'Lifetime final support'],['Available to claim',t.available,'Current free portions'],['Claimed, awaiting meal',t.R,'Current allocation'],['Handoffs reported',t.H+t.S,'Final reports · Simulated'],['Awaiting payout',money(t.amounts.H),'Original reported price'],['Received',money(t.amounts.S),'Final simulated payouts']].map(([label,value,scope])=>`<section class="stat"><h2>${label}</h2><strong>${value}</strong><small>${scope}</small></section>`).join('')}</div><div class="ledger-kitchens">${STORES.map(store=>{const x=stats(state,store.id),c=state.configs[store.id];return `<article class="panel"><h2><a href="#store/${store.id}">${store.name}</a></h2>${facts([['Supported',`${x.F} meals · Lifetime`],['Available',`${x.available} meals`],['Claimed',`${x.R} meals`],['Handoffs reported',`${x.H+x.S} meals · Simulated`],['Awaiting payout',money(x.amounts.H)],['Received',money(x.amounts.S)],['Refunded',`${x.X} meals · ${money(x.amounts.X)}`]])}<p class="pill">${c.paused?'Safety pause':M.mealsFor(state,store.id,true).some(m=>m.active)?'Meals listed':'Meals unlisted'} · Balances retained</p><details><summary>Accounting details</summary>${facts(['F','A','R','H','S','X'].map(k=>[k,`${x[k]} meals · ${money(x.amounts[k])}`]))}<p>F = A + R + H + S + X · ${money(x.amounts.F)}</p><p>${x.pending} original operations pending or needing verification</p></details></article>`;}).join('')}</div>${notice('Handoffs reported includes both awaiting payout and received meals; these overlap. Refunds and consumption do not restore the lifetime cap. No on-chain confirmation or real delivery is claimed.')}<section class="activity"><h2>Recent local activity</h2>${activity()}</section></div>`;}
function about(){main.innerHTML=`<div class="container page">${pageHead('About this demo','Three simulated kitchens. Every action is browser-local.')}<div class="about-grid"><section><h2>A small table, shared.</h2><p>Qinghe Kitchen, Shiguang Table and Nuanxiang Bowl are fictional. The original selected Site photography and visual layout are retained; images are illustrative, not delivery evidence.</p></section><section><h2>Clear prototype boundaries.</h2><p>No real email, OTP, wallet, provider, camera, chain, NFT minting, API or database is connected. Fixed .invalid identities and wallets simulate the flow; this is not production authorization.</p></section></div><section class="content-section faq"><h2>How the meal works</h2>${[['Claiming','One meal across all kitchens per built-in demo email every 72 hours, from final issuance. No wallet or personal explanation needed.'],['Expiry and recovery','The voucher retains its original72-hour expiry and service windows. A code lasts at most120 seconds. Recovery revokes the old code and never extends expiry. Used or expired vouchers cannot be reopened.'],['Handover and payout','Checking does not consume. Unique processing rights are reserved before explicit simulated handover reporting. Original owner payout is separately confirmed, one meal at a time.'],['Pending and UNKNOWN','Check the original operation. Resources and responsibilities are retained; no automatic success, replacement payment, timeout unlock or new voucher.'],['Refunds','Only original-payer free, unreserved portions can be refunded. Neither refunds nor consumption reopen the lifetime10-meal capacity.'],['Local records','Valid legacy records are retained without rewriting original terms. Old login/wallet flags and active codes do not grant current authority. Incompatible data is blocked without replacement; explicit demo-only reset is available.'],['Optional thanks','A support order may reserve one optional independent thank-you NFT. The sample is public and not minted. There is no handover NFT. Failure does not undo support.']].map(([q,a])=>`<details><summary>${q}</summary><p>${a}</p></details>`).join('')}</section></div>`;}
function publicCard(){main.innerHTML=`<div class="container page">${pageHead('A note of thanks','Public historical sample · Simulated, not minted.')}<div class="public-card"><h2>Thank you for leaving a meal.</h2><p>A small gesture for someone’s ordinary day.</p><small>No token has been minted. Historical support may later be refunded. This card grants no private order, voucher or refund access.</small></div></div>`;}
function missing(){main.innerHTML=`<div class="container page">${pageHead('Page unavailable','Return to the kitchens to continue.')}<a class="button" href="#stores">Return to kitchens</a></div>`;}
function render(scroll=false){if(LIVE_MODE){renderLive(scroll);return;}if(restoring){main.innerHTML='<div class="container page"><p role="status">Checking saved meal images…</p></div>';return;}if(storageError){main.innerHTML=`<div class="container page">${pageHead('Saved demo data needs attention',storageError)}${btn('Review demo-only reset','reset')}${errorBox}</div>`;return;}const [route,id,requested]=location.hash.slice(1).split('/');document.querySelector('#signin-button').textContent=state.session?(route==='merchant'?'Account':'Demo account'):'Sign in';document.querySelector('#signin-button').setAttribute('aria-label',state.session?'Demo account':'Sign in');document.querySelector('#signout-button').hidden=!state.session;const workspace=document.querySelector('#workspace-link');workspace.hidden=!M.merchantStore(state);workspace.href='#merchant';document.querySelectorAll('[data-nav]').forEach(a=>a.setAttribute('aria-current',a.dataset.nav===route?'page':'false'));if(route==='store')detail(id);else if(route==='mine')mine(id||'coupons');else if(route==='coupon')couponPage(id);else if(route==='merchant')merchant(id||'overview',requested);else if(route==='ledger')ledger();else if(route==='about')about();else if(route==='nft')publicCard();else{home();if(['stores','how'].includes(route))requestAnimationFrame(()=>document.querySelector('#'+route)?.scrollIntoView());}main.insertAdjacentHTML('beforeend',`<p class="error page-error" id="page-error" role="alert"></p><details class="demo-controls container"><summary>Demo controls</summary><label for="next-result">Next original-operation result</label><select id="next-result">${[['final','Final on explicit check'],['pending','Keep pending'],['unknown','UNKNOWN · Needs verification'],['rejected','Request declined']].map(([v,label])=>`<option value="${v}" ${nextResult===v?'selected':''}>${label}</option>`).join('')}</select><div class="order-actions">${btn('Set demo lunch time','demo-clock','','outline')}${btn('Advance 121 seconds','advance','','outline')}${btn('Reset this demo only','reset','','outline')}</div><p>Observed ${date(nowFor(state))} · Asia/Shanghai. Test assets have no real dollar value.</p></details>`);if(scroll&&!['stores','how'].includes(route)){window.scrollTo(0,0);main.focus({preventScroll:true});}}
function chooseClaim(){modal(`<h2 id="dialog-title">Choose a meal</h2><p class="dialog-subtitle">No wallet needed. One meal across all kitchens every 72 hours.</p>${STORES.flatMap(store=>M.mealsFor(state,store.id,true).filter(c=>c.active).map(c=>{const t=stats(state,store.id,c.id);return `<div class="checkout-item"><img src="${e(M.imageSrc(c.image))}" width="75" height="75" alt="Illustrative ${e(english(c.meal))}"><div><h3>${e(english(c.meal))}</h3><p>${store.name} · ${t.available} available · Current menu v${c.version}</p><p>${e(english(c.description))}</p><p>${money(c.price)} · ${hours(c)} · Asia/Shanghai</p>${btn('Claim a meal','claim',c.id,'outline',state.configs[store.id].paused||!t.available)}</div></div>`;})).join('')}`);}
function claimModal(id){const meal=M.getMeal(state,id);if(!meal)throw Error('Selected meal is missing.');if(!requireSignIn(()=>claimModal(meal.id)))return;const preview=M.claimPreview(state,meal.store,meal.id);claimSelection={store:meal.store,mealId:meal.id,unit:preview.unit};modal(`<h2 id="dialog-title">Claim a meal</h2><p class="dialog-subtitle">${getStore(meal.store).name} · Original selected meal</p>${mealSnapshot(preview.terms)}${facts([['Meal',english(preview.terms.meal)],['Original menu version',`v${preview.terms.version}`],['Original unit price',money(preview.terms.price)],['Original service hours',`${hours(preview.terms)} · Asia/Shanghai`],['Demo identity',state.session.email]])}${notice('One meal across all kitchens every 72 hours. Original expiry starts only after issuance is final. No wallet needed.')}${errorBox}${btn('Confirm demo claim','issue',meal.id,'full')}`,'claim');}
function supportModal(id,confirmed=false){const c=M.getMeal(state,id);if(!c||!c.active||!c.version||state.configs[c.store].paused||stats(state,c.store).F>=10)throw Error('This meal is unavailable for new support.');if(checkout&&checkout.mealId!==c.id&&!confirmed){replacement=c.id;modal(`<h2 id="dialog-title">Change selected meal?</h2><p>Your current selection is ${e(english(M.getMeal(state,checkout.mealId).meal))}, ${checkout.qty} meals.</p><p>Replace it with ${e(english(c.meal))}? One order contains one kitchen and one meal.</p><div class="order-actions">${btn('Keep current selection','keep-selection','','outline')}${btn('Replace selection','replace-selection')}</div>`,'selection');return;}if(checkout?.mealId!==c.id)checkout={store:c.store,mealId:c.id,qty:1,nft:true,approval:null,version:c.version,price:c.price};modal(`<h2 id="dialog-title">Support a meal</h2><div class="checkout-item"><img src="${e(M.imageSrc(c.image))}" width="75" height="75" alt="Illustrative ${e(english(c.meal))}"><div><h3>${e(english(c.meal))}</h3><p>${getStore(c.store).name} · v${c.version}</p><p>${e(english(c.description))}</p><p>${hours(c)} · Asia/Shanghai</p></div></div><div class="checkout-row"><span>Meal quantity</span><div class="quantity"><button data-action="qty-minus" aria-label="Decrease quantity">−</button><output>${checkout.qty}</output><button data-action="qty-plus" aria-label="Increase quantity">+</button></div></div><p>${money(c.price)} / meal</p><div class="checkout-row checkout-total"><span>Total</span><strong>${money(c.price*checkout.qty)}</strong></div><label class="checkbox"><input id="nft-opt-in" type="checkbox" ${checkout.nft?'checked':''}><span>Receive one optional thank-you NFT. Simulated, not minted. No extra payment.</span></label>${checkout.version!==c.version||checkout.price!==c.price?notice('The published meal changed. Review the current quote and approve it again.'):''}${errorBox}${btn('Review support','checkout',c.id,'full')}`,'cart');}
function clearIdentityContext(keepCart=false){editorEpoch++;imageRequest++;uploadPending=false;editorImage='';checkout=keepCart&&checkout?{store:checkout.store,mealId:checkout.mealId,qty:checkout.qty,nft:checkout.nft,version:checkout.version,price:checkout.price,approval:null}:null;checkedId='';verificationInput='';claimSelection=null;replacement=null;resume=null;editorInitial='';editorValues=null;nextResult='final';}
function approvalContext(){const email=state.session?.email,payer=email&&M.payerFor(email);if(!checkout||!email||state.wallet?.email!==email||state.wallet.purpose!=='support'||state.wallet.payer!==payer)return null;return {email,payer,store:checkout.store,mealId:checkout.mealId,quantity:checkout.qty,price:checkout.price,version:checkout.version,nft:checkout.nft};}
function hasCheckoutApproval(){const current=approvalContext();return !!(current&&checkout.approval&&Object.entries(current).every(([key,value])=>checkout.approval[key]===value));}
function checkoutModal(){if(!requireSignIn(checkoutModal))return;const c=M.getMeal(state,checkout?.mealId);if(!c?.active||!c.version||state.configs[c.store].paused||stats(state,c.store).F+checkout.qty>10)throw Error('This meal is unavailable for new support. Review another selection.');const changed=c.version!==checkout.version||c.price!==checkout.price;if(changed){checkout.approval=null;checkout.version=c.version;checkout.price=c.price;}const connected=state.wallet?.email===state.session.email&&state.wallet.purpose==='support';modal(`<h2 id="dialog-title">Review support</h2>${mealSnapshot(c)}${changed?notice('The published meal changed. This is the current quote; fresh exact approval is required.'):''}${facts([['Kitchen',getStore(checkout.store).name],['Meal',english(c.meal)],['Current service hours',hours(c)+' · Asia/Shanghai'],['Original menu version',`v${checkout.version}`],['Quantity',`${checkout.qty} meals`],['Exact amount',money(checkout.price*checkout.qty)],['Payer',M.payerFor(state.session.email)],['Assets/network','test USDC · Monad Testnet · Simulated'],['Gas','MON · No real gas charged']])}${notice('Wallet connection, exact approval and payment are separate simulated steps. No wallet extension is accessed.')}${errorBox}${!connected?btn('Connect demo wallet','checkout-wallet','','full'):!hasCheckoutApproval()?btn('Approve exact amount · Demo','approve','','full'):btn('Confirm support · Demo','pay','','full')}`,'checkout');}
function opModal(id){const o=state.ops.find(o=>o.id===id);modal(`<h2 id="dialog-title">Original operation</h2>${operationPanel(o)}${o.status==='final'&&o.kind==='claim'?`<a class="button full" href="#coupon/${o.coupon}" data-action="close">Open my voucher</a>`:''}${o.status==='final'&&o.kind==='support'?'<a class="button full" href="#mine/orders" data-action="close">View support orders</a>':''}${errorBox}`,'operation');}
function showCredential(id){const c=state.coupons.find(c=>c.id===id);mutate(s=>M.credential(s,s.coupons.find(c=>c.id===id),nowFor(s)));const current=state.coupons.find(c=>c.id===id);modal(`<h2 id="dialog-title">Show this kitchen your code</h2><p>${getStore(c.store).name} · ${e(english(c.meal))}</p><div class="qr-wrap"><div id="qr-code" aria-label="Demo-only verification QR code"></div><p class="code-string">${e(current.token)}</p><p id="credential-countdown"></p></div>${btn('Copy demo code','copy-token',id,'outline full')}${notice('This demo code is valid for at most120 seconds, bounded by original expiry and service hours. No camera required.')}${errorBox}`,'credential');new window.QRCode(document.querySelector('#qr-code'),{text:current.token,width:210,height:210,colorDark:'#234c3d',colorLight:'#ffffff',correctLevel:window.QRCode.CorrectLevel.M});tickCode();}
function tickCode(){if(dialogKind!=='credential')return;const c=state.coupons.find(c=>c.token&&document.querySelector('.code-string')?.textContent===c.token);if(!c||c.tokenExpires<=nowFor(state)){const qr=document.querySelector('.qr-wrap');if(qr)qr.innerHTML='<p role="alert">Code expired. Close this dialog and refresh the code within service hours.</p>';document.querySelector('[data-action="copy-token"]')?.remove();return;}document.querySelector('#credential-countdown').textContent=`Code active · ${Math.ceil((c.tokenExpires-nowFor(state))/1000)} seconds remaining`;}
function timeOptions(selected,end=false){return halfHourOptions(selected,end);}
function timeControl(icon,label,action,id='',disabled=false){const tip='time-tip-'+action+(id!==''?'-'+id:'');return `<button type="button" class="time-control" data-action="${action}" data-id="${e(id)}" aria-label="${e(label)}" aria-describedby="${tip}" ${disabled?'disabled':''}><span class="time-icon" aria-hidden="true">${icon}</span></button>`;}
function timeRows(windows){return windows.map(([start,end],i)=>`<div class="service-time-row" data-time-row="${i}"><div><label for="time-start-${i}">Start time</label><select id="time-start-${i}" aria-label="Start time ${i+1}" aria-describedby="time-error-${i}">${timeOptions(start)}</select></div><div><label for="time-end-${i}">End time</label><select id="time-end-${i}" aria-label="End time ${i+1}" aria-describedby="time-error-${i}">${timeOptions(end,true)}</select></div>${timeControl('−','Remove time '+(i+1),'remove-time',String(i),windows.length===1)}<p class="field-error time-error" id="time-error-${i}" role="alert"></p></div>`).join('');}
function readWindows(){return [...body.querySelectorAll('[data-time-row]')].map((row,i)=>[document.querySelector('#time-start-'+i).value,document.querySelector('#time-end-'+i).value].map(v=>v===''?NaN:Number(v)));}
function renderTimeRows(windows){document.querySelector('#time-rows').innerHTML=timeRows(windows);document.querySelector('[data-action="add-time"]').disabled=windows.length>=2;}
function previewEditorImage(){const image=document.querySelector('#image-preview');image.hidden=!editorImage;if(editorImage)image.src=M.imageSrc(editorImage);}
function editModal(id,values=null,creating=false){const c=creating?null:M.getMeal(state,id),store=creating?id:c?.store;if(!store)throw Error('Original meal is missing.');M.authorize(state,store);const d=values??c?.draft??c??{meal:'',description:'',price:'',image:'',windows:[[690,810]]};editorValues={store,id:c?.id??null,creating,...d};editorImage=d.image;const field=(key,label,input)=>`<div class="form-field"><label for="menu-${key}">${label}</label>${input}<p class="field-error" data-field-error="${key}" id="error-${key}"></p></div>`;modal(`<h2 id="dialog-title">${creating?'Create a meal':'Edit '+e(english(d.meal))}</h2><p class="dialog-subtitle">${c?.version?'Published v'+c.version+'. Future changes retain all old terms.':'Drafts are not visible in Kitchens.'}</p>${field('name','Meal name',`<input id="menu-name" maxlength="80" aria-describedby="error-name" value="${e(english(d.meal))}">`)}${field('content','Description / content',`<textarea id="menu-content" maxlength="500" aria-describedby="error-content">${e(english(d.description))}</textarea>`)}<section class="form-field image-editor" aria-labelledby="image-heading"><h3 id="image-heading">Meal image</h3>${btn('Upload image','upload-image','','outline')}<input id="image-file" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload meal image" hidden><p class="form-help">Local preview. Saved only in this browser. PNG, JPEG or WebP, up to 4 MiB, 4096px per side and 8 megapixels. Resized to at most 768px per side (normalized JPEG ≤192 KiB).</p><img id="image-preview" class="editor-image" width="240" height="160" alt="Current meal image preview" ${editorImage?'src="'+e(M.imageSrc(editorImage))+'"':'hidden'}><p id="image-status" role="status">Current image</p><label for="menu-image">Bundled images</label><select id="menu-image" aria-describedby="error-image"><option value="">Choose a bundled image</option>${STORES.map(st=>`<option value="${st.image}" ${st.image===d.image?'selected':''}>${st.meal}</option>`).join('')}</select><p class="field-error" data-field-error="image" id="error-image" role="alert"></p></section>${field('price','Future unit price · test USDC',`<input id="menu-price" type="number" min="1" max="100" step="0.01" aria-describedby="error-price" value="${e(d.price)}">`)}<section class="form-field"><div class="time-heading"><h3>Service Time</h3>${timeControl('+','Add service time','add-time','',d.windows.length>=2)}</div><p id="time-help" class="form-help">Up to two same-day, non-overlapping times · Asia/Shanghai. Choose hourly or half-hourly slots; end time may be 24:00. Saved non-half-hour times stay unchanged; reselect a 30-minute slot before saving.</p><div id="time-rows">${timeRows(d.windows)}</div><p class="field-error" data-field-error="windows" id="error-windows"></p><div class="time-hints"><span class="time-tooltip hint-add" id="time-tip-add-time" role="tooltip">Add a service time · Maximum two.</span><span class="time-tooltip hint-remove-0" id="time-tip-remove-time-0" role="tooltip">Remove this time · Keep at least one.</span><span class="time-tooltip hint-remove-1" id="time-tip-remove-time-1" role="tooltip">Remove this time · Keep at least one.</span></div></section>${errorBox}<div class="order-actions">${btn('Save draft','save-draft',id,'outline')}${btn('Review & publish','publish-review',id)}</div>`,'edit');editorInitial=JSON.stringify(readEditor());}
function readEditor(){return {meal:document.querySelector('#menu-name')?.value??'',description:document.querySelector('#menu-content')?.value??'',price:Number(document.querySelector('#menu-price')?.value),image:editorImage,windows:readWindows()};}
function validateEditor(d){const errors=M.draftErrors(d);if(d.windows.some(([start,end])=>start%30!==0||end%30!==0))errors.windows='Choose 30-minute slots before saving; original saved times have not been rounded.';const map={meal:'name',description:'content',price:'price',image:'image',windows:'windows'};for(const [key,field]of Object.entries(map)){document.querySelector('[data-field-error="'+field+'"]').textContent=key==='windows'&&errors.windows?'Review the highlighted service times.':errors[key]??'';document.querySelector('#menu-'+field)?.setAttribute('aria-invalid',errors[key]?'true':'false');}d.windows.forEach(([start,end],i)=>{const invalid=!Number.isInteger(start)||!Number.isInteger(end)||start<0||start>=end||end>1440||start%30!==0||end%30!==0||i>0&&d.windows[i-1][1]>start;document.querySelector('#time-error-'+i).textContent=invalid?'Choose 30-minute slots with a start before the end, without overlapping the previous row.':'';for(const type of ['start','end'])document.querySelector('#time-'+type+'-'+i).setAttribute('aria-invalid',invalid?'true':'false');});if(Object.keys(errors).length)throw Error('Review the highlighted fields before saving.');}
async function uploadImage(file){if(dialogKind!=='edit'||!dialog.open||M.merchantStore(state)!==editorValues?.store)return;const epoch=editorEpoch,request=++imageRequest,email=state.session?.email;uploadPending=true;document.querySelector('#image-status').textContent='Processing image…';document.querySelector('#error-image').textContent='';try{const normalized=await normalizeUpload(file);if(epoch!==editorEpoch||request!==imageRequest||dialogKind!=='edit'||!dialog.open||state.session?.email!==email)return;editorImage=normalized;previewEditorImage();document.querySelector('#menu-image').value='';document.querySelector('#image-status').textContent='Unsaved preview · Ready to save.';}catch(err){if(epoch===editorEpoch&&request===imageRequest&&dialogKind==='edit'&&dialog.open){document.querySelector('#error-image').textContent=err.message;document.querySelector('#image-status').textContent='Image unchanged.';}}finally{if(epoch===editorEpoch&&request===imageRequest){uploadPending=false;document.querySelector('#image-file').value='';}}}
function storeEditorDraft(){if(uploadPending)throw Error('Wait for image processing before saving.');const d=readEditor();validateEditor(d);let id=editorValues.id;if(!id)mutate(s=>{id=M.createMeal(s,editorValues.store,d).id;});else mutate(s=>M.saveDraft(s,id,d));editorValues={...editorValues,...d,id,creating:false};return id;}
const editorDirty=()=>JSON.stringify(readEditor())!==editorInitial;
function discardEditor(){editorValues={...editorValues,...readEditor()};modal(`<h2 id="dialog-title">Discard unsaved changes?</h2><p>Your published meals and any saved draft remain unchanged.</p><div class="order-actions">${btn('Keep editing','keep-editing','','outline')}${btn('Discard changes','discard-edit')}</div>`,'discard');}
function paymentReview(kind,id){if(kind==='payout'){const u=state.units.find(u=>u.id===Number(id));M.authorize(state,u.store);modal(`<h2 id="dialog-title">Review payout</h2>${facts([['Kitchen',getStore(u.store).name],['Original meal',`#${u.id} · v${u.version}`],['Original amount',money(u.price)],['Bound recipient',M.ownerWallet(u.store)],['Asset','test USDC · Simulated'],['Gas','No real gas charged']])}${notice('This is one original reported meal. Only final simulated payout changes Received.')}${errorBox}${state.wallet?.purpose==='payout'&&state.wallet.store===u.store?btn('Confirm simulated payout','payout-confirm',id,'full'):btn('Connect demo wallet','payout-wallet',id,'full')}`,'payout');}else{const o=state.orders.find(o=>o.id===id);if(o.email!==state.session?.email)throw Error('Only the original demo account can review this refund.');const units=state.units.filter(u=>u.order===id&&u.status==='A'&&!M.reserved(state,u.id));modal(`<h2 id="dialog-title">Review safe refund</h2>${facts([['Original order',o.id],['Original payer',o.owner],['Safe free portions',`${units.length} meals`],['Exact original amount',money(units.reduce((n,u)=>n+u.price,0))]])}${notice('Allocated, locked, reported and reserved portions cannot be refunded. Lifetime capacity is not restored.')}${errorBox}${state.wallet?.purpose==='refund'&&state.wallet.payer===o.owner?btn('Confirm demo refund','refund-confirm',id,'full'):btn('Connect demo wallet','refund-wallet',id,'full')}`,'refund');}}
document.addEventListener('click',async event=>{if(LIVE_MODE)return;const el=event.target.closest('[data-action]');if(!el||el.disabled)return;const action=el.dataset.action,id=el.dataset.id;try{if(restoring)throw Error('Wait for saved images to finish checking.');requireCurrentSnapshot();
 if(storageError&&!['reset','reset-confirm','close'].includes(action))throw Error(storageError);
 if(action==='signin'){resume=null;signInModal();}
 else if(action==='signin-confirm'){const email=document.querySelector('#demo-email').value;mutate(s=>M.signIn(s,email),true);const next=resume;clearIdentityContext(true);close(true);body.innerHTML='';render();if(next)next();toast('Signed in · Prototype identity only.');}
 else if(action==='signout'){mutate(s=>M.signOut(s));clearIdentityContext();close(true);body.innerHTML='';location.hash='home';render(true);toast('Signed out. Active codes revoked; original records and responsibilities retained.');}
 else if(action==='close')close();
 else if(action==='filter'){filter=id;render();document.querySelector('#stores').scrollIntoView();}
 else if(action==='support')supportModal(id);
 else if(action==='keep-selection'){replacement=null;supportModal(checkout.mealId,true);}
 else if(action==='replace-selection'){const target=replacement;replacement=null;supportModal(target,true);}
 else if(action==='qty-minus'||action==='qty-plus'){checkout.qty=Math.max(1,Math.min(10-stats(state,checkout.store).F,checkout.qty+(action==='qty-plus'?1:-1)));checkout.approval=null;supportModal(checkout.mealId);}
 else if(action==='checkout'){checkout.nft=!!document.querySelector('#nft-opt-in')?.checked;checkoutModal();}
 else if(action==='checkout-wallet'){mutate(s=>M.connectWallet(s,'support'));checkoutModal();}
 else if(action==='approve'){const c=M.getMeal(state,checkout.mealId);if(c.version!==checkout.version||c.price!==checkout.price)throw Error('Menu changed. Review and approve the new terms first.');const approval=approvalContext();if(!approval)throw Error('Connect this account’s support wallet before approving.');checkout.approval=approval;checkoutModal();}
 else if(action==='pay'){if(!hasCheckoutApproval())throw Error('Approve the exact original amount first.');const c=M.getMeal(state,checkout.mealId);if(c.version!==checkout.version||c.price!==checkout.price)throw Error('Menu changed. Review and approve the new terms first.');let op;mutate(s=>{op=M.support(s,checkout.store,checkout.qty,checkout.nft,nowFor(s),checkout.mealId);});checkout.approval=null;render();opModal(op.id);}
 else if(action==='choose-claim')chooseClaim();
 else if(action==='claim')claimModal(id);
 else if(action==='issue'){let op;mutate(s=>{op=M.claim(s,claimSelection.store,nowFor(s),claimSelection.mealId,claimSelection.unit);});render();opModal(op.id);}
 else if(action==='resolve'){mutate(s=>M.resolve(s,id,nextResult,nowFor(s)));render();if(dialog.open)opModal(id);}
 else if(action==='restore-wallet'){const o=state.ops.find(o=>o.id===id);mutate(s=>M.connectWallet(s,{support:'support',refund:'refund',payout:'payout'}[o.kind],o.kind==='payout'?o.store:null));render();if(dialog.open)opModal(id);}
 else if(action==='recover'){if(!requireSignIn(()=>document.querySelector('[data-action="recover"]')?.click()))return;let coupon;mutate(s=>{coupon=M.recover(s,nowFor(s));});close(true);location.hash='coupon/'+coupon.id;render(true);toast('Original voucher recovered. Old code revoked; original expiry unchanged.');}
 else if(action==='credential')showCredential(id);
 else if(action==='copy-token'){const c=state.coupons.find(c=>c.id===id);if(!c?.token||c.tokenExpires<=nowFor(state))throw Error('Code expired. Refresh during original service hours.');await navigator.clipboard.writeText(c.token);toast('Demo code copied.');}
 else if(action==='demo-code'){const id=document.querySelector('#demo-voucher').value;if(!id)throw Error('Choose your original demo voucher.');mutate(s=>M.credential(s,s.coupons.find(c=>c.id===id),nowFor(s)));verificationInput=state.coupons.find(c=>c.id===id).token;document.querySelector('#token-input').value=verificationInput;toast('Demo code loaded. Check it before reserving the processing right.');}
 else if(action==='check-token'){const c=M.checkToken(state,id,document.querySelector('#token-input').value.trim(),nowFor(state));checkedId=c.id;render();}
 else if(action==='lock'){const c=state.coupons.find(c=>c.id===id);let op;mutate(s=>{op=M.lock(s,c.store,c.token,nowFor(s));});checkedId='';verificationInput='';render();opModal(op.id);}
 else if(action==='report'){const c=state.coupons.find(c=>c.id===id);M.authorize(state,c.store);modal(`<h2 id="dialog-title">Confirm handoff & report</h2>${voucherFacts(c)}<p>Confirm only after physically handing over this simulated meal. Report and payout are separate.</p><label class="checkbox"><input type="checkbox" id="handoff-confirm"><span>I confirm the simulated physical handover has happened.</span></label>${errorBox}${btn('Confirm simulated handoff & report','report-confirm',id,'full')}`,'report');}
 else if(action==='report-confirm'){if(!document.querySelector('#handoff-confirm').checked)throw Error('Confirm the simulated physical handover first.');let op;mutate(s=>{op=M.report(s,s.coupons.find(c=>c.id===id),nowFor(s),true);});render();opModal(op.id);}
 else if(action==='payout'||action==='refund')paymentReview(action,id);
 else if(action==='payout-wallet'){const u=state.units.find(u=>u.id===Number(id));mutate(s=>M.connectWallet(s,'payout',u.store));paymentReview('payout',id);}
 else if(action==='refund-wallet'){mutate(s=>M.connectWallet(s,'refund'));paymentReview('refund',id);}
 else if(action==='payout-confirm'){const u=state.units.find(u=>u.id===Number(id));let op;mutate(s=>{op=M.settle(s,u.store,u.id,nowFor(s));});render();opModal(op.id);}
 else if(action==='refund-confirm'){let op;mutate(s=>{op=M.refund(s,id,nowFor(s));});render();opModal(op.id);}
 else if(action==='upload-image')document.querySelector('#image-file').click();
 else if(action==='add-time'){const windows=readWindows();if(windows.length>=2)throw Error('Only two service times are supported.');windows.push(windows[0].every(Number.isInteger)&&windows[0][0]>=0&&windows[0][0]<windows[0][1]&&windows[0][1]<=1020?[1020,1200]:[null,null]);renderTimeRows(windows);}
 else if(action==='remove-time'){const windows=readWindows();if(windows.length>1){windows.splice(Number(id),1);renderTimeRows(windows);}}
 else if(action==='add-meal')editModal(id,null,true);
 else if(action==='edit-menu')editModal(id);
 else if(action==='save-draft'){const creating=!editorValues.id,mealId=storeEditorDraft();close(true);render();focusMeal(mealId);toast(creating?'Meal draft created.':'Draft saved. Published menu unchanged.');}
 else if(action==='publish-review'){const mealId=storeEditorDraft(),c=M.getMeal(state,mealId),d=c.draft;modal(`<h2 id="dialog-title">${c.version?'Publish new version?':'Publish and list meal?'}</h2><img class="publish-image" src="${e(M.imageSrc(d.image))}" width="80" height="64" alt="Illustrative ${e(d.meal)}">${facts([['Meal',d.meal],['Content',d.description],['Current published version',c.version?`v${c.version} · ${money(c.price)}`:'Not published'],['Future version',`v${c.version+1} · ${money(d.price)}`],['Service windows',hours(d)+' · Asia/Shanghai']])}${notice('Existing orders and vouchers keep their original name, content, price and service windows.')}${errorBox}<div class="order-actions">${btn('Keep editing','keep-editing','','outline')}${btn(c.version?'Publish new version':'Publish & list meal','publish-confirm',mealId)}</div>`,'publish');}
 else if(action==='publish-confirm'){const first=!M.getMeal(state,id).version;mutate(s=>M.publish(s,id));close(true);render();focusMeal(id);toast(first?'Meal published.':'New version published. All old terms retained.');}
 else if(action==='keep-editing'){const wasDirty=dialogKind==='discard',initial=editorInitial;editModal(editorValues.id??editorValues.store,editorValues,editorValues.creating);if(wasDirty)editorInitial=initial;}
 else if(action==='discard-edit'){const mealId=editorValues?.id;close(true);render();if(mealId)focusMeal(mealId);else requestAnimationFrame(()=>document.querySelector('[data-action="add-meal"]')?.focus());}
 else if(action==='listing'||action==='pause'){const c=action==='listing'?M.getMeal(state,id):state.configs[id];M.authorize(state,action==='listing'?c.store:id);modal(`<h2 id="dialog-title">${action==='listing'?(c.active?'Unlist meal?':'List meal?'):(c.paused?'Resume new handovers?':'Safety pause?')}</h2><p>${action==='listing'?'Stop or resume new support and claims for this meal. Existing vouchers and payouts remain.':'Safety pause is separate from meal listing. Original responsibilities remain.'}</p>${errorBox}<div class="order-actions">${btn('Cancel','close','','outline')}${btn(action==='listing'?(c.active?'Unlist meal':'List meal'):(c.paused?'Confirm resume':'Confirm safety pause'),action+'-confirm',id)}</div>`);}
 else if(action==='listing-confirm'){mutate(s=>M.setListing(s,id,!M.getMeal(s,id).active));close(true);render();toast('Listing updated. Original obligations retained.');}
 else if(action==='pause-confirm'){mutate(s=>M.setPause(s,id,!s.configs[id].paused));close(true);render();toast('Safety state updated. Original responsibilities retained.');}
 else if(action==='stop-nft'||action==='fail-nft'){mutate(s=>{const o=s.orders.find(o=>o.id===id);if(o.email!==s.session?.email)throw Error('Sign in with the original support account.');o.nft=action==='fail-nft'?'failed':false;});render();}
 else if(action==='demo-clock'){mutate(s=>{const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());s.clockOffset=Date.parse(day+'T12:00:00+08:00')-Date.now();M.expire(s,nowFor(s));});render();toast('Demo clock set to lunch time. Original voucher expiry is unchanged.');}
 else if(action==='advance'){mutate(s=>{s.clockOffset+=121000;M.expire(s,nowFor(s));});tickCode();if(!dialog.open)render();}
 else if(action==='reset')modal(`<h2 id="dialog-title">Reset this demo only?</h2><p>Clear this browser's prototype records and restore the built-in fixture. This explicitly removes original UNKNOWN operations.</p><div class="order-actions">${btn('Keep demo data','close','','outline')}${btn('Confirm demo-only reset','reset-confirm')}</div>`,'reset');
 else if(action==='reset-confirm'){if(!dialog.open||dialogKind!=='reset'||el!==resetConfirmButton||!body.contains(el))throw Error('Open the demo reset review and use its confirmation button.');const next=M.initialState(),raw=JSON.stringify(next);requireCurrentSnapshot();localStorage.setItem(M.KEY,raw);savedRaw=raw;state=next;storageError='';externalAuthorityLost=false;clearIdentityContext();close(true);location.hash='home';render(true);}
 }catch(err){error(err.message);}});
document.addEventListener('input',event=>{if(event.target.id==='token-input')verificationInput=event.target.value;});
document.addEventListener('change',event=>{if(event.target===document.querySelector('#image-file')&&dialogKind==='edit'&&dialog.open&&event.target.files[0])uploadImage(event.target.files[0]);if(event.target.id==='menu-image'){imageRequest++;uploadPending=false;editorImage=event.target.value;previewEditorImage();document.querySelector('#image-status').textContent='Unsaved preview · Bundled image.';}if(event.target.id==='next-result')nextResult=event.target.value;if(event.target.id==='demo-voucher'){checkedId='';verificationInput='';document.querySelector('#token-input').value='';}});
dialog.addEventListener('cancel',event=>{if(LIVE_MODE&&live.mealPublish){event.preventDefault();closeMealPublish();return;}if(LIVE_MODE&&live.settlement){event.preventDefault();closeSettlementFlow();return;}if(LIVE_MODE&&live.verification){event.preventDefault();closeVerificationEntry();return;}if(LIVE_MODE&&live.claim){event.preventDefault();closeClaimFlow();return;}if(LIVE_MODE&&live.support){event.preventDefault();closeSupportFlow();return;}if(LIVE_MODE&&live.walletChooser){event.preventDefault();closeWalletChooser();return;}if(LIVE_MODE&&(live.mealEditor||live.mealListing)){event.preventDefault();closeLiveMealEditor();return;}if(dialogKind==='edit'&&editorDirty()){event.preventDefault();discardEditor();}else{editorEpoch++;imageRequest++;uploadPending=false;dialogKind='';resetConfirmButton=null;requestAnimationFrame(()=>dialogTrigger?.isConnected?dialogTrigger.focus():main.focus());}});
const publicDemoBar=document.querySelector('.demo-bar').innerHTML;
function syncRouteChrome(){if(LIVE_MODE){document.body.classList.toggle('merchant-route',location.hash.startsWith('#merchant'));return;}const merchant=location.hash.slice(1).split('/')[0]==='merchant';document.body.classList.toggle('merchant-route',merchant);document.querySelector('.demo-bar').innerHTML=merchant?'Demo · Simulated kitchens, payments and handovers':publicDemoBar;}
window.addEventListener('storage',event=>{if(LIVE_MODE)return;if(event.storageArea!==localStorage||event.key!==M.KEY&&event.key!==null)return;try{if(localStorage.getItem(M.KEY)!==savedRaw)restoreSaved(true);}catch{restoreSaved(true);}});
window.addEventListener('hashchange',()=>{if(LIVE_MODE){closeMealPublish();closeSettlementFlow();closeVerificationEntry();closeClaimFlow();closeSupportFlow();closeWalletChooser();closeLiveMealEditor(true);}syncRouteChrome();if(dialog.open)close(true);render(true);if(LIVE_MODE&&location.hash==='#contributions')loadSupportOrders();if(LIVE_MODE&&location.hash==='#mine')loadClaimRecords();if(LIVE_MODE&&location.hash==='#merchant/payouts')loadPayouts();if(LIVE_MODE&&location.hash.startsWith('#verify?')){const input=takeVerificationLink();openVerificationEntry(input);}});
document.querySelector('.skip').addEventListener('click',event=>{event.preventDefault();main.focus();main.scrollIntoView();});
setInterval(()=>{if(LIVE_MODE)return;if(storageError||restoring||externalAuthorityLost)return;const now=nowFor(state);if(state.coupons.some(c=>c.token&&c.tokenExpires<=now||c.status==='issued'&&c.expires<=now&&!state.ops.some(o=>M.isOpen(o)&&o.coupon===c.id))){try{mutate(s=>M.expire(s,now));}catch(err){error(err.message);}}tickCode();},1000);
syncRouteChrome();
render();
if(LIVE_MODE)startLive();else restoreSaved();

function liveMessage(err){if(err?.code==='FINALIZED_FACTS_STALE')return 'Payment data needs updating (FINALIZED_FACTS_STALE). Wait for the service to recover, then check the original contribution. Payment is not confirmed.';if(err?.code==='WALLET_UNAVAILABLE')return 'No wallet extension is available in this browser. Open this page in a browser with your wallet extension installed and enabled, then try Sign in with wallet again.';return err?.message||'The service is unavailable. Check the connection and continue your original registration.';}
function canEnterKitchen(){return hasOwnedKitchen(live.context)&&(!live.context.registration||live.context.registration.state==='CONFIRMED'&&(live.context.registration.listingConfirmed===true||live.context.registration.businessReady===true));}
function readLiveDraft(){
 const form=document.querySelector('#registration-form');if(!form)return;
 const data=new FormData(form);for(const key of ['storeName','mealName','description','price']){const input=form.elements.namedItem(key);if(input)live.draft[key]=input.value;}
 live.draft.windows=live.draft.windows.map((_,i)=>[form.elements.namedItem('start-'+i)?.value??'',form.elements.namedItem('end-'+i)?.value??'']);
 const photo=data.get('photo');if(photo?.size)live.draft.photo=photo;
}
function renderLive(scroll=false){
 startSettlementClock();
 const [route,id]=location.hash.slice(1).split('/'),ctx=live.context,session=ctx.session,workspace=document.querySelector('#workspace-link');
 document.body.classList.toggle('merchant-route',route==='merchant');
 document.querySelector('#signin-button').textContent=session?'Wallet account':'Sign in with wallet';
 document.querySelector('#signin-button').setAttribute('aria-label',session?'Wallet account':'Sign in with wallet');
 document.querySelector('#signin-button').disabled=live.busy;
 document.querySelector('#signout-button').hidden=!session;document.querySelector('#signout-button').disabled=live.busy;
 workspace.hidden=false;workspace.href=canEnterKitchen()?'#merchant/overview':'#register';workspace.textContent=canEnterKitchen()?'My kitchen':ctx.registration?'Continue registration':'Open a kitchen';
 document.querySelectorAll('[data-nav]').forEach(a=>a.setAttribute('aria-current',a.dataset.nav===route?'page':'false'));
 if(route==='register')main.innerHTML=renderRegistration({context:ctx,busy:live.busy||live.loading,blocked:live.blocked,error:live.error,signed:live.signed,draft:live.draft,errors:live.errors,preview:live.preview});
 else if(route==='merchant')main.innerHTML=renderLiveKitchen({context:ctx,view:id,meals:live.ownerMealStoreId===ctx.store?.id?live.ownerMeals:[],overview:live.ownerMealStoreId===ctx.store?.id?live.overview:null,error:live.error||live.catalogError,busy:live.busy,capabilities:live.mealCapabilities,unavailableReasons:live.mealUnavailableReasons,payouts:live.payoutStoreId===ctx.store?.id?live.payouts:null,payoutsLoading:live.payoutsLoading});
 else if(route==='store')main.innerHTML=renderLiveStore(live.stores.find(s=>String(s.id)===id),live.meals[id]??[],ctx.setup);
 else if(route==='contributions')main.innerHTML=renderContributions({session:ctx.session,orders:live.supportOrders,loading:live.supportOrdersLoading,error:live.error,setup:ctx.setup});
 else if(route==='mine')main.innerHTML=renderMyMeals({session:ctx.session,vouchers:live.vouchers,intents:live.claimIntents,loading:live.claimRecordsLoading,error:live.error,pending:ctx.session?(live.claimPending?.wallet===ctx.session.wallet?live.claimPending:readClaimRecovery(ctx.session.wallet)):null});
 else if(route.startsWith('verify'))main.innerHTML='<div class="container page"><h1>Kitchen verification</h1><p>Open the kitchen workspace to scan or paste a fresh voucher code. Reading a code does not confirm meal handover.</p><a class="button" href="#merchant/overview">Kitchen workspace</a></div>';
 else if(['coupon','ledger','nft'].includes(route))main.innerHTML=`<div class="container page">${pageHead(route==='ledger'?'Meal ledger':'Your meal records','This feature is not connected in the current registration release.')}<a class="button outline" href="#stores">Return to kitchens</a></div>`;
 else if(route==='about')main.innerHTML=`<div class="container page">${pageHead('About MealForward','A warm meal. A kinder day.')}<section class="panel"><h2>Open your kitchen</h2><p>Wallet sign-in, kitchen registration and first-meal publication use the connected service. A saved draft, a confirmed contract and a published meal are separate steps.</p><p>You can review and support the original public meal. Claim a public meal and follow its original progress in My meals. Kitchen owners check and confirm handover in their workspace. Settlement availability follows the connected service.</p><p>Monad Testnet · Test assets have no real dollar value.</p><a class="button" href="#register">Open a kitchen</a></section></div>`;
 else {home();
  const strip=main.querySelector('.summary-strip');strip.innerHTML=`<div class="summary-intro">A small meal. Shared with care.</div><div class="summary-item"><strong>${live.loading?'…':live.catalogError?'—':live.stores.length}</strong><small>Registered<br>kitchens</small></div><div class="summary-item"><small>Monad Testnet<br>Connected records</small></div><div class="summary-item"><a href="#register">Open your kitchen →</a></div>`;
  main.querySelector('.hero-ctas').innerHTML='<a class="button" href="#stores">Explore kitchens</a><a class="button outline" href="#register">Open a kitchen</a>';
  main.querySelector('.hero-note').textContent='A first meal, shared with care · Monad Testnet';main.querySelector('.filters')?.remove();
  main.querySelector('#stores .section-head p').textContent='Kitchens and meals from the connected service.';
  main.querySelector('.store-grid').innerHTML=live.loading?'<p role="status">Loading kitchens…</p>':renderLiveCards(live.stores,live.meals,ctx.setup)||(live.catalogError?'<p>No verified kitchen data is available.</p>':'<p>No kitchens are listed yet.</p>');
  main.querySelector('.section-foot').textContent=live.catalogError||'Open a kitchen to support its public meal. Test assets have no real dollar value.';
  main.querySelector('.how-intro p').textContent='Open your kitchen and follow each step of its first meal publication.';
  main.querySelector('.how-steps').innerHTML=[['01','Save your first meal','Sign in with your wallet and save your kitchen and first meal.'],['02','Authorize your kitchen','Review the saved details, sign the authorization and explicitly enable automatic deployment.'],['03','Follow the original progress','Wait for the contract and first-meal publication to be confirmed. Refreshing continues the same registration.']].map(([n,title,text])=>`<div><div class="step-number">${n}</div><h3>${title}</h3><p>${text}</p></div>`).join('');
  main.querySelector('.ledger-teaser p').textContent='A saved draft, a confirmed contract and a published first meal.';main.querySelector('.ledger-teaser a').href='#register';main.querySelector('.ledger-teaser a').textContent='Open a kitchen';
  if(['stores','how'].includes(route)&&scroll)requestAnimationFrame(()=>main.querySelector('#'+route)?.scrollIntoView());
 }
 if(session)main.insertAdjacentHTML('afterbegin',`<div class="container"><button class="text-button" id="switch-wallet-button" data-live-action="switch-wallet" ${live.busy?'disabled':''}>Switch wallet / Sign in again</button></div>`);
 if(route!=='register'&&live.error)main.insertAdjacentHTML('beforeend',`<p class="error page-error" role="alert">${e(live.error)}</p>`);
 if(live.blocked)main.insertAdjacentHTML('beforeend','<div class="container live-connection"><p class="notice">Connection unavailable. Previously loaded records may be out of date. New registration and authorization actions are paused.</p><button class="button outline" data-live-action="recover">Check connection & recover</button></div>');
 if(scroll&&!['stores','how'].includes(route)){window.scrollTo(0,0);main.focus({preventScroll:true});}
}
function checkLiveGeneration(generation){if(generation!==live.generation)throw Object.assign(Error('The wallet session changed.'),{code:'STALE_UI_SESSION'});}
function isLiveAuthRejection(error){return error?.status===401||error?.status===403||['OWNER_BINDING_CHANGED','OWNER_ACCESS_REQUIRED','PAYER_BINDING_CHANGED','REAUTH_REQUIRED','UNAUTHENTICATED'].includes(error?.code);}
async function currentLiveResult(promise,generation){const result=await promise;checkLiveGeneration(generation);return result;}
function showLiveError(){if(live.error){const feedback=main.querySelector('#live-error, .page-error, [role="alert"]');if(feedback){feedback.setAttribute('tabindex','-1');feedback.focus({preventScroll:true});feedback.scrollIntoView({block:'center',behavior:'instant'});}}}
function clearLiveIdentity(message=''){
 live.api?.invalidateSession?.();
 live.generation++;if(live.mealPublish)closeMealPublish();live.mealPublishPending={};if(live.settlementClock)stopSettlementClock();if(live.settlement)closeSettlementFlow();live.payouts=null;live.payoutStoreId=null;live.payoutsLoading=false;live.settlementAttempts={};live.settlementPending={};if(live.verification)closeVerificationEntry();if(live.claim)closeClaimFlow();live.vouchers=[];live.claimIntents=[];live.claimRecordsLoading=false;live.claimPending=null;closeSupportFlow();live.supportOrders=[];live.supportOrdersLoading=false;live.supportAttempts={};closeWalletChooser(false);closeLiveMealEditor(true);live.ownerMeals=[];live.ownerMealStoreId=null;live.mealCapabilities={};live.mealUnavailableReasons={};live.context={setup:live.context.setup,session:null,store:null,registration:null,registrations:[]};live.overview=null;live.signed=false;live.draft={windows:[['','']]};live.errors={};
 if(live.preview)URL.revokeObjectURL(live.preview);live.preview='';live.error=message;live.busy=false;live.loading=false;live.blocked=false;live.reloginRequired=true;renderLive();showLiveError();
}
window.addEventListener('mealforward-session-invalidated',()=>{if(LIVE_MODE)clearLiveIdentity('Wallet changed. Sign in again with the newly selected wallet.');});
function acceptContext(ctx){live.context=live.reloginRequired?{setup:ctx.setup,session:null,store:null,registration:null,registrations:[]}:ctx;live.blocked=false;live.signed=false;if(!live.reloginRequired)live.error='';}
async function loadLiveContext(generation=live.generation){const ctx=await currentLiveResult(live.api.getContext(),generation);acceptContext(ctx);return ctx;}
async function loadLiveCatalog(generation=live.generation){
 const response=await currentLiveResult(live.api.listStores(),generation),stores=Array.isArray(response)?response:response.items??[];
 const results=await currentLiveResult(Promise.allSettled(stores.map(store=>live.api.getStoreMeals(store.id))),generation);
 live.stores=stores;results.forEach((result,i)=>{if(result.status==='fulfilled')live.meals[stores[i].id]=Array.isArray(result.value)?result.value:result.value.items??[];});
 live.catalogError=results.some(r=>r.status==='rejected')?'Some menus could not be refreshed. Previously loaded meals may be out of date.':'';
}
function requireLiveOwner(storeId=live.context.store?.id){if(!hasOwnedKitchen(live.context)||storeId!==live.context.store.id)throw Error('This wallet has no permission to manage this kitchen.');}
async function loadLiveKitchen(generation=live.generation){
 if(!hasOwnedKitchen(live.context)){live.ownerMeals=[];live.overview=null;live.mealCapabilities={};live.mealUnavailableReasons={};return;}
 const id=live.context.store.id;requireLiveOwner(id);if(live.ownerMealStoreId!==id){live.ownerMealStoreId=id;live.ownerMeals=[];live.overview=null;live.mealCapabilities={};live.mealUnavailableReasons={};}
 const results=await currentLiveResult(Promise.allSettled([live.api.getOwnerMeals(id),live.api.getOwnerOverview(id)]),generation);
 const denied=results.find(result=>result.status==='rejected'&&isLiveAuthRejection(result.reason));
 if(denied){clearLiveIdentity(liveMessage(denied.reason));throw denied.reason;}
 requireLiveOwner(id);
 if(results[0].status==='fulfilled'){const data=results[0].value;live.ownerMeals=Array.isArray(data.items)?data.items:[];live.mealCapabilities=data.capabilities??{};live.mealUnavailableReasons=data.unavailableReasons??{};}else{live.mealCapabilities={};live.mealUnavailableReasons={edit:'The owner menu could not be refreshed. Check the connection before continuing.'};}
 if(results[1].status==='fulfilled')live.overview=results[1].value;
 if(results.some(r=>r.status==='rejected')){live.mealCapabilities={};live.mealUnavailableReasons=Object.fromEntries(['create','edit','upload','publish','listing'].map(key=>[key,'The owner records could not be refreshed. Check the connection before making changes.']));throw Error('Some kitchen records could not be refreshed. Previously loaded records may be out of date.');}
}
async function liveTask(fn){
 if(live.busy)return;const generation=live.generation;readLiveDraft();live.busy=true;live.error='';renderLive();
 try{if(!live.api){const adapter=await currentLiveResult(import('./live-api.mjs'),generation);live.api=adapter.liveApi;live.parseVoucherCode=adapter.parseVoucherCode;}await fn(generation);checkLiveGeneration(generation);}
 catch(err){if(generation!==live.generation)return;live.error=liveMessage(err);if(isLiveAuthRejection(err)){clearLiveIdentity(live.error);live.blocked=true;}}
 finally{if(generation===live.generation){live.busy=false;live.loading=false;renderLive();showLiveError();}}
}
async function selectRegistration(id,generation=live.generation){
 const known=live.context.registrations?.find(item=>item.registrationId===id),fresh=await currentLiveResult(live.api.getRegistration(id),generation);if(live.reloginRequired)return;
 live.context.registration={...known,...fresh,request:fresh.request??known?.request};live.signed=false;live.context.store=null;live.overview=null;
 if(fresh.state==='CONFIRMED'&&(fresh.listingConfirmed===true||fresh.businessReady===true||known?.listingConfirmed===true)){await loadLiveCatalog(generation);checkLiveGeneration(generation);live.context.store=live.stores.find(store=>store.id===fresh.storeId?.replace(/^0x/,''))??null;if(live.context.store)await loadLiveKitchen(generation);}
}
async function refreshRegistration(generation=live.generation){
 const r=live.context.registration;if(!r||live.reloginRequired)return;const fresh=await currentLiveResult(live.api.getRegistration(r.registrationId),generation);
 live.context.registration={...r,...fresh,request:fresh.request??r.request};const index=live.context.registrations?.findIndex(item=>item.registrationId===fresh.registrationId);if(index>=0)live.context.registrations[index]=fresh;
 if(fresh.state!=='DRAFT')live.signed=false;
 if(fresh.state==='CONFIRMED'){await loadLiveContext(generation);checkLiveGeneration(generation);const listed=live.context.registrations?.find(item=>item.registrationId===r.registrationId)??(live.context.registration?.registrationId===r.registrationId?live.context.registration:{});live.context.registration={...r,...fresh,...listed,request:listed.request??fresh.request??r.request};await loadLiveCatalog(generation);checkLiveGeneration(generation);live.context.store=live.stores.find(store=>store.id===fresh.storeId?.replace(/^0x/,''))??live.context.store;await loadLiveKitchen(generation);}
}
async function startLive(){
 const verificationLink=takeVerificationLink();
 document.querySelector('.my-link').href='#contributions';document.querySelector('.my-link').textContent='My contributions';if(!document.querySelector('#live-my-meals-link'))document.querySelector('.my-link').insertAdjacentHTML('afterend','<a class="my-link" id="live-my-meals-link" href="#mine">My meals</a>');
 document.querySelector('#signin-button').removeAttribute('data-action');document.querySelector('#signin-button').dataset.liveAction='account';
 document.querySelector('#signout-button').removeAttribute('data-action');document.querySelector('#signout-button').dataset.liveAction='logout';
 const generation=live.generation;
 try{const adapter=await currentLiveResult(import('./live-api.mjs'),generation);live.api=adapter.liveApi;live.parseVoucherCode=adapter.parseVoucherCode;}catch{if(generation!==live.generation)return;live.error='The connection adapter is unavailable.';live.loading=false;renderLive();return;}
 await liveTask(async generation=>{const results=await currentLiveResult(Promise.allSettled([loadLiveContext(generation),loadLiveCatalog(generation)]),generation);if(results[0].status==='rejected'){live.blocked=true;live.error=liveMessage(results[0].reason);}if(results[1].status==='rejected')live.catalogError=liveMessage(results[1].reason);if(live.context.store)await loadLiveKitchen(generation);});if(location.hash==='#contributions')await loadSupportOrders();if(location.hash==='#mine')await loadClaimRecords();if(location.hash==='#merchant/payouts')await loadPayouts();if(verificationLink)openVerificationEntry(verificationLink);
}
document.addEventListener('click',event=>{
 if(!LIVE_MODE)return;const target=event.target.closest('[data-live-action]');if(!target||target.disabled)return;
 let action=target.dataset.liveAction;if(['account','switch-wallet'].includes(action))action='login';
 if(action.startsWith('meal-publish'))return handleMealPublishAction(action,target);
 if(action.startsWith('settlement-'))return handleSettlementAction(action,target);
 if(live.settlement&&['verification-open','claim-start','support-start'].includes(action))closeSettlementFlow();
 if(action.startsWith('verification-'))return handleVerificationEntry(action,target);
 if(action.startsWith('claim-')){if(live.verification)closeVerificationEntry();return handleClaimAction(action,target);}
 if(action.startsWith('support-')){if(live.verification)closeVerificationEntry();if(live.claim)closeClaimFlow();return handleSupportAction(action,target);}
 if(action==='wallet-close'){closeWalletChooser();return;}
 if(action==='wallet-connect')return loadWalletChoices(true);
 if(action==='wallet-confirm')return confirmWalletChoice();
 if(live.busy)return;
 if(action.startsWith('meal-')){const generation=live.generation;try{return Promise.resolve(handleLiveMealAction(action,target)).catch(err=>{if(generation===live.generation){live.error=liveMessage(err);renderLive();showLiveError();}});}catch(err){live.error=liveMessage(err);renderLive();showLiveError();return;}}
 if(action==='login')return openWalletChooser();
 if(action==='add-time'||action.startsWith('remove-time-')){readLiveDraft();if(action==='add-time'&&live.draft.windows.length<2)live.draft.windows.push(['','']);else if(action.startsWith('remove-time-')&&live.draft.windows.length>1)live.draft.windows.splice(Number(action.split('-').at(-1)),1);renderLive();return;}
 return liveTask(async generation=>{
  if(action==='recover'){try{await loadLiveContext(generation);await loadLiveCatalog(generation);if(live.context.store)await loadLiveKitchen(generation);}catch(err){checkLiveGeneration(generation);live.blocked=true;throw err;}}
  else if(action==='logout'){await currentLiveResult(live.api.logout(),generation);clearLiveIdentity();location.hash='#register';}
  else if(action==='sign'){if(live.blocked||live.context.registration?.state!=='DRAFT')throw Error('Check the original registration before signing.');const result=await currentLiveResult(live.api.signRegistration(live.context.registration),generation);live.signed=result.signed===true&&result.registrationId===live.context.registration.registrationId;}
  else if(action==='enable'){if(live.blocked||!live.signed||live.context.registration?.state!=='DRAFT')throw Error('Sign the original authorization first.');live.signed=false;try{const original=live.context.registration;const result=await currentLiveResult(live.api.enableRegistration(original.registrationId),generation);live.context.registration={...original,...result,request:result.request??original.request};}catch(err){checkLiveGeneration(generation);live.blocked=true;throw err;}}
  else if(action==='refresh'){await refreshRegistration(generation);}
  else if(action==='refresh-kitchen'){await loadLiveContext(generation);await loadLiveKitchen(generation);}
 });
});
document.addEventListener('submit',event=>{
 if(!LIVE_MODE||!['registration-form','registration-recovery'].includes(event.target.id))return;event.preventDefault();if(live.busy)return;
 if(event.target.id==='registration-recovery'){const id=new FormData(event.target).get('registrationId').trim();liveTask(generation=>selectRegistration(id,generation));return;}
 readLiveDraft();const input={...live.draft,windows:live.draft.windows.map(row=>row.map(value=>typeof value==='number'?value:/^\d\d:\d\d$/.test(value)?Number(value.slice(0,2))*60+Number(value.slice(3)):NaN))};
 live.errors=validateDraft(input,live.context.setup?.assetDecimals??6);if(Object.keys(live.errors).length){renderLive();main.querySelector('[aria-invalid="true"],#error-photo:not(:empty),#error-windows:not(:empty)')?.scrollIntoView({block:'center'});return;}
 liveTask(async generation=>{if(live.blocked||live.context.registration||!live.context.session||live.context.setup?.registrationEnabled!==true)throw Error('Check the connection and recover your original registration before saving.');try{const registration=await currentLiveResult(live.api.saveRegistration(input),generation);live.context.registration=registration;live.context.registrations=[...(live.context.registrations??[]),registration];live.signed=false;}catch(err){checkLiveGeneration(generation);live.blocked=true;throw err;}});
});
document.addEventListener('input',event=>{if(!LIVE_MODE)return;if(event.target.closest('#registration-form'))readLiveDraft();if(event.target.closest('#live-meal-form'))readLiveMealEditor();});
document.addEventListener('change',event=>{
 if(!LIVE_MODE)return;
 if(event.target.id==='support-quantity'&&supportCurrent(live.support)&&!live.support.review&&!live.support.intent){live.support.quantity=Number(event.target.value);showSupportFlow();return;}
 if(event.target.id==='wallet-choice'&&walletChoiceCurrent(live.walletChooser)){live.walletChooser.selected=event.target.value;const confirm=body.querySelector('[data-live-action="wallet-confirm"]');if(confirm)confirm.disabled=!live.walletChooser.accounts.includes(event.target.value);return;}
 if(event.target.closest('#live-meal-form'))readLiveMealEditor();
 if(event.target.id==='live-meal-image'&&event.target.files[0]){uploadLiveMealPreview(event.target.files[0]);return;}
 if(event.target.id==='register-photo'){readLiveDraft();if(live.preview)URL.revokeObjectURL(live.preview);const file=event.target.files[0];live.draft.photo=file;live.preview=file&&['image/jpeg','image/png','image/webp'].includes(file.type)&&file.size<=5*1024*1024?URL.createObjectURL(file):'';renderLive();}
 if(event.target.id==='original-registration'&&event.target.value){const id=event.target.value;liveTask(generation=>selectRegistration(id,generation));}
});
async function pollLiveRegistration(){
 if(!LIVE_MODE||document.hidden||location.hash.split('/')[0]!=='#register'||!live.context.registration||live.busy||live.blocked||live.reloginRequired)return;
 const generation=live.generation,before=JSON.stringify(live.context);live.busy=true;let changed=false;
 try{await refreshRegistration(generation);checkLiveGeneration(generation);changed=before!==JSON.stringify(live.context)||!!live.error;live.error='';}
 catch(err){if(generation!==live.generation)return;const message=liveMessage(err);changed=message!==live.error;live.error=message;if(isLiveAuthRejection(err)){clearLiveIdentity(message);live.blocked=true;}}
 finally{if(generation===live.generation){live.busy=false;if(changed)renderLive();}}
}
setInterval(pollLiveRegistration,5000);

function liveMealReason(capability){return live.mealUnavailableReasons[capability]||`Meal ${capability} is not connected in this run. No changes will be sent.`;}
function liveMealPreview(meal){const path=meal.imageUrl??meal.imageRef;return typeof path==='string'&&/^\/(?!\/)/.test(path)?path:/^0x[0-9a-f]{64}$/.test(meal.imageDigest??'')?'/v1/registered-store-images/'+meal.imageDigest:/^[0-9a-f]{64}$/.test(meal.imageDigest??'')?'/v1/images/'+meal.imageDigest:'';}
function mealEditorCurrent(editor){return !!editor&&live.mealEditor===editor&&editor.generation===live.generation&&hasOwnedKitchen(live.context)&&editor.storeId===live.context.store.id;}
function updateLiveMealCapabilities(editor){
 const action=editor.creating?'create':'edit',revision=Number.isSafeInteger(editor.revision)&&editor.revision>=0;
 editor.canSave=live.mealCapabilities[action]===true&&revision&&!editor.loading;
 editor.canUpload=live.mealCapabilities.upload===true&&revision&&editor.saved===true;
 editor.canPublish=live.mealCapabilities.publish===true&&editor.saved===true&&revision&&!editor.loading&&!editor.imageFailed;
 editor.reason=[!editor.canSave?liveMealReason(action):'Save draft stores a private draft only. Your public menu stays unchanged.',live.mealCapabilities.upload!==true?liveMealReason('upload'):'A selected image is uploaded after the text draft is saved.',liveMealReason('publish')].join(' ');
}
function applyLiveMealDraft(editor,dto,{keepPhoto=false}={}){
 if(!Number.isSafeInteger(dto?.revision)||dto.revision<0||dto.id!==editor.mealId)throw Error('The draft response could not be verified. Reopen the original draft.');
 const draft=dto.draft??{};editor.revision=dto.revision;editor.saved=dto.saved===true;
 editor.values={...editor.values,name:draft.name??editor.values.name,description:draft.description??editor.values.description,price:draft.price??(draft.unitPrice!=null?priceLabel(draft.unitPrice,live.context.setup?.assetDecimals??6,'').trim():editor.values.price),windows:structuredClone(draft.windows??editor.values.windows),preview:keepPhoto&&editor.values.photo?editor.values.preview:liveMealPreview(draft)||editor.values.preview,photo:keepPhoto?editor.values.photo:null};
 updateLiveMealCapabilities(editor);
}
async function openLiveMealEditor(mealId=null){
 requireLiveOwner();closeLiveMealEditor(true);
 const creating=mealId===null,meal=creating?null:live.ownerMeals.find(item=>item.id===mealId);if(!creating&&!meal)throw Error('The original meal is no longer available. Refresh your kitchen.');
 const draft=meal?.draft??meal,values={name:draft?.name??'',description:draft?.description??'',price:draft?.price??(draft?.unitPrice!=null?priceLabel(draft.unitPrice,live.context.setup?.assetDecimals??6,'').trim():''),windows:structuredClone(draft?.windows??[[null,null]]),preview:draft?liveMealPreview(draft):'',photo:null};
 const editor={generation:live.generation,storeId:live.context.store.id,mealId:meal?.draftId??mealId??crypto.randomUUID().toLowerCase(),revision:null,creating,values,initial:JSON.stringify(values),errors:{},uploading:false,uploadRequest:0,loading:true,saving:false,canSave:false,canPublish:false,status:'Loading the original private draft…'};live.mealEditor=editor;updateLiveMealCapabilities(editor);renderLiveMealDialog();
 try{const dto=await live.api.getMealDraft(editor.storeId,editor.mealId);if(!mealEditorCurrent(editor))return;applyLiveMealDraft(editor,dto);editor.initial=JSON.stringify(editor.values);editor.status=editor.saved?'Private draft loaded. Published menu unchanged.':'New private draft · Not saved yet.';}
 catch(err){if(!mealEditorCurrent(editor))return;if(isLiveAuthRejection(err)){clearLiveIdentity(liveMessage(err));return;}editor.error=liveMessage(err);editor.status='The private draft could not be loaded. Saving remains unavailable.';}
 finally{if(mealEditorCurrent(editor)){editor.loading=false;updateLiveMealCapabilities(editor);renderLiveMealDialog();}}
}
function readLiveMealEditor(){
 const editor=live.mealEditor;if(!mealEditorCurrent(editor)||!body.querySelector('#live-meal-form'))return;
 for(const key of ['name','description','price']){const input=body.querySelector('#live-meal-'+key);if(input)editor.values[key]=input.value;}
 editor.values.windows=editor.values.windows.map((row,i)=>['start','end'].map((part,j)=>{const input=body.querySelector('#live-meal-'+part+'-'+i);return input?input.value===''?null:Number(input.value):row[j];}));
}
function renderLiveMealDialog(){
 const editor=live.mealEditor;if(!mealEditorCurrent(editor))return;
 if(editor.confirmDiscard){modal(`<h2 id="dialog-title">Discard unsaved meal changes?</h2><p>${editor.saving?'A save request is still in progress. Closing does not cancel it. Keep this draft reference and reopen it to check the result: '+e(editor.mealId):'Your public menu has not changed. Unsaved changes will be discarded.'}</p><div class="order-actions"><button class="button outline" data-live-action="meal-keep-editing">Keep editing</button><button class="button" data-live-action="meal-discard">${editor.saving?'Close and check later':'Discard changes'}</button></div>`,'live-meal-editor');return;}
 modal(renderLiveMealEditor(editor,live.context.setup),'live-meal-editor');
}
function closeLiveMealEditor(force=false){
 const editor=live.mealEditor;if(!editor&&!live.mealListing)return;
 if(!force&&editor&&mealEditorCurrent(editor)){readLiveMealEditor();if(editor.uploading||editor.saving||JSON.stringify(editor.values)!==editor.initial){editor.confirmDiscard=true;renderLiveMealDialog();return;}}
 if(editor)editor.uploadRequest++;live.mealEditor=null;live.mealListing=null;close(true);body.innerHTML='';
}
async function uploadLiveMealPreview(file){
 const editor=live.mealEditor;if(!mealEditorCurrent(editor))return;readLiveMealEditor();const request=++editor.uploadRequest;editor.uploading=true;editor.errors.image='';renderLiveMealDialog();
 try{const preview=await normalizeUpload(file);if(!mealEditorCurrent(editor)||request!==editor.uploadRequest||!dialog.open)return;editor.values.preview=preview;editor.values.photo=file;}
 catch(err){if(!mealEditorCurrent(editor)||request!==editor.uploadRequest)return;editor.errors.image=liveMessage(err);}
 finally{if(mealEditorCurrent(editor)&&request===editor.uploadRequest){editor.uploading=false;renderLiveMealDialog();}}
}
function handleLiveMealAction(action,target){
 if(action==='meal-close'){closeLiveMealEditor();return;}
 if(action==='meal-discard'){closeLiveMealEditor(true);return;}
 requireLiveOwner();
 if(action==='meal-add')return openLiveMealEditor();
 if(action==='meal-edit')return openLiveMealEditor(target.dataset.mealId);
 if(action==='meal-listing'){
  const meal=live.ownerMeals.find(item=>item.id===target.dataset.mealId);if(!meal)throw Error('Refresh your kitchen before changing this meal.');
  closeLiveMealEditor(true);live.mealListing={generation:live.generation,storeId:live.context.store.id,mealId:meal.id};
  modal(`<h2 id="dialog-title">${meal.listed?'Unlist meal?':'List meal?'}</h2><p>${e(meal.name)}</p><p>Stop or resume new support and claims for this meal. Existing vouchers and payouts remain.</p><p class="notice">${e(liveMealReason('listing'))}</p><div class="order-actions"><button class="button outline" data-live-action="meal-close">Cancel</button><button class="button" disabled>${meal.listed?'Unlist meal':'List meal'}</button></div>`,'live-meal-listing');return;
 }
 const editor=live.mealEditor;if(!mealEditorCurrent(editor))throw Error('Reopen the meal with the current owner wallet.');
 if(action==='meal-keep-editing'){editor.confirmDiscard=false;renderLiveMealDialog();return;}
 if(editor.saving||editor.loading)return;
 if(action==='meal-image'){body.querySelector('#live-meal-image').click();return;}
 if(action==='meal-add-time'||action==='meal-remove-time'){readLiveMealEditor();if(action==='meal-add-time'&&editor.values.windows.length<2)editor.values.windows.push([null,null]);if(action==='meal-remove-time'&&editor.values.windows.length>1)editor.values.windows.splice(Number(target.dataset.timeIndex),1);renderLiveMealDialog();return;}
 if(action==='meal-save')return saveLiveMealDraft();
 if(action==='meal-retry-image')return saveLiveMealDraft(true);
 if(action==='meal-publish'){editor.error=liveMealReason('publish');renderLiveMealDialog();}
}
document.querySelector('.dialog-close').addEventListener('click',()=>{if(LIVE_MODE){if(live.mealPublish)closeMealPublish();else if(live.settlement)closeSettlementFlow();else if(live.verification)closeVerificationEntry();else if(live.claim)closeClaimFlow();else if(live.support)closeSupportFlow();else if(live.walletChooser)closeWalletChooser();else closeLiveMealEditor();}});
document.addEventListener('submit',event=>{if(LIVE_MODE&&event.target.id==='live-meal-form'){event.preventDefault();saveLiveMealDraft();}});

function liveMealValidation(values){
 const errors={};if(!values.name.trim()||values.name.trim().length>80)errors.name='Enter a meal name up to 80 characters.';if(!values.description.trim()||values.description.trim().length>500)errors.description='Enter a description up to 500 characters.';
 const decimals=live.context.setup?.assetDecimals??6;if(!/^\d+(\.\d+)?$/.test(values.price)||!/[1-9]/.test(values.price)||(values.price.split('.')[1]??'').length>decimals)errors.price=`Enter a positive price with up to ${decimals} decimal places.`;
 const windows=values.windows;if(!windows.length||windows.length>2||windows.some(([a,b])=>!Number.isInteger(a)||!Number.isInteger(b)||a<0||a>=b||b>1440||a%30!==0||b%30!==0)||windows.length===2&&windows[0][1]>windows[1][0])errors.windows='Choose 30-minute slots in start-time order, without overlaps and with each end after its start. Saved non-half-hour times must be reselected before saving.';
 return errors;
}
async function saveLiveMealDraft(imageOnly=false){
 const editor=live.mealEditor;if(!mealEditorCurrent(editor)||editor.saving||editor.loading||editor.uploading)return;
 readLiveMealEditor();updateLiveMealCapabilities(editor);
 if(imageOnly?!editor.canUpload:!editor.canSave){editor.error=liveMealReason(imageOnly?'upload':editor.creating?'create':'edit');renderLiveMealDialog();return;}
 if(!imageOnly){editor.errors=liveMealValidation(editor.values);if(Object.keys(editor.errors).length){renderLiveMealDialog();return;}}
 const snapshot={...editor.values,windows:structuredClone(editor.values.windows)};editor.saving=true;editor.error='';editor.imageFailed=false;let textSaved=imageOnly,complete=false;
 editor.status=imageOnly?'Uploading the selected image…':'Saving the private text draft…';renderLiveMealDialog();
 try{
  if(!imageOnly){const dto=await live.api.saveMealDraft(editor.storeId,editor.mealId,{name:snapshot.name,description:snapshot.description,price:snapshot.price,windows:snapshot.windows,expectedRevision:editor.revision});if(!mealEditorCurrent(editor))return;applyLiveMealDraft(editor,dto,{keepPhoto:true});textSaved=true;editor.creating=false;editor.initial=JSON.stringify({...editor.values,photo:null});editor.status='Private text draft saved. Published menu unchanged.';}
  if(snapshot.photo){
   if(live.mealCapabilities.upload!==true)throw Error(liveMealReason('upload'));
   editor.status='Private text draft saved. Uploading the selected image…';renderLiveMealDialog();
   const dto=await live.api.uploadMealImage(editor.storeId,editor.mealId,snapshot.photo,{expectedRevision:editor.revision});if(!mealEditorCurrent(editor))return;applyLiveMealDraft(editor,dto);editor.imageFailed=false;
  }
  if(!mealEditorCurrent(editor))return;editor.status=snapshot.photo?'Private text and image draft saved. Published menu unchanged.':'Private text draft saved. Published menu unchanged.';editor.initial=JSON.stringify(editor.values);complete=true;
 }
 catch(err){if(!mealEditorCurrent(editor))return;if(isLiveAuthRejection(err)){clearLiveIdentity(liveMessage(err));return;}editor.error=liveMessage(err);editor.imageFailed=textSaved&&!!snapshot.photo;editor.status=textSaved?'Private text draft is saved. The selected image has not been confirmed saved. Retry the image upload.':'Saving was not confirmed. Keep this draft reference and retry the same draft. The public menu has not changed.';}
 finally{
  if(mealEditorCurrent(editor)){
   if(textSaved){try{await loadLiveKitchen(editor.generation);}catch(err){if(mealEditorCurrent(editor)){if(complete)editor.status+=' The menu could not be refreshed; reopen this original draft to check it.';}}}
   if(mealEditorCurrent(editor)){editor.saving=false;updateLiveMealCapabilities(editor);renderLive();renderLiveMealDialog();}
  }
 }
}

function walletChoiceCurrent(choice){return !!choice&&live.walletChooser===choice&&choice.generation===live.generation;}
function closeWalletChooser(cancelLogin=true){if(!live.walletChooser)return;const signing=live.walletChooser.signing;live.walletChooser=null;close(true);body.innerHTML='';if(signing&&cancelLogin)clearLiveIdentity('Wallet sign-in was cancelled. Choose an account and sign in again.');}
function showWalletChooser(){if(!walletChoiceCurrent(live.walletChooser))return;modal(renderWalletChooser(live.walletChooser),'live-wallet-choice');}
async function openWalletChooser(){
 const websiteAccount=live.context.session?.wallet??null;clearLiveIdentity();
 live.walletChooser={generation:live.generation,websiteAccount,accounts:[],selected:'',loading:false,signing:false,error:''};showWalletChooser();await loadWalletChoices(false);
}
async function loadWalletChoices(requestPermissions=false){
 const choice=live.walletChooser;if(!walletChoiceCurrent(choice)||choice.loading||choice.signing)return;choice.loading=true;choice.selected='';choice.error='';showWalletChooser();
 try{if(!live.api)live.api=(await currentLiveResult(import('./live-api.mjs'),choice.generation)).liveApi;const accounts=await live.api.getWalletAccounts({requestPermissions});if(!walletChoiceCurrent(choice))return;choice.accounts=Array.isArray(accounts)?accounts.filter(address=>/^0x[0-9a-f]{40}$/.test(address)):[];}
 catch(err){if(walletChoiceCurrent(choice)){choice.accounts=[];choice.error=liveMessage(err);}}
 finally{if(walletChoiceCurrent(choice)){choice.loading=false;showWalletChooser();}}
}
async function confirmWalletChoice(){
 const choice=live.walletChooser;if(!walletChoiceCurrent(choice)||choice.loading||choice.signing||!choice.accounts.includes(choice.selected))return;
 const address=choice.selected,generation=choice.generation;choice.signing=true;choice.error='';showWalletChooser();
 try{
  const result=await live.api.loginWallet({address});if(!walletChoiceCurrent(choice))return;
  if(result?.session?.wallet!==address)throw Error('The signed-in website account does not match the selected wallet. Sign in again.');
  const context=await live.api.getContext();if(!walletChoiceCurrent(choice))return;
  if(context?.session?.wallet!==address)throw Error('The website session changed. Sign in again with the selected wallet.');
  live.reloginRequired=false;acceptContext(context);
  if(canEnterKitchen()){await loadLiveKitchen(generation);if(!walletChoiceCurrent(choice))return;location.hash='#merchant/overview';}else location.hash='#stores';
  choice.signing=false;closeWalletChooser();renderLive(true);
 }
 catch(err){if(walletChoiceCurrent(choice)){live.reloginRequired=true;live.context={setup:live.context.setup,session:null,store:null,registration:null,registrations:[]};live.overview=null;live.ownerMeals=[];live.mealCapabilities={};choice.error=liveMessage(err);}}
 finally{if(walletChoiceCurrent(choice)){choice.signing=false;showWalletChooser();}}
}

function supportCurrent(flow){return !!flow&&live.support===flow&&flow.generation===live.generation&&live.context.session?.wallet===flow.wallet;}
function closeSupportFlow(){if(!live.support)return;live.support=null;close(true);body.innerHTML='';}
function supportReviewTarget(flow){
 const ref=value=>typeof value==='string'?value.toLowerCase().replace(/^0x/,''):'';
 const storeId=ref(flow.store?.id??flow.intent?.store??flow.intent?.storeId),mealId=ref(flow.meal?.id??flow.intent?.mealId??flow.intent?.meal);
 const store=live.stores.find(item=>ref(item.id)===storeId),meal=live.meals[store?.id]?.find(item=>ref(item.id)===mealId&&item.listed===true&&item.eligible!==false);
 return store&&meal?{store,meal}:null;
}
function syncSupportQuote(flow){
 if(supportState(flow.intent)==='FINAL_SUCCEEDED'){flow.quoteExpired=false;flow.quoteClock=null;}
 if(flow.quoteClock&&flow.quoteClock.deadline<=flow.quoteClock.serverNow+Math.max(0,Date.now()-flow.quoteClock.receivedAt)/1000)flow.quoteExpired=true;
 if(flow.quoteExpired){flow.preparation=null;flow.status='This quote has expired; do not approve or pay it.';}
 flow.canReviewAgain=!!flow.quoteExpired&&!!supportReviewTarget(flow);
}
function showSupportFlow(){if(supportCurrent(live.support)){syncSupportQuote(live.support);modal(renderSupportFlow(live.support,live.context.setup),'live-support');}}
function newSupportFlow(){return {generation:live.generation,wallet:live.context.session.wallet,quantity:1,review:null,intent:null,preparation:null,busy:false,error:'',status:'',attempted:{},knownHashes:{},confirmAttempted:false};}
async function supportTask(fn){
 const flow=live.support;if(!supportCurrent(flow)||flow.busy)return;flow.busy=true;flow.error='';showSupportFlow();
 try{await fn(flow);}catch(err){if(supportCurrent(flow)){if(isLiveAuthRejection(err)){clearLiveIdentity(liveMessage(err));return;}flow.error=liveMessage(err);}}
 finally{if(supportCurrent(flow)){flow.busy=false;showSupportFlow();}}
}
async function refreshSupport(flow){
 const id=flow.intent?.intentId??flow.intent?.id;if(!id)throw Error('Recover the original contribution from My contributions.');
 const intent=await live.api.getSupportIntent(id);if(!supportCurrent(flow))return;flow.intent=intent;flow.attempted=live.supportAttempts[id]??{};flow.preparation=null;
 if(supportState(intent)==='FINAL_SUCCEEDED'){await loadLiveCatalog(flow.generation);if(!supportCurrent(flow))return;flow.catalogRefreshed=true;flow.status='Support confirmed.';renderLive();return;}
 try{const preparation=await live.api.getSupportWalletPreparation(id);if(!supportCurrent(flow))return;flow.preparation=preparation;const deadline=Number(preparation.material?.signedQuote?.quote?.deadline),serverNow=Number(preparation.now);flow.quoteClock=Number.isFinite(deadline)&&deadline>0&&Number.isFinite(serverNow)&&serverNow>0?{deadline,serverNow,receivedAt:Date.now()}:null;flow.quoteExpired=false;syncSupportQuote(flow);if(flow.quoteExpired)return;flow.status='Review each available wallet step. Approval and payment are separate actions.';}
 catch(err){if(!supportCurrent(flow))return;if(err.code==='QUOTE_EXPIRED'){flow.quoteExpired=true;syncSupportQuote(flow);return;}if(err.code==='ORIGINAL_QUOTE_PENDING'){flow.status='The original payment quote is being prepared. Check this contribution again.';return;}throw err;}
}
async function loadSupportOrders(){
 if(!live.context.session){live.supportOrders=[];renderLive();return;}if(live.supportOrdersLoading)return;
 const generation=live.generation;live.supportOrdersLoading=true;live.error='';renderLive();
 try{const orders=await currentLiveResult(live.api.getSupportOrders(),generation);live.supportOrders=Array.isArray(orders)?orders:orders.items??[];}
 catch(err){if(generation!==live.generation)return;if(isLiveAuthRejection(err)){clearLiveIdentity(liveMessage(err));return;}live.error=liveMessage(err);}
 finally{if(generation===live.generation){live.supportOrdersLoading=false;renderLive();}}
}
async function sendOriginalSupportStep(flow,kind){
 const id=flow.intent?.intentId??flow.intent?.id,step=flow.preparation?.actions?.find(item=>item.kind===kind);
 if(flow.quoteExpired||!id||!['approve','fund'].includes(kind)||step?.allowed!==true||flow.attempted[kind]||live.supportAttempts[id]?.[kind]||supportState(flow.intent)==='FINAL_SUCCEEDED')throw Error('This wallet step is not available. Check the original contribution.');
 if(step.account?.toLowerCase()!==flow.wallet)throw Error('The wallet step does not match the signed-in account.');
 live.supportAttempts[id]??={};live.supportAttempts[id][kind]=true;flow.attempted=live.supportAttempts[id];flow.preparation=null;
 flow.status='Check your wallet. This original step will not be sent again automatically.';
 let walletStepReturned=false;
 try{
  const sent=await live.api.sendSupportTransaction(id,kind);walletStepReturned=true;
  if(!supportCurrent(flow))return;
  if(sent.transactionHash){flow.knownHashes[kind]=sent.transactionHash;flow.lastHash=sent.transactionHash;}
  await refreshSupport(flow);
 }catch(err){
  if(!supportCurrent(flow))return;
  if(!walletStepReturned&&err?.walletStepNotStarted===true){
   delete live.supportAttempts[id][kind];delete flow.attempted[kind];
   flow.status='Wallet request was not started. Resolve the preparation error and check original progress.';
  }else{
   if(/^0x[0-9a-fA-F]{64}$/.test(err.transactionHash??'')){flow.knownHashes[kind]=err.transactionHash;flow.lastHash=err.transactionHash;}
   flow.status='The original wallet step is pending or uncertain. Check its progress; do not send it again.';
  }
  throw err;
 }
}
async function continueOriginalSupport(flow){
 // One business confirmation may involve TWO distinct wallet transactions.
 // Never move from allowance to fund until the backend verifies the original allowance receipt.
 if(!flow.intent){
  if(!flow.review||flow.confirmAttempted)return;
  flow.confirmAttempted=true;
  let intent;
  try{intent=await live.api.confirmSupport(flow.review.reviewId);}
  catch(err){
   if(!supportCurrent(flow))return;
   if(err?.code==='PAYER_REQUIRED'||err?.code==='FINALIZED_FACTS_STALE')flow.confirmAttempted=false;
   throw err;
  }
  if(!supportCurrent(flow))return;
  flow.intent=intent;
 }
 await refreshSupport(flow);
 for(let pass=0;pass<8&&supportCurrent(flow);pass++){
  syncSupportQuote(flow);
  if(flow.quoteExpired||supportState(flow.intent)==='FINAL_SUCCEEDED')return;
  const steps=flow.preparation?.actions??[];
  const fund=steps.find(a=>a.kind==='fund'&&a.allowed===true);
  const approve=steps.find(a=>a.kind==='approve'&&a.allowed===true);
  const original=flow.intent?.intentId??flow.intent?.id;
  const next=!live.supportAttempts[original]?.approve&&approve?'approve':!live.supportAttempts[original]?.fund&&fund?'fund':null;
  if(next){
   await sendOriginalSupportStep(flow,next);
   if(!supportCurrent(flow)||next==='fund')return;
  }else if(live.supportAttempts[original]?.fund){
   flow.status='Payment sent. We are checking the original confirmation; it will appear in My contributions.';return;
  }
  if(pass===7)break;
  if(typeof document!=='undefined'&&document.hidden)break;
  // Read-only status check. Never opens another transaction after an uncertain attempt.
  await new Promise(resolve=>setTimeout(resolve,1150));
  if(!supportCurrent(flow))return;
  await refreshSupport(flow);
 }
 if(supportCurrent(flow)&&!flow.quoteExpired&&supportState(flow.intent)!=='FINAL_SUCCEEDED')
  flow.status='Your original contribution is saved. Finish any remaining wallet step using Continue payment, or check My contributions.';
}
async function handleSupportAction(action,target){
 if(action==='support-close'){closeSupportFlow();return;}
 if(!live.context.session){await openWalletChooser();return;}
 if(action==='support-orders'){await loadSupportOrders();return;}
 if(action==='support-start'){
  const store=live.stores.find(item=>item.id===target.dataset.storeId),meal=live.meals[store?.id]?.find(item=>item.id===target.dataset.mealId&&item.listed===true&&item.eligible!==false);
  if(!store||!meal){live.error='This public meal is no longer available. Refresh the kitchens before continuing.';renderLive();showLiveError();return;}
  closeSupportFlow();live.support={...newSupportFlow(),store,meal};showSupportFlow();return;
 }
 if(action==='support-review-again'){
  const flow=live.support;if(!supportCurrent(flow)||flow.busy)return;syncSupportQuote(flow);const target=flow.quoteExpired&&supportReviewTarget(flow);if(!target){flow.error='The original meal is not currently available in the public kitchen.';showSupportFlow();return;}
  const quantity=Number(flow.intent?.quantity??flow.review?.review?.quantity??flow.quantity);
  live.support={...newSupportFlow(),...target,quantity:Number.isInteger(quantity)&&quantity>=1&&quantity<=10?quantity:1};showSupportFlow();return;
 }
 if(action==='support-open'){
  const id=target.dataset.intentId;if(!id)return;closeSupportFlow();live.support={...newSupportFlow(),intent:{id,stage:'PENDING'},attempted:live.supportAttempts[id]??{}};await supportTask(refreshSupport);return;
 }
 await supportTask(async flow=>{
   if(action==='support-pay')await continueOriginalSupport(flow);
   else if(action==='support-review'){
   if(flow.intent||flow.review)return;if(!Number.isInteger(flow.quantity)||flow.quantity<1||flow.quantity>10)throw Error('Choose between 1 and 10 meals.');
   const review=await live.api.createSupportReview({storeId:flow.store.id,mealId:flow.meal.id,quantity:flow.quantity});if(!supportCurrent(flow))return;
   if(!review.reviewId||review.review?.payer?.toLowerCase()!==flow.wallet)throw Error('The review does not match the selected wallet. Sign in again.');flow.review=review;
  }
  else if(action==='support-confirm'){
   if(!flow.review||flow.intent||flow.confirmAttempted)return;flow.confirmAttempted=true;
   let intent;
   try{intent=await live.api.confirmSupport(flow.review.reviewId);}
   catch(err){
    if(!supportCurrent(flow))return;
    if(err?.code==='FINALIZED_FACTS_STALE'){
     flow.confirmAttempted=false;
     throw Error('链上状态暂未更新，确认结果尚未核实；稍后重试原确认，勿另建支持 (FINALIZED_FACTS_STALE)。');
    }
    if(err?.code==='PAYER_REQUIRED'){
     flow.confirmAttempted=false;
     throw Error('No contribution was created: the service rejected confirmation because the payer binding is unavailable (PAYER_REQUIRED). After the service recovers, retry Confirm contribution with this same review. If the review has expired, close this dialog and review the meal again.');
    }
    throw err;
   }
   if(!supportCurrent(flow))return;flow.intent=intent;await refreshSupport(flow);
  }
  else if(action==='support-check'){await refreshSupport(flow);}
   else if(action==='support-send')await sendOriginalSupportStep(flow,target.dataset.kind);
  else if(action==='support-record'){
   const kind=target.dataset.kind,id=flow.intent?.intentId??flow.intent?.id;if(!id||!['approve','fund'].includes(kind)||(!flow.knownHashes[kind]&&!flow.preparation?.actions?.some(item=>item.kind===kind&&item.canRetryRecord===true)))throw Error('No known transaction is available to record. Check the original contribution.');
   await live.api.retrySupportTransactionRecord(id,kind);if(!supportCurrent(flow))return;await refreshSupport(flow);
  }
 });
}

function claimCurrent(flow){return !!flow&&live.claim===flow&&flow.generation===live.generation&&live.context.session?.wallet===flow.wallet;}
const CLAIM_RECOVERY_PREFIX='mealforward-claim-original-v2:';
function claimRecoveryKey(wallet){return CLAIM_RECOVERY_PREFIX+String(wallet??'').toLowerCase();}
function readClaimRecovery(wallet){
 if(!wallet||typeof sessionStorage==='undefined')return null;
 try{
  const r=JSON.parse(sessionStorage.getItem(claimRecoveryKey(wallet))||'null');
  return r?.wallet===wallet&&typeof r.reviewId==='string'&&r.reviewId.length<=128&&r.reviewId.length>0&&(!r.intentId||typeof r.intentId==='string'&&r.intentId.length<=128)?r:null;
 }catch{return null;}
}
function rememberClaimRecovery(flow){
 if(!claimCurrent(flow)||!flow.review?.reviewId)return;
 const value={wallet:flow.wallet,reviewId:flow.review.reviewId,intentId:flow.intent?.intentId??flow.intent?.id??null};
 live.claimPending=value;
 try{if(typeof sessionStorage!=='undefined')sessionStorage.setItem(claimRecoveryKey(flow.wallet),JSON.stringify(value));}catch{/* The backend remains authoritative; this tab keeps the original reference. */}
}
function clearClaimRecovery(wallet){
 live.claimPending=null;
 try{if(typeof sessionStorage!=='undefined')sessionStorage.removeItem(claimRecoveryKey(wallet));}catch{/* Best-effort cleanup of non-secret references only. */}
}
async function openPendingClaim(){
 const wallet=live.context.session?.wallet;if(!wallet)return;
 const pending=live.claimPending?.wallet===wallet?live.claimPending:readClaimRecovery(wallet);
 if(!pending)return;
 closeClaimFlow();closeSupportFlow();live.claim=newClaimFlow();
 live.claimPending=pending;live.claim.review={reviewId:pending.reviewId};
 if(pending.intentId){live.claim.intent={id:pending.intentId,stage:'PENDING'};await claimTask(refreshClaim);}
 else showClaimFlow();
}
async function submitOriginalClaim(flow){
 if(!flow.review){
  const review=await live.api.createClaimReview({storeId:flow.store.id,mealId:flow.meal.id});if(!claimCurrent(flow))return;
  if(!review.reviewId||review.review?.mealId?.replace(/^0x/,'')!==flow.meal.id.replace(/^0x/,''))throw Error('The claim review does not match the selected meal.');
  flow.review=review;rememberClaimRecovery(flow);
 }
 if(flow.intent||flow.confirmAttempted)return;
 flow.confirmAttempted=true;rememberClaimRecovery(flow);
 let intent;
 try{intent=await live.api.confirmClaim(flow.review.reviewId);}
 catch(err){
  if(!claimCurrent(flow))return;
  if(err?.code==='FINALIZED_FACTS_STALE'){
   flow.confirmAttempted=false; // Same review + same idempotency key only; never create a replacement.
   throw Error('Chain data needs refreshing. Continue this original claim after the service recovers; do not request another meal.');
  }
  throw err; // Uncertain: do not resubmit automatically.
 }
 if(!claimCurrent(flow))return;
 flow.intent=intent;rememberClaimRecovery(flow);await refreshClaim(flow);
}

function closeClaimFlow(){const flow=live.claim;if(!flow)return;clearTimeout(flow.displayTimer);flow.display=null;live.claim=null;close(true);body.innerHTML='';}
function newClaimFlow(){return {generation:live.generation,wallet:live.context.session.wallet,busy:false,error:'',review:null,intent:null,voucher:null,display:null,confirmAttempted:false};}
function showClaimFlow(){
 const flow=live.claim;if(!claimCurrent(flow))return;
 if(flow.display&&Date.now()>=flow.display.expiresLocally){flow.display=null;flow.error='This short-lived code has expired. Request a new code.';}
 modal(renderClaimFlow(flow),'live-claim');
 if(flow.display){
  const node=document.querySelector('#live-voucher-qr');
  if(node&&window.QRCode)new window.QRCode(node,{text:flow.display.displayUrl||flow.display.display,width:210,height:210,colorDark:'#234c3d',colorLight:'#ffffff',correctLevel:window.QRCode.CorrectLevel.M});
 }
}
async function claimTask(fn){
 const flow=live.claim;if(!claimCurrent(flow)||flow.busy)return;flow.busy=true;flow.error='';showClaimFlow();
 try{await fn(flow);}catch(err){if(claimCurrent(flow)){if(isLiveAuthRejection(err)){clearLiveIdentity('Sign in again to view your meal records.');return;}flow.error=err?.code==='FINALIZED_FACTS_STALE'&&flow.voucher?'On-chain voucher data needs refreshing (FINALIZED_FACTS_STALE). Your confirmed payment and claim remain unchanged. Wait for the service to refresh, then select Show QRcode again.':liveMessage(err);}}
 finally{if(claimCurrent(flow)){flow.busy=false;showClaimFlow();}}
}
async function loadClaimRecords(){
 if(!live.context.session){live.vouchers=[];live.claimIntents=[];renderLive();return;}if(live.claimRecordsLoading)return;
 const generation=live.generation;live.claimRecordsLoading=true;live.error='';renderLive();
 try{
  const results=await Promise.allSettled([live.api.getMyVouchers(),live.api.getClaimIntents()]);if(generation!==live.generation)return;
  const rejected=results.find(result=>result.status==='rejected'&&isLiveAuthRejection(result.reason))??results.find(result=>result.status==='rejected');if(rejected)throw rejected.reason;
  live.vouchers=Array.isArray(results[0].value)?results[0].value:results[0].value.items??[];live.claimIntents=Array.isArray(results[1].value)?results[1].value:results[1].value.items??[];
 }catch(err){if(generation!==live.generation)return;if(isLiveAuthRejection(err)){clearLiveIdentity('Sign in again to view your meal records.');return;}live.error=liveMessage(err);}
 finally{if(generation===live.generation){live.claimRecordsLoading=false;renderLive();}}
}
async function refreshClaim(flow){
 const id=flow.intent?.intentId??flow.intent?.id;if(!id)throw Error('Check My meals for the original claim.');
 const intent=await live.api.getClaimIntent(id);if(!claimCurrent(flow))return;flow.intent=intent;
 if(supportState(intent)!=='FINAL_SUCCEEDED')return;
 const voucherId=intent.result?.result;
 if(typeof voucherId!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(voucherId))throw Error('The claim is confirmed, but its voucher reference is not available yet. Check the original progress or My meals.');
 const voucher=await live.api.getVoucher(voucherId);if(!claimCurrent(flow))return;
 if((voucher?.voucherId??voucher?.id)!==voucherId)throw Error('The voucher does not match the original claim.');
 flow.voucher=voucher;clearClaimRecovery(flow.wallet);
 const index=live.vouchers.findIndex(item=>(item.voucherId??item.id)===voucherId);if(index<0)live.vouchers.push(voucher);else live.vouchers[index]=voucher;
}
async function handleClaimAction(action,target){
 if(action==='claim-close'){closeClaimFlow();return;}
 if(!live.context.session){await openWalletChooser();return;}
 if(action==='claim-records'){await loadClaimRecords();return;}
  if(action==='claim-resume-start'){await openPendingClaim();return;}
  if(action==='claim-start'){
   const store=live.stores.find(item=>item.id===target.dataset.storeId),meal=live.meals[store?.id]?.find(item=>item.id===target.dataset.mealId&&item.listed===true&&item.eligible!==false&&Number(item.financial?.counts?.A??item.available)>0);
   if(!store||!meal){live.error='This public meal has no available portions. Refresh the kitchen.';renderLive();return;}
   closeClaimFlow();closeSupportFlow();live.claim={...newClaimFlow(),store,meal};
   const pending=live.claimPending?.wallet===live.claim.wallet?live.claimPending:readClaimRecovery(live.claim.wallet);
   if(pending){
    live.claimPending=pending;live.claim.review={reviewId:pending.reviewId};
    if(pending.intentId){live.claim.intent={id:pending.intentId,stage:'PENDING'};await claimTask(refreshClaim);}
    else showClaimFlow();
   }else showClaimFlow();
   return;
  }
 if(action==='claim-open'||action==='claim-voucher'){
  closeClaimFlow();closeSupportFlow();live.claim=newClaimFlow();
  if(action==='claim-open'){live.claim.intent={id:target.dataset.intentId};await claimTask(refreshClaim);}
  else await claimTask(async flow=>{const id=target.dataset.voucherId,voucher=await live.api.getVoucher(id);if(!claimCurrent(flow))return;if((voucher?.voucherId??voucher?.id)!==id)throw Error('The voucher does not match the selected meal record.');flow.voucher=voucher;});
  return;
 }
 await claimTask(async flow=>{
   if(action==='claim-one-tap'){
    if(!flow.intent&&!flow.confirmAttempted)await submitOriginalClaim(flow);
   }else if(action==='claim-resume'){
    // A same-review recheck is allowed only after a deterministic stale-facts response.
    if(flow.review&&!flow.intent&&!flow.confirmAttempted)await submitOriginalClaim(flow);
   }else if(action==='claim-review'){
   if(flow.review||flow.intent||flow.confirmAttempted||live.claimPending)return;
   const review=await live.api.createClaimReview({storeId:flow.store.id,mealId:flow.meal.id});if(!claimCurrent(flow))return;
   if(!review.reviewId||review.review?.mealId?.replace(/^0x/,'')!==flow.meal.id.replace(/^0x/,''))throw Error('The claim review does not match the selected meal.');flow.review=review;rememberClaimRecovery(flow);
  }else if(action==='claim-confirm'){
   if(!flow.review||flow.intent||flow.confirmAttempted)return;flow.confirmAttempted=true;rememberClaimRecovery(flow);
   let intent;
   try{intent=await live.api.confirmClaim(flow.review.reviewId);}
   catch(err){
    if(!claimCurrent(flow))return;
    if(err?.code==='FINALIZED_FACTS_STALE'&&live.claimPending?.reviewId===flow.review.reviewId&&!live.claimPending.intentId){
     flow.confirmAttempted=false;
     throw Error('Chain state needs updating; the confirmation outcome is not yet verified. Retry Confirm claim with this same review after the service recovers. Do not create another claim.');
    }
    throw err;
   }
   if(!claimCurrent(flow))return;flow.intent=intent;rememberClaimRecovery(flow);await refreshClaim(flow);
  }else if(action==='claim-check'){await refreshClaim(flow);}
  else if(action==='claim-copy-link'){
   const display=flow.display;if(!display||Date.now()>=display.expiresLocally)throw Error('This private link has expired. Request a new QR code.');
   let url;try{url=new URL(display.displayUrl);}catch{throw Error('A valid private voucher link is not available.');}
   if(url.origin!==location.origin||url.pathname!=='/'||url.search!==''||url.hash!=='#verify?code='+display.display||! /^[A-Za-z0-9_-]{43}$/.test(display.display))throw Error('A valid private voucher link is not available.');
   display.copyStatus='';display.copyFallback=false;
   try{
    if(!navigator.clipboard?.writeText)throw Error('Clipboard unavailable');
    await navigator.clipboard.writeText(display.displayUrl);
    if(claimCurrent(flow)&&flow.display===display&&Date.now()<display.expiresLocally)display.copyStatus='Copied';
   }catch{
    if(claimCurrent(flow)&&flow.display===display&&Date.now()<display.expiresLocally){display.copyFallback=true;display.copyStatus='Clipboard unavailable. Select and copy the full private link below.';}
   }
  }
  else if(action==='claim-display'){
   const id=flow.voucher?.voucherId??flow.voucher?.id;if(!id||flow.display)return;
   clearTimeout(flow.displayTimer);
   const display=await live.api.prepareVoucherDisplay(id);if(!claimCurrent(flow))return;
   if(display.redeemable===false){flow.error='This voucher cannot be displayed for collection now. Check its status and service hours in My meals.';return;}
   const now=Number(display.now??Math.floor(Date.now()/1000)),validUntil=Number(display.validUntil),remaining=validUntil-now;
   if(typeof display.display!=='string'||! /^[A-Za-z0-9_-]{43}$/.test(display.display)||!Number.isFinite(remaining)||remaining<=0||remaining>120)throw Error('A valid short-lived voucher code is not available. Check the original voucher again.');
   const displayUrl=display.displayUrl;
   if(displayUrl){const url=new URL(displayUrl,location.origin);if(url.origin!==location.origin||url.pathname!=='/'||url.search!==''||url.hash!=='#verify?code='+display.display)throw Error('The voucher link does not match this site.');}
   flow.display={display:display.display,displayUrl,validUntil,expiresLocally:Date.now()+remaining*1000};
   flow.displayTimer=setTimeout(()=>{if(claimCurrent(flow)){flow.display=null;flow.error='This short-lived code has expired. Request a new code when you are ready at the kitchen.';showClaimFlow();}},remaining*1000);
  }
 });
}

function takeVerificationLink(){
 if(!location.hash.startsWith('#verify?'))return null;
 const input=location.origin+'/'+location.hash;history.replaceState(null,'',location.pathname+location.search+'#merchant/verify');return input;
}
function verificationCurrent(flow){return !!flow&&live.verification===flow&&flow.generation===live.generation&&flow.wallet===live.context.session?.wallet&&hasOwnedKitchen(live.context)&&flow.storeId===live.context.store.id;}
function stopVerificationCamera(flow){if(!flow)return;flow.cameraEpoch++;clearTimeout(flow.scanTimer);flow.stream?.getTracks().forEach(track=>track.stop());flow.stream=null;flow.scanning=false;flow.cameraPending=false;const video=document.querySelector('#verification-camera');if(video)video.srcObject=null;}
function closeVerificationEntry(){const flow=live.verification;if(!flow)return;stopVerificationCamera(flow);flow.code=null;flow.checked=null;flow.case=null;flow.records=[];live.verification=null;close(true);body.innerHTML='';}
function showVerificationEntry(){if(verificationCurrent(live.verification))modal(renderVerificationEntry(live.verification),'live-verification');}
function readVerificationCode(flow,input){
 if(flow.lockAttempted||flow.intent||flow.case)return;flow.checked=null;
 stopVerificationCamera(flow);flow.code=null;flow.error='';
 try{flow.code=live.parseVoucherCode(input,location.origin);}catch{flow.error='Use a valid short-lived code or a private voucher link from this site.';}
 showVerificationEntry();
}
function openVerificationEntry(input=null){
 if(!hasOwnedKitchen(live.context)){live.error='Sign in with the kitchen owner wallet, then scan or paste the voucher again.';renderLive();return;}
 closeVerificationEntry();closeClaimFlow();closeSupportFlow();live.verification={generation:live.generation,wallet:live.context.session.wallet,storeId:live.context.store.id,code:null,error:'',status:'',cameraEpoch:0,stream:null,scanning:false,cameraPending:false,busy:false,checked:null,intent:null,case:null,records:[],lockAttempted:false,handoverAttempted:false};
 if(input)readVerificationCode(live.verification,input);else showVerificationEntry();
}
async function startVerificationCamera(flow){
 if(flow.busy||flow.lockAttempted||flow.intent||flow.case)return;flow.checked=null;
 stopVerificationCamera(flow);flow.code=null;flow.error='';
 if(!navigator.mediaDevices?.getUserMedia||!window.BarcodeDetector){flow.status='Camera scanning is unavailable in this browser. Paste the private link or code instead.';showVerificationEntry();return;}
 const epoch=flow.cameraEpoch;flow.cameraPending=true;flow.status='Allow camera access to scan a voucher.';showVerificationEntry();
 try{
  const detector=new window.BarcodeDetector({formats:['qr_code']}),stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
  if(!verificationCurrent(flow)||epoch!==flow.cameraEpoch){stream.getTracks().forEach(track=>track.stop());return;}
  flow.stream=stream;flow.scanning=true;flow.cameraPending=false;flow.status='Point the camera at the voucher QR code.';showVerificationEntry();
  const video=document.querySelector('#verification-camera');video.srcObject=stream;await video.play();
  async function scan(){
   if(!verificationCurrent(flow)||epoch!==flow.cameraEpoch)return;
   try{const codes=await detector.detect(video);if(!verificationCurrent(flow)||epoch!==flow.cameraEpoch)return;if(codes.length){readVerificationCode(flow,codes[0].rawValue);return;}}
   catch{if(verificationCurrent(flow)&&epoch===flow.cameraEpoch){stopVerificationCamera(flow);flow.error='The QR code could not be read. Paste the private link or code instead.';showVerificationEntry();}return;}
   flow.scanTimer=setTimeout(scan,350);
  }
  if(verificationCurrent(flow)&&epoch===flow.cameraEpoch)await scan();
 }catch{if(verificationCurrent(flow)&&epoch===flow.cameraEpoch){stopVerificationCamera(flow);flow.error='Camera access is unavailable. Paste the private link or code instead.';showVerificationEntry();}}
}
async function handleVerificationEntry(action,target={dataset:{}}){
 if(action==='verification-close'){closeVerificationEntry();return;}
 if(action==='verification-open'){openVerificationEntry();return;}
 const flow=live.verification;if(!verificationCurrent(flow)||flow.busy)return;
 const handoverConfirmed=document.querySelector('#verification-handover-confirm')?.checked===true;
 if(action==='verification-parse')readVerificationCode(flow,document.querySelector('#verification-input')?.value??'');
 else if(action==='verification-camera')await startVerificationCamera(flow);
 else if(action==='verification-stop'){stopVerificationCamera(flow);flow.status='Camera stopped. You can paste a private link or code.';showVerificationEntry();}
 else await verificationTask(flow,async()=>{
  if(action==='verification-check'){
   if(!flow.code||flow.lockAttempted||flow.intent||flow.case)return;
   const checked=await live.api.checkVoucher({storeId:flow.storeId,code:flow.code});if(!verificationCurrent(flow))return;
   if(checked.valid!==true||checked.store!==flow.storeId)throw Error('This voucher is not valid for this kitchen.');flow.checked=checked;
  }else if(action==='verification-reserve'){
   if(!flow.checked||!flow.code||flow.lockAttempted)return;flow.lockAttempted=true;
   const intent=await live.api.lockVoucher({storeId:flow.storeId,code:flow.code});if(!verificationCurrent(flow))return;flow.intent=intent;flow.code=null;await refreshVerification(flow);
  }else if(action==='verification-progress'){await refreshVerification(flow);}
  else if(action==='verification-handover'){
   if(!flow.case||flow.case.state!=='R'||flow.case.marked||flow.case.pending||flow.handoverAttempted||!handoverConfirmed)return;
   flow.handoverAttempted=true;
   const intent=await live.api.confirmHandover({storeId:flow.storeId,caseId:flow.case.id});if(!verificationCurrent(flow))return;flow.intent=intent;await refreshVerification(flow);
  }else if(action==='verification-records'){
   const overview=await live.api.getOwnerOverview(flow.storeId);if(!verificationCurrent(flow))return;flow.records=overview.redemptionIntents??[];
  }else if(action==='verification-restore'){
   const id=target.dataset.intentId,record=flow.records.find(item=>(item.intentId??item.id)===id);if(!record)return;
   flow.code=null;flow.checked=null;flow.intent=record;flow.lockAttempted=true;flow.case=null;flow.handoverAttempted=false;flow.caseReference=record.lockId??null;flow.status='';
   await refreshVerification(flow);
  }
 });
}
async function verificationTask(flow,fn){
 if(!verificationCurrent(flow)||flow.busy)return;stopVerificationCamera(flow);flow.busy=true;flow.error='';showVerificationEntry();
 try{await fn();}catch(err){if(verificationCurrent(flow)){if(isLiveAuthRejection(err)){clearLiveIdentity('Sign in with the kitchen owner wallet again.');return;}flow.error=err?.code==='NOT_FOUND'?'The original redemption request was not found (NOT_FOUND). Refresh kitchen requests to verify its reference.':err?.code==='FINALIZED_FACTS_STALE'?'Voucher state needs refreshing. Check the original request; no handover or settlement has been confirmed by this error.':'The voucher action could not be verified. Check the original request or refresh kitchen requests before trying anything else.';}}
 finally{if(verificationCurrent(flow)){flow.busy=false;showVerificationEntry();}}
}
async function refreshVerification(flow){
 const id=flow.intent?.intentId??flow.intent?.id;if(!id)return;
 flow.status='';
 const intent=await live.api.getRedemptionIntent(flow.storeId,id);if(!verificationCurrent(flow))return;
 flow.intent=intent;flow.status='';let caseId;
 if(intent.action==='lock'){
  flow.case=null;
  if(supportState(intent)==='FINAL_REVERT'){
   flow.status='The on-chain voucher reservation failed. This request did not redeem the meal and cannot be sent again. The old code is no longer usable. The recipient must stay signed in and show a new QR code during the voucher’s Beijing-time (UTC+8) service hours. The owner can then start a separate voucher check; availability is checked again by the service.';return;
  }
  if(supportState(intent)!=='FINAL_SUCCEEDED'){flow.status='Voucher reservation is still processing. Check this original request; do not reserve again.';return;}
  caseId=intent.result?.result;
 }else if(['handover','report'].includes(intent.action))caseId=intent.lockId??flow.case?.id??flow.caseReference;
 else return;
 flow.case=null;
 if(typeof caseId!=='string'||!/^0x[0-9a-f]{64}$/.test(caseId))throw Error('Original lock reference unavailable.');
 flow.caseReference=caseId;
 try{
  const value=await live.api.getRedemptionCase(flow.storeId,caseId);if(!verificationCurrent(flow))return;
  flow.case=value;flow.handoverAttempted=flow.handoverAttempted||value.redemptionIntents?.some(item=>item.action==='handover');
 }catch(err){
  if(!verificationCurrent(flow))return;
  if(err?.code==='NOT_FOUND'){flow.status='The original handover case is not visible yet. Check this original request again; do not reserve another voucher.';return;}
  throw err;
 }
}

function settlementCurrent(flow){return !!flow&&live.settlement===flow&&flow.generation===live.generation&&flow.wallet===live.context.session?.wallet&&hasOwnedKitchen(live.context)&&flow.storeId===live.context.store.id;}
function closeSettlementFlow(){stopSettlementClock();if(!live.settlement)return;live.settlement=null;close(true);body.innerHTML='';}
function showSettlementFlow(){if(settlementCurrent(live.settlement)){modal(renderSettlementFlow(live.settlement),'live-settlement');startSettlementClock();}}
async function loadPayouts(){
 if(!hasOwnedKitchen(live.context)||live.payoutsLoading)return;
 const generation=live.generation,storeId=live.context.store.id;live.payoutsLoading=true;live.error='';renderLive();
 try{const data=await live.api.getPayouts(storeId);if(generation!==live.generation||storeId!==live.context.store?.id)return;live.payouts={...data,receivedAt:Date.now()};live.payoutStoreId=storeId;}
 catch(err){if(generation!==live.generation)return;if(isLiveAuthRejection(err)){clearLiveIdentity('Sign in as the kitchen owner again.');return;}live.error='Payout records are unavailable. Refresh the original records.';}
 finally{if(generation===live.generation){live.payoutsLoading=false;renderLive();}}
}
async function settlementTask(flow,fn){
 if(!settlementCurrent(flow)||flow.busy)return;flow.busy=true;flow.error='';showSettlementFlow();
 try{await fn();}catch(err){if(settlementCurrent(flow)){if(isLiveAuthRejection(err)){clearLiveIdentity('Sign in as the kitchen owner again.');return;}flow.error=({SETTLEMENT_DELAY:'The waiting period has not ended. Check the original payout after it ends.',SETTLEMENT_REPORT_REQUIRED:'Confirmed handover report evidence is not available yet. Refresh the payout records.',ORIGINAL_SETTLEMENT_PENDING:'An original settlement already exists. Refresh Payouts and open that request.',FINALIZED_FACTS_STALE:'Settlement data needs refreshing. Check the original request; this is not proof of payment.'})[err?.code]||'The settlement result could not be verified. Check its original progress; do not send another transaction.';}}
 finally{if(settlementCurrent(flow)){flow.busy=false;showSettlementFlow();}}
}
async function refreshSettlement(flow){
 const id=flow.intent?.intentId??flow.intent?.id;
 if(id){const intent=await live.api.getSettlementIntent(flow.storeId,id);if(!settlementCurrent(flow))return;if(intent.voucherId!==flow.voucherId)throw Error('Settlement voucher mismatch.');flow.intent=intent;flow.sendAttempted=!!live.settlementAttempts[id];}
 const data=await live.api.getPayouts(flow.storeId);if(!settlementCurrent(flow))return;
 const payout=data.items?.find(item=>item.id===flow.voucherId);if(!payout)throw Error('Original payout unavailable.');
 flow.payout=payout;flow.serverTime=data.serverTime;flow.receivedAt=Date.now();flow.preparation=null;live.payouts={...data,receivedAt:flow.receivedAt};live.payoutStoreId=flow.storeId;
 flow.settled=flow.intent?.stage==='FINAL_SUCCEEDED'&&payout.state==='S';
 if(flow.settled||!id||flow.intent?.stage==='FINAL_SUCCEEDED')return;
 const preparation=await live.api.getSettlementWalletPreparation(flow.storeId,id);if(!settlementCurrent(flow))return;flow.preparation=preparation;
}
async function handleSettlementAction(action,target){
 if(action==='settlement-close'){closeSettlementFlow();return;}
 if(!hasOwnedKitchen(live.context)){live.error='Sign in with the kitchen owner wallet.';renderLive();return;}
 if(action==='settlement-list'){await loadPayouts();return;}
 if(action==='settlement-open'){
  if(live.payoutStoreId!==live.context.store.id)return;const payout=live.payouts?.items?.find(item=>item.id===target.dataset.voucherId);if(!payout)return;
  const intent=payout.settlementIntents?.find(item=>(item.intentId??item.id)===target.dataset.intentId)??null;
  if(target.dataset.intentId&&!intent)return;
  closeSettlementFlow();closeVerificationEntry();closeClaimFlow();closeSupportFlow();
  live.settlement={generation:live.generation,wallet:live.context.session.wallet,storeId:live.context.store.id,voucherId:payout.id,payout,intent,serverTime:live.payouts.serverTime,receivedAt:live.payouts.receivedAt,review:null,busy:false,error:'',status:'',preparation:null,settled:false,confirmAttempted:!!live.settlementPending[payout.id]};
  const flow=live.settlement;await settlementTask(flow,()=>refreshSettlement(flow));return;
 }
 const flow=live.settlement;if(!settlementCurrent(flow))return;
 await settlementTask(flow,async()=>{
  if(action==='settlement-review'){
   if(flow.intent||flow.review||flow.confirmAttempted||flow.payout.state!=='H'||flow.payout.settlementIntents?.length||!Number.isFinite(flow.payout.settleEligibleAt)||!Number.isFinite(flow.serverTime)||flow.payout.settleEligibleAt>flow.serverTime+Math.max(0,Date.now()-flow.receivedAt)/1000)return;
   const review=await live.api.createSettlementReview({storeId:flow.storeId,voucherId:flow.voucherId});if(!settlementCurrent(flow))return;flow.review=review;
  }else if(action==='settlement-confirm'){
   if(!flow.review||flow.intent||flow.confirmAttempted)return;flow.confirmAttempted=true;live.settlementPending[flow.voucherId]=flow.review.reviewId;
   const intent=await live.api.confirmSettlement({storeId:flow.storeId,reviewId:flow.review.reviewId});if(!settlementCurrent(flow))return;flow.intent=intent;await refreshSettlement(flow);
  }else if(action==='settlement-check'){await refreshSettlement(flow);}
  else if(action==='settlement-send'){
   const id=flow.intent?.intentId??flow.intent?.id,step=flow.preparation?.actions?.find(item=>item.kind==='settle');
   if(!id||flow.intent.stage==='FINAL_SUCCEEDED'||flow.payout.state!=='H'||step?.allowed!==true||step.account?.toLowerCase()!==flow.wallet||live.settlementAttempts[id])return;
   live.settlementAttempts[id]=true;flow.sendAttempted=true;flow.preparation=null;
   let returned=false;
   try{const result=await live.api.sendSettlementTransaction(flow.storeId,id);returned=true;if(!settlementCurrent(flow))return;flow.transactionHash=result.transactionHash;await refreshSettlement(flow);}
   catch(err){if(!settlementCurrent(flow))return;if(!returned&&err?.walletStepNotStarted===true){delete live.settlementAttempts[id];flow.sendAttempted=false;flow.status='Wallet request was not started. Resolve preparation and check original progress.';}else{flow.status='The original wallet request is unresolved. Check it; do not send again.';if(/^0x[0-9a-fA-F]{64}$/.test(err?.transactionHash??''))flow.transactionHash=err.transactionHash;}throw err;}
  }else if(action==='settlement-record'){
   const id=flow.intent?.intentId??flow.intent?.id;if(!id||!flow.preparation?.actions?.some(item=>item.kind==='settle'&&item.canRetryRecord))return;
   await live.api.retrySettlementTransactionRecord(flow.storeId,id);if(!settlementCurrent(flow))return;await refreshSettlement(flow);
  }
 });
}

function stopSettlementClock(){clearInterval(live.settlementClock);live.settlementClock=null;}
function startSettlementClock(){
 stopSettlementClock();if(!hasOwnedKitchen(live.context)||(!live.settlement&&location.hash!=='#merchant/payouts'))return;
 const generation=live.generation,storeId=live.context.store.id;
 live.settlementClock=setInterval(()=>{
  if(generation!==live.generation||storeId!==live.context.store?.id||!hasOwnedKitchen(live.context)||(!live.settlement&&location.hash!=='#merchant/payouts')){stopSettlementClock();return;}
  document.querySelectorAll('[data-settlement-countdown]').forEach(node=>{
   const end=Number(node.dataset.eligibleAt),now=Number(node.dataset.serverTime),receivedAt=Number(node.dataset.receivedAt);
   if(![end,now,receivedAt].every(Number.isFinite))return;
   const remaining=Math.max(0,Math.ceil(end-now-Math.max(0,Date.now()-receivedAt)/1000));
   node.textContent=remaining>0?`Waiting period: ${remaining}s remaining.`:'Waiting period ended. Check original progress to verify eligibility.';
  });
 },1000);
}

function mealPublishCurrent(flow){return !!flow&&live.mealPublish===flow&&flow.generation===live.generation&&flow.wallet===live.context.session?.wallet&&hasOwnedKitchen(live.context)&&flow.storeId===live.context.store.id;}
function closeMealPublish(){if(!live.mealPublish)return;live.mealPublish=null;close(true);body.innerHTML='';}
function showMealPublish(){if(mealPublishCurrent(live.mealPublish))modal(renderMealPublishFlow(live.mealPublish,live.context.setup),'live-meal-publish');}
async function mealPublishTask(flow,fn){
 if(!mealPublishCurrent(flow)||flow.busy)return;flow.busy=true;flow.error='';showMealPublish();
 try{await fn();}catch(err){if(mealPublishCurrent(flow)){if(isLiveAuthRejection(err)){clearLiveIdentity('Sign in with the kitchen owner wallet again.');return;}flow.error=liveMessage(err);}}
 finally{if(mealPublishCurrent(flow)){flow.busy=false;showMealPublish();}}
}
async function refreshMealPublish(flow){
 const records=await live.api.getMealPublishIntents(flow.storeId,flow.draftId);if(!mealPublishCurrent(flow))return;flow.records=Array.isArray(records)?records:records.items??[];
 if(!flow.publish)return;
 const id=flow.publish.intentId??flow.publish.id,intent=await live.api.getMealPublishIntent(flow.storeId,id);if(!mealPublishCurrent(flow))return;
 if(intent.action!=='publish'||intent.draftId!==flow.draftId)throw Error('The publication does not match this saved draft.');flow.publish=intent;
 flow.listing=flow.records.find(item=>item.action==='setListed'&&item.parentIntentId===id)??null;
 flow.review??={draftId:flow.draftId,mealId:intent.mealId,version:intent.version,targetListed:typeof intent.targetListed==='boolean'?intent.targetListed:flow.targetListed,needsListing:intent.needsListing};
 if(flow.review.mealId!==intent.mealId||String(flow.review.version)!==String(intent.version))throw Error('The publication version does not match the original review.');
 flow.publicMeal=null;
 const meals=await live.api.getStoreMeals(flow.storeId);if(!mealPublishCurrent(flow))return;
 const rows=Array.isArray(meals)?meals:meals.items??[];
 flow.publicMeal=rows.find(item=>item.id?.replace(/^0x/,'')===intent.mealId?.replace(/^0x/,'')&&String(item.version)===String(intent.version))??null;
 live.meals[flow.storeId]=rows;
 const ready=intent.stage==='FINAL_SUCCEEDED'&&flow.publicMeal&&flow.publicMeal.listed===flow.review.targetListed&&(!flow.review.needsListing||flow.listing?.stage==='FINAL_SUCCEEDED');
 if(ready&&!flow.ownerRefreshed){await loadLiveKitchen(flow.generation);if(!mealPublishCurrent(flow))return;flow.ownerRefreshed=true;renderLive();}
}
async function reviewMealPublish(flow){
 if(flow.publish||flow.review||flow.confirmAttempted||flow.records.some(item=>['publish','setListed'].includes(item.action)&&item.stage!=='FINAL_SUCCEEDED'))return;
 const dto=await live.api.createMealPublishReview({storeId:flow.storeId,draftId:flow.draftId,expectedRevision:flow.revision});if(!mealPublishCurrent(flow))return;
 const r=dto.review;if(!dto.reviewId||r?.draftId!==flow.draftId||r.draftRevision!==flow.revision)throw Error('The publication review does not match the saved draft revision.');
 flow.reviewId=dto.reviewId;flow.review={...r,revision:r.draftRevision,targetListed:typeof r.targetListed==='boolean'?r.targetListed:flow.targetListed,needsListing:r.needsListing};
}
async function handleMealPublishAction(action,target){
 if(action==='meal-publish-close'){closeMealPublish();return;}
 if(!hasOwnedKitchen(live.context))return;
 if(action==='meal-publish-review'||action==='meal-publish'){
  if(live.mealCapabilities.publish!==true)return;
  let draftId,revision,targetListed;
  if(action==='meal-publish'){
   const editor=live.mealEditor;if(!mealEditorCurrent(editor)||!editor.canPublish||editor.saving||editor.uploading)return;readLiveMealEditor();
   if(JSON.stringify(editor.values)!==editor.initial||editor.values.photo){editor.error='Save all draft changes and the selected image before reviewing publication.';renderLiveMealDialog();return;}
   draftId=editor.mealId;revision=editor.revision;const row=live.ownerMeals.find(item=>(item.draftId??item.id)===draftId);targetListed=row?.published===false||!row?true:row.listed===true;
  }else{
   const meal=live.ownerMeals.find(item=>item.id===target.dataset.mealId);if(!meal||meal.saved!==true)return;draftId=meal.draftId??meal.id;revision=meal.draftRevision;targetListed=meal.published===false?true:meal.listed===true;
  }
  if(!Number.isSafeInteger(revision)||revision<0)return;
  closeLiveMealEditor(true);closeMealPublish();
  const flow={generation:live.generation,wallet:live.context.session.wallet,storeId:live.context.store.id,draftId,revision,targetListed,connected:true,busy:false,error:'',review:null,reviewId:null,publish:null,listing:null,publicMeal:null,records:[],confirmAttempted:!!live.mealPublishPending[draftId]};live.mealPublish=flow;
  await mealPublishTask(flow,async()=>{await refreshMealPublish(flow);if(mealPublishCurrent(flow))await reviewMealPublish(flow);});return;
 }
 const flow=live.mealPublish;if(!mealPublishCurrent(flow))return;
 await mealPublishTask(flow,async()=>{
  if(action==='meal-publish-review-current')await reviewMealPublish(flow);
  else if(action==='meal-publish-confirm'){
   if(!flow.reviewId||flow.publish||flow.confirmAttempted)return;flow.confirmAttempted=true;live.mealPublishPending[flow.draftId]=flow.reviewId;
   const intent=await live.api.confirmMealPublish({storeId:flow.storeId,draftId:flow.draftId,reviewId:flow.reviewId});if(!mealPublishCurrent(flow))return;flow.publish=intent;await refreshMealPublish(flow);
  }else if(action==='meal-publish-check'){await refreshMealPublish(flow);}
  else if(action==='meal-publish-restore'){
   const intent=flow.records.find(item=>(item.intentId??item.id)===target.dataset.intentId&&item.action==='publish');if(!intent)return;
   flow.publish=intent;flow.review=null;flow.reviewId=null;flow.listing=null;flow.publicMeal=null;flow.confirmAttempted=true;flow.ownerRefreshed=false;await refreshMealPublish(flow);
  }
 });
}