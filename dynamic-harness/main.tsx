import { lazy, Suspense, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { TestnetFunding } from '../src/components/TestnetFunding.tsx'
import { TestnetIssuance } from '../src/components/TestnetIssuance.tsx'
import { TestnetLedger } from '../src/components/TestnetLedger.tsx'
import { TestnetRecipient } from '../src/components/TestnetRecipient.tsx'
import { recipientSecretFromHash } from '../src/testnet-voucher/contracts.ts'
import { ledgerRoute } from '../src/testnet/contracts.ts'
import './style.css'
const IdentityEntry=lazy(()=>import('./IdentityEntry.tsx'))
function App() {
  const [route,setRoute]=useState(location.hash)
  useEffect(()=>{const change=()=>setRoute(location.hash);window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change)},[])
  const role=route==='#/partner'?'partner':route==='#/owner'?'owner':route==='#/support-login'?'support':undefined
  return <main><header><a href="#/">留膳 <small>mealforward</small></a><span>Monad 测试网 · 虚构测试</span></header>
    {route==='#/work/testnet-issuance'?<TestnetIssuance/>:route==='#/support'?<TestnetFunding/>:route.startsWith('#/testnet/b/')?<TestnetLedger id={route.slice('#/testnet/b/'.length)} />:role?<><a href={ledgerRoute}>查看测试网餐账</a><Suspense fallback={<p>正在加载工作登录…</p>}><IdentityEntry key={role} role={role}/></Suspense></>:recipientSecretFromHash(route)!==undefined?<TestnetRecipient secret={recipientSecretFromHash(route)??null}/>:<section><p className="eyebrow">把一份善意，留成一顿饭</p><h1>留一膳，待一人。</h1><p>查看测试餐款从入账到商户结算的记录。公开读账无需登录或钱包。</p><p>专用虚构测试记录，不用于真实领取。</p><a className="ledger-link" href={ledgerRoute}>查看测试网餐账 →</a><nav><a href="#/support">我想支持一餐</a><a href="#/partner">机构伙伴</a><a href="#/owner">餐馆老板</a><a href="#/recipient">领取餐券</a></nav><p>既有模拟页面和本地链演示使用独立数据；本地老板功能明确标记31337。</p></section>}
  </main>
}
createRoot(document.getElementById('root')!).render(<App />)
