// Regression tests for preserving a public meal selection through MetaMask sign-in.
// Pure in-memory UI tests: no backend, browser, wallet extension or transaction.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./dist/app.js',import.meta.url),'utf8');
const login=source.slice(source.indexOf('async function startMetaMaskLogin('),source.indexOf('function supportCurrent('));
const wallet='0x'+'a'.repeat(40);
function fixture(kind,{available=true,stale=false,changedRoute=false,owner=false,loginFails=false}={}){
 const calls=[],store={id:'store'},meal={id:'meal',listed:true,eligible:true,available:available?1:0};
 const live={generation:0,busy:false,backendOffline:false,reloginRequired:false,context:{session:null,setup:{}},stores:[store],meals:{store:[meal]},catalogError:'',error:'',signingIn:false};
 const location={hash:'#store/store'};
 const api={
  invalidateSession(){calls.push('invalidate');},
  async loginWithMetaMask(){calls.push('login');if(loginFails)throw Error('rejected');if(changedRoute)location.hash='#about';return {session:{wallet},setup:{},store:owner?store:null};}
 };
 live.api=api;
 const f=new Function('live','location','calls',`
 const renderLive=()=>{};const showLiveError=()=>{};
 const clearLiveIdentity=()=>{live.generation++;live.context={session:null,setup:{}};};
 const checkLiveGeneration=g=>{if(g!==live.generation)throw Error('stale generation');};
 const acceptContext=ctx=>{live.context=ctx;};
 const canEnterKitchen=()=>!!live.context.store;
 const loadLiveKitchen=async()=>calls.push('owner');
 const loadLiveCatalog=async()=>{calls.push('catalog');if(${stale})live.catalogError='stale';};
 const handleSupportAction=async(action,target)=>calls.push(['support',action,target.dataset]);
 const handleClaimAction=async(action,target)=>calls.push(['claim',action,target.dataset]);
 const liveMessage=e=>e.message;
 ${login}
 return {startMetaMaskLogin};
 `)(live,location,calls);
 return {live,calls,location,start:()=>f.startMetaMaskLogin({kind,storeId:'store',mealId:'meal'})};
}
test('support selection returns after sign-in without creating review/payment',async()=>{
 const h=fixture('support');await h.start();
 assert.equal(h.calls.filter(c=>Array.isArray(c)).length,1);
 assert.deepEqual(h.calls.at(-1),['support','support-start',{storeId:'store',mealId:'meal'}]);
 assert.equal(h.location.hash,'#store/store');
});
test('claim selection returns after sign-in without issuing voucher',async()=>{
 const h=fixture('claim');await h.start();
 assert.deepEqual(h.calls.at(-1),['claim','claim-start',{storeId:'store',mealId:'meal'}]);
});
test('recipient cannot resume an unavailable meal',async()=>{
 const h=fixture('claim',{available:false});await h.start();
 assert.match(h.live.error,/no longer available/);
 assert.equal(h.calls.some(c=>Array.isArray(c)),false);
});
test('catalog failures fail closed before reopening a flow',async()=>{
 const h=fixture('support',{stale:true});await h.start();
 assert.match(h.live.error,/could not be verified/);
 assert.equal(h.calls.some(c=>Array.isArray(c)),false);
});
test('navigating away while signing suppresses stale actions',async()=>{
 const h=fixture('support',{changedRoute:true});await h.start();
 assert.equal(h.location.hash,'#about');
 assert.equal(h.calls.some(c=>Array.isArray(c)),false);
});
test('failed login cannot resume an action',async()=>{
 const h=fixture('claim',{loginFails:true});await h.start();
 assert.equal(h.live.context.session,null);
 assert.equal(h.calls.some(c=>Array.isArray(c)),false);
});
test('no selected action preserves existing owner workspace routing',async()=>{
 const h=fixture('support',{owner:true});
 // Regular account login is intentionally unaffected.
 const src=source.slice(source.indexOf('async function startMetaMaskLogin('),source.indexOf('function supportCurrent('));
 assert.match(src,/else if\(canEnterKitchen\(\)\)/);
});
