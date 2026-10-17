import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {
  canonicalPublicJson,publicEnvelopeSigningBytes,
  assertPublicG1Snapshot,verifyPublicG1Envelope
} from './public-envelope.mjs';

const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const foreign=generateKeyPairSync('ed25519');
const authority='mealforward-g1-export-key-v1',audience='https://mealforward-cp31-auth-laodao.onrender.com';
const now=1790000000,store='a'.repeat(64),meal='b'.repeat(64);
const finances=()=>({
  F:'7000000',A:'7000000',R:'0',H:'0',S:'0',X:'0',
  liability:'7000000',
  counts:{F:'1',A:'1',R:'0',H:'0',S:'0',X:'0'}
});
const data=()=>({
  mode:'G1_PUBLIC_SOURCE_PROJECTION_ONLY',
  source:'CP30_ORIGINAL_POSTGRES',
  businessTransactionsAllowed:false,asOf:now-2,
  stores:{items:[{id:store,store,name:'Community Kitchen',escrow:'0x'+'3'.repeat(40)}]},
  ledger:{items:[{store,funded:'1',financial:finances()}]},
  meals:{items:[{
    id:meal,meal,mealId:'0x'+meal,store,version:'1',
    name:'Warm meal',description:'Rice with vegetables',
    windows:[[690,810]],listed:true,published:true,eligible:'1',supported:'1',
    unitPrice:'7000000',assetDecimals:6,assetSymbol:'USDC',
    financial:finances(),collectionTimeZone:'Asia/Shanghai'
  }]}
});
const unsigned=(payload=data(),overrides={})=>({
  v:1,keyId:authority,audience,issuedAt:now,
  expiresAt:now+90,sequence:'1',data:payload,...overrides
});
const signed=(payload=data(),overrides={},key=privateKey)=>{
 const source=unsigned(payload,overrides);
 return {...source,signature:sign(null,publicEnvelopeSigningBytes(source),key).toString('base64url')};
};
const verify=(envelope,opts={})=>verifyPublicG1Envelope(envelope,{
  publicKey,expectedKeyId:authority,expectedAudience:audience,
  now,previousSequence:'0',...opts
});
const bad=(fn)=>assert.throws(fn,{code:'G1_PUBLIC_ENVELOPE_REJECTED'});

test('valid signed public snapshot is authentic, but explicitly is not chain-finality proof',()=>{
 const result=verify(signed());
 assert.equal(result.authenticatedPublicSource,true);
 assert.equal(result.chainFinalityIndependentlyVerified,false);
 assert.equal(result.data.meals.items[0].unitPrice,'7000000');
 assert.equal(result.data.ledger.items[0].financial.liability,'7000000');
 assert.match(result.receiptDigest,/^[0-9a-f]{64}$/);
});
test('canonical JSON is independent of object property insertion order',()=>{
 const p=data(),reordered={...Object.fromEntries(Object.entries(p).reverse())};
 assert.equal(canonicalPublicJson(p),canonicalPublicJson(reordered));
 assert.equal(canonicalPublicJson(p.ledger),canonicalPublicJson({...p.ledger}));
});
test('tampering any signed amount or making claimed price final without signature is rejected',()=>{
 const doc=signed();doc.data.meals.items[0].unitPrice='1';
 bad(()=>verify(doc));
 const x=signed();x.data.businessTransactionsAllowed=true;
 bad(()=>verify(x));
});
test('signed malicious extra private fields are rejected independently of valid crypto',()=>{
 const a=data();a.stores.items[0].recipientEmail='recipient@secret.example';
 bad(()=>verify(signed(a)));
 const b=data();b.meals.items[0].voucherCode='private-token';
 bad(()=>verify(signed(b)));
 const c=data();c.ledger.items[0].financial.walletAddress='0x'+'4'.repeat(40);
 bad(()=>verify(signed(c)));
 const d=data();d.session={cookie:'private-session'};
 bad(()=>verify(signed(d)));
});
test('foreign signer and non-Ed25519 keys cannot authenticate source',()=>{
 bad(()=>verify(signed(data(),{},foreign.privateKey)));
 const rsa=generateKeyPairSync('rsa',{modulusLength:2048});
 bad(()=>verify(signed(),{publicKey:rsa.publicKey}));
 bad(()=>verify(signed(),{publicKey:'garbage'}));
});
test('sequence downgrade/replay and foreign audience or key id are rejected',()=>{
 bad(()=>verify(signed(),{previousSequence:'1'}));
 bad(()=>verify(signed(),{previousSequence:'2'}));
 bad(()=>verify(signed(),{expectedAudience:'https://elsewhere.onrender.com'}));
 bad(()=>verify(signed(),{expectedKeyId:'another-trust-root'}));
 bad(()=>verify(signed(data(),{sequence:'00'})));
});
test('expired, long-lived, future, and stale-source signed data are rejected',()=>{
 bad(()=>verify(signed(data(),{expiresAt:now})));
 bad(()=>verify(signed(data(),{expiresAt:now+121})));
 bad(()=>verify(signed(data(),{issuedAt:now+12,expiresAt:now+90})));
 const stale=data();stale.asOf=now-130;bad(()=>verify(signed(stale)));
 const future=data();future.asOf=now+12;bad(()=>verify(signed(future)));
});
test('malformed signature and unexpected metadata fail closed',()=>{
 const a=signed();a.signature='abcdef';bad(()=>verify(a));
 const b=signed();b.signature=b.signature.slice(0,-1)+'?';bad(()=>verify(b));
 const c=signed();c.unauthorizedToken='secret';bad(()=>verify(c));
});
test('accounting mismatches fail even when a trusted authority signs them',()=>{
 const a=data();a.ledger.items[0].financial.counts.A='2';bad(()=>verify(signed(a)));
 const b=data();b.ledger.items[0].financial.F='7000001';bad(()=>verify(signed(b)));
 const c=data();c.meals.items[0].eligible='2';bad(()=>verify(signed(c)));
 const d=data();d.ledger.items[0].funded='2';bad(()=>verify(signed(d)));
});
test('duplicate public records, wrong source store and unsupported meal terms fail',()=>{
 const a=data();a.meals.items.push(structuredClone(a.meals.items[0]));bad(()=>verify(signed(a)));
 const b=data();b.meals.items[0].store='c'.repeat(64);bad(()=>verify(signed(b)));
 const c=data();c.meals.items[0].windows=[[811,800]];bad(()=>verify(signed(c)));
 const d=data();d.meals.items[0].assetDecimals=18;bad(()=>verify(signed(d)));
 const e=data();e.meals.items[0].published=false;bad(()=>verify(signed(e)));
});
test('null, floating point, undefined, malformed body shape cannot be signed as accepted public DTO',()=>{
 const a=data();a.asOf=now+0.5;bad(()=>verify(signed(a)));
 const b=data();b.meals.items[0].name=undefined;bad(()=>signed(b));
 const c=data();c.meals.items[0].windows=null;bad(()=>verify(signed(c)));
 const d=data();d.ledger.items[0].financial=undefined;bad(()=>signed(d));
});
test('the receiver returns a stable payload without executing wallet requests or HTTP calls',()=>{
 const p=data();assert.equal(assertPublicG1Snapshot(p),p);
 const before=structuredClone(p);
 const verified=verify(signed(p));
 assert.deepEqual(verified.data,before);
});
