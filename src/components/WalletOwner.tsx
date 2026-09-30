import { useEffect, useState } from 'react'
import { formatEther } from 'viem'
import { OwnerWalletController, type OwnerJournal } from '../wallet/owner-controller.ts'

export function WalletOwner({ controller, providerLabel = '注入式钱包（需要本人主动确认）' }: {
  controller: OwnerWalletController; providerLabel?: string
}) {
  const [journal, setJournal] = useState<OwnerJournal | undefined>()
  const [account, setAccount] = useState<string>()
  const [verified, setVerified] = useState(false)
  const [reviewed, setReviewed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [redemption, setRedemption] = useState('')
  useEffect(() => {
    const update = () => {
      try { setJournal(controller.load()) } catch { setError('原记录无法读取，请保留记录并联系维护人员；不要新建替代操作。') }
      setAccount(controller.account); setVerified(controller.verified); setReviewed(controller.reviewed)
    }
    const unsubscribe = controller.subscribe(update)
    controller.attach(); update()
    return () => { unsubscribe(); controller.detach() }
  }, [controller])
  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError('')
    try { await action() } catch (e) { setError(e instanceof Error ? e.message : '操作未完成；只查原操作') }
    finally { setBusy(false) }
  }
  const d = controller.deployment, i = journal?.view?.intent, operation = journal?.view?.operation
  const started = journal?.startAttempted || i?.submissionStarted
  return <section className="owner-wallet" aria-label="老板钱包逐笔结算">
    <p className="eyebrow">mealforward · 独立本地钱包验证</p>
    <h1>餐馆老板 · 逐笔结算</h1>
    <p>仅 Anvil 31337 虚构余额，非 Monad 测试网，无真实供餐。此独立页面未接入模拟 P01–P14。</p>
    <p>{providerLabel}</p>
    <div className="wallet-panel"><h2>连接与身份验证</h2>
      <p>网络：本地 31337 · 固定合约 <code>{d.contractAddress}</code></p>
      <p>本店固定收款钱包 <code>{d.merchant}</code></p>
      <p>当前账户 <code>{account ?? '未连接'}</code> · {verified ? '当前身份已验证' : '身份尚未验证'}</p>
      <p>身份签名仅证明当前钱包控制权，不是交易、扣款或结算授权；不会自动弹出签名。</p>
      <div className="wallet-actions"><button disabled={busy} onClick={() => void run(() => controller.connect())}>主动连接钱包</button>
        <button disabled={busy || !account} onClick={() => void run(() => controller.verifyIdentity())}>签署身份验证消息</button>
        <button disabled={busy} onClick={() => void run(() => controller.logout())}>撤销钱包身份证明</button></div>
      {controller.revocationFailed && <p role="alert">撤销尚未确认，暂不能重新审核或发送。请重试撤销。</p>}
    </div>
    <div className="wallet-panel"><h2>审核这一笔原应付款</h2>
      <label>原应付款 ID<input value={redemption} onChange={e => { setRedemption(e.target.value); controller.invalidateReview() }} placeholder="redemptionId" disabled={busy} /></label>
      <p>验券、锁定、交餐声明与申报由老板逐次操作，后台 operator 提交；只有已最终确认的申报才能准备这一笔钱包结算。</p>
      <button disabled={busy || !verified || !redemption.trim() || !!started && !['FINALIZED_SUCCESS', 'FINALIZED_REVERT'].includes(operation?.status ?? '')}
        onClick={() => void run(() => controller.review(redemption))}>准备并审核原应付款</button>
      {i && <div className="review-details">
        <p>餐款：{formatEther(BigInt(i.amountWei))} 本地测试单位，从合约支付至固定商家。</p>
        <p>收款商家 <code>{i.merchant}</code></p><p>交易合约 <code>{i.to}</code></p>
        <p>钱包转入本金：0；交易 value = 0。Gas 由老板钱包另付，不从餐款扣除。</p>
        <p>审核截止：{new Date(i.reviewExpiresAt * 1000).toLocaleString('zh-CN')}</p>
        <button disabled={busy || !reviewed || !!started} onClick={() => void run(() => controller.send())}>确认此笔结算并请求钱包签名</button>
      </div>}
    </div>
    {journal && <div className="wallet-panel" aria-live="polite"><h2>保留原操作，只查原结果</h2>
      <p>原意图 <code>{journal.intentKey}</code></p><p>原操作 <code>{operation?.id ?? '准备响应未取得，按原意图查询'}</code></p>
      <p>服务端状态：{operation?.status ?? '尚未取得'}</p>
      {started && <p>开始请求已尝试。拒签、断连或没有哈希都不代表未发送；此原操作不再请求第二次发送。</p>}
      <p>原交易 <code>{journal.txHash ?? operation?.txHash ?? '尚无哈希；不代表未发送'}</code></p>
      <p>只有服务端核验的 FINALIZED_SUCCESS 才表示 H→S；钱包哈希与收据不等于最终结算。</p>
      <div className="wallet-actions"><button disabled={busy} onClick={() => void run(() => controller.recover())}>只查询原操作</button>
      {journal.txHash && <button disabled={busy} onClick={() => void run(() => controller.associateKnownHash())}>补报同一个已知哈希</button>}</div>
    </div>}
    {error && <p role="alert">{error}</p>}
    <p className="fineprint">账户或网络切换会撤销身份证明并使审核失效。没有退款、补券、释锁或恢复钱包的入口；链记录不证明实际交餐。</p>
  </section>
}
