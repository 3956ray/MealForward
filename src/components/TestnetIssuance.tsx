import { useEffect, useState, useSyncExternalStore } from 'react'
import { IssuanceController, TEST_BANNER, VOUCHER_NOTE, ATTRIBUTION, STALE_NOTICE, displayError, statusText } from '../testnet-issuance/controller.ts'
import { BATCH, CONTRACT, OPERATOR } from '../testnet-issuance/contracts.ts'
import { ledgerRoute } from '../testnet/contracts.ts'
import { mon } from '../testnet/api.ts'
export { TEST_BANNER, VOUCHER_NOTE, ATTRIBUTION }
function monOrPending(value: string|null|undefined) { return value==null?'尚未取得':mon(value) }
export function TestnetIssuance() {
  const [controller]=useState(()=>new IssuanceController())
  const state=useSyncExternalStore(controller.subscribe,controller.snapshot), view=state.view, operation=view?.operation
  useEffect(()=>{void controller.load(); return ()=>controller.dispose()},[controller])
  return <>
    <nav aria-label="测试发券导航"><a href="#/">返回首页</a><a href={ledgerRoute}>查看公开测试餐账</a><a href="#/partner">工作入口</a></nav>
    <section aria-labelledby="issuance-title">
      <p className="eyebrow">{TEST_BANNER}</p><h1 id="issuance-title">测试餐券发行状态</h1>
      <p>本页只读呈现一次受控测试发券的状态与链上证据；本页不提供发行、领取或分发操作，也不连接钱包。</p>
      <p>{ATTRIBUTION}</p>
      <p role="status" aria-live="polite">{statusText(state)}</p>
      {state.stale && <p role="status">{STALE_NOTICE}</p>}
      {state.error && <p role="alert">{displayError(state.error)}</p>}
      {operation?.finalizedReceipt && <p>保留的最终确认事实：{operation.finalizedReceipt.status===1?'执行成功':'执行失败'}，区块 {operation.finalizedReceipt.blockNumber}，实际 gas {mon(operation.finalizedReceipt.gasFeeWei)} 测试 MON。</p>}
      {operation?.receiptConflict && <p role="alert">当前回执与已最终确认事实矛盾，未覆盖原结论，仅保留为历史证据。</p>}
      <button disabled={state.busy||!state.config?.configured} onClick={()=>void controller.refresh()}>重查发券状态</button>
      <dl>
        <dt>网络</dt><dd>Monad 测试网 · 10143</dd>
        <dt>收款合约</dt><dd>{CONTRACT}</dd>
        <dt>发行批次</dt><dd>{BATCH}</dd>
        <dt>发行服务钥匙</dt><dd>{OPERATOR}（受限，程序内部使用）</dd>
        <dt>发行数量</dt><dd>恰好 1 张 · 0.001 测试 MON 额度</dd>
        <dt>gas 上限</dt><dd>gas ≤ 250,000，maxFee ≤ 200 gwei，priority ≤ 2 gwei</dd>
      </dl>
      <section aria-labelledby="voucher-title">
        <h2 id="voucher-title">测试餐券</h2>
        <p role="note">{VOUCHER_NOTE}</p>
        <dl>
          <dt>券ID</dt><dd><code>{operation?.voucherId??'待发行'}</code></dd>
          <dt>所属批次</dt><dd><code>{BATCH}</code></dd>
          <dt>券状态</dt><dd>{operation?(operation.status==='ACCOUNTING_VERIFIED'?'已发行并核账':operation.status==='PREPARED'?'待放行':'发行中/已核验，见上方状态'):'尚未读取'}</dd>
          <dt>虚构领取者标签</dt><dd>{operation?.recipientRef??'尚未读取'}</dd>
        </dl>
      </section>
      <details><summary>原操作与链上来源</summary>
        <dl>
          <dt>发行操作ID</dt><dd><code>{operation?.operationId??'尚未读取'}</code></dd>
          <dt>批准 issuanceId</dt><dd><code>{operation?.issuanceId??'尚未读取'}</code></dd>
          <dt>完整 calldata</dt><dd><code>{view?.intent.data??'尚未读取'}</code></dd>
          <dt>原交易</dt><dd>{operation?.txHash??'尚未取得；发行由测试负责人另行放行，不代表失败'}</dd>
          <dt>交易入块</dt><dd>{operation?.receiptBlock??'尚未取得'}</dd>
          <dt>交易块 hash</dt><dd>{operation?.receiptBlockHash??'尚未取得'}</dd>
          <dt>finalized 水位</dt><dd>{operation?.finalizedBlock??'尚未取得'}</dd>
          <dt>事件扫描水位</dt><dd>{operation?.scanThrough??'尚未取得'}（与交易最终性分别核验）</dd>
          <dt>实际 gas 费用（测试 MON）</dt><dd>{monOrPending(operation?.gasFeeWei)}</dd>
          <dt>服务核验提示</dt><dd>{operation?.errorCode?displayError(operation.errorCode):'无'}</dd>
        </dl>
      </details>
    </section>
    <section aria-labelledby="batch-title">
      <h2 id="batch-title">{state.stale?'本批次上次已核餐账（历史证据）':'本批次链上餐账'}</h2>
      <p>计划冻结时（发行前）：F 0.001 · A 0.001 · R 0 测试 MON。</p>
      {view?.accounting ? <>
        <p>发行后同块直接回读：区块 {view.accounting.blockNumber} · {view.accounting.blockHash}</p>
        <dl>{(['F','A','R','H','S'] as const).map(key=><div key={key}><dt>{key}</dt><dd>{mon(view.accounting![key])} 测试 MON</dd></div>)}</dl>
        <details><summary>整个合约（全局不变量）</summary>
          <p>发券不改变合约全局金额；下列数值应与发行前一致。</p>
          <dl><dt>合约全部批次总负债</dt><dd>{mon(view.accounting.liabilityWei)} 测试 MON</dd><dt>合约全部批次余额</dt><dd>{mon(view.accounting.contractBalanceWei)} 测试 MON</dd><dt>合约累计入款</dt><dd>{mon(view.accounting.totalFundedWei)} 测试 MON</dd></dl>
        </details>
      </> : <p>发行完成并核账后显示批次链上餐账。</p>}
    </section>
  </>
}
