import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {JSDOM} from 'jsdom';
const dir=await mkdtemp(tmpdir()+'/mf-locale-'),client=new URL('../',import.meta.url).pathname;
await build({stdin:{contents:"export {CatalogProduct} from './catalog-product.jsx';export * from './locale.mjs';",resolveDir:client},outfile:dir+'/component.mjs',bundle:true,format:'esm',platform:'node',jsx:'transform',tsconfigRaw:{compilerOptions:{jsx:'react'}},plugins:[{name:'shared-react',setup(b){for(const [name,path] of [['react','react/index.js'],['recharts','recharts/lib/index.js'],['@radix-ui/react-dialog','@radix-ui/react-dialog/dist/index.mjs']])b.onResolve({filter:new RegExp('^'+name+'$')},()=>({path:client+'node_modules/'+path,external:true}));}}]});
const dom=new JSDOM('<div id="root"></div>',{url:'https://example.test'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,HTMLElement:dom.window.HTMLElement,NodeFilter:dom.window.NodeFilter,Node:dom.window.Node,CustomEvent:dom.window.CustomEvent,MutationObserver:dom.window.MutationObserver,getComputedStyle:dom.window.getComputedStyle,HTMLInputElement:dom.window.HTMLInputElement,IS_REACT_ACT_ENVIRONMENT:true});
const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client');
const {CatalogProduct,setLanguage,getLanguage,t,translateError}=await import(dir+'/component.mjs');
const tick=()=>new Promise(r=>setTimeout(r,0));
const catalog={stores:[{id:'store',name:'厨房原名'}],asset:{symbol:'USDC',decimals:6},fundingEnabled:false,meals:[{id:'meal',storeId:'store',name:'保留原名餐品',description:'商家的中文描述',version:1,unitPrice:'500000',remaining:'30',fundingDeadline:2000000000,windows:[[0,1440]],listed:true}]};
let root,calls;
async function mount(){calls=[];window.history.replaceState(null,'','/#stores');document.body.innerHTML='<div id="root"></div>';root=createRoot(document.getElementById('root'));await act(async()=>{root.render(React.createElement(CatalogProduct,{api:async(p,o)=>{calls.push({p,o});if(p==='/catalog')return catalog;return {items:[]};},session:{wallet:'0x111',stores:['store']}}));await tick();});}
async function click(text){await act(async()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===text);assert.ok(b,text);b.click();await tick();});}
async function change(value){await act(async()=>{const s=document.querySelector('[aria-label="Language / 语言"]');assert.ok(s);s.value=value;s.dispatchEvent(new window.Event('change',{bubbles:true}));await tick();});}
async function clean(){await act(async()=>{root.unmount();setLanguage('zh');});}
test('switch changes the full navigation and metadata, persists preference and preserves route and merchant content',async()=>{
 await mount();try{await change('en');assert.equal(getLanguage(),'en');assert.equal(localStorage.getItem('mf-language'),'en');assert.equal(document.documentElement.lang,'en-US');assert.equal(document.title,'MealForward');assert.equal(window.location.hash,'#stores');assert.match(document.body.textContent,/My meal vouchers/);assert.match(document.body.textContent,/保留原名餐品/);assert.match(document.body.textContent,/厨房原名/);assert.ok(calls.every(c=>!c.o?.method||c.o.method==='GET'));await change('zh');assert.match(document.body.textContent,/我的餐券/);}finally{await clean();}
});
test('locale updates retain open support dialog, entered quantity and original review without replaying writes',async()=>{
 await mount();try{await click('支持餐食');const input=document.querySelector('[aria-label="支持份数"]');await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(input,'3');input.dispatchEvent(new window.Event('input',{bubbles:true}));});const before=calls.length;await act(async()=>{setLanguage('en');await tick();});assert.equal(document.querySelector('[role="dialog"] input').value,'3');assert.match(document.querySelector('[role="dialog"]').textContent,/保留原名餐品/);assert.equal(calls.length,before);assert.match(document.querySelector('[role="dialog"]').textContent,/Review/);}finally{await clean();}
});
test('cross-tab language update rerenders without login or write requests',async()=>{
 await mount();try{const before=calls.length;await act(async()=>{window.dispatchEvent(new window.StorageEvent('storage',{key:'mf-language',newValue:'en'}));await tick();});assert.match(document.body.textContent,/My meal vouchers/);assert.equal(calls.length,before);}finally{await clean();}
});
test('storage failure and unsupported preferences do not prevent switching; errors stay translatable',()=>{
 const storage=globalThis.localStorage;try{globalThis.localStorage={setItem(){throw Error('blocked');}};setLanguage('en');setLanguage('fr');assert.equal(getLanguage(),'en');assert.match(translateError('OPERATION_EXPIRED'),/expired/i);assert.equal(t('厨房 {0}',[2]),'Kitchen 2');assert.equal(t('商家自定义文字'),'商家自定义文字');setLanguage('zh');assert.match(translateError('OPERATION_EXPIRED'),/审核已过期/);}finally{globalThis.localStorage=storage;setLanguage('zh');}
});
test('account disclosure supports Escape, outside dismissal and original navigation without writes',async()=>{
 await mount();try{const details=document.querySelector('.account-navigation'),summary=details.querySelector('summary');await act(async()=>summary.click());assert.equal(details.open,true);await act(async()=>summary.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));assert.equal(details.open,false);assert.equal(document.activeElement,summary);await act(async()=>{summary.click();document.body.dispatchEvent(new window.Event('pointerdown',{bubbles:true}));});assert.equal(details.open,false);await act(async()=>summary.click());await click('我的支持');assert.equal(window.location.hash,'#mine/orders');assert.equal(details.open,false);assert.ok(calls.every(c=>!c.o?.method||c.o.method==='GET'));}finally{await clean();}
});
after(async()=>{dom.window.close();await rm(dir,{recursive:true,force:true});});
