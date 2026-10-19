import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request as requestHttp} from 'node:http';
import {createHash} from 'node:crypto';
import {makePilotHandler} from './core.mjs';
import {makeG1RenderReadGateway} from './g1-readonly-gateway.mjs';
import {
 verifiedPublicStores,verifiedPublicMeals,verifiedPublicLedger
} from '../sites-frontend/dist/g1-read-contract.mjs';

const origin='https://mealforward-g1-backend-staging.onrender.com';
const host=new URL(origin).host;
const store='a'.repeat(64),meal='b'.repeat(64),now=1792400000;
const wallet='0x'+'a'.repeat(40);
const hash=x=>createHash('sha256').update(x).digest('hex');
const financial=()=>({
 F:'14000000',A:'7000000',R:'0',H:'0',S:'7000000',X:'0',
 liability:'7000000',counts:{F:'2',A:'1',R:'0',H:'0',S:'1',X:'0'}
});
const payload=()=>({
 mode:'G1_PUBLIC_SOURCE_PROJECTION_ONLY',source:'CP30_ORIGINAL_POSTGRES',
 businessTransactionsAllowed:false,asOf:now-1,
 stores:{items:[{id:store,store,name:'Test kitchen from signed projection',escrow:'0x'+'9'.repeat(40)}]},
 ledger:{items:[{store,funded:'2',financial:financial()}]},
 meals:{items:[{id:meal,meal,mealId:'0x'+meal,store,version:'1',
  name:'Test meal',description:'Synthetic test fixture only',
  windows:[[600,900]],listed:true,published:true,
  eligible:'1',supported:'2',unitPrice:'7000000',assetDecimals:6,
  assetSymbol:'USDC',financial:financial(),collectionTimeZone:'Asia/Shanghai'
 }]}
});
const snapshot=()=>({
 status:'G1_PUBLIC_SNAPSHOT_VERIFIED',sequence:'1',receiptDigest:'c'.repeat(64),
 asOf:now-1,expiresAt:now+90,authenticatedPublicSource:true,
 independentlyAnchored:true,chainFinalityIndependentlyVerified:false,data:payload()
});
function fakeAuth(){
 const token='t'.repeat(43);
 const auth=makePilotHandler({
  store:{
   health:async()=>true,
   getSession:async(digest)=>digest===hash(token)?{wallet}:null
  },
  origin,clock:()=>now,
  siwe:{makeChallenge:()=>{throw Error('not used')},verifyChallenge:async()=>{throw Error('not used')}}
 });
 return {auth,token};
}
async function serve(cache,fn){
 const {auth,token}=fakeAuth();
 const route=makeG1RenderReadGateway({
  authHandler:auth,origin,clock:()=>now,publicCache:cache
 });
 const server=createServer(route);
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const request=(p,{method='GET',headers={}}={})=>new Promise((resolve,reject)=>{
  const req=requestHttp({
   hostname:'127.0.0.1',port:server.address().port,path:p,
   method,headers:{host,...headers}
  },async res=>{
   let body='';for await(const part of res)body+=part.toString('utf8');
   try{resolve({status:res.statusCode,body:JSON.parse(body),headers:res.headers});}
   catch(error){reject(error);}
  });
  req.on('error',reject);req.end();
 });
 try{return await fn({request,token});}
 finally{await new Promise(ok=>server.close(ok))}
}
test('baseline G0 session handshake remains Auth Pilot and never implicitly becomes original CP30 principal',async()=>{
 await serve(null,async({request,token})=>{
  const meta=await request('/v1/connection');
  assert.equal(meta.status,200);
  assert.equal(meta.body.authPilot,true);
  assert.equal(meta.body.businessSourceConnected,false);
  assert.equal(meta.body.originalPrincipalCompatible,false);
  assert.equal(meta.body.transactionActionsEnabled,false);
  assert.equal((await request('/v1/me')).status,401);
  const session=await request('/v1/me',{headers:{cookie:'__Host-mcpay_c1_session='+token}});
  assert.equal(session.status,200);
  assert.equal(session.body.walletAddress,wallet);
  assert.deepEqual(session.body.stores,[]);
  assert.equal(session.body.authPilot,true);
 });
});
test('no attached original source always returns 503, not fake empty stores/ledger',async()=>{
 await serve(null,async({request})=>{
  for(const route of ['/v1/stores','/v1/ledger','/v1/stores/'+store+'/meals']){
   const result=await request(route);
   assert.equal(result.status,503);
   assert.equal(result.body.error,'ORIGINAL_BUSINESS_NOT_CONNECTED');
  }
 });
});
test('verified signed source projects public DTOs; private endpoints still refuse even with valid pilot session',async()=>{
 await serve({current:async()=>snapshot()},async({request,token})=>{
  const a=await request('/v1/stores');
  const b=await request('/v1/stores/'+store+'/meals');
  const c=await request('/v1/ledger');
  assert.equal(a.status,200);
  assert.equal(b.status,200);
  assert.equal(c.status,200);
  assert.equal(verifiedPublicStores(a.body).length,1);
  assert.equal(verifiedPublicMeals(b.body,store).length,1);
  assert.equal(verifiedPublicLedger(c.body)[0].funded,'2');
  for(const p of ['/v1/my/orders','/v1/my/claims','/v1/my/vouchers','/v1/stores/'+store+'/workbench']){
   const out=await request(p,{headers:{cookie:'__Host-mcpay_c1_session='+token}});
   assert.equal(out.status,503);
   assert.equal(out.body.error,'ORIGINAL_BUSINESS_NOT_CONNECTED');
  }
  assert.equal((await request('/v1/support/intents',{method:'POST',headers:{origin}})).status,503);
 });
});
test('expired, unsigned or unanchored public source cannot report success',async()=>{
 for(const problem of [
  {independentlyAnchored:false},
  {authenticatedPublicSource:false},
  {expiresAt:now-1},
  {data:{...payload(),businessTransactionsAllowed:true}},
 ]){
  const candidate={...snapshot(),...problem};
  await serve({current:async()=>candidate},async({request})=>{
   const response=await request('/v1/stores');
   assert.equal(response.status,503);
   assert.equal(response.body.error,'G1_PUBLIC_SOURCE_NOT_READY');
  });
 }
});
test('public read rejects Host or Origin injection without affecting the existing auth gateway',async()=>{
 await serve({current:async()=>snapshot()},async({request})=>{
  assert.equal((await request('/v1/stores',{headers:{host:'attacker.example'}})).status,403);
  assert.equal((await request('/v1/stores',{headers:{origin:'https://attacker.example'}})).status,403);
  assert.equal((await request('/v1/ledger?incorrect=1')).status,403);
 });
});
