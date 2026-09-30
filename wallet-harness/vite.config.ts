import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const repo = fileURLToPath(new URL('../', import.meta.url))
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)), plugins: [react(), {
    name: 'exact-public-local-manifest',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url !== '/__localchain/deployment.json') return next()
        if (req.method !== 'GET') { res.statusCode = 405; res.end(); return }
        try { const data = await readFile(new URL('../.localchain/deployment.json', import.meta.url), 'utf8'); res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(data) }
        catch { res.statusCode = 404; res.end('Local deployment not found') }
      })
    },
  }], server: { host: '127.0.0.1', port: 5195, strictPort: true, fs: { allow: [repo], deny: ['**/.localchain/**', '**/.git/**', '**/.env*'] } },
})
