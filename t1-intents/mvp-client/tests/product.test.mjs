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
async function unmount(){await act(async()=>root.unmount());}
test('scopes merchant and operations, keeps authentication global, removes recipient secret',()=>{
 assert.equal(scopedPath('2','/merchant/check'),'/businesses/2/merchant/check');
 assert.equal(scopedPath('2','/operations/id/attempt'),'/businesses/2/operations/id/attempt');
 assert.equal(scopedPath('2','/me'),'/me');assert.equal(scopedPath('2','/auth/logout'),'/auth/logout');
 assert.throws(()=>scopedPath('../2','/setup'));
 const v=new JSDOM('',{url:'https://mvp.example/mvp/product-recipient.html#businessId=2&token=private'}).window;
 assert.deepEqual(captureProductInvite(v),{businessId:'2',token:'private'});assert.equal(v.location.hash,'#businessId=2');
 assert.equal(productRoute('#businessId=2&role=issuer').businessId,'2');
});
test('switching business drops old transaction and entered code; late response cannot contaminate new business',async()=>{
 let resolveOld, reads=0;
 const api=async(path)=>{
  if(path==='/me')return session;if(path==='/status')return {enabled:true,writesEnabled:true};if(path==='/businesses')return businesses;
  if(path==='/businesses/1/setup'){reads++; if(reads>1)return new Promise(r=>resolveOld=r);return {state:{phase:'ISSUED'},operations:[],allowedAction:'redeem'};}
  if(path==='/businesses/2/setup')return {state:{phase:'SETTLED'},operations:[],allowedAction:null};
  throw Error('UNEXPECTED_PATH');
 };
 await mount(api);
 assert.ok(document.querySelector('.header .brand svg'));assert.equal(document.querySelectorAll('.header').length,1);
 const input=document.querySelector('input[placeholder="000000"]');assert.ok(input);
 await act(async()=>{const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;setter.call(input,'123456');input.dispatchEvent(new Event('input',{bubbles:true}));});
 const refresh=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('刷新已确认'));
 await act(async()=>{refresh.click();await tick();});
 await navigate('businessId=2&role=owner');
 assert.equal(document.querySelector('input[placeholder="000000"]'),null);
 await act(async()=>{resolveOld({state:{phase:'ISSUED'},operations:[{id:'stale',action:'redeem',state:'PREPARED',transaction:{nonce:'0x1'}}],allowedAction:'redeem'});await tick();});
 assert.equal(document.querySelector('.recovery'),null);assert.ok(document.body.textContent.includes('测试餐款已结算'));
 await unmount();
});
test('new business creation is owner-only and requires server eligibility',async()=>{
 let created=0;
 const api=async(path,options)=>{if(path==='/me')return session;if(path==='/businesses'){if(options?.body){created++;return {business:{id:'2'}};}return {...businesses,canCreate:false};}if(path==='/status')return {};return {state:{phase:'SETTLED'},operations:[]};};
 await navigate('businessId=1&role=records');await mount(api);
 const create=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('创建下一笔'));
 assert.equal(create.disabled,true);assert.equal(created,0);await unmount();
});
test('working view is sole session reader; eligible owner creates a new record without preparing a transaction',async()=>{
 let reads=0,created=0;
 const api=async(path,options)=>{
  if(path==='/me'){reads++;return session;}
  if(path==='/status')return {enabled:true,writesEnabled:true};
  if(path==='/businesses'){if(options?.body){assert.equal(options.csrf,'test');created++;return {business:{id:'2'}};}return {...businesses,canCreate:true};}
  if(path.endsWith('/setup'))return {state:{phase:'SETTLED'},operations:[]};
  throw Error('UNEXPECTED_PATH');
 };
 await navigate('businessId=1&role=owner');await mount(api);assert.equal(reads,1);
 await navigate('businessId=1&role=records');
 const create=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('创建下一笔'));
 assert.equal(create.disabled,false);
 await act(async()=>{create.click();await tick();await tick();});
 assert.equal(created,1);assert.equal(location.hash,'#businessId=2&role=owner');await unmount();
});
test('anonymous landing treats protected business-list denial as a normal state',async()=>{
 let sessionReads=0;
 const api=async(path)=>{if(path==='/me')sessionReads++;throw Error('LOGIN_REQUIRED');};
 await navigate('businessId=1&role=home');await mount(api);
 assert.equal(sessionReads,0);assert.equal(document.querySelector('[role="alert"]'),null);
 assert.ok(document.body.textContent.includes('支持一餐')); assert.equal(document.querySelectorAll('.store-card').length,3); assert.equal(document.querySelectorAll('.store-card button:disabled').length,2); await unmount();
});
test('original stylesheet is reused verbatim and recipient build has no wallet dependency',async()=>{
 const original=await readFile(new URL('../source.css',import.meta.url),'utf8');
 const generated=await readFile(new URL('../../public/mvp/product-original.css',import.meta.url),'utf8');assert.equal(generated,original);
 const recipient=await readFile(new URL('../../public/mvp/product-recipient.mjs',import.meta.url),'utf8');assert.doesNotMatch(recipient,/eth_sendTransaction|eth_requestAccounts|personal_sign/);
});
test.after(async()=>{await rm(tmp,{recursive:true,force:true});dom.window.close();});
