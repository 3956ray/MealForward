import test from 'node:test'
import assert from 'node:assert/strict'
import {Wallet} from '../../manual-business-harness/wallet.ts'
const account = '0x'+'11'.repeat(20)
function fixture() {
  const calls: string[] = [], apiCalls: string[] = []
  const handlers = new Map<string, (...args: unknown[]) => void>()
  const review = {operationId: 'original', kind: 'fund', maySign: true, configDigest: 'config', expiresAt: Math.floor(Date.now()/1000)+120,
    transaction: {from: account, to: '0x'+'22'.repeat(20), data: '0x12345678', value: 1000000000000000, chainId: 10143, nonce: 0, gas: 50000, maxFeePerGas: 2, maxPriorityFeePerGas: 1}}
  const behavior = {deny: false, started: false, chain: '0x279f', error: false, noHash: false}
  const provider = {on(event: string, fn: (...args: unknown[]) => void) {handlers.set(event, fn)}, removeListener(event: string) {handlers.delete(event)},
    async request({method}: {method: string}) {
      calls.push(method)
      if (method === 'eth_chainId') return behavior.chain
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [account]
      if (method === 'eth_sendTransaction') {if (behavior.error) throw {code: 4001}; return behavior.noHash ? undefined : '0x'+'33'.repeat(32)}
      throw new Error('Unexpected wallet method')
    }}
  const api = async (path: string) => {
    apiCalls.push(path)
    if (path.endsWith('/start')) {
      if (behavior.deny) throw new Error('Runtime not authorized')
      const maySubmit = !behavior.started; behavior.started = true
      return {...review, maySubmit}
    }
    return {}
  }
  return {wallet: new Wallet(provider, api), review, behavior, calls, apiCalls, handlers}
}
test('CP28 runtime denial never calls a signing method', async () => {
  const f = fixture(); f.behavior.deny = true
  await assert.rejects(f.wallet.send(f.review))
  assert.equal(f.calls.includes('eth_sendTransaction'), false)
})
test('CP28 original transaction sends at most once', async () => {
  const f = fixture(); await f.wallet.send(f.review); await assert.rejects(f.wallet.send(f.review))
  assert.equal(f.calls.filter(m => m === 'eth_sendTransaction').length, 1)
})
test('CP28 4001 and no hash retain UNKNOWN and do not re-sign', async () => {
  for (const mode of ['error', 'noHash'] as const) {
    const f = fixture(); f.behavior[mode] = true
    await assert.rejects(f.wallet.send(f.review), /结果未知/)
    await assert.rejects(f.wallet.send(f.review))
    assert.equal(f.calls.filter(m => m === 'eth_sendTransaction').length, 1)
    assert.ok(f.apiCalls.includes('operations/original/unknown'))
  }
})
test('CP28 wrong chain and expired review fail before server signing start', async () => {
  const f = fixture(); f.behavior.chain = '0x7a69'; await assert.rejects(f.wallet.send(f.review))
  assert.equal(f.apiCalls.length, 0)
  f.behavior.chain = '0x279f'; f.review.expiresAt = 0; await assert.rejects(f.wallet.send(f.review))
  assert.equal(f.apiCalls.length, 0)
})
test('CP28 parallel confirmation does not duplicate provider send', async () => {
  const f = fixture(); const results = await Promise.allSettled([f.wallet.send(f.review), f.wallet.send(f.review)])
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal(f.calls.filter(m => m === 'eth_sendTransaction').length, 1)
  f.wallet.dispose(); assert.equal(f.handlers.size, 0)
})
