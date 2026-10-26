import {build} from 'esbuild';
import {copyFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const publicDir=resolve('../public');
await Promise.all([
 copyFile(resolve('public/index.html'),resolve(publicDir,'wallet-v2.html')),
 copyFile(resolve('public/style.css'),resolve(publicDir,'wallet-v2.css'))
]);
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
