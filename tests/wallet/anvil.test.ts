import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { type LocalDeployment } from '../../src/chain-contract.ts'
import { WalletController, rpcProvider, type Provider } from '../../src/wallet/controller.ts'
import { LocalTestProvider } from '../../src/wallet/local-provider.ts'

const enabled = process.env.CP13_REAL_CHAIN === '1'
test('real Anvil: receipt/finality, response loss recovery, unknown no-send and reload never replay', { skip: !enabled }, async () => {
  const deployment = JSON.parse(await readFile('.localchain/deployment.json', 'utf8')) as LocalDeployment
  const rpc = rpcProvider(deployment.rpcUrl)
  const newStore = () => { const data = new Map<string, string>(); return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) } } }
  const store = newStore(), provider = new LocalTestProvider(deployment)
  let sends = 0
  const counted: Provider = { async request(args) { if (args.method === 'eth_sendTransaction') sends++; return provider.request(args) } }
  const controller = new WalletController(deployment, counted, store)
  await controller.connect(); await controller.review(1)
  assert.equal((await controller.send()).status, 'BROADCAST')
  assert.equal((await controller.recover()).status, 'INCLUDED_SUCCESS')
  // Test-only block advance; no automatic mining in the wallet module.
  await rpc.request({ method: 'anvil_mine', params: ['0x80'] })
  assert.equal((await controller.recover()).status, 'FINALIZED_SUCCESS')
  assert.equal(sends, 1)
  provider.fault = 'drop-after-send'
  const original = await controller.review(2)
  assert.equal((await controller.send()).status, 'SUBMISSION_UNKNOWN')
  const reload = new WalletController(deployment, counted, store)
  assert.equal((await reload.recover()).intent.intentId, original.intent.intentId)
  assert.equal(reload.load()?.status, 'INCLUDED_SUCCESS')
  assert.ok(reload.load()?.txHash)
  await assert.rejects(reload.send(), /Review required/)
  await reload.connect(); await assert.rejects(reload.review(1), /Resolve original/)
  assert.equal(sends, 2)
  // An inconsistent canonical block must not produce finality.
  const inconsistent: Provider = { async request(args) {
    if (args.method === 'eth_getBlockByNumber' && args.params?.[0] !== 'finalized') return { hash: `0x${'0'.repeat(64)}` }
    return rpc.request(args)
  } }
  const guarded = new WalletController(deployment, counted, store, inconsistent)
  assert.equal((await guarded.recover()).status, 'SUBMISSION_UNKNOWN')
  await rpc.request({ method: 'anvil_mine', params: ['0x80'] })
  assert.equal((await reload.recover()).status, 'FINALIZED_SUCCESS')
  assert.equal(reload.load()?.intent.batchId, original.intent.batchId)
  provider.fault = 'unknown-before-send'
  await reload.review(1)
  const unknown = await reload.send()
  const uncertainReload = new WalletController(deployment, counted, store)
  assert.equal((await uncertainReload.recover()).status, 'SUBMISSION_UNKNOWN')
  assert.equal(uncertainReload.load()?.intent.intentId, unknown.intent.intentId)
  await assert.rejects(uncertainReload.send(), /Review required/)
  assert.equal(sends, 3)
  const refusedStore = newStore(); provider.fault = 'reject'
  const refused = new WalletController(deployment, counted, refusedStore)
  await refused.connect(); await refused.review(1)
  assert.equal((await refused.send()).status, 'NOT_SUBMITTED')
  console.log('Real Anvil wallet PASS: two funded intents, response-loss mapped to original batch, no blind replay, local finality separate.')
})
