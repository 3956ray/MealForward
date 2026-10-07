import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
const match = location.hash.match(/^#\/recipient\/([^/?#]+)$/)
let secret: string | undefined
if (match) { secret = match[1]; history.replaceState(null, '', `${location.pathname}${location.search}#/recipient`) }
createRoot(document.getElementById('root')!).render(<React.StrictMode><App initialSecret={secret}/></React.StrictMode>)
