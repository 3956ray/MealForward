import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({
  root:fileURLToPath(new URL('.',import.meta.url)),envDir:false,envPrefix:'C1_UNUSED_',publicDir:false,
  define:{'process.env.NODE_ENV':'"production"'},
  build:{outDir:'assets',emptyOutDir:false,minify:true,
    lib:{entry:fileURLToPath(new URL('identity-entry.js',import.meta.url)),formats:['es'],fileName:()=> 'identity.js'},
    rolldownOptions:{output:{codeSplitting:false}}},
});
