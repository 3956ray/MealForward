import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createLiveApi,guardAuthOnlyRequest,isAuthOnlyBackend} from '../dist/live-api.mjs';

const wallet='0x'+'a'.repeat(40),origin='https://mealforward-cp31-auth-laodao.onrender.com';
const ok=data=>({status:200,ok:true,json:async()=>data});
const unauthorized={status:401,ok:false,json:async()=>({error:'UNAUTHENTICATED'})};

function fixture({loggedIn=false,mode='CP31_AUTH_PILOT_ONLY'}={}){
 const calls=[];
 const storageMap=new Map(loggedIn?[['mealforward-live-csrf-v1','csrf-pilot']]:[]);
 const storage={getItem:k=>storageMap.get(k)||null,setItem:(k,v)=>storageMap.set(k,v),removeItem:k=>storageMap.delete(k)};
 const provider={on(){},removeListener(){},request:async({method})=>{
  if(method==='eth_accounts')return [wallet];
  if(method==='eth_chainId')return '0x279f';
  throw Error('No wallet transaction is permitted by this fixture');
 }};
 const data={
  '/v1/connection':{mode,authPilot:true,registrationEnabled:false,assetDecimals:6,transactionActionsEnabled:false},
  '/v1/identity/setup':{walletLoginEnabled:true,walletLoginChainId:10143,walletLoginOrigin:origin,authPilot:true},
  '/v1/me':{walletAddress:wallet,stores:[],authPilot:true},
  '/v1/stores':{items:[],authPilot:true},
  '/v1/store-registrations':{items:[]}
 };
 const fetchImpl=async(path,options)=>{
  calls.push([options.method,path]);
  if(path==='/v1/me'&&!loggedIn)return unauthorized;
  if(Object.hasOwn(data,path))return ok(data[path]);
  return {status:503,ok:false,json:async()=>({error:'AUTH_PILOT_NO_BUSINESS_WRITES'})};
 };
 const api=createLiveApi({fetchImpl,storage,provider:()=>provider,origin:()=>origin,onSessionInvalidated(){}});
 return {api,calls};
}

test('auth pilot metadata cannot masquerade as business connectivity',()=>{
 assert.equal(isAuthOnlyBackend({mode:'CP31_AUTH_PILOT_ONLY'},{}),true);
 assert.equal(isAuthOnlyBackend({authPilot:true},{}),true);
 assert.equal(isAuthOnlyBackend({}, {authPilot:true}),true);
 assert.equal(isAuthOnlyBackend({mode:'REAL_CP30',authPilot:false},{authPilot:false}),false);
});

test('auth pilot permits only wallet sign-in/logout POST routes',()=>{
 for(const path of ['/v1/auth/pre-session','/v1/identity/wallet/challenge','/v1/identity/wallet/login','/v1/auth/logout']){
  assert.equal(guardAuthOnlyRequest(true,'POST',path),undefined);
 }
 for(const path of ['/v1/support/intents','/v1/claims/intents','/v1/store-registrations','/v1/stores/x/locks','/v1/stores/x/payouts/x/settle-intents','/v1/vouchers/x/display']){
  assert.throws(()=>guardAuthOnlyRequest(true,'POST',path),{code:'AUTH_PILOT_NO_BUSINESS_WRITES'});
 }
 assert.equal(guardAuthOnlyRequest(true,'GET','/v1/me'),undefined);
 assert.equal(guardAuthOnlyRequest(false,'POST','/v1/support/intents'),undefined);
});

test('anonymous authenticating origin remains anonymous; none of the original stores are fabricated',async()=>{
 const h=fixture();
 const data=await h.api.getContext();
 assert.equal(data.setup.authPilot,true);
 assert.equal(data.setup.walletLoginEnabled,true);
 assert.equal(data.setup.registrationEnabled,false);
 assert.equal(data.setup.transactionActionsEnabled,false);
 assert.equal(data.session,null);
 assert.equal(data.store,null);
 assert.deepEqual(await h.api.listStores(),[]);
 assert.ok(h.calls.every(([method])=>method==='GET'));
});

test('authenticated pilot session preserves exact wallet address without assigning original kitchen rights',async()=>{
 const h=fixture({loggedIn:true});
 const data=await h.api.getContext();
 assert.equal(data.session.wallet,wallet);
 assert.equal(data.setup.authPilot,true);
 assert.deepEqual(data.session.stores,[]);
 assert.deepEqual(data.registrations,[]);
 assert.equal(data.store,null);
 assert.ok(h.calls.every(([method])=>method==='GET'));
});

test('auth pilot cannot issue a business review or claim when a valid wallet session exists',async()=>{
 const h=fixture({loggedIn:true});
 await h.api.getContext();
 await assert.rejects(h.api.createClaimReview({storeId:'a'.repeat(64),mealId:'b'.repeat(64)}));
 assert.ok(!h.calls.some(([method])=>method==='POST'));
});

const src=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
const start=src.indexOf('function isAuthOnlyMode('),end=src.indexOf('function renderLive(');
if(start<0||end<=start)throw Error('Identity-only interface boundary missing');
const helpers=src.slice(start,end);

function uiFixture(authPilot=true){
 const selectors={'.store-grid':{innerHTML:'REAL BUSINESSES WERE HERE'},'.summary-strip':{innerHTML:'Old stats'},'.hero-ctas':{innerHTML:'Old support button'},'.ledger-teaser':{innerHTML:'Old ledger'},'.how-steps':{innerHTML:'Old steps'}};
 const main={innerHTML:'Original business UI',inserted:[],querySelector:key=>selectors[key]??null,insertAdjacentHTML(where,markup){this.inserted.push(markup)}};
 const workspace={hidden:false};
 const document={querySelector:key=>key==='#workspace-link'?workspace:null};
 const live={context:{setup:{authPilot},session:null}};
 const render=new Function('live','main','document',helpers+';return maskUnavailableBusinessOnPilot;')(live,main,document);
 return {render,main,selectors,workspace};
}
test('pilot routes visibly say wallet identity only and do not show phantom empty orders',()=>{
 const h=uiFixture();h.render('contributions',null);
 assert.match(h.main.innerHTML,/MetaMask sign-in test/);
 assert.match(h.main.innerHTML,/not connected/);
 assert.equal(h.workspace.hidden,true);
 assert.match(h.main.inserted.join(''),/No original meal/);
});
test('pilot home shows sign-in without fake funded portions or business buttons',()=>{
 const h=uiFixture();h.render('home',null);
 assert.match(h.selectors['.store-grid'].innerHTML,/No CP30 business data connected/);
 assert.match(h.selectors['.hero-ctas'].innerHTML,/Test MetaMask sign-in/);
 assert.doesNotMatch(h.selectors['.hero-ctas'].innerHTML,/Support a meal/);
 assert.equal(h.workspace.hidden,true);
});
test('real full backend mode preserves original public and private UI',()=>{
 const h=uiFixture(false);h.render('contributions',{wallet});
 assert.equal(h.main.innerHTML,'Original business UI');
 assert.deepEqual(h.main.inserted,[]);
 assert.equal(h.workspace.hidden,false);
});
