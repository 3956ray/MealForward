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
import {fixture} from '../../t1f-approval-test-fixture.mjs';

const html=readFileSync(new URL('../../public/wallet-v2.html',import.meta.url),'utf8');
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
