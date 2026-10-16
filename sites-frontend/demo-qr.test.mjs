import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as M from './dist/model.mjs';
import {nextDemoServiceInstant} from './dist/demo-service.mjs';

const source=readFileSync(new URL('./dist/app.js',import.meta.url),'utf8');
const start=source.indexOf('function openDemoCredential(');
const end=source.indexOf('function tickCode(');
assert.ok(start>0&&end>start,'QR handler could not be located');
const ui=source.slice(start,end);
const evening=Date.parse('2026-10-16T21:11:00+08:00');
const nextLunch=Date.parse('2026-10-17T11:30:01+08:00');
const lunch=Date.parse('2026-10-16T12:00:00+08:00');
const originalIdentity='neighbor@mealforward.invalid';

function voucherState(issuedAt=evening,clock=issuedAt){
  const state=M.initialState(issuedAt);
  M.signIn(state,originalIdentity);
  const original=M.claim(state,'qinghe',issuedAt);
  M.resolve(state,original.id,'final',issuedAt);
  state.clockOffset=clock-Date.now();
  return state;
}
function harness({now=evening,issuedAt=evening,withoutQrRenderer=false}={}){
  const original=voucherState(issuedAt,now);
  const voucherId=original.coupons.at(-1).id;
  const events={modals:[],qrDraws:[],fallback:{innerHTML:''}};
  const QR=class{
    static CorrectLevel={M:'M'};
    constructor(element,options){events.qrDraws.push({element,options});}
  };
  const definitions=[
    'const getStore=M.getStore, nowFor=M.nowFor;',
    'const e=x=>String(x), english=x=>String(x),date=x=>new Date(x).toISOString();',
    'const hours=x=>"11:30–13:30 / 17:00–20:00";',
    'const facts=x=>JSON.stringify(x);',
    'const notice=x=>"<p>"+x+"</p>";',
    'const errorBox="<p class=error role=alert></p>";',
    'const btn=(label,action,id="",style="")=>"<button data-action=\\""+action+"\\" data-id=\\""+id+"\\">"+label+"</button>";',
    'const modal=(html,kind)=>events.modals.push({html,kind});',
    'const mutate=fn=>{state=M.transaction(state,fn);};',
    'const window={QRCode:QR}, document={querySelector:()=>events.fallback};',
    'const tickCode=()=>{};'
  ].join('\n');
  const fn=new Function('M','state','events','QR','nextDemoServiceInstant',
    definitions+'\n'+ui+'\nreturn {openDemoCredential,showCredential,getState:()=>state};');
  return {...fn(M,original,events,withoutQrRenderer?undefined:QR,nextDemoServiceInstant),events,voucherId,initial:original};
}

test('after hours the original model rejects QR and preserves voucher',()=>{
  const state=voucherState(),c=state.coupons.at(-1);
  assert.equal(M.inWindow(M.getStore(c.store),evening,c.windows),0);
  assert.throws(()=>M.credential(state,c,evening),/during the original service hours/);
  assert.equal(c.token,null);
});

test('next original serving window is the next day, not a backward time jump',()=>{
  assert.equal(nextDemoServiceInstant([[690,810],[1020,1200]],evening,evening+72*3600_000),nextLunch);
  assert.equal(nextDemoServiceInstant([[690,810],[1020,1200]],Date.parse('2026-10-16T14:00:00+08:00'),evening+72*3600_000),Date.parse('2026-10-16T17:00:01+08:00'));
  assert.equal(nextDemoServiceInstant([[690,810]],evening,Date.parse('2026-10-17T10:00:00+08:00')),null);
});

test('outside service hours the QR button opens an explicit explanation',()=>{
  const h=harness();h.openDemoCredential(h.voucherId);
  assert.equal(h.events.modals.at(-1).kind,'demo-service');
  assert.match(h.events.modals.at(-1).html,/Test QR at the next service time/);
  assert.match(h.events.modals.at(-1).html,/data-action="demo-qr-slot"/);
  assert.equal(h.events.qrDraws.length,0);
  assert.equal(h.getState().coupons.at(-1).token,null);
});

test('within service hours QR renders without changing voucher expiry',()=>{
  const h=harness({now:lunch,issuedAt:lunch-60_000}),originalExpiry=h.initial.coupons.at(-1).expires;
  h.openDemoCredential(h.voucherId);
  assert.equal(h.events.modals.at(-1).kind,'credential');
  assert.equal(h.events.qrDraws.length,1);
  assert.equal(h.getState().coupons.at(-1).expires,originalExpiry);
  assert.match(h.getState().coupons.at(-1).token,/^mealforward:demo:/);
});

test('missing QR rendering library keeps the temporary code visible',()=>{
  const h=harness({now:lunch,issuedAt:lunch-60_000,withoutQrRenderer:true});
  h.openDemoCredential(h.voucherId);
  assert.equal(h.events.modals.at(-1).kind,'credential');
  assert.match(h.events.fallback.innerHTML,/Copy the temporary code instead/);
});

test('explicit time jump preserves original issue, price, version and expiry',()=>{
  assert.match(source,/if\(!dialog\.open\|\|dialogKind!=='demo-service'\)/);
  assert.match(source,/c\.email!==state\.session\?\.email/);
  assert.match(source,/mutate\(s=>\{s\.clockOffset=next-Date\.now\(\);M\.expire\(s,next\);\}\)/);
  const old=voucherState(),c=old.coupons.at(-1),now=M.nowFor(old);
  const next=nextDemoServiceInstant(c.windows,now,c.expires);
  const originalTerms={issued:c.issued,expires:c.expires,price:c.price,version:c.version};
  const updated=M.transaction(old,s=>{s.clockOffset=next-Date.now();M.expire(s,next);});
  const current=updated.coupons.at(-1);
  assert.equal(current.token,null);
  assert.deepEqual({issued:current.issued,expires:current.expires,price:current.price,version:current.version},originalTerms);
  assert.ok(M.inWindow(M.getStore(current.store),M.nowFor(updated),current.windows)>0);
  const minted=M.transaction(updated,s=>M.credential(s,s.coupons.at(-1),M.nowFor(s)));
  assert.match(minted.coupons.at(-1).token,/^mealforward:demo:/);
  assert.ok(minted.coupons.at(-1).tokenExpires<=M.nowFor(minted)+120_000);
});
