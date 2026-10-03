import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import type { LoginProps } from './contracts.ts'

const messages: Record<string, string> = {
  DYNAMIC_IDENTITY_UNMAPPED: '已登录，尚未获得本机构/餐馆工作权限。请联系配置负责人。',
  WORK_IDENTITY_UNMAPPED: '已登录，尚未获得本机构/餐馆工作权限。请联系配置负责人。',
  DYNAMIC_PROFILE_UNVERIFIED: '身份验证配置尚未核实，暂时无法进入工作页。',
  ADDITIONAL_AUTH_REQUIRED: '登录尚需额外验证，当前不能获得工作权限。',
  WRONG_WORK_ROLE: '当前身份没有此入口的工作权限，请返回对应入口。',
  WRONG_ROLE_LOGOUT_UNCONFIRMED: '当前身份没有此入口的工作权限。本机已停用；服务端退出未确认，请再次退出。',
  OTP_REJECTED: '验证码未通过，请检查后主动重试。',
  EMAIL_SEND_FAILED: '验证码发送未确认，请稍后主动重试。',
  SDK_INITIALIZATION_FAILED: '登录服务暂不可用，请刷新后重试。',
}
export function Login({ role, client, api, onSession, onIdentity, onInvalidated }: LoginProps) {
  const identity = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    void client.initialize().catch(() => {})
    const unsubscribe = client.onInvalidate(reason => {
      setCode('')
      onInvalidated(reason)
    })
    return () => { alive.current = false; unsubscribe() }
  }, [client, onInvalidated])
  useEffect(() => { onIdentity?.(identity) }, [identity, onIdentity])
  const perform = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setMessage('')
    try { await action() }
    catch (failure) {
      const key = (failure as { code?: string }).code ?? ''
      if (alive.current) setMessage(messages[key] ?? '操作未完成，请检查登录状态后主动重试。')
    } finally { if (alive.current) setBusy(false) }
  }
  const exchange = async () => {
    // Called only by an explicit submit/click, never an identity effect.
    const session = await api.exchange()
    if (!alive.current) { api.invalidate('session-rejected'); return }
    if (role === 'support' || session.role !== role) {
      const result = await api.logout()
      const code = result.serverRevoked ? 'WRONG_WORK_ROLE' : 'WRONG_ROLE_LOGOUT_UNCONFIRMED'
      throw Object.assign(new Error(code), { code })
    }
    onSession(session)
  }
  const submitEmail = (event: FormEvent) => {
    event.preventDefault()
    void perform(async () => { setCode(''); await client.startEmail(email.trim()) })
  }
  const submitCode = (event: FormEvent) => {
    event.preventDefault()
    void perform(async () => {
      const entered = code
      setCode('')
      await client.verifyOtp(entered)
      if (!alive.current) return
      if (client.getSnapshot().status !== 'authenticated') return
      if (role !== 'support') await exchange()
    })
  }
  return <section aria-label="邮箱登录">
    <h2>{role === 'partner' ? '机构伙伴登录' : role === 'owner' ? '餐馆老板登录' : '支持者可选登录'}</h2>
    <p>登录不会连接钱包或要求签名。刷新页面后可能需要重新登录。</p>
    {identity.status === 'initializing' && <p role="status">正在准备登录服务…</p>}
    {identity.status !== 'authenticated' && <form onSubmit={submitEmail}>
      <label>邮箱<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} disabled={busy} /></label>
      <button disabled={busy || identity.status === 'initializing'} type="submit">{identity.status === 'email-pending' ? '重新发送验证码' : '发送验证码'}</button>
    </form>}
    {identity.status === 'email-pending' && <form onSubmit={submitCode}>
      <label>邮箱验证码<input inputMode="numeric" autoComplete="off" required value={code} maxLength={10} onChange={event => setCode(event.target.value)} disabled={busy} /></label>
      <button disabled={busy} type="submit">验证并继续</button>
    </form>}
    {identity.status === 'authenticated' && <>
      <p>邮箱已登录{identity.email ? `：${identity.email}` : ''}。{role === 'support' ? '支持记录仍按原操作权限访问。' : '工作权限由服务端核验。'}</p>
      {role !== 'support' && <button disabled={busy} onClick={() => void perform(exchange)}>核验工作权限并继续</button>}
    </>}
    <button disabled={busy} onClick={() => void perform(async () => {
      setCode(''); setEmail('')
      const result = await api.logout()
      if (alive.current) setMessage(result.serverRevoked ? '已退出。' : '本机已停止工作操作；服务端退出未确认，请稍后再次退出。')
    })}>退出登录</button>
    <a href="#/">返回公开入口</a>
    {(message || identity.errorCode) && <p role="status">{message || messages[identity.errorCode ?? ''] || '登录尚未完成，请主动重试。'}</p>}
  </section>
}
