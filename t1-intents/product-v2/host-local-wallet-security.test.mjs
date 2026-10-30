import {request} from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import {makeProductHost} from './host.mjs';
import {makeProductHttp} from './http.mjs';
const publicOrigin='https://mealforward-test.onrender.com';
test('local wallet mounting requires explicit local profile and loopback before touching dependencies',async()=>{
 let touched=0;const args={enabled:true,pool:{query(){touched++;}},chain:{verifyTarget(){touched++;}},localWallet:{handler(){throw Error('should not execute');}}};
 for(const fields of [{origin:publicOrigin},{origin:publicOrigin,profile:'local-acceptance'},{origin:'http://127.0.0.1:43210'},{origin:'http://localhost:43210',profile:'local-acceptance'},{origin:'http://127.0.0.1:43210',profile:'monad-testnet'}])await assert.rejects(makeProductHost({...args,...fields}),/LOCAL_WALLET_HOST_REJECTED/);assert.equal(touched,0);
});
test('default production host exposes neither local wallet code nor signing endpoint',async t=>{
 const host=await makeProductHost({origin:publicOrigin,enabled:false});await new Promise(r=>host.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>host.server.close(r)));const origin='http://127.0.0.1:'+host.server.address().port;
 for(const path of ['/product-v2/local-wallet.mjs','/v1/local-wallet']){const r=await new Promise((resolve,reject)=>{const req=request(origin+path,{headers:{host:new URL(publicOrigin).host}},res=>{let body='';res.on('data',part=>body+=part);res.on('end',()=>resolve({status:res.statusCode,body}));});req.on('error',reject);req.end();});assert.equal(r.status,404);assert.doesNotMatch(r.body,/privateKey|frontendSource|eth_sendTransaction/);}
});
test('ledger alone is public, and origin violations are rejected before any read',async()=>{
 let reads=0,auth=0;const handler=makeProductHttp({origin:publicOrigin,enabled:true,service:{ledger:async()=>{reads++;return {verified:true,items:[],counts:{funded:'0'}};}},authorize:async()=>{auth++;return null;}});
 async function get(path,headers={}){let status,body;await handler({url:path,method:'GET',headers:{host:new URL(publicOrigin).host,...headers}},{writeHead:s=>status=s,end:b=>body=JSON.parse(b)});return {status,body};}
 assert.equal((await get('/v1/product/ledger')).status,200);assert.equal(auth,0);assert.equal(reads,1);for(const headers of [{origin:'https://other.test'},{host:'other.test'},{'sec-fetch-site':'cross-site'}])assert.equal((await get('/v1/product/ledger',headers)).status,403);assert.equal(reads,1);assert.equal((await get('/v1/product/orders')).status,401);assert.equal((await get('/v1/product/ledger?wallet=other')).status,401);assert.equal(reads,1);
});
