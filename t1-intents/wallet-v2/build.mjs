import {build} from 'esbuild';
import {copyFile,readFile,writeFile} from 'node:fs/promises';
import {sourceFingerprint} from './build-id.mjs';
import {resolve} from 'node:path';

const publicDir=resolve('../public');
const buildId=await sourceFingerprint();
await Promise.all([
 readFile(resolve('public/index.html'),'utf8').then(html=>writeFile(resolve(publicDir,'wallet-v2.html'),html.replaceAll('__WALLET_V2_BUILD_ID__',buildId))),
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
 define:{__WALLET_V2_BUILD_ID__:JSON.stringify(buildId)},
 format:'esm',
 platform:'browser',
 target:'es2022',
 splitting:false,
 sourcemap:false,
 minify:true,
 legalComments:'none',
 logLevel:'warning'
});
