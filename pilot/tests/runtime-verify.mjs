import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {matchesDeployedRuntime} from '../src/runtime-verify.js';

const artifacts=JSON.parse(readFileSync(new URL('../src/contract.generated.json',import.meta.url),'utf8'));
const pilot=artifacts.MealForwardPilot,token=artifacts.PilotMealCredit;

test('the exact test-only reviewed Pilot and disposable mMEAL runtime templates are accepted',()=>{
 assert.equal(matchesDeployedRuntime(pilot.runtimeTemplate,pilot),true);
 assert.equal(matchesDeployedRuntime(token.runtimeTemplate,token),true);
 assert.ok(pilot.runtimeSize>1000&&token.runtimeSize>1000);
});
test('unknown real USDC-like or attacker-defined contracts can never be attached',()=>{
 assert.equal(matchesDeployedRuntime('0x60006000',pilot),false);
 assert.equal(matchesDeployedRuntime('0x60006000',token),false);
 assert.equal(matchesDeployedRuntime(token.runtimeTemplate,pilot),false);
 assert.equal(matchesDeployedRuntime(pilot.runtimeTemplate,token),false);
});
test('any opcode or metadata tampering outside original solc immutable positions is blocked',()=>{
 const byte=pilot.runtimeTemplate;
 const modified=byte.slice(0,12)+(byte.slice(12,14)==='42'?'43':'42')+byte.slice(14);
 assert.equal(matchesDeployedRuntime(modified,pilot),false);
 const tok=token.runtimeTemplate;
 const altered=tok.slice(0,22)+(tok.slice(22,24)==='42'?'43':'42')+tok.slice(24);
 assert.equal(matchesDeployedRuntime(altered,token),false);
});
test('only declared solc immutable ranges may differ, and malformed masks are rejected',()=>{
 const refs=Object.values(pilot.immutableReferences).flat();
 assert.ok(refs.length>0,'Pilot credit is an immutable contract reference');
 const changed=Array.from(pilot.runtimeTemplate);
 for(const r of refs){
  for(let i=2+r.start*2;i<2+(r.start+r.length)*2;i++)changed[i]='a';
 }
 assert.equal(matchesDeployedRuntime(changed.join(''),pilot),true);
 assert.equal(matchesDeployedRuntime(pilot.runtimeTemplate,{...pilot,immutableReferences:{malicious:[{start:0,length:999999}]}}),false);
 assert.equal(matchesDeployedRuntime(pilot.runtimeTemplate,{...pilot,immutableReferences:{malicious:[{start:-1,length:1}]}}),false);
});
