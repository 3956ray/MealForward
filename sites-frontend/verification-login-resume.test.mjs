// Regression: a short-lived private QR link must survive only the *current*
// kitchen-owner sign-in and may never initiate a redemption by itself.
// Tests run against isolated source handlers; no wallet, chain, server or secrets.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./dist/app.js',import.meta.url),'utf8');
const login=source.slice(source.indexOf('async function startMetaMaskLogin('),source.indexOf('function supportCurrent('));
const link=source.slice(source.indexOf('function takeVerificationLink('),source.indexOf('function verificationCurrent('));
const code='v'.repeat(43),origin='https://localhost:16443',privateUrl=origin+'/#verify?code='+code;
function qrFixture(){
 const live={pendingVerification:null},location={origin,pathname:'/',search:'',hash:'#verify?code='+code};
 const history={replaceState(_s,_t,path){location.hash=path.slice(path.indexOf('#'));}};
 const take=new Function('live','location','history',link+'\nreturn takeVerificationLink;')(live,location,history);
 return {live,location,take};
}
function loginFixture({owner=true,expire=false,reject=false,defer=false}={}){
 const calls=[],live={
  generation:0,busy:false,backendOffline:false,error:'',reloginRequired:false,signingIn:false,
  context:{session:null,setup:{}},pendingVerification:{input:privateUrl,expiresAt:Date.now()+(expire?-1:120000)}
 };
 const location={hash:'#merchant/verify'};
 let done;
 const response={session:{wallet:'0x'+'a'.repeat(40)},setup:{},store:owner?{id:'kitchen'}:null};
 live.api={invalidateSession(){calls.push('invalidate');},loginWithMetaMask(){calls.push('signin');if(reject)return Promise.reject(Error('User rejected'));if(defer)return new Promise(resolve=>done=resolve);return Promise.resolve(response);}};
 const fn=new Function('live','location','calls','owner',`
 const renderLive=()=>{};const showLiveError=()=>{};
 const clearLiveIdentity=()=>{live.generation++;live.pendingVerification=null;live.context={session:null,setup:{}};};
 const checkLiveGeneration=g=>{if(g!==live.generation)throw Error('stale');};
 const acceptContext=value=>{live.context=value;};
 const canEnterKitchen=()=>owner&&!!live.context.session;
 const openVerificationEntry=input=>calls.push(['open-review-only',input]);
 const loadLiveKitchen=async()=>{};const loadLiveCatalog=async()=>{};
 const handleSupportAction=async()=>{throw Error('unrelated support action');};
 const handleClaimAction=async()=>{throw Error('unrelated claim action');};
 const liveMessage=e=>e.message;
 ${login}
 return {startMetaMaskLogin};
 `)(live,location,calls,owner);
 return {live,location,calls,start:()=>fn.startMetaMaskLogin(),resolve:()=>done(response)};
}
test('private QR URL is removed from address bar and retained only in memory',()=>{
 const h=qrFixture();const result=h.take();
 assert.equal(result,privateUrl);assert.equal(h.location.hash,'#merchant/verify');
 assert.equal(h.live.pendingVerification.input,privateUrl);
 assert.ok(h.live.pendingVerification.expiresAt>=Date.now());
 assert.doesNotMatch(link,/localStorage|sessionStorage/);
});
test('owner sign-in reopens only the check dialog for the original code',async()=>{
 const h=loginFixture();await h.start();
 assert.deepEqual(h.calls.filter(c=>Array.isArray(c)),[['open-review-only',privateUrl]]);
 assert.equal(h.live.pendingVerification,null);
 assert.equal(h.location.hash,'#merchant/verify');
});
test('non-owner cannot open the private voucher after login',async()=>{
 const h=loginFixture({owner:false});await h.start();
 assert.ok(!h.calls.some(Array.isArray));assert.match(h.live.error,/kitchen owner wallet/);
 assert.equal(h.live.pendingVerification,null);
});
test('expired code is not reopened, even when wallet sign-in succeeds',async()=>{
 const h=loginFixture({expire:true});await h.start();
 assert.ok(!h.calls.some(Array.isArray));assert.match(h.live.error,/expired/);
});
test('rejected sign-in clears pending credentials and never verifies',async()=>{
 const h=loginFixture({reject:true});await h.start();
 assert.equal(h.live.context.session,null);assert.equal(h.live.pendingVerification,null);
 assert.ok(!h.calls.some(Array.isArray));
});
test('changing route during wallet sign-in discards the QR return',async()=>{
 const h=loginFixture({defer:true});const p=h.start();
 h.location.hash='#about';h.resolve();await p;
 assert.equal(h.location.hash,'#about');assert.ok(!h.calls.some(Array.isArray));
 assert.equal(h.live.pendingVerification,null);
});
test('a different route clears the token and no source handler auto-redeems',()=>{
 const route=source.split('\n').find(line=>line.startsWith("window.addEventListener('hashchange',"));
 assert.match(route,/live\.pendingVerification=null/);
 assert.ok(login.includes('openVerificationEntry(pendingVerification.input)'));
 assert.doesNotMatch(login,/\.checkVoucher\(|\.lockVoucher\(|\.confirmHandover\(|\.confirmSettlement\(/);
});
