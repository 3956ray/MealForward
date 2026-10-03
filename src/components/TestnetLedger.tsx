import { useEffect, useRef, useState } from 'react'
import { batchId, contractAddress, merchant, type Ledger, type PublicEvent } from '../testnet/contracts.ts'
import { loadLedger, loadEvents, mon, states } from '../testnet/api.ts'
const labels = {F:'累计测试餐款',A:'链上未分配餐款',R:'餐券预留',H:'已申报待付',S:'已付商家'}
const events: Record<string,string> = {Funded:'测试餐款入账',Issued:'餐券发行记录',Locked:'处理锁记录',Reported:'商家申报记录',Settled:'商家结算记录'}
export function TestnetLedger({ id }: {id:string}) {
  const [data,setData]=useState<Ledger>(), [rows,setRows]=useState<PublicEvent[]>([]), [error,setError]=useState(''), [busy,setBusy]=useState(false)
  const generation=useRef(0), abort=useRef<AbortController | null>(null), timer=useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  async function refresh(cached=false) {
    const version=++generation.current; clearTimeout(timer.current); abort.current?.abort()
    const controller=new AbortController(); abort.current=controller
    const timeout=setTimeout(()=>controller.abort(),8000); setBusy(true); setError('')
    let scheduled=false
    try {
      const next=await loadLedger(controller.signal,cached)
      if (generation.current!==version) return
      setData(next)
      if (next.sync.state==='HALTED') setRows([])
      else {
        try { const list=await loadEvents(controller.signal); if(generation.current===version) setRows(list) }
        catch { if(generation.current===version) setError('历史记录暂不可用；金额来源与扫描进度请分别核对。') }
      }
      if (!cached && next.sync.state==='SYNCING' && generation.current===version) {
        scheduled=true; timer.current=setTimeout(()=>void refresh(true),31000)
      }
    } catch { if(generation.current===version) setError('本次读取未完成；若有旧值，仅为上次已核结果。请稍后手动刷新。') }
    finally { clearTimeout(timeout); if(generation.current===version && !scheduled) setBusy(false) }
  }
  useEffect(()=>{
    if(id===batchId) void refresh()
    return ()=>{generation.current++;abort.current?.abort();clearTimeout(timer.current)}
  },[id]) // fixed public whitelist; no wallet/auth loading
  if(id!==batchId) return <section><h1>未找到测试批次</h1><a href="#/">返回首页</a></section>
  return <>
    <nav><a href="#/">返回首页</a><a href="#/partner">工作入口</a></nav>
    <section><p className="eyebrow">P04 · Monad 测试网 · 测试 MON · 只读</p><h1>查看测试网餐账</h1>
      <p>专用虚构测试记录，不用于真实领取。</p><p>商家申报与链上结算不证明实际交餐。</p>
      <p role="status">{data ? data.sync.state==='SYNCING' && data.amounts ? '正在更新；以下为上次已核结果' : states[data.sync.state] : '正在读取测试网餐账'}</p>
      {error && <p role="alert">{error}</p>}
      <button disabled={busy} onClick={()=>void refresh()}>{busy?'正在核验…':'刷新餐账'}</button>
      <div className="ledger-grid">{Object.entries(labels).map(([key,label])=><div className="ledger-card" key={key}><small>{label}</small><strong>{mon(data?.amounts?.[key as keyof typeof labels])}</strong><span>测试 MON</span></div>)}</div>
      <p className="fineprint">本测试合约不支持退款；本页未接入链下预算预留。链上未分配餐款不是当前账号的可发额度。</p>
      {data?.source && <p>已核验至区块 {data.source.blockNumber} · 最近核验时间（系统查询）：{data.source.checkedAt}</p>}
      <details><summary>链上来源与同步进度</summary><p>链上直接核验；Envio尚未接入</p>
        <dl><dt>网络</dt><dd>Monad Testnet · 10143</dd><dt>合约</dt><dd>{contractAddress}</dd><dt>固定测试商户</dt><dd>{merchant}</dd><dt>部署块</dt><dd>67797294</dd><dt>规则</dt><dd>mealforward-cp19-testnet-v1 · 每份0.001测试MON</dd><dt>批次</dt><dd>{batchId}</dd><dt>已核区块hash</dt><dd>{data?.source?.blockHash ?? '尚未取得'}</dd><dt>连续RPC事件扫描至</dt><dd>{data?.sync.scannedThrough ?? '尚未取得'}</dd><dt>事件状态</dt><dd>{data?.sync.eventsState==='COMPLETE'?'已扫描至本次核验块':'历史记录同步中；不代表全部事件已同步'}</dd><dt>最近尝试</dt><dd>{data?.sync.lastAttemptAt ?? '尚未取得'}</dd><dt>核验提示</dt><dd>{data?.sync.lastErrorCode ?? '无'}</dd></dl>
      </details>
        <details><summary>整个合约</summary><p>可能包含其他测试批次，不属于本批次金额。公开链上的地址、金额与交易时间可以被观察和关联；私有操作页不使链上付款变私密。</p><dl><dt>合约全部批次总负债（测试MON）</dt><dd>{mon(data?.liabilityWei)}</dd><dt>合约全部批次余额（测试MON）</dt><dd>{mon(data?.contractBalanceWei)}</dd></dl></details>
    </section>
    <section><h2>受控测试客户端记录</h2><p>以下按链序展示五类业务记录，不表示真人交餐。不提供逐券或持有人轨迹。</p>
      {!rows.length && <p>历史记录尚未取得；不能据此判断没有餐款。</p>}
      <ol className="testnet-events">{rows.map(e=><li key={`${e.transactionHash}:${e.logIndex}`}><strong>{events[e.kind]}</strong>{e.amountWei!==null && <span> · {mon(e.amountWei)} 测试MON</span>}<details><summary>核验来源</summary><p>区块 {e.blockNumber} · 日志 {e.logIndex}</p><code>{e.transactionHash}</code></details></li>)}</ol>
      <p className="fineprint">链上区块和交易仍可能推算发生时间。该展示未解决真实领取的隐私风险；后续真实资料须另经隐私审查。</p>
    </section>
  </>
}
