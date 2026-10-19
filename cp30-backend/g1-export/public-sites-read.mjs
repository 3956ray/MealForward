/**
 * CP31 G1 -> Sites public read-only HTTP adapter.
 *
 * SOURCE ONLY. Mount only behind independently anchored
 * makeG1PublicSnapshotCache().current(), never behind the original
 * CP30 mixed read/write dispatcher.
 * No wallet-private routes, mutations, signer or funding capability.
 */
import {URL} from 'node:url';
import {assertPublicG1Snapshot} from './public-envelope.mjs';

const HOST=/^https:\/\/[a-z0-9-]+\.onrender\.com$/;
const STORE=/^[0-9a-f]{64}$/;
const DIGEST=/^[0-9a-f]{64}$/;
const SEQUENCE=/^[1-9][0-9]*$/;
const FRESHNESS_SECONDS=120;
const headers=Object.freeze({
 'Content-Type':'application/json; charset=utf-8',
 'Cache-Control':'no-store, max-age=0',
 'X-Content-Type-Options':'nosniff',
 'X-Frame-Options':'DENY',
 'Referrer-Policy':'no-referrer',
 'Content-Security-Policy':"default-src 'none'",
 'X-MealForward-Chain-Finality':'UNVERIFIED'
});
const reject=(res,status,code)=>{
 res.writeHead(status,headers);
 res.end(JSON.stringify({error:code}));
};
const deny=(code)=>{throw Error(code)};

export function sourceToPublicSitesDtos(snapshot,now=Math.floor(Date.now()/1000)){
 if(snapshot?.status!=='G1_PUBLIC_SNAPSHOT_VERIFIED'||
  snapshot.authenticatedPublicSource!==true||
  snapshot.independentlyAnchored!==true||
  snapshot.chainFinalityIndependentlyVerified!==false||
  typeof snapshot.receiptDigest!=='string'||!DIGEST.test(snapshot.receiptDigest)||
  typeof snapshot.sequence!=='string'||!SEQUENCE.test(snapshot.sequence)||
  !Number.isSafeInteger(now)||!Number.isSafeInteger(snapshot.asOf)||
  !Number.isSafeInteger(snapshot.expiresAt)||
  snapshot.expiresAt<=now||snapshot.expiresAt-now>FRESHNESS_SECONDS||
  snapshot.asOf>now+5||now-snapshot.asOf>FRESHNESS_SECONDS)
  deny('G1_PUBLIC_SOURCE_NOT_READY');
 const data=assertPublicG1Snapshot(snapshot.data);
 if(data.asOf!==snapshot.asOf)deny('G1_PUBLIC_SOURCE_NOT_READY');
 return Object.freeze({
  stores:data.stores.items,
  meals:data.meals.items,
  ledger:data.ledger.items,
  sourceAsOf:data.asOf,
  sourceSequence:snapshot.sequence
 });
}

export function makeG1PublicSitesReadHandler({cache,origin,clock=()=>Math.floor(Date.now()/1000)}={}){
 if(typeof cache?.current!=='function'||typeof clock!=='function'||
  typeof origin!=='string'||!HOST.test(origin))
  deny('G1_PUBLIC_SITES_CONFIG_NOT_PINNED');
 const host=new URL(origin).host;
 const respond=(res,status,body)=>{
  res.writeHead(status,headers);
  res.end(JSON.stringify(body));
 };
 return async function handler(req,res){
  try{
   const url=new URL(req.url||'/',origin);
   if(req.headers.host!==host||url.origin!==origin||
     url.search!==''||url.hash!==''||url.username||url.password||
     req.headers.authorization||
     req.headers.origin&&req.headers.origin!==origin||
     req.headers['sec-fetch-site']&&
       !['same-origin','none'].includes(req.headers['sec-fetch-site'])){
    reject(res,403,'G1_PUBLIC_ACCESS_DENIED');return;
   }
   const path=url.pathname;
   // Public endpoint ignores any wallet Cookie, does not forward or log it.
   const match=/^\/v1\/stores\/([^/]+)\/meals$/.exec(path);
   const publicPath=path==='/v1/stores'||path==='/v1/ledger'||!!match;
   if(!publicPath){
    if(path.startsWith('/v1/')){
     reject(res,503,'ORIGINAL_BUSINESS_NOT_CONNECTED');return;
    }
    reject(res,404,'NOT_FOUND');return;
   }
   if(req.method!=='GET'){reject(res,405,'METHOD_NOT_ALLOWED');return;}
   if(match&&!STORE.test(match[1])){
    reject(res,400,'INVALID_STORE');return;
   }
   let snapshot;
   try{
    snapshot=sourceToPublicSitesDtos(await cache.current(),clock());
   }catch{
    reject(res,503,'G1_PUBLIC_SOURCE_NOT_READY');return;
   }
   if(path==='/v1/stores'){respond(res,200,{items:snapshot.stores});return;}
   if(path==='/v1/ledger'){respond(res,200,{items:snapshot.ledger});return;}
   const store=match[1];
   if(!snapshot.stores.some(s=>s.id===store)){
    reject(res,404,'STORE_NOT_FOUND');return;
   }
   respond(res,200,{items:snapshot.meals.filter(meal=>
    meal.store===store&&meal.listed===true&&meal.published===true
   )});
  }catch{
   if(!res.headersSent)reject(res,503,'G1_PUBLIC_SOURCE_NOT_READY');
   else res.end();
  }
 };
}
