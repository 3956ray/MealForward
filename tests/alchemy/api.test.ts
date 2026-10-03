import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkTestnet, CheckFailure } from '../../alchemy-harness/api.ts'

const valid = { chainId: 10143, network: 'Monad Testnet', latestBlock: '1234567890123456789012345', checkedAt: '2026-10-03T00:00:00Z', contractConnected: false }
test('request is exact read-only same-origin body with no credentials and whitelisted response', async () => {
  const original = globalThis.fetch
  const signal = new AbortController().signal
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/v1/testnet/status')
    assert.equal(options?.method, 'POST'); assert.equal(options?.body, '{}')
    assert.equal(options?.credentials, 'omit'); assert.equal(options?.signal, signal)
    assert.equal(options?.redirect, 'error')
    return new Response(JSON.stringify({ ...valid, private: 'DO_NOT_EXPOSE' }))
  }
  try { assert.deepEqual(await checkTestnet(signal), valid) } finally { globalThis.fetch = original }
})
test('malformed/wrong-chain success and raw upstream error never become successful UI data', async () => {
  const original = globalThis.fetch
  try {
    for (const body of [{...valid, chainId: 143}, {...valid, latestBlock: 1}, {...valid, checkedAt: 'yesterday'}, {...valid, contractConnected: true}, {...valid, contractConnected: undefined, contractDeployed: false}, null]) {
      globalThis.fetch = async () => new Response(JSON.stringify(body))
      await assert.rejects(checkTestnet(new AbortController().signal), CheckFailure)
    }
    globalThis.fetch = async () => new Response(JSON.stringify({error:{code:'UPSTREAM_RATE_LIMITED', message:'SECRET'}}), {status:503})
    await assert.rejects(checkTestnet(new AbortController().signal), error => error instanceof CheckFailure && !error.message.includes('SECRET') && error.message.includes('限流'))
  } finally { globalThis.fetch = original }
})
