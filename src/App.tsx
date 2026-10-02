import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { api, intentKey } from './api'
import type { ActionResult, Actor, Operation, Redemption, State, VoucherView, Issuance, ProcessingGroup } from './api'

const pages = ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P10', 'P11', 'P12', 'P13', 'P14'] as const
type Page = typeof pages[number]
type Route = { page: Page; tail: string | null }
type PendingWrite = { actor: string; action: 'report' | 'settle' | 'lock'; voucherId: string; intent: string; storageKey: string; operationId?: string }
type PendingIssue = { actor: string; intent: string; request: Issuance['request']; operationId?: string }
const issueStorageKey = 'mealforward-pending-issues'
const groupSelectionStorageKey = 'mealforward-group-selections'
const groupScopeKey = (actor: string, shopId: string) => JSON.stringify([actor, shopId])
const issueKey = (actor: string, ref: string) => JSON.stringify([actor, 'batch-demo', ref])
const pendingStorageKey = 'mealforward-pending-writes'
const pendingKey = (actor: string | null, action: string, voucherId: string) => JSON.stringify([actor, action, voucherId])

const titles: Record<Page, string> = {
  P01: '首页', P02: '支持一份餐', P03: '原操作查询', P04: '本批餐账',
  P05: '我的单份餐券', P06: '模拟角色入口', P07: '资格与发券', P08: '定向交付',
  P09: '本店验券', P10: '交餐与申报', P11: '本店结算', P12: '联系与求助',
  P13: '暂停状态', P14: '社区公告',
}

const actors: Array<{ id: Actor; label: string; detail: string; page: Page }> = [
  { id: 'supporter', label: '支持者', detail: '模拟支持与查看自己的原操作', page: 'P02' },
  { id: 'partner', label: '机构伙伴', detail: '核对资格、安排单份餐券与私密交付', page: 'P07' },
  { id: 'recipient', label: '领取者', detail: '通过机构私密邀请查看餐券，无需注册或钱包', page: 'P05' },
  { id: 'staff_a', label: '餐馆老板', detail: '本店验券、交餐、申报与逐笔模拟结算', page: 'P09' },
]

const actorLabel = (id: string) => actors.find(a => a.id === id)?.label ?? (id === 'admin' ? '内部只读工具' : '内部历史测试账号')
const ownerAppUrl = (() => {
  try {
    const configured = (import.meta as ImportMeta & { env: { VITE_OWNER_APP_URL?: string } }).env.VITE_OWNER_APP_URL
    const url = new URL(configured ?? 'http://127.0.0.1:15197')
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash && url.origin !== location.origin ? url.origin : null
  } catch { return null }
})()

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
  handoff: '老板已声明交餐，待申报', report_unknown: '申报结果未知', reported: '已申报，待模拟结算',
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
  const [recipientCases, setRecipientCases] = useState<Array<{ id: string; kind: string; stage: string }>>([])
  const [voucherOpen, setVoucherOpen] = useState(false)
  const [operation, setOperation] = useState<Operation | null>(null)
  const [operationQueriedAt, setOperationQueriedAt] = useState<number | null>(null)
  const [pendingInvite, setPendingInvite] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [lastOperation, setLastOperation] = useState<Operation | null>(null)
  const [recentSupport, setRecentSupport] = useState<Operation | null>(null)
  const [supportUncertain, setSupportUncertain] = useState(false)
  const [pendingWrites, setPendingWrites] = useState<Record<string, PendingWrite>>(() => {
    try { return JSON.parse(sessionStorage.getItem(pendingStorageKey) ?? '{}') } catch { return {} }
  })
  const pendingWritesRef = useRef(pendingWrites)
  const savePendingWrites = useCallback((next: Record<string, PendingWrite>) => {
    sessionStorage.setItem(pendingStorageKey, JSON.stringify(next))
    pendingWritesRef.current = next
    setPendingWrites(next)
  }, [])
  const [pendingIssues, setPendingIssues] = useState<Record<string, PendingIssue>>(() => {
    try { return JSON.parse(sessionStorage.getItem(issueStorageKey) ?? '{}') } catch { return {} }
  })
  const pendingIssuesRef = useRef(pendingIssues)
  const savePendingIssues = useCallback((next: Record<string, PendingIssue>) => {
    sessionStorage.setItem(issueStorageKey, JSON.stringify(next)); pendingIssuesRef.current = next; setPendingIssues(next)
  }, [])
  const [issueQuantities, setIssueQuantities] = useState<Record<string, number>>({})
  const [shownInvite, setShownInvite] = useState<{ id: string; secret: string } | null>(null)
  const privateEpoch = useRef(0)
  const [groupSelections, setGroupSelections] = useState<Record<string, string>>(() => {
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem(groupSelectionStorageKey) ?? '{}')
      return saved && typeof saved === 'object' && !Array.isArray(saved)
        ? Object.fromEntries(Object.entries(saved).filter(([, value]) => typeof value === 'string')) : {}
    } catch { return {} }
  })
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
  const voucherEpoch = useRef(0)
  const voucherInFlight = useRef<Promise<VoucherView> | null>(null)
  const inviteEpoch = useRef(0)
  const operationEpoch = useRef(0)
  const precheckEpoch = useRef(0)
  const actionEpoch = useRef(0)
  const stateEpoch = useRef(0)

  const actor = token ? state?.work?.actor ?? null : null
  const role = token ? state?.work?.role ?? null : null
  const batch = state?.batch
  const shop = state?.shop

  const refresh = useCallback(async (usingToken: string | null = token) => {
    const request = ++stateEpoch.current
    privateEpoch.current++; setShownInvite(null)
    try {
      const next = await api<State>('/state', usingToken)
      if (request !== stateEpoch.current) return null
      const issues = { ...pendingIssuesRef.current }
      for (const [key, pending] of Object.entries(issues)) {
        if (pending.actor !== next.work?.actor) continue
        const found = next.work.issuances?.find(i => i.operation.intent_key === pending.intent)
        if (found && Object.entries(pending.request).every(([k, v]) => found.request[k as keyof Issuance['request']] === v)) issues[key] = { ...pending, operationId: found.operation.id }
      }
      const reconciled: Array<{ key: string; pending: PendingWrite; release: boolean }> = []
      // Only a matching original operation plus fresh state can release a write gate.
      for (const [key, pending] of Object.entries(pendingWritesRef.current)) {
        if (pending.actor !== next.work?.actor) continue
        const originalId = pending.operationId ?? (pending.action === 'lock' ? next.work.redemptions?.find(red => red.id === pending.voucherId)?.lock_operation : pending.action === 'report'
          ? next.work.redemptions?.find(red => red.id === pending.voucherId)?.report_operation
          : next.work.payables?.find(pay => pay.voucher_id === pending.voucherId)?.settlement_operation)
        if (!originalId) continue
        try {
          const { operation: original } = await api<{ operation: Operation }>(`/operations/${encodeURIComponent(originalId)}`, usingToken)
          if (request !== stateEpoch.current) return null
          if (pendingWritesRef.current[key]?.intent !== pending.intent || original.intent_key !== pending.intent || original.actor !== pending.actor || original.action !== pending.action || original.target !== pending.voucherId) continue
          const red = next.work.redemptions?.find(item => item.id === pending.voucherId)
          const pay = next.work.payables?.find(item => item.voucher_id === pending.voucherId)
          const stateConfirms = pending.action === 'lock' ? red?.lock_operation === original.id : pending.action === 'report'
            ? red?.report_operation === original.id && (original.status === 'FAILED' ? red.status === 'handoff' : ['reported', 'settlement_unknown', 'settled'].includes(red.status))
            : pay?.settlement_operation === original.id && pay.settlement_status === original.status && (original.status === 'FAILED' ? pay.status === 'reported' : pay.status === 'settled')
          reconciled.push({ key, pending: { ...pending, operationId: original.id }, release: (['SUCCESS', 'FAILED'].includes(original.status) || pending.action === 'lock' && original.status === 'WAITING_CONFIRMATION') && stateConfirms })
        } catch { /* A missing/failed original query keeps this write conservatively blocked. */ }
      }
      if (request !== stateEpoch.current) return null
      const updated = { ...pendingWritesRef.current }
      for (const { key, pending, release } of reconciled) {
        if (updated[key]?.intent !== pending.intent) continue
        if (release) { sessionStorage.removeItem(pending.storageKey); delete updated[key] }
        else updated[key] = pending
      }
      const currentIssues = { ...pendingIssuesRef.current }
      for (const [key, pending] of Object.entries(issues)) {
        if (currentIssues[key]?.intent === pending.intent) currentIssues[key] = pending
      }
      savePendingIssues(currentIssues)
      savePendingWrites(updated)
      setState(next)
      setError(null)
      return next
    } catch (e) {
      if (request !== stateEpoch.current) return null
      const apiError = e as Error & { status?: number }
      if (apiError.status === 401 && usingToken) {
        privateEpoch.current++; setShownInvite(null)
        voucherEpoch.current++
        setVoucher(null)
        setRecipientCases([]); setRecentSupport(null); setSupportUncertain(false)
        sessionStorage.removeItem('mealforward-token')
        setToken(null)
        setState(null)
        try {
          const publicState = await api<State>('/state', null)
          if (request === stateEpoch.current) setState(publicState)
        } catch (publicError) {
          if (request === stateEpoch.current) setError((publicError as Error).message)
        }
        if (request === stateEpoch.current) setMessage('旧演示会话已失效，请重新选择模拟角色。')
        return null
      }
      setError(apiError.message)
      return null
    }
  }, [token, savePendingWrites, savePendingIssues])

  const refreshVoucher = useCallback(async (usingToken: string | null = token) => {
    const request = ++voucherEpoch.current
    setVoucher(null)
    if (!usingToken) return
    const prior = voucherInFlight.current
    if (prior) { try { await prior } catch { /* The next request still needs the server's latest state. */ } }
    if (request !== voucherEpoch.current) return
    const pending = api<VoucherView>('/voucher', usingToken)
    voucherInFlight.current = pending
    try {
      const next = await pending
      if (request !== voucherEpoch.current) return
      setVoucher(next)
      setRecipientCases(next.cases)
      setError(null)
    } catch (e) {
      if (request !== voucherEpoch.current) return
      setVoucher(null)
      const failure = e as Error & { status?: number }
      if (failure.status === 401) {
        sessionStorage.removeItem('mealforward-token')
        setToken(null)
        setVoucherOpen(false)
        setRecipientCases([])
        void refresh(null)
      }
      setError(failure.message)
    } finally { if (voucherInFlight.current === pending) voucherInFlight.current = null }
  }, [token, refresh])

  useEffect(() => {
    const onHash = () => {
      const next = parseRoute()
      setBusy(false)
      privateEpoch.current++; setShownInvite(null)
      setMessage(null); setLastOperation(null); setError(null)
      if (next.page !== 'P05' || next.tail) { voucherEpoch.current++; inviteEpoch.current++; setVoucher(null); setVoucherOpen(false); setPendingInvite(null) }
      operationEpoch.current++; setOperation(null); setOperationQueriedAt(null)
      actionEpoch.current++
      if (next.page !== 'P09') { precheckEpoch.current++; setCheck(undefined); setHasMeal(false) }
      setRoute(next)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useLayoutEffect(() => {
    if (route.page === 'P05' && route.tail) {
      const secret = route.tail
      voucherEpoch.current++
      inviteEpoch.current++
      setVoucher(null)
      setVoucherOpen(false)
      privateEpoch.current++; setShownInvite(null)
      setRecipientCases([]); setRecentSupport(null); setSupportUncertain(false)
      setPendingInvite(secret)
      setToken(null)
      setState(null)
      sessionStorage.removeItem('mealforward-token')
      setLastOperation(null)
      operationEpoch.current++
      actionEpoch.current++
      setOperation(null)
      setCheck(undefined)
      history.replaceState(null, '', `${location.pathname}${location.search}#/P05`)
      setRoute({ page: 'P05', tail: null })
      setMessage(null)
      setError(null)
      void refresh(null)
    }
  }, [route.page, route.tail])

  useEffect(() => { if (!(route.page === 'P05' && route.tail)) void refresh(token) }, []) // Initial read only.

  useLayoutEffect(() => {
    if (route.page === 'P05' && route.tail) return
    window.scrollTo(0, 0)
    document.getElementById('main-content')?.focus()
  }, [route.page, route.tail])

  useEffect(() => {
    if (route.page === 'P05' && role === 'recipient' && !route.tail && !pendingInvite && voucherOpen) void refreshVoucher()
  }, [route.page, route.tail, role, pendingInvite, voucherOpen, refreshVoucher])

  useEffect(() => {
    if (!voucher?.code_expires) return
    const delay = Math.max(0, voucher.code_expires * 1000 - Date.now())
    const timer = window.setTimeout(() => setVoucher(null), delay)
    return () => window.clearTimeout(timer)
  }, [voucher])

  useEffect(() => {
    if (route.page !== 'P05' || !voucherOpen || role !== 'recipient' || !token || !voucher?.code) return
    let checking = false
    const observedEpoch = voucherEpoch.current
    const hideCode = (reason?: string) => {
      if (observedEpoch !== voucherEpoch.current) return
      voucherEpoch.current++
      setVoucher(null)
      if (reason) setError(reason)
    }
    const checkStatus = async () => {
      if (checking || document.visibilityState !== 'visible') return
      checking = true
      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), 3000)
      try {
        const result = await api<{ status: string; delivery_status: string; paused: boolean }>('/voucher/status', token, undefined, controller.signal)
        if (observedEpoch !== voucherEpoch.current) return
        if (result.status !== 'active' || !['sent', 'handover', 'acknowledged'].includes(result.delivery_status) || result.paused) hideCode('券状态已变化或本批已暂停，短码已隐藏。请重查服务端状态。')
      } catch (e) {
        if (observedEpoch !== voucherEpoch.current) return
        hideCode('无法确认当前券状态，短码已隐藏。请重查服务端状态。')
        if ((e as Error & { status?: number }).status === 401) {
          sessionStorage.removeItem('mealforward-token')
          setToken(null)
          setVoucherOpen(false)
          setRecipientCases([])
          void refresh(null)
        }
      }
      finally { window.clearTimeout(timeout); checking = false }
    }
    const onVisibility = () => { if (document.visibilityState !== 'visible') hideCode() }
    document.addEventListener('visibilitychange', onVisibility)
    const timer = window.setInterval(() => { void checkStatus() }, 2000)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisibility) }
  }, [route.page, voucherOpen, role, token, voucher?.code, refresh])

  useEffect(() => {
    const request = ++operationEpoch.current
    if (route.page !== 'P03' || !route.tail || !token) { setOperation(null); setOperationQueriedAt(null); return }
    api<{ operation: Operation }>(`/operations/${encodeURIComponent(route.tail)}`, token)
      .then(result => { if (request !== operationEpoch.current) return; setOperation(result.operation); setOperationQueriedAt(Date.now()); setError(null) })
      .catch(e => { if (request !== operationEpoch.current) return; setOperation(null); setOperationQueriedAt(null); setError((e as Error).message) })
    return () => { if (request === operationEpoch.current) operationEpoch.current++ }
  }, [route.page, route.tail, token])

  async function openInvite() {
    if (!pendingInvite || busy) return
    const secret = pendingInvite
    const request = ++inviteEpoch.current
    setBusy(true); setError(null); setVoucher(null)
    try {
      const result = await api<{ token: string }>('/invite/exchange', null, { secret })
      if (request !== inviteEpoch.current) return
      sessionStorage.setItem('mealforward-token', result.token)
      setToken(result.token)
      setState(null)
      const opened = await refresh(result.token)
      if (request !== inviteEpoch.current) return
      setPendingInvite(null)
      if (opened?.work?.role === 'recipient') setVoucherOpen(true)
      else setError('本机未确认这一份餐券的访问状态；请从原私信重新打开。')
    } catch (e) {
      if (request !== inviteEpoch.current) return
      setPendingInvite(null)
      setError(`私密邀请无法确认：${(e as Error).message} 请从原私信重新打开，或联系机构伙伴。`)
    } finally { setBusy(false) }
  }

  async function selectActor(selected: Exclude<Actor, 'recipient'>, target: Page) {
    privateEpoch.current++; setShownInvite(null)
    sessionStorage.removeItem('mealforward-token')
    voucherEpoch.current++
    inviteEpoch.current++
    operationEpoch.current++
    precheckEpoch.current++
    actionEpoch.current++
    setBusy(true); setError(null); setMessage(null); setVoucher(null); setCheck(undefined); setHasMeal(false); setLastOperation(null); setOperation(null)
    setRecipientCases([]); setRecentSupport(null); setSupportUncertain(false)
    setPendingInvite(null); setVoucherOpen(false)
    setState(null); setToken(null); stateEpoch.current++
    const selection = actionEpoch.current
    try {
      const session = await api<{ token: string }>('/session', null, { actor: selected })
      if (selection !== actionEpoch.current) return
      sessionStorage.setItem('mealforward-token', session.token)
      setToken(session.token)
      await refresh(session.token)
      if (selection === actionEpoch.current) navigate(target)
    } catch (e) { if (selection === actionEpoch.current) setError((e as Error).message) }
    finally { if (selection === actionEpoch.current) setBusy(false) }
  }

  async function perform(fields: Record<string, unknown>, options?: { page?: Page; stay?: boolean }) {
    if (!token) { navigate('P06'); return }
    const guardedAction = fields.action === 'report' || fields.action === 'settle' || fields.action === 'lock' ? fields.action : null
    const guardKey = guardedAction ? pendingKey(actor, guardedAction, String(fields.voucher_id)) : null
    if (guardKey && pendingWritesRef.current[guardKey]) { setMessage('此笔结果待核，请只查原操作与服务端状态。'); return }
    const actionRequest = actionEpoch.current
    setBusy(true); setError(null); setMessage(null)
    const precheckRequest = fields.action === 'precheck' ? ++precheckEpoch.current : null
    if (fields.action === 'precheck') { setCheck(undefined); setHasMeal(false) }
    if (fields.action === 'support') setSupportUncertain(true)
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
      if (guardKey && pendingWritesRef.current[guardKey]) return null
      if (guardKey && guardedAction && actor) savePendingWrites({ ...pendingWritesRef.current, [guardKey]: { actor, action: guardedAction, voucherId: String(fields.voucher_id), intent: String(payload.intent_key), storageKey: intentStorageKey! } })
      if (actionRequest !== actionEpoch.current) return null
      const result = await api<ActionResult>('/act', token, payload)
      if (guardKey && result.operation && pendingWritesRef.current[guardKey]?.intent === payload.intent_key) {
        savePendingWrites({ ...pendingWritesRef.current, [guardKey]: { ...pendingWritesRef.current[guardKey], operationId: result.operation.id } })
      }
      if (actionRequest !== actionEpoch.current) return result
      if (precheckRequest !== null && precheckRequest !== precheckEpoch.current) return result
      if (intentStorageKey && result.operation && result.operation.status !== 'UNKNOWN') sessionStorage.removeItem(intentStorageKey)
      if (fields.action === 'support') {
        setRecentSupport(result.operation ?? null)
        setSupportUncertain(result.operation?.status === 'UNKNOWN')
      }
      setMessage(result.operation?.status === 'UNKNOWN' ? '结果待核，只查这笔原操作；没有重新提交。' : result.operation?.status === 'FAILED' ? '本次模拟操作未成功；请先查看原操作。' : result.message)
      setLastOperation(result.operation ?? null)
      if (result.check) setCheck(result.check)
      if (role === 'recipient' && fields.action === 'case' && result.case) setRecipientCases(previous => previous.some(item => item.id === result.case!.id) ? previous : [{ id: result.case!.id, kind: String(fields.kind ?? '一般求助'), stage: result.case!.stage }, ...previous])
      await refresh(token)
      if (actionRequest !== actionEpoch.current) return result
      if (role === 'recipient' && voucherOpen && route.page === 'P05') await refreshVoucher(token)
      if (actionRequest !== actionEpoch.current) return result
      if (fields.action === 'group_create' && result.operation?.target) selectGroup(result.operation.target)
      if (fields.action === 'group_add') setHasMeal(false)
      if (options?.page) navigate(options.page, options.page === 'P03' ? result.operation?.id : undefined)
      else if (result.operation && !options?.stay && ['UNKNOWN', 'FAILED'].includes(result.operation.status)) navigate('P03', result.operation.id)
      return result
    } catch (e) {
      if (actionRequest !== actionEpoch.current) return null
      if (precheckRequest !== null && precheckRequest !== precheckEpoch.current) return null
      const failure = (e as Error).message
      if (guardKey && fields.action === 'lock' && [400, 403, 404, 409].includes((e as Error & { status?: number }).status ?? 0)) { const next = { ...pendingWritesRef.current }; delete next[guardKey]; savePendingWrites(next) }
      if (fields.action === 'precheck' || fields.action === 'lock') { setCheck(undefined); setHasMeal(false) }
      await refresh(token)
      if (actionRequest !== actionEpoch.current) return null
      if (precheckRequest !== null && precheckRequest !== precheckEpoch.current) return null
      setError(failure)
      return null
    } finally { if (actionRequest === actionEpoch.current) setBusy(false) }
  }

  async function reset(scenario: 'normal' | 'paused') {
    privateEpoch.current++; setShownInvite(null)
    setBusy(true); setError(null); setMessage(null)
    voucherEpoch.current++
    inviteEpoch.current++
    operationEpoch.current++
    precheckEpoch.current++
    actionEpoch.current++
    setVoucher(null); setRecipientCases([]); setPendingInvite(null); setVoucherOpen(false); setRecentSupport(null); setSupportUncertain(false); setState(null)
    try {
      await api('/reset', null, { scenario })
      savePendingWrites({}); savePendingIssues({}); setShownInvite(null)
      sessionStorage.removeItem(groupSelectionStorageKey); setGroupSelections({})
      voucherEpoch.current++
      sessionStorage.removeItem('mealforward-token')
      setToken(null); setVoucher(null); setPendingInvite(null); setCheck(undefined); setLastOperation(null)
      await refresh(null)
      navigate('P06')
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  async function issueMeals(ref: string) {
    if (!actor || !token || !batch || busy) return
    const key = issueKey(actor, ref)
    if (pendingIssuesRef.current[key]) return
    const request = { recipient_ref: ref, quantity: issueQuantities[ref] ?? 1, batch_id: batch.id, quote_price: batch.price, rule_version: batch.rule_version }
    const pending: PendingIssue = { actor, intent: intentKey(), request }
    savePendingIssues({ ...pendingIssuesRef.current, [key]: pending })
    const epoch = actionEpoch.current
    setBusy(true); setError(null)
    try {
      const result = await api<ActionResult>('/act', token, { action: 'issue', ...request, intent_key: pending.intent })
      if (epoch !== actionEpoch.current) return
      if (result.issuance && result.operation?.status === 'SUCCESS') {
        savePendingIssues({ ...pendingIssuesRef.current, [key]: { ...pending, operationId: result.operation.id } })
        await refresh(token)
        if (epoch === actionEpoch.current) navigate('P08', result.operation.id)
      }
    } catch (e) {
      const failure = e as Error & { status?: number; code?: string }
      // Explicit transactional rejection is not a lost response. Conflicting intent stays blocked.
      if ([400, 403, 404, 409].includes(failure.status ?? 0) && failure.code !== 'INTENT_CONFLICT' && (pendingIssuesRef.current as Record<string, PendingIssue>)[key]?.intent === pending.intent) {
        const next = { ...pendingIssuesRef.current }; delete next[key]; savePendingIssues(next)
      }
      if (epoch !== actionEpoch.current) return
      await refresh(token)
      if (epoch === actionEpoch.current) setError(failure.message)
    } finally { if (epoch === actionEpoch.current) setBusy(false) }
  }

  async function recoverIssue(pending: PendingIssue) {
    const epoch = actionEpoch.current
    setBusy(true); setError(null)
    try {
      const result = await api<{ issuance: Issuance }>(`/issuances/by-intent/${encodeURIComponent(pending.intent)}`, token)
      if (epoch !== actionEpoch.current) return
      const original = result.issuance
      if (original.operation.actor !== pending.actor || original.operation.intent_key !== pending.intent || !Object.entries(pending.request).every(([key, value]) => original.request[key as keyof Issuance['request']] === value)) throw new Error('原发行快照不匹配，继续待核。')
      if (original.operation.status !== 'SUCCESS') throw new Error('原发行仍未确认，继续待核。')
      savePendingIssues({ ...pendingIssuesRef.current, [issueKey(pending.actor, pending.request.recipient_ref)]: { ...pending, operationId: original.operation.id } })
      const next = await refresh(token)
      if (epoch === actionEpoch.current && next) navigate('P08', original.operation.id)
    } catch (e) { if (epoch === actionEpoch.current) setError((e as Error).message) }
    finally { if (epoch === actionEpoch.current) setBusy(false) }
  }

  async function showInvite(id: string) {
    const epoch = ++privateEpoch.current
    setShownInvite(null); setError(null)
    try {
      const result = await api<{ id: string; secret: string }>(`/partner-invite/${encodeURIComponent(id)}`, token)
      if (epoch === privateEpoch.current) setShownInvite(result)
    } catch (e) { if (epoch === privateEpoch.current) setError((e as Error).message) }
  }

  function selectGroup(id: string) {
    if (!actor || role !== 'staff' || !shop) return
    const next = { ...groupSelections, [groupScopeKey(actor, shop.id)]: id }
    sessionStorage.setItem(groupSelectionStorageKey, JSON.stringify(next))
    setGroupSelections(next)
    precheckEpoch.current++; setCheck(undefined); setHasMeal(false); setCode('')
  }

  const page = route.page
  const needRole: Partial<Record<Page, string[]>> = {
    P03: ['supporter', 'partner', 'staff', 'settler', 'recipient'],
    P07: ['partner'], P08: ['partner'], P09: ['staff'],
    P10: ['staff'], P11: ['staff', 'settler'], P13: ['admin'],
  }
  const allowed = !needRole[page] || !!role && needRole[page]!.includes(role)
  const privateShell = page === 'P05' || page === 'P12' && role === 'recipient'
  const supportUnknown = role === 'supporter' ? (recentSupport?.status === 'UNKNOWN' ? recentSupport : state?.work?.operations?.find(op => op.action === 'support' && op.status === 'UNKNOWN')) : null
  const supportCompleted = role === 'supporter' ? state?.work?.operations?.find(op => op.action === 'support' && op.status === 'SUCCESS') : null
  const supportGuard = role === 'supporter' && (supportUnknown || supportCompleted || recentSupport?.status === 'SUCCESS' || supportUncertain)
  const currentVoucher = role === 'recipient' && !!token && voucherOpen && !pendingInvite && !route.tail && voucher && (!voucher.code_expires || voucher.code_expires * 1000 > Date.now()) ? voucher : null
  const selectedGroupId = role === 'staff' && actor && shop ? groupSelections[groupScopeKey(actor, shop.id)] : undefined
  // The persisted ID is only a preference: current server-authorized groups decide visibility.
  const activeGroup = selectedGroupId ? state?.work?.groups?.find(g => g.id === selectedGroupId) : undefined
  const unavailableGroup = !!selectedGroupId && !activeGroup
  const legacyRedemptions = state?.work?.redemptions?.filter(red => !state.work?.groups?.some(g => g.items.some(i => i.voucher_id === red.id))) ?? []
  const activeIssuance = state?.work?.issuances?.find(i => i.operation.id === route.tail)
  const navItems: Array<{ page: Page; name: string }> = [
    { page: 'P01', name: '首页' }, { page: 'P04', name: '公开餐账' },
    { page: 'P12', name: '联系求助' }, { page: 'P06', name: '角色入口' },
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
    <header>
      <div className="simulation-ribbon">● 本地模拟 · 所有店、机构、角色、餐券与 DU 均为虚构 · 无真实支付或外部发送</div>
      <div className="site-header">
      <Link page="P01" className="brand"><span className="brand-mark" aria-hidden="true">◡</span><span><strong>留膳</strong><small>mealforward</small></span></Link>
      {privateShell ? <div className="private-nav">{page === 'P05' ? <Link page="P12">联系与求助</Link> : <Link page="P05">返回这一份餐券</Link>}</div> : <><nav className="top-nav" aria-label="主导航">{navItems.map(item => <Link key={item.page} page={item.page} className={page === item.page ? 'active' : ''}>{item.name}</Link>)}</nav><Link page="P06" className="actor-pill">{actor ? `${actorLabel(actor)} · 切换` : '选择模拟角色'}</Link></>}
      </div>
    </header>
    {!privateShell && roleNav.length > 0 && <nav className="role-nav" aria-label="角色工作导航">{roleNav.map(id => <Link key={id} page={id} className={page === id ? 'active' : ''}>{titles[id]}</Link>)}</nav>}
    {state?.paused && <div className="pause-strip">预置暂停演练：新入款、发券、新锁及新付款被服务端阻断。既有 R/H 和原操作查询保留。<Link page="P04">查看餐账</Link></div>}
    <main id="main-content" tabIndex={-1}>
      {error && <div className="notice error" role="alert"><strong>操作未完成</strong><span>{error}</span><button type="button" className="text-button" onClick={() => void refresh()}>重查服务端状态</button></div>}
      {message && <div className={`notice ${lastOperation?.status === 'UNKNOWN' || lastOperation?.status === 'FAILED' ? 'pending' : 'success'}`} role="status"><span>{message}</span>{lastOperation && <Link page="P03" tail={lastOperation.id}>查看原操作 {lastOperation.id}</Link>}</div>}
      {!state ? <section className="panel empty"><h1>连接本机模拟服务</h1><p>页面正在读取服务端状态。请同时运行 Vite 前端与 127.0.0.1:8765 的 Python API；无法连接时上方会显示错误。</p><button type="button" className="button" onClick={() => void refresh()}>重新连接</button></section> : !allowed ? <section className="panel empty"><p className="eyebrow">{page} · 受限视图</p><h1>此页面需要对应的演示身份</h1><p>当前{actor ? `为${actorLabel(actor)}` : '未选择角色'}。服务端会再次核验角色与对象范围；切换后需查询原操作以恢复进度。</p><Link page="P06" className="button">选择模拟角色</Link>{page === 'P05' && <p className="fineprint">持券页只能通过机构提供的本地私密邀请打开。</p>}</section> : <>
        {page === 'P01' && <section className="home-page safe-page-enter">
          <div className="hero-meta"><span>{shop?.name} × {shop?.partner}</span><small>虚构餐食与机构伙伴 · 本地模拟</small></div>
          <h1>留一膳，待一人。</h1>
          <p className="hero-lead">机构伙伴安排餐券，餐厅负责供餐。一膳之微，亦可为善。</p>
          <MealArt />
          <div className="hero-select" role="group" aria-label="选择支持份数">{[1, 5, 10, 20].map(n => <button key={n} type="button" className={quantity === n ? 'selected' : ''} onClick={() => setQuantity(n)}>{n} 份</button>)}</div>
          {state.paused ? <span className="button hero-cta button-disabled">新支持入口已暂停</span> : <Link page="P02" className="button hero-cta">查看支持 {quantity} 份餐的模拟报价 <span aria-hidden="true">→</span></Link>}
          <p className="hero-note">电子演示版需联网设备查看餐券；领取无需钱包或平台注册。没有实际餐食交付。</p>
          <div className="hero-stats"><div><small>本批支持</small><strong>{batch && Math.floor(batch.F / batch.price)} <em>份</em></strong></div><div><small>机构已安排</small><strong>{batch && Math.floor((batch.R + batch.H + batch.S) / batch.price)} <em>份</em></strong></div><div><small>待安排额度</small><strong>{batch && Math.floor(batch.available / batch.price)} <em>份</em></strong></div><Link page="P04">查看这批餐账 →</Link></div>
          <div className="home-foot"><span>需要餐食安排或使用帮助，请联系机构伙伴。</span><Link page="P12">查看联系与求助 →</Link><Link page="P14">社区公告</Link></div>
        </section>}

        {page === 'P02' && <section className="page-grid">
          <div className="page-intro"><p className="eyebrow">P02 · 支持者</p><h1>为一份热餐留位</h1><p>这里使用虚构 DU 和模拟结果，绝无真实付款、钱包连接或手续费扣取。</p><Link page="P01">← 返回首页</Link></div>
          <div className="panel form-panel"><h2>模拟支持报价</h2>
            {supportGuard ? <div className="status-priority" role="status"><strong>{supportUnknown || supportUncertain ? '结果待核，只查原操作' : '原支持已记录'}</strong><p>{supportUnknown || supportUncertain ? '此前的支持意图尚未确认，不要再提交一笔。' : '这批餐的支持操作已确认，请查看原记录。'}</p><Link page="P03" tail={supportUnknown?.id ?? supportCompleted?.id ?? recentSupport?.id} className="button">查询原操作</Link></div> : <>
              <label className="field">份数 <input type="number" min="1" max="20" value={quantity} onChange={e => setQuantity(Number(e.target.value))} /></label>
              <div className="quote-row"><span>标准餐单价</span><strong>{money(batch?.price)}</strong></div><div className="quote-row"><span>净餐款</span><strong>{money(Number.isInteger(quantity) ? quantity * (batch?.price ?? 0) : 0)}</strong></div><div className="quote-row"><span>演示费用</span><strong>0 DU</strong></div>
              <label className="field">本地结果演练 <select value={supportOutcome} onChange={e => setSupportOutcome(e.target.value as typeof supportOutcome)}><option value="success">模拟成功</option><option value="unknown">模拟结果未知</option><option value="failure">模拟失败</option></select></label>
              {role === 'supporter' ? <button type="button" className="button full" disabled={busy || state.paused || !Number.isInteger(quantity) || quantity < 1 || quantity > 20 || batch!.F > 0} onClick={() => void perform({ action: 'support', quantity, outcome: supportOutcome, quote_price: batch!.price, rule_version: batch!.rule_version }, { page: 'P03' })}>{busy ? '正在提交或查询原操作…' : '确认模拟支持'}</button> : <Link page="P06" className="button full">先选择模拟支持者</Link>}
              <p className="fineprint">本地模拟 · 单价与规则版本由当前批次提供：{batch?.rule_version}。修改份数后须重新审阅报价。</p>
            </>}
            {batch!.F > 0 && <p className="fineprint">此单批样例已有支持记录；如需重跑，前往工作入口重置虚构数据。</p>}{state.paused && <p className="fineprint">当前预置暂停，服务端拒绝新入款。</p>}
          </div>
        </section>}

        {page === 'P03' && <section className="narrow-page"><p className="eyebrow">P03 · 原操作</p><h1>{operation?.status === 'UNKNOWN' ? '结果待核，只查原操作' : '查原操作，不重复提交'}</h1>
          <p>此页面只查询原 ID，不发起新的入款、申报或付款。</p>
          {route.tail ? <div className="panel">
            <div className="status-priority" role="status"><strong>{operation ? label(operation.status) : '正在查询服务端状态'}</strong><p>{operation?.status === 'UNKNOWN' ? '不要重新提交；请查询这笔原操作或联系处理人。' : '操作状态只取自服务端。'}</p></div>
            <p className="micro">原操作 ID</p><code className="break-code">{route.tail}</code>
            {operation && <><div className="detail-list"><div><span>动作</span><strong>{operation.action}</strong></div><div><span>目标</span><strong>{operation.target ?? '未生成目标'}</strong></div><div><span>创建时间</span><strong>{fmt(operation.created_at)}</strong></div><div><span>原角色</span><strong>{actorLabel(operation.actor)}</strong></div></div><p className="fineprint">{operationQueriedAt ? `本次查询于 ${new Date(operationQueriedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}（本机显示）` : '正在查询服务端'}。本机时间不表示服务端确认时间。</p></>}
            <button type="button" className="button secondary" disabled={busy} onClick={async () => { const request = ++operationEpoch.current; setOperation(null); setOperationQueriedAt(null); setError(null); try { const result = await api<{ operation: Operation }>(`/operations/${encodeURIComponent(route.tail!)}`, token); if (request !== operationEpoch.current) return; setOperation(result.operation); setOperationQueriedAt(Date.now()); setError(null); await refresh(token) } catch (e) { if (request === operationEpoch.current) { setOperation(null); setOperationQueriedAt(null); setError((e as Error).message) } } }}>查询原操作</button>
          </div> : <div className="panel"><p>请从刚完成的操作或角色工作页进入原操作。仅支持者会看到自己的操作列表。</p>{state.work?.operations?.map(op => <Link key={op.id} page="P03" tail={op.id} className="list-link"><span>{op.action} · {label(op.status)}</span><code>{op.id}</code></Link>)}</div>}
          {operation?.status === 'SUCCESS' && operation.action === 'issue' && <Link page="P08" tail={operation.id}>查看原发行单份券 →</Link>}
          {operation?.status === 'SUCCESS' && operation.action === 'support' && <Link page="P04">查看本批餐账 →</Link>}{operation?.status === 'FAILED' && operation.action === 'support' && <Link page="P02">返回重新审阅报价 →</Link>}{operation?.status === 'UNKNOWN' && <Link page="P12">联系处理人 →</Link>}
        </section>}

        {page === 'P04' && <section className="narrow-page safe-page-enter"><p className="eyebrow">P04 · 公开去身份餐账</p><h1>每一份餐，都有清楚去向</h1><p>以下仅为单批虚构 DU 状态，不展示领取关联、渠道、券号或私密邀请。申报是老板声明，不能推断指定自然人实际就餐。</p><div className="ledger-grid">{([['F', '本批累计支持'], ['A', '待安排'], ['R', '已发券待申报'], ['H', '商家已申报待结算'], ['S', '已模拟结算'], ['X', '已取消'], ['L', '暂占额度'], ['available', '可发餐款 A−L']] as const).map(([key, name]) => <div className="ledger-cell" key={key}><small>{name} · {key}</small><strong>{money(batch?.[key])}</strong></div>)}</div><div className="panel"><h2>守恒与来源</h2><p>F = A + R + H + S + X：{money(batch?.F)} = {money((batch?.A ?? 0) + (batch?.R ?? 0) + (batch?.H ?? 0) + (batch?.S ?? 0) + (batch?.X ?? 0))}</p><p>规则版本 {batch?.rule_version} · 最近公开更新日 {fmtDay(batch?.updated_at)}</p><p className="fineprint">L 只对可发余额暂占；普通咨询不会占 L。本轮无资金退款动作。</p></div><h2>去身份事件</h2>{state.events.length ? <div className="event-list">{state.events.map((event, index) => <div className="event-row" key={`${event.kind}-${event.created_at}-${index}`}><span><strong>{event.source}</strong><small>{fmt(event.created_at)}</small></span><b>{money(event.amount)}</b></div>)}</div> : <p className="muted">此虚构批次尚无已确认的资金事件。</p>}<Link page="P12">对餐账有疑问？联系与求助 →</Link></section>}

        {page === 'P05' && <section className="narrow-page voucher-page">
          <p className="eyebrow">P05 · 私密单份视图</p><h1>这一份餐券</h1>
          {pendingInvite ? <div className="panel invite-panel"><h2>查看机构发来的这一份餐券</h2><p>邀请地址已从浏览器地址栏清除。此入口只在本次打开时有效；点击后才会向本机服务确认。</p><button type="button" className="button" disabled={busy} onClick={() => void openInvite()}>{busy ? '正在确认邀请…' : '查看餐券'}</button><p className="fineprint">无需钱包或平台注册。此演示链接并非身份核验，也不会对外发送。</p></div> : currentVoucher ? <div className="panel voucher-card">
            <div className="voucher-top"><span>留膳 / mealforward</span><span>单份 · 本地模拟</span></div>
            <h2>{currentVoucher.meal}</h2><p className="voucher-location">{currentVoucher.shop} · {currentVoucher.hours}</p>
            <div className="voucher-status"><strong>{label(currentVoucher.status)}</strong><span>交付记录：{label(currentVoucher.delivery_status)}</span></div>
            {currentVoucher.status === 'active' && currentVoucher.code ? <div className="code-box"><QRCodeSVG value={currentVoucher.code} size={150} includeMargin aria-label="短时演示展示码" /><span className="large-code">{currentVoucher.code}</span><small>在线短时展示码 · 到期 {fmt(currentVoucher.code_expires)}。老板可手输；刷新会由服务端重发新码。</small></div> : <div className="code-box no-code">当前不能显示可兑码。请查看状态并联系机构伙伴，不要尝试再次发行。</div>}
            <div className="button-row"><button type="button" className="button secondary" disabled={busy} onClick={() => void refreshVoucher()}>重查此券状态</button>{currentVoucher.status === 'active' && ['sent', 'handover'].includes(currentVoucher.delivery_status) && <button type="button" className="button subtle" disabled={busy} onClick={() => void perform({ action: 'acknowledge' }, { stay: true })}>自愿声明：持链接者已看到</button>}</div>
            <p className="fineprint">{currentVoucher.note} 机构执行发送/交接、此处自愿声明与实际自然人收到/吃到餐是不同的事。</p>
          </div> : <div className="panel invite-panel"><h2>{role === 'recipient' && token && voucherOpen ? '短码已隐藏' : '需要原私密邀请'}</h2><p>{role === 'recipient' && token && voucherOpen ? '短码到期、状态变化或查询未完成。请重查服务端；若仍无法显示，请联系原机构伙伴。' : '请打开机构伙伴通过私密消息发给你的原邀请，再点击“查看餐券”。这里不会新建餐券，也无法查找他人的邀请；没有邀请时请联系机构伙伴。无需钱包或平台注册。'}</p>{role === 'recipient' && token && voucherOpen && <button type="button" className="button secondary" disabled={busy} onClick={() => void refreshVoucher()}>重查此券状态</button>}</div>}
          <Link page="P12">需要帮助 →</Link>
        </section>}

        {page === 'P06' && <section className="narrow-page role-entry safe-page-enter">
          <p className="eyebrow">P06 · 四种参与方式</p><h1>你想从哪里开始？</h1>
          <p>支持一份餐、安排餐券、凭邀请领取，或在本店供餐。选择你的入口，继续这一份餐的流程。</p>
          <div className="actor-grid">{actors.map(a => <button className="actor-card" key={a.id} type="button" disabled={busy} onClick={() => a.id === 'recipient' ? navigate('P05') : void selectActor(a.id, a.page)}><strong>{a.label}</strong><span>{a.detail}</span><small>{a.id === 'recipient' ? '了解如何打开私密邀请' : `进入${a.label}页面`} →</small></button>)}</div>
          <p className="fineprint">当前为本地模拟，所有资料与餐券均为虚构。工作入口使用演示会话，不代表真实组织授权；钱包签名与链上支付尚未接入本页面。</p>
          <details className="panel internal-tools"><summary>内部演示工具</summary>
            <p className="fineprint">以下仅用于内部检查与样例管理，不是额外的产品角色。</p>
            {ownerAppUrl && <div><p>开发验证：需测试provider。独立 Anvil 31337 经营工作台仅用于本地链测试，需专用服务和测试钱包；普通浏览器无法直接完成签名。</p><a className="text-button" href={ownerAppUrl} target="_blank" rel="noopener noreferrer">开发验证：需测试provider →</a></div>}
            <button type="button" className="text-button" disabled={busy} onClick={() => void selectActor('admin', 'P13')}>查看预置暂停状态（内部只读）</button>
            <div className="reset-panel"><h2>重置虚构样例</h2><p>重置会清空所有旧假会话与模拟记录。请在演示之间使用；旧操作 ID 将不可查询。</p><div className="button-row"><button type="button" className="button secondary" disabled={busy} onClick={() => void reset('normal')}>重置正常链路</button><button type="button" className="button secondary" disabled={busy} onClick={() => void reset('paused')}>载入预置暂停</button></div></div>
          </details>
        </section>}

        {page === 'P07' && <section className="narrow-page issuance-page"><p className="eyebrow">P07 · 机构私有发行</p><h1>每券一份，按需安排</h1><p>按虚构资格批准份数，不代表家庭人数。一次确认原子发行 N 张单份券。</p>
          <div className="split-stats"><div><small>可发餐款 A−L</small><strong>{money(batch?.available)}</strong></div><div><small>每券餐款</small><strong>{money(batch?.price)}</strong></div></div>
          {state.work?.recipients?.map(rec => {
            const n = issueQuantities[rec.ref] ?? 1
            const pending = actor ? pendingIssues[issueKey(actor, rec.ref)] : undefined
            const validQuantity = Number.isInteger(n) && n >= 1 && n <= 20
            const reasons = [
              !rec.eligible && '资格未确认：此对象是异常演练样例，不能发行；请选资格与渠道都已确认且有额度的对象。',
              !rec.channel_verified && '渠道未核对：此对象不能交付；当前演示不提供核准操作，请选渠道已核对的对象。',
              !validQuantity && '数量无效：请输入1–20的整数，每券一份。',
              validQuantity && rec.quota_remaining < n && (rec.quota_remaining > 0 ? `本期额度不足：请把数量减至${rec.quota_remaining}份以内。` : '本期额度已用完：不能再为此对象发行；选择其他有额度的合格对象，或在独立新演示场景从头体验，原记录保留。'),
              state.paused && '批次已暂停：停止新发行，只查原券与原操作；不要重复提交。',
              validQuantity && batch!.available < n * batch!.price && (batch!.F === 0 ? '餐款不足：先到支持者入口查看本批支持状态；尚未提交时完成模拟支持，结果待核时只查原操作。' : '餐款不足：减少发行份数至可用餐款范围；不足一份时，本批不能追加支持，请保留原记录并使用独立新演示场景。'),
            ].filter(Boolean)
            return <div className="panel" key={rec.ref}><h2>{rec.ref} · 私有领取关联</h2><p>本期剩余 {rec.quota_remaining} 份 · 渠道{rec.channel_verified ? '已核对' : '未核对'} · {rec.rule_version}</p>
              {pending ? <div className="status-priority"><strong>{pending.operationId ? '原发行已记录' : '发行结果待核'}</strong><p>{pending.request.quantity} 张单份券 · {pending.operationId ? '请查询原组，不重复发行。' : `本地待核引用 …${pending.intent.slice(-6)}（不是服务端操作编号）`}</p><button className="button secondary" disabled={busy} onClick={() => void recoverIssue(pending)}>查询原发行结果</button>{pending.operationId && <><Link page="P03" tail={pending.operationId}>查看原操作</Link><button className="text-button" disabled={busy} onClick={() => { const next = { ...pendingIssuesRef.current }; delete next[issueKey(pending.actor, rec.ref)]; savePendingIssues(next) }}>重新审阅另一笔发行</button></>}</div> : <>
                <label className="field">发行数量（每券一份）<input type="number" min="1" max="20" value={n} onChange={e => setIssueQuantities(previous => ({ ...previous, [rec.ref]: Number(e.target.value) }))} /></label>
                <p>{Number.isInteger(n) ? n : '—'} 张 × {money(batch?.price)}；将预留 {money(Number.isInteger(n) ? n * batch!.price : 0)}。预计可发剩余 {money(Math.max(0, batch!.available - (Number.isInteger(n) ? n : 0) * batch!.price))}。</p>
                {reasons.map((reason, index) => <p className="inline-error" key={index}>{reason}</p>)}
                <button className="button" disabled={busy || reasons.length > 0} onClick={() => void issueMeals(rec.ref)}>确认发行 {Number.isInteger(n) ? n : 'N'} 张单份券</button>
              </>}
            </div>
          })}<Link page="P08">恢复原发行与逐券交付 →</Link></section>}

        {page === 'P08' && <section className="narrow-page"><p className="eyebrow">P08 · 机构私有交付</p><h1>逐券安排，保留原结果</h1><p>机构已执行交付动作不等于指定本人收到。每次只查看一张邀请，不汇集或批量发送。</p>
          {!activeIssuance ? <div className="panel"><h2>选择原发行结果</h2>{state.work?.issuances?.map(i => <Link key={i.operation.id} page="P08" tail={i.operation.id} className="list-link"><span>{i.request.recipient_ref} · {i.request.quantity} 张单份券</span><span>…{i.operation.id.slice(-6)}</span></Link>)}{!state.work?.issuances?.length && <p>暂无确认发行。待核请求请回P07只读查询。</p>}{route.tail && <p>此原发行不在当前已加载结果中，请重新查询服务端。</p>}</div> : <>
            <div className="panel"><h2>已确认发行 {activeIssuance.request.quantity} 张单份券</h2><p>{activeIssuance.request.recipient_ref} · 单价 {money(activeIssuance.request.quote_price)}</p><Link page="P03" tail={activeIssuance.operation.id}>查询原发行操作</Link><p>已模拟结算 {activeIssuance.vouchers.filter(v => v.status === 'settled').length} 张 · 申报待核 {activeIssuance.vouchers.filter(v => v.status === 'report_unknown').length} 张 · 交付待联系 {activeIssuance.vouchers.filter(v => v.delivery_status === 'failed').length} 张</p></div>
            {activeIssuance.vouchers.map(v => <div className="panel" key={v.id}><div className="card-heading"><h2>单份券 …{v.id.slice(-6)}</h2><span className="status-chip">{label(v.status)}</span></div><p>交付：{label(v.delivery_status)}{v.delivery_at && ` · ${fmt(v.delivery_at)}`}</p>
              <div className="button-row">{(['sent', 'handover', 'failed'] as const).map(method => <button key={method} className="button secondary" disabled={busy || v.status !== 'active'} onClick={() => { privateEpoch.current++; setShownInvite(null); void perform({ action: 'deliver', voucher_id: v.id, method }, { stay: true }) }}>{method === 'sent' ? '记录此券已执行发送' : method === 'handover' ? '记录此券当面交接' : '记录此券失败待联系'}</button>)}{['failed', 'sent', 'handover'].includes(v.delivery_status) && <button className="button subtle" disabled={busy || v.status !== 'active'} onClick={() => void perform({ action: 'deliver', voucher_id: v.id, method: 'reshare' }, { stay: true })}>再次分享同一原券</button>}</div>
              {v.status === 'active' && <button className="button secondary" disabled={busy} onClick={() => void showInvite(v.id)}>单独查看此券邀请</button>}
              {shownInvite?.id === v.id && v.status === 'active' && <label className="field">仅此券私密邀请（不实际发送）<input readOnly value={`${location.origin}${location.pathname}#/P05/${shownInvite.secret}`} onFocus={e => e.currentTarget.select()} /><button className="text-button" onClick={() => { privateEpoch.current++; setShownInvite(null) }}>收起邀请</button></label>}
            </div>)}<Link page="P08">查看其他原发行 →</Link>
          </>}<Link page="P07">返回发行页 →</Link></section>}

        {(page === 'P09' || page === 'P10') && <section className="narrow-page work-page"><p className="eyebrow">{page} · 本店本人处理</p><h1>逐券确认，按原结果继续</h1><p className="owner-flow-note">餐馆老板在本店依次验券、交餐并申报，再到本店结算查看餐款。本页面仍是模拟流程，未提交真实链交易。</p><p>处理列表只记录现场主动出示的券，不代表家庭人数，也不授予处理权。</p>
          <details className="panel group-picker" open={!activeGroup}><summary>选择或新建本人处理组</summary><label className="field">恢复本人处理组<select value={activeGroup?.id ?? ''} onChange={e => selectGroup(e.target.value)}><option value="" disabled>{unavailableGroup ? '原选择不可访问，请明确另选' : '请选择本人处理组'}</option>{state.work?.groups?.map(g => <option key={g.id} value={g.id}>…{g.id.slice(-6)} · {g.items.length} 张 · {fmt(g.created_at)}</option>)}</select></label><button className="button secondary" disabled={busy} onClick={() => void perform({ action: 'group_create' }, { stay: true })}>新建本次处理组</button><button className="text-button" disabled={busy} onClick={() => { precheckEpoch.current++; setCheck(undefined); setHasMeal(false); void refresh() }}>重查本次服务端状态</button></details>
          {unavailableGroup && <div className="status-priority" role="status"><strong>原处理组不存在或当前不可访问</strong><p>没有自动切换到其他组。请重查服务端，或明确选择本人可见的处理组。</p></div>}
          {activeGroup && <GroupSummary group={activeGroup} />}
          {page === 'P09' && <div className="panel form-panel"><label className="field">在线短码（逐券主动输入）<input value={code} autoCapitalize="characters" onChange={e => { precheckEpoch.current++; setCode(e.target.value.toUpperCase().trim()); setCheck(undefined); setHasMeal(false) }} /></label><button className="button secondary" disabled={busy || !code} onClick={() => void perform({ action: 'precheck', code }, { stay: true })}>只读预检查</button>
            {check && <div className="check-result"><strong>{check.status}</strong><p>{check.meal} · …{check.voucher_id.slice(-6)}</p>{!activeGroup ? <p>请先新建或选择处理组。</p> : !activeGroup.items.some(i => i.voucher_id === check.voucher_id) ? <button className="button" disabled={busy} onClick={() => void perform({ action: 'group_add', group_id: activeGroup.id, code: check.code }, { stay: true })}>把此券加入本次处理</button> : pendingWrites[pendingKey(actor, 'lock', check.voucher_id)] ? <PendingWriteNotice pending={pendingWrites[pendingKey(actor, 'lock', check.voucher_id)]} busy={busy} refresh={() => void refresh()} /> : <><label className="checkbox"><input type="checkbox" checked={hasMeal} onChange={e => setHasMeal(e.target.checked)} />当前有这一份餐，可以申请处理权</label><button className="button" disabled={busy || !hasMeal || state.paused} onClick={() => void perform({ action: 'lock', voucher_id: check.voucher_id, group_id: activeGroup.id, code: check.code }, { page: 'P10' })}>申请此券唯一处理权</button></>}</div>}
            <p className="fineprint">加入列表不拿锁、不扣款。未锁项刷新后需重新出示有效码并预检；不保存短码。</p></div>}
          {activeGroup?.items.map(item => {
            const red = item.owned ? state.work?.redemptions?.find(r => r.id === item.voucher_id) : undefined
            const pending = pendingWrites[pendingKey(actor, 'lock', item.voucher_id)] ?? pendingWrites[pendingKey(actor, 'report', item.voucher_id)]
            return red ? <RedemptionCard key={item.voucher_id} red={red} busy={busy} pending={pending} refresh={() => void refresh()} perform={perform} reportOutcome={reportOutcome} setReportOutcome={setReportOutcome} /> : <div className="panel" key={item.voucher_id}><h2>单份券 …{item.voucher_id.slice(-6)}</h2>{pending ? <PendingWriteNotice pending={pending} busy={busy} refresh={() => void refresh()} /> : <p>{item.status === 'needs_code' ? '需重新出示有效短码并预检；尚未取得处理权。' : '当前不可由本人继续处理，请联系伙伴或重查状态。'}</p>}</div>
          })}
          {!unavailableGroup && legacyRedemptions.length > 0 && <h2>未加入处理组的历史记录</h2>}
          {!unavailableGroup && legacyRedemptions.map(red => <RedemptionCard key={red.id} red={red} busy={busy} pending={pendingWrites[pendingKey(actor, 'report', red.id)]} refresh={() => void refresh()} perform={perform} reportOutcome={reportOutcome} setReportOutcome={setReportOutcome} />)}
          <div className="button-row"><Link page={page === 'P09' ? 'P10' : 'P09'} className="button secondary">{page === 'P09' ? '查看逐券处理与申报' : '返回逐券预检查'}</Link><Link page="P11">查看本店申报与结算 →</Link></div></section>}

        {page === 'P11' && <section className="narrow-page"><p className="eyebrow">P11 · 本店应付与结算</p><h1>本店餐款，逐笔结算</h1><p>由餐馆老板继续查看本人已申报的本店餐款。正式结算将由老板绑定的本店收款钱包逐笔签名；此页面尚未接入钱包，只演练模拟结果。</p>{actor === 'staff_a' && state.work?.can_settle !== true && <div className="status-priority" role="status"><strong>{state.work?.can_settle === undefined ? '模拟服务待更新' : '当前账号暂无模拟结算权限'}</strong><p>请保留原申报与应付款，等待服务端确认老板权限后再继续。</p></div>}<div className="split-stats"><div><small>已申报待结算 H</small><strong>{money(batch?.H)}</strong></div><div><small>已模拟结算 S</small><strong>{money(batch?.S)}</strong></div></div>{state.work?.payables?.length ? state.work.payables.map(pay => <div className="panel" key={pay.voucher_id}><div className="card-heading"><h2>{pay.voucher_id}</h2><span className="status-chip">{label(pay.status)}</span></div>{pendingWrites[pendingKey(actor, 'settle', pay.voucher_id)] ? <PendingWriteNotice pending={pendingWrites[pendingKey(actor, 'settle', pay.voucher_id)]} busy={busy} refresh={() => void refresh()} /> : pay.status === 'settlement_unknown' ? <div className="status-priority"><strong>结果待核，只查原付款</strong><p>H 保留；不要换操作 ID 再付。</p>{pay.settlement_operation && <Link page="P03" tail={pay.settlement_operation} className="button secondary">查询原付款</Link>}</div> : state.work?.can_settle === true && pay.status === 'reported' && (!pay.settlement_status || pay.settlement_status === 'FAILED') ? <div className="task-action">{pay.settlement_status === 'FAILED' && <p>上次已明确失败，H 保留。可查看原付款后主动新试。</p>}<label className="field">本地结果演练<select value={settleOutcome} onChange={e => setSettleOutcome(e.target.value as typeof settleOutcome)}><option value="success">模拟结算成功</option><option value="unknown">模拟结果未知</option><option value="failure">模拟结算失败</option></select></label><button type="button" className="button" disabled={busy || state.paused} onClick={() => void perform({ action: 'settle', voucher_id: pay.voucher_id, outcome: settleOutcome }, { stay: true })}>{pay.settlement_status === 'FAILED' ? '再次发起模拟结算' : '发起本店模拟结算'}</button></div> : <p className="muted">{pay.status === 'settled' ? '这笔 H 已模拟结算为 S。' : '当前没有可执行的结算动作。'}</p>}<div className="detail-list"><div><span>原申报</span><strong>{pay.report_operation ? <Link page="P03" tail={pay.report_operation}>{pay.report_operation}</Link> : '无'}</strong></div><div><span>原付款</span><strong>{pay.settlement_operation ? <Link page="P03" tail={pay.settlement_operation}>{pay.settlement_operation}</Link> : '尚无'}</strong></div></div></div>) : <div className="panel empty"><p>本店当前尚无已申报的应付款。</p></div>}<p className="fineprint">老板声明交餐并申报后才有 H；同一老板在本店逐笔模拟 H→S。失败或未知保留 H。{state.work?.destination && `预置本店虚构目的地：${state.work.destination}`} 本页的模拟操作不会请求钱包签名或发起真实付款。</p></section>}

        {page === 'P12' && <section className="narrow-page"><p className="eyebrow">P12 · 联系与求助</p><h1>需要帮助，就从这里开始</h1><div className="panel"><h2>机构伙伴联系</h2><p>{shop?.contact}</p><p className="fineprint">所有组织、地址和联系方式都是虚构占位；此站不对外发送消息或处理真实求助。领取者不必注册钱包，但电子版需联网设备。</p></div>{role && role !== 'admin' && <div className="panel form-panel"><h2>建立私人演示案件</h2><p>普通咨询仅记录案件，不占餐款 L，也不触发退款。案件 ID 不是访问其他人的权限。</p><label className="field">求助类型<input value={caseKind} maxLength={80} onChange={e => setCaseKind(e.target.value)} /></label>{['partner', 'staff'].includes(role) && <label className="field">相关演示券号（可选）<input value={caseVoucherId} onChange={e => setCaseVoucherId(e.target.value)} /></label>}<label className="field">简述（仅虚构内容）<textarea value={caseText} maxLength={200} onChange={e => setCaseText(e.target.value)} placeholder="请勿输入真实姓名、联系方式或个人资料" /></label><button type="button" className="button" disabled={busy || !caseKind.trim()} onClick={async () => { const result = await perform({ action: 'case', kind: caseKind, text: caseText, ...(caseVoucherId && ['partner', 'staff'].includes(role) ? { voucher_id: caseVoucherId } : {}) }, { stay: true }); if (result) setCaseText('') }}>记录模拟求助</button></div>}{role === 'recipient' && recipientCases.length ? <div className="panel"><h2>此券的本人演示求助</h2>{recipientCases.map(c => <p key={c.id}>{c.id} · {c.kind} · {c.stage}</p>)}</div> : null}</section>}

        {page === 'P13' && <section className="narrow-page"><p className="eyebrow">P13 · 受限只读</p><h1>预置暂停状态</h1><div className="panel"><div className="card-heading"><h2>{state.work?.pause?.paused ? '当前已暂停' : '当前未暂停'}</h2><span className="status-chip">只读</span></div><p>{state.work?.pause?.reason}</p><div className="detail-list"><div><span>阻断范围</span><strong>{state.work?.pause?.scope}</strong></div><div><span>既有 R/H</span><strong>{state.work?.pause?.old_balances_retained ? '保留并可查询' : '正常状态'}</strong></div><div><span>本批规则</span><strong>{batch?.rule_version}</strong></div></div><p className="fineprint">本轮仅展示预置异常与阻断效果，不提供可写暂停、恢复、地址迁移或管理员密钥。</p></div><Link page="P04">查看既有公开余额 →</Link></section>}

        {page === 'P14' && <section className="narrow-page safe-page-enter"><p className="eyebrow">P14 · 自愿公告</p><h1>一份餐的善意，可以被看见</h1><div className="panel"><h2>本地模拟社区公告</h2><p>这是一段虚构的公开说明，用来演示留膳如何把支持者的餐款交给机构伙伴安排餐券，并由餐厅负责供餐。</p><p>领取餐券、查看当前单份券和在门店处理，都不以阅读或参与公告为条件。</p><p className="fineprint">不展示自然人身份、私有领取关联、交付渠道或逐券记录；没有真实公告发布或外部链接。</p></div><Link page="P01">返回首页 →</Link></section>}
      </>}
    </main>
    <footer className="site-footer"><span>留膳 / mealforward · 本地模拟</span><span>虚构 DU · 无真实支付、链上交易或对外发送</span>{!privateShell && <Link page="P04">公开去身份餐账</Link>}</footer>
  </div>
}

function PendingWriteNotice({ pending, busy, refresh }: { pending: PendingWrite; busy: boolean; refresh: () => void }) {
  return <div className="status-priority"><strong>{pending.action === 'report' ? '申报' : pending.action === 'lock' ? '处理权' : '结算'}结果待核</strong><p>此笔提交尚未完成权威核对，暂不能再次提交。只查询原操作与服务端状态。</p><div className="button-row">{pending.operationId && <Link page="P03" tail={pending.operationId} className="button secondary">查询原操作</Link>}<button type="button" className="button secondary" disabled={busy} onClick={refresh}>重查服务端状态</button></div></div>
}

function RedemptionCard({ red, busy, pending, refresh, perform, reportOutcome, setReportOutcome }: {
  red: Redemption
  pending?: PendingWrite
  refresh: () => void
  busy: boolean
  perform: (fields: Record<string, unknown>, options?: { page?: Page; stay?: boolean }) => Promise<ActionResult | null | undefined>
  reportOutcome: 'success' | 'unknown' | 'failure'
  setReportOutcome: (value: 'success' | 'unknown' | 'failure') => void
}) {
  return <div className="panel"><div className="card-heading"><h2>{red.id}</h2><span className="status-chip">{label(red.status)}</span></div>
    {pending ? <PendingWriteNotice pending={pending} busy={busy} refresh={refresh} /> : red.status === 'report_unknown' ? <div className="status-priority"><strong>申报结果待核</strong><p>保留原处理权与 R，只查原申报，不重发。</p>{red.report_operation && <Link page="P03" tail={red.report_operation} className="button secondary">查询原申报</Link>}</div> : red.status === 'locked' && !red.lock_confirmed && red.lock_operation ? <div className="task-action"><p>尚未确认处理权，不可交餐。</p><button type="button" className="button" disabled={busy} onClick={() => void perform({ action: 'confirm_lock', operation_id: red.lock_operation }, { stay: true })}>显式模拟确认处理权</button></div> : red.status === 'locked' && !!red.lock_confirmed ? <div className="task-action"><p>已确认处理权，现可声明交餐。</p><button type="button" className="button" disabled={busy} onClick={() => void perform({ action: 'handoff', voucher_id: red.id }, { stay: true })}>声明已交餐（模拟）</button></div> : red.status === 'handoff' ? <div className="task-action"><label className="field">申报结果演练<select value={reportOutcome} onChange={e => setReportOutcome(e.target.value as typeof reportOutcome)}><option value="success">模拟申报成功</option><option value="unknown">模拟结果未知</option><option value="failure">模拟申报失败</option></select></label><button type="button" className="button" disabled={busy} onClick={() => void perform({ action: 'report', voucher_id: red.id, outcome: reportOutcome }, { stay: true })}>提交老板声明的模拟申报</button></div> : <p className="muted">{red.status === 'settled' ? '这笔餐款已由餐馆老板模拟结算，H→S。' : '已模拟申报，R→H。请到本店结算逐笔继续。'}</p>}
    <div className="detail-list"><div><span>原处理权</span><strong>{red.lock_operation ? <Link page="P03" tail={red.lock_operation}>{red.lock_operation}</Link> : '无'}</strong></div><div><span>显式确认</span><strong>{red.lock_confirmed ? '已确认' : '尚未确认，不可交餐'}</strong></div><div><span>交餐声明</span><strong>{red.handoff_declared ? '老板已声明' : '尚无声明'}</strong></div><div><span>原申报</span><strong>{red.report_operation ? <Link page="P03" tail={red.report_operation}>{red.report_operation}</Link> : '无'}</strong></div></div>
  </div>
}

function GroupSummary({ group }: { group: ProcessingGroup }) {
  return <div className="panel group-summary"><h2>本次准备处理 {group.items.length} 张券</h2><p>仅本次出示数量 · …{group.id.slice(-6)}</p><p>已确认处理权 {group.items.filter(i => i.lock_confirmed).length} 张 · 申报待核 {group.items.filter(i => i.status === 'report_unknown').length} 张 · 已申报 {group.items.filter(i => ['reported', 'settlement_unknown', 'settled'].includes(i.status)).length} 张</p></div>
}
