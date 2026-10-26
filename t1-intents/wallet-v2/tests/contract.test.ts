import test from 'node:test';
import assert from 'node:assert/strict';
// Backend JavaScript fixtures are compatibility evidence, not browser dependencies.
// @ts-ignore backend module has no declarations
import {publicApproval} from '../../t1f-approval-protocol.mjs';
// @ts-ignore backend module has no declarations
import {fixture,NOW} from '../../t1f-approval-test-fixture.mjs';
import {TypedDataEncoder} from 'ethers';
import {validateState,roleFor} from '../src/validation.ts';
import {OWNER,DONOR} from '../src/contract.ts';

const valid=()=>{const f=fixture();return publicApproval({row:f.row,context:f.context,now:NOW});};
test('backend fixture is accepted and viem digest equals ethers',()=>{
 const state=validateState(valid(),NOW);
 assert.equal(state.round?.digest,TypedDataEncoder.hash(state.round!.typedData.domain,{SuccessorIssueRelease:[...state.round!.typedData.types.SuccessorIssueRelease]},state.round!.typedData.message));
 assert.equal(roleFor(OWNER),'owner');assert.equal(roleFor(DONOR.toUpperCase()),'donor');assert.equal(roleFor('0x'+'0'.repeat(40)),null);
});
test('NO_ROUND is valid; malformed and tampered states fail closed',()=>{
 const base=publicApproval({row:null,context:fixture().context,now:NOW});
 assert.equal(validateState(base,NOW).round,null);
 const bad=[{...base,unexpected:1},{...base,roles:{owner:true,donor:false}},{...base,serverTime:NOW-31},{...base,noRelease:false}];
 for(const x of bad)assert.throws(()=>validateState(x,NOW));
 const s=valid();
 for(const mutate of [
  (x:any)=>x.round.typedData.domain.name='other',
  (x:any)=>x.round.typedData.types.SuccessorIssueRelease[0].name='other',
  (x:any)=>x.round.typedData.message.originalNonce='00',
  (x:any)=>x.round.typedData.message.originalDataHash='0x'+'a'.repeat(64),
  (x:any)=>x.round.typedData.message.newOpId=x.round.typedData.message.originalOpId,
  (x:any)=>x.round.digest='0x'+'f'.repeat(64),
  (x:any)=>x.round.expiresAt+=1
 ]){const x=structuredClone(s);mutate(x);assert.throws(()=>validateState(x,NOW));}
});
test('expired manifest is represented as expired, never signable by validation alone',()=>{
 const s=valid();s.status='EXPIRED';s.serverTime=NOW+301;
 const x=validateState(s,NOW+301);assert.equal(x.status,'EXPIRED');assert.ok(x.round!.expiresAt<=x.serverTime);
});
test('strict consumed receipt survives expiry and rejects every corrupted field',async()=>{
 // @ts-ignore backend fixture has no declarations
 const {consumed}=await import('../../t1f-approval-test-fixture.mjs');
 const f=consumed(),s=publicApproval({...f,now:NOW+1000});
 assert.equal(validateState(s,NOW+1000).status,'CONSUMED_NO_RELEASE');
 for(const key of Object.keys(s.consumption)){const x=structuredClone(s);x.consumption[key]=null;assert.throws(()=>validateState(x,NOW+1000));}
 for(const x of [{...s,status:'EXPIRED'},{...s,unknown:1},{...s,consumption:undefined}])assert.throws(()=>validateState(x,NOW+1000));
});
