import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {JSDOM} from 'jsdom';
const dir=await mkdtemp(tmpdir()+'/mf-original-tx-'),base=new URL('../',import.meta.url);
await build({entryPoints:[new URL('original-transaction-recovery.jsx',base).pathname],outfile:dir+'/component.mjs',bundle:true,format:'esm',platform:'node',jsx:'transform',tsconfigRaw:{compilerOptions:{jsx:'react'}},plugins:[{name:'react',setup(b){b.onResolve({filter:/^react$/},()=>({path:new URL('node_modules/react/index.js',base).pathname,external:true}));}}]});
const dom=new JSDOM('',{url:'https://example.test/product-v2/index.html'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client'),{OriginalTransactionRecovery}=await import(dir+'/component.mjs');
const A='0x'+'11'.repeat(20),B='0x'+'22'.repeat(20),HASH='0x'+'ab'.repeat(32),WRONG='0x'+'cd'.repeat(32),operation={id:'original',kind:'refund',wallet:A,state:'SEND_UNKNOWN'};
let root,props;const tick=()=>new Promise(r=>setTimeout(r,0));
async function render(){await act(async()=>{root.render(React.createElement(OriginalTransactionRecovery,props));await tick();});}
async function mount(extra={}){props={operation,api:async()=>operation,...extra};document.body.innerHTML='<div id="test"></div>';root=createRoot(document.getElementById('test'));await render();}
async function clean(){await act(async()=>root.unmount());}
const input=()=>document.querySelector('[aria-label="原交易编号"]'),button=()=>document.querySelector('button');
async function type(value){await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(input(),value);input().dispatchEvent(new window.Event('input',{bubbles:true}));await tick();});}
async function click(){await act(async()=>{button().click();await tick();});}

test('only pending original operations bound to an explicit wallet are shown',async()=>{
 await mount();try{assert.match(document.body.textContent,/仅核验，不会再次付款/);for(const changed of [{...operation,state:'PREPARED'},{...operation,state:'CONFIRMED'},{...operation,state:'REVERTED'},{...operation,wallet:undefined},{...operation,wallet:'0x'+'00'.repeat(20)},{...operation,kind:'arbitrary-write'}]){props={...props,operation:changed};await render();assert.equal(input(),null);}}finally{await clean();}
});

test('invalid transaction identifiers cannot invoke the API',async()=>{
 const calls=[];await mount({api:async(...args)=>calls.push(args)});try{for(const value of ['','0x123','0x'+'gg'.repeat(32),'0x'+'aa'.repeat(33),HASH.slice(2)]){await type(value);assert.equal(button().disabled,true);await click();}assert.equal(calls.length,0);}finally{await clean();}
});

test('candidate is recorded then original operation queried; no attempt, prepare or wallet call',async()=>{
 const calls=[],recovered=[];await mount({api:async(p,o)=>{calls.push([p,o]);return {...operation,state:'CONFIRMED',txHash:HASH};},onRecovered:r=>recovered.push(r)});
 try{await type('0x'+HASH.slice(2).toUpperCase());await click();assert.deepEqual(calls,[['/catalog-operations/original/hash',{method:'POST',body:{txHash:HASH}}],['/catalog-operations/original',undefined]]);assert.equal(recovered.length,1);assert.equal(recovered[0].state,'CONFIRMED');}finally{await clean();}
});

test('unverified wrong candidate can be corrected; the original operation ID stays fixed',async()=>{
 const candidates=[];await mount({api:async(p,o)=>{if(o)candidates.push(o.body.txHash);return {...operation,candidateHash:candidates.at(-1)};},onRecovered:async r=>{props={...props,operation:r};}});
 try{await type(WRONG);await click();await render();await type(HASH);await click();assert.deepEqual(candidates,[WRONG,HASH]);assert.equal(props.operation.id,'original');}finally{await clean();}
});

test('verified bound hash cannot be changed and only GET is needed',async()=>{
 const calls=[];await mount({operation:{...operation,state:'HASH_BOUND',txHash:HASH},api:async(...args)=>{calls.push(args);return {...operation,state:'HASH_BOUND',txHash:HASH};}});
 try{assert.equal(input().readOnly,true);await type(WRONG);assert.equal(input().value,HASH);await click();assert.deepEqual(calls,[['/catalog-operations/original']]);}finally{await clean();}
});

test('duplicate clicks share one in-flight original hash record',async()=>{
 let release;const calls=[];await mount({api:async(p,o)=>{calls.push([p,o]);return o?new Promise(r=>release=r):operation;}});
 try{await type(HASH);await click();await click();assert.equal(calls.length,1);await act(async()=>{release(operation);await tick();});assert.equal(calls.length,2);}finally{await clean();}
});

test('wallet switch discards late hash response before follow-up GET or callback',async()=>{
 let release;const calls=[],recovered=[];await mount({api:async(p,o)=>{calls.push([p,o]);return new Promise(r=>release=r);},onRecovered:r=>recovered.push(r)});
 try{await type(HASH);await click();props={...props,operation:{...operation,wallet:B,id:'other'}};await render();assert.equal(input().value,'');await act(async()=>{release(operation);await tick();});assert.equal(calls.length,1);assert.equal(recovered.length,0);assert.equal(input().value,'');}finally{await clean();}
});

test('operation switch discards late GET response and private status',async()=>{
 let release;const recovered=[];await mount({api:async(p,o)=>o?operation:new Promise(r=>release=r),onRecovered:r=>recovered.push(r)});
 try{await type(HASH);await click();props={...props,operation:{...operation,id:'other'}};await render();await act(async()=>{release({...operation,state:'CONFIRMED'});await tick();});assert.equal(recovered.length,0);assert.ok(!document.body.textContent.includes('原交易已确认'));}finally{await clean();}
});

test('wrong-wallet returned operation is rejected; merchant receiver is accepted as owner evidence',async()=>{
 let recovered=0;await mount({api:async()=>({...operation,wallet:B}),onRecovered:()=>recovered++});try{await type(HASH);await click();assert.equal(recovered,0);assert.match(document.body.textContent,/与当前钱包不一致/);
 props={...props,operation:{...operation,kind:'handover'},api:async()=>({id:'original',kind:'handover',receiver:A,state:'HASH_BOUND',txHash:HASH})};await render();await type(HASH);await click();assert.equal(recovered,1);}finally{await clean();}
});


test('unmount discards a late response without querying or notifying a new screen',async()=>{
 let release,recovered=0;const calls=[];await mount({api:async(p,o)=>{calls.push([p,o]);return new Promise(r=>release=r);},onRecovered:()=>recovered++});
 await type(HASH);await click();await clean();await act(async()=>{release(operation);await tick();});assert.equal(calls.length,1);assert.equal(recovered,0);
});

after(async()=>{dom.window.close();await rm(dir,{recursive:true,force:true});});
