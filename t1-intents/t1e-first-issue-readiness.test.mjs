import test from 'node:test';
import assert from 'node:assert/strict';
import {AbiCoder,keccak256,toUtf8Bytes} from 'ethers';
import {firstVoucherCandidate,originalVoucherId,t0,FIXED} from './t1e-first-issue-readiness.mjs';
import {CHAIN,ESCROW,MEAL,TERMS,PRICE,QUOTE} from './core.mjs';
import {readFileSync} from 'node:fs';

test('first voucher ID is fully deterministic by original chain, escrow, unit 0 and generation 1',()=>{
 const domain=keccak256(toUtf8Bytes('MealForwardVoucherV1'));
 const abi=AbiCoder.defaultAbiCoder();
 const expected=keccak256(abi.encode(
  ['bytes32','uint256','address','uint8','uint256'],
  [domain,CHAIN,ESCROW,0,1]
 ));
 assert.equal(originalVoucherId(0,1n),expected);
 assert.notEqual(originalVoucherId(1,1n),expected);
 assert.notEqual(originalVoucherId(0,2n),expected);
 assert.equal(expected.length,66);
 assert.equal(PRICE,7000000n);
 assert.equal(TERMS.length,66);
 assert.equal(MEAL.length,66);
});
test('reviewed onchain nextCandidate, Unit, Batch and accounting ABI decode exactly',()=>{
 const candidate=t0.decodeFunctionResult('nextCandidate',
  t0.encodeFunctionResult('nextCandidate',[[true,0,1,TERMS,false]]))[0];
 assert.equal(candidate.available,true);
 assert.equal(candidate.unitSeq,0n);
 assert.equal(candidate.nextGeneration,1n);
 assert.equal(candidate.termsHash.toLowerCase(),TERMS.toLowerCase());
 assert.equal(candidate.needsExpiry,false);

 const batchId='0x'+'7'.repeat(64);
 const unit=t0.decodeFunctionResult('getUnit',
  t0.encodeFunctionResult('getUnit',[[batchId,0,QUOTE,MEAL,1,TERMS,PRICE,0,0,
   '0x'+'0'.repeat(64)]]))[0];
 assert.equal(unit.localIndex,0n);
 assert.equal(unit.generation,0n);
 assert.equal(unit.bucket,0n);
 assert.equal(unit.unitPrice,PRICE);
 assert.equal(unit.voucherId,'0x'+'0'.repeat(64));
 const batch=t0.decodeFunctionResult('getBatch',
  t0.encodeFunctionResult('getBatch',[[QUOTE,MEAL,1,TERMS,PRICE,1,0,0]]))[0];
 assert.equal(batch.payer.toLowerCase(),QUOTE.toLowerCase());
 assert.equal(batch.firstUnit,0n);
 assert.equal(batch.refundedMask,0n);
 const accounting=t0.decodeFunctionResult('getAccounting',
  t0.encodeFunctionResult('getAccounting',[[1,PRICE,[1,0,0,0,0],
   [PRICE,0,0,0,0],PRICE]]))[0];
 assert.equal(accounting.fundedUnits,1n);
 assert.equal(accounting.fundedAmount,PRICE);
 assert.equal(accounting.counts[0],1n);
 assert.equal(accounting.amounts[0],PRICE);
 assert.equal(accounting.liability,PRICE);
});
test('unauthorized chain or malformed injection never requests money operations',async()=>{
 let count=0;
 const bad={
  async send(name){
   count++;
   assert.equal(name,'eth_chainId');
   return '0x1';
  }
 };
 await assert.rejects(
  ()=>firstVoucherCandidate({rpc:bad}),
  /T1E_WRONG_CHAIN/
 );
 assert.equal(count,1);
 await assert.rejects(
  ()=>firstVoucherCandidate({rpc:{}}),
  /T1E_READ_ONLY_RPC_REQUIRED/
 );
 await assert.rejects(
  ()=>firstVoucherCandidate({rpc:bad,simulateIssuer:'true'}),
  /T1E_SIMULATION_MODE_INVALID/
 );
});
test('T0 issuer, owner, quote and operator are separated, but these addresses are not proof of keys',()=>{
 assert.equal(new Set([
  FIXED.owner.toLowerCase(),FIXED.issuerAuthority.toLowerCase(),
  FIXED.operatorAuthority.toLowerCase(),QUOTE.toLowerCase()
 ]).size,4);
 assert.equal(FIXED.issuerAuthority.toLowerCase(),
  '0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3');
 assert.equal(t0.getFunction('issue').name,'issue');
 assert.equal(t0.getFunction('nextCandidate').name,'nextCandidate');
 // T1-E must never construct a payout or issue sender in this module.
 assert.equal(t0.hasFunction('settle'),false);
 assert.equal(t0.hasFunction('report'),false);
 assert.equal(t0.hasFunction('fund'),false);
 const code=readFileSync(new URL('./t1e-first-issue-readiness.mjs',import.meta.url),'utf8');
 assert.ok(code.includes('eth_call'));
 assert.ok(!code.includes('eth_sendTransaction'));
 assert.ok(!code.includes('eth_sendRawTransaction'));
 assert.ok(!code.includes('privateKeyToAccount'));
});
