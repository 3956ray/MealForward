import test from 'node:test';
import assert from 'node:assert/strict';
import {createRpcPacer} from './t1f-rpc-pacer.mjs';

test('RPC permits start in FIFO order with real short spacing',async()=>{
 const wait=createRpcPacer({intervalMs:5}),starts=[];
 await Promise.all(Array.from({length:6},(_,i)=>wait().then(()=>starts.push({i,at:performance.now()}))));
 assert.deepEqual(starts.map(x=>x.i),[0,1,2,3,4,5]);
 // Microtask observation may occur slightly after the internal start timestamp.
 for(let i=1;i<starts.length;i++)assert.ok(starts[i].at-starts[i-1].at>=4,'permits must not form a burst');
});

test('pending queue has a fixed bound and overflow does not enter it',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let now=0;
 const wait=createRpcPacer({intervalMs:250,maxPending:2,clock:()=>now});
 await wait();const first=wait(),second=wait();
 await assert.rejects(wait(),/T1F_EXECUTION_RPC_BUSY/);
 now=250;t.mock.timers.tick(250);await first;
 now=500;t.mock.timers.tick(250);await second;
});

test('queued abort rejects immediately, frees capacity, and consumes no permit',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let now=0;
 const wait=createRpcPacer({intervalMs:250,maxPending:2,clock:()=>now});
 await wait();const ac=new AbortController();let cancelledRan=false,followingRan=false;
 const cancelled=wait(ac.signal).then(()=>{cancelledRan=true});
 const rejection=assert.rejects(cancelled,/T1F_EXECUTION_RPC_TIMEOUT/);
 const following=wait().then(()=>{followingRan=true});ac.abort();await rejection;
 const final=wait(); // The aborted entry immediately freed one bounded slot.
 assert.equal(followingRan,false);
 now=250;t.mock.timers.tick(250);await following;
 assert.equal(followingRan,true);assert.equal(cancelledRan,false);
 now=500;t.mock.timers.tick(250);await final;assert.equal(cancelledRan,false);
});

test('already-aborted calls never queue or consume the next start',async()=>{
 const wait=createRpcPacer({intervalMs:5,maxPending:1}),ac=new AbortController();ac.abort();
 await assert.rejects(wait(ac.signal),/T1F_EXECUTION_RPC_TIMEOUT/);
 await wait();
});

test('invalid pacing configuration cannot create unbounded waiting',()=>{
 for(const cfg of [{intervalMs:0},{intervalMs:NaN},{intervalMs:501},{maxPending:0},{maxPending:9},{maxPending:1.5},{clock:null}])assert.throws(()=>createRpcPacer(cfg),/T1F_EXECUTION_RPC_CONFIG/);
});
