import { useEffect, useRef, useState } from 'react'
import type { AuthApi } from '../dynamic/contracts.ts'
import { contractAddress, ledgerRoute } from '../testnet/contracts.ts'
import { mon } from '../testnet/api.ts'
interface Context {role:'partner'; partnerId:string; scope:string; deployment:{chainId:number;contractAddress:string}; transactionsEnabled:false; ledger:{amounts:{A:string}|null;sync:{state:string}}}
export function TestnetWork({api}:{api:AuthApi}) {
  const [data,setData]=useState<Context>(),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const epoch=useRef(0)
  async function refresh() {
    const version=++epoch.current;setBusy(true);setData(undefined);setError('')
    try {
      const result=await api.request<Context>('/work/testnet-context')
      if(result.role!=='partner'||result.scope!=='testnet:ledger:read'||result.deployment.chainId!==10143||result.deployment.contractAddress!==contractAddress||result.transactionsEnabled!==false) throw Error('INVALID_SCOPE')
      if(version===epoch.current)setData(result)
    } catch(failure) {
      if(version===epoch.current)setError((failure as {code?:string}).code==='TESTNET_SCOPE_DENIED'?'当前账号尚未获本测试部署工作权限':'工作会话或读账暂不可用，请重新核验工作身份。')
    } finally {if(version===epoch.current)setBusy(false)}
  }
  useEffect(()=>{void refresh();return()=>{epoch.current++}},[api])
  return <section><h2>测试网工作概况 · 只读</h2>{error&&<p role="alert">{error}</p>}{data&&<><p>机构伙伴 · {data.partnerId} · 本部署测试账只读</p><p>链上未分配餐款：{mon(data.ledger.amounts?.A)} 测试MON</p><p>核验状态：{data.ledger.sync.state}</p><p>受控测试客户端记录，不代表当前账号执行历史发行。</p></>}<p>尚未开放测试网发券。只读授权不授予发行或商户权限。</p><button disabled={busy} onClick={()=>void refresh()}>核验只读权限</button><a href={ledgerRoute}>查看公开餐账</a><a href="#/work/testnet-issuance">测试网发券状态 →</a></section>
}
