import { useEffect, useState } from 'react'
import { OwnerApiError, OwnerWalletController, ownerBrowserLock, ownerHttpApi, type OwnerDeployment } from '../wallet/owner-controller.ts'
import type { Provider } from '../wallet/controller.ts'
import { WalletOwner } from './WalletOwner.tsx'

type Redemption = { id: string; status: string; handoff?: { id: string } | null }
type Journal = { redemptionId?: string; pending?: { kind: 'lock' | 'handoff' | 'report'; key: string } }
function WorkPanel({ controller, onPayable }: { controller: OwnerWalletController; onPayable: (id: string) => void }) {
  const key = controller.storageKey + '.work.v1'
  const [journal, setJournal] = useState<Journal>({})
  const [redemption, setRedemption] = useState<Redemption>()
  const [payables, setPayables] = useState<Redemption[]>([])
  const [code, setCode] = useState(''), [checked, setChecked] = useState(false)
  const [verified, setVerified] = useState(controller.verified)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  function load(): Journal {
    const raw = localStorage.getItem(key)
    if (!raw) return {}
    const value = JSON.parse(raw) as Journal
    if (!value || typeof value !== 'object' || (value.redemptionId && typeof value.redemptionId !== 'string') ||
        (value.pending && (!['lock', 'handoff', 'report'].includes(value.pending.kind) || typeof value.pending.key !== 'string'))) throw new Error('原处理引用损坏，请联系维护人员；不要另建操作。')
    return value
  }
  function save(value: Journal) { localStorage.setItem(key, JSON.stringify(value)); setJournal(value) }
  useEffect(() => {
    try { setJournal(load()) } catch (e) { setError(String(e)) }
    return controller.subscribe(() => { setVerified(controller.verified); setChecked(false) })
  }, [controller, key])
  async function refresh() {
    let value = load()
    if (value.pending && value.pending.kind !== 'handoff') {
      const result = await controller.api.request<{ operation: { status: string }; redemptionId: string }>(`/work/operations/by-intent/${value.pending.kind}/${encodeURIComponent(value.pending.key)}`)
      value = { redemptionId: result.redemptionId, ...(['FINALIZED_SUCCESS', 'FINALIZED_REVERT', 'NOT_SUBMITTED'].includes(result.operation.status) ? {} : { pending: value.pending }) }
      save(value)
    }
    if (value.redemptionId) {
      const result = await controller.api.request<{ redemption: Redemption }>(`/work/redemptions/${encodeURIComponent(value.redemptionId)}`)
      setRedemption(result.redemption)
      if (value.pending?.kind === 'handoff' && result.redemption.handoff) save({ redemptionId: value.redemptionId })
    }
    setPayables((await controller.api.request<{ payables: Redemption[] }>('/work/payables')).payables)
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError('')
    try { await ownerBrowserLock(key, action) } catch (e) { setError(e instanceof Error ? e.message : '操作未确认，只查原记录。') }
    finally { setBusy(false) }
  }
  async function write(kind: 'lock' | 'handoff' | 'report') {
    const value = load()
    if (value.pending) throw new Error('已有待核动作，请先查询原处理，勿重复提交。')
    if (kind === 'lock' && value.redemptionId) throw new Error('已有原处理记录，请先查询并完成。')
    if (kind !== 'lock' && value.redemptionId !== redemption?.id) throw new Error('原处理记录已变化，请重新查询。')
    const intentKey = crypto.randomUUID()
    save({ ...value, pending: { kind, key: intentKey } })
    try { if (kind === 'lock') {
      const currentCode = code; setCode(''); setChecked(false)
      const result = await controller.api.request<{ redemptionId: string }>('/work/locks', { intentKey, code: currentCode })
      save({ redemptionId: result.redemptionId, pending: { kind, key: intentKey } })
    } else {
      if (!value.redemptionId) throw new Error('缺少原处理记录')
      await controller.api.request(`/work/redemptions/${encodeURIComponent(value.redemptionId)}/${kind}`, { intentKey })
    } } catch (e) {
      // These backend errors are emitted before acceptance / inside a rolled-back transaction.
      // Transport errors, generic 5xx and intent conflicts remain query-only.
      const rejected = ['CODE_UNAVAILABLE', 'CODE_RATE_LIMITED', 'PAUSED', 'FORBIDDEN', 'UNAUTHENTICATED', 'WALLET_PROOF_REQUIRED', 'WALLET_BINDING_REQUIRED', 'LOCK_NOT_FINALIZED', 'HANDOFF_REQUIRED']
      if (e instanceof OwnerApiError && rejected.includes(e.code ?? '') && load().pending?.key === intentKey) {
        save(value)
        if (e.code === 'CODE_UNAVAILABLE') throw new Error('展示码已失效，本次未受理。请让领取者重新展示当前码，再核验。')
      }
      throw e
    }
    await refresh()
  }
  return <div className="wallet-panel" aria-label="本店核销与交餐">
    <h2>本店验券、交餐与申报</h2><p>老板逐步操作；锁券和申报由后台 operator 代发，不是老板钱包交易签名。</p>
    <label>领取者当前展示码<input value={code} inputMode="numeric" maxLength={8} autoComplete="off" onChange={e => { setCode(e.target.value); setChecked(false) }} /></label>
    <p>展示码仅在本页临时使用，不写入网址或浏览器存储。</p>
    <div className="wallet-actions">
      <button disabled={busy || !verified || !/^\d{8}$/.test(code) || !!journal.pending || !!journal.redemptionId} onClick={() => void run(async () => { await controller.api.request('/work/prechecks', { code }); setChecked(true) })}>只读核验展示码</button>
      <button disabled={busy || !verified || !checked || !!journal.pending || !!journal.redemptionId} onClick={() => void run(() => write('lock'))}>确认锁定这一券（后台代发）</button>
      <button disabled={busy} onClick={() => void run(refresh)}>查询原处理与本店应付款</button>
    </div>
    {checked && <p role="status">展示码预检通过，尚未锁定或扣款。</p>}
    {journal.pending && <p role="status">原 {journal.pending.kind} 结果待核；只查原意图，必要时联系维护人员。</p>}
    {redemption && <div><p>原处理 <code>{redemption.id}</code></p><p>处理状态：{redemption.status}</p>
      <div className="wallet-actions">
        <button disabled={busy || !verified || !!journal.pending || redemption.status !== 'LOCKED'} onClick={() => void run(() => write('handoff'))}>声明本人已交餐</button>
        <button disabled={busy || !verified || !!journal.pending || redemption.status !== 'HANDED_OFF'} onClick={() => void run(() => write('report'))}>确认申报交餐（后台代发）</button>
        <button disabled={busy || !!journal.pending || !['REPORTED', 'SETTLED', 'LOCK_FAILED'].includes(redemption.status)} onClick={() => void run(async () => {
          const value = load()
          if (value.pending || value.redemptionId !== redemption.id) throw new Error('原处理记录已变化，请重新查询。')
          save({}); setRedemption(undefined); setCode(''); setChecked(false)
        })}>开始处理下一券</button>
      </div><p>锁券最终确认后才可交餐；声明、申报和付款是分开的动作。链记录不证明实物交付。</p></div>}
    <h3>本店已确认应付款</h3>
    {payables.map(item => <div className="wallet-payable" key={item.id}><p><code>{item.id}</code> · {item.status}</p><button disabled={busy || item.status === 'SETTLED'} onClick={() => onPayable(item.id)}>选择这笔应付款</button></div>)}
    {!payables.length && <p>查询后仅显示已最终确认的本店申报。</p>}
    {error && <p role="alert">{error}</p>}
  </div>
}

export function OwnerWorkApp() {
  const [username, setUsername] = useState('owner-a'), [password, setPassword] = useState('')
  const [controller, setController] = useState<OwnerWalletController>(), [selected, setSelected] = useState('')
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  async function login() {
    setBusy(true); setError('')
    try {
      if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) throw new Error('仅可在本机打开')
      const response = await fetch('/api/v1/auth/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })
      if (!response.ok) throw new Error('本地工作登录失败')
      const session = await response.json(); setPassword('')
      if (session.role !== 'owner') throw new Error('需要本店老板身份')
      const config = await fetch('/api/v1/config')
      if (!config.ok) throw new Error('部署配置不可用')
      const deployment = await config.json() as OwnerDeployment
      const provider = (window as Window & { ethereum?: Provider }).ethereum
      if (!provider) throw new Error('未发现测试用 EIP1193 provider；页面不会安装钱包、创建密钥或自动连接。')
      setController(new OwnerWalletController({ deployment, provider, api: ownerHttpApi(() => session.csrfToken), store: localStorage, origin: location.origin, actorId: session.actorId }))
    } catch (e) { setError(e instanceof Error ? e.message : '登录失败') }
    finally { setBusy(false) }
  }
  return controller ? <WalletOwner controller={controller} selectedRedemption={selected} providerLabel="独立 Anvil 31337 工作台；真实扩展与人类确认尚未验收"><WorkPanel controller={controller} onPayable={setSelected} /></WalletOwner>
    : <main className="owner-wallet"><h1>餐馆老板 · 本地链经营入口</h1><p>专用 Anvil 31337、虚构账号与测试资产，与5173模拟页面分开。需自行启动专用后台，请勿使用真实钱包。</p>
      <p>登录不会连接钱包或请求签名；后续每一步均由本人主动操作。</p>
      <form onSubmit={e => { e.preventDefault(); void login() }}><label>本地老板账号<input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" /></label>
        <label>本地工作密码<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></label><button disabled={busy || !password}>登录本地工作账号</button></form>{error && <p role="alert">{error}</p>}</main>
}
