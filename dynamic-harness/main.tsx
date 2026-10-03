import { createRoot } from 'react-dom/client'

function App() {
  return <main><h1>留膳 · 本地身份入口</h1><p>身份功能正在接入，当前无法登录或执行工作操作。</p><p>本地验证环境 · 未连接钱包</p></main>
}
createRoot(document.getElementById('root')!).render(<App />)
