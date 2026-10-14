// Pure installed-viem codec. No client, provider, keys, signing or network API.
import { encodeFunctionData, decodeFunctionResult, keccak256, serializeTransaction,
  parseTransaction, recoverTransactionAddress } from 'viem';
import { secp256k1 } from '@noble/curves/secp256k1';
import { readSync } from 'node:fs';

const abi = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [
    { name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [
    { name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    outputs: [{ type: 'uint256' }] },
];
function reject() { throw Error('APPROVAL_CODEC_REJECTED'); }
function address(v) {
  if (typeof v !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(v) || BigInt(v) === 0n) reject();
  return v.toLowerCase();
}
function bytes(v, max = 524288) {
  if (typeof v !== 'string' || v.length > max || !/^0x(?:[0-9a-fA-F]{2})*$/.test(v)) reject();
  return v.toLowerCase();
}
function quantity(v) {
  if (typeof v !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(v)
    || v.length > 66) reject();
  return BigInt(v);
}
function safe(v) {
  const n = quantity(v);
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) reject();
  return Number(n);
}
function word(v) { const b = bytes(v, 66); if (b.length !== 66) reject(); return b; }

async function run(method, p) {
  if (method === 'prepare') {
    if (typeof p.amount !== 'string' || !/^[1-9][0-9]{0,77}$/.test(p.amount)
      || BigInt(p.amount) >= 1n << 256n) reject();
    const data = encodeFunctionData({ abi, functionName: 'approve',
      args: [address(p.escrow), BigInt(p.amount)] });
    return { data, callDataDigest: keccak256(data), allowanceData: encodeFunctionData({
      abi, functionName: 'allowance', args: [address(p.payer), address(p.escrow)] }) };
  }
  if (method === 'state') {
    const code = bytes(p.code);
    const result = word(p.allowance);
    if (code === '0x') reject();
    return { assetCodeHash: keccak256(code), allowance: decodeFunctionResult({
      abi, functionName: 'allowance', data: result }).toString() };
  }
  if (method === 'verify') {
    const t = p.transaction, e = p.expected;
    const type = { '0x0': 'legacy', '0x1': 'eip2930', '0x2': 'eip1559' }[t.type];
    if (!type) reject(); // No blob, authorization-list or unprotected legacy approvals.
    const chainId = safe(t.chainId);
    const tx = { type, chainId, nonce: safe(t.nonce), gas: quantity(t.gas),
      to: address(t.to), value: quantity(t.value), data: bytes(t.input),
      ...(type === 'eip1559' ? { maxFeePerGas: quantity(t.maxFeePerGas),
        maxPriorityFeePerGas: quantity(t.maxPriorityFeePerGas) } : { gasPrice: quantity(t.gasPrice) }),
      ...(type === 'legacy' ? {} : { accessList: t.accessList }),
    };
    if (type !== 'legacy' && !Array.isArray(t.accessList)) reject();
    // secp256k1 components may arrive zero-stripped (63 hex) from RPC/wallets; pad canonically.
    const padded = x => { if (typeof x !== 'string' || !/^0x[0-9a-fA-F]{1,64}$/.test(x)) reject(); return '0x' + x.slice(2).toLowerCase().padStart(64, '0'); };
    const r = padded(t.r), s = padded(t.s);
    if (new secp256k1.Signature(BigInt(r), BigInt(s)).hasHighS()) reject();
    let signature;
    if (type === 'legacy') {
      const v = quantity(t.v);
      if (v < 35n || (v - 35n) / 2n !== BigInt(chainId)) reject();
      signature = { r, s, v };
    } else {
      const yParity = safe(t.yParity ?? t.v);
      if ((yParity !== 0 && yParity !== 1)
        || (t.v !== undefined && safe(t.v) !== yParity)) reject();
      signature = { r, s, yParity };
    }
    const raw = serializeTransaction(tx, signature);
    const decoded = parseTransaction(raw);
    const hash = keccak256(raw);
    const from = address(await recoverTransactionAddress({ serializedTransaction: raw }));
    if (hash !== word(e.transactionHash) || hash !== word(t.hash)
      || from !== address(e.from) || from !== address(t.from)
      || address(t.to) !== address(e.to) || chainId !== e.chainId
      || decoded.chainId !== e.chainId || tx.value !== 0n || e.value !== '0'
      || tx.data !== bytes(e.data)) reject();
    return { hash, from, to: tx.to, chainId, value: '0', data: tx.data };
  }
  reject();
}

try {
  const chunks = [], buffer = Buffer.alloc(8192);
  let size = 0, n;
  while ((n = readSync(0, buffer, 0, buffer.length, null))) {
    size += n; if (size > 524288) reject();
    chunks.push(Buffer.from(buffer.subarray(0, n)));
  }
  const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!request || Object.keys(request).sort().join(',') !== 'method,parameters') reject();
  process.stdout.write(JSON.stringify(await run(request.method, request.parameters)));
} catch {
  process.stdout.write('{"error":"APPROVAL_CODEC_REJECTED"}');
  process.exitCode = 1;
}
