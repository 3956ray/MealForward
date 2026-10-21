import {defineConfig} from 'vite';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const base=dirname(fileURLToPath(import.meta.url));
export default defineConfig({
 base:'/',
 build:{
  target:'es2022',outDir:'dist',emptyOutDir:true,
  rollupOptions:{input:{
   preflight:resolve(base,'index.html'),
   deployment:resolve(base,'deploy-t0.html')
  }}
 }
});
