// Pure ABI/typed-data encoding only; no client, signing, network or database defaults.
import { decodeFunctionResult, encodeAbiParameters, encodeFunctionData, encodeFunctionResult,
  getAddress, hashTypedData, keccak256, recoverTypedDataAddress, stringToHex } from 'viem';
import { businessEscrowAbi } from './escrow-abi.mjs';
export { businessEscrowAbi };

const fn = name => businessEscrowAbi.find(entry => entry.type === 'function' && entry.name === name);
const maxUint = (1n << 256n) - 1n;
const roles = { issue: ['issuerAuthority', 5], lock: ['operatorAuthority', 6],
  markHandover: ['operatorAuthority', 7], report: ['operatorAuthority', 8] };
const reads = new Set(['getAccounting', 'availableUnits', 'availableAmount', 'nextCandidate', 'getVoucher',
  'getOperation', 'getUnit', 'getBatch', 'getTerms', 'currentVersion', 'listed', 'quoteUses',
  'asset', 'storeId', 'owner', 'receiver', 'quoteAuthority', 'catalogAuthority', 'issuerAuthority',
  'operatorAuthority', 'paused', 'closed', 'controlRevision', 'quoteDigest', 'operationPayloadHash']);
function fail(message) { throw new TypeError(message); }
function uint(value, positive = false, max = maxUint) {
  if (typeof value !== 'bigint' && !(typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value))) fail('INVALID_INTEGER');
  const n = BigInt(value);
  if (n < 0n || n > max || (positive && n === 0n)) fail('INVALID_INTEGER');
  return n;
}
function addr(value) {
  const result = getAddress(value).toLowerCase();
  if (result === '0x' + '0'.repeat(40)) fail('INVALID_ADDRESS');
  return result;
}
function word(value, nonzero = true) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)
      || (nonzero && /^0x0{64}$/.test(value))) fail('INVALID_BYTES32');
  return value.toLowerCase();
}
function exact(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== fields.length || fields.some(name => !Object.hasOwn(value, name))) fail('INVALID_FIELDS');
}
export function trustedBinding(binding) {
  if (!binding || !Number.isSafeInteger(binding.chainId) || binding.chainId < 1) fail('INVALID_CHAIN');
  const result = { chainId: binding.chainId, storeId: word(binding.storeId) };
  for (const name of ['escrow', 'asset', 'owner', 'receiver', 'quoteAuthority', 'catalogAuthority', 'issuerAuthority', 'operatorAuthority']) {
    result[name] = addr(binding[name]);
  }
  if (result.owner !== result.receiver) fail('OWNER_RECEIVER_MISMATCH');
  return result; // Syntax/binding consistency is not identity, deployment or chain verification.
}
export function jsonValue(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,jsonValue(v)]));
  return value;
}
function observationValue(value) {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string' && value.startsWith('0x')) return value.toLowerCase();
  if (Array.isArray(value)) return value.map(observationValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,observationValue(v)]));
  return jsonValue(value);
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k,canonical(value[k])]));
  return value;
}
function abiArgument(input, value) {
  if (/^uint[0-9]+$/.test(input.type)) return uint(value, false, (1n << BigInt(input.type.slice(4))) - 1n);
  if (input.type === 'bytes32') return word(value, false);
  if (input.type === 'address') return addr(value);
  if (input.type === 'tuple') {
    exact(value, input.components.map(c => c.name));
    return Object.fromEntries(input.components.map(component => [component.name, abiArgument(component, value[component.name])]));
  }
  fail('UNSUPPORTED_ABI_ARGUMENT');
}

export const fundingQuoteTypes = { FundingQuote: fn('fund').inputs[0].components.map(({name,type}) => ({name,type})) };
export function prepareFundingQuote({ binding, quote, now }) {
  const profile = trustedBinding(binding), fields = fundingQuoteTypes.FundingQuote.map(field => field.name);
  exact(quote, fields);
  const message = { quoteId: word(quote.quoteId), payer: addr(quote.payer), mealId: word(quote.mealId),
    currentVersion: uint(quote.currentVersion, true), termsHash: word(quote.termsHash),
    quantity: uint(quote.quantity, true, 10n), unitPrice: uint(quote.unitPrice, true),
    amount: uint(quote.amount, true), deadline: uint(quote.deadline, true) };
  if (message.amount !== message.quantity * message.unitPrice) fail('QUOTE_AMOUNT_MISMATCH');
  if (message.deadline <= uint(now)) fail('QUOTE_EXPIRED');
  const typedData = { domain: { name: 'MealForward C0 Funding', version: '1',
    chainId: profile.chainId, verifyingContract: profile.escrow },
    primaryType: 'FundingQuote', types: fundingQuoteTypes, message };
  const typeName = 'FundingQuote(' + fundingQuoteTypes.FundingQuote.map(field => `${field.type} ${field.name}`).join(',') + ')';
  const payloadHash = keccak256(encodeAbiParameters([{type:'bytes32'}, fn('fund').inputs[0]],
    [keccak256(stringToHex(typeName)), message]));
  return { typedData, digest: hashTypedData(typedData), payloadHash, quote: jsonValue(message), authority: 'PREPARATION_ONLY' };
}

export async function attachFundingSignature({ binding, quote, signature, now }) {
  const profile = trustedBinding(binding), prepared = prepareFundingQuote({ binding: profile, quote, now });
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)) fail('INVALID_QUOTE_SIGNATURE');
  // Match original OpenZeppelin ECDSA.recover(bytes) representation and malleability rules.
  const v = Number.parseInt(signature.slice(-2), 16), s = BigInt('0x' + signature.slice(66,130));
  if (![27,28].includes(v) || s > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n) fail('INVALID_QUOTE_SIGNATURE');
  const recovered = addr(await recoverTypedDataAddress({ ...prepared.typedData, signature }));
  if (recovered !== profile.quoteAuthority) fail('QUOTE_AUTHORITY_MISMATCH');
  return { chainId: profile.chainId, escrow: profile.escrow, quoteAuthority: profile.quoteAuthority,
    quote: prepared.quote, signature: signature.toLowerCase() };
}

function prepareOperation(functionName, { binding, caller, parameters, now }) {
  const profile = trustedBinding(binding), [expectedRole, kind] = roles[functionName], abi = fn(functionName);
  const from = addr(caller);
  if (from !== profile[expectedRole]) fail('OPERATION_CALLER_MISMATCH');
  exact(parameters, abi.inputs.map(input => input.name));
  const args = abi.inputs.map(input => {
    const value = parameters[input.name];
    if (input.type === 'bytes32') return word(value);
    if (input.type === 'uint8') return uint(value, false, 9n); // Original lifetime cap is 10 units, seq 0..9.
    return uint(value, true);
  });
  const deadlineIndex = abi.inputs.findIndex(input => input.name === 'deadline');
  if (deadlineIndex !== -1 && args[deadlineIndex] <= uint(now)) fail('OPERATION_EXPIRED');
  const parametersHash = keccak256(encodeAbiParameters(abi.inputs.slice(1), args.slice(1)));
  const payloadInputs = fn('operationPayloadHash').inputs;
  const paramsDigest = keccak256(encodeAbiParameters(
    [{type:'bytes32'},{type:'uint256'},{type:'uint256'},{type:'address'}, ...payloadInputs],
    [keccak256(stringToHex('MealForwardOperationV1')), 1n, BigInt(profile.chainId), profile.escrow,
      kind, from, args[0], parametersHash]));
  const data = encodeFunctionData({ abi: businessEscrowAbi, functionName, args });
  return { chainId: profile.chainId, from, to: profile.escrow, value: '0', data,
    callDataDigest: keccak256(data), opId: args[0], parametersHash, paramsDigest,
    functionName, expectedRole, args: jsonValue(args), authority: 'PREPARATION_ONLY' };
}
export const prepareIssue = input => prepareOperation('issue', input);
export const prepareLock = input => prepareOperation('lock', input);
export const prepareMarkHandover = input => prepareOperation('markHandover', input);
export const prepareReport = input => prepareOperation('report', input);

export function prepareRead({ binding, functionName, args = [], block }) {
  const profile = trustedBinding(binding);
  if (!reads.has(functionName)) fail('UNSUPPORTED_READ');
  exact(block, ['number','hash']);
  const blockNumber = uint(block.number).toString(), blockHash = word(block.hash);
  const abi = fn(functionName);
  if (!Array.isArray(args) || args.length !== abi.inputs.length) fail('INVALID_READ_ARGUMENTS');
  const normalizedArgs = abi.inputs.map((input, i) => abiArgument(input, args[i]));
  const data = encodeFunctionData({ abi: businessEscrowAbi, functionName, args: normalizedArgs });
  return { chainId: profile.chainId, to: profile.escrow, data, functionName, args: jsonValue(normalizedArgs),
    block: { number: blockNumber, hash: blockHash }, blockTag: { blockHash, requireCanonical: true },
    authority: 'READ_DESCRIPTION_ONLY' };
}
export function decodeRead({ binding, read, result }) {
  const expected = prepareRead({ binding, functionName: read.functionName, args: read.args, block: read.block });
  if (JSON.stringify(canonical(expected)) !== JSON.stringify(canonical(read))) fail('READ_DESCRIPTOR_MISMATCH');
  if (typeof result !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(result)) fail('INVALID_READ_RESULT');
  const value = decodeFunctionResult({ abi: businessEscrowAbi, functionName: read.functionName, data: result });
  if (encodeFunctionResult({ abi: businessEscrowAbi, functionName: read.functionName, result: value }).toLowerCase() !== result.toLowerCase()) {
    fail('NONCANONICAL_READ_RESULT');
  }
  return { chainId: expected.chainId, escrow: expected.to, blockNumber: expected.block.number,
    blockHash: expected.block.hash, functionName: expected.functionName, value: observationValue(value),
    authority: 'OBSERVATION_ONLY' };
}
