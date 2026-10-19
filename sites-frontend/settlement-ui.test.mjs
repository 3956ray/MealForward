import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {hasOwnedKitchen,renderSettlementFlow,renderPayouts} from './dist/onboarding-view.mjs';
const text=readFileSync(new URL('./dist/app.js',import.meta.url),'utf8'),source=text.slice(text.indexOf('function settlementCurrent(')),auth=text.split('\n').find(s=>s.startsWith('function isLiveAuthRejection('));
const wallet='0x'+'1'.repeat(40),voucherId='0x'+'2'.repeat(64),hash='0x'+'3'.repeat(64);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function harness(){
 const item={id:voucherId,state:'H',amount:'7000000',receiver:wallet,asset:'asset',assetDecimals:6,assetSymbol:'USDC',chainId:10143,settleEligibleAt:1000,settlementIntents:[]},data={serverTime:1000,items:[item],receivedAt:Date.now()},body={innerHTML:''},intervals=[],nodes=[],calls=[],state={stage:'WAIT_ACTOR',allowed:true};
 const live={generation:0,context:{session:{wallet,stores:['store']},store:{id:'store'}},payouts:data,payoutStoreId:'store',settlementAttempts:{},settlementPending:{},settlement:null};
 live.api={getPayouts:async()=>data,createSettlementReview:async x=>{calls.push(['review',x]);return {reviewId:'review',review:{...item,voucherId}};},confirmSettlement:async x=>{calls.push(['confirm',x]);return {id:'intent',voucherId,stage:state.stage};},getSettlementIntent:async()=>({id:'intent',voucherId,stage:state.stage,transactionHash:hash}),getSettlementWalletPreparation:async()=>({actions:[{kind:'settle',account:wallet,amount:item.amount,allowed:state.allowed,canRetryRecord:true}]}),sendSettlementTransaction:async()=>{calls.push(['send']);return {transactionHash:hash};},retrySettlementTransactionRecord:async()=>{calls.push(['record']);}};
 const fn=new Function('live','body','hasOwnedKitchen','renderSettlementFlow','intervals','nodes',`${auth}const location={hash:'#merchant/payouts'},document={querySelectorAll:()=>nodes},clearInterval=id=>{if(intervals[id])intervals[id].active=false;},setInterval=(f,ms)=>{intervals.push({f,ms,active:true});return intervals.length-1;};const modal=html=>{body.innerHTML=html;},close=()=>{},renderLive=()=>{},closeVerificationEntry=()=>{},closeClaimFlow=()=>{},closeSupportFlow=()=>{};function clearLiveIdentity(){live.generation++;closeSettlementFlow();live.context.session=null;live.payouts=null;live.settlementAttempts={};}${source};return {handleSettlementAction,closeSettlementFlow,loadPayouts,clearLiveIdentity,startSettlementClock,stopSettlementClock};`)(live,body,hasOwnedKitchen,renderSettlementFlow,intervals,nodes);
 return {live,body,item,data,calls,state,fn,intervals,nodes,act:(action,extra={})=>fn.handleSettlementAction(action,{dataset:{voucherId,...extra}})};
}
async function confirmed(h){await h.act('settlement-open');await h.act('settlement-review');await h.act('settlement-confirm');}
test('review, confirm and wallet send are separate; only final intent plus S displays settled',async()=>{
 const h=harness();await confirmed(h);assert.deepEqual(h.calls.map(c=>c[0]),['review','confirm']);assert.doesNotMatch(h.body.innerHTML,/<h2 id="dialog-title">Settled/);await h.act('settlement-send');await h.act('settlement-send');assert.equal(h.calls.filter(c=>c[0]==='send').length,1);
 h.state.stage='FINAL_SUCCEEDED';await h.act('settlement-check');assert.equal(h.live.settlement.settled,false);h.item.state='S';await h.act('settlement-check');assert.equal(h.live.settlement.settled,true);assert.match(h.body.innerHTML,/7 USDC/);assert.match(h.body.innerHTML,new RegExp(hash));
});
test('server waiting period and missing report evidence block review, elapsed time never marks settled',async()=>{
 for(const eligibleAt of [1180,null]){const h=harness();h.item.settleEligibleAt=eligibleAt;await h.act('settlement-open');await h.act('settlement-review');assert.equal(h.calls.length,0);assert.equal(h.live.settlement.settled,false);}
 const h=harness();assert.match(renderPayouts(h.data),/Check original progress to verify eligibility/);assert.doesNotMatch(renderPayouts(h.data),/>Settled</);
});
test('unknown confirmation blocks replacement and existing settlement list resumes original intent',async()=>{
 const h=harness();await h.act('settlement-open');await h.act('settlement-review');let attempts=0;h.live.api.confirmSettlement=async()=>{attempts++;throw Error('lost');};await h.act('settlement-confirm');await h.act('settlement-confirm');await h.act('settlement-close');await h.act('settlement-open');await h.act('settlement-review');assert.equal(attempts,1);assert.equal(h.calls.filter(c=>c[0]==='review').length,1);
 h.item.settlementIntents=[{id:'intent',voucherId,stage:'UNKNOWN'}];h.state.stage='UNKNOWN';h.state.allowed=false;await h.act('settlement-open',{intentId:'intent'});await h.act('settlement-send');assert.equal(h.calls.filter(c=>c[0]==='send').length,0);await h.act('settlement-record');assert.equal(h.calls.filter(c=>c[0]==='record').length,1);
});
test('unknown wallet send remains locked after close and reload; explicit preflight failure alone unlocks',async()=>{
 for(const preflight of [false,true]){const h=harness();await confirmed(h);let sends=0;h.live.api.sendSettlementTransaction=async()=>{sends++;throw Object.assign(Error('failed'),{walletStepNotStarted:preflight});};await h.act('settlement-send');assert.equal(!!h.live.settlementAttempts.intent,!preflight);await h.act('settlement-check');await h.act('settlement-send');assert.equal(sends,preflight?2:1);
 if(!preflight){h.item.settlementIntents=[{id:'intent'}];await h.act('settlement-close');await h.act('settlement-open',{intentId:'intent'});await h.act('settlement-send');assert.equal(sends,1);}}
});
test('closed or wallet-changed settlement drops late private review and list responses',async()=>{
 for(const mode of ['close','wallet']){const h=harness(),wait=deferred();await h.act('settlement-open');h.live.api.createSettlementReview=()=>wait.promise;const pending=h.act('settlement-review');mode==='close'?h.fn.closeSettlementFlow():h.fn.clearLiveIdentity();wait.resolve({reviewId:'late',review:{voucherId}});await pending;assert.equal(h.live.settlement,null);assert.equal(h.body.innerHTML,'');}
 const h=harness(),wait=deferred();h.live.api.getPayouts=()=>wait.promise;const pending=h.fn.loadPayouts();h.fn.clearLiveIdentity();wait.resolve(h.data);await pending;assert.equal(h.live.payouts,null);
});

test('UNKNOWN with server allowance and no prior attempt permits one explicit send; attempted unknown stays locked',async()=>{
 const h=harness();h.state.stage='UNKNOWN';h.item.settlementIntents=[{id:'intent',voucherId,stage:'UNKNOWN'}];await h.act('settlement-open',{intentId:'intent'});assert.match(h.body.innerHTML,/data-live-action="settlement-send"\s*>Send settlement wallet tx/);
 await h.act('settlement-send');assert.equal(h.calls.filter(c=>c[0]==='send').length,1);await h.act('settlement-check');await h.act('settlement-send');assert.equal(h.calls.filter(c=>c[0]==='send').length,1);assert.match(h.body.innerHTML,/data-live-action="settlement-send"\s+disabled/);
});

test('local countdown ticks without POST or rerender, stops on close and wallet change, and safe explorer links use verified chain and hash',async()=>{
 const h=harness();await h.act('settlement-open');const node={dataset:{eligibleAt:'1180',serverTime:'1000',receivedAt:String(Date.now())},textContent:''};h.nodes.push(node);const timer=h.intervals.at(-1),html=h.body.innerHTML;timer.f();assert.match(node.textContent,/180s/);node.dataset.receivedAt=String(Date.now()-181000);timer.f();assert.match(node.textContent,/Check original progress/);assert.equal(h.body.innerHTML,html);assert.equal(h.calls.length,0);await h.act('settlement-close');assert.equal(timer.active,false);
 h.fn.startSettlementClock();const changed=h.intervals.at(-1);h.live.generation++;changed.f();assert.equal(changed.active,false);
 const p=harness();await confirmed(p);assert.match(p.body.innerHTML,new RegExp('https://testnet.monadscan.com/tx/'+hash));p.live.settlement.payout.chainId=143;assert.doesNotMatch(renderSettlementFlow(p.live.settlement),/href="https:\/\/testnet.monadscan/);p.live.settlement.payout.chainId=10143;p.live.settlement.intent.transactionHash='bad';assert.doesNotMatch(renderSettlementFlow(p.live.settlement),/href="https:\/\/testnet.monadscan/);
});
