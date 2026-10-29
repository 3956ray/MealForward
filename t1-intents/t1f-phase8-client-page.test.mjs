import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from './wallet-v2/node_modules/jsdom/lib/api.js';
import {fixture,NOW} from './t1f-phase8-client-fixture.mjs';
import {phase8Public} from './t1f-phase8-service.mjs';
import {PHASE8_FIXED as F} from './t1f-phase8-protocol.mjs';
const flush=()=>new Promise(r=>setTimeout(r,0));
test('actual Phase8 page exposes separate role approval and issuer actions, local countdown makes expiry visible',async()=>{
 const {createPhase8Controller}=await import('./public/t1f-phase8-controller.mjs'),crypto=await import('./public/t1f-phase8-crypto.mjs');
 const html=await readFile(new URL('./public/t1f-phase8.html',import.meta.url),'utf8');const dom=new JSDOM(html,{url:'http://127.0.0.1:15449'}),w=dom.window,$=id=>w.document.getElementById(id),calls=[],http=[],timers=new Map();let now=NOW,nextTimer=0;
 w.ethereum={on(){},async request(q){calls.push(q.method);if(q.method==='eth_accounts')return [F.owner];if(q.method==='eth_chainId')return '0x279f';throw Error('NO_SIGN_ALLOWED')}};
 const {envelope}=fixture();const fetch=async(path,options)=>{http.push({path,options});return {ok:true,json:async()=>phase8Public(envelope,now)}};
 const raw=await readFile(new URL('./public/t1f-phase8-page.mjs',import.meta.url),'utf8');const code=raw.replace("import {createPhase8Controller} from './t1f-phase8-controller.mjs';",'').replace("import('./t1f-phase8-crypto.mjs')",'loadCrypto()');
 try{
  new Function('createPhase8Controller','document','location','globalThis','addEventListener','dispatchEvent','Event','fetch','loadCrypto','setInterval','clearInterval',code)(opts=>createPhase8Controller({...opts,clock:()=>now}),w.document,w.location,w,w.addEventListener.bind(w),w.dispatchEvent.bind(w),w.Event,fetch,async()=>crypto,fn=>{timers.set(++nextTimer,fn);return nextTimer},id=>timers.delete(id));
  await flush();assert.equal(calls.length,0);assert.equal(http.length,0);$('inspect').click();await flush();$('refresh').click();await flush();assert.match($('wallet').textContent,/owner/i);assert.equal($('approve').disabled,false);assert.equal($('prepare').disabled,true);assert.equal($('send').disabled,true);assert.match($('previous').textContent,/8872119f/);assert.match($('typed').textContent,/RecoveryChildIssueRelease/);assert.match($('state').textContent,/210s/);
  const previousCalls=calls.length,previousRequests=http.length;now=NOW+210;for(const f of timers.values())f();assert.equal($('approve').disabled,true);assert.match($('result').textContent,/closed/i);assert.equal(calls.length,previousCalls);assert.equal(http.length,previousRequests);w.dispatchEvent(new w.Event('pagehide'));assert.equal(timers.size,0);
 }finally{dom.window.close();}
});
test('actual page drives two explicit approvals then login, prepare, separate send and receipt check',async()=>{
 const {createPhase8Controller}=await import('./public/t1f-phase8-controller.mjs'),realCrypto=await import('./public/t1f-phase8-crypto.mjs'),{makeChallenge}=await import('./auth/siwe.mjs'),{t0}=await import('./t1e-first-issue-readiness.mjs');
 const html=await readFile(new URL('./public/t1f-phase8.html',import.meta.url),'utf8'),dom=new JSDOM(html,{url:'http://127.0.0.1:15449'}),w=dom.window,$=id=>w.document.getElementById(id),listeners={},calls=[],{envelope,manifest}=fixture();let account=F.owner;const CSRF='a'.repeat(43),H='0x'+'a'.repeat(64);
 w.ethereum={on(e,f){(listeners[e]??=[]).push(f)},async request(q){calls.push(q);if(q.method==='eth_accounts')return [account];if(q.method==='eth_chainId')return '0x279f';if(q.method==='eth_signTypedData_v4'||q.method==='personal_sign')return '0x'+'a'.repeat(130);if(q.method==='eth_sendTransaction')return H;throw Error(q.method)}};
 const fetch=async(path,options)=>{const body=options.body?JSON.parse(options.body):{};let out;if(path.endsWith('pre-session'))out={csrf:CSRF};else if(path.endsWith('challenge'))out=makeChallenge({wallet:F.issuer,origin:w.location.origin,chainId:10143,nonce:'a'.repeat(64),challengeId:envelope.round.round_id,issuedAt:NOW,expiresAt:NOW+180});else if(path.endsWith('login'))out={csrf:CSRF,authPilot:true};else{
  if(path.endsWith('/approval')){assert.equal(options.headers['X-Phase8-Intent'],'signed-approval');envelope.round.approvals.push({round_id:envelope.round.round_id,digest:manifest.digest,verification_version:'T1F_PHASE8_EIP712_EOA_V1',verified_at_epoch:NOW,role:body.role,wallet:F[body.role],fingerprint:'0x'+'8'.repeat(64)})}
  if(path.endsWith('/prepare')){assert.equal(options.headers['X-C1-CSRF'],CSRF);envelope.operation={round_id:envelope.round.round_id,predecessor_id:F.predecessor.successor_id,successor_id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',release_id:'ffffffff-ffff-4fff-8fff-ffffffffffff',claim_id:F.claimId,slot_id:F.slotId,operation_id:manifest.value.newOpId,issuer_nonce:0,issuer_issue_deadline:NOW+480,calldata_hash:manifest.candidateCalldataHash,issuer_wallet:F.issuer,escrow:F.escrow,chain_id:10143,voucher_id:F.voucherId,stage:'ISSUE_UNKNOWN',revision:0,tx_hash:null,receipt_block:null,receipt_block_hash:null};}
  if(path.endsWith('/bind')){envelope.operation.stage='ISSUE_HASH_BOUND';envelope.operation.tx_hash=body.txHash;envelope.operation.revision=1}
  if(path.endsWith('/reconcile')){envelope.operation.stage='ISSUED';envelope.operation.revision=2;envelope.operation.receipt_block=120;envelope.operation.receipt_block_hash='0x'+'b'.repeat(64)}
  out=phase8Public(envelope,NOW);if(path.endsWith('/prepare'))out={...out,created:true,transaction:{from:F.issuer,to:F.escrow,chainId:'0x279f',value:'0x0',nonce:'0x0',data:t0.encodeFunctionData('issue',[manifest.value.newOpId,F.mealId,0,1,F.termsHash,NOW+480])}};
 }return {ok:true,json:async()=>out}};
 const raw=await readFile(new URL('./public/t1f-phase8-page.mjs',import.meta.url),'utf8'),code=raw.replace("import {createPhase8Controller} from './t1f-phase8-controller.mjs';",'').replace("import('./t1f-phase8-crypto.mjs')",'loadCrypto()');
 try{
  new Function('createPhase8Controller','document','location','globalThis','addEventListener','dispatchEvent','Event','fetch','loadCrypto','setInterval','clearInterval',code)(opts=>createPhase8Controller({...opts,clock:()=>NOW}),w.document,w.location,w,w.addEventListener.bind(w),w.dispatchEvent.bind(w),w.Event,fetch,async()=>({...realCrypto,recoverApproval:()=>account}),()=>1,()=>{});
  const click=async id=>{$(id).click();await flush();await flush()};await flush();await click('inspect');await click('refresh');await click('approve');assert.match($('approvals').textContent,/Owner：已记录/);
  account=F.donor;for(const f of listeners.accountsChanged||[])f();await click('inspect');await click('approve');assert.match($('approvals').textContent,/Donor：已记录/);assert.equal(calls.filter(q=>q.method==='eth_signTypedData_v4').length,2);
  account=F.issuer;for(const f of listeners.accountsChanged||[])f();await click('inspect');await click('challenge');assert.equal(calls.some(q=>q.method==='personal_sign'),false);await click('login');assert.equal($('prepare').disabled,false);assert.equal(calls.some(q=>q.method==='eth_sendTransaction'),false);await click('prepare');assert.equal($('send').disabled,false);assert.equal(calls.some(q=>q.method==='eth_sendTransaction'),false);
  await click('send');assert.equal(calls.filter(q=>q.method==='eth_sendTransaction').length,1);assert.equal($('send').disabled,true);assert.match($('state').textContent,new RegExp(H));await click('reconcile');assert.match($('result').textContent,/链上发券已核验通过/);assert.equal(calls.filter(q=>q.method==='eth_sendTransaction').length,1);
 }finally{w.dispatchEvent(new w.Event('pagehide'));dom.window.close()}
});
