import {defineConfig} from 'vite';
import {resolve} from 'node:path';
export default defineConfig({
  base:'/',
  build:{
    target:'es2022',
    outDir:'dist',
    emptyOutDir:true,
    rollupOptions:{
      input:{
        main:resolve(import.meta.dirname,'index.html'),
        guide:resolve(import.meta.dirname,'test-guide.html')
      }
    }
  }
});
