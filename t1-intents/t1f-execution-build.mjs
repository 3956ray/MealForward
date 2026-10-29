import {build} from './wallet-v2/node_modules/esbuild/lib/main.js';
await build({entryPoints:[new URL('./t1f-execution-crypto-source.mjs',import.meta.url).pathname],outfile:new URL('./public/t1f-execution-crypto.mjs',import.meta.url).pathname,bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'none'});
