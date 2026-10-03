import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react(), {
    name: 'cp17-unconfigured-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next()
        res.statusCode = 503
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'no-store')
        res.end(JSON.stringify({ code: 'DYNAMIC_PROFILE_UNVERIFIED', message: 'Identity integration is not configured' }))
      })
    },
  }],
  server: {
    host: '127.0.0.1', port: 15207, strictPort: true,
    fs: { allow: [fileURLToPath(new URL('../', import.meta.url))], deny: ['**/.localbackend/**', '**/.localchain/**', '**/data/**', '**/.venv/**', '**/.git/**', '**/.env*', '**/*.sqlite*', '**/*.key'] },
  },
  build: { outDir: '../dist-dynamic', emptyOutDir: true },
})
