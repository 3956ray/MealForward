// Offline checks only: no browser, HTTP server, database or external requests.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {QRCodeSVG} from 'qrcode.react';
import jsQR from 'jsqr';
import {createCollectionLink,consumeCollectionLink} from './collection-link.mjs';
import {priceDisplay} from './wallet-entry.js';

const html=readFileSync(new URL('index.html',import.meta.url),'utf8');
const source=readFileSync(new URL('consumer.js',import.meta.url),'utf8');
const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(match=>match[1]));
for(const match of source.matchAll(/\$\('([^']+)'\)/g))assert(ids.has(match[1]),'Missing DOM target: '+match[1]);
assert(html.includes('src="/consumer.js" type="module"'));
const app=readFileSync(new URL('../src/c1/application.py',import.meta.url),'utf8');
for(const route of ['auth/pre-session','auth/login','auth/reauth','auth/logout','me','stores','ledger','my/orders','my/vouchers','support/reviews','claims/reviews','support/intents','claims/intents','refund-intents'])assert(app.includes('/v1/'+route),'Missing literal route: '+route);
for(const route of ['workbench','payouts','cases','drafts','image','review','publish','list','pause','close','checks','locks','handover-intents','settle-reviews','settle-intents','recover','display','cancel','refund-reviews'])assert(app.includes(route),'Missing parameterized route: '+route);
assert(app.includes("'/assets/qr.js':'assets/qr.js'"));

// Rasterize the library's SVG row rectangles, then decode with installed jsQR.
// This does not generate QR data or implement a QR algorithm.
const token='Ab_09-zX'.repeat(6).slice(0,43);
const link=createCollectionLink({origin:'https://meal.test',store:'S1',display:token});
const svg=renderToStaticMarkup(createElement(QRCodeSVG,{value:link,size:240,level:'M',marginSize:4}));
const modules=Number(svg.match(/viewBox="0 0 (\d+) (\d+)"/)[1]),scale=8,width=modules*scale;
const pixels=new Uint8ClampedArray(width*width*4).fill(255);
const black=svg.match(/<path fill="#000000" d="([^"]+)"/)[1];
for(const match of black.matchAll(/M(\d+)[, ]+(\d+)\s*h(\d+)v1H\d+z/g)){
  const [x,y,length]=match.slice(1).map(Number);
  for(let row=y*scale;row<(y+1)*scale;row++)for(let column=x*scale;column<(x+length)*scale;column++){
    const i=(row*width+column)*4;pixels[i]=pixels[i+1]=pixels[i+2]=0;
  }
}
assert.equal(jsQR(pixels,width,width)?.data,link,'QR must decode to exactly the short-lived same-origin link');

class Element {
  children=[];listeners={};elements={};hidden=false;value='';textContent='';
  append(...items){this.children.push(...items);}
  replaceChildren(...items){this.children=items;}
  addEventListener(name,fn){this.listeners[name]=fn;}
  reset(){}
  focus(){}
  showModal(){this.open=true;}
  close(){this.open=false;}
}
class Button extends Element {}
const nodes=new Map([...ids].map(id=>[id,new Element()]));
nodes.get('draft').elements.meal=new Element();nodes.get('check').elements.display=new Element();
let wall=Date.now(),monotonic=0,qr=null,voucherResponse={},requests=[];
const timers=new Map(),documentEvents={},windowEvents={};let timerId=0;
const context=vm.createContext({
  document:{hidden:false,getElementById:id=>nodes.get(id),createElement:tag=>tag==='button'?new Button():new Element(),querySelectorAll:selector=>selector==='.panel'?['browse','mine','owner'].map(id=>Object.assign(nodes.get(id),{id})):[],addEventListener:(name,fn)=>documentEvents[name]=fn},
  window:{location:{origin:'https://meal.test',href:'https://meal.test/',hash:''},history:{replaceState(){}},addEventListener:(name,fn)=>windowEvents[name]=fn,dispatchEvent(){}},Event:class {},CustomEvent:class {},
  HTMLButtonElement:Button,File:class {},Blob:class {},FormData:class {},
  crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000001'},
  Date:class extends Date {static now(){return wall;}},performance:{now:()=>monotonic},
  setInterval:fn=>{timers.set(++timerId,fn);return timerId;},clearInterval:id=>timers.delete(id),
  renderCode:value=>qr=value,clearQR:()=>qr=null,createCollectionLink,consumeCollectionLink,priceDisplay,
  fetch:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>url==='/v1/stores?limit=50'?{items:[]}:voucherResponse};},
});
vm.runInContext(source.replace(/^import.*$/gm,'').replace(/^export.*$/gm,'')+'\nglobalThis.test={state,showCode,clearCode,observeVoucher,track,openCase};',context);
await new Promise(resolve=>setImmediate(resolve));
const {test}=context;
const voucher='0x'+'a'.repeat(64),lock='0x'+'b'.repeat(64);
const display=()=>({display:token,validUntil:Math.floor(wall/1000)+120,displayEpoch:2,store:'S1'});
const live=()=>({id:voucher,state:'R',locked:false,marked:false,pending:null,accessEpoch:1,displayEpoch:2,store:'S1'});
test.showCode(display(),voucher,1);assert.equal(qr,link);
test.clearCode();assert.equal(qr,null);assert.equal(timers.size,0);
for(const change of [{state:'H'},{locked:true},{marked:true},{pending:'original-request'},{accessEpoch:2},{displayEpoch:3},{provenance:{halted:true}}]){
  test.showCode(display(),voucher,1);test.observeVoucher({...live(),...change});assert.equal(qr,null);
}
test.showCode(display(),voucher,1);monotonic+=120001;[...timers.values()][0]();assert.equal(qr,null);
test.showCode(display(),voucher,1);documentEvents.visibilitychange();assert.equal(qr,link);
context.document.hidden=true;documentEvents.visibilitychange();assert.equal(qr,null);context.document.hidden=false;
test.showCode(display(),voucher,1);windowEvents.pagehide();assert.equal(qr,null);
test.showCode(display(),voucher,1);await nodes.get('logout').listeners.click();assert.equal(qr,null);
test.showCode(display(),voucher,1);voucherResponse={...live(),state:'S'};
for(let i=0;i<5;i++)[...timers.values()][0]();
await new Promise(resolve=>setImmediate(resolve));assert.equal(qr,null);
assert(requests.filter(item=>item.url.includes('/vouchers/')).every(item=>item.options.method==='GET'));
assert.throws(()=>test.showCode({...display(),validUntil:Math.floor(wall/1000)-1},voucher,1));

test.state.store='S2';
await test.track({replay:true,result:{id:'00000000-0000-4000-8000-000000000002',stage:'FINAL_SUCCEEDED',action:'lock',result:{result:lock}}},'checked',{store:'S1'});
const open=nodes.get('checked').children.find(node=>node.textContent==='View collection');assert(open);
voucherResponse={id:lock,voucher,state:'R',marked:false,pending:null};await open.listeners.click({currentTarget:open,preventDefault(){}});
assert.equal(requests.at(-1).url,'/v1/stores/S1/cases/'+lock);
assert(nodes.get('case').children.some(node=>node.textContent==='Confirm meal handed over'));
voucherResponse={id:lock,voucher,state:'R',marked:false,pending:'original-request'};await test.openCase(lock,'S1');
assert(!nodes.get('case').children.some(node=>node.textContent==='Confirm meal handed over'));
await test.track({id:'00000000-0000-4000-8000-000000000003',stage:'UNKNOWN',action:'settle'},'payments',{store:'S1'});
assert(nodes.get('payments').children.some(node=>node.textContent?.includes('outcome is not confirmed')));
assert(nodes.get('payments').children.some(node=>node.textContent==='Check this request'));
console.log('PASS: DOM/route presence, exact short-lived URL QR decode, clearing/expiry/observed state, nested original lock/store/case/handover, pending and UNKNOWN presentation. In-memory only.');
