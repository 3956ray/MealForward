import { useEffect, useState, useSyncExternalStore } from 'react'
import { FundingController, displayError, statusText } from '../testnet-funding/controller.ts'
import { CHAIN_HEX, CONTRACT, RULE } from '../testnet-funding/contracts.ts'
import { ledgerRoute } from '../testnet/contracts.ts'
function mon(value: string|null|undefined) { if(value==null) return '尚未取得'; const n=BigInt(value); return `${n/10n**18n}.${(n%10n**18n).toString().padStart(18,'0').replace(/0+$/,'')||'0'}` }
export function TestnetFunding() {
  const [controller]=useState(()=>new FundingController())
  const state=useSyncExternalStore(controller.subscribe,controller.snapshot), view=state.view, tx=state.review?.transaction
  useEffect(()=>{void controller.load(); return ()=>controller.dispose()},[controller])
  const canPrepare=!!view && view.operation.status==='PREPARED' && !state.consumed
  return <>
    <nav aria-label="测试入款导航"><a href="#/">返回首页</a><a href={ledgerRoute}>查看公开测试餐账</a><a href="#/partner">工作入口</a></nav>
    <section aria-labelledby="funding-title">
      <p className="eyebrow">Monad 测试网 · 虚构测试批次</p><h1 id="funding-title">测试餐款入款</h1>
      <p>本次仅测试入款，尚未发券；本测试合约不支持退款。</p><p>1 份 · 0.001 测试 MON。测试币不是餐价或真实捐赠；gas 由付款钱包另行承担。</p>
      <p>本页面访问凭证不是自然人认证，也不授予工作权限。私有页面不使链上付款变私密：钱包地址、金额及时间仍可被观察和关联。</p>
      <p role="status" aria-live="polite">{statusText(state)}</p>
      {state.error && <p role="alert">{displayError(state.error)}</p>}
      {view?.operation.budgetViolation && <p role="alert">原交易费用已越过批准预算。本页继续只读记录实际结果与 gas，已禁止所有后续签名；链上到账不代表符合预算。</p>}
      {view?.operation.receiptConflict && <p role="alert">当前回执与已最终确认事实矛盾，未覆盖原结论。下方账目及回执仅为保留的历史证据。</p>}
      {view?.operation.finalizedReceipt && <p>保留的最终确认事实：{view.operation.finalizedReceipt.status===1?'执行成功':'执行失败'}，区块 {view.operation.finalizedReceipt.blockNumber}，实际 gas {mon(view.operation.finalizedReceipt.gasFeeWei)} 测试 MON。</p>}
      {state.stale && <p role="status">本次读取未完成；下列内容仅为上次已核结果，不表示本次已重新核验。</p>}
      {!view && state.config?.configured && <button disabled={state.busy||state.consumed} onClick={()=>void controller.start()}>访问本轮付款操作</button>}
      {canPrepare && <div className="actions">
        <button disabled={state.busy} onClick={()=>void controller.connect()}>主动连接 MetaMask</button>
        <button disabled={state.busy||!state.account||state.chain===CHAIN_HEX} onClick={()=>void controller.switchChain()}>切换至测试网 10143</button>
        <button disabled={state.busy||!state.account||state.chain!==CHAIN_HEX} onClick={()=>void controller.review()}>审核原付款意图</button>
      </div>}
      <dl><dt>当前钱包</dt><dd>{state.account??'尚未连接或连接已变化'}</dd><dt>固定付款钱包</dt><dd>{view?.operation.payer??'访问原操作后显示'}</dd><dt>网络</dt><dd>Monad Testnet · 10143</dd><dt>收款合约</dt><dd>{CONTRACT}</dd><dt>规则</dt><dd>{RULE}</dd><dt>本金</dt><dd>1 份 · 0.001 测试 MON</dd><dt>gas 承担者与上限</dt><dd>固定付款钱包；gas ≤ 250,000，maxFee ≤ 200 gwei，priority ≤ 2 gwei；gas 最坏 0.05 测试 MON，本金加 gas 最坏 0.051 测试 MON</dd></dl>
      {tx && <section aria-labelledby="review-title"><h2 id="review-title">原意图审核</h2><p>请在 MetaMask 确认页再次核对账户、网络、合约、本金、calldata、nonce 与费用。钱包可手动修改费用；发现超限请勿确认。提交后即使拒签也只能查询原操作。</p>
        <dl><dt>审核到期时间</dt><dd>{new Date(state.review!.expiresAt).toLocaleString()}</dd><dt>nonce</dt><dd>{BigInt(tx.nonce).toString()}</dd><dt>请求 gas 上限</dt><dd>{BigInt(tx.gas).toString()}</dd><dt>maxFeePerGas（wei）</dt><dd>{BigInt(tx.maxFeePerGas).toString()}</dd><dt>maxPriorityFeePerGas（wei）</dt><dd>{BigInt(tx.maxPriorityFeePerGas).toString()}</dd><dt>完整 calldata</dt><dd><code>{tx.data}</code></dd></dl>
        <button disabled={state.busy||state.consumed} onClick={()=>void controller.submit()}>确认并在钱包签名</button></section>}
      {view && <>
        <button disabled={state.busy} onClick={()=>void controller.reconcile()}>只查询原操作</button>
        <p>提交后刷新、断网、切换钱包或拒签均不恢复付款资格。访问凭证丢失或过期，请联系本次测试负责人恢复；请勿再次付款。</p>
        <details><summary>原操作与链上来源</summary><dl><dt>原操作</dt><dd>{view.operation.id}</dd><dt>原意图</dt><dd>{view.operation.intentId}</dd><dt>本批次</dt><dd>{view.operation.batchId}</dd><dt>原交易</dt><dd>{view.operation.txHash??'尚未取得；不代表未付款'}</dd><dt>交易入块</dt><dd>{view.operation.receiptBlock??'尚未取得'}</dd><dt>交易块 hash</dt><dd>{view.operation.receiptBlockHash??'尚未取得'}</dd><dt>finalized 水位</dt><dd>{view.operation.finalizedBlock??'尚未取得'}</dd><dt>事件扫描水位</dt><dd>{view.operation.scanThrough??'尚未取得'}（与交易最终性分别核验）</dd><dt>实际 gas 费用（测试 MON）</dt><dd>{mon(view.operation.gasFeeWei)}</dd><dt>服务核验提示</dt><dd>{view.operation.errorCode?displayError(view.operation.errorCode):'无'}</dd></dl></details>
      </>}
    </section>
    {view?.accounting && <section><h2>{state.stale?'本批次上次已核餐账（历史证据）':'本批次链上餐账'}</h2><p>同块直接回读：区块 {view.accounting.blockNumber} · {view.accounting.blockHash}</p><dl>{(['F','A','R','H','S'] as const).map(key=><div key={key}><dt>{key}</dt><dd>{mon(view.accounting![key])} 测试 MON</dd></div>)}</dl>
      <details><summary>整个合约</summary><p>可能包含其他测试批次，不属于本批次金额。</p><dl><dt>合约全部批次总负债</dt><dd>{mon(view.accounting.liabilityWei)} 测试 MON</dd><dt>合约全部批次余额</dt><dd>{mon(view.accounting.contractBalanceWei)} 测试 MON</dd><dt>合约累计入款</dt><dd>{mon(view.accounting.totalFundedWei)} 测试 MON</dd></dl></details>
    </section>}
  </>
}
