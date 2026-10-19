import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseVoucherCode} from './dist/live-api.mjs';
import {renderVerificationEntry,hasOwnedKitchen,renderLiveKitchen,supportState} from './dist/onboarding-view.mjs';
const auth=readFileSync(new URL('./dist/app.js',import.meta.url),'utf8').split('\n').find(line=>line.startsWith('function isLiveAuthRejection('));
const source=readFileSync(new URL('./dist/app.js',import.meta.url),'utf8').split('function takeVerificationLink(){')[1];
const caseId='0x'+'a'.repeat(64);
const token='x'.repeat(43),origin='https://localhost:16443';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function harness(){
 const live={generation:0,context:{session:{wallet:'owner',stores:['store']},store:{id:'store'}},verification:null,parseVoucherCode};
 const body={innerHTML:''},video={srcObject:null,play:async()=>{}},input={value:''},timers=[],changes=[],location={origin,hash:'#merchant/verify',pathname:'/',search:''},navigator={},window={};
 const fn=new Function('live','body','video','input','timers','changes','location','navigator','window','parseVoucherCode','renderVerificationEntry','hasOwnedKitchen','supportState',`${auth}const clearLiveIdentity=()=>{live.generation++;closeVerificationEntry();live.context.session=null;};const document={querySelector:s=>s==='#verification-camera'?video:input};const history={replaceState:(...a)=>changes.push(a)};const modal=html=>{body.innerHTML=html;},close=()=>{},renderLive=()=>{},closeClaimFlow=()=>{},closeSupportFlow=()=>{},clearTimeout=()=>{},setTimeout=f=>{timers.push(f);return timers.length;};function takeVerificationLink(){${source};return {takeVerificationLink,openVerificationEntry,closeVerificationEntry,startVerificationCamera,handleVerificationEntry};`)(live,body,video,input,timers,changes,location,navigator,window,parseVoucherCode,renderVerificationEntry,hasOwnedKitchen,supportState);
 return {live,body,video,input,timers,changes,location,navigator,window,fn};
}
test('owned kitchen alone opens scanner; parsing is local and never confirms validity',async()=>{
 const h=harness();h.fn.openVerificationEntry();h.input.value=origin+'/#verify?code='+token;await h.fn.handleVerificationEntry('verification-parse');assert.equal(h.live.verification.code,token);assert.match(h.body.innerHTML,/validity has not been checked/);assert.doesNotMatch(h.body.innerHTML,new RegExp(token));assert.match(h.body.innerHTML,/Check voucher/);
 h.input.value='https://elsewhere.test/#verify?code='+token;await h.fn.handleVerificationEntry('verification-parse');assert.equal(h.live.verification.code,null);
 h.fn.closeVerificationEntry();h.live.context.session.stores=[];h.fn.openVerificationEntry();assert.equal(h.live.verification,null);
 assert.match(renderLiveKitchen({context:{session:{wallet:'owner',stores:['store']},store:{id:'store'}},view:'verify'}),/verification-open/);
});
test('private fragment is removed immediately without rendering or persisting token',()=>{
 const h=harness();h.location.hash='#verify?code='+token;assert.equal(h.fn.takeVerificationLink(),origin+'/'+h.location.hash);assert.equal(h.changes[0][2],'/#merchant/verify');assert.doesNotMatch(h.body.innerHTML,new RegExp(token));assert.doesNotMatch(source,/localStorage|sessionStorage|console\./);
});
test('unsupported or denied camera offers paste without consuming a voucher',async()=>{
 const h=harness();h.fn.openVerificationEntry();await h.fn.handleVerificationEntry('verification-camera');assert.match(h.body.innerHTML,/Paste the private link or code/);
 h.window.BarcodeDetector=class{};h.navigator.mediaDevices={getUserMedia:async()=>{throw Error('denied');}};await h.fn.handleVerificationEntry('verification-camera');assert.match(h.body.innerHTML,/Camera access is unavailable/);assert.equal(h.live.verification.code,null);
});
test('late camera permission is stopped after close or wallet change',async()=>{
 for(const kind of ['close','wallet']){const h=harness(),wait=deferred();let stopped=0;h.window.BarcodeDetector=class{};h.navigator.mediaDevices={getUserMedia:()=>wait.promise};h.fn.openVerificationEntry();const pending=h.fn.handleVerificationEntry('verification-camera');kind==='close'?h.fn.closeVerificationEntry():h.live.generation++;wait.resolve({getTracks:()=>[{stop:()=>stopped++}]});await pending;assert.equal(stopped,1);assert.equal(h.video.srcObject,null);}
});
test('scanner uses local detector and stops stream when code is read; closing erases it',async()=>{
 const h=harness();let stopped=0;h.window.BarcodeDetector=class{async detect(){return [{rawValue:token}];}};h.navigator.mediaDevices={getUserMedia:async()=>({getTracks:()=>[{stop:()=>stopped++}]})};h.fn.openVerificationEntry();await h.fn.handleVerificationEntry('verification-camera');assert.equal(h.live.verification.code,token);assert.equal(stopped,1);assert.equal(h.video.srcObject,null);h.fn.closeVerificationEntry();assert.equal(h.live.verification,null);assert.equal(h.body.innerHTML,'');
});

function redemptionHarness(){
 const h=harness(),calls=[],voucher={store:'store',voucherId:'voucher',id:'voucher',state:'R',valid:true,terms:{name:'Rice',windows:[[0,1440]]},expiresAt:2000000000};let state='R';
 h.live.api={checkVoucher:async x=>{calls.push(['check',x]);return voucher;},lockVoucher:async x=>{calls.push(['lock',x]);return {id:'lock-intent',action:'lock',stage:'ACCEPTED'};},getRedemptionIntent:async(s,id)=>{calls.push(['get',s,id]);return {id,action:id==='lock-intent'?'lock':'handover',stage:'FINAL_SUCCEEDED',result:{result:caseId}};},getRedemptionCase:async()=>({id:caseId,store:'store',voucher:'voucher',state,terms:voucher.terms,redemptionIntents:[]}),confirmHandover:async x=>{calls.push(['handover',x]);return {id:'handover-intent',action:'handover',stage:'ACCEPTED'};},getOwnerOverview:async()=>({redemptionIntents:[{id:'lock-intent',action:'lock',lockId:caseId,stage:'FINAL_SUCCEEDED'}]})};
 h.fn.openVerificationEntry();h.input.value=token;return {...h,calls,setState:value=>state=value};
}
test('checking is read-only; reserve and physical handover require separate explicit actions; only H means used',async()=>{
 const h=redemptionHarness();await h.fn.handleVerificationEntry('verification-parse');await h.fn.handleVerificationEntry('verification-check');assert.deepEqual(h.calls.map(c=>c[0]),['check']);assert.match(h.body.innerHTML,/Valid for this kitchen/);
 await h.fn.handleVerificationEntry('verification-reserve');assert.equal(h.calls.filter(c=>c[0]==='lock').length,1);assert.doesNotMatch(h.body.innerHTML,/Voucher used/);await h.fn.handleVerificationEntry('verification-handover');assert.equal(h.calls.filter(c=>c[0]==='handover').length,0);
 h.input.checked=true;await h.fn.handleVerificationEntry('verification-handover');assert.equal(h.calls.filter(c=>c[0]==='handover').length,1);assert.doesNotMatch(h.body.innerHTML,/Voucher used/);await h.fn.handleVerificationEntry('verification-handover');assert.equal(h.calls.filter(c=>c[0]==='handover').length,1);
 h.setState('H');await h.fn.handleVerificationEntry('verification-progress');assert.match(h.body.innerHTML,/Voucher used/);assert.match(h.body.innerHTML,/owner reviews and sends settlement from Payouts/);
});
test('unknown reservation is not repeated; owner overview restores original request without secret code',async()=>{
 const h=redemptionHarness();await h.fn.handleVerificationEntry('verification-parse');await h.fn.handleVerificationEntry('verification-check');let locks=0;h.live.api.lockVoucher=async()=>{locks++;throw Error('unknown');};await h.fn.handleVerificationEntry('verification-reserve');await h.fn.handleVerificationEntry('verification-reserve');assert.equal(locks,1);
 await h.fn.handleVerificationEntry('verification-records');await h.fn.handleVerificationEntry('verification-restore',{dataset:{intentId:'lock-intent'}});assert.equal(h.live.verification.case.id,caseId);assert.equal(h.live.verification.code,null);assert.equal(locks,1);
});
test('late check cannot repopulate closed or changed-wallet owner view',async()=>{
 for(const mode of ['close','wallet']){const h=redemptionHarness(),wait=deferred();await h.fn.handleVerificationEntry('verification-parse');h.live.api.checkVoucher=()=>wait.promise;const pending=h.fn.handleVerificationEntry('verification-check');mode==='close'?h.fn.closeVerificationEntry():h.live.generation++;wait.resolve({valid:true,store:'store'});await pending;assert.ok(!h.live.verification?.checked);}
});
test('switching cases resets previous handover attempt and restores only the selected case history',async()=>{
 const h=redemptionHarness();await h.fn.handleVerificationEntry('verification-records');h.live.verification.handoverAttempted=true;
 await h.fn.handleVerificationEntry('verification-restore',{dataset:{intentId:'lock-intent'}});assert.equal(h.live.verification.handoverAttempted,false);assert.match(h.body.innerHTML,/data-live-action="verification-handover"\s*>Confirm handover/);
 h.live.api.getRedemptionCase=async()=>({id:caseId,store:'store',state:'R',redemptionIntents:[{id:'original-handover',action:'handover',stage:'UNKNOWN'}]});
 await h.fn.handleVerificationEntry('verification-restore',{dataset:{intentId:'lock-intent'}});assert.equal(h.live.verification.handoverAttempted,true);assert.match(h.body.innerHTML,/data-live-action="verification-handover"\s+disabled>Confirm handover/);assert.equal(h.calls.filter(c=>c[0]==='handover').length,0);
});

test('restored ACCEPTED or UNKNOWN lock with lockId queries no case until final result is available',async()=>{
 for(const stage of ['ACCEPTED','UNKNOWN']){
  const h=redemptionHarness();h.live.api.getOwnerOverview=async()=>({redemptionIntents:[{id:'lock-intent',action:'lock',lockId:caseId,stage}]});let cases=0;const getCase=h.live.api.getRedemptionCase;h.live.api.getRedemptionCase=async(...args)=>{cases++;return getCase(...args);};h.live.api.getRedemptionIntent=async()=>({id:'lock-intent',action:'lock',stage,lockId:caseId,result:null});
  await h.fn.handleVerificationEntry('verification-records');await h.fn.handleVerificationEntry('verification-restore',{dataset:{intentId:'lock-intent'}});assert.equal(cases,0);assert.equal(h.live.verification.case,null);assert.match(h.body.innerHTML,/reservation is still processing/);assert.doesNotMatch(h.body.innerHTML,/data-live-action="verification-handover"/);
  h.live.api.getRedemptionIntent=async()=>({id:'lock-intent',action:'lock',stage:'FINAL_SUCCEEDED',result:{result:caseId}});await h.fn.handleVerificationEntry('verification-progress');assert.equal(cases,1);assert.equal(h.live.verification.case.id,caseId);
 }
});
test('case projection NOT_FOUND retains original progress but missing intent remains an error',async()=>{
 const h=redemptionHarness();h.live.api.getOwnerOverview=async()=>({redemptionIntents:[{id:'handover-intent',action:'handover',lockId:caseId}]});h.live.api.getRedemptionIntent=async()=>({id:'handover-intent',action:'handover',stage:'UNKNOWN',lockId:caseId});h.live.api.getRedemptionCase=async()=>{throw Object.assign(Error('missing case'),{code:'NOT_FOUND'});};await h.fn.handleVerificationEntry('verification-records');await h.fn.handleVerificationEntry('verification-restore',{dataset:{intentId:'handover-intent'}});assert.match(h.body.innerHTML,/case is not visible yet/);assert.equal(h.live.verification.case,null);assert.equal(h.live.verification.lockAttempted,true);assert.doesNotMatch(h.body.innerHTML,/data-live-action="verification-handover"|data-live-action="verification-reserve"/);
 h.live.api.getRedemptionIntent=async()=>{throw Object.assign(Error('missing intent'),{code:'NOT_FOUND'});};await h.fn.handleVerificationEntry('verification-progress');assert.match(h.live.verification.error,/request was not found \(NOT_FOUND\)/);
});

test('FINAL_REVERT lock shows failed and not redeemed, keeps transaction, never queries case or resends',async()=>{
 const h=redemptionHarness(),transactionHash='0x'+'b'.repeat(64);let cases=0;h.live.api.getRedemptionIntent=async()=>({id:'lock-intent',action:'lock',stage:'FINAL_REVERT',transactionHash,result:{outcome:'FINAL_REVERT',reason:'TRANSACTION_REVERTED',transactionHash,blockHash:'0x'+'c'.repeat(64)}});h.live.api.getRedemptionCase=async()=>{cases++;throw Error('must not query case');};
 await h.fn.handleVerificationEntry('verification-records');await h.fn.handleVerificationEntry('verification-restore',{dataset:{intentId:'lock-intent'}});
 assert.equal(cases,0);assert.equal(h.live.verification.case,null);assert.equal(h.live.verification.lockAttempted,true);assert.match(h.body.innerHTML,/Voucher reservation failed/);assert.match(h.body.innerHTML,/did not redeem the meal/);assert.match(h.body.innerHTML,/old code is no longer usable/);assert.match(h.body.innerHTML,/Beijing-time \(UTC\+8\) service hours/);assert.match(h.body.innerHTML,new RegExp(transactionHash));assert.doesNotMatch(h.body.innerHTML,/reservation is still processing|data-live-action="verification-handover"|data-live-action="verification-reserve"/);
 await h.fn.handleVerificationEntry('verification-reserve');h.input.checked=true;await h.fn.handleVerificationEntry('verification-handover');assert.equal(h.calls.filter(c=>['lock','handover'].includes(c[0])).length,0);
 await h.fn.handleVerificationEntry('verification-progress');assert.equal(cases,0);
});
