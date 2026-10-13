// Pure canonical EIP1559 inspection/preparation; no client, keys, RPC or signing implementation.
import { keccak256, parseTransaction, recoverTransactionAddress, serializeTransaction } from 'viem';
import { secp256k1 } from '@noble/curves/secp256k1';
import { readSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const uint256Max = (1n << 256n) - 1n;
const fields = ['chainId', 'from', 'to', 'value', 'data', 'nonce', 'gas', 'maxFeePerGas', 'maxPriorityFeePerGas', 'type'];

function reject() { throw Error('SIGNED_TRANSACTION_REJECTED'); }
function uint(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value) || value.length > 78) reject();
  const n = BigInt(value);
  if (n > uint256Max) reject();
  return n;
}
function address(value) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value) || BigInt(value) === 0n) reject();
  return value.toLowerCase();
}
function hex(value) {
  if (typeof value !== 'string' || value.length > 131072 || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) reject();
  return value.toLowerCase();
}
function keys(value, names) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...names].sort().join(',');
}

function expectedEnvelope(expected) {
  if (!keys(expected, [...fields, 'gasBudgetWei']) || expected.type !== 'eip1559'
    || !Number.isSafeInteger(expected.chainId) || expected.chainId <= 0 || expected.value !== '0') reject();
  const nonce = uint(expected.nonce), gas = uint(expected.gas), fee = uint(expected.maxFeePerGas);
  const priority = uint(expected.maxPriorityFeePerGas), budget = uint(expected.gasBudgetWei);
  if (nonce > BigInt(Number.MAX_SAFE_INTEGER) || gas === 0n || fee === 0n || priority > fee
    || gas * fee > budget) reject();
  return { type: 'eip1559', chainId: expected.chainId, from: address(expected.from), to: address(expected.to),
    value: '0', data: hex(expected.data), nonce: nonce.toString(), gas: gas.toString(),
    maxFeePerGas: fee.toString(), maxPriorityFeePerGas: priority.toString(), gasBudgetWei: budget.toString() };
}

export function prepare_original_envelope(descriptor, approvedPlan) {
  try {
    if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)
      || !keys(approvedPlan, ['type', 'nonce', 'gas', 'maxFeePerGas', 'maxPriorityFeePerGas', 'gasBudgetWei'])
      || (descriptor.type !== undefined && descriptor.type !== 'eip1559')) reject();
    const envelope = expectedEnvelope({ ...Object.fromEntries(['chainId', 'from', 'to', 'value', 'data']
      .map(name => [name, descriptor[name]])), ...approvedPlan });
    if (descriptor.callDataDigest !== undefined && descriptor.callDataDigest !== keccak256(envelope.data)) reject();
    return envelope;
  } catch { reject(); }
}

export async function inspect_signed_transaction(raw, expected) {
  try {
    const approved = expectedEnvelope(expected);
    const bytes = hex(raw);
    if (!bytes.startsWith('0x02')) reject();
    const tx = parseTransaction(bytes);
    if (tx.type !== 'eip1559' || tx.r === undefined || tx.s === undefined
      || (tx.yParity !== 0 && tx.yParity !== 1)
      || (tx.accessList !== undefined && tx.accessList.length !== 0)) reject();
    // Installed viem dependency validates scalar range/low-S; no hand-written curve arithmetic.
    const signature = new secp256k1.Signature(BigInt(tx.r), BigInt(tx.s));
    if (signature.hasHighS()) reject();
    // Round-trip with installed viem rejects nonminimal RLP/integer encodings and trailing bytes.
    if (serializeTransaction(tx).toLowerCase() !== bytes) reject();
    const from = address(await recoverTransactionAddress({ serializedTransaction: bytes }));
    const result = { hash: keccak256(bytes), chainId: tx.chainId, from, to: address(tx.to),
      value: (tx.value ?? 0n).toString(), data: hex(tx.data ?? '0x'), nonce: String(tx.nonce),
      gas: (tx.gas ?? 0n).toString(), maxFeePerGas: (tx.maxFeePerGas ?? 0n).toString(),
      maxPriorityFeePerGas: (tx.maxPriorityFeePerGas ?? 0n).toString(), type: tx.type };
    if (fields.some(name => result[name] !== approved[name])) reject();
    if (uint(result.gas) * uint(result.maxFeePerGas) > uint(approved.gasBudgetWei)) reject();
    return result;
  } catch { reject(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const chunks = [], buffer = Buffer.alloc(8192);
    let total = 0, count;
    while ((count = readSync(0, buffer, 0, buffer.length, null)) !== 0) {
      total += count;
      if (total > 131072) reject();
      chunks.push(Buffer.from(buffer.subarray(0, count)));
    }
    const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!keys(request, ['method', 'parameters'])) reject();
    let value;
    if (request.method === 'prepare_original_envelope' && keys(request.parameters, ['descriptor', 'approvedPlan'])) {
      value = prepare_original_envelope(request.parameters.descriptor, request.parameters.approvedPlan);
    } else if (request.method === 'inspect_signed_transaction' && keys(request.parameters, ['raw', 'expected'])) {
      value = await inspect_signed_transaction(request.parameters.raw, request.parameters.expected);
    } else reject();
    const output = JSON.stringify(value);
    if (Buffer.byteLength(output) > 131072) reject();
    process.stdout.write(output);
  } catch {
    // Do not expose transaction/raw/signature/library error context.
    process.stdout.write(JSON.stringify({ error: 'SIGNED_TRANSACTION_REJECTED' }));
    process.exitCode = 1;
  }
}
