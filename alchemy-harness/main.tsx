import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { checkTestnet, CheckFailure, type TestnetStatus } from './api'
import './style.css'

function App() {
  const [busy, setBusy] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [result, setResult] = useState<TestnetStatus | null>(null)
  const [error, setError] = useState('')
  const epoch = useRef(0)
  const active = useRef<AbortController | null>(null)
  useEffect(() => () => { epoch.current++; active.current?.abort() }, [])

  async function check() {
    if (active.current) return
    const current = ++epoch.current
    const controller = new AbortController()
    active.current = controller
    setBusy(true); setAttempted(true); setResult(null); setError('')
    let timedOut = false
    const timer = window.setTimeout(() => {
      timedOut = true; controller.abort()
      if (current !== epoch.current) return
      epoch.current++
      active.current = null
      setBusy(false)
      setError('等待已超时，后台检查可能仍在结束中。请稍后主动重试。')
    }, 12_000)
    try {
      const data = await checkTestnet(controller.signal)
      if (current === epoch.current) setResult(data)
    } catch (failure) {
      if (current === epoch.current && !timedOut) {
        setError(failure instanceof CheckFailure ? failure.message : '本次连接中断，请稍后主动重试。')
      }
    } finally {
      window.clearTimeout(timer)
      if (current === epoch.current) { active.current = null; setBusy(false) }
    }
  }

  return <main>
    <header><a className="brand" href="/">mealforward<span>留膳</span></a><span className="network">TESTNET · 10143</span></header>
    <section className="intro"><p className="eyebrow">网络检查 / 只读</p><h1>Monad Testnet<br />连接检查</h1><p>主动读取测试网最新区块，确认本次网络连接。</p></section>
    <section className="card" aria-label="测试网连接状态">
      <div className="row"><h2>Monad Testnet</h2><span className={`badge ${result ? 'success' : ''}`}>{busy ? '检查中' : result ? '本次检查成功' : error ? '本次检查失败' : '尚未检查'}</span></div>
      <dl><div><dt>目标链 ID</dt><dd>10143</dd></div><div><dt>读取方式</dt><dd>Alchemy · 只读</dd></div></dl>
      <div className="status" aria-live="polite" aria-atomic="true">
        {busy ? <p>正在核对链 ID 并读取最新区块…</p> : result ? <dl className="readings"><div><dt>最新区块</dt><dd className="block">{result.latestBlock}</dd></div><div><dt>最近成功检查（UTC）</dt><dd><time dateTime={result.checkedAt}>{result.checkedAt}</time></dd></div></dl> : error ? <p className="error" role="alert">{error}</p> : <p>点击下方按钮开始。页面不会自动检查或轮询。</p>}
      </div>
      <button disabled={busy} onClick={() => void check()}>{busy ? '正在检查…' : attempted ? '重新检查' : '检查测试网连接'}<span aria-hidden="true">↗</span></button>
      <p className="hint">每分钟最多 5 次。检查只代表本次读取结果，不代表网络持续可用或区块已最终确认。</p>
    </section>
    <aside><strong>本页仅检查网络连接；项目测试网合约已部署，业务入口尚未接入本页</strong><p>本页只检查网络连接，不展示餐账或资金流水。无需登录或连接钱包，也不会发送交易。</p></aside>
    <footer>mealforward · 测试网观察</footer>
  </main>
}

createRoot(document.getElementById('root')!).render(<App />)
