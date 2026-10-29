import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from './wallet-v2/node_modules/jsdom/lib/api.js';
import {makeChallenge} from './auth/siwe.mjs';
import {keccak256} from 'ethers';
import {createExecutionController,ISSUER,TARGET} from './public/t1f-execution-controller.mjs';
async function mount({multiple=false,controllerOptions={},cryptoReady=false,cryptoFail=false}={}){const html=await readFile(new URL('./public/t1f-execution.html',import.meta.url),'utf8'),dom=new JSDOM(html,{url:'http://127.0.0.1:15449'});const w=dom.window,calls=[],timers=new Map();let rejectFetch,client,timerId=0;const provider={async request({method}){calls.push(method);return method==='eth_accounts'?[ISSUER]:'0x279f'},on(){}};w.ethereum=multiple?{providers:[provider,{...provider}]}:provider;let code=await readFile(new URL('./public/t1f-execution-page.mjs',import.meta.url),'utf8');code=code.replace("import {createExecutionController} from './t1f-execution-controller.mjs';",'').replace("import('./t1f-execution-crypto.mjs')",'loadCrypto()');new Function('createExecutionController','document','location','globalThis','addEventListener','dispatchEvent','Event','fetch','loadCrypto','setInterval','clearInterval',code)(options=>(client=createExecutionController({...options,...controllerOptions})),w.document,w.location,w,w.addEventListener.bind(w),w.dispatchEvent.bind(w),w.Event,()=>new Promise((_,reject)=>{rejectFetch=reject}),()=>cryptoFail?Promise.reject(Error('CRYPTO_UNAVAILABLE')):cryptoReady?Promise.resolve({hashData:keccak256}):new Promise(()=>{}),(fn)=>{timers.set(++timerId,fn);return timerId},id=>timers.delete(id));return {dom,w,calls,get client(){return client},get timerCount(){return timers.size},tick(){for(const fn of timers.values())fn()},stop(){rejectFetch?.(Error('TEST_END'))},$:id=>w.document.getElementById(id)}}
const flush=()=>new Promise(r=>setTimeout(r,0));
test('actual page wallet handlers remain usable with unresolved crypto and backend',async()=>{const f=await mount();f.$('refresh').click();await flush();assert.equal(f.$('inspect').disabled,false);f.$('inspect').click();await flush();assert.deepEqual(f.calls,['eth_accounts','eth_chainId']);assert.match(f.$('wallet').textContent,/verified/);assert.equal(f.$('prepare').disabled,true);f.w.dispatchEvent(new f.w.Event('pagehide'));f.stop();await flush();f.dom.window.close();});
test('actual page requires explicit provider selection when multiple wallets exist',async()=>{const f=await mount({multiple:true});assert.equal(f.$('provider').value,'');f.$('inspect').click();await flush();assert.equal(f.calls.length,0);f.$('provider').value='1';f.$('provider').dispatchEvent(new f.w.Event('change'));f.$('inspect').click();await flush();assert.deepEqual(f.calls,['eth_accounts','eth_chainId']);f.dom.window.close();});

test('original hash recovery is labelled, initially disabled and never implicitly invoked',async()=>{const f=await mount();assert.equal(f.$('original-hash').disabled,true);assert.equal(f.$('recover-hash').disabled,true);assert.equal(f.w.document.querySelector('label[for="original-hash"]').textContent,'Original transaction hash');assert.match(f.$('hash-help').textContent,/same original transaction hash.*wallet history/);f.$('original-hash').value='0x'+'9'.repeat(64);f.$('original-hash').dispatchEvent(new f.w.Event('input'));await flush();assert.equal(f.calls.length,0);f.dom.window.close();});

// The real controller is driven through authentication and prepare; only network/wallet boundaries are synthetic.
test('prepared page counts down, disables send at cutoff and stops ticking on pagehide',async()=>{
 const NOW=1792792000,ID='dddddddd-dddd-4ddd-8ddd-dddddddddddd',ROUND='cccccccc-cccc-4ccc-8ccc-cccccccccccc',H='0x'+'9'.repeat(64),CSRF='a'.repeat(43),ORIGIN='http://127.0.0.1:15449';
 let now=NOW,requests=0;
 const tx={from:ISSUER,to:TARGET,chainId:'0x279f',value:'0x0',nonce:'0x0',data:'0x1234'};
 let state={status:'READY_TO_PREPARE',originalClaimStage:'ISSUE_UNKNOWN',serverTime:NOW,chainId:10143,issuer:ISSUER,target:TARGET,serverMayBroadcast:false,settlementEnabled:false,sendAgainPermitted:false,round:{id:ROUND,digest:H,expiresAt:NOW+300,prepareBefore:NOW+210,candidateDeadline:NOW+480,nonce:'0',roles:{owner:true,donor:true}},operation:null};
 const request=async path=>{requests++;if(path.endsWith('pre-session'))return {csrf:CSRF};if(path.endsWith('challenge'))return makeChallenge({wallet:ISSUER,origin:ORIGIN,chainId:10143,nonce:'a'.repeat(64),challengeId:ROUND,issuedAt:NOW,expiresAt:NOW+180});if(path.endsWith('login'))return {csrf:CSRF,authPilot:true};if(path.endsWith('status'))return structuredClone(state);if(path.endsWith('prepare')){state={...state,status:'RECOVERY_ONLY',operation:{id:ID,operationId:H,stage:'ISSUE_UNKNOWN',revision:0,nonce:'0',deadline:NOW+480,calldataHash:keccak256(tx.data),txHash:null,receiptBlock:null,receiptBlockHash:null}};return {...structuredClone(state),created:true,transaction:tx};}throw Error(path);};
 const f=await mount({cryptoReady:true,controllerOptions:{clock:()=>now,request}});
 try{
  await flush();await f.client.challenge();await f.client.login();await f.client.refresh();assert.equal(f.$('prepare').disabled,false);
  await f.client.prepare();assert.equal(f.$('send').disabled,false);assert.match(f.$('result').textContent,/Send once in wallet/);assert.doesNotMatch(f.$('result').textContent,/^Ready$/);
  const calls=f.calls.length,count=requests;now=NOW+209;f.tick();assert.match(f.$('state').textContent,/1s/);
  now=NOW+210;f.tick();assert.equal(f.$('send').disabled,true);assert.equal(f.$('prepare').disabled,true);assert.match(f.$('result').textContent,/window closed/i);assert.match(f.$('result').textContent,/no transaction hash/i);assert.equal(f.$('recover-hash').disabled,true);
  assert.equal(f.calls.length,calls);assert.equal(requests,count);assert.equal(f.timerCount,1);
  f.w.dispatchEvent(new f.w.Event('pagehide'));assert.equal(f.timerCount,0);
 }finally{f.dom.window.close();}
});

test('countdown does not erase a failed hash dependency diagnostic',async()=>{
 const f=await mount({cryptoFail:true});try{await flush();assert.match(f.$('result').textContent,/Hash validation unavailable/);f.tick();assert.match(f.$('result').textContent,/Hash validation unavailable/);assert.equal(f.$('prepare').disabled,true);}finally{f.dom.window.close();}
});
