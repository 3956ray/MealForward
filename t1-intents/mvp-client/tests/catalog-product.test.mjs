import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {JSDOM} from 'jsdom';
import {amountFor,beijingInput,beijingSeconds,draftPayload,formatAmount,priceInput,supportPayload} from '../catalog-state.mjs';
const dir=await mkdtemp(tmpdir()+'/mf-catalog-');
const nodeModules=new URL('../node_modules/',import.meta.url).pathname;
await build({entryPoints:[new URL('../catalog-product.jsx',import.meta.url).pathname],outfile:dir+'/component.mjs',bundle:true,format:'esm',platform:'node',jsx:'transform',tsconfigRaw:{compilerOptions:{jsx:'react'}},plugins:[{name:'react',setup(b){b.onResolve({filter:/^react$/},()=>({path:nodeModules+'react/index.js',external:true}));}}]});
const dom=new JSDOM('<div id="root"></div>',{url:'https://example.test'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
const React=await import('react');const {act}=React;const {createRoot}=await import('react-dom/client');
const {CatalogProduct}=await import(dir+'/component.mjs');
const now=Math.floor(Date.now()/1000),owner={wallet:'0x111',stores:['store']};
const catalog={stores:[{id:'store',name:'厨房'}],asset:{symbol:'USDC',decimals:6},fundingEnabled:false,meals:[{id:'meal',storeId:'store',name:'热餐',description:'原餐品',version:1,unitPrice:'7000001',remaining:'30',fundingDeadline:now+86400,windows:[[0,1440]],listed:true}]};
let root,api,session;
const tick=()=>new Promise(r=>setTimeout(r,0));
async function mount(call,s=owner){api=call;session=s;document.body.innerHTML='<div id="root"></div>';root=createRoot(document.getElementById('root'));await render();}
async function render(extra={}){await act(async()=>{root.render(React.createElement(CatalogProduct,{api,session,...extra}));await tick();});}
async function click(text){await act(async()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent===text);assert.ok(b,text);b.click();await tick();});}
async function clean(){await act(async()=>root.unmount());}
test('exact integer amounts and UTC+8 times independent of machine timezone',()=>{
 assert.equal(amountFor('7000001','20'),'140000020');assert.equal(priceInput('7.000001'),'7000001');assert.equal(formatAmount('140000020'),'140.00002');
 assert.throws(()=>priceInput('1.0000001'));assert.throws(()=>amountFor('1','1.5'));assert.throws(()=>amountFor('1','0'));
 assert.equal(beijingSeconds('2026-10-30T12:00'),Date.parse('2026-10-30T04:00:00Z')/1000);assert.equal(beijingInput(beijingSeconds('2026-10-30T12:00')),'2026-10-30T12:00');assert.throws(()=>beijingSeconds('2026-02-30T12:00'));
 assert.equal(supportPayload(catalog.meals[0],'20').quantity,'20');assert.throws(()=>supportPayload(catalog.meals[0],'31'));
 const d=draftPayload({name:'餐品',description:'说明',price:'7.1',quantity:'40',deadline:'2099-01-01T12:00',windows:[['11:00','14:00'],['17:00','24:00']]},6);assert.equal(d.quantity,'40');assert.equal(d.windows[1][1],1440);
});
test('closed funding permits review but never creates payment intent or says success',async()=>{
 const calls=[];await mount(async(path,o)=>{calls.push(path);if(path==='/catalog')return catalog;if(path==='/support-reviews')return {...o.body,id:'review',amount:amountFor('7000001',o.body.quantity),expiresAt:now+300};throw Error(path);});
 try{await click('支持餐食');await click('审核资助');const confirm=[...document.querySelectorAll('button')].find(b=>b.textContent==='确认原资助请求');assert.equal(confirm.disabled,true);assert.ok(!calls.includes('/support-intents'));assert.ok(!document.body.textContent.includes('资助已确认'));}finally{await clean();}
});
test('drafts are private and never added to public catalog',async()=>{
 await mount(async path=>path==='/catalog'?catalog:{items:[{id:'d',storeId:'store',name:'私有草稿',unitPrice:'8000000',quantity:'40',revision:1,windows:[[0,1440]],fundingDeadline:now+86400,description:'草稿'}]});
 try{assert.ok(!document.body.textContent.includes('私有草稿'));await click('商家餐品管理');assert.ok(document.body.textContent.includes('私有草稿'));await click('厨房与餐品');assert.ok(!document.body.textContent.includes('私有草稿'));}finally{await clean();}
});
test('identity change discards late private response',async()=>{
 let resolve;await mount(async path=>{if(path==='/catalog')return catalog;if(path==='/orders')return new Promise(r=>resolve=r);throw Error(path);});
 try{await click('我的支持');session=null;await render();await act(async()=>{resolve({items:[{id:'private',name:'旧钱包订单',state:'CONFIRMED',quantity:'1',amount:'7000001',version:1}]});await tick();});assert.ok(!document.body.textContent.includes('旧钱包订单'));}finally{await clean();}
});
test('login returns to previously selected meal without creating request',async()=>{
 let login=0;await mount(async path=>{assert.equal(path,'/catalog');return catalog;},null);
 try{await render({onLogin:()=>login++});await click('支持餐食');assert.equal(login,1);assert.equal(document.querySelector('[role=dialog]'),null);session=owner;await render();assert.ok(document.querySelector('[role=dialog]').textContent.includes('热餐'));}finally{await clean();}
});
test('saving original draft retains public menu and sends expected revision',async()=>{
 const draft={id:'d',storeId:'store',name:'新草稿',description:'尚未发布',unitPrice:'8000000',quantity:'40',revision:2,windows:[[0,1440]],fundingDeadline:now+86400};let saved;
 await mount(async(path,o)=>{if(path==='/catalog')return catalog;if(path.startsWith('/drafts?'))return {items:[draft]};if(path==='/drafts/d'){saved=o.body;return {...draft,...o.body,revision:3};}throw Error(path);});
 try{await click('商家餐品管理');await click('编辑草稿');await click('保存草稿');assert.equal(saved.expectedRevision,2);assert.equal(saved.quantity,'40');assert.equal(saved.unitPrice,'8000000');assert.ok(document.body.textContent.includes('公开菜单尚未改变'));await click('关闭');await click('厨房与餐品');assert.ok(!document.body.textContent.includes('新草稿'));assert.ok(document.body.textContent.includes('热餐'));}finally{await clean();}
});
test('prepared intent is recoverable and never presented as paid',async()=>{
 let created=0;
 await mount(async(path,o)=>{if(path==='/catalog')return {...catalog,fundingEnabled:true};if(path==='/support-reviews')return {...o.body,id:'r',amount:'7000001',expiresAt:now+300};if(path==='/support-intents'){created++;return {id:'original',kind:'support',state:'PREPARED',quantity:'1',amount:'7000001'};}if(path==='/intents/original')return {id:'original',kind:'support',state:'SEND_UNKNOWN',quantity:'1',amount:'7000001'};throw Error(path);});
 try{await click('支持餐食');await click('审核资助');await click('确认原资助请求');assert.equal(created,1);assert.ok(document.body.textContent.includes('等待钱包付款'));assert.ok(!document.body.textContent.includes('资助已确认'));await click('查询原请求');assert.ok(document.body.textContent.includes('付款结果待核对'));assert.equal(created,1);}finally{await clean();}
});
test('closed review dialog stays closed after a late success and never confirms',async()=>{
 let resolve,calls=[];await mount(async(path,o)=>{calls.push(path);if(path==='/catalog')return catalog;if(path==='/support-reviews')return new Promise(r=>resolve=()=>r({...o.body,id:'late',amount:'7000001',expiresAt:now+300}));throw Error(path);});
 try{await click('支持餐食');await click('审核资助');await click('关闭');await act(async()=>{resolve();await tick();});assert.equal(document.querySelector('[role=dialog]'),null);assert.ok(!calls.includes('/support-intents'));}finally{await clean();}
});
test('a successful review ends its key but a failed retry keeps the same key',async()=>{
 const ids=[];let fail=true;await mount(async(path,o)=>{if(path==='/catalog')return catalog;if(path==='/support-reviews'){ids.push(o.body.requestId);if(fail){fail=false;throw Error('connection lost');}return {...o.body,id:'r'+ids.length,amount:'7000001',expiresAt:now+300};}throw Error(path);});
 try{await click('支持餐食');await click('审核资助');await click('审核资助');assert.equal(ids[0],ids[1]);await click('修改份数');await click('审核资助');assert.notEqual(ids[1],ids[2]);assert.ok(!document.body.textContent.includes('资助已确认'));}finally{await clean();}
});
test('identity change discards an in-flight confirmation without implying payment',async()=>{
 let resolve;await mount(async(path,o)=>{if(path==='/catalog')return {...catalog,fundingEnabled:true};if(path==='/support-reviews')return {...o.body,id:'r',amount:'7000001',expiresAt:now+300};if(path==='/support-intents')return new Promise(r=>resolve=r);throw Error(path);});
 try{await click('支持餐食');await click('审核资助');await click('确认原资助请求');session={wallet:'0x222',stores:[]};await render();await act(async()=>{resolve({id:'old',state:'CONFIRMED',quantity:'1',amount:'7000001'});await tick();});assert.equal(document.querySelector('[role=dialog]'),null);assert.ok(!document.body.textContent.includes('资助已确认'));}finally{await clean();}
});
test('Escape closes review even after the focused review button was removed',async()=>{
 await mount(async(path,o)=>path==='/catalog'?catalog:{...o.body,id:'r',amount:'7000001',expiresAt:now+300});
 try{await click('支持餐食');await click('审核资助');await act(async()=>{document.body.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await tick();});assert.equal(document.querySelector('[role=dialog]'),null);}finally{await clean();}
});
after(async()=>{dom.window.close();await rm(dir,{recursive:true,force:true});});

test('required approval prepares authorization alone; confirmed authorization still requires explicit support confirmation',async()=>{
 let sends=0,prepared=0,funded=0,approval={id:'a',kind:'approval',reviewId:'r',state:'PREPARED',amount:'7000001',quantity:'1',transaction:{data:'synthetic'}};
 await mount(async(path,o)=>{if(path==='/catalog')return {...catalog,fundingEnabled:true,approvalEnabled:true};if(path==='/support-reviews')return {...o.body,id:'r',amount:'7000001',approvalRequired:true,expiresAt:now+300};if(path==='/approvals'){prepared++;assert.equal(o.body.reviewId,'r');return approval;}if(path==='/approvals/a')return {...approval,state:'CONFIRMED'};if(path==='/support-intents'){funded++;assert.equal(o.body.reviewId,'r');return {id:'s',kind:'support',state:'PREPARED',amount:'7000001',quantity:'1'};}throw Error(path);});
 try{await render({onWalletOperation:async o=>{assert.equal(o.kind,'approval');sends++;}});await click('支持餐食');await click('审核资助');assert.ok(![...document.querySelectorAll('button')].some(b=>b.textContent==='确认原资助请求'));await click('授权本次金额');assert.equal(prepared,1);assert.equal(sends,0);assert.equal(funded,0);await click('钱包确认');assert.equal(sends,1);assert.equal(funded,0);assert.ok(document.querySelector('[role=dialog]').textContent.includes('尚未付款'));assert.ok(!document.body.textContent.includes('资助已确认'));await click('继续确认资助');assert.equal(funded,1);assert.equal(sends,1);assert.ok(document.body.textContent.includes('等待钱包付款'));}finally{await clean();}
});
test('approval preparation response cannot reopen a closed dialog or leak across wallets',async()=>{
 for(const changeIdentity of [false,true]){let finish;await mount(async(path,o)=>{if(path==='/catalog')return {...catalog,fundingEnabled:true,approvalEnabled:true};if(path==='/support-reviews')return {...o.body,id:'r',amount:'7000001',approvalRequired:true,expiresAt:now+300};if(path==='/approvals')return new Promise(r=>finish=r);throw Error(path);});try{await click('支持餐食');await click('审核资助');await click('授权本次金额');if(changeIdentity){session=null;await render();}else await click('关闭');await act(async()=>{finish({id:'a',kind:'approval',state:'CONFIRMED'});await tick();});assert.equal(document.querySelector('[role=dialog]'),null);}finally{await clean();}}
});
