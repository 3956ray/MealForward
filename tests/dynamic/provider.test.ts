import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { adaptDynamicWalletProvider } from '../../src/dynamic/client.ts'
import type { InvalidationReason } from '../../src/dynamic/contracts.ts'

function fixture() {
  const events = new EventEmitter()
  const invalidated: InvalidationReason[] = []
  const requests: unknown[] = []
  let allowed = true
  const selected = {
    events: events as unknown as NonNullable<Parameters<typeof adaptDynamicWalletProvider>[0]['events']>,
    request: async <T,>(args: unknown) => { requests.push(args); return 'fixture-result' as T },
  }
  const adapter = adaptDynamicWalletProvider(selected, () => allowed, reason => invalidated.push(reason))
  return { ...adapter, events, invalidated, requests, forbid: () => { allowed = false } }
}

test('maps SDK account/network/disconnection payloads to EIP1193 and globally invalidates first', () => {
  const f = fixture()
  const received: unknown[][] = []
  f.provider.on!('accountsChanged', (...args) => { assert.equal(f.invalidated.at(-1), 'account-changed'); received.push(args) })
  f.provider.on!('chainChanged', (...args) => { assert.equal(f.invalidated.at(-1), 'chain-changed'); received.push(args) })
  f.provider.on!('disconnect', (...args) => received.push(args))
  f.events.emit('accountsChanged', { addresses: ['0xsynthetic'] })
  f.events.emit('networkChanged', { networkId: '31337' })
  f.events.emit('networkChanged', { networkId: '0x279f' })
  f.events.emit('disconnected')
  assert.deepEqual(received, [[['0xsynthetic']], ['0x7a69'], ['0x279f'], [{ code: 4900, message: 'Wallet disconnected' }]])
  assert.deepEqual(f.invalidated, ['account-changed', 'chain-changed', 'chain-changed', 'account-changed'])
  assert.deepEqual(f.requests, []) // Subscribing and events never connect or sign.
  f.dispose()
})

test('deduplicates subscriptions and removes exact listener without removing global invalidation', () => {
  const f = fixture()
  let first = 0
  let second = 0
  const listener = () => { first++ }
  const other = () => { second++ }
  f.provider.on!('chainChanged', listener)
  f.provider.on!('chainChanged', listener)
  f.provider.on!('chainChanged', other)
  assert.equal(f.events.listenerCount('networkChanged'), 1)
  f.events.emit('networkChanged', { networkId: '143' })
  assert.deepEqual([first, second], [1, 1])
  f.provider.removeListener!('accountsChanged', listener) // Different event cannot remove it.
  f.provider.removeListener!('chainChanged', listener)
  f.provider.removeListener!('chainChanged', listener)
  f.events.emit('networkChanged', { networkId: '31337' })
  assert.deepEqual([first, second], [1, 2])
  f.provider.removeListener!('chainChanged', other)
  f.events.emit('networkChanged', { networkId: '10143' })
  assert.equal(f.invalidated.length, 3)
  f.dispose()
})

test('dispose releases only owned SDK listeners, is idempotent and disables old provider', async () => {
  const f = fixture()
  let external = 0
  let local = 0
  f.events.on('accountsChanged', () => { external++ })
  f.provider.on!('accountsChanged', () => { local++ })
  f.dispose(); f.dispose()
  assert.equal(f.events.listenerCount('accountsChanged'), 1)
  assert.equal(f.events.listenerCount('networkChanged'), 0)
  assert.equal(f.events.listenerCount('disconnected'), 0)
  f.events.emit('accountsChanged', { addresses: [] })
  assert.deepEqual([external, local, f.invalidated.length], [1, 0, 0])
  f.provider.on!('accountsChanged', () => { local++ })
  await assert.rejects(f.provider.request({ method: 'eth_requestAccounts' }), /AUTH_REQUIRED/)
  assert.deepEqual(f.requests, [])
})

test('forwards only explicit requests and stops forwarding after authorization invalidation', async () => {
  const f = fixture()
  assert.equal(await f.provider.request({ method: 'eth_chainId' }), 'fixture-result')
  assert.deepEqual(f.requests, [{ method: 'eth_chainId', params: [] }])
  f.forbid()
  await assert.rejects(f.provider.request({ method: 'personal_sign', params: [] }), /AUTH_REQUIRED/)
  assert.equal(f.requests.length, 1)
  f.dispose()
})
