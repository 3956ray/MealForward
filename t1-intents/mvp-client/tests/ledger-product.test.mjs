import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {JSDOM} from 'jsdom';
const dir=await mkdtemp(tmpdir()+'/mf-ledger-'),base=new URL('../',import.meta.url);
await build({entryPoints:[new URL('ledger-product.jsx',base).pathname],outfile:dir+'/component.mjs',bundle:true,format:'esm',platform:'node',jsx:'transform',tsconfigRaw:{compilerOptions:{jsx:'react'}},plugins:[{name:'react',setup(b){b.onResolve({filter:/^react$/},()=>({path:new URL('node_modules/react/index.js',base).pathname,external:true}));}}]});
const dom=new JSDOM('',{url:'https://mealforward-test.onrender.com/product-v2/index.html'});Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client'),{LedgerProduct}=await import(dir+'/component.mjs');let root;
const tick=()=>new Promise(r=>setTimeout(r,0));
const ledger={verified:true,chainId:10143,blockNumber:42,asset:{symbol:'USDC',decimals:6},counts:{funded:'3',available:'1',claimed:'1',handedOver:'0',settled:'1',refunded:'0'},items:[{name:'原餐品',version:1,quantity:'3',amount:'9007199254740993000001',txHash:'0x'+'ab'.repeat(32)}]};
async function render(api){await act(async()=>{root.render(React.createElement(LedgerProduct,{api}));await tick();});}
async function mount(api){document.body.innerHTML='<div id="test"></div>';root=createRoot(document.getElementById('test'));await render(api);}
async function refresh(){await act(async()=>{document.querySelector('button').click();await tick();});}
async function clean(){await act(async()=>root.unmount());}
test('public ledger renders only public counts and exact amounts, never incidental private fields',async()=>{
 const privateData={wallet:'PRIVATE_WALLET',credential:'PRIVATE_CREDENTIAL',code:'PRIVATE_CODE',handle:'PRIVATE_HANDLE',raw:'PRIVATE_RAW'};await mount(async path=>{assert.equal(path,'/ledger');return {...ledger,...privateData,items:[{...ledger.items[0],...privateData}]};});try{assert.ok(document.body.textContent.includes('9007199254740993.000001 USDC'));assert.ok(document.body.textContent.includes('已核验至区块 42'));assert.doesNotMatch(document.body.innerHTML,/PRIVATE_/);const link=document.querySelector('a');assert.equal(link.href,'https://testnet.monadexplorer.com/tx/'+ledger.items[0].txHash);assert.equal(link.rel,'noreferrer');}finally{await clean();}
});
test('local acceptance transaction is labelled local and has no public explorer link',async()=>{
 await mount(async()=>({...ledger,chainId:31337}));try{assert.equal(document.querySelector('a'),null);assert.ok(document.body.textContent.includes('本地验收交易'));}finally{await clean();}
});
test('failed refresh retains previous block with an explicit stale-result explanation',async()=>{
 let calls=0;await mount(async()=>{if(calls++)throw Error('offline');return ledger;});try{await refresh();assert.ok(document.body.textContent.includes('暂时无法核验公共账'));assert.ok(document.body.textContent.includes('以下保留上次结果'));assert.ok(document.body.textContent.includes('区块 42'));}finally{await clean();}
});
test('late previous API result cannot overwrite the replacement source',async()=>{
 let finish;await mount(()=>new Promise(r=>finish=r));try{await render(async()=>({...ledger,blockNumber:99}));await act(async()=>{finish(ledger);await tick();});assert.ok(document.body.textContent.includes('区块 99'));assert.ok(!document.body.textContent.includes('区块 42'));}finally{await clean();}
});
after(async()=>{dom.window.close();await rm(dir,{recursive:true,force:true});});
