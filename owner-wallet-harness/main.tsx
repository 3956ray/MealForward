import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { OwnerWalletController, ownerHttpApi, type OwnerDeployment } from '../src/wallet/owner-controller.ts'
import type { Provider } from '../src/wallet/controller.ts'
import { WalletOwner } from '../src/components/WalletOwner.tsx'
import './style.css'

function Harness() {
  const [username, setUsername] = useState('owner-a')
  const [password, setPassword] = useState('')
  const [controller, setController] = useState<OwnerWalletController>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function login() {
    setBusy(true); setError('')
    try {
      if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) throw new Error('仅可在本机打开')
      const response = await fetch('/api/v1/auth/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })
      if (!response.ok) throw new Error('本地工作登录失败')
      const session = await response.json()
      if (session.role !== 'owner') throw new Error('需要当前本店老板身份')
      setPassword('')
      const configResponse = await fetch('/api/v1/config')
      if (!configResponse.ok) throw new Error('部署配置不可用')
      const deployment = await configResponse.json() as OwnerDeployment
      const provider = (window as Window & { ethereum?: Provider }).ethereum
      if (!provider) throw new Error('未发现注入式 EIP1193 provider；本页面不会安装钱包或创建密钥')
      setController(new OwnerWalletController({ deployment, provider, api: ownerHttpApi(() => session.csrfToken),
        store: localStorage, origin: location.origin, actorId: session.actorId }))
    } catch (e) { setError(e instanceof Error ? e.message : '本地登录失败') }
    finally { setBusy(false) }
  }
  return controller ? <WalletOwner controller={controller} providerLabel="独立 harness：注入式 EIP1193 provider，真实扩展与用户确认尚未验收" /> : <main className="owner-wallet"><h1>老板钱包 · 隔离验证入口</h1>
    <p>仅供专用 Anvil 31337 和虚构账号验证。登录不会连接钱包或请求签名；后续每一步由本人主动操作。</p>
    <p>请使用自有独立测试 provider；真实浏览器扩展与真实用户钱包尚未验收。</p>
    <form onSubmit={e => { e.preventDefault(); void login() }}><label>本地老板账号<input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" /></label>
      <label>本地工作密码<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></label>
      <button disabled={busy || !password}>登录本地工作账号</button></form>{error && <p role="alert">{error}</p>}</main>
}
createRoot(document.getElementById('root')!).render(<Harness />)
