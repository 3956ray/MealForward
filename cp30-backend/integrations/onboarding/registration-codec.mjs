// One-shot JSON codec only. No clients, accounts, signing, RPC or ambient config.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { hashTypedData, keccak256, recoverTypedDataAddress } from 'viem';
import {
  registrationConfigHash, prepareRegistrationTypedData, prepareCreateStore,
  validateEscrowCreationCode,
} from '../wallet/index.mjs';

const limit = 262144;
const bindingFields = ['factory', 'registrar', 'asset', 'quoteAuthority', 'catalogAuthority',
  'issuerAuthority', 'operatorAuthority'];

function material(request) {
  const original = request.original;
  if (!original || typeof original !== 'object') throw Error('ORIGINAL_REQUIRED');
  if (typeof original.chainId !== 'string' || !/^[1-9][0-9]*$/.test(original.chainId)) throw Error('INVALID_CHAIN');
  const chainId = Number(original.chainId);
  if (!Number.isSafeInteger(chainId)) throw Error('INVALID_CHAIN');
  if (Object.hasOwn(request, 'escrowCreationCode')) throw Error('CALLER_CREATION_CODE_REJECTED');
  const binding = Object.fromEntries(bindingFields.map(name => [name, original[name]]));
  Object.assign(binding, { chainId, escrowCreationCodeHash: original.escrowCreationCodeHash });
  validateEscrowCreationCode({ binding });  // Wallet-owned constant from the exact factory build only.
  const catalog = original.catalog.map(entry => ({ current: entry.current,
    terms: Object.fromEntries(Object.entries(entry.terms).map(([key, value]) =>
      [key, typeof value === 'number' ? String(value) : value])) }));
  const registration = Object.fromEntries(['registrationId', 'storeId', 'owner', 'deadline']
    .map(name => [name, original[name]]));
  const configHash = registrationConfigHash({ binding, storeId: original.storeId, owner: original.owner, catalog });
  registration.configHash = configHash;
  const typedData = prepareRegistrationTypedData({ binding,
    wallet: { chainId, account: original.owner }, registration, catalog, now: request.now });
  return { binding, catalog, registration, configHash, typedData };
}

export async function registrationCodec(request) {
  if (!request || !['prepare', 'verifyEOA', 'deployment'].includes(request.op)) throw Error('INVALID_OPERATION');
  if (Object.keys(request).some(key => !['op', 'original', 'now', 'signature'].includes(key))) throw Error('INVALID_REQUEST');
  const value = material(request);
  if (request.op === 'prepare') return { configHash: value.configHash,
    parametersDigest: hashTypedData(value.typedData), typedData: value.typedData };
  if (request.op === 'verifyEOA') {
    // Only the trusted server binding resolver may select this EOA path.
    // Restrict to the OpenZeppelin ECDSA bytes-signature shape accepted by the factory.
    if (typeof request.signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(request.signature)) {
      return { valid: false, mode: 'EOA_RECOVERY' };
    }
    const v = Number.parseInt(request.signature.slice(-2), 16);
    const s = BigInt('0x' + request.signature.slice(66, 130));
    if (![27, 28].includes(v) || s > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n) {
      return { valid: false, mode: 'EOA_RECOVERY' };
    }
    try {
      const recoveredAddress = await recoverTypedDataAddress({ ...value.typedData, signature: request.signature });
      return { valid: recoveredAddress.toLowerCase() === request.original.owner,
        recoveredAddress: recoveredAddress.toLowerCase(), mode: 'EOA_RECOVERY' };
    } catch { return { valid: false, mode: 'EOA_RECOVERY' }; }
  }
  const prepared = prepareCreateStore({ ...value,
    registrar: { chainId: value.binding.chainId, account: value.binding.registrar },
    ownerSignature: request.signature, now: request.now });
  // Retain exact bytes before any submission. No owner-signature verification or chain authority implied here.
  return { chainId: prepared.chainId, from: prepared.from.toLowerCase(), to: prepared.to.toLowerCase(),
    value: String(prepared.value), data: prepared.data, callDataDigest: keccak256(prepared.data) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const raw = readFileSync(0);
    if (raw.length > limit) throw Error('CODEC_INPUT_LIMIT');
    const result = await registrationCodec(JSON.parse(raw));
    const output = JSON.stringify(result, (_, value) => typeof value === 'bigint' ? value.toString() : value);
    if (Buffer.byteLength(output) > 1048576) throw Error('CODEC_OUTPUT_LIMIT');
    process.stdout.write(output);
  } catch {
    process.stdout.write(JSON.stringify({ error: 'REGISTRATION_CODEC_REJECTED' }));
    process.exitCode = 1;
  }
}
