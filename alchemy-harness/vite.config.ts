import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
export default defineConfig({
  root, envDir: false, publicDir: false, cacheDir: `${root}node_modules/.vite`,
  plugins: [react()],
  server: {
    host: '127.0.0.1', port: 15217, strictPort: true,
    proxy: { '/api/v1/testnet/status': { target: 'http://127.0.0.1:18985', changeOrigin: false } },
    fs: { allow: [root, fileURLToPath(new URL('../node_modules', import.meta.url))],
      deny: ['**/.localbackend/**', '**/.localchain/**', '**/data/**', '**/.venv/**', '**/.git/**', '**/.env*', '**/*.sqlite*', '**/*.key'] },
  },
  build: { outDir: 'dist', emptyOutDir: true },
})
