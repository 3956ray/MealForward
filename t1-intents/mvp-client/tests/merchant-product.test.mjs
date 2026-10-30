import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {JSDOM} from 'jsdom';
const dir=await mkdtemp(tmpdir()+'/mf-merchant-'),base=new URL('../',import.meta.url);
await build({entryPoints:[new URL('merchant-product.jsx',base).pathname],outfile:dir+'/component.mjs',bundle:true,format:'esm',platform:'node',jsx:'transform',tsconfigRaw:{compilerOptions:{jsx:'react'}},plugins:[{name:'react',setup(b){b.onResolve({filter:/^react$/},()=>({path:new URL('node_modules/react/index.js',base).pathname,external:true}));}}]});
const dom=new JSDOM('',{url:'https://example.test/product-v2/index.html'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,sessionStorage:dom.window.sessionStorage,IS_REACT_ACT_ENVIRONMENT:true});
const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client'),{MerchantProduct,settlementWait}=await import(dir+'/component.mjs');
let root,props,now;const owner={wallet:'0x111',stores:['s']},tick=()=>new Promise(r=>setTimeout(r,0));
const check={handle:'h',name:'原餐',version:1,unitPrice:'7000000',windows:[[0,1440]],expiresAt:1e10,state:'ISSUED'};
const reserved={id:'op',requestId:'lock-original',storeId:'s',kind:'handover',state:'AWAITING_HANDOVER',handle:'h',canConfirmHandover:true,name:'原餐',version:1,unitPrice:'7000000',windows:[[0,1440]],expiresAt:10000};
const op={id:'op',kind:'handover',state:'PREPARED',transaction:{from:'owner',to:'escrow'}};
function fixture(extra=()=>undefined){return async(path,o)=>{const answer=extra(path,o);if(answer!==undefined)return answer;if(path==='/merchant/operations')return {items:[]};if(path.startsWith('/merchant/payouts?'))return {items:[]};if(path==='/merchant/check')return check;if(path==='/merchant/locks')return reserved;if(path==='/merchant/handovers')return op;if(path==='/merchant/operations/op')return {...op,state:'SEND_UNKNOWN'};throw Error(path);};}
async function render(){await act(async()=>{root.render(React.createElement(MerchantProduct,props));await tick();});}
async function mount(api,extra={}){if(!extra.keepStorage)sessionStorage.clear();now=1000;props={api,session:owner,active:true,clock:()=>now,...extra};document.body.innerHTML='<div id="test"></div>';root=createRoot(document.getElementById('test'));await render();}
const button=text=>[...document.querySelectorAll('button')].find(x=>x.textContent===text);
async function click(text){await act(async()=>{assert.ok(button(text),text);button(text).click();await tick();});}
async function enterCode(){await act(async()=>{const input=document.querySelector('input[aria-label="六位短时取餐码"]');Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(input,'123456');input.dispatchEvent(new window.Event('input',{bubbles:true}));await tick();});}
async function acknowledge(){if(button('开始处理此餐券'))await click('开始处理此餐券');await act(async()=>{document.querySelector('input[type=checkbox]').click();await tick();});}
async function clean(){await act(async()=>root.unmount());}
test('check is non-consuming and handover requires an explicit physical delivery acknowledgement',async()=>{
 const writes=[];await mount(fixture((p,o)=>{if(o?.body)writes.push([p,o.body]);}));try{await enterCode();await click('检查餐券');assert.ok(!button('确认已交餐'));assert.equal(document.querySelector('input[type=checkbox]'),null);assert.equal(writes.length,1);await click('开始处理此餐券');assert.equal(button('确认已交餐').disabled,true);assert.equal(writes[1][0],'/merchant/locks');await acknowledge();await click('确认已交餐');assert.equal(writes[2][0],'/merchant/handovers');assert.equal(writes[2][1].handedOver,true);assert.equal(button('商家钱包确认').disabled,true);assert.ok(document.body.textContent.includes('等待本人钱包接入'));assert.ok(!document.body.textContent.includes('已交餐，待结算'));}finally{await clean();}
});
test('host callback only runs on explicit wallet button and never repeats after unknown',async()=>{
 let sends=0;await mount(fixture(),{onWalletOperation:async operation=>{sends++;assert.equal(operation.state,'PREPARED');}});try{await enterCode();await click('检查餐券');await acknowledge();await click('确认已交餐');assert.equal(sends,0);await click('商家钱包确认');assert.equal(sends,1);assert.ok(!button('商家钱包确认'));await click('查询原操作');assert.equal(sends,1);}finally{await clean();}
});
test('unknown handover upgrade queries its existing lock operation without re-locking',async()=>{
 const calls=[];await mount(fixture((p,o)=>{calls.push([p,o]);if(p==='/merchant/handovers')throw Error('network lost');if(p.startsWith('/merchant/operations/by-request/'))return {...op,state:'SEND_UNKNOWN'};}));try{await enterCode();await click('检查餐券');await acknowledge();await click('确认已交餐');assert.ok(sessionStorage.getItem('mf-product-merchant:0x111:s'));await click('查询原操作');assert.equal(calls.filter(([p])=>p==='/merchant/handovers').length,1);assert.ok(calls.some(([p,o])=>p==='/merchant/operations/op'&&!o));assert.equal(calls.filter(([p])=>p==='/merchant/locks').length,1);assert.ok(!button('商家钱包确认'));}finally{await clean();}
});
test('179/180 countdown is advisory and never prepares or sends automatically',async()=>{
 const payout={voucherId:'v',name:'原餐',unitPrice:'7000000',state:'HANDED_OVER',settlementAvailableAt:1180,receiver:'merchant',chainTime:1179};let reviews=0;
 assert.equal(settlementWait(payout,1000,1000),1);assert.equal(settlementWait(payout,1000,1001),0);
 await mount(fixture((p)=>{if(p.startsWith('/merchant/payouts?'))return {items:[payout]};if(p==='/merchant/settlement-reviews'){reviews++;return {id:'r',...payout};}}));try{assert.equal(button('审核结算').disabled,true);now=1001;await act(async()=>{await new Promise(r=>setTimeout(r,550));});assert.equal(button('审核结算').disabled,false);assert.equal(reviews,0);await click('审核结算');assert.equal(reviews,1);assert.ok(document.querySelector('[aria-label="结算审核"]'));}finally{await clean();}
});
test('changed session discards late check and clears short code',async()=>{
 let finish;await mount(fixture(p=>p==='/merchant/check'?new Promise(r=>finish=r):undefined));try{await enterCode();await click('检查餐券');props={...props,session:null};await render();await act(async()=>{finish(check);await tick();});assert.ok(!document.querySelector('[aria-label="验券结果"]'));assert.ok(!document.body.textContent.includes('123456'));assert.ok(document.body.textContent.includes('商家钱包登录'));}finally{await clean();}
});
test('expired check cannot prepare handover',async()=>{
 let prepared=0;await mount(fixture(p=>p==='/merchant/check'?{...check,expiresAt:1001}:p==='/merchant/handovers'?(prepared++,op):undefined));try{await enterCode();await click('检查餐券');now=1002;await act(async()=>{await new Promise(r=>setTimeout(r,550));});assert.ok(!button('开始处理此餐券'));assert.ok(!button('确认已交餐'));assert.equal(prepared,0);}finally{await clean();}
});
after(async()=>{dom.window.close();await rm(dir,{recursive:true,force:true});});

test('expired PREPARED handover has an explicit cancellation; backend remains authoritative',async()=>{
 let cancelCalls=0,accept=false;await mount(fixture((p)=>{if(p==='/merchant/handovers')return {...op,expiresAt:1001};if(p==='/merchant/operations/op/cancel'){cancelCalls++;if(!accept)throw Error('PERMIT_NOT_EXPIRED');return {...op,state:'CANCELLED',expiresAt:1001};}}),{onWalletOperation:async()=>assert.fail('no send')});
 try{await enterCode();await click('检查餐券');await acknowledge();await click('确认已交餐');assert.ok(!button('取消过期未发送交餐请求'));now=1002;await act(async()=>{await new Promise(r=>setTimeout(r,550));});assert.equal(cancelCalls,0);assert.equal(button('商家钱包确认').disabled,true);await click('取消过期未发送交餐请求');assert.equal(cancelCalls,1);assert.ok(document.body.textContent.includes('PERMIT_NOT_EXPIRED'));assert.ok(button('取消过期未发送交餐请求'));accept=true;await click('取消过期未发送交餐请求');assert.equal(cancelCalls,2);assert.ok(document.body.textContent.includes('原操作已取消'));assert.ok(!button('取消过期未发送交餐请求'));await enterCode();await click('检查餐券');await acknowledge();assert.equal(button('确认已交餐').disabled,false);}finally{await clean();}
});
test('expired UNKNOWN handover never offers cancellation or wallet resend',async()=>{
 await mount(fixture(p=>p==='/merchant/handovers'?{...op,state:'SEND_UNKNOWN',expiresAt:900}:undefined));try{await enterCode();await click('检查餐券');await acknowledge();await click('确认已交餐');assert.ok(!button('取消过期未发送交餐请求'));assert.ok(!button('取消过期餐券处理'));assert.ok(!button('商家钱包确认'));assert.ok(button('查询原操作'));}finally{await clean();}
});

test('lost lock response recovers only its request and never confirms delivery automatically',async()=>{
 const calls=[];await mount(fixture((p,o)=>{calls.push([p,o]);if(p==='/merchant/locks')throw Error('connection lost');if(p.startsWith('/merchant/operations/by-request/'))return reserved;}));try{await enterCode();await click('检查餐券');await click('开始处理此餐券');assert.ok(!document.querySelector('input[type=checkbox]'));assert.ok(!button('尚未交餐，取消处理'));await click('查询原操作');assert.equal(calls.filter(([p])=>p==='/merchant/locks').length,1);assert.equal(calls.filter(([p])=>p==='/merchant/handovers').length,0);assert.equal(button('确认已交餐').disabled,true);assert.ok(calls.some(([p,o])=>p.startsWith('/merchant/operations/by-request/')&&!o));}finally{await clean();}
});
test('refresh restores original lock by GET without storing handle or repeating writes',async()=>{
 let locks=0,handovers=0;const api=fixture(p=>{if(p==='/merchant/locks'){locks++;return reserved;}if(p==='/merchant/operations/op')return reserved;if(p==='/merchant/handovers'){handovers++;return op;}});await mount(api);await enterCode();await click('检查餐券');await click('开始处理此餐券');assert.ok(!sessionStorage.getItem('mf-product-merchant:0x111:s').includes('handle'));await clean();await mount(api,{keepStorage:true});try{assert.ok(!document.querySelector('input[type=checkbox]'));await click('查询原操作');assert.equal(locks,1);assert.equal(handovers,0);assert.equal(document.querySelector('input[type=checkbox]').checked,false);await acknowledge();await click('确认已交餐');assert.equal(handovers,1);assert.equal(locks,1);}finally{await clean();}
});
test('reserved voucher remains confirmable after original check expires and only unchecked delivery can cancel',async()=>{
 let cancellations=0;await mount(fixture(p=>{if(p==='/merchant/check')return {...check,expiresAt:1001};if(p==='/merchant/operations/op/cancel'){cancellations++;return {...reserved,state:'CANCELLED'};}}));try{await enterCode();await click('检查餐券');await click('开始处理此餐券');now=1002;await act(async()=>{await new Promise(r=>setTimeout(r,550));});assert.ok(button('确认已交餐'));await acknowledge();assert.equal(button('确认已交餐').disabled,false);assert.equal(button('尚未交餐，取消处理').disabled,true);await acknowledge();await click('尚未交餐，取消处理');assert.equal(cancellations,1);assert.ok(!button('确认已交餐'));assert.ok(document.body.textContent.includes('原操作已取消'));}finally{await clean();}
});
test('only one terminal obtains the voucher lock; another cannot confirm or unlock',async()=>{
 let holder=null,handovers=0;const terminalApi=scope=>fixture(p=>{if(p==='/merchant/locks'){if(holder&&holder!==scope)throw Object.assign(Error('VOUCHER_UNAVAILABLE'),{status:409,code:'VOUCHER_UNAVAILABLE'});holder=scope;return reserved;}if(p==='/merchant/handovers'){assert.equal(holder,scope);handovers++;return op;}if(p==='/merchant/operations/op')return {...reserved,handle:undefined,canConfirmHandover:false};});
 await mount(terminalApi('A'));await enterCode();await click('检查餐券');await click('开始处理此餐券');assert.ok(document.querySelector('input[type=checkbox]'));await clean();await mount(terminalApi('B'));try{await enterCode();await click('检查餐券');await click('开始处理此餐券');assert.equal(holder,'A');assert.equal(handovers,0);assert.ok(document.body.textContent.includes('VOUCHER_UNAVAILABLE'));assert.ok(!document.querySelector('input[type=checkbox]'));assert.ok(!button('确认已交餐'));assert.ok(!button('尚未交餐，取消处理'));}finally{await clean();}
 await mount(terminalApi('B'));sessionStorage.setItem('mf-product-merchant:0x111:s',JSON.stringify({id:'op',requestId:'lock-request',kind:'handover'}));await clean();await mount(terminalApi('B'),{keepStorage:true});try{await click('查询原操作');assert.ok(!button('确认已交餐'));assert.equal(button('恢复原处理').disabled,true);assert.equal(button('尚未交餐，取消处理').disabled,true);}finally{await clean();}
});

test('history recovery transfers the original awaiting lock only after explicit prior-device acknowledgement',async()=>{
 const elsewhere={...reserved,handle:undefined,canConfirmHandover:false};let resumes=0,writes=0;await mount(fixture((p,o)=>{if(p==='/merchant/operations')return {items:[elsewhere]};if(p==='/merchant/operations/op')return elsewhere;if(p==='/merchant/operations/op/resume'){resumes++;assert.deepEqual(o.body,{previousDeviceStopped:true});return reserved;}if(o?.method==='POST')writes++;}));
 try{assert.equal(resumes,0);assert.ok(button('查看原处理'));await click('查看原处理');assert.equal(resumes,0);assert.ok(!button('确认已交餐'));assert.equal(button('恢复原处理').disabled,true);assert.equal(button('尚未交餐，取消处理').disabled,true);await act(async()=>{document.querySelector('input[aria-label="确认上一设备已停止处理"]').click();await tick();});assert.equal(resumes,0);await click('恢复原处理');assert.equal(resumes,1);assert.equal(writes,0);assert.equal(button('确认已交餐').disabled,true);assert.equal(button('恢复原处理'),undefined);const reference=JSON.parse(sessionStorage.getItem('mf-product-merchant:0x111:s'));assert.equal(reference.id,'op');assert.equal(reference.handle,undefined);}finally{await clean();}
});
test('lost transfer response permits only original GET recovery, never an automatic transfer or delivery',async()=>{
 const elsewhere={...reserved,handle:undefined,canConfirmHandover:false};let transferred=false,resumes=0,handovers=0;await mount(fixture(p=>{if(p==='/merchant/operations')return {items:[elsewhere]};if(p==='/merchant/operations/op')return transferred?reserved:elsewhere;if(p==='/merchant/operations/op/resume'){resumes++;transferred=true;throw Error('reply lost');}if(p==='/merchant/handovers'){handovers++;return op;}}));
 try{await click('查看原处理');await act(async()=>{document.querySelector('input[aria-label="确认上一设备已停止处理"]').click();await tick();});await click('恢复原处理');assert.ok(!button('恢复原处理'));assert.ok(!button('确认已交餐'));assert.ok(!button('尚未交餐，取消处理'));await click('查询原操作');assert.equal(resumes,1);assert.equal(handovers,0);assert.equal(button('确认已交餐').disabled,true);}finally{await clean();}
});
test('an unknown operation in history cannot be transferred or cancelled',async()=>{
 const unknown={...reserved,state:'SEND_UNKNOWN',handle:undefined,canConfirmHandover:false};await mount(fixture(p=>p==='/merchant/operations'?{items:[unknown]}:p==='/merchant/operations/op'?unknown:undefined));try{await click('查看原处理');assert.ok(!button('恢复原处理'));assert.ok(!button('尚未交餐，取消处理'));assert.ok(!button('取消过期未发送交餐请求'));assert.ok(!button('确认已交餐'));}finally{await clean();}
});
test('definitive lock rejection clears only that uncreated request so a new voucher can be checked',async()=>{
 let rejected=true;await mount(fixture(p=>{if(p==='/merchant/locks'&&rejected)throw Object.assign(Error('VOUCHER_UNAVAILABLE'),{status:409,code:'VOUCHER_UNAVAILABLE'});}));try{await enterCode();await click('检查餐券');await click('开始处理此餐券');assert.equal(sessionStorage.getItem('mf-product-merchant:0x111:s'),null);assert.ok(!button('确认已交餐'));rejected=false;await enterCode();await click('检查餐券');assert.equal(button('开始处理此餐券').disabled,false);await click('开始处理此餐券');assert.equal(button('确认已交餐').disabled,true);}finally{await clean();}
});

test('new session explicitly cancels expired awaiting voucher only after backend expiry verification',async()=>{
 const elsewhere={...reserved,handle:undefined,canConfirmHandover:false,expiresAt:1001};let cancellations=0,allow=false;await mount(fixture((p,o)=>{if(p==='/merchant/operations')return {items:[elsewhere]};if(p==='/merchant/operations/op')return elsewhere;if(p==='/merchant/operations/op/cancel'){cancellations++;assert.deepEqual(o.body,{});if(!allow)throw Error('VOUCHER_NOT_EXPIRED_ON_CHAIN');return {...elsewhere,state:'CANCELLED'};}}));
 try{await click('查看原处理');assert.ok(!button('取消过期餐券处理'));assert.equal(button('尚未交餐，取消处理').disabled,true);assert.equal(button('恢复原处理').disabled,true);now=1002;await act(async()=>{await new Promise(r=>setTimeout(r,550));});assert.equal(cancellations,0);assert.equal(button('取消过期餐券处理').disabled,false);await click('取消过期餐券处理');assert.equal(cancellations,1);assert.ok(document.body.textContent.includes('VOUCHER_NOT_EXPIRED_ON_CHAIN'));assert.ok(button('取消过期餐券处理'));allow=true;await click('取消过期餐券处理');assert.equal(cancellations,2);assert.ok(document.body.textContent.includes('原操作已取消'));assert.ok(!button('恢复原处理'));assert.ok(!button('取消过期餐券处理'));}finally{await clean();}
});

test('replacement handover preserves delivered meal and only explicitly prepares renewed wallet confirmation',async()=>{
 const replacement={...reserved,id:'replacement',handle:'renewed-handle',handoverPreviouslyConfirmed:true},writes=[];
 await mount(fixture((p,o)=>{if(o)writes.push([p,o.body]);if(p==='/merchant/operations')return {items:[replacement]};if(p==='/merchant/operations/replacement')return replacement;}));
 try{await click('查看原处理');assert.match(document.body.textContent,/已保留原交餐记录.*勿重复交餐/);assert.equal(document.querySelector('input[type=checkbox]'),null);assert.equal(button('尚未交餐，取消处理'),undefined);assert.equal(button('核验失效并取消未发送处理'),undefined);assert.ok(button('核验餐券已失效并结束处理'));assert.equal(writes.length,0);await click('继续原交餐确认');assert.equal(writes.length,1);assert.equal(writes[0][0],'/merchant/handovers');assert.equal(writes[0][1].handle,'renewed-handle');assert.equal(writes[0][1].handedOver,true);assert.equal(button('商家钱包确认').disabled,true);}finally{await clean();}
});

test('previously delivered continuation only ends after explicit invalidation verifier accepts',async()=>{
 const replacement={...reserved,id:'replacement',handle:'renewed-handle',handoverPreviouslyConfirmed:true};let invalidated=false,checks=0;
 await mount(fixture((p,o)=>{if(p==='/merchant/operations')return {items:[replacement]};if(p==='/merchant/operations/replacement')return replacement;if(p==='/merchant/operations/replacement/cancel-invalidated'){checks++;if(!invalidated)throw Error('VOUCHER_STILL_VALID');return {...replacement,state:'CANCELLED'};}if(o)throw Error('unexpected write');}));
 try{await click('查看原处理');assert.equal(button('尚未交餐，取消处理'),undefined);await click('核验餐券已失效并结束处理');assert.equal(checks,1);assert.match(document.body.textContent,/VOUCHER_STILL_VALID/);assert.ok(button('继续原交餐确认'));invalidated=true;await click('核验餐券已失效并结束处理');assert.equal(checks,2);assert.match(document.body.textContent,/原操作已取消/);assert.equal(button('继续原交餐确认'),undefined);}finally{await clean();}
});
