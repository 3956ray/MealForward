import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('.', import.meta.url))
const backend = process.env.CP24_BACKEND_ORIGIN || 'http://127.0.0.1:19115'
const target = new URL(backend)
if (target.hostname !== '127.0.0.1' || target.protocol !== 'http:' || target.username || target.password || target.pathname !== '/') throw new Error('CP24 backend must be a loopback HTTP origin')
export default defineConfig({
  root, plugins: [react()],
  server: { host: '127.0.0.1', port: 15247, strictPort: true, allowedHosts: ['127.0.0.1'],
    fs: { strict: true, allow: [root, fileURLToPath(new URL('../node_modules', import.meta.url))], deny: ['**/.*', '**/.*/**', '**/*.{pem,key,sqlite,sqlite3,db}', '**/runtime/**'] },
    proxy: { '/api/cp24': { target: backend, changeOrigin: false } } },
  preview: { host: '127.0.0.1', port: 15247, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
})
