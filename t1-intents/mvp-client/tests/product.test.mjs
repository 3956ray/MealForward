import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { productRoute, scopedPath, captureProductInvite } from '../product-state.mjs';
const tmp = await mkdtemp(new URL('../.product-test-',import.meta.url).pathname);
await build({entryPoints:[new URL('../product.jsx',import.meta.url).pathname],outdir:tmp,bundle:true,format:'esm',packages:'external',jsx:'transform'});
const dom = new JSDOM('<div id="test"></div>',{url:'https://mvp.example/mvp/product.html#businessId=1&role=owner'});
for (const name of ['window','document','location','localStorage','HTMLElement','Event','MouseEvent']) globalThis[name]=dom.window[name];
globalThis.requestAnimationFrame = fn=>setTimeout(fn,0);globalThis.cancelAnimationFrame=clearTimeout;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const React = await import('react');const {act}=React;const {createRoot}=await import('react-dom/client');const {Product}=await import(tmp+'/product.js');
const walletFactory=()=>({providers:()=>[],dispose(){}});
const session={role:'owner',csrf:'test',wallet:'0x0'};
const businesses={businesses:[{id:'1',phase:'SETTLED'},{id:'2',phase:'ISSUED'}],canCreate:false};
const tick=()=>new Promise(r=>setTimeout(r,15));
let root;
async function mount(api){document.body.innerHTML='<div id="test"></div>';root=createRoot(document.getElementById('test'));await act(async()=>{root.render(React.createElement(Product,{api,walletFactory}));await tick();});}
async function navigate(hash){await act(async()=>{location.hash=hash;await tick();});}
async function unmount(){await act(async()=>root.unmount());localStorage.clear();}
test('scopes merchant and operations, keeps authentication global, removes recipient secret',()=>{
 assert.equal(scopedPath('2','/merchant/check'),'/businesses/2/merchant/check');
 assert.equal(scopedPath('2','/operations/id/attempt'),'/businesses/2/operations/id/attempt');
 assert.equal(scopedPath('2','/me'),'/me');assert.equal(scopedPath('2','/auth/logout'),'/auth/logout');
 assert.throws(()=>scopedPath('../2','/setup'));
 const v=new JSDOM('',{url:'https://mvp.example/mvp/product-recipient.html#businessId=2&token=private'}).window;
 assert.deepEqual(captureProductInvite(v),{businessId:'2',token:'private'});assert.equal(v.location.hash,'#businessId=2');
 assert.equal(productRoute('#businessId=2&role=issuer').businessId,'2');
});
const {POLICIES}=await import('../guards.mjs');
function fixture(extra = {}) {
 let change, signed=0, account=POLICIES.owner, chainId=10143, reject=false;
 const factory=({onChange})=>{change=onChange;return {providers:()=>[{id:'p',name:'Wallet'}],select(){},connect:async()=>({account,chainId}),inspect:async()=>({account,chainId}),signMessage:async()=>{signed++;if(extra.sign)return extra.sign(signed);if(reject)throw Error('REJECTED');return 'signature';},dispose(){}};};
 const session={role:'owner',csrf:'test',wallet:POLICIES.owner};
 const api=async(path,options)=>{if(extra.api){const value=extra.api(path,options);if(value !== undefined)return value;}if(path==='/auth/pre-session')return {csrf:'test'};if(path==='/identity/wallet/challenge')return {challengeId:'req12345',message:`mvp.example wants you to sign in with your Ethereum account:\n${POLICIES.owner}\n\nSign in\n\nURI: https://mvp.example\nVersion: 1\nChain ID: 10143\nNonce: abcdefgh\nIssued At: 2026-01-01T00:00:00.000Z\nExpiration Time: 2099-01-01T00:00:00.000Z\nRequest ID: req12345`};if(path==='/identity/wallet/login')return {};if(path==='/me')return session;if(path==='/businesses')return businesses;if(path==='/status')return {enabled:true};if(path.endsWith('/setup'))return {state:{phase:'SETTLED'},operations:[]};throw Error(path);};
 return {factory,api,change:()=>change(),setReject:v=>reject=v,setChain:v=>chainId=v,setAccount:v=>account=v,get signed(){return signed;}};
}
async function mountFixture(f, hash='businessId=1&role=owner') {await navigate(hash);document.body.innerHTML='<div id="test"></div>';root=createRoot(document.getElementById('test'));await act(async()=>{root.render(React.createElement(Product,{api:f.api,walletFactory:f.factory}));await tick();});await act(async()=>{[...document.querySelectorAll("button")].find(b=>b.textContent==="钱包登录").click();await tick();});await act(async()=>{document.querySelector(".wallet-options button").click();});}
async function loginFixture(){await act(async()=>{[...document.querySelectorAll('button')].find(b=>(b.textContent.includes('连接钱包并签名') || b.textContent==='重试登录')).click();await tick();await tick();});}
test('explicit login persists across routes and wallet change clears it',async()=>{
 const {POLICIES}=await import('../guards.mjs'); let change, reads=0, signs=0;
 const wallet=()=>({providers:()=>[{id:'p',name:'Wallet'}],select(){},connect:async()=>({account:POLICIES.owner,chainId:10143}),inspect:async()=>({account:POLICIES.owner,chainId:10143}),signMessage:async()=>{signs++;return 'signature';},dispose(){}});
 const factory=({onChange})=>{change=onChange;return wallet();};
 const verified={role:'owner',csrf:'test',wallet:POLICIES.owner};
 const api=async(path)=>{if(path==='/auth/pre-session')return {csrf:'test'};if(path==='/identity/wallet/challenge')return {challengeId:'req12345',message:`mvp.example wants you to sign in with your Ethereum account:\n${POLICIES.owner}\n\nSign in\n\nURI: https://mvp.example\nVersion: 1\nChain ID: 10143\nNonce: abcdefgh\nIssued At: 2026-01-01T00:00:00.000Z\nExpiration Time: 2099-01-01T00:00:00.000Z\nRequest ID: req12345`};if(path==='/identity/wallet/login')return {};if(path==='/me'){reads++;return verified;}if(path==='/businesses')return businesses;if(path==='/status')return {enabled:true};if(path.endsWith('/setup'))return {state:{phase:'SETTLED'},operations:[]};throw Error(path);};
 await navigate('businessId=1&role=home'); document.body.innerHTML='<div id="test"></div>';root=createRoot(document.getElementById('test'));
 try { await act(async()=>{root.render(React.createElement(Product,{api,walletFactory:factory}));await tick();}); assert.equal(reads,0);
 await act(async()=>document.querySelector('.wallet-header button').click());
 await act(async()=>{[...document.querySelectorAll("button")].find(b=>b.textContent==="钱包登录").click();await tick();});await act(async()=>{document.querySelector(".wallet-options button").click();});
 await act(async()=>{[...document.querySelectorAll('button')].find(b=>(b.textContent.includes('连接钱包并签名') || b.textContent==='重试登录')).click();await tick();await tick();});
 assert.equal(signs,1);assert.equal(reads,1);assert.ok(document.querySelector('.wallet-header').textContent.includes('商家'));
 await navigate('businessId=1&role=records');await navigate('businessId=1&role=home');await navigate('businessId=1&role=owner');assert.equal(reads,1);
 await act(async()=>{change();await tick();});assert.ok(document.body.textContent.includes('钱包登录'));assert.equal(document.querySelector('.product-work'),null);
 } finally {await unmount();}
});
test('anonymous role route does not access protected business',async()=>{
 let calls=[];await navigate('businessId=1&role=owner');await mount(async p=>{calls.push(p);throw Error('LOGIN_REQUIRED');});
 try {assert.ok(document.body.textContent.includes('钱包登录'));assert.deepEqual(calls,[]);} finally {await unmount();}
});
test('business switch discards late response from prior scope',async()=>{
 let resolveOld, reads=0;
 const f=fixture({api:path=>{if(path==='/businesses/1/setup'){if(++reads>1)return new Promise(r=>resolveOld=r);return {state:{phase:'ISSUED'},operations:[],allowedAction:'redeem'};}if(path==='/businesses/2/setup')return {state:{phase:'SETTLED'},operations:[]};}});
 await mountFixture(f);try {await loginFixture();const input=document.querySelector('input[placeholder="000000"]');assert.ok(input);await act(async()=>{const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;setter.call(input,'123456');input.dispatchEvent(new Event('input',{bubbles:true}));});const refresh=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('刷新已确认'));await act(async()=>{refresh.click();await tick();});await navigate('businessId=2&role=owner');assert.equal(document.querySelector('input[placeholder="000000"]'),null);await act(async()=>{resolveOld({state:{phase:'ISSUED'},operations:[{id:'stale',action:'redeem',state:'PREPARED',transaction:{nonce:'0x1'}}],allowedAction:'redeem'});await tick();});assert.equal(document.querySelector('.recovery'),null);assert.ok(document.body.textContent.includes('测试餐款已结算'));}finally{await unmount();}
});
test('rejected signature can retry; wrong network blocks signing',async()=>{
 const f=fixture();await mountFixture(f);try {f.setChain(1);await loginFixture();assert.equal(f.signed,0);f.setChain(10143);f.setReject(true);await loginFixture();assert.equal(f.signed,1);assert.ok(document.querySelector('[role="alert"]'));f.setReject(false);await loginFixture();assert.equal(f.signed,2);assert.ok(document.querySelector('.wallet-header').textContent.includes('商家'));f.setAccount(POLICIES.donor);await act(async()=>{f.change();await tick();});assert.equal(document.querySelector('.product-work'),null);}finally{await unmount();}
});
test('late login response cannot restore changed wallet identity',async()=>{
 let resolveMe, started;const ready=new Promise(r=>started=r);const f=fixture({api:path=>path==='/me'?new Promise(r=>{resolveMe=r;started();}):undefined});await mountFixture(f);try {await act(async()=>{[...document.querySelectorAll('button')].find(b=>(b.textContent.includes('连接钱包并签名') || b.textContent==='重试登录')).click();await ready;});await act(async()=>{f.change();resolveMe({role:'owner',csrf:'test',wallet:POLICIES.owner});await tick();});assert.equal(document.querySelector('.product-work'),null);assert.ok(document.querySelector('.wallet-header').textContent.includes('钱包登录'));}finally{await unmount();}
});
test('wrong role route cannot access work and owner creates eligible business',async()=>{
 let created=0;const f=fixture({api:(path,options)=>{if(path==='/businesses')return options?.body?(created++,{business:{id:'2'}}):{...businesses,canCreate:true};}});await mountFixture(f);try {await loginFixture();await navigate('businessId=1&role=donor');assert.equal(document.querySelector('.product-work'),null);assert.ok(document.body.textContent.includes('请连接对应角色的钱包'));await navigate('businessId=1&role=records');const create=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('创建下一笔'));assert.equal(create.disabled,false);await act(async()=>{create.click();await tick();await tick();});assert.equal(created,1);assert.equal(location.hash,'#businessId=2&role=owner');}finally{await unmount();}
});
test('server unknown role is rejected',async()=>{const f=fixture({api:path=>path==='/me'?{role:'admin',wallet:POLICIES.owner,csrf:'test'}:undefined});await mountFixture(f);try{await loginFixture();assert.equal(document.querySelector('.product-work'),null);assert.ok(document.querySelector('[role="alert"]'));}finally{await unmount();}});
test('logout holds login lock until response settles even after wallet change',async()=>{
 let resolveLogout,started;const ready=new Promise(r=>started=r);let logins=0;const f=fixture({api:path=>{if(path==='/auth/logout')return new Promise(r=>{resolveLogout=r;started();});if(path==='/identity/wallet/login'){logins++;return {};}}});await mountFixture(f);try{await loginFixture();assert.equal(logins,1);await act(async()=>{[...document.querySelectorAll('.wallet-header button')].find(b=>b.textContent==='退出').click();await ready;});await act(async()=>{f.change();await tick();});const button=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('请在钱包中继续'));assert.ok(button);assert.equal(button.disabled,true);assert.equal(logins,1);await act(async()=>{resolveLogout({});await tick();});await loginFixture();assert.equal(logins,2);}finally{await unmount();}
});
test('product countdown updates with time',async()=>{
 const deadline=Math.floor(Date.now()/1000)+5;const f=fixture({api:path=>path==='/businesses/1/setup'?{state:{phase:'HANDED_OVER',settlementAvailableAt:deadline},operations:[]}:undefined});await mountFixture(f);try{await loginFixture();const text=()=>document.body.textContent.match(/预计还需 (\d+) 秒/)?.[1];const before=Number(text());assert.ok(before>0);await act(async()=>{await new Promise(r=>setTimeout(r,1150));});assert.ok(Number(text())<before);}finally{await unmount();}
});
test('exit is visibly disabled during re-login and wallet change cancels it',async()=>{
 let resolveSign,started;const ready=new Promise(r=>started=r);const f=fixture({sign:n=>n===2?new Promise(r=>{resolveSign=r;started();}):'signature'});await mountFixture(f);try{await loginFixture();await navigate('businessId=1&role=donor');await act(async()=>{[...document.querySelectorAll('button')].find(b=>b.textContent==='钱包登录').click();await tick();});await act(async()=>{[...document.querySelectorAll('button')].find(b=>(b.textContent.includes('连接钱包并签名') || b.textContent==='重试登录')).click();await ready;});const exit=document.querySelector('.wallet-header button');assert.equal(exit.disabled,true);assert.ok(exit.textContent.includes('等待钱包登录完成'));await act(async()=>{f.change();resolveSign('signature');await tick();});assert.equal(document.querySelector('.product-work'),null);assert.ok(document.querySelector('.wallet-header').textContent.includes('钱包登录'));await loginFixture();assert.equal(document.querySelector('.wallet-header button').disabled,false);assert.equal(document.querySelector('.wallet-header button').textContent,'退出');}finally{await unmount();}
});
test('original stylesheet is reused verbatim and recipient build has no wallet dependency',async()=>{
 const original=await readFile(new URL('../source.css',import.meta.url),'utf8');
 const generated=await readFile(new URL('../../public/mvp/product-original.css',import.meta.url),'utf8');assert.equal(generated,original);
 const recipient=await readFile(new URL('../../public/mvp/product-recipient.mjs',import.meta.url),'utf8');assert.doesNotMatch(recipient,/eth_sendTransaction|eth_requestAccounts|personal_sign/);
});
test.after(async()=>{await rm(tmp,{recursive:true,force:true});dom.window.close();});
for (const mode of ['match','mismatch','expired','missing','late','changed']) test('passive restore '+mode,async()=>{
 localStorage.setItem('mf-wallet-provider',JSON.stringify({id:'p',rdns:'wallet.test'}));let reads=0,discover,change,available=mode!=='late'&&mode!=='missing',calls=[];
 const factory=opts=>{discover=opts.onDiscovery;change=opts.onChange;return {providers:()=>available?[{id:'p',name:'Wallet',rdns:'wallet.test'}]:[],select(){},inspect:async()=>{calls.push('inspect');if(mode==='changed')change();return {account:mode==='mismatch'?POLICIES.donor:POLICIES.owner,chainId:10143};},connect(){throw Error('no connect')},signMessage(){throw Error('no sign')},dispose(){}};};
 const api=async path=>{if(path==='/me'){reads++;if(mode==='expired')throw Error('EXPIRED');return {role:'owner',wallet:POLICIES.owner,csrf:'test'};}if(path==='/businesses')return businesses;throw Error(path);};
 await navigate('businessId=1&role=home');document.body.innerHTML='<div id="test"></div>';root=createRoot(document.getElementById('test'));
 try{await act(async()=>{root.render(React.createElement(Product,{api,walletFactory:factory}));await tick();await tick();});if(mode==='late')await act(async()=>{available=true;discover();await tick();await tick();});assert.equal(reads,mode==='missing'?0:1);assert.equal(document.querySelector('.wallet-header').textContent.includes('退出'),['match','late'].includes(mode));if(mode==='match'){await act(async()=>{discover();await tick();});assert.equal(reads,1);}}finally{await unmount();}
});
test('wallet modal traps focus, closes with Escape and returns focus',async()=>{
 const f=fixture();await mountFixture(f);try{const modal=document.querySelector('[role="dialog"]');assert.ok(modal);assert.equal(modal.getAttribute('aria-modal'),'true');const buttons=[...modal.querySelectorAll('button')];buttons.at(-1).focus();await act(async()=>document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true})));assert.equal(document.activeElement,buttons[0]);await act(async()=>document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));assert.equal(document.querySelector('[role="dialog"]'),null);}finally{await unmount();}
});
