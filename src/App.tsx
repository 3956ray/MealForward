import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { api, intentKey } from './api'
import type { ActionResult, Actor, Operation, Redemption, State, VoucherView } from './api'

const pages = ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P10', 'P11', 'P12', 'P13', 'P14'] as const
type Page = typeof pages[number]
type Route = { page: Page; tail: string | null }

const titles: Record<Page, string> = {
  P01: '首页', P02: '支持一份餐', P03: '原操作查询', P04: '本批餐账',
  P05: '我的单份餐券', P06: '模拟角色入口', P07: '资格与发券', P08: '定向交付',
  P09: '门店预检查', P10: '处理与申报', P11: '门店结算', P12: '联系与求助',
  P13: '暂停状态', P14: '社区公告',
}

const actors: Array<{ id: Exclude<Actor, 'recipient'>; label: string; detail: string; page: Page }> = [
  { id: 'supporter', label: '支持者', detail: '模拟支持与查看自己的原操作', page: 'P02' },
  { id: 'partner', label: '社区伙伴', detail: '私有资格核对、发券与交付', page: 'P07' },
  { id: 'staff_a', label: '店员甲', detail: '预检查、唯一处理权与交餐申报', page: 'P09' },
  { id: 'staff_b', label: '店员乙', detail: '用于演练两店员争同一张券', page: 'P09' },
  { id: 'settler', label: '结算角色', detail: '只对已申报的本店应付款模拟结算', page: 'P11' },
  { id: 'admin', label: '管理只读', detail: '查看预置暂停范围，不可恢复或改账', page: 'P13' },
]

function parseRoute(): Route {
  const [candidate, encodedTail] = location.hash.replace(/^#\/?/, '').split('/')
  let tail: string | null = null
  try { tail = encodedTail ? decodeURIComponent(encodedTail) : null } catch { tail = null }
  return { page: pages.includes(candidate as Page) ? candidate as Page : 'P01', tail }
}

function navigate(page: Page, tail?: string) {
  location.hash = `/${page}${tail ? `/${encodeURIComponent(tail)}` : ''}`
}

const fmt = (value?: number | null) => value ? new Date(value * 1000).toLocaleString('zh-CN', { hour12: false }) : '尚无记录'
const fmtDay = (value?: number | null) => value ? new Date(value * 1000).toLocaleDateString('zh-CN') : '尚无记录'
const money = (value?: number | null) => `${value ?? 0} DU`
const statusText: Record<string, string> = {
  SUCCESS: '已模拟确认', UNKNOWN: '结果未知 · 只查原操作', FAILED: '未成功',
  WAITING_CONFIRMATION: '待显式确认处理权', active: '可用', locked: '处理权待确认/已确认',
  handoff: '店员已声明交餐，待申报', report_unknown: '申报结果未知', reported: '已申报，待模拟结算',
  settlement_unknown: '结算结果未知', settled: '已模拟结算', pending: '待交付', sent: '机构已执行发送',
  handover: '机构已执行当面交接', acknowledged: '持链接者自称收到', failed: '交付失败待联系',
}
const label = (status?: string | null) => status ? statusText[status] ?? status : '未开始'

function Link({ page, children, className, tail }: { page: Page; children: React.ReactNode; className?: string; tail?: string }) {
  return <a href={`#/${page}${tail ? `/${encodeURIComponent(tail)}` : ''}`} className={className}>{children}</a>
}

function MealArt() {
  return <div className="meal-scene" role="img" aria-label="一份虚构演示热餐：米饭、蔬菜、主菜和热汤">
    <div className="tray">
      <div className="dish greens"><i /><i /><i /><i /><i /><i /></div>
      <div className="dish soup"><span /><span /><span /></div>
      <div className="dish rice"><span /></div>
      <div className="dish main-dish"><i /><i /><i /><i /><i /><i /></div>
      <div className="tray-mark">留膳<br /><small>本地模拟餐食</small></div>
    </div>
  </div>
}

export default function App() {
  const [route, setRoute] = useState<Route>(parseRoute)
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem('mealforward-token'))
  const [state, setState] = useState<State | null>(null)
  const [voucher, setVoucher] = useState<VoucherView | null>(null)
  const [operation, setOperation] = useState<Operation | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [lastOperation, setLastOperation] = useState<Operation | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [supportOutcome, setSupportOutcome] = useState<'success' | 'unknown' | 'failure'>('success')
  const [reportOutcome, setReportOutcome] = useState<'success' | 'unknown' | 'failure'>('success')
  const [settleOutcome, setSettleOutcome] = useState<'success' | 'unknown' | 'failure'>('success')
  const [code, setCode] = useState('')
  const [check, setCheck] = useState<ActionResult['check']>(undefined)
  const [hasMeal, setHasMeal] = useState(false)
  const [caseKind, setCaseKind] = useState('餐券或交付求助')
  const [caseText, setCaseText] = useState('')
  const [caseVoucherId, setCaseVoucherId] = useState('')
  const exchangedInvite = useRef<string | null>(null)

  const actor = state?.work?.actor ?? null
  const role = state?.work?.role ?? null
  const batch = state?.batch
  const shop = state?.shop

  const refresh = useCallback(async (usingToken: string | null = token) => {
    try {
      const next = await api<State>('/state', usingToken)
      setState(next)
      setError(null)
      return next
    } catch (e) {
      const apiError = e as Error & { status?: number }
      if (apiError.status === 401 && usingToken) {
        sessionStorage.removeItem('mealforward-token')
        setToken(null)
        setState(await api<State>('/state', null))
        setMessage('旧演示会话已失效，请重新选择模拟角色。')
        return null
      }
      setError(apiError.message)
      return null
    }
  }, [token])

  const refreshVoucher = useCallback(async (usingToken: string | null = token) => {
    if (!usingToken) { setVoucher(null); return }
    try {
      const next = await api<VoucherView>('/voucher', usingToken)
      setVoucher(next)
      setError(null)
    } catch (e) {
      setVoucher(null)
      setError((e as Error).message)
    }
  }, [token])

  useEffect(() => {
    const onHash = () => setRoute(parseRoute())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (route.page === 'P05' && route.tail) {
      const secret = route.tail
      if (exchangedInvite.current === secret) return
      exchangedInvite.current = secret
      history.replaceState(null, '', `${location.pathname}${location.search}#/P05`)
      setRoute({ page: 'P05', tail: null })
      setBusy(true)
      api<{ token: string }>('/invite/exchange', null, { secret })
        .then(async result => {
          sessionStorage.setItem('mealforward-token', result.token)
          setToken(result.token)
          setMessage('已在本浏览器打开这一张演示餐券；无需钱包或平台注册。')
          await refresh(result.token)
          await refreshVoucher(result.token)
        })
        .catch(e => setError(`私密邀请无法打开：${(e as Error).message}`))
        .finally(() => setBusy(false))
      return
    }
    void refresh()
  // Only bootstrap the current browser session; other route changes have focused loads below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (route.page === 'P05' && role === 'recipient' && !route.tail) void refreshVoucher()
  }, [route.page, route.tail, role, refreshVoucher])

  useEffect(() => {
    if (route.page !== 'P03' || !route.tail || !token) { setOperation(null); return }
    api<{ operation: Operation }>(`/operations/${encodeURIComponent(route.tail)}`, token)
      .then(result => { setOperation(result.operation); setError(null) })
      .catch(e => { setOperation(null); setError((e as Error).message) })
  }, [route.page, route.tail, token])

  async function selectActor(selected: Exclude<Actor, 'recipient'>, target: Page) {
    setBusy(true); setError(null); setMessage(null); setVoucher(null); setCheck(undefined); setLastOperation(null); setOperation(null)
    try {
      const session = await api<{ token: string }>('/session', null, { actor: selected })
      sessionStorage.setItem('mealforward-token', session.token)
      setToken(session.token)
      await refresh(session.token)
      navigate(target)
      setMessage(`已进入“${actors.find(a => a.id === selected)?.label}”虚构角色。此选择不是现实身份认证。`)
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  async function perform(fields: Record<string, unknown>, options?: { page?: Page; stay?: boolean }) {
    if (!token) { navigate('P06'); return }
    setBusy(true); setError(null); setMessage(null)
    try {
      let intentStorageKey: string | null = null
      let payload = fields
      if (fields.action !== 'precheck') {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([actor, fields])))
        const signature = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
        intentStorageKey = `mealforward-intent-${signature}`
        const stableKey = sessionStorage.getItem(intentStorageKey) ?? intentKey()
        sessionStorage.setItem(intentStorageKey, stableKey)
        payload = { ...fields, intent_key: stableKey }
      }
      const result = await api<ActionResult>('/act', token, payload)
      if (intentStorageKey && result.operation && result.operation.status !== 'UNKNOWN') sessionStorage.removeItem(intentStorageKey)
      setMessage(result.message)
      if (result.operation) setLastOperation(result.operation)
      if (result.check) setCheck(result.check)
      await refresh(token)
      if (role === 'recipient') await refreshVoucher(token)
      if (options?.page) navigate(options.page, options.page === 'P03' ? result.operation?.id : undefined)
      else if (result.operation && !options?.stay && ['UNKNOWN', 'FAILED'].includes(result.operation.status)) navigate('P03', result.operation.id)
      return result
    } catch (e) {
      const failure = (e as Error).message
      await refresh(token)
      setError(failure)
      return null
    } finally { setBusy(false) }
  }

  async function reset(scenario: 'normal' | 'paused') {
    setBusy(true); setError(null); setMessage(null)
    try {
      await api('/reset', null, { scenario })
      sessionStorage.removeItem('mealforward-token')
      setToken(null); setVoucher(null); setCheck(undefined); setLastOperation(null)
      await refresh(null)
      navigate('P06')
      setMessage(`已重置为“${scenario === 'normal' ? '正常主链路' : '预置暂停'}”虚构样例。旧会话已清除，请重新选择角色。`)
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  const page = route.page
  const needRole: Partial<Record<Page, string[]>> = {
    P03: ['supporter', 'partner', 'staff', 'settler', 'recipient'],
    P05: ['recipient'], P07: ['partner'], P08: ['partner'], P09: ['staff'],
    P10: ['staff'], P11: ['staff', 'settler'], P13: ['admin'],
  }
  const allowed = !needRole[page] || !!role && needRole[page]!.includes(role)
  const navItems: Array<{ page: Page; name: string }> = [
    { page: 'P01', name: '首页' }, { page: 'P04', name: '公开餐账' },
    { page: 'P12', name: '联系求助' }, { page: 'P06', name: '工作入口' },
  ]

  const roleNav = useMemo(() => {
    if (role === 'partner') return ['P07', 'P08'] as Page[]
    if (role === 'staff') return ['P09', 'P10', 'P11'] as Page[]
    if (role === 'settler') return ['P11'] as Page[]
    if (role === 'recipient') return ['P05'] as Page[]
    if (role === 'admin') return ['P13'] as Page[]
    if (role === 'supporter') return ['P02'] as Page[]
    return [] as Page[]
  }, [role])

  return <div className="app-shell">
    <div className="simulation-ribbon">● 本地模拟 · 所有店、机构、角色、餐券与 DU 均为虚构 · 无真实支付或外部发送</div>
    <header className="site-header">
      <Link page="P01" className="brand"><span className="brand-mark" aria-hidden="true">◡</span><span><strong>留膳</strong><small>mealforward</small></span></Link>
      <nav className="top-nav" aria-label="主导航">{navItems.map(item => <Link key={item.page} page={item.page} className={page === item.page ? 'active' : ''}>{item.name}</Link>)}</nav>
      <Link page="P06" className="actor-pill">{actor ? `${role === 'recipient' ? '持券链接' : actors.find(a => a.id === actor)?.label ?? actor} · 切换` : '选择模拟角色'}</Link>
    </header>
    {roleNav.length > 0 && <nav className="role-nav" aria-label="角色工作导航">{roleNav.map(id => <Link key={id} page={id} className={page === id ? 'active' : ''}>{titles[id]}</Link>)}</nav>}
    {state?.paused && <div className="pause-strip">预置暂停演练：新入款、发券、新锁及新付款被服务端阻断。既有 R/H 和原操作查询保留。<Link page="P04">查看餐账</Link></div>}
    <main id="main-content">
      {error && <div className="notice error" role="alert"><strong>操作未完成</strong><span>{error}</span><button type="button" className="text-button" onClick={() => void refresh()}>重查服务端状态</button></div>}
      {message && <div className="notice success" role="status"><span>{message}</span>{lastOperation && <Link page="P03" tail={lastOperation.id}>查看原操作 {lastOperation.id}</Link>}</div>}
      {!state ? <section className="panel empty"><h1>连接本机模拟服务</h1><p>页面正在读取服务端状态。请同时运行 Vite 前端与 127.0.0.1:8765 的 Python API；无法连接时上方会显示错误。</p><button type="button" className="button" onClick={() => void refresh()}>重新连接</button></section> : !allowed ? <section className="panel empty"><p className="eyebrow">{page} · 受限视图</p><h1>此页面需要对应的演示身份</h1><p>当前{actor ? `为 ${actor}` : '未选择角色'}。服务端会再次核验角色与对象范围；切换后需查询原操作以恢复进度。</p><Link page="P06" className="button">选择模拟角色</Link>{page === 'P05' && <p className="fineprint">持券页只能通过机构提供的本地私密邀请打开。</p>}</section> : <>
        {page === 'P01' && <section className="home-page">
          <div className="hero-meta"><span>{shop?.name} × {shop?.partner}</span><small>虚构餐食与社区伙伴 · 本地模拟</small></div>
          <h1>留一膳，待一人。</h1>
          <p className="hero-lead">社区伙伴安排餐券，餐厅负责供餐。一膳之微，亦可为善。</p>
          <MealArt />
          <div className="hero-select" role="group" aria-label="选择支持份数">{[1, 5, 10, 20].map(n => <button key={n} type="button" className={quantity === n ? 'selected' : ''} onClick={() => setQuantity(n)}>{n} 份</button>)}</div>
          {state.paused ? <span className="button hero-cta button-disabled">新支持入口已暂停</span> : <Link page="P02" className="button hero-cta">查看支持 {quantity} 份餐的模拟报价 <span aria-hidden="true">→</span></Link>}
          <p className="hero-note">电子演示版需联网设备查看餐券；领取无需钱包或平台注册。没有实际餐食交付。</p>
          <div className="hero-stats"><div><small>本批支持</small><strong>{batch && Math.floor(batch.F / batch.price)} <em>份</em></strong></div><div><small>机构已安排</small><strong>{batch && Math.floor((batch.R + batch.H + batch.S) / batch.price)} <em>份</em></strong></div><div><small>待安排额度</small><strong>{batch && Math.floor(batch.available / batch.price)} <em>份</em></strong></div><Link page="P04">查看这批餐账 →</Link></div>
          <div className="home-foot"><span>需要餐食安排或使用帮助，请联系社区伙伴。</span><Link page="P12">查看联系与求助 →</Link><Link page="P14">社区公告</Link></div>
        </section>}

        {page === 'P02' && <section className="page-grid"><div className="page-intro"><p className="eyebrow">P02 · 支持者</p><h1>为一份热餐留位</h1><p>这里使用虚构 DU 和模拟结果。确认后由服务端写入原操作与餐账，绝无真实付款、钱包连接或手续费扣取。</p><Link page="P01">← 返回首页</Link></div><div className="panel form-panel"><h2>模拟支持报价</h2><label className="field">份数 <input type="number" min="1" max="20" value={quantity} onChange={e => setQuantity(Number(e.target.value))} /></label><div className="quote-row"><span>标准餐单价</span><strong>{money(batch?.price)}</strong></div><div className="quote-row"><span>净餐款（进入 F/A）</span><strong>{money(Number.isInteger(quantity) ? quantity * (batch?.price ?? 0) : 0)}</strong></div><div className="quote-row"><span>演示费用</span><strong>0 DU</strong></div><p className="fineprint">单价与规则版本由当前批次提供：{batch?.rule_version}。修改份数后以新报价提交；旧报价若变化会由服务端拒绝。</p><label className="field">本地结果演练 <select value={supportOutcome} onChange={e => setSupportOutcome(e.target.value as typeof supportOutcome)}><option value="success">模拟成功</option><option value="unknown">模拟结果未知</option><option value="failure">模拟失败</option></select></label>{role === 'supporter' ? <button type="button" className="button full" disabled={busy || state.paused || !Number.isInteger(quantity) || quantity < 1 || quantity > 20 || batch!.F > 0} onClick={() => void perform({ action: 'support', quantity, outcome: supportOutcome, quote_price: batch!.price, rule_version: batch!.rule_version }, { page: 'P03' })}>确认模拟支持</button> : <Link page="P06" className="button full">先选择模拟支持者</Link>}{batch!.F > 0 && <p className="fineprint">此单批样例已有支持记录；如需重跑，前往工作入口重置虚构数据。</p>}{state.paused && <p className="fineprint">当前预置暂停，服务端拒绝新入款。</p>}</div></section>}

        {page === 'P03' && <section className="narrow-page"><p className="eyebrow">P03 · 原操作</p><h1>查原操作，不重复提交</h1><p>结果未知时保留原 ID，只刷新这一笔。此页面不发起新的入款、申报或付款。</p>{route.tail ? <div className="panel"><p className="micro">原操作 ID</p><code className="break-code">{route.tail}</code>{operation ? <><div className="detail-list"><div><span>动作</span><strong>{operation.action}</strong></div><div><span>状态</span><strong>{label(operation.status)}</strong></div><div><span>目标</span><strong>{operation.target ?? '未生成目标'}</strong></div><div><span>创建时间</span><strong>{fmt(operation.created_at)}</strong></div><div><span>原角色</span><strong>{operation.actor}</strong></div></div><p className="fineprint">原业务意图键由浏览器单次动作生成，服务端按角色和作用域保存。查询本身不改变资金状态。</p></> : <p>正在读取可访问的原操作，或本角色无权查看。</p>}<button type="button" className="button secondary" disabled={busy} onClick={async () => { try { const result = await api<{ operation: Operation }>(`/operations/${encodeURIComponent(route.tail!)}`, token); setOperation(result.operation); setError(null); await refresh(token) } catch (e) { setError((e as Error).message) } }}>仅刷新此原操作</button></div> : <div className="panel"><p>请从刚完成的操作或角色工作页进入原操作。仅支持者会看到自己的操作列表。</p>{state.work?.operations?.map(op => <Link key={op.id} page="P03" tail={op.id} className="list-link"><span>{op.action} · {label(op.status)}</span><code>{op.id}</code></Link>)}</div>}<Link page="P04">查看公开餐账 →</Link></section>}

        {page === 'P04' && <section className="narrow-page"><p className="eyebrow">P04 · 公开去身份餐账</p><h1>每一份餐，都有清楚去向</h1><p>以下仅为单批虚构 DU 状态，不展示领取关联、渠道、券号或私密邀请。申报是店员声明，不能推断指定自然人实际就餐。</p><div className="ledger-grid">{([['F', '本批累计支持'], ['A', '待安排'], ['R', '已发券待申报'], ['H', '商家已申报待结算'], ['S', '已模拟结算'], ['X', '已取消'], ['L', '暂占额度'], ['available', '可发餐款 A−L']] as const).map(([key, name]) => <div className="ledger-cell" key={key}><small>{name} · {key}</small><strong>{money(batch?.[key])}</strong></div>)}</div><div className="panel"><h2>守恒与来源</h2><p>F = A + R + H + S + X：{money(batch?.F)} = {money((batch?.A ?? 0) + (batch?.R ?? 0) + (batch?.H ?? 0) + (batch?.S ?? 0) + (batch?.X ?? 0))}</p><p>规则版本 {batch?.rule_version} · 最近公开更新日 {fmtDay(batch?.updated_at)}</p><p className="fineprint">L 只对可发余额暂占；普通咨询不会占 L。本轮无资金退款动作。</p></div><h2>去身份事件</h2>{state.events.length ? <div className="event-list">{state.events.map((event, index) => <div className="event-row" key={`${event.kind}-${event.created_at}-${index}`}><span><strong>{event.source}</strong><small>{fmt(event.created_at)}</small></span><b>{money(event.amount)}</b></div>)}</div> : <p className="muted">此虚构批次尚无已确认的资金事件。</p>}<Link page="P12">对餐账有疑问？联系与求助 →</Link></section>}

        {page === 'P05' && <section className="narrow-page"><p className="eyebrow">P05 · 私密单份视图</p><h1>这一份餐券</h1><p>仅凭机构提供的演示私密邀请打开。需联网设备，无需钱包或平台注册；请勿将链接当作身份核验。</p>{voucher ? <div className="panel voucher-card"><div className="voucher-top"><span>留膳 / mealforward</span><span>单份 · 本地模拟</span></div><h2>{voucher.meal}</h2><p>{voucher.shop} · {voucher.hours}</p><div className="detail-list"><div><span>券状态</span><strong>{label(voucher.status)}</strong></div><div><span>交付记录</span><strong>{label(voucher.delivery_status)}</strong></div></div>{voucher.code ? <div className="code-box"><QRCodeSVG value={voucher.code} size={150} includeMargin aria-label="短时演示展示码" /><span className="large-code">{voucher.code}</span><small>在线短时展示码 · 到期 {fmt(voucher.code_expires)}。店员可手输；刷新会由服务端重发新码。</small></div> : <div className="code-box no-code">当前不能显示可兑码。请查看状态并联系社区伙伴，不要尝试再次发行。</div>}<button type="button" className="button secondary" onClick={() => void refreshVoucher()}>刷新此券服务端状态</button>{voucher.delivery_status !== 'acknowledged' && ['sent', 'handover'].includes(voucher.delivery_status) && <button type="button" className="button subtle" disabled={busy} onClick={() => void perform({ action: 'acknowledge' }, { stay: true })}>自愿声明：持链接者已看到</button>}<p className="fineprint">{voucher.note} 机构执行发送/交接、此处自愿声明与实际自然人收到/吃到餐是不同的事。</p></div> : <div className="panel"><p>正在获取私密券状态。若邀请失效，请联系原社区伙伴。</p></div>}<Link page="P12">需要帮助 →</Link></section>}

        {page === 'P06' && <section className="narrow-page"><p className="eyebrow">P06 · 演示工作入口</p><h1>选择虚构角色</h1><p>每次切换都会取得新的本地假会话。它只用于演练页面与服务端权限，不代表真实认证或组织授权。</p><div className="actor-grid">{actors.map(a => <button className="actor-card" key={a.id} type="button" disabled={busy} onClick={() => void selectActor(a.id, a.page)}><strong>{a.label}</strong><span>{a.detail}</span><small>进入 {a.page} →</small></button>)}</div><div className="panel reset-panel"><h2>重置虚构样例</h2><p>重置会清空所有旧假会话与模拟记录。请在演示之间使用；旧操作 ID 将不可查询。</p><div className="button-row"><button type="button" className="button secondary" disabled={busy} onClick={() => void reset('normal')}>重置正常链路</button><button type="button" className="button secondary" disabled={busy} onClick={() => void reset('paused')}>载入预置暂停</button></div></div></section>}

        {page === 'P07' && <section className="narrow-page"><p className="eyebrow">P07 · 社区伙伴私有工作台</p><h1>按预置资格结论发一张券</h1><p>以下资格与渠道结论均由服务端预置为虚构样例，并非在此完成真实身份核验。演示规则 {batch?.rule_version}：服务计划已确认、当期额度至少 1、私人渠道已核对，且 A−L 足以覆盖一份餐。私有领取关联只在机构作用域显示。</p><div className="split-stats"><div><small>可发餐款 A−L</small><strong>{money(batch?.available)}</strong></div><div><small>一份餐款</small><strong>{money(batch?.price)}</strong></div></div>{state.work?.recipients?.map(rec => { const eligible = !!rec.eligible && rec.quota_remaining > 0 && !!rec.channel_verified; return <div className="panel recipient-row" key={rec.ref}><div><strong>{rec.ref}</strong><p>{rec.reason}</p><small>资格 {rec.eligible ? '已确认' : '不合格'} · 本期剩余 {rec.quota_remaining} · 渠道 {rec.channel_verified ? '已核对' : '未核对'} · {rec.rule_version}</small></div><button type="button" className="button" disabled={busy || !eligible || state.paused || (batch?.available ?? 0) < (batch?.price ?? 0)} onClick={() => void perform({ action: 'issue', recipient_ref: rec.ref }, { page: 'P08' })}>发行单份券</button></div> })}<p className="fineprint">按钮状态方便演示，实际资格、渠道、额度与暂停由服务端重验。后续家庭 N 券及真实资格政策尚未纳入本轮。</p><Link page="P08">查看原券与交付记录 →</Link></section>}

        {page === 'P08' && <section className="narrow-page"><p className="eyebrow">P08 · 机构私有交付</p><h1>把同一张券定向交付</h1><p>仅记录机构已执行模拟发送或当面交接。失败后再次分享仍用原券，不能据此宣称指定自然人收到。</p>{state.work?.vouchers?.length ? state.work.vouchers.map(v => <div className="panel" key={v.id}><div className="card-heading"><div><small>{v.recipient_ref} · 私有机构关联</small><h2>{v.id}</h2></div><span className="status-chip">{label(v.status)}</span></div><p>交付记录：<strong>{label(v.delivery_status)}</strong>{v.delivery_at && ` · ${fmt(v.delivery_at)}`}</p><div className="button-row"><button type="button" className="button secondary" disabled={busy || v.status !== 'active'} onClick={() => void perform({ action: 'deliver', voucher_id: v.id, method: 'sent' }, { stay: true })}>记录已执行私有发送</button><button type="button" className="button secondary" disabled={busy || v.status !== 'active'} onClick={() => void perform({ action: 'deliver', voucher_id: v.id, method: 'handover' }, { stay: true })}>记录已当面交接</button><button type="button" className="button subtle" disabled={busy || v.status !== 'active'} onClick={() => void perform({ action: 'deliver', voucher_id: v.id, method: 'failed' }, { stay: true })}>记录失败待联系</button>{['failed', 'sent', 'handover'].includes(v.delivery_status) && <button type="button" className="button subtle" disabled={busy || v.status !== 'active'} onClick={() => void perform({ action: 'deliver', voucher_id: v.id, method: 'reshare' }, { stay: true })}>再次分享原券</button>}</div><label className="field">本机演示私密邀请（仅供此流程，不实际发送）<input readOnly value={`${location.origin}${location.pathname}#/P05/${v.secret}`} onFocus={e => e.currentTarget.select()} /></label><p className="fineprint">私密链接会赋予此单券查看权。不要放入公开餐账；在不同浏览器标签页打开可演练独立角色。</p></div>) : <div className="panel empty"><p>当前机构尚无已发行单份券。</p><Link page="P07">前往资格与发券 →</Link></div>}</section>}

        {page === 'P09' && <section className="narrow-page"><p className="eyebrow">P09 · 店员预检查</p><h1>先看券，再决定是否交餐</h1><p>预检不锁券、不扣款。店员只见本店餐品与处理状态，不见领取关联、资格、私人渠道或邀请秘密。</p><div className="panel form-panel"><label className="field">持链接者出示的在线短码<input value={code} autoCapitalize="characters" placeholder="例如 A1B2C3" onChange={e => { setCode(e.target.value.toUpperCase().trim()); setCheck(undefined) }} /></label><button type="button" className="button secondary" disabled={busy || !code} onClick={() => void perform({ action: 'precheck', code }, { stay: true })}>只读预检查</button>{check && <div className="check-result"><strong>{check.status}</strong><p>{check.meal} · {check.shop}</p><small>券号 {check.voucher_id} · 预检未取得处理权</small><label className="checkbox"><input type="checkbox" checked={hasMeal} onChange={e => setHasMeal(e.target.checked)} /> 本店当前有这份餐，可以继续处理</label><button type="button" className="button" disabled={busy || !hasMeal || state.paused} onClick={() => void perform({ action: 'lock', code: check.code }, { page: 'P10' })}>申请唯一处理权</button></div>}<p className="fineprint">若本店缺餐，请勿申请处理权；联系社区伙伴安排。另一个店员若先取得锁，此码将失效。</p></div><Link page="P12">缺餐或异常求助 →</Link></section>}

        {page === 'P10' && <section className="narrow-page"><p className="eyebrow">P10 · 原店员处理</p><h1>确认处理权，再声明交餐</h1><p>只有持原锁的店员能显式确认、声明交餐和申报。未确认前不提供交餐许可；申报未知时只查原操作。</p>{state.work?.redemptions?.length ? state.work.redemptions.map(red => <RedemptionCard key={red.id} red={red} busy={busy} perform={perform} reportOutcome={reportOutcome} setReportOutcome={setReportOutcome} />) : <div className="panel empty"><p>此演示店员尚未取得任何券的处理权。</p><Link page="P09">返回预检查 →</Link></div>}<Link page="P11">查看本店 H/S →</Link></section>}

        {page === 'P11' && <section className="narrow-page"><p className="eyebrow">P11 · 本店应付与结算</p><h1>申报与结算分开看</h1><p>店员声明交餐并申报后才有 H；仅独立结算角色能模拟 H→S。失败或未知保留 H，未知只查原付款。</p><div className="split-stats"><div><small>已申报待结算 H</small><strong>{money(batch?.H)}</strong></div><div><small>已模拟结算 S</small><strong>{money(batch?.S)}</strong></div></div>{role === 'settler' && <p className="fineprint">预置本店虚构目的地：{state.work?.destination}</p>}{state.work?.payables?.length ? state.work.payables.map(pay => <div className="panel" key={pay.voucher_id}><div className="card-heading"><h2>{pay.voucher_id}</h2><span className="status-chip">{label(pay.status)}</span></div><p>原申报：{pay.report_operation ? <Link page="P03" tail={pay.report_operation}>{pay.report_operation}</Link> : '无'}</p><p>原付款：{pay.settlement_operation ? <Link page="P03" tail={pay.settlement_operation}>{pay.settlement_operation}</Link> : '尚无'}</p>{role === 'settler' && pay.status === 'reported' && (!pay.settlement_status || pay.settlement_status === 'FAILED') && <><label className="field">本地结果演练<select value={settleOutcome} onChange={e => setSettleOutcome(e.target.value as typeof settleOutcome)}><option value="success">模拟结算成功</option><option value="unknown">模拟结果未知</option><option value="failure">模拟结算失败</option></select></label>{pay.settlement_status === 'FAILED' && <p className="fineprint">上一次模拟结算已明确失败，H 保留；请先查看原付款。可主动发起一笔新的本地尝试。</p>}<button type="button" className="button" disabled={busy || state.paused} onClick={() => void perform({ action: 'settle', voucher_id: pay.voucher_id, outcome: settleOutcome }, { stay: true })}>{pay.settlement_status === 'FAILED' ? '再次发起模拟结算' : '发起本店模拟结算'}</button></>}{pay.status === 'settlement_unknown' && <p className="fineprint">结果未知。不要换操作 ID 再付，只查询上方原付款。</p>}</div>) : <div className="panel empty"><p>本店当前尚无已申报的应付款。</p></div>}</section>}

        {page === 'P12' && <section className="narrow-page"><p className="eyebrow">P12 · 联系与求助</p><h1>需要帮助，就从这里开始</h1><div className="panel"><h2>社区伙伴联系</h2><p>{shop?.contact}</p><p className="fineprint">所有组织、地址和联系方式都是虚构占位；此站不对外发送消息或处理真实求助。领取者不必注册钱包，但电子版需联网设备。</p></div>{role && role !== 'admin' && <div className="panel form-panel"><h2>建立私人演示案件</h2><p>普通咨询仅记录案件，不占餐款 L，也不触发退款。案件 ID 不是访问其他人的权限。</p><label className="field">求助类型<input value={caseKind} maxLength={80} onChange={e => setCaseKind(e.target.value)} /></label>{['partner', 'staff'].includes(role) && <label className="field">相关演示券号（可选）<input value={caseVoucherId} onChange={e => setCaseVoucherId(e.target.value)} /></label>}<label className="field">简述（仅虚构内容）<textarea value={caseText} maxLength={200} onChange={e => setCaseText(e.target.value)} placeholder="请勿输入真实姓名、联系方式或个人资料" /></label><button type="button" className="button" disabled={busy || !caseKind.trim()} onClick={async () => { const result = await perform({ action: 'case', kind: caseKind, text: caseText, ...(caseVoucherId && ['partner', 'staff'].includes(role) ? { voucher_id: caseVoucherId } : {}) }, { stay: true }); if (result) setCaseText('') }}>记录模拟求助</button></div>}{role === 'recipient' && voucher?.cases?.length ? <div className="panel"><h2>此券的本人演示求助</h2>{voucher.cases.map(c => <p key={c.id}>{c.id} · {c.kind} · {c.stage}</p>)}</div> : null}</section>}

        {page === 'P13' && <section className="narrow-page"><p className="eyebrow">P13 · 受限只读</p><h1>预置暂停状态</h1><div className="panel"><div className="card-heading"><h2>{state.work?.pause?.paused ? '当前已暂停' : '当前未暂停'}</h2><span className="status-chip">只读</span></div><p>{state.work?.pause?.reason}</p><div className="detail-list"><div><span>阻断范围</span><strong>{state.work?.pause?.scope}</strong></div><div><span>既有 R/H</span><strong>{state.work?.pause?.old_balances_retained ? '保留并可查询' : '正常状态'}</strong></div><div><span>本批规则</span><strong>{batch?.rule_version}</strong></div></div><p className="fineprint">本轮仅展示预置异常与阻断效果，不提供可写暂停、恢复、地址迁移或管理员密钥。</p></div><Link page="P04">查看既有公开余额 →</Link></section>}

        {page === 'P14' && <section className="narrow-page"><p className="eyebrow">P14 · 自愿公告</p><h1>一份餐的善意，可以被看见</h1><div className="panel"><h2>本地模拟社区公告</h2><p>这是一段虚构的公开说明，用来演示留膳如何把支持者的餐款交给社区伙伴安排餐券，并由餐厅负责供餐。</p><p>领取餐券、查看当前单份券和在门店处理，都不以阅读或参与公告为条件。</p><p className="fineprint">不展示自然人身份、私有领取关联、交付渠道或逐券记录；没有真实公告发布或外部链接。</p></div><Link page="P01">返回首页 →</Link></section>}
      </>}
    </main>
    <footer className="site-footer"><span>留膳 / mealforward · 本地模拟</span><span>虚构 DU · 无真实支付、链上交易或对外发送</span><Link page="P04">公开去身份餐账</Link></footer>
  </div>
}

function RedemptionCard({ red, busy, perform, reportOutcome, setReportOutcome }: {
  red: Redemption
  busy: boolean
  perform: (fields: Record<string, unknown>, options?: { page?: Page; stay?: boolean }) => Promise<ActionResult | null | undefined>
  reportOutcome: 'success' | 'unknown' | 'failure'
  setReportOutcome: (value: 'success' | 'unknown' | 'failure') => void
}) {
  return <div className="panel"><div className="card-heading"><h2>{red.id}</h2><span className="status-chip">{label(red.status)}</span></div><div className="detail-list"><div><span>原处理权</span><strong>{red.lock_operation ? <Link page="P03" tail={red.lock_operation}>{red.lock_operation}</Link> : '无'}</strong></div><div><span>显式确认</span><strong>{red.lock_confirmed ? '已确认' : '尚未确认，不可交餐'}</strong></div><div><span>交餐声明</span><strong>{red.handoff_declared ? '店员已声明' : '尚无声明'}</strong></div><div><span>原申报</span><strong>{red.report_operation ? <Link page="P03" tail={red.report_operation}>{red.report_operation}</Link> : '无'}</strong></div></div>{red.status === 'locked' && !red.lock_confirmed && red.lock_operation && <button type="button" className="button" disabled={busy} onClick={() => void perform({ action: 'confirm_lock', operation_id: red.lock_operation }, { stay: true })}>显式模拟确认处理权</button>}{red.status === 'locked' && !!red.lock_confirmed && <button type="button" className="button" disabled={busy} onClick={() => void perform({ action: 'handoff', voucher_id: red.id }, { stay: true })}>声明已交餐（模拟）</button>}{red.status === 'handoff' && <><label className="field">申报结果演练<select value={reportOutcome} onChange={e => setReportOutcome(e.target.value as typeof reportOutcome)}><option value="success">模拟申报成功</option><option value="unknown">模拟结果未知</option><option value="failure">模拟申报失败</option></select></label><button type="button" className="button" disabled={busy} onClick={() => void perform({ action: 'report', voucher_id: red.id, outcome: reportOutcome }, { stay: true })}>提交店员声明的模拟申报</button></>}{red.status === 'report_unknown' && <p className="fineprint">申报结果未知；保留原处理权与 R，只查上方原申报，不重发。</p>}{red.status === 'reported' && <p className="fineprint">已模拟申报，R→H。等待独立结算角色处理。</p>}</div>
}
