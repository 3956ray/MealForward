import {useEffect, useRef, useState, useSyncExternalStore} from 'react'
import {createDynamicAuthClient} from '../src/dynamic/client'
import type {DynamicAuthClient} from '../src/dynamic/contracts'
import {workSessions, type WorkSession} from './work-session'

type Props = {
  role:'partner'|'owner'
  onAuthenticated:(session:WorkSession)=>void
  onInvalidated:()=>void
  onCleanupError:(message:string)=>void
  singleOperator:boolean
}

// Lazy-loaded ONLY from partner/owner. Recipient never imports the Dynamic SDK.
export default function WorkDynamicLogin({role,onAuthenticated,onInvalidated,onCleanupError,singleOperator}:Props) {
  const clientRef=useRef<DynamicAuthClient|null>(null)
  if(!clientRef.current)clientRef.current=createDynamicAuthClient()
  const client=clientRef.current
  const snapshot=useSyncExternalStore(client.subscribe,client.getSnapshot,client.getSnapshot)
  const [email,setEmail]=useState(''),[otp,setOtp]=useState('')
  const [message,setMessage]=useState(''),[busy,setBusy]=useState(false)
  const lifecycle=useRef<ReturnType<typeof workSessions.open>|null>(null)
  const callbacks=useRef({onAuthenticated,onInvalidated,onCleanupError})
  callbacks.current={onAuthenticated,onInvalidated,onCleanupError}
  const expiry=useRef<ReturnType<typeof setTimeout>|undefined>(undefined)
  const running=useRef(false)
  const clear=()=>{clearTimeout(expiry.current);callbacks.current.onInvalidated()}
  useEffect(()=>{
    const lease=workSessions.open(role)
    lifecycle.current=lease
    const report=(e:unknown)=>callbacks.current.onCleanupError(e instanceof Error?e.message:'工作会话清理未确认。')
    const off=client.onInvalidate(()=>{
      clear()
      setMessage('工作授权已清除，请显式重新登录工作角色。')
      void workSessions.invalidate(lease).catch(report)
    })
    return ()=>{
      lifecycle.current=null;off();clear()
      void workSessions.invalidate(lease,()=>client.logout(),true).catch(report)
    }
  },[client,role])
  const run=async(action:()=>Promise<void>)=>{
    const lease=lifecycle.current
    if(running.current||!lease)return
    running.current=true;setBusy(true);setMessage('')
    try{await action()}
    catch(e){if(lifecycle.current===lease)setMessage(e instanceof Error?e.message:'操作未确认，请先检查原登录状态。')}
    finally{running.current=false;if(lifecycle.current===lease)setBusy(false)}
  }
  const login=async()=>{
    const lease=lifecycle.current
    const token=client.getAccessToken()
    if(!lease||!token)throw new Error('请先完成当前邮箱 OTP 登录。')
    clear()
    const generation=lease.generation
    const session=await workSessions.login(lease,token,()=>lifecycle.current===lease&&client.getAccessToken()===token)
    if(lifecycle.current!==lease||generation!==lease.generation||client.getAccessToken()!==token)return
    callbacks.current.onAuthenticated(session)
    clearTimeout(expiry.current)
    expiry.current=setTimeout(()=>{
      clear()
      void workSessions.invalidate(lease).catch(e=>callbacks.current.onCleanupError(e.message))
      setMessage('工作会话已到期，请重新完成身份验证。')
    },Math.max(0,session.expiresAt*1000-Date.now()))
    setMessage('服务端已确认当前工作身份。钱包权限仍由业务 Runtime 独立检查。')
  }
  return <section aria-label={`${role} Dynamic 邮箱工作登录`}>
    <p>{role==='partner'?'机构伙伴':'餐馆老板'}：{singleOperator?'本人使用已绑定的同一 Dynamic 邮箱，显式进入此工作角色。成功后旧工作角色授权失效。':'请使用该角色独立且已由维护者绑定的 Dynamic 邮箱。'}邮箱字符串不授予角色。</p>
    <form onSubmit={e=>{e.preventDefault();void run(async()=>{setOtp('');await client.startEmail(email.trim())})}}>
      <label>Dynamic 邮箱<input type="email" required value={email} maxLength={254} disabled={busy} onChange={e=>setEmail(e.target.value)}/></label>
      <button type="submit" disabled={busy}>发送邮箱验证码</button>
    </form>
    {snapshot.status==='email-pending'&&<form onSubmit={e=>{e.preventDefault();void run(async()=>{const code=otp;setOtp('');await client.verifyOtp(code)})}}>
      <label>验证码（仅本人输入）<input value={otp} onChange={e=>setOtp(e.target.value)} inputMode="numeric" autoComplete="off" maxLength={10} disabled={busy}/></label>
      <button type="submit" disabled={busy}>验证验证码</button>
    </form>}
    <p>Dynamic SDK：{snapshot.status==='authenticated'?'已登录':snapshot.status==='email-pending'?'等待验证码':'未登录'}</p>
    <button disabled={busy||snapshot.status!=='authenticated'} onClick={()=>void run(login)}>使用此身份登录业务工作台</button>
    <button disabled={busy} onClick={()=>void run(async()=>{const lease=lifecycle.current;if(!lease)return;clear();await workSessions.invalidate(lease,()=>client.logout());setOtp('');setMessage('当前身份已退出。')})}>退出当前身份</button>
    {message&&<p role="status">{message}</p>}
  </section>
}
