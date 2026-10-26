import test from 'node:test';
import assert from 'node:assert/strict';
import {browserFixture} from './t1f-execution-browser-fixture.mjs';
import {CSRF} from './t1f-execution-http-fixture.mjs';
import {validateExecution} from './public/t1f-execution-controller.mjs';
import {readFile} from 'node:fs/promises';
test('loopback browser fixture traverses authenticated gateway and actual service for prepare/bind/reconcile/reload',async()=>{
 const f=await browserFixture();try{const call=async(action,body,authenticated=true)=>{const r=await fetch(f.origin+'/v1/t1f/successor/'+action,{method:body?'POST':'GET',headers:{origin:f.origin,'content-type':'application/json','x-c1-csrf':CSRF,...(authenticated?{cookie:'fixture_session=synthetic'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()}};
 assert.equal((await call('status',null,false)).status,401);
 const page=await (await fetch(f.origin)).text();assert.match(page,/SYNTHETIC LOOPBACK FIXTURE/);assert.match(page,/Reject next send/);const source=await(await fetch(f.origin+'/t1f-execution-page.mjs')).text();assert.match(source,/SYNTHETIC_PROVIDER_REQUIRED/);assert.doesNotMatch(source,/^addEventListener\('eip6963/m);
 const status=await call('status');validateExecution(status.body);assert.equal(status.body.status,'READY_TO_PREPARE');
 const input={roundId:status.body.round.id,digest:status.body.round.digest},p=await call('prepare',input);assert.equal(p.status,201);validateExecution(p.body,{prepare:true});assert.ok(p.body.transaction);
 assert.equal((await call('prepare',input)).body.transaction,undefined);assert.equal((await call('status')).body.transaction,undefined);
 await fetch(f.origin+'/fixture/control',{method:'POST',headers:{origin:f.origin,'content-type':'application/json'},body:JSON.stringify({mode:'sent'})});
 const op={roundId:input.roundId,successorId:p.body.operation.id,revision:0};const bound=await call('bind',{...op,txHash:'0x'+'9'.repeat(64)});assert.equal(bound.status,200);assert.equal(bound.body.operation.stage,'ISSUE_HASH_BOUND');validateExecution(bound.body);
 const pending=await call('reconcile',{...op,revision:1});assert.equal(pending.body.operation.stage,'ISSUE_HASH_BOUND');
 await fetch(f.origin+'/fixture/control',{method:'POST',headers:{origin:f.origin,'content-type':'application/json'},body:JSON.stringify({mode:'canonical'})});
 const issued=await call('reconcile',{...op,revision:1});assert.equal(issued.status,200);assert.equal(issued.body.operation.stage,'ISSUED');validateExecution(issued.body);
 assert.equal((await call('status')).body.originalClaimStage,'ISSUE_UNKNOWN');
 }finally{await f.close()}
});
test('production assets exclude synthetic auth/provider and contain no browser persistence or auto permissions',async()=>{
 const server=await readFile(new URL('./t1e-claim-server.mjs',import.meta.url),'utf8');assert.doesNotMatch(server,/execution-browser-(fixture|provider)/);assert.match(server,/if\(cfg.successorEnabled\)staticFiles.push/);
 for(const file of ['controller','page']){const s=await readFile(new URL('./public/t1f-execution-'+file+'.mjs',import.meta.url),'utf8');assert.doesNotMatch(s,/localStorage|sessionStorage|indexedDB|eth_requestAccounts/);}
});
test('actual service recovers original sent hash after failed bind, reload/relogin and expiry; unrelated or replacement hashes leave operation unchanged',async()=>{
 const {createExecutionController,ISSUER}=await import('./public/t1f-execution-controller.mjs');
 const {keccak256}=await import('ethers');let now=Math.floor(Date.now()/1000);const f=await browserFixture({clock:()=>now});const H='0x'+'9'.repeat(64);let sends=0;
 try{const control=mode=>fetch(f.origin+'/fixture/control',{method:'POST',headers:{origin:f.origin,'content-type':'application/json'},body:JSON.stringify({mode})});
 const request=async(path,method,body,csrf)=>{const r=await fetch(f.origin+path,{method,headers:{origin:f.origin,'content-type':'application/json',cookie:'fixture_session=synthetic',...(csrf?{'x-c1-csrf':csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});const result=await r.json();if(!r.ok)throw Error('HTTP_'+r.status);return result};
 const provider={on(){},async request({method}){if(method==='eth_accounts')return [ISSUER];if(method==='eth_chainId')return '0x279f';if(method==='personal_sign')return '0x'+'a'.repeat(130);if(method==='eth_sendTransaction'){sends++;await control('sent');return H;}throw Error(method)}};
 const options={provider,request,origin:f.origin,hashData:keccak256,clock:()=>now};let c=createExecutionController(options);await c.challenge();await c.login();await c.refresh();await c.prepare();await control('bind-fail');await assert.rejects(()=>c.send());assert.equal(sends,1);c.invalidate();
 c=createExecutionController(options);await c.challenge();await c.login();now+=600;await c.refresh();const before=c.snapshot().state.operation;assert.equal(before.txHash,null);assert.equal(c.snapshot().canSend,false);assert.equal(c.snapshot().receivedHash,null);await control('bind-ok');
 await assert.rejects(()=>c.recoverHash('0x'+'8'.repeat(64)));await c.refresh();assert.deepEqual(c.snapshot().state.operation,before);
 await c.recoverHash(H);const bound=c.snapshot().state.operation;assert.equal(bound.txHash,H);await assert.rejects(()=>request('/v1/t1f/successor/bind','POST',{roundId:c.snapshot().state.round.id,successorId:bound.id,revision:bound.revision,txHash:'0x'+'8'.repeat(64)},CSRF));await c.refresh();assert.deepEqual(c.snapshot().state.operation,bound);
 await control('canonical');await c.reconcile();assert.equal(c.snapshot().state.operation.stage,'ISSUED');assert.equal(c.snapshot().state.originalClaimStage,'ISSUE_UNKNOWN');assert.equal(sends,1);await assert.rejects(()=>c.send());
 }finally{await f.close()}
});
