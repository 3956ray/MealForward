// Isolated test root only. Production HTML never imports this synthetic provider.
import React from 'react'
import {createRoot} from 'react-dom/client'
import App from '../../wallet-readiness-harness/App'
const events=new Map<string,Set<(...args:unknown[])=>void>>()
const account='0x'+'0'.repeat(40)
Object.assign(window,{ethereum:{isMetaMask:true,request:async({method}:{method:string})=>{
 if(!['eth_requestAccounts','eth_accounts','eth_chainId'].includes(method))throw Error('TEST_METHOD_DENIED')
 return method==='eth_chainId'?'0x279f':[account]
},on:(event:string,listener:(...args:unknown[])=>void)=>{if(!events.has(event))events.set(event,new Set());events.get(event)!.add(listener)},removeListener:(event:string,listener:(...args:unknown[])=>void)=>events.get(event)?.delete(listener)}})
createRoot(document.getElementById('root')!).render(<><div style={{padding:16,background:'#ffdf9e',color:'#422a07'}}>隔离浏览器验收：合成 provider · 公开零地址 · 非真人钱包。HTTP 模式以运行命令/验收记录为准。</div><App/></>)
