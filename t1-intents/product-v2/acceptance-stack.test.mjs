import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,rm,mkdir,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {validateAcceptanceOptions,prepareAcceptanceDirectory,startAcceptanceStack} from './acceptance-stack.mjs';
const ownDirectory=()=>join(validateAcceptanceOptions().base,'test-'+randomUUID());
test('profile, network and listener are explicitly isolated; workdir cannot escape',()=>{
 assert.equal(validateAcceptanceOptions().profile,'local-acceptance');assert.equal(validateAcceptanceOptions().chainId,31337);
 for(const opts of [{profile:'monad-testnet'},{chainId:10143},{host:'0.0.0.0'},{host:'localhost'},{workdir:'/tmp/acceptance'},{workdir:join(validateAcceptanceOptions().base,'..','old')},{workdir:join(validateAcceptanceOptions().base,'nested','run')},{workerMs:0}])assert.throws(()=>validateAcceptanceOptions(opts));
});
test('new workdir is private and cannot overwrite an existing directory or follow its symlink',async t=>{
 const dir=ownDirectory(),config=await prepareAcceptanceDirectory({workdir:dir});t.after(()=>rm(dir,{recursive:true,force:true}));await writeFile(join(dir,'sentinel'),'untouched');await assert.rejects(prepareAcceptanceDirectory({workdir:dir}),/ACCEPTANCE_WORKDIR_EXISTS/);assert.equal(await readFile(join(dir,'sentinel'),'utf8'),'untouched');
 const link=ownDirectory();await symlink(dir,link);t.after(()=>rm(link,{force:true}));await assert.rejects(prepareAcceptanceDirectory({workdir:link}),/ACCEPTANCE_WORKDIR_EXISTS/);assert.equal(config.directory,dir);
});
test('dependency failure produces a stopped, nonsecret manifest without launching old runtimes',async t=>{
 const dir=ownDirectory();t.after(()=>rm(dir,{recursive:true,force:true}));await assert.rejects(startAcceptanceStack({workdir:dir,pgBin:'/nonexistent-product-acceptance-pg'}),/LOCAL_DEPENDENCY_COMMAND_FAILED/);const data=JSON.parse(await readFile(join(dir,'status.json'),'utf8'));assert.equal(data.status,'STOPPED');assert.equal(data.phase,'FAILED');assert.equal(data.profile,'local-acceptance');assert.ok(!JSON.stringify(data).match(/privateKey|signature|postgres:\/\//));
});
test('cancelled startup leaves no listeners and cannot reuse an existing database',async t=>{
 const dir=ownDirectory();t.after(()=>rm(dir,{recursive:true,force:true}));const abort=new AbortController();abort.abort();await assert.rejects(startAcceptanceStack({workdir:dir,signal:abort.signal}),/ACCEPTANCE_START_CANCELLED/);assert.equal(JSON.parse(await readFile(join(dir,'status.json'),'utf8')).status,'STOPPED');await assert.rejects(startAcceptanceStack({workdir:dir}),/ACCEPTANCE_WORKDIR_EXISTS/);
});
test('real isolated PostgreSQL + Anvil + HTTP acceptance and idempotent shutdown',{skip:process.env.MEALFORWARD_RUN_LOCAL_ACCEPTANCE!=='1',timeout:180000},async t=>{
 const dir=ownDirectory();let stack;t.after(async()=>{await stack?.stop();await rm(dir,{recursive:true,force:true});});stack=await startAcceptanceStack({workdir:dir});assert.match(stack.public.url,/^http:\/\/127\.0\.0\.1:\d+\/product-v2\/index.html$/);const page=await fetch(stack.public.url);assert.equal(page.status,200);const result=await stack.verify();assert.equal(result.result,'PASS');assert.equal(result.checks.length,7);await stack.stop();await stack.stop();assert.equal(JSON.parse(await readFile(join(dir,'status.json'),'utf8')).status,'STOPPED');await assert.rejects(fetch(stack.public.url));
});
