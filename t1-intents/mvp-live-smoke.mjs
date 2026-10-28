/** Public read/denial checks only. No session creation or business writes. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const origin='https://mealforward-t1e-claim-laodao.onrender.com';
const digest=b=>createHash('sha256').update(b).digest('hex');
const request=(path,init={})=>fetch(origin+path,{redirect:'error',signal:AbortSignal.timeout(45000),...init});
const result=await request('/v1/mvp/status');assert.equal(result.status,200);
const status=await result.json();assert.equal(status.chainId,10143);assert.equal(status.testOnly,true);assert.equal(status.enabled,true);
assert.deepEqual(status.currency,{address:'0x534b2f3a21130d7a60830c2df862319e593943a3',symbol:'USDC',decimals:6,existing:true});
const names=['product.html','product-recipient.html','product.mjs','product-recipient.mjs','product-original.css','product.css','setup.html','merchant.html','recipient.html','app.mjs','recipient.mjs','style.css','THIRD_PARTY_NOTICES.txt'];
for(const name of names){
 const response=await request('/mvp/'+name);assert.equal(response.status,200);
 const actual=Buffer.from(await response.arrayBuffer()),expected=await readFile(new URL('./public/mvp/'+name,import.meta.url));
 assert.equal(digest(actual),digest(expected));
 assert.equal(response.headers.get('referrer-policy'),'no-referrer');
 if(['merchant.html','product.html'].includes(name))assert.match(response.headers.get('permissions-policy'),/camera=\(self\)/);
}
assert.equal((await request('/v1/mvp/setup')).status,401);
assert.equal((await request('/v1/mvp/businesses')).status,401);
assert.equal((await request('/v1/mvp/businesses/1/setup')).status,401);
assert.equal((await request('/v1/mvp/recipient/voucher')).status,401);
const anon=await request('/v1/mvp/setup/escrow/prepare',{method:'POST',headers:{Origin:origin,'content-type':'application/json'},body:'{}'});
assert.equal(anon.status,status.writesEnabled?401:503);
const foreign=await request('/v1/mvp/setup/escrow/prepare',{method:'POST',headers:{Origin:'https://example.com','content-type':'application/json'},body:'{}'});
assert.equal(foreign.status,403);
const removedToken=await request('/v1/mvp/setup/token/prepare',{method:'POST',headers:{Origin:origin,'content-type':'application/json'},body:'{}'});
assert.equal(removedToken.status,404);
const legacy=await request('/v1/t1f/phase8/status');assert.equal(legacy.status,200);
const prior=await legacy.json();assert.equal(prior.operation?.stage,'ISSUED');
console.log(JSON.stringify({status:'MVP_PUBLIC_READONLY_SMOKE_PASS',assets:names.length,chainId:status.chainId,writesEnabled:status.writesEnabled,legacyIssuedPreserved:true,walletActions:0,existingTestUsdc:status.currency.address}));
