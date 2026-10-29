import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// @ts-ignore jsdom runtime is used without an additional type package
import {JSDOM} from 'jsdom';
import {mountWalletV2} from '../src/bootstrap.ts';
import {createController} from '../src/controller.ts';
import {validateState} from '../src/validation.ts';
import {OWNER} from '../src/contract.ts';
// @ts-ignore backend fixture is compatibility evidence, not browser code
import {publicApproval} from '../../t1f-approval-protocol.mjs';
// @ts-ignore backend fixture is compatibility evidence, not browser code
import {buildSuccessorReleaseManifest} from '../../t1f-successor-dual-approval.mjs';
// @ts-ignore backend fixture is compatibility evidence, not browser code
import {fixture} from '../../t1f-approval-test-fixture.mjs';

const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const flush=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve()};
test('actual shipped shell binds controls before unresolved loaders',async()=>{
 const dom=new JSDOM(html,{url:'https://example.test/wallet-v2.html'});
 const mounted=mountWalletV2(dom.window.document,{loadWallet:()=>new Promise(()=>{}),loadValidation:()=>new Promise(()=>{}),loadController:()=>new Promise(()=>{}),loadApi:()=>new Promise(()=>{}),reportMs:5});
 dom.window.document.querySelector<HTMLButtonElement>('#inspect-button')!.click();
 assert.match(dom.window.document.querySelector('#wallet-progress')!.textContent||'',/加载|检查/);
 await new Promise(resolve=>setTimeout(resolve,8));
 assert.match(dom.window.document.querySelector('#wallet-progress')!.textContent||'',/仍在加载/);
 assert.ok(mounted);
});
test('wallet loader failure is visible and validation failure only blocks signing',async()=>{
 const dom=new JSDOM(html,{url:'https://example.test/wallet-v2.html'});
 mountWalletV2(dom.window.document,{loadWallet:async()=>{throw Error('secret')},loadValidation:async()=>{throw Error('secret')},loadController:async()=>({createController:()=>({snapshot:()=>({}),inspect:async()=>{},connect:async()=>{},refresh:async()=>{},sign:async()=>{},selectProvider:()=>{}})}) as never,loadApi:async()=>({createApprovalApi:()=>({read:async()=>({}),submit:async()=>({})})}) as never,reportMs:5});
 await flush();
 assert.match(dom.window.document.querySelector('#wallet-progress')!.textContent||'',/依赖|加载/);
 assert.match(dom.window.document.querySelector('#sign-progress')!.textContent||'',/校验|依赖/);
 assert.doesNotMatch(dom.window.document.body.textContent||'',/secret/);
});
test('delayed validation and pending service leave actual DOM wallet check usable',async()=>{
 const dom=new JSDOM(html,{url:'https://example.test/wallet-v2.html'});
 let resolveValidation!:(value:unknown)=>void;
 const validation=new Promise<unknown>(resolve=>{resolveValidation=resolve});
 const wallet={providers:()=>[{id:'meta',name:'<img src=x> MetaMask'}],select:(_id:string)=>{},inspect:async()=>({account:OWNER,chainId:10143}),connect:async()=>({account:OWNER,chainId:10143}),sign:async()=>'',dispose:()=>{}};
 mountWalletV2(dom.window.document,{loadWallet:async()=>({createWalletPort:()=>wallet}),loadValidation:()=>validation,loadController:async()=>({createController}),loadApi:async()=>({createApprovalApi:()=>({read:()=>new Promise(()=>{}),submit:async()=>({})})}),reportMs:5,signingEnabled:true});
 await flush();
 await new Promise(resolve=>setTimeout(resolve,0));
 const choice=dom.window.document.querySelector<HTMLSelectElement>('#provider-select')!;
 choice.value='meta';choice.dispatchEvent(new dom.window.Event('change'));
 dom.window.document.querySelector<HTMLButtonElement>('#inspect-button')!.click();
 await flush();
 assert.match(dom.window.document.querySelector('#wallet-account')!.textContent||'',new RegExp(OWNER));
 assert.doesNotMatch(dom.window.document.querySelector('#wallet-observed-at')!.textContent||'',/尚未|失效|Invalid/);
 assert.equal(dom.window.document.querySelector('img'),null);
 await new Promise(resolve=>setTimeout(resolve,8));
 assert.match(dom.window.document.querySelector('#sign-progress')!.textContent||'',/依赖/);
 resolveValidation({validateState});await flush();
 assert.match(dom.window.document.querySelector('#backend-progress')!.textContent||'',/读取|等待/);
 dom.window.document.querySelector<HTMLButtonElement>('#inspect-button')!.click();await flush();
 assert.match(dom.window.document.querySelector('#wallet-account')!.textContent||'',new RegExp(OWNER));
});
test('failed validation loader leaves wallet inspection operable in actual shell',async()=>{
 const dom=new JSDOM(html,{url:'https://example.test/wallet-v2.html'});
 const wallet={providers:()=>[{id:'meta',name:'MetaMask'}],select:(_id:string)=>{},inspect:async()=>({account:OWNER,chainId:10143}),connect:async()=>({account:OWNER,chainId:10143}),sign:async()=>'',dispose:()=>{}};
 mountWalletV2(dom.window.document,{loadWallet:async()=>({createWalletPort:()=>wallet}),loadValidation:async()=>{throw Error('hidden')},loadController:async()=>({createController}),loadApi:async()=>({createApprovalApi:()=>({read:async()=>({}),submit:async()=>({})})}),reportMs:5});
 await flush();
 await new Promise(resolve=>setTimeout(resolve,0));
 const choice=dom.window.document.querySelector<HTMLSelectElement>('#provider-select')!;
 choice.value='meta';choice.dispatchEvent(new dom.window.Event('change'));
 dom.window.document.querySelector<HTMLButtonElement>('#inspect-button')!.click();await flush();
 assert.match(dom.window.document.querySelector('#wallet-account')!.textContent||'',new RegExp(OWNER));
 assert.match(dom.window.document.querySelector('#sign-progress')!.textContent||'',/加载失败/);
 assert.equal(dom.window.document.querySelector<HTMLButtonElement>('#sign-button')!.disabled,true);
});
test('failed service loader leaves wallet check usable and reports its own failure',async()=>{
 const dom=new JSDOM(html,{url:'https://example.test/wallet-v2.html'});
 const wallet={providers:()=>[{id:'meta',name:'MetaMask'}],select:(_id:string)=>{},inspect:async()=>({account:OWNER,chainId:10143}),connect:async()=>({account:OWNER,chainId:10143}),sign:async()=>'',dispose:()=>{}};
 mountWalletV2(dom.window.document,{loadWallet:async()=>({createWalletPort:()=>wallet}),loadValidation:async()=>({validateState}),loadController:async()=>({createController}),loadApi:async()=>{throw Error('private')},reportMs:5});
 await flush();
 await new Promise(resolve=>setTimeout(resolve,0));
 const choice=dom.window.document.querySelector<HTMLSelectElement>('#provider-select')!;
 choice.value='meta';choice.dispatchEvent(new dom.window.Event('change'));
 dom.window.document.querySelector<HTMLButtonElement>('#inspect-button')!.click();await flush();
 assert.match(dom.window.document.querySelector('#wallet-account')!.textContent||'',new RegExp(OWNER));
 assert.match(dom.window.document.querySelector('#backend-progress')!.textContent||'',/加载失败/);
 assert.doesNotMatch(dom.window.document.body.textContent||'',/private/);
});
test('unresolved wallet import does not block backend NO_ROUND rendering',async()=>{
 const dom=new JSDOM(html,{url:'https://example.test/wallet-v2.html'});
 const noRound=publicApproval({row:null,context:fixture().context,now:Math.floor(Date.now()/1000)});
 mountWalletV2(dom.window.document,{loadWallet:()=>new Promise(()=>{}),loadValidation:async()=>({validateState}),loadController:async()=>({createController}),loadApi:async()=>({createApprovalApi:()=>({read:async()=>noRound,submit:async()=>noRound})}),reportMs:5});
 await new Promise(resolve=>setTimeout(resolve,0));
 await flush();
 assert.match(dom.window.document.querySelector('#round-status')!.textContent||'',/NO_ROUND/);
 assert.match(dom.window.document.querySelector('#wallet-progress')!.textContent||'',/加载/);
});
test('unresolved validation import still reads service and refreshes actual shell',async()=>{
 const dom=new JSDOM(html,{url:'https://example.test/wallet-v2.html'});
 const noRound=publicApproval({row:null,context:fixture().context,now:Math.floor(Date.now()/1000)});
 let reads=0;
 mountWalletV2(dom.window.document,{loadWallet:()=>new Promise(()=>{}),loadValidation:()=>new Promise(()=>{}),loadController:async()=>({createController}),loadApi:async()=>({createApprovalApi:()=>({read:async()=>{reads++;return noRound},submit:async()=>noRound})}),reportMs:5,signingEnabled:true});
 await new Promise(resolve=>setTimeout(resolve,0));await flush();
 assert.equal(reads,1);
 assert.match(dom.window.document.querySelector('#backend-progress')!.textContent||'',/已响应/);
 assert.match(dom.window.document.querySelector('#round-status')!.textContent||'',/VALIDATION_UNAVAILABLE/);
 assert.equal(dom.window.document.querySelector<HTMLButtonElement>('#sign-button')!.disabled,true);
 dom.window.document.querySelector<HTMLButtonElement>('#refresh-button')!.click();await flush();
 assert.equal(reads,2);
});
test('rejected validation import still reports successful service transport without trusting payload',async()=>{
 const dom=new JSDOM(html,{url:'https://example.test/wallet-v2.html'});
 let reads=0;
 mountWalletV2(dom.window.document,{loadWallet:()=>new Promise(()=>{}),loadValidation:async()=>{throw Error('private')},loadController:async()=>({createController}),loadApi:async()=>({createApprovalApi:()=>({read:async()=>{reads++;return {untrusted:'<img>'}},submit:async()=>({})})}),reportMs:5,signingEnabled:true});
 await new Promise(resolve=>setTimeout(resolve,0));await flush();
 assert.equal(reads,1);
 assert.match(dom.window.document.querySelector('#backend-progress')!.textContent||'',/已响应/);
 assert.match(dom.window.document.querySelector('#round-status')!.textContent||'',/VALIDATION_UNAVAILABLE/);
 assert.equal(dom.window.document.querySelector('#round-payload')!.textContent,'尚无内容');
 assert.equal(dom.window.document.querySelector<HTMLButtonElement>('#sign-button')!.disabled,true);
 assert.doesNotMatch(dom.window.document.body.textContent||'',/private|<img>/);
});
test('one build identity survives initial, dependency-wait, load-failure and controller diagnostics',async()=>{
 const expected='wallet-v2-test-source-sha';
 for(const mode of ['waiting','failure','controller'] as const){
  const dom=new JSDOM(html,{url:'https://example.test/wallet-v2.html'});
  const unavailable=()=>new Promise(()=>{});
  const options={buildId:expected,loadWallet:unavailable,loadValidation:unavailable,loadApi:unavailable,loadController:mode==='controller'?async()=>({createController}):mode==='failure'?async()=>{throw Error('private')}:unavailable,reportMs:5};
  mountWalletV2(dom.window.document,options);
  assert.match(dom.window.document.querySelector('#diagnostic')!.textContent||'',new RegExp(`build=${expected} `));
  await flush();await flush();
  const initialized=dom.window.document.querySelector('#diagnostic')!.textContent||'';
  assert.match(initialized,new RegExp(`build=${expected} `));
  if(mode==='failure')assert.match(initialized,/phase=controller-load/);
  if(mode==='controller')assert.match(initialized,/phase=idle\/idle/);
  await new Promise(resolve=>setTimeout(resolve,8));
  assert.match(dom.window.document.querySelector('#diagnostic')!.textContent||'',new RegExp(`build=${expected} `));
 }
});
test('default bootstrap signs only after an explicit click on a valid collecting round and disables NO_ROUND',async()=>{
 const now=Math.floor(Date.now()/1000);
 const sample=fixture();
 const chain={...sample.chain,observedBlockTime:now-10};
 const manifest=buildSuccessorReleaseManifest({...sample.context,chain,walletObservation:sample.context.review.wallet_observation,nonceDomain:sample.manifest.value.nonceDomain,candidateOperationId:sample.manifest.value.newOpId,candidateNonce:0,candidateDeadline:now+480,approvalExpiresAt:now+300,now});
 const row={...sample.row,value:manifest.value,digest:manifest.digest,created_at_epoch:now,observed_block_time:now-10,candidate_calldata_hash:manifest.candidateCalldataHash,approvals:[]};
 const dom=new JSDOM(html,{url:'https://example.test/wallet-v2.html'});
 let signs=0,submits=0;
 let currentRow:typeof row|null=row;
 const wallet={providers:()=>[{id:'meta',name:'MetaMask'}],select:(_id:string)=>{},inspect:async()=>({account:OWNER,chainId:10143}),connect:async()=>({account:OWNER,chainId:10143}),sign:async()=>{signs++;return '0x'+'1'.repeat(130)},dispose:()=>{}};
 const read=async()=>publicApproval({row:currentRow,context:sample.context,now:Math.floor(Date.now()/1000)});
 mountWalletV2(dom.window.document,{loadWallet:async()=>({createWalletPort:()=>wallet}),loadValidation:async()=>({validateState}),loadController:async()=>({createController}),loadApi:async()=>({createApprovalApi:()=>({read,submit:async(input:unknown)=>{submits++;assert.deepEqual(input,{role:'owner',roundId:row.round_id,digest:manifest.digest,signature:'0x'+'1'.repeat(130)});row.approvals=[{role:'owner',wallet:OWNER,fingerprint:'0x'+'2'.repeat(64)}];return read()}})})});
 await new Promise(resolve=>setTimeout(resolve,0));await flush();
 const choice=dom.window.document.querySelector<HTMLSelectElement>('#provider-select')!;
 choice.value='meta';choice.dispatchEvent(new dom.window.Event('change'));
 dom.window.document.querySelector<HTMLButtonElement>('#inspect-button')!.click();await flush();
 const signButton=dom.window.document.querySelector<HTMLButtonElement>('#sign-button')!;
 assert.equal(dom.window.document.querySelector('#round-status')!.textContent,'COLLECTING');
 assert.equal(signButton.disabled,false);
 assert.equal(signs,0);assert.equal(submits,0);
 signButton.click();await new Promise(resolve=>setTimeout(resolve,0));await flush();
 assert.equal(signs,1);assert.equal(submits,1);
 assert.equal(signButton.disabled,true);
 currentRow=null;
 dom.window.document.querySelector<HTMLButtonElement>('#refresh-button')!.click();await flush();
 assert.equal(dom.window.document.querySelector('#round-status')!.textContent,'NO_ROUND');
 assert.equal(signButton.disabled,true);
 signButton.click();await flush();
 assert.equal(signs,1);assert.equal(submits,1);
});
