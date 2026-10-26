import {build} from 'esbuild';

// Task 1 entries. Task 2 adds bootstrap/controller and the fixed HTML/CSS
// copy step before these outputs become served assets.
await build({
 entryPoints:{'wallet-v2-wallet':'src/wallet.ts','wallet-v2-validation':'src/validation.ts'},
 outdir:'dist',outExtension:{'.js':'.mjs'},bundle:true,format:'esm',platform:'browser',target:'es2022',
 splitting:false,sourcemap:false,minify:true,legalComments:'none',logLevel:'warning'
});
