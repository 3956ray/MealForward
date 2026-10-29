import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

// Only artifact inputs participate: no Git HEAD, clocks, tests or generated assets.
// Hash sorted UTF-8 relative paths + NUL + exact file bytes + NUL.
export async function sourceFingerprint(root=fileURLToPath(new URL('.',import.meta.url))){
 const paths=['build.mjs','build-id.mjs','package.json','package-lock.json','tsconfig.json'];
 async function collect(relative){
  for(const entry of await readdir(join(root,relative),{withFileTypes:true})){
   const path=relative+'/'+entry.name;
   if(entry.isDirectory())await collect(path);
   else if(entry.isFile())paths.push(path);
  }
 }
 await collect('src');await collect('public');
 const hash=createHash('sha256');
 for(const path of paths.sort())hash.update(path).update('\0').update(await readFile(join(root,path))).update('\0');
 return 'wallet-v2-'+hash.digest('hex');
}
