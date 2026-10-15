// Exercise real app event handlers without invoking a browser, wallet or network.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {hasOwnedKitchen} from './dist/onboarding-view.mjs';
const source=readFileSync(new URL('./dist/app.js',import.meta.url),'utf8');
const viewSource=readFileSync(new URL('./dist/onboarding-view.mjs',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('function checkLiveGeneration('),source.indexOf('async function startLive('));
const login=source.slice(source.indexOf('async function startMetaMaskLogin('),source.indexOf('function supportCurrent('));
const clicks=source.slice(source.indexOf("document.addEventListener('click',event=>{\n if(!LIVE_MODE"),source.indexOf("document.addEventListener('submit',event=>{\n if(!LIVE_MODE"));
const message=source.split('\n').find(line=>line.startsWith('function liveMessage('));
const enter=source.split('\n').find(line=>line.startsWith('function canEnterKitchen('));
const A='0xc4f8a468f10d5f98dcff3282516125e97f26433b',B='0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952';
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};};
function harness(initial=A,connected=B){
 const context=wallet=>({session:{wallet,stores:wallet===A?['store']:[]},store:wallet===A?{id:'store',name:'Original kitchen'}:null,setup:{walletLoginEnabled:true},registration:null,registrations:[]});
 const events={},calls=[],renders=[],body={innerHTML:''},main={querySelector:()=>null},location={hash:'#register'};
 const live={generation:0,context:context(initial),reloginRequired:false,signingIn:false,mealEditor:null,ownerMeals:[{name:'Old owner private meal'}],ownerMealStoreId:'store',mealCapabilities:{edit:true},mealUnavailableReasons:{},overview:{private:'old'},preview:'',busy:false,loading:false,signed:false,error:''};
 live.api={invalidateSession:()=>calls.push('invalidate'),loginWithMetaMask:()=>{calls.push('metamask');return Promise.resolve(context(connected));},getOwnerMeals:async()=>({items:[],capabilities:{}}),getOwnerOverview:async()=>({})};
 const fn=new Function('live','body','main','location','hasOwnedKitchen','events','renders',`const LIVE_MODE=true;const renderLive=()=>renders.push({busy:live.busy,signingIn:live.signingIn});const readLiveDraft=()=>{};const closeSupportFlow=()=>{live.support=null;};const closeLiveMealEditor=()=>{live.mealEditor=null;};const closeMealPublish=()=>{};const closeSettlementFlow=()=>{};const closeVerificationEntry=()=>{};const closeClaimFlow=()=>{};const document={addEventListener:(name,fn)=>{events[name]=fn;}};const window={addEventListener:(name,fn)=>{events[name]=fn;}};${message}\n${enter}\n${helpers}\n${login}\n${clicks}\nreturn {startMetaMaskLogin};`)(live,body,main,location,hasOwnedKitchen,events,renders);
 return {live,calls,renders,location,context,fn,click:action=>events.click({target:{closest:()=>({dataset:{liveAction:action},disabled:false})}}),invalidate:()=>events['mealforward-session-invalidated']()};
}
test('login directly requests MetaMask, without any website account chooser',async()=>{
 const h=harness();await h.click('account');assert.deepEqual(h.calls,['invalidate','metamask']);
 assert.equal(h.live.context.session.wallet,B);assert.equal(h.live.context.store,null);assert.deepEqual(h.live.ownerMeals,[]);assert.equal(h.location.hash,'#stores');
 assert.equal(h.live.signingIn,false);assert.equal(h.live.busy,false);assert.ok(h.renders.some(v=>v.signingIn));
 assert.doesNotMatch(source,/walletChooser|openWalletChooser|wallet-confirm|wallet-connect|wallet-choice/);
 assert.doesNotMatch(viewSource,/Choose your wallet account|wallet-choice|Continue with selected account/);
});
test('account switch back to original owner loads only verified owner workspace',async()=>{
 const h=harness(B,A);await h.click('switch-wallet');assert.equal(h.live.context.session.wallet,A);assert.equal(h.live.context.store.id,'store');assert.equal(h.location.hash,'#merchant/overview');
});
test('MetaMask rejection leaves page anonymous and shows a helpful error',async()=>{
 const h=harness();h.live.api.loginWithMetaMask=async()=>{h.calls.push('metamask');throw Object.assign(Error('User rejected'),{code:4001});};
 await h.click('login');assert.equal(h.live.context.session,null);assert.match(h.live.error,/cancelled the MetaMask request/);
 assert.equal(h.location.hash,'#register');assert.equal(h.live.signingIn,false);
});
test('invalid session response cannot reopen cached private owner data',async()=>{
 const h=harness();h.live.api.loginWithMetaMask=async()=>({setup:{walletLoginEnabled:true},session:{wallet:'invalid'},store:{id:'store'}});
 await h.click('login');assert.equal(h.live.context.session,null);assert.equal(h.live.context.store,null);assert.deepEqual(h.live.ownerMeals,[]);assert.match(h.live.error,/could not be verified/);
});
test('wallet account event discards a late pending MetaMask login',async()=>{
 const h=harness(),pending=deferred();h.live.api.loginWithMetaMask=()=>{h.calls.push('metamask');return pending.promise;};
 const signIn=h.click('login');assert.equal(h.live.busy,true);h.invalidate();pending.resolve(h.context(A));await signIn;
 assert.equal(h.live.context.session,null);assert.deepEqual(h.live.ownerMeals,[]);assert.equal(h.location.hash,'#register');
});
test('double clicking login while MetaMask is open cannot request twice',async()=>{
 const h=harness(),pending=deferred();h.live.api.loginWithMetaMask=()=>{h.calls.push('metamask');return pending.promise;};
 const first=h.click('login');await h.click('login');assert.equal(h.calls.filter(x=>x==='metamask').length,1);
 pending.resolve(h.context(B));await first;assert.equal(h.live.context.session.wallet,B);
});
test('a missing API does not show a fake login confirmation',async()=>{
 const h=harness();h.live.api={invalidateSession:()=>{}};await h.click('login');assert.equal(h.live.context.session.wallet,A);assert.match(h.live.error,/login service is not connected/);
 assert.equal(h.calls.length,0);
});
test('MetaMask switch during sign-in invalidates API session and original UI context',async()=>{
 const h=harness(),wait=deferred();let invalidations=0;h.live.api.invalidateSession=()=>invalidations++;
 h.live.api.loginWithMetaMask=()=>wait.promise;const pending=h.click('login');assert.equal(invalidations,1);
 h.invalidate();assert.equal(invalidations,2);wait.resolve(h.context(B));await pending;
 assert.equal(h.live.context.session,null);assert.equal(h.live.reloginRequired,true);
});
