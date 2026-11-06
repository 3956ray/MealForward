import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {JSDOM} from 'jsdom';
const dir=await mkdtemp(tmpdir()+'/mf-cancel-ui-'),base=new URL('../',import.meta.url);
await build({entryPoints:[new URL('pending-operation-cancellation.jsx',base).pathname],outfile:dir+'/component.mjs',bundle:true,format:'esm',platform:'node',jsx:'transform',tsconfigRaw:{compilerOptions:{jsx:'react'}},plugins:[{name:'react',setup(b){b.onResolve({filter:/^react$/},()=>({path:new URL('node_modules/react/index.js',base).pathname,external:true}));}}]});
const dom=new JSDOM('',{url:'https://example.test/product-v2/index.html'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client'),{PendingOperationCancellation}=await import(dir+'/component.mjs');
const A='0x'+'11'.repeat(20),B='0x'+'22'.repeat(20),HASH='0x'+'ab'.repeat(32),operation={id:'original',kind:'support',wallet:A,state:'SEND_UNKNOWN'},config={verified:true,chainId:10143,asset:'0x534b2f3a21130d7a60830c2df862319e593943a3',escrow:B};
const packet=()=>({...operation,originalNonce:'0x3',transaction:{from:A,to:A,chainId:'0x279f',nonce:'0x3',value:'0x0',data:'0x'}});
let root,props,calls,sends,recovered,storage;const tick=()=>new Promise(r=>setTimeout(r,0));
async function render(){await act(async()=>{root.render(React.createElement(PendingOperationCancellation,props));await tick();});}
async function mount(extra={}){calls=[];sends=[];recovered=[];const items=new Map();storage={getItem:k=>items.get(k)??null,setItem:(k,v)=>items.set(k,v),items};props={operation,session:{wallet:A},configuration:async()=>config,isCurrent:()=>true,storage,walletClient:{inspect:async()=>({account:A,chainId:10143}),sendCancellationTransaction:async(...args)=>{sends.push(args);return HASH;}},api:async(p,o)=>{calls.push([p,o]);if(!o&&p.startsWith('/operation-cancellations'))return packet();return {...operation,state:'CANCELLED'};},onRecovered:r=>recovered.push(r),...extra};document.body.innerHTML='<div id="test"></div>';root=createRoot(document.getElementById('test'));await render();}
async function clean(){await act(async()=>root.unmount());}
const button=name=>[...document.querySelectorAll('button')].find(b=>b.textContent===name);
async function click(name){await act(async()=>{button(name).click();await tick();});}
async function consent(){await act(async()=>{document.querySelector('[type="checkbox"]').click();await tick();});}
async function type(value){await act(async()=>{const input=document.querySelector('[aria-label="已有作废交易编号"]');Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new window.Event('input',{bubbles:true}));await tick();});}
const send='在钱包确认作废交易',query='核验作废交易';

test('explicit decline preserves original; explicit zero-self cancellation can then release it',async()=>{
 await mount();try{assert.equal(button(send).disabled,true);await click(send);assert.equal(calls.length,0);assert.match(document.body.textContent,/Gas 费用/);let declined=true;props.walletClient.sendCancellationTransaction=async(...args)=>{sends.push(args);if(declined){declined=false;throw Object.assign(Error('用户拒绝'),{code:4001});}return HASH;};await consent();await click(send);assert.equal(sends.length,1);assert.equal(recovered.length,0);assert.equal(calls.filter(c=>c[1]).length,0);assert.match(document.body.textContent,/用户拒绝/);await click(send);assert.equal(sends.length,2);assert.deepEqual(sends[1][1],packet().transaction);assert.equal(recovered[0].state,'CANCELLED');assert.deepEqual(calls.map(c=>[c[0],c[1]?.method??'GET']),[['/operation-cancellations/intents/original','GET'],['/operation-cancellations/intents/original','GET'],['/operation-cancellations/intents/original','POST'],['/intents/original','GET']]);assert.equal(JSON.parse([...storage.items.values()][0]).hash,HASH);}finally{await clean();}
});

test('malicious cancellation packet never reaches wallet',async()=>{
 const changes=[p=>p.transaction.to=B,p=>p.transaction.from=B,p=>p.wallet=B,p=>p.id='other',p=>p.kind='approval',p=>p.transaction.data='0x12',p=>p.transaction.value='0x1',p=>p.transaction.chainId='0x1',p=>p.transaction.nonce='0x4',p=>p.originalNonce='3',p=>p.transaction.nonce='0x03',p=>p.transaction.nonce='0x20000000000000',p=>p.transaction.gas='0x1'];
 for(const change of changes){await mount({api:async()=>{const p=packet();change(p);return p;}});try{await consent();await click(send);assert.equal(sends.length,0);assert.equal(recovered.length,0);assert.match(document.body.textContent,/不一致/);}finally{await clean();}}
});

test('wallet switch while prompt is open stores returned hash only under old wallet',async()=>{
 let finish;await mount();try{props.walletClient.sendCancellationTransaction=()=>new Promise(r=>finish=r);await consent();await click(send);props={...props,session:{wallet:B}};await render();await act(async()=>{finish(HASH);await tick();});assert.equal(calls.length,1);assert.equal(recovered.length,0);const [key,text]=[...storage.items.entries()][0];assert.match(key,new RegExp(A));assert.equal(JSON.parse(text).hash,HASH);assert.equal(document.body.textContent,'');}finally{await clean();}
});

test('identity epoch change after configuration query prevents cancellation send',async()=>{
 let finish,current=true;await mount({configuration:()=>new Promise(r=>finish=r),isCurrent:()=>current});try{await consent();await click(send);current=false;await act(async()=>{finish(config);await tick();});assert.equal(sends.length,0);assert.equal(calls.length,1);}finally{await clean();}
});

test('lost hash-record response survives remount without another wallet request',async()=>{
 await mount();const api=props.api;try{props.api=async(p,o)=>{if(o){calls.push([p,o]);throw Error('offline');}return api(p,o);};await consent();await click(send);assert.equal(sends.length,1);const originalStorage=storage;await clean();await mount({storage:originalStorage});assert.equal(calls.length,0);assert.equal(sends.length,0);assert.equal(button(send).disabled,true);await click(query);assert.equal(sends.length,0);assert.equal(recovered[0].state,'CANCELLED');assert.equal(calls[0][1].body.txHash,HASH);}finally{await clean();}
});

test('manual cancellation hash only posts evidence and reads original operation',async()=>{
 await mount({walletClient:undefined});try{await type(HASH);await click(query);assert.equal(sends.length,0);assert.equal(recovered[0].state,'CANCELLED');assert.deepEqual(calls.map(c=>c[0]),['/operation-cancellations/intents/original','/intents/original']);}finally{await clean();}
});

test('original completed before cancel packet: read original without self transfer',async()=>{
 await mount({api:async(p,o)=>{calls.push([p,o]);return {...operation,state:'CONFIRMED'};}});try{await consent();await click(send);assert.equal(sends.length,0);assert.equal(recovered[0].state,'CONFIRMED');assert.equal(calls.length,2);}finally{await clean();}
});

test('operation groups map consistently; GET/read never sends automatically',async()=>{
 for(const [kind,group,original] of [['approval','approvals','approvals'],['publication','publications','catalog-operations'],['handover','redemptions','merchant/operations']]){const op={...operation,kind};await mount({operation:op,api:async(p,o)=>{calls.push([p,o]);return {...op,state:'CANCELLED'};}});try{assert.equal(calls.length,0);await type(HASH);await click(query);assert.deepEqual(calls.map(c=>c[0]),['/operation-cancellations/'+group+'/original','/'+original+'/original']);assert.equal(sends.length,0);}finally{await clean();}}
});
after(async()=>{dom.window.close();await rm(dir,{recursive:true,force:true});});

test('handover cancellation follows replacement while preserving physical-delivery responsibility',async()=>{
 const original={...operation,kind:'handover',voucherId:'v'},replacement={...original,id:'replacement',state:'AWAITING_HANDOVER',handoverPreviouslyConfirmed:true};
 await mount({operation:original,api:async(p,o)=>{calls.push([p,o]);if(o)return {...original,state:'CANCELLED',replacementOperationId:'replacement'};if(p==='/merchant/operations/replacement')return replacement;throw Error(p);}});
 try{await type(HASH);await click(query);assert.equal(sends.length,0);assert.deepEqual(recovered,[replacement]);assert.deepEqual(calls.map(c=>c[0]),['/operation-cancellations/redemptions/original','/merchant/operations/replacement']);}finally{await clean();}
});

test('replacement cannot redirect to another wallet or erase handed-over acknowledgement',async()=>{
 for(const changed of [{wallet:B,handoverPreviouslyConfirmed:true},{wallet:A,handoverPreviouslyConfirmed:false},{wallet:A,handoverPreviouslyConfirmed:true,voucherId:'another'}]){
  const original={...operation,kind:'handover',voucherId:'v'};await mount({operation:original,api:async(p,o)=>o?{...original,state:'CANCELLED',replacementOperationId:'replacement'}:{...original,id:'replacement',state:'AWAITING_HANDOVER',...changed}});
  try{await type(HASH);await click(query);assert.equal(recovered.length,0);assert.match(document.body.textContent,/不一致/);}finally{await clean();}
 }
});
