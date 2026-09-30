import { useEffect, useMemo, useState } from 'react'
import { formatEther } from 'viem'
import { LOCAL_ASSET_LABEL, LOCAL_LIMITATIONS, type ChainOperation, type LocalDeployment } from '../chain-contract.ts'
import { WalletController } from '../wallet/controller.ts'
import { LocalTestProvider, type Fault } from '../wallet/local-provider.ts'

const labels: Record<ChainOperation['status'], string> = {
  PREPARED: '已审核，尚未提交', SUBMISSION_UNKNOWN: '提交结果未知，只能查询原操作', BROADCAST: '已返回交易哈希，等待收据',
  INCLUDED_SUCCESS: '执行成功，等待本地最终确认', INCLUDED_REVERT: '执行回滚，等待本地最终确认',
  FINALIZED_SUCCESS: '本地链最终确认成功', FINALIZED_REVERT: '本地链最终确认回滚', NOT_SUBMITTED: '签名前拒绝，未提交',
}
export function WalletSupport({ deployment }: { deployment: LocalDeployment }) {
  const provider = useMemo(() => new LocalTestProvider(deployment), [deployment])
  const controller = useMemo(() => new WalletController(deployment, provider, localStorage), [deployment, provider])
  const [operation, setOperation] = useState<ChainOperation | undefined>(() => controller.load())
  const [account, setAccount] = useState<string>()
  const [quantity, setQuantity] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reviewed, setReviewed] = useState(false)
  useEffect(() => {
    const invalidate = () => { controller.invalidate(); setReviewed(false); setAccount(undefined) }
    const storage = () => { invalidate(); setOperation(controller.load()) }
    provider.on('accountsChanged', invalidate); provider.on('chainChanged', invalidate); provider.on('disconnect', invalidate)
    window.addEventListener('storage', storage)
    return () => { provider.removeListener('accountsChanged', invalidate); provider.removeListener('chainChanged', invalidate); provider.removeListener('disconnect', invalidate); window.removeEventListener('storage', storage) }
  }, [controller, provider])
  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError('')
    try { await action() } catch (e) { setError(e instanceof Error ? e.message : '操作未完成；保留原操作查询') }
    finally { setOperation(controller.load()); setReviewed(controller.reviewed); setBusy(false) }
  }
  return <section aria-label="本地钱包验证">
    <h1>mealforward · 本地钱包验证</h1>
    <p>{LOCAL_LIMITATIONS}</p>
    <p>隔离 EIP-1193 测试 provider，使用 Anvil 开发账户；未连接浏览器扩展。这里只验证独立模块，本地保存意图，无持久后台。</p>
    <p>网络：Anvil 31337 · 合约：<code>{deployment.contractAddress}</code></p>
    <button disabled={busy} onClick={() => void run(async () => { setAccount(await controller.connect()) })}>连接本地测试账户</button>{' '}
    <button disabled={busy} onClick={() => void run(() => controller.switchChain())}>确认切换本地网络</button>
    <p>账户：{account ?? '未连接'}</p>
    <label>份数（1–20） <input disabled={busy} type="number" min="1" max="20" value={quantity} onChange={e => { setQuantity(Number(e.target.value)); controller.invalidateReview(); setReviewed(false) }} /></label>
    <p>每份 {formatEther(BigInt(deployment.priceWei))} {LOCAL_ASSET_LABEL}。Gas 另计。</p>
    <label>验证故障 <select disabled={busy} defaultValue="none" onChange={e => { provider.fault = e.target.value as Fault }}>
      <option value="none">正常发送</option><option value="reject">签前拒绝</option><option value="drop-after-send">真实发送后丢响应</option><option value="unknown-before-send">未发送但结果未知</option>
    </select></label>
    <p><button disabled={busy || !account} onClick={() => void run(() => controller.review(quantity))}>审核新意图</button>{' '}
      <button disabled={busy || !reviewed} onClick={() => void run(() => controller.send())}>确认付款（仅本地余额）</button>{' '}
      <button disabled={busy || !operation} onClick={() => void run(() => controller.recover())}>只查询原意图</button></p>
    {error && <p role="alert">{error}</p>}
    {operation && <div aria-live="polite"><h2>{labels[operation.status]}</h2>
      <p>原账户：<code>{operation.intent.account}</code></p><p>原意图：<code>{operation.intent.intentId}</code></p>
      <p>份数：{operation.intent.quantity} · 本金：{formatEther(BigInt(operation.intent.valueWei))} {LOCAL_ASSET_LABEL}</p>
      <p>交易：<code>{operation.txHash ?? '尚无哈希；不代表未发送'}</code></p>
      <p>刷新后仅查询原意图。未知交易不会自动重发；报价到期须重新审核。</p>
    </div>}
  </section>
}
