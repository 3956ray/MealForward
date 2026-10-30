import test from 'node:test';
import assert from 'node:assert/strict';
import {makeProductHost} from './host.mjs';
import {request} from 'node:http';
test('standalone host defaults closed and never mounts legacy APIs or arbitrary files',async t=>{
  // Use a pinned Host while the isolated listener selects an unused local port.
  const host=await makeProductHost({origin:'http://127.0.0.1:19999',pool:{query(){throw Error('no database expected');}}});
  await new Promise(r=>host.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>host.server.close(r)));
  const base='http://127.0.0.1:'+host.server.address().port;
  const get=path=>new Promise((resolve,reject)=>{const req=request(base+path,{headers:{Host:'127.0.0.1:19999'}},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode}));});req.on('error',reject);req.end();});
  assert.equal((await get('/')).status,303);
  assert.equal((await get('/v1/product/identity/setup')).status,503);
  assert.equal((await get('/v1/mvp/me')).status,404);
  assert.equal((await get('/product-v2/schema.sql')).status,404);
  assert.equal((await get('/product-v2/../runtime.mjs')).status,404);
  assert.equal((await fetch(base+'/')).status,403);
  assert.equal(host.tickClaims,undefined);
});
