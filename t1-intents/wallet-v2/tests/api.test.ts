import test from 'node:test';
import assert from 'node:assert/strict';
import {createApprovalApi} from '../src/api.ts';
const csrf='a'.repeat(64);
test('same-origin transport uses one session across reads and exact submit',async()=>{
 const calls:any[]=[];let now=1000;
 const fetchImpl=async(input:any,init:any)=>{calls.push([input,init]);return {ok:true,status:200,json:async()=>input==='/v1/approval/session'?{csrf,expiresAt:now+300}:{ok:true}} as Response};
 const api=createApprovalApi({fetchImpl:fetchImpl as typeof fetch,clock:()=>now});
 await api.read();await api.read();await api.submit({role:'owner',roundId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',digest:'0x'+'1'.repeat(64),signature:'0x'+'2'.repeat(130)});
 assert.deepEqual(calls.map(c=>c[0]),['/v1/approval/session','/v1/approval/state','/v1/approval/state','/v1/approval/submit']);
 for(const [,i] of calls){assert.equal(i.credentials,'same-origin');assert.equal(i.cache,'no-store');assert.equal(i.redirect,'error');assert.equal(i.headers.Accept,'application/json');}
 assert.equal(calls[0][1].body,'{}');assert.equal(calls[1][1].headers['X-Approval-CSRF'],csrf);
 assert.deepEqual(JSON.parse(calls[3][1].body),{role:'owner',roundId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',digest:'0x'+'1'.repeat(64),signature:'0x'+'2'.repeat(130)});
 now=1300;await api.read();assert.equal(calls.filter(c=>c[0]==='/v1/approval/session').length,2);
});
test('401 clears session and next explicit read creates one; submit has no retry and errors hide signature',async()=>{
 const calls:any[]=[];const secret='0x'+'2'.repeat(130);let rejectState=true;
 const fetchImpl=async(input:any)=>{calls.push(input);if(input==='/v1/approval/session')return {ok:true,status:200,json:async()=>({csrf,expiresAt:1300})} as Response;if(rejectState){rejectState=false;return {ok:false,status:401} as Response}throw Error(secret)};
 const api=createApprovalApi({fetchImpl:fetchImpl as typeof fetch,clock:()=>1000});
 await assert.rejects(api.read(),/API_/);await assert.rejects(api.submit({role:'owner',roundId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',digest:'0x'+'1'.repeat(64),signature:secret}),e=>!String(e).includes(secret));
 assert.deepEqual(calls,['/v1/approval/session','/v1/approval/state','/v1/approval/session','/v1/approval/submit']);
 await assert.rejects(api.submit({role:'owner',roundId:'bad',digest:'bad',signature:secret}),/API_SUBMIT_INPUT/);
 assert.equal(calls.length,4);
});
test('deadline abort is sanitized',async()=>{
 const api=createApprovalApi({fetchImpl:(async(_p:any,i:any)=>new Promise((_r,j)=>i.signal.addEventListener('abort',()=>j(Error('secret'))))) as typeof fetch,timeoutMs:5});
 await assert.rejects(api.read(),/API_/);
});
