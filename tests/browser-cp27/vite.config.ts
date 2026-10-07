import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('.',import.meta.url))
const backend=process.env.CP27_FIXTURE_API!
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(backend))throw Error('Fixture loopback API required')
export default defineConfig({root,plugins:[react()],server:{host:'127.0.0.1',strictPort:true,fs:{strict:true,allow:[root,...['../../wallet-readiness-harness','../../src/testnet-funding','../../node_modules'].map(p=>fileURLToPath(new URL(p,import.meta.url)))],deny:['**/.*','**/.*/**','**/*.{pem,key,sqlite,sqlite3,db}']},proxy:{'/api/cp26':{target:backend,changeOrigin:false}}}})
