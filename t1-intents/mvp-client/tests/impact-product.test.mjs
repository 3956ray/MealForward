import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {JSDOM} from 'jsdom';
const dir=await mkdtemp(tmpdir()+'/mf-impact-');
await build({entryPoints:[new URL('../impact-product.jsx',import.meta.url).pathname],outfile:dir+'/component.mjs',bundle:true,format:'esm',platform:'node',jsx:'transform',tsconfigRaw:{compilerOptions:{jsx:'react'}},plugins:[{name:'external',setup(b){for(const [name,path] of [['react','react/index.js'],['recharts','recharts/lib/index.js']])b.onResolve({filter:new RegExp('^'+name+'$')},()=>({path:new URL('../node_modules/'+path,import.meta.url).pathname,external:true}));}}]});
const dom=new JSDOM('<div id="root"></div>',{url:'https://example.test'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true,ResizeObserver:class{observe(){}unobserve(){}disconnect(){}}});
const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client');
const {ImpactProduct,rankStores}=await import(dir+'/component.mjs');
let root;const tick=()=>new Promise(r=>setTimeout(r,0));
const fixture={coverage:'complete',updatedAt:1793880000,days:30,metrics:{funded:'12',delivered:'7',users:'3',kitchens:'2'},counts:{funded:'12',available:'2',claimed:'1',handedOver:'2',settled:'5',refundPending:'1',refunded:'1'},trend:[],stores:[],recent:[],sources:[]};
async function mount(api){document.body.innerHTML='<div id="root"></div>';root=createRoot(document.getElementById('root'));await act(async()=>{root.render(React.createElement(ImpactProduct,{api}));await tick();});}
async function click(label){await act(async()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===label||b.getAttribute('aria-label')===label);assert.ok(b);b.click();await tick();});}
async function clean(){await act(async()=>root.unmount());}
test('ranking ties use competition ranks and exact integers',()=>{const rows=[{id:'a',delivered:'9007199254740994'},{id:'b',delivered:'9007199254740994'},{id:'c',delivered:'9007199254740993'}];assert.deepEqual(rankStores(rows,'delivered').map(r=>r.rank),[1,1,3]);});
test('syncing never presents unknown counts as zero',async()=>{await mount(async()=>({coverage:'syncing'}));try{assert.equal(document.querySelectorAll('.metric-number').length,4);assert.ok([...document.querySelectorAll('.metric-number')].every(e=>e.textContent.startsWith('—')));assert.match(document.body.textContent,/历史数据同步完成/);}finally{await clean();}});
test('failed refresh retains verified snapshot and exposes recovery status',async()=>{let calls=0;await mount(async()=>{if(calls++)throw Error('offline');return fixture;});try{await click('刷新善意足迹');assert.match(document.querySelector('[role=alert]').textContent,/保留上次/);assert.equal(document.querySelector('.metric-number').textContent,'12份');}finally{await clean();}});
test('range switching reads only and keeps cumulative totals; stale range is not shown',async()=>{const calls=[];let resolve;await mount(async p=>{calls.push(p);if(calls.length>1)return new Promise(r=>resolve=r);return fixture;});try{await click('7天');assert.deepEqual(calls,['/impact?days=30','/impact?days=7']);assert.equal(document.querySelector('.metric-number').textContent,'12份');assert.equal(document.querySelector('.impact-line'),null);await act(async()=>{resolve({...fixture,days:7});await tick();});assert.equal(document.querySelector('[aria-pressed=true]').textContent,'7天');assert.match(document.body.textContent,/不代表实名自然人数/);}finally{await clean();}});
after(async()=>{dom.window.close();await rm(dir,{recursive:true,force:true});});
