import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {makeG1RenderReadGateway} from './g1-readonly-gateway.mjs';

const origin='https://mealforward-g1-staging.onrender.com';
const host=new URL(origin).host;
const writer=(res,status,value)=>{
 res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});
 res.end(JSON.stringify(value));
};
function makeTestGateway(probeHandler){
 const authHandler=async(req,res)=>{
  if(req.url?.startsWith('/v1/'))return writer(res,503,{error:'ORIGINAL_BUSINESS_NOT_CONNECTED'});
  return writer(res,404,{error:'NOT_FOUND'});
 };
 return makeG1RenderReadGateway({authHandler,probeHandler,origin});
}
async function request(handler,path){
 const server=http.createServer(handler);
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 try{
  return await new Promise((resolve,reject)=>{
   const req=http.request({
    hostname:'127.0.0.1',port:server.address().port,path,
    headers:{host},method:'GET'
   },async res=>{
    let text='';for await(const chunk of res)text+=chunk.toString();
    resolve({status:res.statusCode,body:JSON.parse(text)});
   });
   req.on('error',reject);req.end();
  });
 }finally{await new Promise(ok=>server.close(ok))}
}
test('default gateway NEVER exposes the optional synthetic namespace',async()=>{
 const h=makeTestGateway(null);
 const probe=await request(h,'/__g1_probe/my/orders');
 assert.equal(probe.status,404);
 assert.equal(probe.body.error,'NOT_FOUND');
 assert.equal((await request(h,'/v1/my/orders')).status,503);
});
test('explicit test-only handler may receive test-prefixed path but cannot replace real money read routes',async()=>{
 let count=0;
 const h=makeTestGateway(async(req,res)=>{
  count++;
  writer(res,200,{mode:'ISOLATED_SYNTHETIC_G1_READ_TEST',items:[]});
 });
 const x=await request(h,'/__g1_probe/my/orders');
 assert.equal(x.status,200);
 assert.equal(x.body.mode,'ISOLATED_SYNTHETIC_G1_READ_TEST');
 assert.equal((await request(h,'/v1/my/orders')).status,503);
 assert.equal((await request(h,'/v1/my/vouchers')).status,503);
 assert.equal((await request(h,'/v1/stores')).status,503);
 assert.equal(count,1);
});
test('cannot mount malformed probe adapter',()=>{
 assert.throws(()=>makeTestGateway({current:async()=>{}}),/G1_TEST_PROBE_HANDLER_REQUIRED/);
});
