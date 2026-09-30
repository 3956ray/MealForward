import { test } from 'node:test'
import assert from 'node:assert/strict'
import { keccak256, type Address, type Hex } from 'viem'
import { LOCAL_RULE_VERSION, LOCAL_PRICE_WEI, type LocalDeployment } from '../../src/chain-contract.ts'
import { STORAGE_KEY, WalletController, type Provider } from '../../src/wallet/controller.ts'
const account = '0x0000000000000000000000000000000000000001' as Address
const other = '0x0000000000000000000000000000000000000002' as Address
const code = '0x60006000' as Hex
const deployment: LocalDeployment = { mode: 'localchain', chainId: 31337, rpcUrl: 'http://127.0.0.1:18545', contractAddress: other, deploymentBlock: '1', codeHash: keccak256(code), supporter: account, merchant: other, ruleVersion: LOCAL_RULE_VERSION, priceWei: LOCAL_PRICE_WEI.toString(), fundingCapWei: '100000000000000000' }
function fixture() {
  const data = new Map<string, string>()
  const store = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
  let chain = '0x7a69', current = account, sent = 0, fault = ''
  const rpc: Provider = { async request({method}) { if (method === 'eth_chainId') return '0x7a69'; if (method === 'eth_getCode') return code; if (method === 'eth_call') return `0x${'0'.repeat(64)}`; throw new Error(method) } }
  const provider: Provider = { async request({method}) {
    if (method === 'eth_chainId') return chain
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [current]
    if (method === 'eth_sendTransaction') { assert.equal(JSON.parse(store.getItem(STORAGE_KEY)!).status, 'SUBMISSION_UNKNOWN'); sent++
      if (fault === 'reject') throw {code: 4001}
      if (fault === 'unknown') throw new Error('unavailable')
      return `0x${'a'.repeat(64)}`
    }
    throw new Error(method)
  } }
  const controller = new WalletController(deployment, provider, store, rpc)
  return {controller, store, provider, rpc, sent: () => sent, setChain: (value: string) => { chain = value }, setAccount: () => { current = other }, setFault: (value: string) => { fault = value } }
}
test('wrong chain and changed account block writes before provider send', async () => {
  const f = fixture(); await f.controller.connect(); await f.controller.review(1)
  f.setChain('0x1'); await assert.rejects(f.controller.send(), /Wrong wallet chain/); assert.equal(f.sent(), 0)
  f.setChain('0x7a69'); f.setAccount(); await assert.rejects(f.controller.send(), /Account or quote changed/); assert.equal(f.sent(), 0)
})
test('explicit refusal is not submitted; transport uncertainty remains original-only after reload', async () => {
  const f = fixture(); await f.controller.connect(); await f.controller.review(1); f.setFault('reject')
  assert.equal((await f.controller.send()).status, 'NOT_SUBMITTED')
  await f.controller.review(1); f.setFault('unknown'); const original = await f.controller.send()
  assert.equal(original.status, 'SUBMISSION_UNKNOWN'); assert.equal(original.retryPolicy, 'READ_ORIGINAL_ONLY')
  const reload = new WalletController(deployment, f.provider, f.store, f.rpc)
  assert.deepEqual(await reload.recover(), original)
  await assert.rejects(reload.send(), /Review required/); await reload.connect(); await assert.rejects(reload.review(1), /Resolve original/)
  assert.equal(f.sent(), 2)
})
test('hash is broadcast only, duplicate send prohibited, invalidated review requires review', async () => {
  const f = fixture(); await f.controller.connect(); await f.controller.review(2)
  assert.equal((await f.controller.send()).status, 'BROADCAST')
  await assert.rejects(f.controller.send(), /Review required/); assert.equal(f.sent(), 1)
  const g = fixture(); await g.controller.connect(); await g.controller.review(1); g.controller.invalidate()
  await assert.rejects(g.controller.send(), /Review required/)
})
test('storage failure prevents signing and expired quotes cannot send', async () => {
  const f = fixture(); await f.controller.connect(); await f.controller.review(1)
  const operation = f.controller.load()!; operation.intent.quoteExpiresAt = 0; f.controller.save(operation)
  await assert.rejects(f.controller.send(), /quote changed/); assert.equal(f.sent(), 0)
  await f.controller.review(1); f.store.setItem = () => { throw new Error('disk unavailable') }
  await assert.rejects(f.controller.send(), /disk unavailable/); assert.equal(f.sent(), 0)
})
test('nonlocal endpoint and mismatched runtime code fail closed', async () => {
  const f = fixture(); f.controller.deployment = {...deployment, rpcUrl: 'https://example.org'}
  await assert.rejects(f.controller.connect(), /loopback/)
  f.controller.deployment = {...deployment, codeHash: `0x${'0'.repeat(64)}`}
  await assert.rejects(f.controller.connect(), /code mismatch/); assert.equal(f.sent(), 0)
})
test('another tab replacing a prepared quote cannot authorize the first tab to pay it', async () => {
  const f = fixture(); await f.controller.connect(); await f.controller.review(1)
  const second = new WalletController(deployment, f.provider, f.store, f.rpc)
  await second.connect(); await second.review(20)
  await assert.rejects(f.controller.send(), /Review required/); assert.equal(f.sent(), 0)
})
for (const change of ['quantity', 'account', 'chain', 'new-review']) {
  test(`late review cannot revive authorization after ${change} changes`, async () => {
    const f = fixture(); await f.controller.connect()
    let release!: () => void, entered!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const started = new Promise<void>(resolve => { entered = resolve })
    const originalRpc = f.rpc.request.bind(f.rpc)
    let first = true
    f.rpc.request = async args => {
      if (args.method === 'eth_getCode' && first) { first = false; entered(); await pending }
      return originalRpc(args)
    }
    const oldReview = f.controller.review(1)
    const rejected = assert.rejects(oldReview, /Review changed/)
    await started
    if (change === 'new-review') {
      await f.controller.review(20)
    } else if (change === 'quantity') {
      f.controller.invalidateReview()
    } else {
      f.controller.invalidate()
    }
    release(); await rejected
    if (change === 'new-review') {
      assert.equal(f.controller.load()?.intent.quantity, 20)
      assert.equal(f.controller.reviewed, true)
    } else {
      assert.equal(f.controller.reviewed, false)
      assert.equal(f.controller.load(), undefined)
      await assert.rejects(f.controller.send(), /Review required/)
    }
    assert.equal(f.sent(), 0)
  })
}
