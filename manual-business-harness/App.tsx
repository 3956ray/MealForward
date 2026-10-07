import {useEffect, useRef, useState} from 'react'
import {QRCodeSVG} from 'qrcode.react'
import {Wallet, type Provider, type Review} from './wallet'
import {Scanner} from './Scanner'
import './style.css'

type Status = {status: string; missing: string[]; runId: string; sourceSha: string; runtimeAuthorized: boolean; identityConfigured: boolean; message: string}
type Role = 'support'|'partner'|'recipient'|'owner'|'ledger'
const labels: Record<Role, string> = {support: '支持一餐', partner: '机构发券', recipient: '领取餐券', owner: '餐馆工作台', ledger: '公开餐账'}
const steps = ['支持者确认餐款', '机构发行与私密链接', '领取者展示到店码', '老板核验并确认交餐', '老板钱包逐笔结算']

export default function App() {
  const initialHash = useRef(location.hash)
  const secret = useRef(initialHash.current.startsWith('#/recipient/') ? initialHash.current.slice(12) : '')
  const initialRole = initialHash.current.split('/')[1] as Role
  const [role, setRole] = useState<Role>(secret.current ? 'recipient' : initialRole in labels ? initialRole : 'support')
  const [status, setStatus] = useState<Status|null>(null), [ledger, setLedger] = useState<any>(null)
  const [result, setResult] = useState<any>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [account, setAccount] = useState(''), [code, setCode] = useState(''), [ref, setRef] = useState('')
  const [login, setLogin] = useState(''), [credential, setCredential] = useState('')
  const [review, setReview] = useState<Review|null>(null), [op, setOp] = useState(''), [qr, setQr] = useState<any>(null)
  const [link, setLink] = useState(''), [owner, setOwner] = useState<any>(null), [challenge, setChallenge] = useState<any>(null)
  const csrf = useRef<Record<string,string>>({}), terminal = useRef(''), activeRole = useRef(role)
  const keys = useRef<Record<string,string>>({})
  const wallet = useRef<Wallet|null>(null)
  const key = (kind: string) => keys.current[kind] ||= crypto.randomUUID()
  activeRole.current = role
  async function api(path: string, data?: unknown) {
    const response = await fetch('/api/cp28/'+path, {method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin',
      headers: {'Content-Type': 'application/json', 'X-CSRF-Token': csrf.current[activeRole.current] || '', 'X-Terminal-Cap': terminal.current},
      ...(data === undefined ? {} : {body: JSON.stringify(data)})})
    const value = await response.json()
    if (!response.ok) throw new Error(value.message || '原操作暂不可用')
    if (value.csrfToken) csrf.current[activeRole.current] = value.csrfToken
    if (value.terminalCap) terminal.current = value.terminalCap
    return value
  }
  async function refresh() {
    const [s, l] = await Promise.all([api('status'), api('public')]); setStatus(s); setLedger(l)
  }
  useEffect(() => {
    if (secret.current) history.replaceState(null, '', '/#/recipient')
    void refresh().catch(e => setError(String(e.message)))
    return () => wallet.current?.dispose()
  }, [])
  useEffect(() => {
    if (!qr) return
    const timer = window.setTimeout(() => setQr(null), Math.max(0, qr.expiresAt*1000-Date.now()))
    return () => window.clearTimeout(timer)
  }, [qr])
  async function run(action: () => Promise<unknown>) {
    if (busy) return; setBusy(true); setError('')
    try { const value = await action(); if (value !== undefined) setResult(value); await refresh() }
    catch (e) { setError(e instanceof Error ? e.message : '状态不可用，请查询原操作') }
    finally { setBusy(false) }
  }
  function getWallet() {
    if (!wallet.current) {
      const provider = (window as Window & {ethereum?: Provider}).ethereum
      if (!provider?.isMetaMask) throw new Error('请在支持 MetaMask 的浏览器打开此入口')
      wallet.current = new Wallet(provider, api, () => {
        setReview(null); setChallenge(null); setAccount(''); setError('钱包账户或网络已变化，请核对原操作')
        void api('owner/proof/invalidate', {}).catch(() => {})
      })
    }
    return wallet.current
  }
  const enabled = status?.runtimeAuthorized === true
  const button = (text: string, action: () => Promise<unknown>, requireReady = true) =>
    <button disabled={busy || (requireReady && !enabled)} onClick={() => void run(action)}>{text}</button>
  async function accepted(path: string, data: unknown) {
    const v = await api(path, data); if (v.operation?.id) setOp(v.operation.id); return v
  }
  async function prepareWallet(id = op) { const value = await api(`operations/${id}/review`, {}); setReview(value); return value }
  return <main>
    <header><span className="brand">mealforward · 留膳</span><span className="tag">新一轮业务测试 · Monad Testnet</span></header>
    <section className="intro"><p className="eyebrow">一份支持，走完一餐的记录</p><h1>从支持一餐，到餐馆结算。</h1><p>四个角色，同一份可核对的餐账。每一步确认后，再进入下一步。</p></section>
    <section className={enabled ? 'notice ready' : 'notice'} aria-live="polite"><strong>{status?.message || '正在读取当前准备状态…'}</strong>
      {!enabled && <p>当前是准备入口，尚不能执行完整手动测试。真实钱包测试：未执行。</p>}
      {!!status?.missing.length && <ul>{status.missing.map(item => <li key={item}>{item}</li>)}</ul>}
      {button('刷新准备状态', refresh, false)}</section>
    <ol className="steps">{steps.map((step, i) => <li key={step}><span>{i+1}</span>{step}</li>)}</ol>
    <nav aria-label="业务角色">{(Object.keys(labels) as Role[]).map(r => <button key={r} disabled={busy} aria-current={role === r ? 'page' : undefined} onClick={() => {setRole(r); setResult(null); setReview(null); history.replaceState(null, '', '/#/'+r)}}>{labels[r]}</button>)}</nav>
    <section className="panel"><h2>{labels[role]}</h2>
      {(role === 'partner' || role === 'owner') && <div className="login"><p>使用已配置的可信工作身份登录。钱包地址本身不代表工作身份。</p>
        <label>工作身份<input value={login} onChange={e => setLogin(e.target.value)} autoComplete="username"/></label>
        <label>登录凭证<input type="password" value={credential} onChange={e => setCredential(e.target.value)} autoComplete="current-password"/></label>
        {button('登录工作身份', async () => {const v = await api(`${role}/login`, {username: login, credential}); setCredential(''); return v}, !status?.identityConfigured)}
        {button('查看当前工作状态', async () => {await api(`${role}/session`); const v = await api(`${role}/state`); if (role === 'owner') setOwner(v); return v}, !status?.identityConfigured)}</div>}
      {role === 'support' && <><p>本轮候选为一餐 0.001 测试 MON；Gas 另计，以批准后的逐笔审核为准。</p>
        {button('恢复原支持记录', async () => {const v = await api('support/state'); if (v.operation?.id) setOp(v.operation.id); return v}, false)}
        {button('连接本人 MetaMask', async () => {const a = await getWallet().connect(); setAccount(a); return {account: a}})}<p className="address">{account}</p>
        {button('准备一餐支持', async () => {const v = await accepted('support/prepare', {clientRequestId: key('fund'), account, chainId: 10143, quantity: 1, ruleVersion: ledger?.ruleVersion, walletKind: 'metamask'}); await prepareWallet(v.operation.id); return v})}</>}
      {role === 'partner' && <><label>已核准的领取关联<input value={ref} onChange={e => setRef(e.target.value)}/></label>
        {button('发行一张餐券', () => accepted('partner/issue', {intentKey: key('issue'), recipientRef: ref, batchId: ledger?.batch?.id, quantity: 1, quotePriceWei: '1000000000000000', ruleVersion: ledger?.ruleVersion}))}
        {button('生成私密领取链接', async () => {const v = await api('partner/invite', {rotate: false}); setLink(v.url); return {expiresAt: v.expiresAt}})}
        {link && <label>仅向领取者私下交付<input readOnly value={link}/></label>}</>}
      {role === 'recipient' && <><p>领取者无需注册、邮箱或钱包。请从机构私下交付的原链接进入。</p>
        {button('查看我的餐券', () => api('recipient/exchange', {secret: secret.current}))}
        {button('生成到店二维码 / 手输码', async () => {const v = await api('recipient/display', {}); setQr(v); return {expiresAt: v.expiresAt}})}
        {qr && <div className="qr"><QRCodeSVG value={qr.qrPayload} size={180}/><strong>{qr.manualCode}</strong><p>120 秒有效，更新后旧码失效。请在餐馆当面展示。</p></div>}
        {button('退出餐券', async () => {const v = await api('recipient/logout', {}); setQr(null); return v})}</>}
      {role === 'owner' && <><p>后台服务代发锁定和申报；最后结算由绑定的老板钱包本人确认。</p>
        {button('准备老板钱包证明', async () => {const v = await api('owner/proof/prepare', {}); setChallenge(v); return v})}
        {challenge && <div className="review"><pre>{challenge.message}</pre>{button('核对后签署身份证明', async () => {await getWallet().prove(challenge); setChallenge(null); return {verified: true}})}</div>}
        <label>领取者当面展示的 6 位码<input value={code} maxLength={6} inputMode="numeric" onChange={e => setCode(e.target.value)}/></label>
        <Scanner disabled={!enabled || busy} onCode={setCode} onError={setError}/>
        {button('核验展示码', () => api('owner/precheck', {code}))}
        {button('确认有餐，取得处理权', () => accepted('owner/lock', {code, intentKey: key('lock')}))}
        {button('声明已交餐', () => api('owner/handoff', {intentKey: key('handoff')}))}
        {button('确认交餐声明并申报', () => accepted('owner/report', {intentKey: key('report'), confirmStatement: true}))}
        {button('准备老板钱包结算', async () => {const v = await accepted('owner/settle', {intentKey: key('settle')}); await prepareWallet(v.operation.id); return v})}
        {owner?.terminalVersion > 0 && button('确认原终端已停止，接管原处理', () => api('owner/takeover', {confirmed: true, expectedVersion: owner.terminalVersion}))}</>}
      {role === 'ledger' && <><p>仅显示已核验金额，不公开领取关联和私密链接。</p><div className="balances">{[['F', '累计支持'], ['A', '可发行'], ['R', '已发行'], ['H', '待结算'], ['S', '已结算']].map(([k, label]) => <div key={k}><span>{label}</span><strong>{ledger?.batch ? (Number(ledger.batch[k])/1e18).toFixed(3) : '—'}</strong><small>测试 MON</small></div>)}</div>{button('刷新公开餐账', refresh, false)}</>}
      {review && <div className="review"><h3>原交易审核</h3><dl><dt>动作</dt><dd>{review.kind}</dd><dt>付款地址</dt><dd>{review.transaction?.from}</dd><dt>目标合约</dt><dd>{review.transaction?.to}</dd><dt>本金 / 最坏 Gas（wei）</dt><dd>{review.transaction?.value} / {review.transaction && (BigInt(review.transaction.gas)*BigInt(review.transaction.maxFeePerGas)).toString()}</dd></dl>
        {button('已核对，打开本人钱包确认', async () => {const hash = await getWallet().send(review); setReview(null); return {txHash: hash, state: '等待核验'}})}</div>}
      {role !== 'recipient' && role !== 'ledger' && <div className="original"><label>原操作 ID<input value={op} onChange={e => setOp(e.target.value)}/></label>
        {(role === 'partner' || role === 'owner') && button('明确请求后台执行原发行 / 锁定 / 申报', () => api(`operations/${op}/dispatch`, {}))}
        {button('只查询原操作', () => api(`operations/${op}`), false)}{button('核验原交易（至少间隔 5 秒）', () => api(`operations/${op}/observe`, {}), false)}</div>}
      {error && <p className="error" role="alert">{error}</p>}{busy && <p role="status">正在处理原请求…</p>}
      {result && <details open><summary>本次结果</summary><pre>{JSON.stringify(result, null, 2)}</pre></details>}
    </section><footer>运行标识：{status?.runId || '—'} · 代码：{status?.sourceSha?.slice(0,12) || '—'}<br/>新一轮独立环境；准备状态不代表真实交易完成。</footer>
  </main>
}
