import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {makeG1OriginalPrivateHttpHandler} from './private-http.mjs';

const origin='https://mealforward-g1-original-source-review.example';
const host=new URL(origin).host;
const tokenA='p'.repeat(43),tokenB='q'.repeat(43);
const hash=x=>createHash('sha256').update(x,'utf8').digest('hex');
const store='f'.repeat(64);
const voucherA='0x'+'a'.repeat(64),voucherB='0x'+'b'.repeat(64);
const ids=['11111111-1111-4111-8111-111111111111',
 '22222222-2222-4222-8222-222222222222'];
const doc=(who,section)=>{
 const id=ids[who],v=who===0?voucherA:voucherB;
 if(section==='orders')return {items:[{
  id,intentId:id,store,action:'fund',stage:'FINAL_SUCCEEDED',
  quantity:'2',amount:'14000000',transactionHash:null
 }]};
 if(section==='claims')return {items:[{
  id,intentId:id,store,action:'issue',stage:'UNKNOWN',transactionHash:null
 }]};
 if(section==='vouchers')return {items:[{
  id:v,voucherId:v,store,state:'R',generation:'1',
  mealId:'0x'+'e'.repeat(64),version:'1',
  expiresAt:'1900000000',terms:{name:'Warm meal',windows:[[660,780]]}
 }]};
 throw Error('UNRECOGNIZED_REQUEST');
};

function source(calls){
 return {kind:'ORIGINAL_CP30_PRIVATE_SOURCE_V1',
  async readOriginalPrivate({section,originalSessionHash}){
   calls.push({section,originalSessionHash});
   if(originalSessionHash===hash(tokenA))return doc(0,section);
   if(originalSessionHash===hash(tokenB))return doc(1,section);
   throw Object.assign(Error('NO_ORIGINAL_PRINCIPAL'),{code:'UNAUTHENTICATED'});
  }
 };
}
const cookie=token=>'__Host-mcpay_c1_session='+token;
async function serve(adapter,run){
 const server=http.createServer(adapter);
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const port=server.address().port;
 const request=(route,{method='GET',headers={}}={})=>new Promise((resolve,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port,path:route,method,
   headers:{host,...headers}},async res=>{
   let data='';for await(const part of res)data+=part.toString('utf8');
   try{resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(data)})}
   catch(e){reject(e)}
  });
  req.on('error',reject);req.end();
 });
 try{return await run(request)}
 finally{await new Promise(ok=>server.close(ok))}
}
test('no Auth Pilot or unpinned original source is allowed to mount as CP30 private API',()=>{
 assert.throws(()=>makeG1OriginalPrivateHttpHandler({
  source:{kind:'CP31_AUTH_PILOT_ONLY',readOriginalPrivate:async()=>({items:[]})},origin
 }),/G1_B_ORIGINAL_SOURCE_REQUIRED/);
 assert.throws(()=>makeG1OriginalPrivateHttpHandler({source:source([]),origin:'http://localhost:10000'}),/G1_B_PINNED_ORIGIN_REQUIRED/);
});
test('real original-cookie digest routes to A/B isolated orders, claims and vouchers',async()=>{
 const calls=[];
 await serve(makeG1OriginalPrivateHttpHandler({source:source(calls),origin}),async request=>{
  for(const [who,token,foreign] of [[0,tokenA,voucherB],[1,tokenB,voucherA]]){
   for(const route of ['/v1/my/orders','/v1/my/claims','/v1/my/vouchers']){
    const r=await request(route,{headers:{cookie:cookie(token)}});
    assert.equal(r.status,200);
    assert.equal(r.body.items.length,1);
    assert.match(r.headers['cache-control'],/no-store/);
    assert.equal(r.headers.vary,'Cookie');
    assert.equal(r.headers['access-control-allow-origin'],undefined);
    assert.ok(!JSON.stringify(r.body).includes(foreign));
    assert.ok(!JSON.stringify(r.body).includes(token));
    if(route==='/v1/my/vouchers')assert.equal(r.body.items[0].voucherId,who===0?voucherA:voucherB);
    if(route==='/v1/my/claims')assert.equal(r.body.items[0].stage,'UNKNOWN');
   }
  }
 });
 assert.equal(calls.length,6);
 assert.deepEqual([...new Set(calls.map(x=>x.originalSessionHash))].sort(),[hash(tokenA),hash(tokenB)].sort());
 assert.ok(calls.every(x=>!Object.hasOwn(x,'walletAddress')&&!Object.hasOwn(x,'recipientKey')));
});
test('requests cannot choose a wallet or turn GET into a mutation',async()=>{
 const calls=[];
 await serve(makeG1OriginalPrivateHttpHandler({source:source(calls),origin}),async request=>{
  for(const [opts,status] of [
   [{headers:{cookie:cookie(tokenA),'x-wallet-address':'0x'+'b'.repeat(40)}},403],
   [{headers:{cookie:cookie(tokenA),'x-recipient-key':'bb'}},403],
   [{headers:{cookie:cookie(tokenA),origin:'https://attacker.example'}},403],
   [{headers:{cookie:cookie(tokenA),'sec-fetch-site':'cross-site'}},403],
   [{headers:{cookie:cookie(tokenA),host:'attacker.example'}},403],
   [{headers:{cookie:cookie(tokenA)},method:'POST'},405],
  ]){
   const r=await request('/v1/my/orders',opts);assert.equal(r.status,status);
  }
  assert.equal((await request('/v1/my/orders?wallet=b',{headers:{cookie:cookie(tokenA)}})).status,403);
  assert.equal((await request('/v1/support/intents',{headers:{cookie:cookie(tokenA)}})).status,404);
 });
 assert.equal(calls.length,0);
});
test('missing, duplicate or unrecognized original session fails as 401 without source leak',async()=>{
 const calls=[];
 await serve(makeG1OriginalPrivateHttpHandler({source:source(calls),origin}),async request=>{
  for(const header of [
   undefined,
   cookie(tokenA)+'; '+cookie(tokenB),
   '__Host-mcpay_c1_session=notvalid',
   cookie('z'.repeat(43))
  ]){
   const r=await request('/v1/my/orders',{headers:header?{cookie:header}:{}});
   assert.equal(r.status,401);
   assert.deepEqual(r.body,{error:'UNAUTHENTICATED'});
  }
 });
 assert.equal(calls.length,1);
});
test('bad or unavailable original database responses never appear as successful empty records',async()=>{
 const errors=[
  {readOriginalPrivate:async()=>{throw Error('PRIVATE_POSTGRES_FAILED')}},
  {readOriginalPrivate:async()=>({items:[{email:'sensitive@test.invalid'}]})},
  {readOriginalPrivate:async()=>({items:[doc(0,'orders').items[0],doc(0,'orders').items[0]]})},
  {readOriginalPrivate:async()=>({items:{}})}
 ];
 for(let candidate of errors){
  const srv={kind:'ORIGINAL_CP30_PRIVATE_SOURCE_V1',...candidate};
  await serve(makeG1OriginalPrivateHttpHandler({source:srv,origin}),async request=>{
   const r=await request('/v1/my/orders',{headers:{cookie:cookie(tokenA)}});
   assert.equal(r.status,503);
   assert.ok(!JSON.stringify(r.body).includes('PRIVATE_POSTGRES_FAILED'));
   assert.ok(!JSON.stringify(r.body).includes('sensitive@test.invalid'));
  });
 }
});
