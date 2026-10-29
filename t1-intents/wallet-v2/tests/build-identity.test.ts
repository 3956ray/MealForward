import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
// @ts-ignore build helper is plain JavaScript
import {sourceFingerprint} from '../build-id.mjs';
// @ts-ignore jsdom runtime without extra type package
import {JSDOM} from 'jsdom';

// This tests the committed build, including the no-import bootstrap, not a test override.
test('built HTML, bootstrap failures and controller diagnostics share the exact source fingerprint',async()=>{
 const buildId=await sourceFingerprint();
 assert.match(buildId,/^wallet-v2-[0-9a-f]{64}$/);
 assert.equal(await sourceFingerprint(),buildId);
 const html=await readFile(new URL('../../public/wallet-v2.html',import.meta.url),'utf8');
 const canonical=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
 assert.equal(html,canonical.replaceAll('__WALLET_V2_BUILD_ID__',buildId));
 const dom=new JSDOM(html);
 assert.match(dom.window.document.getElementById('diagnostic')!.textContent!,new RegExp(`build=${buildId} `));
 const bootstrap=await import(new URL('../../public/wallet-v2-bootstrap.mjs',import.meta.url).href);
 bootstrap.mountWalletV2(dom.window.document,{loadWallet:()=>new Promise(()=>{}),loadController:async()=>{throw Error('private')},loadValidation:()=>new Promise(()=>{}),loadApi:()=>new Promise(()=>{}),reportMs:1});
 for(let i=0;i<20;i++)await Promise.resolve();
 assert.equal(dom.window.document.getElementById('diagnostic')!.textContent,`build=${buildId} phase=controller-load code=DEPENDENCY_CONTROLLER`);
 const core=await import(new URL('../../public/wallet-v2-controller.mjs',import.meta.url).href);
 const c=core.createController({wallet:{providers:()=>[],dispose:()=>{}},api:{},validate:()=>{},render:()=>{}});
 assert.match(c.snapshot().diagnostic,new RegExp(`^build=${buildId} `));c.dispose();
 await new Promise(resolve=>setTimeout(resolve,5));
 assert.match(dom.window.document.getElementById('diagnostic')!.textContent!,new RegExp(`build=${buildId} phase=dependencies`));
});
