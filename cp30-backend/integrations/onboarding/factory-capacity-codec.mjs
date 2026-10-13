/** Pure ABI/template codec: stdin/stdout only, no provider or signing. */
import { decodeFunctionResult, encodeFunctionData, encodeFunctionResult, getAddress } from 'viem';
import { observerFactoryAbi, verifyRuntimeTemplate } from '../wallet/registration-observer.mjs';

export const getterNames = Object.freeze(['registrar', 'asset', 'quoteAuthority', 'catalogAuthority',
  'issuerAuthority', 'operatorAuthority', 'escrowCreationCodeHash', 'storeCount']);
const keys = (value, expected) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join() !== [...expected].sort().join()) throw Error('INVALID');
};
export function capacityCodec(packet) {
  if (packet.op === 'prepare') {
    keys(packet, ['op']);
    return { calls: getterNames.map(functionName => ({ functionName,
      data: encodeFunctionData({ abi: observerFactoryAbi, functionName }) })) };
  }
  keys(packet, ['op', 'code', 'results', 'templatePin']);
  if (packet.op !== 'verify') throw Error('INVALID');
  verifyRuntimeTemplate(packet.code, 'factory', packet.templatePin);
  keys(packet.results, getterNames);
  const result = {};
  for (const functionName of getterNames) {
    const data = packet.results[functionName];
    if (typeof data !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(data)) throw Error('INVALID');
    const decoded = decodeFunctionResult({ abi: observerFactoryAbi, functionName, data });
    if (encodeFunctionResult({ abi: observerFactoryAbi, functionName, result: decoded }).toLowerCase() !== data.toLowerCase()) throw Error('INVALID');
    if (functionName === 'storeCount') {
      if (decoded < 0n || decoded > 3n) throw Error('INVALID');
      result.count = Number(decoded);
    } else result[functionName] = functionName === 'escrowCreationCodeHash'
      ? decoded.toLowerCase() : getAddress(decoded).toLowerCase();
  }
  return result;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    let size = 0; const chunks = [];
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > 262144) throw Error('LIMIT');
      chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    if (!/^[\x20-\x7e\r\n\t]*$/.test(text)) throw Error('INVALID');
    process.stdout.write(JSON.stringify(capacityCodec(JSON.parse(text))));
  } catch {
    process.stdout.write('{"error":"FACTORY_CAPACITY_CODEC_REJECTED"}');
    process.exitCode = 1;
  }
}
