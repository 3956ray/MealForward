import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as M from './dist/model.mjs';
import {prepareKitchenDemoCode} from './dist/demo-handover.mjs';

const owner='qinghe.owner@mealforward.invalid',neighbor='neighbor@mealforward.invalid';
const atLunch=Date.parse('2026-10-16T12:00:00+08:00');
const atEvening=Date.parse('2026-10-16T22:33:00+08:00');
const app=readFileSync(new URL('./dist/app.js',import.meta.url),'utf8');

function setClock(state,now){state.clockOffset=now-Date.now();return state;}
function makeRecipientVoucher(now=atLunch){
 const s=M.initialState(now);
 M.signIn(s,neighbor);
 const claim=M.claim(s,'qinghe',now);
 M.resolve(s,claim.id,'final',now);
 return setClock(s,now);
}
function afterOwnerSwitch(now=atLunch){
 const s=makeRecipientVoucher(now);
 const voucher=s.coupons.at(-1);
 const originalCode=M.credential(s,voucher,now);
 M.signIn(s,owner); // Frozen model deliberately invalidates all temporary codes.
 return {s,voucherId:voucher.id,originalCode};
}
function prepare(s,storeId='qinghe'){
 let info;
 const next=M.transaction(s,copy=>{info=prepareKitchenDemoCode(copy,storeId);});
 return {s:next,info};
}

test('recipient logout revokes QR; explicit owner sandbox scenario re-issues for SAME voucher',()=>{
 const {s,voucherId,originalCode}=afterOwnerSwitch();
 assert.equal(s.coupons.at(-1).token,null);
 assert.throws(()=>M.checkToken(s,'qinghe',originalCode,M.nowFor(s)),/invalid, expired/);
 const before=s.coupons.at(-1),count=s.coupons.length,claims=s.ops.filter(o=>o.kind==='claim').length;
 const {s:next,info}=prepare(s);
 assert.equal(info.created,false);
 assert.equal(info.voucherId,voucherId);
 assert.equal(next.coupons.length,count);
 assert.equal(next.ops.filter(o=>o.kind==='claim').length,claims);
 assert.equal(next.session.email,owner);
 assert.equal(next.coupons.at(-1).issued,before.issued);
 assert.equal(next.coupons.at(-1).expires,before.expires);
 assert.equal(next.coupons.at(-1).price,before.price);
 assert.equal(next.coupons.at(-1).version,before.version);
 assert.notEqual(info.code,originalCode);
 assert.equal(M.checkToken(next,'qinghe',info.code,M.nowFor(next)).id,voucherId);
});

test('same-browser owner can explicitly prepare a fresh demonstration recipient voucher',()=>{
 const s=setClock(M.initialState(atLunch),atLunch);M.signIn(s,owner);
 const before={funded:M.stats(s,'qinghe').F,available:M.stats(s,'qinghe').available};
 const {s:next,info}=prepare(s);
 assert.equal(info.created,true);
 assert.equal(next.coupons.length,1);
 assert.equal(next.session.email,owner);
 assert.equal(next.coupons[0].email,neighbor);
 assert.equal(M.stats(next,'qinghe').F,before.funded);
 assert.equal(M.stats(next,'qinghe').available,before.available-1);
 assert.equal(M.checkToken(next,'qinghe',info.code,M.nowFor(next)).id,info.voucherId);
});

test('at 22:33, owner demo moves forward to next original slot, not backwards in time',()=>{
 const {s}=afterOwnerSwitch(atEvening);
 const original=s.coupons.at(-1);
 const {s:next,info}=prepare(s);
 assert.equal(info.advancedClock,true);
 const now=M.nowFor(next);
 assert.ok(now>atEvening);
 assert.ok(now>=Date.parse('2026-10-17T11:30:00+08:00'));
 assert.ok(now<Date.parse('2026-10-17T13:30:00+08:00'));
 assert.ok(now<original.expires);
 assert.equal(next.coupons.at(-1).expires,original.expires);
 assert.equal(M.checkToken(next,'qinghe',info.code,now).id,original.id);
});

test('original Check/Lock/Report/Payout remain separate and preserve accounting',()=>{
 const s=setClock(M.initialState(atLunch),atLunch);M.signIn(s,owner);
 const {s:next,info}=prepare(s);const now=M.nowFor(next);
 const before=M.stats(next,'qinghe');
 const voucher=M.checkToken(next,'qinghe',info.code,now);
 assert.equal(M.stats(next,'qinghe').R,before.R);
 const locked=M.transaction(next,state=>{const op=M.lock(state,'qinghe',info.code,now);M.resolve(state,op.id,'final',now);});
 assert.equal(locked.coupons.at(-1).status,'locked');
 assert.throws(()=>M.checkToken(locked,'qinghe',info.code,now),/invalid, expired/);
 const handed=M.transaction(locked,state=>{const v=state.coupons.at(-1);const op=M.report(state,v,now,true);M.resolve(state,op.id,'final',now);});
 assert.equal(handed.coupons.at(-1).status,'reported');
 const paid=M.transaction(handed,state=>{M.connectWallet(state,'payout','qinghe');const op=M.settle(state,'qinghe',voucher.unit,now);M.resolve(state,op.id,'final',now);});
 assert.equal(paid.units.find(u=>u.id===voucher.unit).status,'S');
 assert.equal(M.stats(paid,'qinghe').amounts.S,before.amounts.S+voucher.price);
 M.validate(paid);
});

test('another store or unauthorized actor cannot create a valid code for this kitchen',()=>{
 const s=makeRecipientVoucher();assert.throws(()=>prepareKitchenDemoCode(s,'qinghe'),/invited/);
 M.signIn(s,'shiguang.owner@mealforward.invalid');
 assert.throws(()=>prepareKitchenDemoCode(s,'qinghe'),/invited/);
 const {s:next,info}=prepare(s,'shiguang');
 assert.equal(info.storeId,'shiguang');
 assert.equal(M.checkToken(next,'shiguang',info.code,M.nowFor(next)).store,'shiguang');
 assert.throws(()=>M.checkToken(next,'qinghe',info.code,M.nowFor(next)),/invited/);
});

test('an unresolved claim is preserved; preparing a fixture never resends or resolves it',()=>{
 const now=atLunch,s=setClock(M.initialState(now),now);
 M.signIn(s,neighbor);
 const existing=M.claim(s,'qinghe',now);
 M.resolve(s,existing.id,'unknown',now);
 M.signIn(s,owner);
 const {s:next,info}=prepare(s);
 assert.equal(next.ops.find(op=>op.id===existing.id).status,'unknown');
 assert.equal(info.created,true);
 assert.equal(next.coupons.at(-1).email,'visitor@mealforward.invalid');
});

test('sandbox UI requires owner identity; normal LIVE_MODE cannot trigger the demo fixture',()=>{
 assert.match(app,/if\(LIVE_MODE\|\|M\.merchantStore\(state\)!==id\)/);
 assert.match(app,/else if\(action==='demo-verify-prepare'\)/);
 assert.match(app,/M\.checkToken\(state,id,token,nowFor\(state\)\)/);
 assert.match(app,/This website saves meals only in this browser/);
});

test('no eligible demonstration recipient fails with no persistent side effect',()=>{
 const s=setClock(M.initialState(atLunch),atLunch);
 for(const email of ['neighbor@mealforward.invalid','visitor@mealforward.invalid']){
  M.signIn(s,email);const op=M.claim(s,'qinghe',atLunch);M.resolve(s,op.id,'final',atLunch);
  const voucher=s.coupons.at(-1);voucher.status='locked'; // will be backed by its original unit in the following guard test only
 }
 M.signIn(s,owner);
 const before=JSON.stringify(s);
 assert.throws(()=>prepare(s),/No eligible demo recipient/);
 assert.equal(JSON.stringify(s),before);
});
