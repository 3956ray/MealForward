import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // Each simulation round can select its own loopback API/database.
  const simulationPort = loadEnv(mode, '.', 'SIMULATOR_').SIMULATOR_API_PORT ?? '8765'
  if (!/^\d{1,5}$/.test(simulationPort) || Number(simulationPort) < 1024 || Number(simulationPort) > 65535) {
    throw new Error('SIMULATOR_API_PORT must be a local port from 1024 to 65535')
  }
  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      proxy: {
        '/api': `http://127.0.0.1:${simulationPort}`,
      },
    },
  }
})
