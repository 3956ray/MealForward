import { useCallback, useEffect, useRef, useState } from 'react'
import { createDynamicAuthClient } from '../src/dynamic/client.ts'
import { createAuthApi } from '../src/dynamic/auth.ts'
import { Login } from '../src/dynamic/Login.tsx'
import type { IdentityView, InvalidationReason, LoginRole, WorkSession } from '../src/dynamic/contracts.ts'
import { OwnerWalletController, type OwnerDeployment } from '../src/wallet/owner-controller.ts'
import { WalletOwner } from '../src/components/WalletOwner.tsx'
import { WorkPanel } from '../src/components/OwnerWorkApp.tsx'
import { TestnetWork } from '../src/components/TestnetWork.tsx'
import { TestnetDelivery } from '../src/components/TestnetDelivery.tsx'
import { merchant } from '../src/testnet/contracts.ts'
import { releaseOwnerController } from './owner-lifecycle.ts'

export default function IdentityEntry({ role }: { role: LoginRole }) {
  const [client] = useState(createDynamicAuthClient)
  const [session, setSession] = useState<WorkSession>()
  const [controller, setController] = useState<OwnerWalletController>()
  const controllerRef = useRef<OwnerWalletController | undefined>(undefined)
  const generation = useRef(0)
  const [identity, setIdentity] = useState<IdentityView>({ status: 'initializing' })
  const [diagnostic, setDiagnostic] = useState<unknown>()
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState(''), [error, setError] = useState('')
  const invalidate = useCallback((_reason: InvalidationReason) => {
    generation.current++
    const previous = controllerRef.current
    controllerRef.current = undefined
    releaseOwnerController(previous)
    setController(undefined); setSession(undefined); setSelected(''); setDiagnostic(undefined)
  }, [])
  const [api] = useState(() => createAuthApi({ client, onInvalidate: invalidate }))
  useEffect(() => () => {
    generation.current++
    const previous = controllerRef.current
    controllerRef.current = undefined
    releaseOwnerController(previous)
  }, [])
  async function profileCheck() {
    const token = client.getAccessToken(), version = generation.current
    if (!token || busy) return
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/v1/auth/dynamic/profile-check', { method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: '{}' })
      const data = await response.json() as { code?: string }
      if (!response.ok) throw new Error('身份配置检查未通过，请联系维护者。')
      if (version === generation.current) setDiagnostic(data)
    } catch { if (version === generation.current) setError('身份配置检查未完成，未授予工作权限。') }
    finally { setBusy(false) }
  }
  async function wallet() {
    if (busy) return
    const version = generation.current
    setError(''); setBusy(true)
    try {
      if (!session || session.role !== 'owner') throw new Error('请先核验本店工作身份。')
      const provider = await client.getWalletProvider()
      if (!provider) throw new Error('未发现可用的钱包扩展。请仅使用本地测试钱包。')
      const response = await fetch('/api/v1/config', { credentials: 'same-origin', redirect: 'error' })
      if (!response.ok) throw new Error('本地部署配置暂不可用。')
      const deployment = await response.json() as OwnerDeployment
      if (version !== generation.current) return
      if (deployment.chainId !== 31337 || !deployment.ownerWalletMode) throw new Error('当前环境不允许老板钱包操作。')
      const current = new OwnerWalletController({ deployment, provider, api, store: localStorage, origin: location.origin, actorId: session.actorId })
      controllerRef.current = current; setController(current)
    } catch (failure) {
      const code = (failure as { code?: string }).code
      setError(code === 'WALLET_SELECTION_REQUIRED' ? '检测到多个钱包。请只启用本次使用的本地测试钱包后重试。' : failure instanceof Error ? failure.message : '钱包暂不可用。')
    } finally { setBusy(false) }
  }
  return <>
    <Login role={role} client={client} api={api} onSession={setSession} onIdentity={setIdentity} onInvalidated={invalidate} />
    {identity.status === 'authenticated' && <section><h2>本地身份配置核对</h2><p>仅检查签名与必要配置，不授予工作权限。验证码和登录凭据不会显示或保存。</p><button disabled={busy} onClick={() => void profileCheck()}>检查本次身份配置</button>{diagnostic !== undefined && <pre>{JSON.stringify(diagnostic, null, 2)}</pre>}</section>}
    {session && <section><h2>已核验工作身份</h2><p>{session.role === 'owner' ? '餐馆老板' : '机构伙伴'} · {session.actorId}</p>
      {session.role === 'owner' && !controller && <button disabled={busy} onClick={() => void wallet()}>准备本地测试钱包</button>}
      {session.role === 'partner' && <><TestnetWork api={api} /><TestnetDelivery api={api} /></>}
    </section>}
    {error && <p role="alert">{error}</p>}
    {role === 'owner' && <section><h2>测试网商户绑定</h2><p>本部署使用专用测试商户钱包。当前工作账号尚未绑定该商户；测试网结算未开放。</p><code>{merchant}</code></section>}
    {role === 'owner' && <p>本地链演示 · 31337：以下钱包操作仅用于既有本地链。</p>}
    {controller && <WalletOwner controller={controller} selectedRedemption={selected} providerLabel="仅本地 Anvil 31337 测试钱包"><WorkPanel controller={controller} onPayable={setSelected} /></WalletOwner>}
  </>
}
