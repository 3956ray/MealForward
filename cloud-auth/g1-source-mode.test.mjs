import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createLiveApi} from '../sites-frontend/dist/live-api.mjs';

const src=readFileSync(new URL('../sites-frontend/dist/app.js',import.meta.url),'utf8');
const start=src.indexOf('async function loadLiveCatalog('),end=src.indexOf('function requireLiveOwner(',start);
assert.ok(start>0&&end>start,'G1 catalog loaders missing');
const declarations=src.slice(start,end);
const address='0x'+'1'.repeat(40),origin='https://mealforward-cp31-auth-laodao.onrender.com';

test('real Auth Pilot never fetches inaccessible business rows during session setup',async()=>{
 const paths=[];
 const state=new Map([['mealforward-live-csrf-v1','csrf']]);
 const storage={getItem:k=>state.get(k)||null,setItem:(k,v)=>state.set(k,v),removeItem:k=>state.delete(k)};
 const provider={on(){},removeListener(){},async request({method}){
   if(method==='eth_accounts')return [address];
   if(method==='eth_chainId')return '0x279f';
   throw Error('Unexpected MetaMask action');
 }};
 const fetchImpl=async(path,request)=>{
  paths.push([path,request.method]);
  const replies={
    '/v1/connection':{mode:'CP31_AUTH_PILOT_ONLY',authPilot:true,registrationEnabled:false,businessSourceConnected:false,originalPrincipalCompatible:false,transactionActionsEnabled:false},
    '/v1/identity/setup':{walletLoginEnabled:true,walletLoginChainId:10143,walletLoginOrigin:origin,authPilot:true},
    '/v1/me':{walletAddress:address,stores:[],authPilot:true}
  };
  if(!Object.hasOwn(replies,path))throw Error('Original CP30 business route was queried by Auth Pilot');
  return {ok:true,status:200,json:async()=>replies[path]};
 };
 const api=createLiveApi({fetchImpl,storage,provider:()=>provider,origin:()=>origin,onSessionInvalidated(){}});
 const context=await api.getContext();
 assert.equal(context.session.wallet,address);
 assert.equal(context.setup.authPilot,true);
 assert.equal(context.setup.businessSourceConnected,false);
 assert.equal(context.store,null);
 assert.deepEqual(context.registrations,[]);
 assert.deepEqual(paths.map(([path])=>path),['/v1/connection','/v1/identity/setup','/v1/me']);
});

test('auth-only catalog reset never tries to fake or fetch meals',async()=>{
 const live={stores:[{id:'stale'}],meals:{stale:[{listed:true,eligible:true}]},catalogError:'',context:{setup:{authPilot:true}}};
 const loader=new Function('live','isAuthOnlyMode','currentLiveResult',
  declarations+';return {loadLiveCatalog,loadPublicLedger}')(live,()=>true,()=>{throw Error('Forbidden CP30 API request')});
 await loader.loadLiveCatalog();
 await loader.loadPublicLedger();
 assert.deepEqual(live.stores,[]);
 assert.deepEqual(live.meals,{});
 assert.deepEqual(live.publicLedger,[]);
 assert.match(live.catalogError,/not connected/);
 assert.match(live.publicLedgerError,/not connected/);
});

test('initial page requests service mode before choosing whether to fetch business catalog',()=>{
 const start=src.indexOf('async function startLive(');
 const end=src.indexOf('function liveInput',start);
 assert.ok(start>=0);
 const body=src.slice(start,end>start?end:start+2500);
 const context=body.indexOf('await loadLiveContext(generation)');
 const catalog=body.indexOf('await loadLiveCatalog(generation)');
 assert.ok(context>=0&&catalog>context,'Mode handshake must precede business requests');
 assert.doesNotMatch(body,/Promise\.allSettled\(\[loadLiveContext\(generation\),loadLiveCatalog\(generation\)\]\)/);
});
