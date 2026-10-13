// Node-only checks of actual UI handlers; no wallet, network or browser interaction.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {hasOwnedKitchen,renderWalletChooser} from './dist/onboarding-view.mjs';
const source=readFileSync(new URL('./dist/app.js',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('function checkLiveGeneration('),source.indexOf('async function startLive('));
const chooser=source.slice(source.indexOf('function walletChoiceCurrent('),source.indexOf('function supportCurrent('));
const click=source.slice(source.indexOf("document.addEventListener('click',event=>{\n if(!LIVE_MODE"),source.indexOf("document.addEventListener('submit',event=>{\n if(!LIVE_MODE"));
const message=source.split('\n').find(line=>line.startsWith('function liveMessage('));
const enter=source.split('\n').find(line=>line.startsWith('function canEnterKitchen('));
const A='0xc4f8a468f10d5f98dcff3282516125e97f26433b',B='0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function harness(){
 const context=wallet=>({session:{wallet,stores:wallet===A?['store']:[]},store:wallet===A?{id:'store',name:'Original kitchen'}:null,setup:{walletLoginEnabled:true},registration:null,registrations:[]});
 const live={generation:0,context:context(A),walletChooser:null,reloginRequired:false,mealEditor:null,ownerMeals:[{name:'Old owner private meal'}],mealCapabilities:{edit:true},mealUnavailableReasons:{},overview:{private:'old'},preview:'',busy:false,loading:false,signed:false};
 const calls=[],events={},body={innerHTML:'',querySelector:()=>null},main={querySelector:()=>null},location={hash:'#register'},dialog={open:false};let current=context(A);
 live.api={getWalletAccounts:async options=>{calls.push(['accounts',options]);return [A,B];},loginWallet:async({address})=>{calls.push(['login',address]);current=context(address);return current;},getContext:async()=>current,getOwnerMeals:async()=>({items:[],capabilities:{}}),getOwnerOverview:async()=>({})};
 const fn=new Function('live','body','main','location','dialog','hasOwnedKitchen','renderWalletChooser','events',`const LIVE_MODE=true;const renderLive=()=>{};const readLiveDraft=()=>{};const closeSupportFlow=()=>{live.support=null;};const closeLiveMealEditor=()=>{live.mealEditor=null;};const close=()=>{dialog.open=false;};const modal=html=>{dialog.open=true;body.innerHTML=html;};const document={addEventListener:(name,fn)=>{events[name]=fn;}};const window={addEventListener:(name,fn)=>{events[name]=fn;}};${message}\n${enter}\n${helpers}\n${chooser}\n${click}\nreturn {openWalletChooser,loadWalletChoices,confirmWalletChoice,closeWalletChooser};`)(live,body,main,location,dialog,hasOwnedKitchen,renderWalletChooser,events);
 return {live,calls,body,location,dialog,fn,context,click:action=>events.click({target:{closest:()=>({dataset:{liveAction:action},disabled:false})}}),invalidate:()=>events['mealforward-session-invalidated']()};
}
test('header with cached A opens explicit unselected accounts; selecting B signs B and never opens A workspace',async()=>{
 const h=harness();await h.click('account');assert.equal(h.location.hash,'#register');assert.equal(h.live.context.session,null);assert.ok(h.body.innerHTML.includes(A));assert.equal(h.live.walletChooser.selected,'');assert.equal(h.calls.filter(c=>c[0]==='login').length,0);assert.match(h.body.innerHTML,/data-live-action="wallet-confirm" disabled/);
 h.live.walletChooser.selected=B;await h.click('wallet-confirm');assert.deepEqual(h.calls.find(c=>c[0]==='login'),['login',B]);assert.equal(h.live.context.session.wallet,B);assert.equal(h.live.context.store,null);assert.deepEqual(h.live.ownerMeals,[]);assert.equal(h.location.hash,'#stores');assert.equal(h.dialog.open,false);
});
test('explicitly selecting A loads its verified owned workspace',async()=>{
 const h=harness();await h.click('switch-wallet');h.live.walletChooser.selected=A;await h.fn.confirmWalletChoice();assert.equal(h.live.context.session.wallet,A);assert.equal(h.location.hash,'#merchant/overview');
});
test('permissions request happens only from Connect another account; unsupported never logs in',async()=>{
 const h=harness();await h.click('login');assert.deepEqual(h.calls,[['accounts',{requestPermissions:false}]]);h.live.api.getWalletAccounts=async options=>{h.calls.push(['accounts',options]);throw Object.assign(Error('Account selection unsupported'),{code:'ACCOUNT_SELECTION_UNSUPPORTED'});};await h.click('wallet-connect');assert.deepEqual(h.calls.at(-1),['accounts',{requestPermissions:true}]);assert.equal(h.live.walletChooser.selected,'');assert.deepEqual(h.live.walletChooser.accounts,[]);assert.match(h.body.innerHTML,/Account selection unsupported/);assert.equal(h.live.context.session,null);
});
test('server account mismatch stays signed out and cannot navigate to cached owner',async()=>{
 const h=harness();await h.click('login');h.live.walletChooser.selected=B;h.live.api.loginWallet=async()=>h.context(A);await h.fn.confirmWalletChoice();assert.equal(h.live.context.session,null);assert.equal(h.live.context.store,null);assert.equal(h.location.hash,'#register');assert.match(h.body.innerHTML,/does not match/);
});
test('second context read mismatch is rejected even after initial selected B result',async()=>{
 const h=harness();await h.click('login');h.live.walletChooser.selected=B;h.live.api.getContext=async()=>h.context(A);await h.fn.confirmWalletChoice();assert.equal(h.live.context.session,null);assert.equal(h.location.hash,'#register');assert.match(h.body.innerHTML,/session changed/);
});
test('cancel or wallet change discards delayed enumeration and delayed login',async()=>{
 for(const event of ['close','invalidate'])for(const phase of ['enumerate','login']){
  const h=harness(),wait=deferred();let pending;if(phase==='enumerate'){h.live.api.getWalletAccounts=()=>wait.promise;pending=h.fn.openWalletChooser();}else{await h.fn.openWalletChooser();h.live.walletChooser.selected=B;h.live.api.loginWallet=()=>wait.promise;pending=h.fn.confirmWalletChoice();}
  event==='close'?h.fn.closeWalletChooser():h.invalidate();wait.resolve(phase==='enumerate'?[A,B]:h.context(B));await pending;assert.equal(h.live.walletChooser,null);assert.equal(h.live.context.session,null);assert.equal(h.dialog.open,false);assert.equal(h.location.hash,'#register');
 }
});

test('identity clearing and cancellation invalidate adapter login as well as UI generation',async()=>{
 const h=harness();let invalidations=0;h.live.api.invalidateSession=()=>{invalidations++;};
 await h.fn.openWalletChooser();assert.equal(invalidations,1);
 h.live.walletChooser.selected=B;const wait=deferred();h.live.api.loginWallet=()=>wait.promise;const pending=h.fn.confirmWalletChoice();h.fn.closeWalletChooser();assert.equal(invalidations,2);
 wait.resolve(h.context(B));await pending;assert.equal(h.live.context.session,null);assert.equal(h.live.reloginRequired,true);
 h.invalidate();assert.equal(invalidations,3);assert.equal(h.live.context.session,null);
});
