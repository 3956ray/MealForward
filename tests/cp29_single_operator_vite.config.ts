import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import {fileURLToPath} from 'node:url'
export default defineConfig({root:fileURLToPath(new URL('../manual-business-harness',import.meta.url)),plugins:[react()],
  resolve:{alias:[{find:'../src/dynamic/client',replacement:fileURLToPath(new URL('./cp28_identity_client.ts',import.meta.url))}]},
  build:{outDir:fileURLToPath(new URL('../dist/cp29-single-operator-fixture',import.meta.url)),emptyOutDir:true}})
