import test from 'node:test';import assert from 'node:assert/strict';
import {probePhase8Rpc} from './t1f-phase8-rpc-probe.mjs';import {makeExecutionPublicRpc} from './t1f-execution-rpc.mjs';import {setupPhase8} from './t1f-phase8-service-fixture.mjs';
test('boot probe uses only context and bounded observation, no signing or writes',async()=>{const f=await setupPhase8();const r=await probePhase8Rpc({store:{context:f.store.context},rpc:f.rpc,clock:()=>f.now});assert.equal(r.ok,true);assert.equal(r.calls,42);assert.deepEqual(f.counts,{create:0,record:0,consume:0,bind:0,reconcile:0})});
test('RPC HTTP rejection keeps only status and method, never upstream body',async()=>{for(const status of [403,429,503]){const rpc=makeExecutionPublicRpc({fetchImpl:async()=>new Response('private upstream body',{status})});const r=await probePhase8Rpc({store:{context:async()=>({round:null})},rpc});assert.equal(r.ok,false);assert.equal(r.rpcHttpStatus,status);assert.equal(r.method,'eth_chainId');assert.ok(!JSON.stringify(r).includes('private'));}});
test('closing probe aborts the actual pending transport',async()=>{const ac=new AbortController();let entered;const started=new Promise(r=>entered=r);const result=probePhase8Rpc({store:{context:async()=>({round:null})},signal:ac.signal,rpc:{send(m,p,s){entered();return new Promise((resolve,reject)=>s.addEventListener('abort',()=>reject(Error('aborted')),{once:true}))}}});await started;ac.abort();const out=await result;assert.equal(out.ok,false);assert.equal(out.calls,1)});
test('distinct public transport clients share one start-rate limit',async()=>{
 const starts=[];const fetchImpl=async(url,o)=>{starts.push(performance.now());const q=JSON.parse(o.body);return Response.json({jsonrpc:'2.0',id:q.id,result:'0x279f'})};
 const a=makeExecutionPublicRpc({fetchImpl}),b=makeExecutionPublicRpc({fetchImpl});
 await Promise.all([a.send('eth_chainId',[]),b.send('eth_chainId',[]),a.send('eth_chainId',[])]);
 assert.equal(starts.length,3);for(let i=1;i<starts.length;i++)assert.ok(starts[i]-starts[i-1]>=240);
});
