import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { build, connectLocal, deployFixture, artifact, id } from './local-chain-lib.mjs'
import { LOCAL_PRICE_WEI as P, LOCAL_RULE_VERSION as RULE, mealForwardAbi, prepareSupportIntent } from '../src/chain-contract.ts'

// Reserve an exclusively owned port; never reset/stop a pre-existing process.
const port = 18546
const probe = createServer()
probe.listen(port, '127.0.0.1')
await once(probe, 'listening')
await new Promise(resolve => probe.close(resolve))
build()
const node = spawn('node_modules/.bin/anvil', ['--host','127.0.0.1','--port',String(port),'--chain-id','31337','--silent'], { stdio: ['ignore','ignore','pipe'] })
let spawnError
node.on('error', error => { spawnError = error })
let stderr = ''
node.stderr.on('data', chunk => { stderr += chunk.toString() })
try {
  let c
  for (let i = 0; i < 100; i++) {
    if (spawnError || node.exitCode !== null) throw spawnError ?? new Error(`Anvil failed: ${stderr}`)
    try { c = await connectLocal(`http://127.0.0.1:${port}`); break } catch { await delay(50) }
  }
  assert(c, 'Anvil did not start')
  const manifest = await deployFixture(c)
  const a = manifest.contractAddress
  const checks = []
  const ok = (receipt, expected = 'success') => assert.equal(receipt.status, expected)
  const write = async (actor, name, args, value = 0n, expected = 'success') => {
    const r = await c.write(a, actor, name, args, value); ok(r, expected); return r
  }
  async function batch(batchId, expected) {
    const values = await c.read(a, 'getBatch', [batchId])
    assert.deepEqual(values, expected.map(n => BigInt(n) * P))
    assert.equal(values[0], values.slice(1,6).reduce((sum, value) => sum + value, 0n))
  }
  // No hash recovery: intentionally discard the send result and use exact payer+intent mapping.
  const intent = prepareSupportIntent({ account:c.accounts[1], contract:a, intentId:id('fund-a'), quantity:3 })
  await write(1,'fund',[intent.intentId,3n,RULE],3n*P)
  const batchA = await c.read(a,'fundedBatch',[c.accounts[1],intent.intentId])
  assert.equal(batchA,intent.batchId)
  const logs = await c.publicClient.getContractEvents({ address:a,abi:mealForwardAbi,eventName:'Funded',args:{payer:c.accounts[1],intentId:intent.intentId},fromBlock:BigInt(manifest.deploymentBlock),toBlock:'latest' })
  assert.equal(logs.length,1)
  const included = await c.publicClient.getTransactionReceipt({hash:logs[0].transactionHash})
  assert.equal(included.status,'success')
  const canonical = await c.publicClient.getBlock({blockNumber:included.blockNumber})
  assert.equal(canonical.hash,included.blockHash)
  const firstFinalized = await c.publicClient.getBlock({blockTag:'finalized'})
  // Explicit local mining is test control, never a production confirmation shortcut.
  if (firstFinalized.number < included.blockNumber) {
    await c.publicClient.request({method:'anvil_mine',params:['0x80']})
  }
  const finalized = await c.publicClient.getBlock({blockTag:'finalized'})
  assert(finalized.number >= included.blockNumber)
  checks.push('real fund, hash discarded, original mapping/event recovered, receipt + local finalized checked')
  await write(1,'fund',[intent.intentId,3n,RULE],3n*P,'reverted')
  await write(1,'fund',[id('bad-value'),1n,RULE],P-1n,'reverted')
  await write(0,'fund',[id('unauthorized'),1n,RULE],P,'reverted')
  await write(1,'fund',[id('fund-b'),2n,RULE],2n*P)
  const batchB = await c.read(a,'fundedBatch',[c.accounts[1],id('fund-b')])
  await write(6,'fund',[intent.intentId,1n,RULE],P)
  assert.notEqual(await c.read(a,'fundedBatch',[c.accounts[6],intent.intentId]),batchA)
  checks.push('payer intent domain, duplicate/value/unauthorized mined reverts, independent batch')
  const vouchers = ['a','b','c'].map(v=>id(`voucher-${v}`))
  await write(2,'issue',[id('duplicate-vouchers'),batchA,[vouchers[0],vouchers[0]]],0n,'reverted')
  assert.equal((await c.read(a,'getVoucher',[vouchers[0]]))[1],0)
  await write(2,'issue',[id('issue-a'),batchA,vouchers])
  await write(2,'issue',[id('issue-a'),batchA,vouchers],0n,'reverted')
  await write(2,'issue',[id('issue-a'),batchB,vouchers],0n,'reverted')
  await write(2,'issue',[id('over-budget'),batchA,[id('new-voucher')]],0n,'reverted')
  await batch(batchA,[3,0,3,0,0,0,0]); await batch(batchB,[2,2,0,0,0,0,0])
  checks.push('atomic issuance, replay/changed payload/budget rejected, two-batch isolation')
  // Both transactions genuinely submitted; only one can acquire this voucher.
  const races = await Promise.all([
    c.write(a,3,'lock',[id('lock-a'),vouchers[0],id('lock-token-a')]),
    c.write(a,7,'lock',[id('lock-other'),vouchers[0],id('lock-token-other')]),
  ])
  assert.deepEqual(races.map(r=>r.status).sort(),['reverted','success'])
  const heldLock = (await c.read(a,'getVoucher',[vouchers[0]]))[2]
  await write(3,'report',[id('report-a'),vouchers[0],heldLock])
  const merchantBefore = await c.publicClient.getBalance({address:manifest.merchant,blockTag:'latest'})
  await write(3,'settle',[id('bad-settler'),vouchers[0]],0n,'reverted')
  await write(4,'settle',[id('settle-a'),vouchers[0]])
  await write(4,'settle',[id('settle-a'),vouchers[0]],0n,'reverted')
  assert.equal(await c.publicClient.getBalance({address:manifest.merchant,blockTag:'latest'})-merchantBefore,P)
  await batch(batchA,[3,0,2,0,1,0,0]); await batch(batchB,[2,2,0,0,0,0,0])
  checks.push('real concurrent lock race, report, role separation, one fixed-merchant payment')
  await write(3,'lock',[id('lock-b'),vouchers[1],id('lock-token-b')])
  await write(0,'setPaused',[true])
  await write(1,'fund',[id('paused-fund'),1n,RULE],P,'reverted')
  await write(2,'issue',[id('paused-issue'),batchB,[id('b-voucher')]],0n,'reverted')
  await write(3,'lock',[id('paused-lock'),vouchers[2],id('lock-c')],0n,'reverted')
  await write(3,'report',[id('report-b'),vouchers[1],id('lock-token-b')])
  await write(4,'settle',[id('paused-settle'),vouchers[1]],0n,'reverted')
  await batch(batchA,[3,0,1,1,1,0,0])
  checks.push('pause rejects new fund/issue/lock/settle, old-lock report preserves liability')
  // A distinct receiver actually rejects the native payment; state and operation roll back.
  const reject = await c.deploy(0,await artifact('out/MealForward.t.sol/RejectPayment.json'))
  const rejectManifest = await deployFixture(c,reject.contractAddress)
  const ra = rejectManifest.contractAddress
  ok(await c.write(ra,1,'fund',[id('reject-fund'),1n,RULE],P))
  const rb = await c.read(ra,'fundedBatch',[c.accounts[1],id('reject-fund')])
  const rv = id('reject-voucher')
  ok(await c.write(ra,2,'issue',[id('reject-issue'),rb,[rv]]))
  ok(await c.write(ra,3,'lock',[id('reject-lock'),rv,id('reject-token')]))
  ok(await c.write(ra,3,'report',[id('reject-report'),rv,id('reject-token')]))
  ok(await c.write(ra,4,'settle',[id('reject-settle'),rv]),'reverted')
  assert.deepEqual(await c.read(ra,'getBatch',[rb]),[P,0n,0n,P,0n,0n,0n])
  assert.equal((await c.read(ra,'getVoucher',[rv]))[1],3)
  assert.equal((await c.read(ra,'getOperation',[4,id('reject-settle')]))[0],'0x'+'0'.repeat(64))
  assert.equal(await c.read(ra,'liability'),P)
  checks.push('real rejecting merchant: reverted payment retains H, voucher and operation rollback')
  // Cap verified on a separate fixture, no reset or mutation of wallet's node.
  const cap = await deployFixture(c)
  for(let i=0;i<5;i++) ok(await c.write(cap.contractAddress,1,'fund',[id(`cap-${i}`),20n,RULE],20n*P))
  ok(await c.write(cap.contractAddress,1,'fund',[id('cap-over'),1n,RULE],P),'reverted')
  checks.push('cumulative funding cap is enforced by mined transaction')
  console.log(JSON.stringify({status:'PASS',mode:'localchain',chainId:31337,checks,localFinality:{receipt:included.blockNumber.toString(),firstFinalized:firstFinalized.number.toString(),observedFinalized:finalized.number.toString()},limitations:['No persistent backend or full UI','No real wallet extension or Monad network','Handoff is an operator statement only']},null,2))
} finally {
  if (node.exitCode === null) { node.kill('SIGTERM'); await once(node,'exit') }
}
