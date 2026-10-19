// Source-only Sites DTO contract tests. No live HTTP service, wallet,
// original Mac, private sessions, PostgreSQL, signer or chain transactions.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
 sourceToPublicSitesDtos,makeG1PublicSitesReadHandler
} from './public-sites-read.mjs';
import {
 verifiedPublicStores,verifiedPublicMeals,verifiedPublicLedger
} from '../../sites-frontend/dist/g1-read-contract.mjs';

const now=1792380000,store='a'.repeat(64),meal='b'.repeat(64);
const origin='https://mealforward-g1-review.onrender.com';
const financial=()=>({
 F:'14000000',A:'7000000',R:'0',H:'0',S:'7000000',X:'0',
 liability:'7000000',counts:{F:'2',A:'1',R:'0',H:'0',S:'1',X:'0'}
});
const publicPayload=()=>({
 mode:'G1_PUBLIC_SOURCE_PROJECTION_ONLY',
 source:'CP30_ORIGINAL_POSTGRES',
 businessTransactionsAllowed:false,asOf:now-2,
 stores:{items:[{id:store,store,name:'留膳社区厨房',escrow:'0x'+'1'.repeat(40)}]},
 ledger:{items:[{store,funded:'2',financial:financial()}]},
 meals:{items:[{
  id:meal,meal,mealId:'0x'+meal,store,version:'1',
  name:'暖心盖饭',description:'由支持者预付的餐食',
  windows:[[690,810]],listed:true,published:true,
  eligible:'1',supported:'2',unitPrice:'7000000',
  assetDecimals:6,assetSymbol:'USDC',
  financial:financial(),collectionTimeZone:'Asia/Shanghai'
 }]}
});
const proof=()=>({
 status:'G1_PUBLIC_SNAPSHOT_VERIFIED',
 sequence:'1',receiptDigest:'c'.repeat(64),
 asOf:now-2,expiresAt:now+90,
 authenticatedPublicSource:true,independentlyAnchored:true,
 chainFinalityIndependentlyVerified:false,data:publicPayload()
});
const error=async(fn)=>assert.rejects(Promise.resolve().then(fn));

function request(port,path,{method='GET',headers={}}={}){
 return new Promise((resolve,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port,path,method,
    headers:{host:new URL(origin).host,...headers}},async res=>{
    let value='';for await(const chunk of res)value+=chunk.toString('utf8');
    try{resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(value)});}
    catch(e){reject(e)}
   });
  req.on('error',reject);
  req.end();
 });
}
async function serve(cache,run){
 const server=http.createServer(makeG1PublicSitesReadHandler({
  cache,origin,clock:()=>now
 }));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{return await run(server.address().port);}
 finally{await new Promise(resolve=>server.close(resolve))}
}
const live=()=>({current:async()=>proof()});

test('signed anchored snapshot maps to exact G1 Sites public DTO shapes and conserves money',()=>{
 const view=sourceToPublicSitesDtos(proof(),now);
 assert.equal(view.sourceSequence,'1');
 assert.equal(view.meals.length,1);
 assert.equal(view.stores.length,1);
 assert.equal(view.ledger.length,1);
 assert.equal(verifiedPublicStores({items:view.stores})[0].name,'留膳社区厨房');
 assert.equal(verifiedPublicMeals({items:view.meals},store)[0].unitPrice,'7000000');
 assert.equal(verifiedPublicLedger({items:view.ledger})[0].funded,'2');
});
test('public HTTP routes serve original DTOs; never imply chain finality or fake transaction success',async()=>{
 await serve(live(),async port=>{
  const stores=await request(port,'/v1/stores');
  const meals=await request(port,'/v1/stores/'+store+'/meals');
  const ledger=await request(port,'/v1/ledger');
  for(const item of [stores,meals,ledger]){
   assert.equal(item.status,200);
   assert.equal(item.headers['x-mealforward-chain-finality'],'UNVERIFIED');
   assert.match(item.headers['cache-control'],/no-store/);
   assert.equal(item.headers['access-control-allow-origin'],undefined);
  }
  assert.equal(verifiedPublicStores(stores.body).length,1);
  assert.equal(verifiedPublicMeals(meals.body,store).length,1);
  assert.equal(verifiedPublicLedger(ledger.body)[0].funded,'2');
  assert.equal(meals.body.items[0].name,'暖心盖饭');
  assert.equal(meals.body.items[0].eligible,'1');
  assert.ok(!JSON.stringify([stores.body,meals.body,ledger.body]).includes('recipientKey'));
 });
});
test('public reads ignore ambient wallet cookies but private reads never open',async()=>{
 let calls=0;
 const cache={current:async()=>{calls++;return proof()}};
 await serve(cache,async port=>{
  assert.equal((await request(port,'/v1/stores',{headers:{cookie:'old-wallet-session=private'}})).status,200);
  for(const privatePath of ['/v1/me','/v1/my/orders','/v1/my/vouchers','/v1/store-registrations','/v1/support/intents','/v1/stores/'+store+'/workbench']){
   const result=await request(port,privatePath);
   assert.equal(result.status,503);
   assert.equal(result.body.error,'ORIGINAL_BUSINESS_NOT_CONNECTED');
  }
  assert.equal((await request(port,'/v1/stores',{method:'POST'})).status,405);
  assert.equal((await request(port,'/v1/stores',{headers:{authorization:'Bearer unknown'}})).status,403);
  assert.equal(calls,1,'No cache hit on private or rejected requests');
 });
});
test('invalid origin, query, route or store never looks up original source',async()=>{
 let calls=0;
 await serve({current:async()=>{calls++;return proof()}},async port=>{
  assert.equal((await request(port,'/v1/stores?preview=true')).status,403);
  assert.equal((await request(port,'/v1/stores',{headers:{host:'evil.example'}})).status,403);
  assert.equal((await request(port,'/v1/stores',{headers:{origin:'https://evil.example'}})).status,403);
  assert.equal((await request(port,'/v1/stores',{headers:{'sec-fetch-site':'cross-site'}})).status,403);
  assert.equal((await request(port,'/v1/stores/'+('z'.repeat(64))+'/meals')).status,400);
  assert.equal((await request(port,'/v1/stores/'+('c'.repeat(64))+'/meals')).status,404);
  assert.equal((await request(port,'/v1/nonexistent')).status,503);
  assert.equal(calls,1);
 });
});
test('source absent / expired / unsigned / unanchored / corrupt data always return 503, never empty success',async()=>{
 const variants=[
  null,
  {...proof(),authenticatedPublicSource:false},
  {...proof(),independentlyAnchored:false},
  {...proof(),chainFinalityIndependentlyVerified:true},
  {...proof(),expiresAt:now},
  {...proof(),receiptDigest:'bad'},
  {...proof(),asOf:now-121,data:{...publicPayload(),asOf:now-121}},
  {...proof(),data:{...publicPayload(),businessTransactionsAllowed:true}},
  {...proof(),data:{...publicPayload(),stores:{items:[{...publicPayload().stores.items[0],recipientKey:'secret'}]}}},
  {...proof(),data:{...publicPayload(),ledger:{items:[{store,funded:'2',financial:{...financial(),liability:'0'}}]}}},
 ];
 for(const item of variants){
  await serve({current:async()=>item},async port=>{
   const r=await request(port,'/v1/stores');
   assert.equal(r.status,503);
   assert.equal(r.body.error,'G1_PUBLIC_SOURCE_NOT_READY');
  });
 }
 await serve({current:async()=>{throw Error('PG_NOT_AVAILABLE')}},async port=>{
  const r=await request(port,'/v1/ledger');
  assert.equal(r.status,503);
  assert.equal(r.body.error,'G1_PUBLIC_SOURCE_NOT_READY');
 });
});
test('valid source with no stores is distinct from an unavailable source',async()=>{
 const p=proof();
 p.data={...publicPayload(),
  stores:{items:[]},meals:{items:[]},ledger:{items:[]}};
 await serve({current:async()=>p},async port=>{
  const r=await request(port,'/v1/stores');
  assert.equal(r.status,200);
  assert.deepEqual(r.body,{items:[]});
 });
});
test('unlisted meal is hidden, while store and ledger remain available',async()=>{
 const p=proof();p.data.meals.items[0].listed=false;
 await serve({current:async()=>p},async port=>{
  const r=await request(port,'/v1/stores/'+store+'/meals');
  assert.equal(r.status,200);
  assert.deepEqual(r.body,{items:[]});
  assert.equal((await request(port,'/v1/ledger')).body.items.length,1);
 });
});
