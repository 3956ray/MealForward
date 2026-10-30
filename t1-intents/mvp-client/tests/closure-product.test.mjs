/** Component and coordinator fixtures only; no live-wallet or real-chain evidence. */
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {JSDOM} from 'jsdom';
import {publicationTransaction} from '../../product-v2/publication-wire.mjs';
import {validateProductOperation,executeProductOperation,reconcileProductOperation,createProductJournal} from '../product-wallet.mjs';
const dir=await mkdtemp(tmpdir()+'/mf-closure-'),base=new URL('../',import.meta.url);
await build({entryPoints:[new URL('closure-product.jsx',base).pathname],outfile:dir+'/component.mjs',bundle:true,format:'esm',platform:'node',jsx:'transform',tsconfigRaw:{compilerOptions:{jsx:'react'}},plugins:[{name:'react',setup(b){b.onResolve({filter:/^react$/},()=>({path:new URL('node_modules/react/index.js',base).pathname,external:true}));}}]});
await build({entryPoints:[new URL('merchant-product.jsx',base).pathname],outfile:dir+'/merchant.mjs',bundle:true,format:'esm',platform:'node',jsx:'transform',tsconfigRaw:{compilerOptions:{jsx:'react'}},plugins:[{name:'react',setup(b){b.onResolve({filter:/^react$/},()=>({path:new URL('node_modules/react/index.js',base).pathname,external:true}));}}]});
const dom=new JSDOM('',{url:'https://example.test/product-v2/index.html'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,sessionStorage:dom.window.sessionStorage,IS_REACT_ACT_ENVIRONMENT:true});
const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client'),{ClosureProduct}=await import(dir+'/component.mjs'),{MerchantProduct}=await import(dir+'/merchant.mjs');
const OWNER='0x'+'11'.repeat(20),OTHER='0x'+'22'.repeat(20),PAYER='0x'+'33'.repeat(20),BATCH='0x'+'44'.repeat(32),HASH='0x'+'55'.repeat(32),session={wallet:OWNER,stores:['s']},catalog={asset:{symbol:'USDC',decimals:6}};
const prepared={id:'closure-1',requestId:'original',kind:'closure',wallet:OWNER,storeId:'s',state:'PREPARED',acknowledge:true};
const snapshot=(closed=false)=>({verified:true,storeId:'s',closed,items:closed?[{batchId:BATCH,payer:PAYER,quantity:'2',amount:'14000000',refunded:false}]:[]});
let root,props,component=ClosureProduct;
const tick=()=>new Promise(r=>setTimeout(r,0));
async function render(){await act(async()=>{root.render(React.createElement(component,props));await tick();});}
async function mount(api,extra={},clear=true){component=ClosureProduct;if(clear)sessionStorage.clear();props={api,session,catalog,active:true,...extra};document.body.innerHTML='<div id="test"></div>';root=createRoot(document.getElementById('test'));await render();}
const button=t=>[...document.querySelectorAll('button')].find(b=>b.textContent===t);
async function click(t){await act(async()=>{assert.ok(button(t),t);button(t).click();await tick();});}
async function acknowledge(){await act(async()=>{document.querySelector('input[type=checkbox]').click();await tick();});}
async function clean(){await act(async()=>root.unmount());}

test('initial refunds load exposes closure only after explicit acknowledgement; prepare never signs',async()=>{
 const calls=[];let sends=0;await mount(async(p,o)=>{calls.push([p,o]);return o?{...prepared,requestId:o.body.requestId}:snapshot();},{onWalletOperation:async()=>sends++});
 try{assert.equal(calls[0][0],'/merchant/refunds?storeId=s');assert.equal(button('审核永久停业').disabled,true);await acknowledge();await click('审核永久停业');assert.equal(calls[1][1].body.acknowledge,true);assert.equal(calls[1][1].body.storeId,'s');assert.equal(sends,0);assert.match(document.body.textContent,/请核对后在商家钱包确认/);}finally{await clean();}
});

test('refund review shows exact original amount and payer, wallet action runs once',async()=>{
 const calls=[];let sends=0;const op={...prepared,id:'refund-1',kind:'refund',batchId:BATCH,payer:PAYER,quantity:'2',amount:'14000000'};
 await mount(async(p,o)=>{calls.push([p,o]);return p.startsWith('/merchant/refunds?')?snapshot(true):p==='/merchant/refunds'?{...op,requestId:o.body.requestId}:{...op,state:'SEND_UNKNOWN'};},{onWalletOperation:async()=>sends++});
 try{await click('审核这笔退款');assert.equal(calls[1][1].body.batchId,BATCH);assert.deepEqual(Object.keys(calls[1][1].body).sort(),['batchId','requestId','storeId']);assert.match(document.body.textContent,/退回 14 USDC/);assert.ok(document.body.textContent.includes(PAYER));assert.equal(sends,0);await click('核对无误，钱包确认');assert.equal(sends,1);assert.ok(!button('核对无误，钱包确认'));await click('查询原操作');assert.equal(sends,1);assert.equal(calls.filter(([p])=>p==='/merchant/refunds').length,1);}finally{await clean();}
});

test('unknown preparation plus 404 recovery cannot create replacement; reopen uses original GET only',async()=>{
 const calls=[];const api=async(p,o)=>{calls.push([p,o]);if(p.startsWith('/merchant/refunds?'))return snapshot();throw Object.assign(Error('unresolved'),{status:p.includes('by-request')?404:503});};
 await mount(api);await acknowledge();await click('审核永久停业');assert.equal(button('审核永久停业').disabled,true);const request=calls.find(([,o])=>o?.method==='POST')[1].body.requestId;await clean();
 await mount(api,{},false);try{assert.ok(!button('核对无误，钱包确认'));await click('查询原操作');assert.ok(calls.some(([p,o])=>p==='/catalog-operations/by-request/'+request&&!o));assert.equal(calls.filter(([,o])=>o?.method==='POST').length,1);assert.equal(button('审核永久停业').disabled,true);}finally{await clean();}
});

test('account switch hides late original operation and does not restore another wallet journal',async()=>{
 let release;const api=async(p,o)=>o?new Promise(r=>release=r):snapshot();await mount(api);
 try{await acknowledge();await click('审核永久停业');props={...props,session:{wallet:OTHER,stores:['other']}};await render();await act(async()=>{release(prepared);await tick();});assert.equal(document.querySelector('[aria-label="停业退款原操作"]'),null);assert.ok(!button('核对无误，钱包确认'));assert.equal(sessionStorage.getItem('mf-product-closure:'+OTHER+':other'),null);}finally{await clean();}
});

test('same-wallet store change discards old pending refunds response',async()=>{
 let release;await mount(async p=>p.endsWith('=s')?new Promise(r=>release=r):{verified:true,storeId:'other',closed:true,items:[{batchId:BATCH,payer:PAYER,quantity:'3',amount:'21000000',refunded:false}]});
 try{props={...props,session:{wallet:OWNER,stores:['other','s']}};await render();await act(async()=>{release(snapshot(true));await tick();});assert.match(document.body.textContent,/3 份/);assert.ok(!document.body.textContent.includes('2 份'));}finally{await clean();}
});

test('definitive preparation rejection permits correction; pre-send cancellation remains explicit',async()=>{
 let fail=true;await mount(async(p,o)=>{if(!o)return snapshot();if(p.endsWith('/cancel'))return {...prepared,state:'CANCELLED'};if(fail)throw Object.assign(Error('review rejected'),{status:422});return prepared;});
 try{await acknowledge();await click('审核永久停业');assert.equal(button('审核永久停业').disabled,false);fail=false;await click('审核永久停业');assert.ok(button('取消未发送操作'));await click('取消未发送操作');assert.equal(button('审核永久停业').disabled,false);}finally{await clean();}
});

const configuration={verified:true,chainId:10143,escrow:'0x'+'ee'.repeat(20),asset:'0x534b2f3a21130d7a60830c2df862319e593943a3'};
function walletOperation(kind){const op={...prepared,id:kind+'-operation',kind,expiresAt:Math.floor(Date.now()/1000)+120,...(kind==='refund'?{batchId:BATCH,payer:PAYER,quantity:'2',amount:'14000000'}:{})};return {...op,transaction:publicationTransaction(op,configuration,3)};}

test('closure/refund coordinator accepts only matching explicit calldata, wallet and acknowledgement',()=>{
 for(const kind of ['closure','refund']){const original=walletOperation(kind);assert.deepEqual(validateProductOperation(original,session,configuration),original.transaction);
 for(const mutate of [o=>o.transaction.to=OTHER,o=>o.transaction.value='0x1',o=>o.transaction.data+='00',o=>o.wallet=OTHER,o=>{if(kind==='closure')o.acknowledge=false;else o.batchId='0x'+'66'.repeat(32);},o=>{if(kind==='refund')o.payer='0x'+'00'.repeat(20);else o.storeId='changed-store';}]){const op=structuredClone(original);mutate(op);assert.throws(()=>validateProductOperation(op,session,configuration));}}
});

test('closure/refund lost hash response recovers original hash without repeating wallet transaction',async()=>{
 for(const kind of ['closure','refund']){const op=walletOperation(kind),map=new Map(),journal=createProductJournal({getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)});let sends=0,failHash=true;const calls=[];
 const options={operation:op,session,configuration,journal,isCurrent:()=>true,wallet:{inspect:async()=>({account:OWNER,chainId:10143}),sendTransaction:async()=>{sends++;return HASH;}},api:async(p,o)=>{calls.push([p,o]);if(p.endsWith('/attempt'))return {allowed:true,operation:{...op,state:'SEND_UNKNOWN'}};if(p.endsWith('/hash')&&failHash)throw Error('lost hash reply');return {...op,state:'CONFIRMED'};}};
 await assert.rejects(executeProductOperation(options),/lost hash reply/);assert.equal(journal.get(OWNER,op).txHash,HASH);failHash=false;assert.equal((await reconcileProductOperation(options)).state,'CONFIRMED');await assert.rejects(executeProductOperation(options),/ORIGINAL_OPERATION_ALREADY_ATTEMPTED/);assert.equal(sends,1);assert.ok(calls.every(([p])=>p.startsWith('/catalog-operations/'+op.id+'/')));}
});


test('fully delivered batch shows no refund obligation and has no refund action',async()=>{
 await mount(async()=>({verified:true,storeId:'s',closed:true,items:[{batchId:BATCH,payer:PAYER,quantity:'0',amount:'0',refunded:false}]}));
 try{assert.match(document.body.textContent,/无需退款/);assert.ok(!button('审核这笔退款'));assert.ok(!document.body.textContent.includes('待退款'));}finally{await clean();}
});

test('merchant can request final invalidation check across sessions immediately; unknown never offers cancellation',async()=>{
 const op={id:'old-handover',kind:'handover',state:'AWAITING_HANDOVER',storeId:'s',name:'Rice',generation:1,canConfirmHandover:false,expiresAt:2000000000},calls=[];
 await mount(async()=>snapshot());await clean();component=MerchantProduct;
 const api=async(p,o)=>{calls.push([p,o]);if(p.startsWith('/merchant/payouts'))return {items:[]};if(p==='/merchant/operations')return {items:[op]};if(p.endsWith('/cancel-invalidated'))return {...op,state:'CANCELLED'};return op;};
 props={api,session,active:true,catalog,clock:()=>1800000000};document.body.innerHTML='<div id="test"></div>';root=createRoot(document.getElementById('test'));await render();
 try{await click('查看原处理');assert.ok(button('核验失效并取消未发送处理'));assert.equal(button('尚未交餐，取消处理').disabled,true);await click('核验失效并取消未发送处理');assert.ok(calls.some(([p,o])=>p==='/merchant/operations/old-handover/cancel-invalidated'&&o.method==='POST'&&Object.keys(o.body).length===0));
 op.state='SEND_UNKNOWN';await click('查看原处理');assert.ok(!button('核验失效并取消未发送处理'));assert.ok(!calls.some(([p])=>p.endsWith('/resume')||p.endsWith('/attempt')));
 }finally{await clean();}
});

after(async()=>{dom.window.close();await rm(dir,{recursive:true,force:true});});
