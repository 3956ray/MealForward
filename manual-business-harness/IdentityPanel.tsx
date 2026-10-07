import {useEffect, useRef, useState, useSyncExternalStore} from 'react'
import {createDynamicAuthClient} from '../src/dynamic/client'
import {IdentityController, type IdentityConfig, type IdentitySession} from './identity'
import type {Provider} from './wallet'

// The module is lazy-loaded only for this explicit preparation page, never recipient.
const client = createDynamicAuthClient()
let cleanup: Promise<unknown> = Promise.resolve()
const errors: Record<string,string> = {
  SDK_INITIALIZATION_FAILED:'登录服务未能初始化。请维护者核对Dynamic配置及本入口origin；当前尚不能判断具体缺项。',
  EMAIL_SEND_FAILED:'验证码发送未确认，请本人稍后主动重试。',
  OTP_REJECTED:'验证码未通过，请本人检查后重试。',
  INVALID_OTP:'请输入有效的邮箱验证码。',
  ADDITIONAL_AUTH_REQUIRED:'登录还需额外验证，当前不能确认服务端身份。',
}
export default function IdentityPanel() {
  const identity = useSyncExternalStore(client.subscribe,client.getSnapshot,client.getSnapshot)
  const [config,setConfig] = useState<IdentityConfig|null>(null), [session,setSession] = useState<IdentitySession|null>(null)
  const [email,setEmail] = useState(''), [otp,setOtp] = useState(''), [account,setAccount] = useState('')
  const [message,setMessage] = useState(''), [busy,setBusy] = useState(false)
  const controller = useRef<IdentityController|null>(null)
  useEffect(()=>{
    let alive=true
    const c = new IdentityController(client,(s,a,m)=>{setSession(s);setAccount(a);if(m)setMessage(m)})
    controller.current=c
    void cleanup.then(()=>{if(alive)return c.bootstrap()}).then(value=>{if(alive && value)setConfig(value)}).catch(()=>{if(alive)setMessage('身份准备服务暂不可用。')})
    return ()=>{alive=false;controller.current=null;cleanup=c.dispose()}
  },[])
  async function run(action:()=>Promise<unknown>) {
    if(busy)return;setBusy(true);setMessage('')
    try {await action()} catch(e) {const code=(e as {code?:string})?.code;setMessage(code && errors[code] || (e instanceof Error ? e.message : '操作未确认，请主动重试。'))}
    finally {setBusy(false)}
  }
  return <section aria-label="身份与候选钱包准备">
    <h2>Dynamic邮箱登录与管理员 / 老板地址确认</h2>
    <p>已确定使用Dynamic；管理员与餐馆老板为同一人、同一钱包。此处只准备身份和候选地址，尚无业务权限。</p>
    <p>领取者不需要登录。请本人在本页输入邮箱验证码，不要将验证码或令牌发到聊天。</p>
    <p role="status">{config ? config.serverVerificationConfigured ? '服务端身份校验已配置，等待本人登录核验。' : '服务端身份校验未配置；可完成SDK邮箱登录，不能确认可信身份或钱包候选记录。' : '正在读取身份准备配置…'}</p>
    <form onSubmit={e=>{e.preventDefault();void run(async()=>{setOtp('');await client.startEmail(email.trim());setMessage('验证码已发送，请本人查看邮箱并输入。')})}}>
      <label>本人邮箱<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} disabled={busy}/></label>
      <button disabled={busy || !config} type="submit">发送邮箱验证码</button>
    </form>
    {identity.status==='email-pending' && <form onSubmit={e=>{e.preventDefault();void run(async()=>{const code=otp;setOtp('');await client.verifyOtp(code);setMessage('SDK邮箱登录已完成；服务端身份需要单独核验。')})}}>
      <label>邮箱验证码<input inputMode="numeric" autoComplete="off" required maxLength={10} value={otp} onChange={e=>setOtp(e.target.value)} disabled={busy}/></label>
      <button disabled={busy} type="submit">验证邮箱验证码</button>
    </form>}
    <p>SDK登录状态：{identity.status==='authenticated' ? '已登录' : identity.status==='email-pending' ? '等待本人验证码' : '未登录'}</p>
    <button disabled={busy || identity.status!=='authenticated' || !config?.serverVerificationConfigured} onClick={()=>void run(()=>controller.current!.verify())}>核验服务端身份</button>
    <p role="status">{session ? '身份已验证，工作权限未配置。' : '服务端身份尚未验证。'}</p>
    <button disabled={busy || !session} onClick={()=>void run(async()=>{
      const provider=(window as Window & {ethereum?:Provider}).ethereum
      if(!provider?.isMetaMask)throw new Error('请在支持MetaMask的浏览器由本人连接钱包。')
      await controller.current!.connect(provider)
    })}>连接本人MetaMask（不签名）</button>
    {account && <><p className="address">管理员与老板候选地址：{account}</p>
      <button disabled={busy || !session} onClick={()=>void run(()=>controller.current!.confirm())}>我已核对，两种身份使用此地址</button></>}
    {session?.candidate && <p role="status">候选地址已确认，控制权 / 链权限未验证。后台服务身份待单独配置；支持者钱包尚未指定。</p>}
    <p>本页不请求签名、不切链、不广播交易。身份与候选声明只在本次会话有效；刷新、退出、会话过期或账户 / 网络变化后需要重新核验。</p>
    <button disabled={busy || !config} onClick={()=>void run(async()=>{
      setOtp('');setEmail('');await controller.current!.logout();setConfig(await controller.current!.bootstrap());setMessage('已退出身份准备会话。')
    })}>退出身份准备</button>
    {message && <p role="status">{message}</p>}
  </section>
}
