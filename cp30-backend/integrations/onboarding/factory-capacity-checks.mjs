// Explicit offline fixture: compiler template and invented addresses, never chain evidence.
import assert from 'node:assert/strict';
import { encodeFunctionResult } from 'viem';
import { observerFactoryAbi, runtimeTemplates } from '../wallet/registration-observer.mjs';
import { capacityCodec, getterNames } from './factory-capacity-codec.mjs';
const fields = ['factory', 'registrar', 'asset', 'quoteAuthority', 'catalogAuthority', 'issuerAuthority', 'operatorAuthority'];
const addresses = Object.fromEntries(fields.map((field, i) => [field, '0x' + String(i + 1).padStart(40, '0')]));
const creation = '0x3aed59967d18f9b80a436f1080f9b55b5ea9299f62eb1c7d8f612d7ed8d30b4e';
const calls = capacityCodec({ op: 'prepare' }).calls;
assert.equal(calls.find(c => c.functionName === 'storeCount').data, '0xa1b141d4');
assert.equal(calls.find(c => c.functionName === 'issuerAuthority').data, '0xcbdb6f6a');
const results = Object.fromEntries(getterNames.map(functionName => [functionName,
  encodeFunctionResult({ abi: observerFactoryAbi, functionName,
    result: functionName === 'storeCount' ? 0n : functionName === 'escrowCreationCodeHash' ? creation : addresses[functionName] })]));
const packet = { op: 'verify', code: runtimeTemplates.factory.code, results, templatePin: runtimeTemplates.factory.templateHash };
assert.equal(capacityCodec(packet).count, 0);
assert.equal(capacityCodec({ ...packet, results: { ...results, storeCount: encodeFunctionResult({ abi: observerFactoryAbi, functionName: 'storeCount', result: 3n }) } }).count, 3);
process.stdout.write(JSON.stringify({ calls, results, code: packet.code, addresses, creation,
  templatePins: Object.fromEntries(Object.entries(runtimeTemplates).map(([key, v]) => [key, v.templateHash])) }));
