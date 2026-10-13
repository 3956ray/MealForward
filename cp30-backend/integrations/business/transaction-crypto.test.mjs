import assert from 'node:assert/strict';
import test from 'node:test';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { concatHex, fromRlp, keccak256, parseTransaction, serializeTransaction, toRlp } from 'viem';
import { secp256k1 } from '@noble/curves/secp256k1';
import { inspect_signed_transaction, prepare_original_envelope } from './transaction-crypto.mjs';

async function syntheticFixture() {
  // New temporary synthetic memory key only. It is never returned, logged, retained or read from a file.
  const account = privateKeyToAccount(generatePrivateKey());
  const descriptor = { chainId: 31337, from: account.address.toLowerCase(), to: `0x${'1'.repeat(40)}`,
    value: '0', data: '0x1234', callDataDigest: keccak256('0x1234') };
  const approvedPlan = { type: 'eip1559', nonce: '0', gas: '50000', maxFeePerGas: '2',
    maxPriorityFeePerGas: '1', gasBudgetWei: '100000' };
  const expected = prepare_original_envelope(descriptor, approvedPlan);
  const transaction = { type: 'eip1559', chainId: 31337, to: descriptor.to, value: 0n, data: descriptor.data,
    nonce: 0, gas: 50000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n };
  const raw = await account.signTransaction(transaction);
  return { account, descriptor, approvedPlan, expected, transaction, raw };
}

if (process.argv[2] === '--temporary-memory-fixture') {
  try {
    const { descriptor, approvedPlan, expected, raw } = await syntheticFixture();
    // Captured only by the Python check in a private memory pipe. Never saved to evidence/logs.
    process.stdout.write(JSON.stringify({ descriptor, approvedPlan, expected, raw }));
  } catch {
    process.stdout.write(JSON.stringify({ error: 'SYNTHETIC_FIXTURE_REJECTED' }));
    process.exitCode = 1;
  }
} else {
  test('actual EIP1559 decode/recovery/keccak and approved envelope', async () => {
    const fixture = await syntheticFixture();
    const observed = await inspect_signed_transaction(fixture.raw, fixture.expected);
    assert.equal(observed.hash, keccak256(fixture.raw));
    for (const key of Object.keys(observed).filter(key => key !== 'hash')) {
      assert.equal(observed[key], fixture.expected[key]);
    }
    assert.throws(() => prepare_original_envelope(fixture.descriptor,
      { ...fixture.approvedPlan, gasBudgetWei: '99999' }), /SIGNED_TRANSACTION_REJECTED/);
    assert.throws(() => prepare_original_envelope(fixture.descriptor,
      { ...fixture.approvedPlan, nonce: '00' }), /SIGNED_TRANSACTION_REJECTED/);
  });

  test('signed original payload changes are rejected in every approved field', async () => {
    const fixture = await syntheticFixture();
    for (const [field, value] of Object.entries({ chainId: 31338, to: `0x${'2'.repeat(40)}`, value: 1n,
      data: '0x1235', nonce: 1, gas: 50001n, maxFeePerGas: 3n, maxPriorityFeePerGas: 2n })) {
      const different = await fixture.account.signTransaction({ ...fixture.transaction, [field]: value });
      await assert.rejects(inspect_signed_transaction(different, fixture.expected), /SIGNED_TRANSACTION_REJECTED/);
    }
    await assert.rejects(inspect_signed_transaction(fixture.raw,
      { ...fixture.expected, from: `0x${'3'.repeat(40)}` }), /SIGNED_TRANSACTION_REJECTED/);
    await assert.rejects(inspect_signed_transaction(fixture.raw,
      { ...fixture.expected, gasBudgetWei: '99999' }), /SIGNED_TRANSACTION_REJECTED/);
  });

  test('unsupported, unsigned, noncanonical, access-list and high-S raws reject', async () => {
    const fixture = await syntheticFixture();
    const fields = fromRlp(`0x${fixture.raw.slice(4)}`, 'hex');
    fields[1] = '0x00'; // Noncanonical zero integer, rebuilt with installed viem RLP helper.
    const noncanonical = concatHex(['0x02', toRlp(fields)]);
    const parsed = parseTransaction(fixture.raw);
    const highS = `0x${(secp256k1.CURVE.n - BigInt(parsed.s)).toString(16).padStart(64, '0')}`;
    const malleated = serializeTransaction({ ...parsed, s: highS, yParity: 1 - parsed.yParity });
    const accessList = await fixture.account.signTransaction({ ...fixture.transaction,
      accessList: [{ address: fixture.descriptor.to, storageKeys: [] }] });
    const legacy = await fixture.account.signTransaction({ type: 'legacy', chainId: 31337, to: fixture.descriptor.to,
      nonce: 0, gas: 50000n, gasPrice: 2n, value: 0n, data: '0x1234' });
    for (const raw of [noncanonical, malleated, accessList, legacy,
      serializeTransaction(fixture.transaction), `${fixture.raw}00`, fixture.raw.slice(0, -2)]) {
      await assert.rejects(inspect_signed_transaction(raw, fixture.expected), /SIGNED_TRANSACTION_REJECTED/);
    }
  });
}
