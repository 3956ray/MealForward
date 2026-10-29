import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {makeApprovalHttpHandler} from './t1f-approval-server.mjs';

test('Wallet V2 exact static routes, root, rollback and API remain isolated',async t=>{
 let reads=0,writes=0;
 const service={status:async()=>{reads++;return {status:'NO_ROUND',noRelease:true}},submit:async()=>{writes++;throw Error('unexpected submit')}};
 const server=http.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port;
 server.on('request',makeApprovalHttpHandler({service,origin,testing:true}));
 t.after(()=>new Promise(r=>server.close(r)));
 const files={
  '/wallet-v2.html':['wallet-v2.html','text/html'],
  '/wallet-v2.css':['wallet-v2.css','text/css'],
  '/wallet-v2-bootstrap.mjs':['wallet-v2-bootstrap.mjs','text/javascript'],
  '/wallet-v2-controller.mjs':['wallet-v2-controller.mjs','text/javascript'],
  '/wallet-v2-wallet.mjs':['wallet-v2-wallet.mjs','text/javascript'],
  '/wallet-v2-validation.mjs':['wallet-v2-validation.mjs','text/javascript'],
  '/t1f-approval.html':['t1f-approval.html','text/html'],
  '/t1f-approval.css':['t1f-approval.css','text/css'],
  '/t1f-approval.mjs':['t1f-approval.mjs','text/javascript']
 };
 for(const [path,[file,type]] of Object.entries(files)){
  const response=await fetch(origin+path);
  assert.equal(response.status,200,path);
  assert.match(response.headers.get('content-type'),new RegExp('^'+type));
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.match(response.headers.get('content-security-policy'),/script-src 'self'/);
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.equal(response.headers.get('access-control-allow-origin'),null);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),await readFile(new URL('./public/'+file,import.meta.url)),path);
 }
 const root=await fetch(origin+'/');assert.equal(root.status,200);
 assert.deepEqual(Buffer.from(await root.arrayBuffer()),await readFile(new URL('./public/wallet-v2.html',import.meta.url)));
 const health=await fetch(origin+'/health');assert.deepEqual(await health.json(),{status:'APPROVAL_COLLECTOR',noRelease:true});
 for(const path of ['/wallet-v2-extra.mjs','/wallet-v2-chunk.js','/wallet-v2.html?x=1','/%2e%2e%2fwallet-v2.html','/public/wallet-v2.html']){
  const response=await fetch(origin+path,{headers:{'Sec-Fetch-Site':'same-origin'}});assert.ok(response.status>=400,path);
 }
 const session=await fetch(origin+'/v1/approval/session',{method:'POST',headers:{Origin:origin,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json'},body:'{}'});
  assert.equal(session.status,200);const {csrf}=await session.json();
 const state=await fetch(origin+'/v1/approval/state',{headers:{'Sec-Fetch-Site':'same-origin',Cookie:session.headers.get('set-cookie').split(';')[0],'X-Approval-CSRF':csrf}});
 assert.equal(state.status,200);assert.equal((await state.json()).status,'NO_ROUND');assert.equal(reads,1);assert.equal(writes,0);
});
