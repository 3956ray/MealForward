import {
  decodeEventLog, decodeFunctionData, decodeFunctionResult, encodeAbiParameters,
  encodeFunctionData, getAddress, hashTypedData, keccak256, parseAbi,
} from 'viem';
import { storeEscrowAbi } from './escrow-abi.mjs';
import { compiledStoreEscrowCreationCode, compiledStoreEscrowCreationCodeHash } from './escrow-creation-code.mjs';
import { registrationFactoryAbi } from './factory-abi.mjs';
export { storeEscrowAbi, registrationFactoryAbi, compiledStoreEscrowCreationCode, compiledStoreEscrowCreationCodeHash };

export const erc20Abi = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
]);
export const registrationTypes = {
  Registration: [
    { name: 'registrationId', type: 'bytes32' }, { name: 'storeId', type: 'bytes32' },
    { name: 'owner', type: 'address' }, { name: 'configHash', type: 'bytes32' },
    { name: 'deadline', type: 'uint256' },
  ],
};
const ZERO = '0x0000000000000000000000000000000000000000';
const MAX = (1n << 256n) - 1n;
function fail(field) { throw new TypeError(`Invalid ${field}`); }
function uint(value, field, { positive = false, max = MAX } = {}) {
  if (typeof value !== 'bigint' && !(typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value))) fail(field);
  const n = BigInt(value);
  if (n < 0n || n > max || (positive && n === 0n)) fail(field);
  return n;
}
function address(value, field) {
  try { const a = getAddress(value); if (a === ZERO) fail(field); return a; }
  catch { fail(field); }
}
function bytes32(value, field, nonzero = true) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value) || (nonzero && /^0x0{64}$/.test(value))) fail(field);
  return value.toLowerCase();
}
function bytes(value, field, allowEmpty = false) {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value) || (!allowEmpty && value === '0x')) fail(field);
  return value.toLowerCase();
}
function chain(value) {
  if (!Number.isSafeInteger(value) || value < 1) fail('chainId');
  return value;
}
function sameAddress(a, b, field) { if (address(a, field) !== address(b, field)) fail(field); }
function walletBinding(binding, wallet, expectedAccount) {
  if (chain(binding.chainId) !== chain(wallet.chainId)) fail('wallet chain binding');
  sameAddress(wallet.account, expectedAccount, 'wallet account binding');
}
function transaction(chainId, from, to, abi, functionName, args, correlation) {
  return {
    chainId: chain(chainId), from: address(from, 'from'), to: address(to, 'to'),
    value: 0n, data: encodeFunctionData({ abi, functionName, args }),
    functionName, args, correlation,
    authority: 'PREPARATION_ONLY',
  };
}
function escrowBinding(binding) {
  chain(binding.chainId);
  for (const field of ['escrow', 'asset', 'owner', 'receiver', 'quoteAuthority']) address(binding[field], field);
  sameAddress(binding.owner, binding.receiver, 'owner receiver binding');
}

/** Integer asset base units only. Backend supplies an already validated deployment binding. */
export function prepareApprove({ binding, wallet, payer, amount }) {
  escrowBinding(binding);
  walletBinding(binding, wallet, payer);
  const n = uint(amount, 'amount', { positive: true });
  return transaction(binding.chainId, wallet.account, binding.asset, erc20Abi, 'approve',
    [address(binding.escrow, 'escrow'), n], { escrow: address(binding.escrow, 'escrow'), amount: n });
}

/** signedQuote is the original trusted backend envelope; this module neither creates nor verifies its signature. */
export function prepareFund({ binding, wallet, signedQuote, now }) {
  escrowBinding(binding);
  if (chain(signedQuote.chainId) !== binding.chainId) fail('quote chain binding');
  sameAddress(signedQuote.escrow, binding.escrow, 'quote escrow binding');
  sameAddress(signedQuote.quoteAuthority, binding.quoteAuthority, 'quote authority binding');
  const q = signedQuote.quote;
  walletBinding(binding, wallet, q.payer);
  const quote = {
    quoteId: bytes32(q.quoteId, 'quoteId'), payer: address(q.payer, 'payer'),
    mealId: bytes32(q.mealId, 'mealId'), currentVersion: uint(q.currentVersion, 'currentVersion', { positive: true }),
    termsHash: bytes32(q.termsHash, 'termsHash'), quantity: uint(q.quantity, 'quantity', { positive: true, max: 10n }),
    unitPrice: uint(q.unitPrice, 'unitPrice', { positive: true }), amount: uint(q.amount, 'amount', { positive: true }),
    deadline: uint(q.deadline, 'deadline', { positive: true }),
  };
  if (quote.amount !== quote.quantity * quote.unitPrice) fail('quote amount');
  if (quote.deadline <= uint(now, 'now')) fail('quote deadline');
  const signature = bytes(signedQuote.signature, 'quote signature');
  // StoreEscrow uses OpenZeppelin ECDSA.recover(bytes): it accepts a 65-byte signature.
  if (signature.length !== 132) fail('quote signature length');
  return transaction(binding.chainId, wallet.account, binding.escrow, storeEscrowAbi,
    'fund', [quote, signature], { quoteId: quote.quoteId });
}

export function prepareSettle({ binding, wallet, opId, voucherId, generation }) {
  escrowBinding(binding);
  walletBinding(binding, wallet, binding.owner);
  const args = [bytes32(opId, 'opId'), bytes32(voucherId, 'voucherId'), uint(generation, 'generation', { positive: true })];
  return transaction(binding.chainId, wallet.account, binding.escrow, storeEscrowAbi,
    'settle', args, { opId: args[0], voucherId: args[1], generation: args[2] });
}

function catalogEntries(catalog) {
  if (!Array.isArray(catalog) || catalog.length === 0) fail('nonempty real initial catalog');
  const seen = new Set();
  const current = new Map();
  const highest = new Map();
  const result = catalog.map(entry => {
    if (typeof entry.current !== 'boolean') fail('catalog current');
    const t = entry.terms;
    const terms = {
      mealId: bytes32(t.mealId, 'mealId'), version: uint(t.version, 'version', { positive: true }),
      unitPrice: uint(t.unitPrice, 'unitPrice', { positive: true }),
      bodyDigest: bytes32(t.bodyDigest, 'bodyDigest'), imageDigest: bytes32(t.imageDigest, 'imageDigest'),
      windowCount: uint(t.windowCount, 'windowCount', { positive: true, max: 2n }),
    };
    for (const field of ['startMinute0', 'endMinute0', 'startMinute1', 'endMinute1']) {
      terms[field] = uint(t[field], field, { max: 1440n });
    }
    if (terms.startMinute0 >= terms.endMinute0 ||
        (terms.windowCount === 1n && (terms.startMinute1 !== 0n || terms.endMinute1 !== 0n)) ||
        (terms.windowCount === 2n && (terms.startMinute1 >= terms.endMinute1 || terms.endMinute0 > terms.startMinute1))) fail('catalog windows');
    const key = `${terms.mealId}:${terms.version}`;
    if (seen.has(key) || (entry.current && current.has(terms.mealId))) fail('catalog duplicate');
    seen.add(key);
    highest.set(terms.mealId, terms.version > (highest.get(terms.mealId) ?? 0n) ? terms.version : highest.get(terms.mealId));
    if (entry.current) current.set(terms.mealId, terms.version);
    return { terms, current: entry.current };
  });
  for (const [mealId, version] of highest) if (current.get(mealId) !== version) fail('catalog highest current');
  return result;
}
function factoryBinding(binding) {
  chain(binding.chainId);
  for (const field of ['factory', 'registrar', 'asset', 'quoteAuthority', 'catalogAuthority', 'issuerAuthority', 'operatorAuthority']) address(binding[field], field);
}
export function registrationConfigHash({ binding, storeId, owner, catalog }) {
  factoryBinding(binding);
  const entries = catalogEntries(catalog);
  const params = [
    ...['asset', 'quoteAuthority', 'catalogAuthority', 'issuerAuthority', 'operatorAuthority'].map(name => ({ type: 'address', name })),
    { type: 'bytes32', name: 'storeId' }, { type: 'address', name: 'owner' },
    registrationFactoryAbi.find(entry => entry.name === 'createStore').inputs[1],
  ];
  return keccak256(encodeAbiParameters(params, [
    ...['asset', 'quoteAuthority', 'catalogAuthority', 'issuerAuthority', 'operatorAuthority'].map(name => address(binding[name], name)),
    bytes32(storeId, 'storeId'), address(owner, 'owner'), entries,
  ]));
}
export function prepareRegistrationTypedData({ binding, wallet, registration, catalog, now }) {
  factoryBinding(binding);
  walletBinding(binding, wallet, registration.owner);
  const message = {
    registrationId: bytes32(registration.registrationId, 'registrationId'),
    storeId: bytes32(registration.storeId, 'storeId'), owner: address(registration.owner, 'owner'),
    configHash: registrationConfigHash({ binding, storeId: registration.storeId, owner: registration.owner, catalog }),
    deadline: uint(registration.deadline, 'deadline', { positive: true }),
  };
  if (message.deadline <= uint(now, 'now')) fail('registration deadline');
  if (registration.configHash && bytes32(registration.configHash, 'configHash') !== message.configHash) fail('registration configHash binding');
  return {
    domain: { name: 'MealForward Store Registration', version: '1', chainId: binding.chainId, verifyingContract: address(binding.factory, 'factory') },
    types: structuredClone(registrationTypes), primaryType: 'Registration', message,
  };
}
// The digest covers domain and all Registration fields, including the original deadline.
export function registrationDigest(typedData) { return hashTypedData(typedData); }

export function validateEscrowCreationCode({ binding, escrowCreationCode = compiledStoreEscrowCreationCode }) {
  const code = bytes(escrowCreationCode, 'escrowCreationCode');
  const pinned = bytes32(binding.escrowCreationCodeHash, 'escrowCreationCodeHash');
  if (code !== compiledStoreEscrowCreationCode || keccak256(code) !== compiledStoreEscrowCreationCodeHash || pinned !== compiledStoreEscrowCreationCodeHash) fail('fixed escrow creation code binding');
  return code;
}

/** Executed later by the platform registrar, never by the owner paying deployment gas. */
export function prepareCreateStore(input) {
  if (Object.hasOwn(input, 'escrowCreationCode')) fail('caller escrowCreationCode');
  const { binding, registrar, registration, catalog, ownerSignature, now } = input;
  const typedData = prepareRegistrationTypedData({ binding,
    wallet: { chainId: binding.chainId, account: registration.owner }, registration, catalog, now });
  walletBinding(binding, registrar, binding.registrar);
  return transaction(binding.chainId, registrar.account, binding.factory, registrationFactoryAbi,
    'createStore', [typedData.message, catalogEntries(catalog), bytes(ownerSignature, 'ownerSignature', true),
      validateEscrowCreationCode({ binding })],
    { registrationId: typedData.message.registrationId, authorizationDigest: registrationDigest(typedData),
      escrowCreationCodeHash: compiledStoreEscrowCreationCodeHash });
}

export function decodeOriginalCall({ kind, data }) {
  const abi = kind === 'escrow' ? storeEscrowAbi : kind === 'approve' ? erc20Abi : kind === 'registration' ? registrationFactoryAbi : fail('call kind');
  const decoded = decodeFunctionData({ abi, data });
  const allowed = kind === 'escrow' ? ['fund', 'settle'] : kind === 'approve' ? ['approve'] : ['createStore'];
  if (!allowed.includes(decoded.functionName)) fail('original call');
  return decoded;
}
export function decodeEscrowEvent({ escrow, log }) {
  sameAddress(log.address, escrow, 'event escrow binding');
  return decodeEventLog({ abi: storeEscrowAbi, data: log.data, topics: log.topics, strict: true });
}
export function decodeRegistrationEvent({ factory, log }) {
  sameAddress(log.address, factory, 'event factory binding');
  return decodeEventLog({ abi: registrationFactoryAbi, data: log.data, topics: log.topics, strict: true });
}
export function decodeEscrowState({ functionName, data }) {
  if (!['getOperation', 'getVoucher', 'getUnit', 'getBatch', 'getAccounting'].includes(functionName)) fail('state function');
  return { functionName, value: decodeFunctionResult({ abi: storeEscrowAbi, functionName, data }), authority: 'OBSERVATION_ONLY' };
}
export function matchOriginalTransaction({ prepared, observed }) {
  if (chain(observed.chainId) !== prepared.chainId) fail('original transaction chain');
  sameAddress(observed.from, prepared.from, 'original transaction sender');
  sameAddress(observed.to, prepared.to, 'original transaction target');
  if (typeof observed.input !== 'string' || observed.input.toLowerCase() !== prepared.data.toLowerCase()) fail('original transaction calldata');
  if (uint(observed.value, 'original transaction value') !== prepared.value) fail('original transaction value');
  return { transactionHash: bytes32(observed.hash, 'transactionHash'), authority: 'OBSERVATION_ONLY' };
}
/** Browser observations cannot commit business state or claim backend finality. */
export function observeOriginalReceipt({ prepared, observedTransaction, transactionHash, receipt }) {
  const hash = bytes32(transactionHash, 'transactionHash');
  const base = { transactionHash: hash, authority: 'OBSERVATION_ONLY', backendFinalVerification: 'NOT_CONNECTED' };
  if (observedTransaction && matchOriginalTransaction({ prepared, observed: observedTransaction }).transactionHash !== hash) fail('original transaction hash');
  if (!receipt) return { ...base, status: 'PENDING', events: [] };
  if (bytes32(receipt.transactionHash, 'receipt hash') !== hash) fail('receipt hash binding');
  sameAddress(receipt.from, prepared.from, 'receipt sender');
  sameAddress(receipt.to, prepared.to, 'receipt target');
  if (receipt.status === 'reverted' || receipt.status === '0x0' || receipt.status === 0) return { ...base, status: 'REVERTED_OBSERVED', events: [] };
  if (!['success', '0x1', 1].includes(receipt.status)) return { ...base, status: 'UNKNOWN', events: [] };
  // Each emitting contract address is bound; ERC20 logs do not prove escrow funding.
  const events = prepared.functionName === 'fund' || prepared.functionName === 'settle'
    ? (receipt.logs ?? []).filter(log => address(log.address, 'log address') === prepared.to).map(log => decodeEscrowEvent({ escrow: prepared.to, log }))
    : prepared.functionName === 'createStore'
      ? (receipt.logs ?? []).filter(log => address(log.address, 'log address') === prepared.to).map(log => decodeRegistrationEvent({ factory: prepared.to, log })) : [];
  return { ...base, status: 'MINED_UNVERIFIED', events, originalTransactionMatched: Boolean(observedTransaction) };
}
