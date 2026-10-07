import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
const root=fileURLToPath(new URL('.',import.meta.url))
const backend=process.env.CP26_BACKEND_ORIGIN||'http://127.0.0.1:19615'
const target=new URL(backend)
if(target.protocol!=='http:'||target.hostname!=='127.0.0.1'||target.username||target.password||target.pathname!=='/'||target.search||target.hash)throw Error('Loopback backend required')
export default defineConfig({root,plugins:[react()],server:{host:'127.0.0.1',strictPort:true,allowedHosts:['127.0.0.1'],fs:{strict:true,allow:[root,fileURLToPath(new URL('../src/testnet-funding',import.meta.url)),fileURLToPath(new URL('../node_modules',import.meta.url))],deny:['**/.*','**/.*/**','**/*.{pem,key,sqlite,sqlite3,db}']},proxy:{'/api/cp26':{target:backend,changeOrigin:false}}},build:{outDir:'dist',emptyOutDir:true}})
