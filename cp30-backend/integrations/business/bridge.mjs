// Bounded one-shot JSON interface. No RPC, client, wallet or signing implementation.
import { readSync } from 'node:fs';
import { jsonValue, prepareFundingQuote, attachFundingSignature, prepareIssue,
  prepareLock, prepareMarkHandover, prepareReport, prepareRead, decodeRead } from './index.mjs';

const methods = { prepareFundingQuote, attachFundingSignature, prepareIssue, prepareLock,
  prepareMarkHandover, prepareReport, prepareRead, decodeRead };
try {
  const chunks = [], buffer = Buffer.alloc(8192);
  let total = 0, length;
  while ((length = readSync(0, buffer, 0, buffer.length, null)) !== 0) {
    total += length;
    if (total > 131072) throw Error('INPUT_LIMIT');
    chunks.push(Buffer.from(buffer.subarray(0,length)));
  }
  const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!request || Object.keys(request).sort().join(',') !== 'method,parameters'
      || !Object.hasOwn(methods, request.method)) throw Error('UNSUPPORTED_METHOD');
  const result = await methods[request.method](request.parameters);
  const output = JSON.stringify(jsonValue(result));
  if (Buffer.byteLength(output) > 1048576) throw Error('OUTPUT_LIMIT');
  process.stdout.write(output);
} catch {
  process.stdout.write(JSON.stringify({ error: 'BUSINESS_CODEC_REJECTED' }));
  process.exitCode = 1;
}
