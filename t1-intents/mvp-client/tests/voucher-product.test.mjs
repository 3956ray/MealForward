import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {JSDOM} from 'jsdom';
const dir=await mkdtemp(tmpdir()+'/mf-voucher-'),base=new URL('../',import.meta.url);
await build({entryPoints:[new URL('catalog-product.jsx',base).pathname],outfile:dir+'/component.mjs',bundle:true,format:'esm',platform:'node',jsx:'transform',tsconfigRaw:{compilerOptions:{jsx:'react'}},plugins:[{name:'react',setup(b){b.onResolve({filter:/^react$/},()=>({path:new URL('node_modules/react/index.js',base).pathname,external:true}));}}]});
const dom=new JSDOM('',{url:'https://example.test/product-v2/index.html'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,location:dom.window.location,HTMLElement:dom.window.HTMLElement,sessionStorage:dom.window.sessionStorage,IS_REACT_ACT_ENVIRONMENT:true});
const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client'),{CatalogProduct}=await import(dir+'/component.mjs');
const now=Math.floor(Date.now()/1000),owner={wallet:'0x111',stores:[]},catalog={stores:[{id:'s',name:'厨房'}],asset:{symbol:'USDC',decimals:6},claimEnabled:true,fundingEnabled:false,meals:[{id:'m',storeId:'s',name:'热餐',version:1,unitPrice:'7000000',remaining:'0',claimable:'2',listed:false,fundingDeadline:1,windows:[[0,1440]]}]};
const voucher={id:'v',claimId:'c',name:'原餐券',state:'ISSUED',version:1,expiresAt:now+7200,windows:[[0,1440]]};
let root,api,session;const tick=()=>new Promise(r=>setTimeout(r,0));
async function render(extra={}){await act(async()=>{root.render(React.createElement(CatalogProduct,{api,session,...extra}));await tick();});}
async function mount(call,s=owner,hash=''){sessionStorage.clear();window.history.replaceState(null,'','/product-v2/index.html'+hash);api=call;session=s;document.body.innerHTML='<div id="test"></div>';root=createRoot(document.getElementById('test'));await render();}
async function click(text){await act(async()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent===text);assert.ok(b,text);b.click();await tick();});}
async function clean(){await act(async()=>root.unmount());}
function fixture(extra=()=>undefined){return async(path,o)=>{const override=extra(path,o);if(override!==undefined)return override;if(path==='/catalog')return catalog;if(path==='/vouchers')return {items:[]};if(path==='/claim-reviews')return {id:'r',name:'热餐',version:1,windows:[[0,1440]],lifetimeSeconds:7200,expiresAt:now+300};if(path==='/vouchers/v')return voucher;throw Error(path);};}
test('unlisted expired sale remains claimable; platform flow calls no wallet provider',async()=>{
 let writes=0,provider=0;window.ethereum={request(){provider++;throw Error('must not call');}};
 await mount(fixture((p)=>p==='/claim-intents'?(writes++,{id:'c',state:'CONFIRMED',voucherId:'v'}):undefined));try{await click('领取餐食');assert.ok(document.body.textContent.includes('平台承担'));await click('确认领取');assert.equal(writes,1);assert.equal(provider,0);await click('打开餐券');assert.ok(document.querySelector('[aria-label="原餐券"]'));}finally{delete window.ethereum;await clean();}
});
test('unknown confirmation persists request reference; recovery only GET and no re-Claim',async()=>{
 const calls=[];await mount(fixture((p,o)=>{calls.push([p,o]);if(p==='/claim-intents')throw Error('network lost');if(p.startsWith('/claims/by-request/'))return {id:'c',state:'SEND_UNKNOWN'};}));
 try{await click('领取餐食');await click('确认领取');assert.ok(document.body.textContent.includes('领取结果待核对'));assert.ok(sessionStorage.getItem('mealforward-product-claim:0x111'));await click('查询原领取');assert.equal(calls.filter(([p])=>p==='/claim-intents').length,1);assert.ok(calls.some(([p,o])=>p.startsWith('/claims/by-request/')&&!o));await click('厨房与餐品');await click('领取餐食');assert.equal(calls.filter(([p])=>p==='/claim-reviews').length,1);}finally{await clean();}
});
test('long link waits for original-wallet login and never bypasses rejected access',async()=>{
 const calls=[];let login=0;await mount(fixture((p)=>{calls.push(p);if(p==='/vouchers/v')throw Error('NOT_YOUR_VOUCHER');}),null,'#voucher=v');
 try{assert.ok(document.body.textContent.includes('原领取钱包'));assert.ok(!calls.includes('/vouchers/v'));await render({onLogin:()=>login++});await click('登录查看餐券');assert.equal(login,1);session=owner;await render();assert.ok(calls.includes('/vouchers/v'));assert.ok(!document.querySelector('[aria-label="原餐券"]'));assert.ok(document.body.textContent.includes('NOT_YOUR_VOUCHER'));}finally{await clean();}
});
test('short code is removed on expiry and identity change, while saved link has only voucher id',async()=>{
 let shortExpiry=Date.now()/1000+0.7;await mount(fixture(p=>p==='/vouchers/v/display'?{code:'123456',expiresAt:shortExpiry}:undefined),owner,'#voucher=v');
 try{await click('生成短时取餐码');assert.ok(document.body.textContent.includes('123456'));assert.equal(document.querySelector('input[readonly]').value,'https://example.test/product-v2/index.html#voucher=v');await act(async()=>{await new Promise(r=>setTimeout(r,1100));});assert.ok(!document.querySelector('[aria-label="短时取餐码"]'));shortExpiry=Date.now()/1000+60;await click('生成短时取餐码');session=null;await render();assert.ok(!document.body.textContent.includes('123456'));assert.ok(!document.querySelector('[aria-label="原餐券"]'));}finally{await clean();}
});
test('non-service time disables display but not claim',async()=>{
 const minute=Math.floor(Date.now()/60000+480)%1440,a=(minute+10)%1440;
 await mount(fixture(p=>p==='/vouchers/v'?{...voucher,windows:[[a,a+1]]}:undefined),owner,'#voucher=v');try{const b=[...document.querySelectorAll('button')].find(x=>x.textContent==='生成短时取餐码');assert.equal(b.disabled,true);}finally{await clean();}
});
test('late voucher after identity change cannot reveal private contents',async()=>{
 let finish;await mount(fixture(p=>p==='/vouchers/v'?new Promise(r=>finish=r):undefined),owner,'#voucher=v');try{session=null;await render();await act(async()=>{finish(voucher);await tick();});assert.ok(!document.querySelector('[aria-label="原餐券"]'));}finally{await clean();}
});
test('refresh restores only original request references and never auto reclaims',async()=>{
 const calls=[];const call=fixture((p)=>{calls.push(p);if(p==='/claim-intents')throw Error('lost response');if(p.startsWith('/claims/by-request/'))return {id:'c',state:'SEND_UNKNOWN'};});
 await mount(call);try{await click('领取餐食');await click('确认领取');const stored=sessionStorage.getItem('mealforward-product-claim:0x111');await clean();document.body.innerHTML='<div id="test"></div>';root=createRoot(document.getElementById('test'));await render();await click('我的餐券');assert.equal(sessionStorage.getItem('mealforward-product-claim:0x111'),stored);await click('查询原领取');assert.equal(calls.filter(p=>p==='/claim-intents').length,1);assert.equal(calls.filter(p=>p==='/claim-reviews').length,1);}finally{await clean();}
});
test('cancelled claim review cannot return after navigating away',async()=>{
 let finish;await mount(fixture(p=>p==='/claim-reviews'?new Promise(r=>finish=r):undefined));try{await click('领取餐食');await click('厨房与餐品');await act(async()=>{finish({id:'r',name:'热餐',version:1,windows:[[0,1440]],lifetimeSeconds:7200,expiresAt:now+300});await tick();});assert.ok(!document.querySelector('[aria-label="领取审核"]'));assert.ok(!document.body.textContent.includes('领取已确认'));}finally{await clean();}
});
after(async()=>{dom.window.close();await rm(dir,{recursive:true,force:true});});

test('definitive claim rejection permits a fresh review and a new explicit claim request',async()=>{
 const reviews=[],claims=[];await mount(fixture((p,o)=>{if(p==='/claim-reviews'){reviews.push(o.body.requestId);return {id:'r'+reviews.length,name:'热餐',version:1,windows:[[0,1440]],lifetimeSeconds:7200,expiresAt:now+300};}if(p==='/claim-intents'){claims.push(o.body);if(claims.length===1)throw Object.assign(Error('CLAIM_COOLDOWN'),{code:'CLAIM_COOLDOWN',status:409});return {id:'c',state:'CONFIRMED',voucherId:'v'};}}));
 try{await click('领取餐食');await click('确认领取');assert.ok(document.body.textContent.includes('原领取未成功'));assert.ok(!document.body.textContent.includes('领取已确认'));await click('重新读取领取审核');assert.equal(reviews.length,2);assert.notEqual(reviews[0],reviews[1]);assert.equal(claims.length,1);await click('确认领取');assert.equal(claims.length,2);assert.notEqual(claims[0].requestId,claims[1].requestId);assert.equal(claims[1].reviewId,'r2');assert.ok(document.body.textContent.includes('领取已确认'));}finally{await clean();}
});

test('saved voucher link outranks stale meal selection across identity changes; explicit catalog intent clears link',async()=>{
 let reviews=0;await mount(fixture((p)=>{if(p==='/claim-reviews'){reviews++;return {id:'review-'+reviews,name:'热餐',version:1,windows:[[0,1440]],lifetimeSeconds:7200,expiresAt:now+300};}if(p==='/vouchers')return {items:session?.wallet===owner.wallet?[voucher]:[]};if(p==='/vouchers/v'&&session?.wallet!==owner.wallet)throw Object.assign(Error('VOUCHER_NOT_FOUND'),{status:404,code:'VOUCHER_NOT_FOUND'});}));
 try{await click('领取餐食');assert.equal(reviews,1);await click('取消');await click('查看餐券');await act(async()=>{window.history.replaceState(null,'','/product-v2/index.html#voucher=v');window.dispatchEvent(new window.HashChangeEvent('hashchange'));await tick();});session={wallet:'0x222',stores:[]};await render();await act(async()=>{await tick();});assert.equal(reviews,1);assert.ok(document.body.textContent.includes('VOUCHER_NOT_FOUND'));assert.equal(document.querySelector('[aria-label="原餐券"]'),null);assert.equal(document.querySelector('[aria-label="领取审核"]'),null);assert.ok(![...document.querySelectorAll('button')].some(b=>b.textContent==='重新读取领取审核'));await click('厨房与餐品');await click('领取餐食');assert.equal(window.location.hash,'');assert.equal(reviews,2);assert.ok(document.querySelector('[aria-label="领取审核"]'));}finally{await clean();}
});
