import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, hashTypedData, keccak256, recoverTypedDataAddress } from 'viem';
import { registrationCodec } from './registration-codec.mjs';
import { registrationConfigHash, prepareRegistrationTypedData, registrationFactoryAbi,
  compiledStoreEscrowCreationCode, compiledStoreEscrowCreationCodeHash } from '../wallet/index.mjs';

const w = n => '0x' + n.toString(16).padStart(64, '0');
const a = n => '0x' + n.toString(16).padStart(40, '0');
function fixture() {
  return { op: 'prepare', now: '100', original: {
    chainId: '31337', factory: a(20), registrar: a(26), asset: a(21), quoteAuthority: a(22),
    catalogAuthority: a(23), issuerAuthority: a(24), operatorAuthority: a(25),
    escrowCreationCodeHash: compiledStoreEscrowCreationCodeHash,
    registrationId: w(1), storeId: w(2), owner: a(10), deadline: '200',
    catalog: [{ current: true, terms: { mealId: w(60), version: '1', unitPrice: '1',
      bodyDigest: w(61), imageDigest: w(62), windowCount: 1, startMinute0: 600,
      endMinute0: 720, startMinute1: 0, endMinute1: 0 } }],
  } };
}

test('JSON prepare matches original wallet config and complete EIP712 digest including deadline', async () => {
  const request = fixture(), original = request.original;
  const catalog = original.catalog.map(entry => ({ current: entry.current,
    terms: Object.fromEntries(Object.entries(entry.terms).map(([k, v]) => [k, String(v)])) }));
  const binding = { ...original, chainId: 31337 };
  const configHash = registrationConfigHash({ binding, storeId: original.storeId, owner: original.owner, catalog });
  const typedData = prepareRegistrationTypedData({ binding,
    wallet: { chainId: 31337, account: original.owner }, registration: original, catalog, now: '100' });
  const prepared = await registrationCodec(request);
  assert.equal(prepared.configHash, configHash);
  assert.equal(prepared.parametersDigest, hashTypedData(typedData));
  request.original.deadline = '201';
  assert.notEqual((await registrationCodec(request)).parametersDigest, prepared.parametersDigest);
});

test('deployment binds original four-argument payload and wallet-owned pinned creation code only', async () => {
  const request = { ...fixture(), op: 'deployment', signature: '0x1234' };
  const result = await registrationCodec(request);
  const decoded = decodeFunctionData({ abi: registrationFactoryAbi, data: result.data });
  assert.equal(decoded.functionName, 'createStore');
  assert.equal(decoded.args.length, 4);
  assert.equal(decoded.args[3], compiledStoreEscrowCreationCode);
  assert.equal(keccak256(decoded.args[3]), request.original.escrowCreationCodeHash);
  assert.equal(result.callDataDigest, keccak256(result.data));
  assert.equal(result.from, request.original.registrar);
  assert.equal(result.to, request.original.factory);
  assert.equal(result.value, '0');
  await assert.rejects(registrationCodec({ ...request, escrowCreationCode: compiledStoreEscrowCreationCode + '00' }));
  request.original.escrowCreationCodeHash = w(99);
  await assert.rejects(registrationCodec(request));
});

test('EOA path uses pure viem recovery, rejects wrong owner and factory-incompatible signature shape', async () => {
  // Arbitrary synthetic signature bytes, no signer or private key; expected to recover a different owner.
  const signature = '0x' + '1'.padStart(64, '0') + '1'.padStart(64, '0') + '1b';
  const request = { ...fixture(), op: 'verifyEOA', signature };
  const prepared = await registrationCodec({ ...request, op: 'prepare' });
  const result = await registrationCodec(request);
  const recovered = await recoverTypedDataAddress({ ...prepared.typedData, signature });
  assert.equal(result.recoveredAddress, recovered.toLowerCase());
  assert.equal(result.valid, false);
  assert.equal((await registrationCodec({ ...request, signature: '0x1234' })).valid, false);
});
