import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: {
    host: '127.0.0.1', port: 15207, strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:18975', changeOrigin: false } },
    fs: { allow: [fileURLToPath(new URL('../', import.meta.url))], deny: ['**/.localbackend/**', '**/.localchain/**', '**/data/**', '**/.venv/**', '**/.git/**', '**/.env*', '**/*.sqlite*', '**/*.key'] },
  },
  build: { outDir: '../dist-dynamic', emptyOutDir: true },
})
