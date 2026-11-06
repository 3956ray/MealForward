import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';import {makeProductHttp} from './http.mjs';
test('atomic expiry cancellation is a session-bound CSRF POST, never a read or supplied wallet',async()=>{
 let handler,calls=[];const server=createServer((req,res)=>handler(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port,wallet='0x'+'a'.repeat(40);
 handler=makeProductHttp({service:{},origin,enabled:true,atomic:{cancelExpired:async(w,id)=>{calls.push([w,id]);return {state:'CANCELLED'};}},authorize:async req=>({wallet,csrfVerified:req.headers['x-csrf']==='yes'})});
 const url=origin+'/v1/product/atomic-funding/original/cancel-expired',post={method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-CSRF':'yes'},body:'{}'};
 try{assert.equal((await fetch(url)).status,422);assert.equal((await fetch(url,{...post,headers:{Origin:origin,'Content-Type':'application/json'}})).status,403);assert.equal((await fetch(url,{...post,body:JSON.stringify({wallet:'attacker'})})).status,422);assert.equal(calls.length,0);const res=await fetch(url,post);assert.equal(res.status,200);assert.equal((await res.json()).state,'CANCELLED');assert.deepEqual(calls,[[wallet,'original']]);}finally{await new Promise(r=>server.close(r));}
});
