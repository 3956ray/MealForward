// Offline, fixed public fixture only. Imports installed viem; no client, key, signing or network.
import { encodeAbiParameters, hashTypedData, keccak256, stringToHex } from 'viem';
import { writeFileSync } from 'node:fs';
const domain = { name: 'MealForward C0 Funding', version: '1', chainId: 31337, verifyingContract: '0x0000000000000000000000000000000000003000' };
const fields = [
  ['quoteId', 'bytes32'], ['payer', 'address'], ['mealId', 'bytes32'],
  ['currentVersion', 'uint256'], ['termsHash', 'bytes32'], ['quantity', 'uint256'],
  ['unitPrice', 'uint256'], ['amount', 'uint256'], ['deadline', 'uint256'],
].map(([name, type]) => ({ name, type }));
const message = {
  quoteId: `0x${'1'.padStart(64, '0')}`,
  payer: '0x0000000000000000000000000000000000000101',
  mealId: keccak256(stringToHex('synthetic meal A')), currentVersion: 2n,
  termsHash: keccak256(stringToHex('synthetic A v2 immutable terms')),
  quantity: 3n, unitPrice: 6000000n, amount: 18000000n, deadline: 1800000600n,
};
const typeString = `FundingQuote(${fields.map(({ name, type }) => `${type} ${name}`).join(',')})`;
const typeHash = keccak256(stringToHex(typeString));
const payloadHash = keccak256(encodeAbiParameters([{ type: 'bytes32' }, ...fields], [typeHash, ...fields.map(({ name }) => message[name])]));
const domainType = 'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)';
const domainSeparator = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }], [keccak256(stringToHex(domainType)), keccak256(stringToHex(domain.name)), keccak256(stringToHex(domain.version)), BigInt(domain.chainId), domain.verifyingContract]));
const digest = hashTypedData({ domain, types: { FundingQuote: fields }, primaryType: 'FundingQuote', message });
const batchId = keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'address' }, { type: 'bytes32' }], [31337n, domain.verifyingContract, message.quoteId]));
const vector = { scope: 'fixed synthetic offline vector; address 0x3000 is not a deployment', viemVersion: '2.57.1', domain, typeString, fields, message, typeHash, payloadHash, domainSeparator, digest, batchId };
writeFileSync(new URL('../evidence/s0b/c0-quote-vector.json', import.meta.url), JSON.stringify(vector, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2) + '\n');
process.stdout.write(JSON.stringify({ typeHash, payloadHash, domainSeparator, digest, batchId }) + '\n');
