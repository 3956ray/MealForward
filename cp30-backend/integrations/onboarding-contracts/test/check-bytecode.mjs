import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { keccak256 } from 'viem';

const scope = fileURLToPath(new URL('../', import.meta.url));
const artifact = JSON.parse(readFileSync(`${scope}out/StoreEscrow.sol/StoreEscrow.json`, 'utf8'));
const metadata = typeof artifact.metadata === 'string' ? JSON.parse(artifact.metadata) : artifact.metadata;
const payload = {
  contract: 'StoreEscrow',
  origin: 'Unchanged accepted source compiled with this RegistrationFactory build; metadata may differ from the historical accepted artifact.',
  bytecode: artifact.bytecode.object,
  keccak256: keccak256(artifact.bytecode.object),
  compiler: metadata.compiler,
  settings: metadata.settings,
};
writeFileSync(`${scope}abi/StoreEscrow.creationCode.json`, `${JSON.stringify(payload, null, 2)}\n`);
console.log(JSON.stringify({ keccak256: payload.keccak256, creationBytes: (payload.bytecode.length - 2) / 2,
  deployedTemplateKeccak256: keccak256(artifact.deployedBytecode.object), compiler: payload.compiler }));
