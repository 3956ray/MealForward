import test from 'node:test';
import assert from 'node:assert/strict';
import {makeApprovalStore} from './t1f-approval-store.mjs';
import {fixture,NOW,ROUND} from './t1f-approval-test-fixture.mjs';

test('both durable store writes forward the pre-execution guard without running it too early',async()=>{
 const f=fixture(),calls=[];let checks=0;
 const beforeExecute=()=>{checks++};
 const store=makeApprovalStore({pool:{query:async(...args)=>{calls.push(args);return {rowCount:1,rows:[{result:f.row}]}}}});
 await store.create({roundId:ROUND,manifest:f.manifest,createdAt:NOW,observedBlockTime:NOW,beforeExecute});
 await store.record({roundId:ROUND,digest:f.manifest.digest,role:'owner',wallet:f.manifest.value.owner,fingerprint:'0x'+'a'.repeat(64),beforeExecute});
 assert.equal(checks,0,'only adapter can check after awaited connection setup');
 assert.equal(calls.length,2);
 for(const call of calls)assert.equal(call[2]?.beforeExecute,beforeExecute);
 assert.match(calls[0][0],/create_round/);assert.match(calls[1][0],/record_approval/);
});
