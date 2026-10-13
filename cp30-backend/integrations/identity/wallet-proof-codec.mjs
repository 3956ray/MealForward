import { recoverTypedDataAddress, keccak256, stringToHex } from 'viem';
import { pathToFileURL } from 'node:url';

export const walletControlTypes = {
  WalletControl: [
    { name: 'challengeId', type: 'bytes32' }, { name: 'nonce', type: 'bytes32' },
    { name: 'wallet', type: 'address' }, { name: 'backendOriginHash', type: 'bytes32' },
    { name: 'namespaceHash', type: 'bytes32' }, { name: 'sessionHash', type: 'bytes32' },
    { name: 'subjectHash', type: 'bytes32' }, { name: 'deadline', type: 'uint256' },
  ],
};

export function proofContextHashes(backendOrigin, namespace) {
  // Main supplies exact approved origin/namespace strings, never request Host or arbitrary client fields.
  if (typeof backendOrigin !== 'string' || !backendOrigin || typeof namespace !== 'string' || !namespace) throw Error('Rejected');
  return { backend_origin_hash: keccak256(stringToHex(backendOrigin)), namespace_hash: keccak256(stringToHex(namespace)) };
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

export async function recoverWalletProof(typedData, signature) {
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)
    || typedData?.primaryType !== 'WalletControl'
    || JSON.stringify(typedData.types) !== JSON.stringify(walletControlTypes)
    || !exactKeys(typedData.domain, ['name', 'version', 'chainId', 'verifyingContract'])
    || !exactKeys(typedData.message, walletControlTypes.WalletControl.map(({ name }) => name))) throw Error('Rejected');
  const { domain, message } = typedData;
  if (typeof domain.name !== 'string' || !domain.name || typeof domain.version !== 'string' || !domain.version
    || !Number.isSafeInteger(domain.chainId) || domain.chainId <= 0
    || !/^0x[0-9a-fA-F]{40}$/.test(domain.verifyingContract)
    || !/^0x[0-9a-fA-F]{40}$/.test(message.wallet)
    || !Number.isSafeInteger(message.deadline) || message.deadline <= 0
    || walletControlTypes.WalletControl.filter(({ type }) => type === 'bytes32')
      .some(({ name }) => !/^0x[0-9a-fA-F]{64}$/.test(message[name]))) throw Error('Rejected');
  return (await recoverTypedDataAddress({ ...typedData, signature })).toLowerCase();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
      if (input.length > 16384) throw Error('Rejected');
    }
    const { typed_data, signature } = JSON.parse(input);
    const wallet = await recoverWalletProof(typed_data, signature);
    process.stdout.write(JSON.stringify({ wallet }));
  } catch {
    process.stdout.write(JSON.stringify({ error: 'WALLET_PROOF_REJECTED' }));
    process.exitCode = 1;
  }
}
