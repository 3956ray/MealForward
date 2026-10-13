// Pure SIWE/EIP-191 EOA login. No provider, signing, nonce generation or storage.
import { createSiweMessage } from 'viem/siwe';
import { getAddress, recoverMessageAddress } from 'viem';
import { pathToFileURL } from 'node:url';

export const LOGIN_STATEMENT = 'Sign in to MealForward with your test wallet.';
const MAX_TIMESTAMP = 253402300799;
const challengeKeys = ['challengeId', 'address', 'chainId', 'nonce', 'domain', 'uri', 'issuedAt', 'expiresAt', 'message'];
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const timestamp = (value) => Number.isSafeInteger(value) && value > 0 && value <= MAX_TIMESTAMP;

export function buildWalletLoginChallenge(parameters) {
  if (!exact(parameters, ['wallet', 'origin', 'chainId', 'nonce', 'challengeId', 'issuedAt', 'expiresAt'])) throw Error();
  const { wallet, origin, chainId, nonce, challengeId, issuedAt, expiresAt } = parameters;
  const originMatch = typeof origin === 'string' && /^https:\/\/(?:localhost|127\.0\.0\.1):([1-9][0-9]{3,4})$/.exec(origin);
  if (!originMatch || Number(originMatch[1]) < 1024 || Number(originMatch[1]) > 65535
    || chainId !== 10143 || typeof wallet !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(wallet)
    || typeof nonce !== 'string' || !/^[0-9a-f]{64}$/.test(nonce)
    || typeof challengeId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(challengeId)
    || !timestamp(issuedAt) || !timestamp(expiresAt) || expiresAt <= issuedAt || expiresAt - issuedAt > 300) throw Error();
  const address = getAddress(wallet);
  const domain = origin.slice('https://'.length);
  const message = createSiweMessage({
    address, chainId, domain, nonce, uri: origin, version: '1',
    statement: LOGIN_STATEMENT, requestId: challengeId,
    issuedAt: new Date(issuedAt * 1000), expirationTime: new Date(expiresAt * 1000),
  });
  return { challengeId, address: address.toLowerCase(), chainId, nonce, domain,
    uri: origin, issuedAt, expiresAt, message };
}

export async function verifyWalletLoginSignature(challenge, signature, now) {
  if (!exact(challenge, challengeKeys) || typeof signature !== 'string'
    || !/^0x[0-9a-fA-F]{130}$/.test(signature) || !timestamp(now)
    || now < challenge.issuedAt || now >= challenge.expiresAt) throw Error();
  const rebuilt = buildWalletLoginChallenge({
    wallet: challenge.address, origin: challenge.uri, chainId: challenge.chainId,
    nonce: challenge.nonce, challengeId: challenge.challengeId,
    issuedAt: challenge.issuedAt, expiresAt: challenge.expiresAt,
  });
  if (challengeKeys.some((key) => challenge[key] !== rebuilt[key])) throw Error();
  const recovered = (await recoverMessageAddress({ message: rebuilt.message, signature })).toLowerCase();
  if (recovered !== rebuilt.address) throw Error();
  return recovered;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > 32768 || chunk.some((byte) => byte > 127)) throw Error();
      chunks.push(chunk);
    }
    const input = JSON.parse(Buffer.concat(chunks).toString('ascii'));
    if (!exact(input, ['method', 'parameters'])) throw Error();
    if (input.method === 'build') {
      process.stdout.write(JSON.stringify({ challenge: buildWalletLoginChallenge(input.parameters) }));
    } else if (input.method === 'verify' && exact(input.parameters, ['challenge', 'signature', 'now'])) {
      const { challenge, signature, now } = input.parameters;
      process.stdout.write(JSON.stringify({ address: await verifyWalletLoginSignature(challenge, signature, now) }));
    } else throw Error();
  } catch {
    process.stdout.write(JSON.stringify({ error: 'WALLET_LOGIN_REJECTED' }));
    process.exitCode = 1;
  }
}
