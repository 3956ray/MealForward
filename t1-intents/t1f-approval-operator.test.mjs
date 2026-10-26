import test from 'node:test';import assert from 'node:assert/strict';
import {parseApprovalOperator,runApprovalOperator} from './t1f-approval-operator.mjs';
const args=['create','--wallet-observation','OWNER_REPORTED_NO_TRANSACTIONS_VISIBLE','--observed-at','1792792000'];
test('operator only explicit create with timestamped personal wallet report; no default/auto rollover',()=>{
 assert.equal(parseApprovalOperator(args).walletObservation.observedAt,1792792000);
 for(const bad of [[],['create'],args.concat('--force'),['release',...args.slice(1)],[...args.slice(0,4),'0'],[...args.slice(0,4),'1792792000.0']])assert.throws(()=>parseApprovalOperator(bad));
});
test('operator commits through service and outputs bounded DTO; malformed args never open runtime',async()=>{
 let opened=0,closed=0,called=0;
 const openRuntime=async()=>{opened++;return {pool:{end:async()=>closed++},service:{createRound:async input=>{called++;assert.equal(input.walletObservation.observedAt,1792792000);return {noRelease:true,status:'COLLECTING',round:{id:'public',digest:'public',expiresAt:1792792300}}}}}};
 const result=await runApprovalOperator({args,openRuntime});assert.equal(result.noRelease,true);assert.equal(opened,1);assert.equal(closed,1);assert.equal(called,1);
 await assert.rejects(()=>runApprovalOperator({args:[],openRuntime}));assert.equal(opened,1);
});
