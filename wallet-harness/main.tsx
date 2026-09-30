import React from 'react'
import { createRoot } from 'react-dom/client'
import { WalletSupport } from '../src/components/WalletSupport.tsx'
import './style.css'
const root = createRoot(document.getElementById('root')!)
fetch('/__localchain/deployment.json').then(response => {
  if (!response.ok) throw new Error('请先在本 worktree 部署本地合约并生成 manifest')
  return response.json()
}).then(deployment => root.render(<React.StrictMode><WalletSupport deployment={deployment} /></React.StrictMode>))
  .catch(error => root.render(<p role="alert">{String(error)}</p>))
