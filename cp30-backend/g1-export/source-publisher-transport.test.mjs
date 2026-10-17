import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {publicEnvelopeSigningBytes} from './public-envelope.mjs';
import {makePinnedG1PublicTransport} from './source-publisher-transport.mjs';

const NOW=1790000000;
const AUDIENCE='https://mealforward-cp31-auth-laodao.onrender.com';
const KEY_ID='mealforward-g1-public-export-v1';
const STORE='a'.repeat(64),MEAL='b'.repeat(64);
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const foreign=generateKeyPairSync('ed25519');
const FINGERPRINT=createHash('sha256').update(
 publicKey.export({type:'spki',format:'der'})
).digest('hex');
const money=()=>({F:'7000000',A:'7000000',R:'0',H:'0',S:'0',X:'0',
 liability:'7000000',counts:{F:'1',A:'1',R:'0',H:'0',S:'0',X:'0'}});
const publicData=()=>({
 mode:'G1_PUBLIC_SOURCE_PROJECTION_ONLY',
 source:'CP30_ORIGINAL_POSTGRES',businessTransactionsAllowed:false,asOf:NOW-2,
 stores:{items:[{id:STORE,store:STORE,name:'Kitchen',escrow:'0x'+'3'.repeat(40)}]},
 ledger:{items:[{store:STORE,funded:'1',financial:money()}]},
 meals:{items:[{
  id:MEAL,meal:MEAL,mealId:'0x'+MEAL,store:STORE,version:'1',
  name:'Rice',description:'Warm rice',windows:[[690,810]],
  listed:true,published:true,eligible:'1',supported:'1',unitPrice:'7000000',
  assetDecimals:6,assetSymbol:'USDC',financial:money(),
  collectionTimeZone:'Asia/Shanghai'
 }]}
});
const signed=(changes={},key=privateKey)=>{
 const unsigned={
  v:1,keyId:KEY_ID,audience:AUDIENCE,issuedAt:NOW,
  expiresAt:NOW+90,sequence:'1',data:publicData(),...changes
 };
 return {...unsigned,signature:sign(null,publicEnvelopeSigningBytes(unsigned),key).toString('base64url')};
};
const deny=async value=>assert.rejects(value,{code:'G1_PUBLIC_TRANSPORT_REJECTED'});
const endpoint=AUDIENCE+'/v1/g1/public-snapshot';
const response=(body,{status=200,url=endpoint,contentType='application/json',redirected=false}={})=>{
 const r=new Response(typeof body==='string'?body:JSON.stringify(body),{
  status,headers:{'Content-Type':contentType}
 });
 Object.defineProperty(r,'url',{value:url});
 Object.defineProperty(r,'redirected',{value:redirected});
 return r;
};
const validGet=(doc=signed())=>({
 status:'G1_PUBLIC_SNAPSHOT_VERIFIED',
 sequence:doc.sequence,receiptDigest:'c'.repeat(64),
 expiresAt:doc.expiresAt,asOf:doc.data.asOf,
 authenticatedPublicSource:true,independentlyAnchored:true,
 chainFinalityIndependentlyVerified:false,data:doc.data
});
function fixture({fetchImpl}={}){
 const calls=[];
 const sendResponse=response({accepted:true},{status:201});
 const getResponse=response(validGet());
 const transport=makePinnedG1PublicTransport({
  expectedAudience:AUDIENCE,expectedKeyId:KEY_ID,publicKey,
  expectedPublicKeyFingerprint:FINGERPRINT,clock:()=>NOW,
  fetchImpl:async (uri,options)=>{
   calls.push({uri,options});
   return fetchImpl?fetchImpl(uri,options):options.method==='POST'?sendResponse:getResponse;
  }
 });
 return {transport,calls};
}
test('POST sends ONLY signed public JSON to exact pinned HTTPS endpoint with no credentials or redirects',async()=>{
 const {transport,calls}=fixture();
 const doc=signed();
 assert.deepEqual(await transport.send(doc),{status:201});
 assert.equal(calls.length,1);
 assert.equal(calls[0].uri,endpoint);
 assert.equal(calls[0].options.method,'POST');
 assert.equal(calls[0].options.redirect,'error');
 assert.equal(calls[0].options.credentials,'omit');
 assert.equal(calls[0].options.referrerPolicy,'no-referrer');
 assert.equal(calls[0].options.headers['Content-Type'],'application/json');
 assert.equal(calls[0].options.headers.Authorization,undefined);
 assert.equal(calls[0].options.headers.Cookie,undefined);
 assert.equal(calls[0].options.signal.aborted,false);
 assert.deepEqual(JSON.parse(calls[0].options.body),doc);
});
test('read-back requires authenticated and independently anchored public snapshot with no private fields',async()=>{
 const {transport,calls}=fixture();
 const value=await transport.readBack();
 assert.deepEqual(value,validGet());
 assert.equal(calls[0].options.method,'GET');
 assert.equal(calls[0].options.body,undefined);
 assert.equal(calls[0].options.redirect,'error');
 assert.equal(calls[0].options.credentials,'omit');
});
test('a replay-style POST 409 is not treated as an ACK without a separate read-back',async()=>{
 const {transport}=fixture({fetchImpl:async()=>response({error:'G1_PUBLIC_ENVELOPE_REJECTED'},{status:409})});
 assert.deepEqual(await transport.send(signed()),{status:409});
});
test('wrong key, recipient leak, tampering or expiry is refused before ANY network request',async()=>{
 const {transport,calls}=fixture();
 await deny(transport.send(signed({},foreign.privateKey)));
 const personal=publicData();personal.meals.items[0].recipientEmail='private@example.com';
 await deny(transport.send(signed({data:personal})));
 const altered=signed();altered.data.meals.items[0].name='FORGED';
 await deny(transport.send(altered));
 await deny(transport.send(signed({expiresAt:NOW})));
 await deny(transport.send(signed({audience:'https://wrong.onrender.com'})));
 assert.equal(calls.length,0);
});
test('HTTP status, wrong response URL, redirect and non-JSON are refused',async()=>{
 for(const mock of [
  response({error:'down'},{status:503}),
  response({accepted:true},{status:201,url:'https://evil.onrender.com/path'}),
  response({accepted:true},{status:201,redirected:true}),
  response('private',{status:201,contentType:'text/plain'})
 ]){
  const {transport}=fixture({fetchImpl:async()=>mock});
  await deny(transport.send(signed()));
 }
});
test('GET rejects unsigned 503, unanchored response, unknown fields and private data even over HTTPS',async()=>{
 for(const body of [
  {error:'G1_PUBLIC_SOURCE_NOT_READY'},
  {...validGet(),independentlyAnchored:false},
  {...validGet(),session:'secret'},
  {...validGet(),data:{...publicData(),voucher:'private'}}
 ]){
  const {transport}=fixture({fetchImpl:async()=>response(body,{
   status:body.error?503:200
  })});
  await deny(transport.readBack());
 }
});
test('response size limit and duplicate JSON fields block untrusted HTTPS responses',async()=>{
 const enormous=JSON.stringify({error:'a'.repeat(66000)});
 for(const body of [
  enormous,
  '{"status":"G1_PUBLIC_SNAPSHOT_VERIFIED","status":"FORGED"}'
 ]){
  const {transport}=fixture({fetchImpl:async()=>response(body,{status:200})});
  await deny(transport.readBack());
 }
});
test('constructor requires pinned Ed25519 key fingerprint and exact allowed HTTPS audience',()=>{
 const args={
  expectedAudience:AUDIENCE,expectedKeyId:KEY_ID,
  publicKey,expectedPublicKeyFingerprint:FINGERPRINT
 };
 assert.throws(()=>makePinnedG1PublicTransport({
  ...args,expectedAudience:'http://127.0.0.1:3000'
 }),{code:'G1_PUBLIC_TRANSPORT_REJECTED'});
 assert.throws(()=>makePinnedG1PublicTransport({
  ...args,expectedPublicKeyFingerprint:'f'.repeat(64)
 }),{code:'G1_PUBLIC_TRANSPORT_REJECTED'});
 assert.throws(()=>makePinnedG1PublicTransport({
  ...args,publicKey:privateKey
 }),{code:'G1_PUBLIC_TRANSPORT_REJECTED'});
});
