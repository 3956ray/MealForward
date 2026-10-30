import {createSiweMessage} from 'viem/siwe';
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {JSDOM} from 'jsdom';
const dir=await mkdtemp(tmpdir()+'/mf-entry-'),base=new URL('../',import.meta.url);
await build({entryPoints:[new URL('catalog-entry.jsx',base).pathname],outfile:dir+'/entry.mjs',bundle:true,format:'esm',platform:'node',jsx:'transform',tsconfigRaw:{compilerOptions:{jsx:'react'}},plugins:[{name:'external-runtime',setup(b){b.onResolve({filter:/^(react|react-dom\/client|\.\/wallet.mjs|\.\/guards.mjs)$/},({path})=>({path:new URL(path.startsWith('./')?path:'node_modules/'+path+(path==='react'?'/index.js':'.js'),base).pathname,external:true}));}}]});
const dom=new JSDOM('<div id="test"></div>',{url:'https://mealforward-test.onrender.com'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,location:dom.window.location,HTMLElement:dom.window.HTMLElement,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true});
const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client'),{CatalogEntry}=await import(dir+'/entry.mjs');
let root;const tick=()=>new Promise(r=>setTimeout(r,0));
const response=(value,status=200)=>({ok:status===200,status,json:async()=>value});
const catalog={stores:[],meals:[],asset:{symbol:'USDC',decimals:6},fundingEnabled:false};
function loginChallenge(account){const issuedAt=new Date(Math.floor(Date.now()/1000)*1000),challengeId='11111111-2222-3333-4444-555555555555';return {challengeId,message:createSiweMessage({address:account,domain:location.host,uri:location.origin,chainId:10143,version:'1',nonce:'ab'.repeat(32),statement:'Sign in to MealForward with your test wallet.',requestId:challengeId,issuedAt,expirationTime:new Date(issuedAt.getTime()+180000)})};}
function fixture({capability=true,configuration={verified:true,profile:'monad-testnet',chainId:10143,asset:'0x534b2f3a21130d7a60830c2df862319e593943a3',escrow:'0x'+'aa'.repeat(20)},orders=()=>response({items:[]}),extra=()=>undefined}={}) {
 let account='0x1111111111111111111111111111111111111111',onChange,connections=0,signatures=0,sends=0,configurations=0;
 const walletFactory=options=>{onChange=options.onChange;return {providers:()=>[{id:'test',name:'测试钱包'}],configure(){configurations++;},select(){onChange();},connect:async()=>{connections++;return {account,chainId:10143};},signMessage:async()=>{signatures++;return 'synthetic-signature';},sendTransaction:async()=>{sends++;throw Error('unexpected wallet send');},dispose(){}};};
 const fetchImpl=async(path,options)=>{const custom=extra(path.slice('/v1/product'.length),options);if(custom!==undefined)return custom;switch(path.slice('/v1/product'.length)){
 case '/catalog':return response(catalog);
 case '/configuration':return response(configuration);
 case '/identity/setup':return response({walletLoginEnabled:capability,walletLoginChainId:10143,walletLoginOrigin:location.origin});
 case '/auth/pre-session':return response({csrf:'synthetic-csrf'});
 case '/identity/wallet/challenge':return response(loginChallenge(account));
 case '/identity/wallet/login':return response({csrf:'new-synthetic-csrf'});
 case '/me':return response({wallet:account,stores:[]});
 case '/orders':return orders();
 case '/approvals':return response({items:[]});
 case '/auth/logout':return response({});
 default:throw Error(path);
 }};
 return {walletFactory,fetchImpl,get connections(){return connections;},get configurations(){return configurations;},get signatures(){return signatures;},get sends(){return sends;},change(){account='0x2222222222222222222222222222222222222222';onChange();}};
}
async function mount(f){localStorage.clear();document.body.innerHTML='<div id="test"></div>';root=createRoot(document.getElementById('test'));await act(async()=>{root.render(React.createElement(CatalogEntry,f));await tick();});}
async function click(text){await act(async()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent===text);assert.ok(b,text);b.click();await tick();await tick();});}
async function login(){await click('钱包登录');await click('测试钱包');}
async function clean(){await act(async()=>root.unmount());}
test('non-true capability prevents wallet connection and signature',async()=>{
 for(const capability of [false,'false',1,null]){const f=fixture({capability});await mount(f);try{await login();assert.equal(f.connections,0);assert.equal(f.signatures,0);assert.ok(document.body.textContent.includes('新产品登录尚未接通'));}finally{await clean();}}
});
test('current 401 removes authenticated UI',async()=>{
 const f=fixture({orders:()=>response({error:'UNAUTHENTICATED'},401)});await mount(f);try{await login();assert.ok(document.body.textContent.includes('退出登录'));await click('我的支持');assert.ok(!document.body.textContent.includes('退出登录'));assert.ok(document.body.textContent.includes('钱包登录'));}finally{await clean();}
});
test('late 401 from old wallet cannot revoke a newer login',async()=>{
 let finish,reads=0;const f=fixture({orders:()=>++reads===1?new Promise(r=>finish=r):response({items:[]})});await mount(f);
 try{await login();await click('我的支持');await act(async()=>{f.change();await tick();});await login();assert.ok(document.body.textContent.includes('退出登录'));await act(async()=>{finish(response({error:'UNAUTHENTICATED'},401));await tick();});assert.ok(document.body.textContent.includes('退出登录'));assert.equal(f.signatures,2);}finally{await clean();}
});
after(async()=>{dom.window.close();await rm(dir,{recursive:true,force:true});});

test('GET recovery records only the original journal hash and reconciles without resending',async()=>{
 const wallet='0x1111111111111111111111111111111111111111',hash='0x'+'ab'.repeat(32),op={id:'original',kind:'support',wallet,name:'原订单',quantity:'1',amount:'7000000',version:1,state:'SEND_UNKNOWN'},calls=[];
 const f=fixture({orders:()=>response({items:[op]}),extra:(p,o)=>{if(p.startsWith('/intents/')){calls.push([p,o]);if(p==='/intents/original')return response(op);if(p.endsWith('/hash')){assert.deepEqual(JSON.parse(o.body),{txHash:hash});return response({...op,candidateHash:hash});}if(p.endsWith('/reconcile'))return response({...op,state:'CONFIRMED',txHash:hash});}return undefined;}});
 await mount(f);try{await login();localStorage.setItem('mf-product-wallet-v1:'+wallet+':/intents/original',JSON.stringify({wallet,id:op.id,kind:op.kind,attempted:true,txHash:hash}));await click('我的支持');await click('查看原请求');assert.deepEqual(calls.map(([p,o])=>[p,o.method]),[['/intents/original','GET'],['/intents/original/hash','POST'],['/intents/original/reconcile','POST']]);assert.equal(f.sends,0);assert.ok(document.querySelector('[role=dialog]').textContent.includes('资助已确认'));}finally{await clean();}
});
test('GET is the authoritative reconciliation for already recorded candidate or bound hashes',async()=>{
 for(const state of ['SEND_UNKNOWN','HASH_BOUND']){const wallet='0x1111111111111111111111111111111111111111',hash='0x'+'cd'.repeat(32),op={id:'original',kind:'support',wallet,name:'原订单',quantity:'1',amount:'7000000',version:1,state},calls=[];const f=fixture({orders:()=>response({items:[op]}),extra:(p,o)=>{if(p.startsWith('/intents/')){calls.push([p,o.method]);assert.equal(p,'/intents/original');return response({...op,state:'CONFIRMED',candidateHash:hash,txHash:hash});}return undefined;}});await mount(f);try{await login();localStorage.setItem('mf-product-wallet-v1:'+wallet+':/intents/original',JSON.stringify({wallet,id:op.id,kind:op.kind,attempted:true,txHash:hash}));await click('我的支持');await click('查看原请求');assert.deepEqual(calls,[['/intents/original','GET']]);assert.equal(f.sends,0);assert.ok(document.querySelector('[role=dialog]').textContent.includes('资助已确认'));}finally{await clean();}}
});

test('public origin cannot configure local acceptance or a changed production token before wallet action',async()=>{
 for(const configuration of [{verified:true,profile:'local-acceptance',chainId:31337,asset:'0x'+'bb'.repeat(20),escrow:'0x'+'aa'.repeat(20)},{verified:true,chainId:10143,asset:'0x'+'bb'.repeat(20),escrow:'0x'+'aa'.repeat(20)},{verified:true,chainId:31337,asset:'0x534b2f3a21130d7a60830c2df862319e593943a3',escrow:'0x'+'aa'.repeat(20)}]){const f=fixture({configuration});await mount(f);try{await login();assert.equal(f.configurations,0);assert.equal(f.connections,0);assert.equal(f.signatures,0);assert.equal(f.sends,0);assert.ok(document.body.textContent.includes('PRODUCT_CONFIGURATION_UNVERIFIED'));}finally{await clean();}}
});
test('discovery renders no wallet action; invalid SIWE is rejected before signature',async()=>{
 const f=fixture({extra:p=>p==='/identity/wallet/challenge'?response({...loginChallenge('0x1111111111111111111111111111111111111111'),message:loginChallenge('0x1111111111111111111111111111111111111111').message.replace('Chain ID: 10143','Chain ID: 31337')}):undefined});await mount(f);try{assert.equal(f.connections,0);assert.equal(f.signatures,0);assert.equal(f.configurations,0);await login();assert.equal(f.configurations,1);assert.equal(f.connections,1);assert.equal(f.signatures,0);assert.equal(f.sends,0);assert.ok(document.body.textContent.includes('INVALID_LOGIN_CHALLENGE'));}finally{await clean();}
});
