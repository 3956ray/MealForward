// Offline, explicitly synthetic test-only values. Ephemeral quote key never leaves this process.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { decodeFunctionData, encodeAbiParameters, encodeFunctionResult, hashTypedData, keccak256, stringToHex } from 'viem';
import { prepareFund } from '../wallet/index.mjs';
import { businessEscrowAbi, fundingQuoteTypes, prepareFundingQuote, attachFundingSignature,
  prepareIssue, prepareLock, prepareMarkHandover, prepareReport, prepareRead, decodeRead } from './index.mjs';

const w = n => '0x' + n.toString(16).padStart(64,'0');
const a = n => '0x' + n.toString(16).padStart(40,'0');
const binding = { chainId: 31337, escrow: a(20), storeId: w(2), asset: a(21), owner: a(10), receiver: a(10),
  quoteAuthority: a(22), catalogAuthority: a(23), issuerAuthority: a(24), operatorAuthority: a(25) };

test('every reused/extracted ABI entry matches accepted original compiled artifact', () => {
  const artifact = JSON.parse(readFileSync(new URL('../../../cp30-contracts/out/s0b-final/StoreEscrow.sol/StoreEscrow.json', import.meta.url)));
  for (const entry of businessEscrowAbi) assert.deepEqual(entry, artifact.abi.find(candidate =>
    candidate.type === entry.type && candidate.name === entry.name));
  assert.deepEqual(fundingQuoteTypes.FundingQuote, artifact.abi.find(entry => entry.name === 'fund').inputs[0].components.map(({name,type})=>({name,type})));
});

test('ephemeral in-memory EOA quote signature verifies fixed authority and feeds existing wallet fund', async () => {
  const ephemeral = privateKeyToAccount(generatePrivateKey()); // Synthetic test only, no real key/config/provider.
  const profile = { ...binding, quoteAuthority: ephemeral.address };
  const quote = { quoteId:w(30), payer:a(31), mealId:w(32), currentVersion:'1', termsHash:w(33),
    quantity:'1', unitPrice:'1', amount:'1', deadline:'200' };
  const prepared = prepareFundingQuote({ binding:profile, quote, now:'100' });
  assert.equal(prepared.digest, hashTypedData(prepared.typedData));
  assert.equal(prepared.typedData.domain.name, 'MealForward C0 Funding');
  const signature = await ephemeral.signTypedData(prepared.typedData);
  const signedQuote = await attachFundingSignature({ binding:profile, quote, signature, now:'100' });
  const fund = prepareFund({ binding:profile, wallet:{chainId:31337,account:quote.payer}, signedQuote, now:'100' });
  assert.equal(decodeFunctionData({ abi:businessEscrowAbi, data:fund.data }).args[0].quoteId, quote.quoteId);
  await assert.rejects(attachFundingSignature({ binding, quote, signature, now:'100' }), /QUOTE_AUTHORITY_MISMATCH/);
  assert.throws(()=>prepareFundingQuote({binding:profile,quote:{...quote,amount:'2'},now:'100'}),/QUOTE_AMOUNT_MISMATCH/);
});

test('issuer/operator descriptors preserve exact operation domain, ids, parameters and caller', () => {
  const cases = [
    [prepareIssue, 'issue', 5, binding.issuerAuthority, {opId:w(40),mealId:w(32),expectedUnitSeq:'0',expectedNextGeneration:'1',expectedTermsHash:w(33),deadline:'200'}],
    [prepareLock, 'lock', 6, binding.operatorAuthority, {opId:w(41),voucherId:w(50),generation:'1',deadline:'200'}],
    [prepareMarkHandover, 'markHandover', 7, binding.operatorAuthority, {opId:w(42),voucherId:w(50),generation:'1',lockId:w(41),deadline:'200'}],
    [prepareReport, 'report', 8, binding.operatorAuthority, {opId:w(43),voucherId:w(50),generation:'1',lockId:w(41),markerId:w(42)}],
  ];
  for (const [prepare,name,kind,caller,parameters] of cases) {
    const descriptor = prepare({binding,caller,parameters,now:'100'});
    const decoded = decodeFunctionData({abi:businessEscrowAbi,data:descriptor.data});
    assert.equal(decoded.functionName,name);
    assert.equal(decoded.args[0],parameters.opId);
    assert.equal(descriptor.from,caller);
    assert.equal(descriptor.to,binding.escrow);
    assert.equal(descriptor.value,'0');
    const abi = businessEscrowAbi.find(entry=>entry.name===name);
    const parametersHash = keccak256(encodeAbiParameters(abi.inputs.slice(1),decoded.args.slice(1)));
    const inputs = [{type:'bytes32'},{type:'uint256'},{type:'uint256'},{type:'address'},
      {type:'uint8'},{type:'address'},{type:'bytes32'},{type:'bytes32'}];
    assert.equal(descriptor.paramsDigest,keccak256(encodeAbiParameters(inputs,
      [keccak256(stringToHex('MealForwardOperationV1')),1n,31337n,binding.escrow,kind,caller,parameters.opId,parametersHash])));
    assert.notEqual(prepare({binding,caller,parameters:{...parameters,opId:w(99)},now:'100'}).paramsDigest,descriptor.paramsDigest);
    assert.throws(()=>prepare({binding,caller:binding.owner,parameters,now:'100'}),/OPERATION_CALLER_MISMATCH/);
  }
});

test('block-pinned reads decode canonical real ABI shape without inventing projection/finality', () => {
  const read = prepareRead({binding,functionName:'getOperation',args:[w(40)],block:{number:'1',hash:w(60)}});
  assert.deepEqual(read.blockTag,{blockHash:w(60),requireCanonical:true});
  const result = encodeFunctionResult({abi:businessEscrowAbi,functionName:'getOperation',result:{
    kind:5,caller:binding.issuerAuthority,payloadHash:w(61),result:w(62),executedAt:100n}});
  const observed = decodeRead({binding,read,result});
  assert.equal(observed.value.kind,'5');
  assert.equal(observed.value.executedAt,'100');
  assert.equal(observed.authority,'OBSERVATION_ONLY');
  assert.throws(()=>decodeRead({binding,read,result:result+'00'}),/NONCANONICAL_READ_RESULT/);
  assert.throws(()=>decodeRead({binding:{...binding,escrow:a(99)},read,result}),/READ_DESCRIPTOR_MISMATCH/);
  assert.throws(()=>prepareRead({binding,functionName:'getOperation',args:[w(40)],block:{number:'latest',hash:w(60)}}));
});
