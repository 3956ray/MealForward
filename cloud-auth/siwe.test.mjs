import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes, randomUUID} from 'node:crypto';
import {generatePrivateKey, privateKeyToAccount} from 'viem/accounts';
import {makeChallenge, verifyChallenge} from './siwe.mjs';

// Uses the pinned real viem implementation, not a mocked SIWE builder.
// Ephemeral test keys never leave process memory.
const origin='https://mealforward-cp31-auth-laodao.onrender.com';
function fixture(wallet){
  const now=Math.floor(Date.now()/1000);
  return {wallet,origin,chainId:10143,nonce:randomBytes(32).toString('hex'),
    challengeId:randomUUID(),issuedAt:now,expiresAt:now+180};
}
test('standard crypto.randomUUID SIWE challenge can be constructed',()=>{
  const account=privateKeyToAccount(generatePrivateKey());
  const ch=makeChallenge(fixture(account.address.toLowerCase()));
  assert.match(ch.challengeId,/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.ok(ch.message.includes('Request ID: '+ch.challengeId));
  assert.equal(ch.uri,origin);
});
test('ephemeral EIP-191 signature verifies, foreign signer rejected',async()=>{
  const a=privateKeyToAccount(generatePrivateKey());
  const b=privateKeyToAccount(generatePrivateKey());
  const ch=makeChallenge(fixture(a.address.toLowerCase()));
  const sig=await a.signMessage({message:ch.message});
  assert.equal(await verifyChallenge(ch,sig,ch.issuedAt),a.address.toLowerCase());
  const foreign=await b.signMessage({message:ch.message});
  await assert.rejects(verifyChallenge(ch,foreign,ch.issuedAt),/WALLET_LOGIN_REJECTED/);
});
test('malformed 8-4-4-12 UUID cannot create a SIWE challenge',()=>{
  const a=privateKeyToAccount(generatePrivateKey());
  const wrong=fixture(a.address.toLowerCase());
  wrong.challengeId='11111111-1111-1111-111111111111';
  assert.throws(()=>makeChallenge(wrong),/INVALID_CHALLENGE_CONFIG/);
});
