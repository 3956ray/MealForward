import {build} from 'esbuild';
import {access} from 'node:fs/promises';
import {resolve} from 'node:path';

const publicDir=resolve('../public');
await Promise.all(['wallet-v2.html','wallet-v2.css'].map(name=>access(resolve(publicDir,name))));
await build({
 entryPoints:{
  'wallet-v2-bootstrap':'src/bootstrap.ts',
  'wallet-v2-controller':'src/controller.ts',
  'wallet-v2-wallet':'src/wallet.ts',
  'wallet-v2-validation':'src/validation.ts'
 },
 outdir:publicDir,
 outExtension:{'.js':'.mjs'},
 bundle:true,
 format:'esm',
 platform:'browser',
 target:'es2022',
 splitting:false,
 sourcemap:false,
 minify:true,
 legalComments:'none',
 logLevel:'warning'
});
