import {build} from './wallet-v2/node_modules/esbuild/lib/main.js';
import {PHASE8_FIXED,PHASE8_DOMAIN,PHASE8_TYPES} from './t1f-phase8-protocol.mjs';
await build({entryPoints:[new URL('./t1f-phase8-client-crypto-source.mjs',import.meta.url).pathname],outfile:new URL('./public/t1f-phase8-crypto.mjs',import.meta.url).pathname,bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'none',define:{__PHASE8_CONFIG__:JSON.stringify({fixed:PHASE8_FIXED,domain:PHASE8_DOMAIN,types:PHASE8_TYPES})}});
