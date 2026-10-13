import assert from 'node:assert/strict';
import test from 'node:test';
import { privateKeyToAccount } from 'viem/accounts';
import { proofContextHashes, recoverWalletProof, walletControlTypes } from './wallet-proof-codec.mjs';

// Public deterministic fixture, not a person/account/provider/key file; used only in these offline tests.
const account = privateKeyToAccount(`0x${'0'.repeat(63)}1`);
const word = n => `0x${n.repeat(64)}`;
const context = proofContextHashes('https://public-synthetic.example.test', 'public-synthetic-namespace');
const data = {
  domain: { name: 'Public synthetic wallet proof', version: '1', chainId: 31337, verifyingContract: `0x${'1'.repeat(40)}` },
  primaryType: 'WalletControl', types: walletControlTypes,
  message: { challengeId: word('1'), nonce: word('2'), wallet: account.address.toLowerCase(),
    backendOriginHash: context.backend_origin_hash, namespaceHash: context.namespace_hash,
    sessionHash: word('3'), subjectHash: word('4'), deadline: 200 },
};

if (process.argv[2] === '--public-fixture-sign') {
  // Signature is captured only in a test's in-memory pipe, never written to evidence/logs/files.
  let raw = '';
  for await (const chunk of process.stdin) { raw += chunk; if (raw.length > 16384) throw Error('Rejected'); }
  process.stdout.write(await account.signTypedData(JSON.parse(raw)));
} else {
  test('EOA recovery binds each server challenge and domain field', async () => {
    const signature = await account.signTypedData(data);
    assert.equal(await recoverWalletProof(data, signature), account.address.toLowerCase());
    for (const key of ['name', 'version', 'chainId', 'verifyingContract']) {
      const changed = structuredClone(data);
      changed.domain[key] = key === 'chainId' ? 31338 : key === 'verifyingContract' ? `0x${'2'.repeat(40)}` : `${changed.domain[key]}-other`;
      assert.notEqual(await recoverWalletProof(changed, signature), account.address.toLowerCase());
    }
    for (const { name, type } of walletControlTypes.WalletControl) {
      const changed = structuredClone(data);
      changed.message[name] = type === 'bytes32' ? word('f') : type === 'address' ? `0x${'2'.repeat(40)}` : 201;
      assert.notEqual(await recoverWalletProof(changed, signature), account.address.toLowerCase());
    }
  });
  test('schema additions and unsupported signature lengths reject', async () => {
    const signature = await account.signTypedData(data);
    const changed = structuredClone(data);
    changed.message.role = 'owner';
    await assert.rejects(recoverWalletProof(changed, signature));
    await assert.rejects(recoverWalletProof(data, `0x${'1'.repeat(128)}`));
  });
}
