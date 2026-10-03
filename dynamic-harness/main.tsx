import { lazy, Suspense, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { TestnetLedger } from '../src/components/TestnetLedger.tsx'
import { ledgerRoute } from '../src/testnet/contracts.ts'
import './style.css'
const IdentityEntry=lazy(()=>import('./IdentityEntry.tsx'))
function App() {
  const [route,setRoute]=useState(location.hash)
  useEffect(()=>{const change=()=>setRoute(location.hash);window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change)},[])
  const role=route==='#/partner'?'partner':route==='#/owner'?'owner':route==='#/support-login'?'support':undefined
  return <main><header><a href="#/">留膳 <small>mealforward</small></a><span>Monad 测试网 · 只读</span></header>
    {route.startsWith('#/testnet/b/')?<TestnetLedger id={route.slice('#/testnet/b/'.length)} />:role?<><a href={ledgerRoute}>查看测试网餐账</a><Suspense fallback={<p>正在加载工作登录…</p>}><IdentityEntry key={role} role={role}/></Suspense></>:route.startsWith('#/recipient')?<section><h1>领取餐券</h1><p>领取者无需注册或邮箱登录。请保留机构发来的私有领取邀请。</p><p>本入口的领取页面正在接入。CP19历史测试券没有可恢复邀请。</p><a href="#/">返回公开入口</a></section>:<section><p className="eyebrow">把一份善意，留成一顿饭</p><h1>留一膳，待一人。</h1><p>查看测试餐款从入账到商户结算的记录。公开读账无需登录或钱包。</p><p>专用虚构测试记录，不用于真实领取。</p><a className="ledger-link" href={ledgerRoute}>查看测试网餐账 →</a><nav><a href="#/support">我想支持一餐</a><a href="#/partner">机构伙伴</a><a href="#/owner">餐馆老板</a><a href="#/recipient">领取餐券</a></nav>{route==='#/support'&&<aside><h2>支持一餐</h2><p>测试网付款尚未开放，当前仅可查看已核餐账。登录不会自动连接钱包或付款。</p><a href="#/support-login">可选邮箱登录</a></aside>}<p>既有模拟页面和本地链演示使用独立数据；本地老板功能明确标记31337。</p></section>}
  </main>
}
createRoot(document.getElementById('root')!).render(<App />)
