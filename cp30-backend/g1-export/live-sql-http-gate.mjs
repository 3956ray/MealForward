/**
 * CI-only, actual original CP30 PostgreSQL -> production HTTP adapter test.
 * The source RPC is local loopback and uses an open disposable PG17
 * transaction seeded by g1_private_source_pg_probe.py. No public server,
 * Render Auth Pilot cookie, fund/issue operation, signer or old CP30 state.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {makeG1OriginalPrivateHttpHandler} from './private-http.mjs';

const origin='https://mealforward-g1-review.onrender.com';
const bridge=process.env.MF_G1_C_LOOPBACK;
const raw=[process.env.MF_G1_C_RAW_A,process.env.MF_G1_C_RAW_B];
if(process.env.GITHUB_ACTIONS!=='true'||
 process.env.MF_G2_DISPOSABLE_ONLY!=='ack-fresh-gha-postgres-17'||
 typeof bridge!=='string'||!/^http:\/\/127\.0\.0\.1:[0-9]{2,5}$/.test(bridge)||
 !raw.every(x=>typeof x==='string'&&/^[A-Za-z0-9_-]{43}$/.test(x))||
 raw[0]===raw[1])throw Error('G1_C_DISPOSABLE_TEST_CONTEXT_REQUIRED');

const hash=x=>createHash('sha256').update(x,'utf8').digest('hex');
let readCount=0;
const source={
 kind:'ORIGINAL_CP30_PRIVATE_SOURCE_V1',
 async readOriginalPrivate({section,originalSessionHash}){
  assert.ok(['orders','claims','vouchers'].includes(section));
  assert.ok(raw.some(token=>hash(token)===originalSessionHash),
   'The backend attempted a source lookup with an unknown Cookie digest');
  const response=await fetch(bridge+'/__ci_original_source',{
   method:'POST',redirect:'error',signal:AbortSignal.timeout(4000),
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({section,originalSessionHash})
  });
  const payload=await response.json();
  if(!response.ok){
   throw Object.assign(Error('ORIGINAL_SOURCE_FAILED'),
    {code:payload.error==='UNAUTHENTICATED'?'UNAUTHENTICATED':'ORIGINAL_SOURCE_UNAVAILABLE'});
  }
  readCount++;
  return payload.data;
 }
};
const handler=makeG1OriginalPrivateHttpHandler({origin,source});
const server=http.createServer(handler);
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port;

function get(path,{token=null,headers={},method='GET'}={}){
 return new Promise((resolve,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port,
   path,method,
   headers:{Host:new URL(origin).host,
    ...(token?{Cookie:'__Host-mcpay_c1_session='+token}:{}),...headers}
  },async res=>{
   let body='';
   for await(const chunk of res)body+=chunk.toString('utf8');
   try{resolve({status:res.statusCode,body:JSON.parse(body),headers:res.headers})}
   catch(error){reject(error)}
  });
  req.on('error',reject);req.end();
 });
}
try{
 const rows=[];
 for(let i=0;i<2;i++){
  const owner=raw[i],otherVoucher='0x'+(i===0?'b':'a').repeat(64);
  const found={};
  for(const [path,action] of [
   ['/v1/my/orders','fund'],
   ['/v1/my/claims','issue'],
   ['/v1/my/vouchers',null]
  ]){
   const response=await get(path,{token:owner});
   assert.equal(response.status,200,'Source-backed original CP30 private GET must succeed');
   assert.equal(response.body.items.length,1,'Exactly one original record per wallet/section');
   assert.equal(response.headers['access-control-allow-origin'],undefined);
   assert.match(response.headers['cache-control'],/no-store/);
   const entry=response.body.items[0];
   if(action)assert.equal(entry.action,action);
   else{
    assert.equal(entry.voucherId,'0x'+(i===0?'a':'b').repeat(64));
    assert.equal(entry.state,'R');
    assert.equal(entry.terms.name,'Warm meal');
   }
   assert.ok(!JSON.stringify(response.body).includes(otherVoucher));
   assert.ok(!JSON.stringify(response.body).includes(owner));
   found[path]=entry.id;
  }
  rows.push(found);
 }
 assert.notDeepEqual(rows[0],rows[1],'Wallet A/B originally scoped records must differ');
 for(const opts of [
  {token:raw[0],headers:{'x-wallet-address':'0x'+'b'.repeat(40)}},
  {token:raw[0],headers:{Origin:'https://attacker.example'}},
  {token:raw[0],headers:{Host:'attacker.example'}},
  {token:raw[0],headers:{'sec-fetch-site':'cross-site'}},
 ]){
  assert.equal((await get('/v1/my/orders',opts)).status,403);
 }
 assert.equal((await get('/v1/my/orders')).status,401);
 assert.equal((await get('/v1/my/orders',{token:raw[0],method:'POST'})).status,405);
 assert.equal((await get('/v1/support/intents',{token:raw[0]})).status,404);
 assert.equal(readCount,6,'All and only six original SQL lookups allowed');
 process.stdout.write(JSON.stringify({
  status:'G1_C_REAL_SQL_HTTP_PASS',readCount,
  privateWalletsIsolated:true,originalSessionOnly:true,
  cp30OriginalMigrations:true,frontEndDtoValidated:true,
  sourceKind:'CP30_ORIGINAL_SQL',businessWrites:0,
  onchainTransactions:0,sourceInciOnly:true
 })+'\n');
}finally{
 await new Promise(ok=>server.close(ok));
}
