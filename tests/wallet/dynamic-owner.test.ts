import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { keccak256, type Hex } from 'viem'
import { adaptDynamicWalletProvider } from '../../src/dynamic/client.ts'
import { OwnerWalletController, type OwnerApi } from '../../src/wallet/owner-controller.ts'
import { releaseOwnerController } from '../../dynamic-harness/owner-lifecycle.ts'

test('Dynamic adapter attaches to owner controller, invalidates proof and rejects non31337', async () => {
  const events = new EventEmitter(), methods: string[] = [], invalidations: string[] = []
  const address = '0x' + '1'.repeat(40), code = '0x6000' as Hex, genesisHash = '0x' + '3'.repeat(64)
  const deployment = { mode: 'localchain', chainId: 31337, ownerWalletMode: true, deploymentId: 'controlled-dynamic', contractAddress: '0x' + '2'.repeat(40), codeHash: keccak256(code), genesisHash, merchant: address, priceWei: '1000000000000000' }
  const adapter = adaptDynamicWalletProvider({
    events: events as unknown as NonNullable<Parameters<typeof adaptDynamicWalletProvider>[0]['events']>,
    async request({ method }) {
      methods.push(method)
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [address]
      if (method === 'eth_chainId') return '0x8f' // Enabled dashboard Monad mainnet is never permitted here.
      if (method === 'eth_getCode') return code
      if (method === 'eth_getBlockByNumber') return { hash: genesisHash }
      throw new Error('Unexpected signing or wallet action')
    },
  }, () => true, reason => invalidations.push(reason))
  let revocations = 0
  const api: OwnerApi = { async request<T>(path: string): Promise<T> { assert.equal(path, '/work/wallet/logout'); revocations++; return undefined as T } }
  const controller = new OwnerWalletController({ deployment, provider: adapter.provider, api, store: { getItem: () => null, setItem: () => {} }, origin: 'http://127.0.0.1:15207', actorId: 'fixture-owner' })
  controller.attach()
  assert.deepEqual(methods, [])
  controller.verified = true; controller.reviewed = true; controller.account = address
  events.emit('networkChanged', { networkId: '143' })
  assert.deepEqual([controller.verified, controller.reviewed, controller.account], [false, false, undefined])
  assert.deepEqual(invalidations, ['chain-changed'])
  await assert.rejects(controller.connect(), /Bound account, local chain or contract changed/)
  assert.equal(methods.includes('personal_sign'), false); assert.equal(methods.includes('eth_sendTransaction'), false)
  releaseOwnerController(controller)
  await new Promise(resolve => setImmediate(resolve))
  const revoked = revocations
  events.emit('accountsChanged', { addresses: [] })
  events.emit('networkChanged', { networkId: '10143' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(revocations, revoked) // Released controller no longer reacts; global SDK invalidation remains.
  assert.deepEqual(invalidations.slice(-2), ['account-changed', 'chain-changed'])
  adapter.dispose()
  assert.equal(events.listenerCount('networkChanged'), 0)
})
