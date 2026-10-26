import test from 'node:test';
import assert from 'node:assert/strict';
import {issuerCapabilities} from './t1e-claim-entrypoint.mjs';
import {makeT1EClaimGateway} from './t1e-claim-http.mjs';
import {createServer} from 'node:http';
test('startup and gateway accurately report disabled, legacy, successor and combined issuer capabilities; setup stays disabled',async()=>{
 for(const config of [{},{issueEnabled:true},{successorEnabled:true},{issueEnabled:true,successorEnabled:true}]){
  const expected={issuerTransactionEnabled:!!(config.issueEnabled||config.successorEnabled),issuerIssueEnabled:!!config.issueEnabled,successorEnabled:!!config.successorEnabled};
  assert.deepEqual(issuerCapabilities(config),expected);assert.deepEqual(issuerCapabilities(config,true),{issuerTransactionEnabled:false,issuerIssueEnabled:false,successorEnabled:false});
  let handler;const server=createServer((req,res)=>handler(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
  try{handler=makeT1EClaimGateway({origin,stage:'CLAIM_CONSENT',authStore:{},claimStore:{},readiness:async()=>{},loginHandler:()=>{},...config,issuerLedger:{},issuerRpc:{send:async()=>{}},issuerReadiness:async()=>{},executionService:config.successorEnabled?{status:async()=>{},prepare:async()=>{},bind:async()=>{},reconcile:async()=>{}}:null});const response=await fetch(origin+'/v1/t1e/status');assert.equal(response.status,200);const body=await response.json();for(const [key,value] of Object.entries(expected))assert.equal(body[key],value,key);}finally{await new Promise(r=>server.close(r))}
 }
});
