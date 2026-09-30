import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
const backend = process.env.OWNER_BACKEND_ORIGIN
if (!backend) throw new Error('Set the dedicated OWNER_BACKEND_ORIGIN before starting this harness')
const url = new URL(backend)
if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.origin !== backend) throw new Error('Dedicated loopback backend required')
export default defineConfig({ root: fileURLToPath(new URL('.', import.meta.url)), plugins: [react()],
  server: { host: '127.0.0.1', strictPort: true, proxy: { '/api/v1': backend },
    fs: { allow: [fileURLToPath(new URL('../', import.meta.url))], deny: ['**/.localbackend/**','**/.localchain/**','**/.git/**','**/.env*','**/*.key','**/*.sqlite*'] } },
  build: { outDir: 'dist' },
})
