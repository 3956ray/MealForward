import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeAbiParameters, encodeEventTopics, encodeFunctionResult, hashTypedData, keccak256, parseAbiParameters } from 'viem';
import * as w from './index.mjs';
const id = n => `0x${n.toString(16).padStart(64, '0')}`;
const addr = n => `0x${n.toString(16).padStart(40, '0')}`;
const binding = { chainId: 10143, escrow: addr(1), asset: addr(2), owner: addr(3), receiver: addr(3), quoteAuthority: addr(4) };
const wallet = { chainId: 10143, account: addr(5) };
const signedQuote = {
  chainId: 10143, escrow: binding.escrow, quoteAuthority: binding.quoteAuthority,
  quote: { quoteId: id(1), payer: wallet.account, mealId: id(2), currentVersion: 1n, termsHash: id(3), quantity: 1n, unitPrice: 100n, amount: 100n, deadline: 200n },
  signature: `0x${'11'.repeat(65)}`,
};
const factoryBinding = { ...binding, escrowCreationCodeHash: w.compiledStoreEscrowCreationCodeHash, factory: addr(6), registrar: addr(7), catalogAuthority: addr(8), issuerAuthority: addr(9), operatorAuthority: addr(10) };
const catalog = [{ terms: { mealId: id(2), version: 1n, unitPrice: 100n, bodyDigest: id(4), imageDigest: id(5), windowCount: 1n, startMinute0: 660n, endMinute0: 840n, startMinute1: 0n, endMinute1: 0n }, current: true }];
const registration = { registrationId: id(6), storeId: id(7), owner: binding.owner, deadline: 200n };
const ownerWallet = { chainId: 10143, account: binding.owner };

// Tests use only synthetic values and local installed viem; no provider, keys or network.
test('ABI entries equal accepted compiled S0b escrow ABI', () => {
  const actual = JSON.parse(readFileSync(new URL('../../../cp30-contracts/out/s0b-final/StoreEscrow.sol/StoreEscrow.json', import.meta.url))).abi;
  for (const entry of w.storeEscrowAbi) assert.deepEqual(entry, actual.find(e => e.type === entry.type && e.name === entry.name));
  assert.equal(w.storeEscrowAbi.find(e => e.name === 'fund').inputs[0].components.length, 9);
});

test('approve/fund/owner settle encode and decode their original immutable arguments', () => {
  const approve = w.prepareApprove({ binding, wallet, payer: wallet.account, amount: '100' });
  assert.deepEqual(w.decodeOriginalCall({ kind: 'approve', data: approve.data }).args, [binding.escrow, 100n]);
  assert.equal(approve.to, binding.asset);
  assert.equal(approve.from, wallet.account);
  const fund = w.prepareFund({ binding, wallet, signedQuote, now: 100n });
  const decoded = w.decodeOriginalCall({ kind: 'escrow', data: fund.data });
  assert.equal(decoded.functionName, 'fund');
  assert.deepEqual(decoded.args, [signedQuote.quote, signedQuote.signature]);
  assert.equal(fund.value, 0n);
  const settle = w.prepareSettle({ binding, wallet: ownerWallet, opId: id(9), voucherId: id(10), generation: '1' });
  assert.deepEqual(w.decodeOriginalCall({ kind: 'escrow', data: settle.data }).args, [id(9), id(10), 1n]);
});

test('wrong chain/account/quote binding/decimal and inconsistent integer amounts are rejected', () => {
  assert.throws(() => w.prepareApprove({ binding, wallet, payer: binding.owner, amount: 100n }), /account binding/);
  assert.throws(() => w.prepareApprove({ binding, wallet: { ...wallet, chainId: 31337 }, payer: wallet.account, amount: 100n }), /chain binding/);
  for (const amount of [100, '1.00', '-1', '0100', 0n, 1n << 256n]) assert.throws(() => w.prepareApprove({ binding, wallet, payer: wallet.account, amount }), /amount/);
  assert.throws(() => w.prepareFund({ binding, wallet: ownerWallet, signedQuote, now: 100n }), /account binding/);
  assert.throws(() => w.prepareFund({ binding, wallet, signedQuote: { ...signedQuote, escrow: addr(50) }, now: 100n }), /escrow binding/);
  assert.throws(() => w.prepareFund({ binding, wallet, signedQuote: { ...signedQuote, chainId: 31337 }, now: 100n }), /chain binding/);
  assert.throws(() => w.prepareFund({ binding, wallet, signedQuote: { ...signedQuote, quote: { ...signedQuote.quote, amount: 101n } }, now: 100n }), /quote amount/);
  assert.throws(() => w.prepareFund({ binding, wallet, signedQuote, now: 200n }), /deadline/);
  assert.throws(() => w.prepareSettle({ binding, wallet, opId: id(9), voucherId: id(10), generation: 1n }), /account binding/);
});

test('factory configHash independently follows abi.encode field and nested catalog order', () => {
  const params = parseAbiParameters('address,address,address,address,address,bytes32,address,((bytes32,uint256,uint256,bytes32,bytes32,uint8,uint16,uint16,uint16,uint16),bool)[]');
  const t = catalog[0].terms;
  const expected = keccak256(encodeAbiParameters(params, [binding.asset, binding.quoteAuthority,
    factoryBinding.catalogAuthority, factoryBinding.issuerAuthority, factoryBinding.operatorAuthority,
    registration.storeId, registration.owner, [[Object.values(t), true]],
  ]));
  assert.equal(w.registrationConfigHash({ binding: factoryBinding, storeId: registration.storeId, owner: registration.owner, catalog }), expected);
  const typed = w.prepareRegistrationTypedData({ binding: factoryBinding, wallet: ownerWallet, registration, catalog, now: 100n });
  assert.deepEqual(typed.domain, { name: 'MealForward Store Registration', version: '1', chainId: 10143, verifyingContract: factoryBinding.factory });
  assert.deepEqual(typed.types.Registration.map(x => `${x.name}:${x.type}`), ['registrationId:bytes32', 'storeId:bytes32', 'owner:address', 'configHash:bytes32', 'deadline:uint256']);
  assert.equal(typed.message.configHash, expected);
  assert.equal(w.registrationDigest(typed), hashTypedData(typed));
  assert.notEqual(hashTypedData(typed), hashTypedData({ ...typed, message: { ...typed.message, deadline: 201n } }));
  const tx = w.prepareCreateStore({ binding: factoryBinding, registrar: { chainId: 10143, account: factoryBinding.registrar }, registration, catalog, ownerSignature: '0x1234', now: 100n });
  const decoded = w.decodeOriginalCall({ kind: 'registration', data: tx.data });
  assert.deepEqual(decoded.args, [typed.message, catalog.map(e => ({ terms: { ...e.terms, windowCount: 1, startMinute0: 660, endMinute0: 840, startMinute1: 0, endMinute1: 0 }, current: true })), '0x1234', w.compiledStoreEscrowCreationCode]);
  assert.equal(tx.from, factoryBinding.registrar);
  assert.equal(tx.to, factoryBinding.factory);
  assert.equal(tx.correlation.authorizationDigest, hashTypedData(typed));
});

test('registration rejects owner acting as registrar, mismatched hash and empty/invalid catalogs', () => {
  assert.throws(() => w.prepareCreateStore({ binding: factoryBinding, registrar: ownerWallet, registration, catalog, ownerSignature: '0x1234', now: 100n }), /account binding/);
  assert.throws(() => w.prepareRegistrationTypedData({ binding: factoryBinding, wallet: ownerWallet, registration: { ...registration, configHash: id(99) }, catalog, now: 100n }), /configHash binding/);
  assert.throws(() => w.prepareRegistrationTypedData({ binding: factoryBinding, wallet: ownerWallet, registration, catalog: [], now: 100n }), /catalog/);
  assert.throws(() => w.registrationConfigHash({ binding: factoryBinding, storeId: registration.storeId, owner: registration.owner, catalog: [{ ...catalog[0], terms: { ...catalog[0].terms, startMinute1: 1n } }] }), /catalog windows/);
});

test('event/state decoding and receipt observations cannot declare final success', () => {
  const prepared = w.prepareSettle({ binding, wallet: ownerWallet, opId: id(9), voucherId: id(10), generation: 1n });
  const hash = id(100);
  const log = { address: binding.escrow,
    topics: encodeEventTopics({ abi: w.storeEscrowAbi, eventName: 'Settled', args: { voucherId: id(10), receiver: binding.owner } }),
    data: encodeAbiParameters(parseAbiParameters('bytes32,uint256'), [id(9), 100n]),
  };
  const event = w.decodeEscrowEvent({ escrow: binding.escrow, log });
  assert.equal(event.eventName, 'Settled');
  assert.equal(event.args.amount, 100n);
  assert.throws(() => w.decodeEscrowEvent({ escrow: addr(99), log }), /escrow binding/);
  const operation = { kind: 9, caller: binding.owner, payloadHash: id(20), result: id(100), executedAt: 150n };
  const result = encodeFunctionResult({ abi: w.storeEscrowAbi, functionName: 'getOperation', result: operation });
  assert.deepEqual(w.decodeEscrowState({ functionName: 'getOperation', data: result }).value, operation);
  const pending = w.observeOriginalReceipt({ prepared, transactionHash: hash });
  assert.equal(pending.status, 'PENDING');
  assert.equal(pending.backendFinalVerification, 'NOT_CONNECTED');
  const observedTransaction = { chainId: 10143, from: prepared.from, to: prepared.to, value: 0n, input: prepared.data, hash };
  const receipt = { transactionHash: hash, from: prepared.from, to: prepared.to, status: 'success', logs: [log] };
  const mined = w.observeOriginalReceipt({ prepared, observedTransaction, transactionHash: hash, receipt });
  assert.equal(mined.status, 'MINED_UNVERIFIED');
  assert.equal(mined.authority, 'OBSERVATION_ONLY');
  assert.equal(mined.events[0].eventName, 'Settled');
  assert.equal(w.observeOriginalReceipt({ prepared, transactionHash: hash, receipt: { ...receipt, status: 'reverted' } }).status, 'REVERTED_OBSERVED');
  assert.throws(() => w.observeOriginalReceipt({ prepared, transactionHash: hash, receipt: { ...receipt, transactionHash: id(101) } }), /hash binding/);
  assert.throws(() => w.matchOriginalTransaction({ prepared, observed: { ...observedTransaction, input: '0x1234' } }), /calldata/);
});


test('fixed creation code rejects altered bytes, constructor tails and untrusted pins', () => {
  const actual = JSON.parse(readFileSync(new URL('../onboarding-contracts/abi/StoreEscrow.creationCode.json', import.meta.url)));
  assert.equal(w.compiledStoreEscrowCreationCode, actual.bytecode);
  assert.equal(w.compiledStoreEscrowCreationCodeHash, keccak256(actual.bytecode));
  assert.equal(w.validateEscrowCreationCode({ binding: factoryBinding }), actual.bytecode);
  const args = { binding: factoryBinding, registrar: { chainId: 10143, account: factoryBinding.registrar }, registration, catalog, ownerSignature: '0x1234', now: 100n };
  for (const escrowCreationCode of ['0x1234', `${w.compiledStoreEscrowCreationCode}00`]) {
    assert.throws(() => w.validateEscrowCreationCode({ binding: factoryBinding, escrowCreationCode }), /creation code binding/);
    assert.throws(() => w.prepareCreateStore({ ...args, escrowCreationCode }), /caller escrowCreationCode/);
  }
  assert.throws(() => w.prepareCreateStore({ ...args, binding: { ...factoryBinding, escrowCreationCodeHash: id(99) } }), /creation code binding/);
  assert.throws(() => w.prepareCreateStore({ ...args, binding: { ...factoryBinding, escrowCreationCodeHash: undefined } }), /escrowCreationCodeHash/);
  assert.equal(w.prepareCreateStore(args).value, 0n);
});

test('four-argument factory ABI and codehash getter exactly match compiled candidate', () => {
  const actual = JSON.parse(readFileSync(new URL('../onboarding-contracts/abi/RegistrationFactory.json', import.meta.url)));
  for (const entry of w.registrationFactoryAbi) {
    assert.deepEqual(entry, actual.find(e => e.type === entry.type && e.name === entry.name));
  }
  const args = { binding: factoryBinding, registrar: { chainId: 10143, account: factoryBinding.registrar }, registration, catalog, ownerSignature: '0x1234', now: 100n };
  const tx = w.prepareCreateStore(args);
  const decoded = w.decodeOriginalCall({ kind: 'registration', data: tx.data });
  assert.equal(tx.data.slice(0, 10), '0xed89c3b2');
  assert.equal(decoded.args.length, 4);
  assert.equal(decoded.args[3], w.compiledStoreEscrowCreationCode);
  const getterData = encodeFunctionResult({ abi: w.registrationFactoryAbi, functionName: 'escrowCreationCodeHash', result: w.compiledStoreEscrowCreationCodeHash });
  assert.equal(getterData, w.compiledStoreEscrowCreationCodeHash);
});
