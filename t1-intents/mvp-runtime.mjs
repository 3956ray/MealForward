/** Independent MVP integration: startup failure cannot disable legacy routes. */
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {verifiedSupabasePoolerTls} from './supabase-tls.mjs';

const ORIGIN='https://mealforward-t1e-claim-laodao.onrender.com';
const HOST='aws-0-ap-southeast-2.pooler.supabase.com';
const PROJECT='ketfrukrcuosrqynnsay';
const assets=new Map([
 ['/mvp/setup.html','text/html; charset=utf-8'],
 ['/mvp/merchant.html','text/html; charset=utf-8'],
 ['/mvp/recipient.html','text/html; charset=utf-8'],
 ['/mvp/app.mjs','text/javascript; charset=utf-8'],
 ['/mvp/recipient.mjs','text/javascript; charset=utf-8'],
 ['/mvp/style.css','text/css; charset=utf-8'],
 ['/mvp/THIRD_PARTY_NOTICES.txt','text/plain; charset=utf-8']
]);
const headers={
 'Cache-Control':'no-store', 'Referrer-Policy':'no-referrer',
 'X-Content-Type-Options':'nosniff', 'X-Frame-Options':'DENY',
 'Content-Security-Policy':"default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:",
 'Permissions-Policy':'camera=(),microphone=(),geolocation=()'
};
const fail=()=>{throw Error('MVP_CONFIGURATION_INVALID')};
export function mvpConfig(env=process.env){
 const enabled=env.MVP_ENABLED??'false',writes=env.MVP_WALLET_ACTIONS_ENABLED??'false';
 if(!['true','false'].includes(enabled)||!['true','false'].includes(writes))fail();
 if(enabled==='false')return {enabled:false,writesEnabled:false};
 if(env.PUBLIC_ORIGIN!==ORIGIN)fail();
 let db;try{db=new URL(env.MVP_DB_URL)}catch{fail()}
 if(!['postgres:','postgresql:'].includes(db.protocol)||db.hostname!==HOST||db.port!=='5432'||db.pathname!=='/postgres'||db.search||db.hash||db.username!=='mf_mvp_usdc_runtime.'+PROJECT||db.password.length<32)fail();
 if(!/^[A-Za-z0-9_-]{43,128}$/.test(env.MVP_CODE_PEPPER??''))fail();
 return {enabled:true,writesEnabled:writes==='true',origin:ORIGIN,databaseUrl:env.MVP_DB_URL,pepper:env.MVP_CODE_PEPPER};
}
export async function startMvpRuntime({env=process.env,load=()=>import('./mvp/http.mjs'),verify=async pool=>{const {verifyRuntime}=await import('./mvp/store.mjs');await verifyRuntime(pool)},poolFactory=options=>new pg.Pool(options),read=readFile}={}){
 let pool,app,ready=false,enabled=env.MVP_ENABLED!=='false'&&env.MVP_ENABLED!==undefined;
 const files=new Map();
 try{
  const cfg=mvpConfig(env);enabled=cfg.enabled;
  if(enabled){
   pool=poolFactory({connectionString:cfg.databaseUrl,ssl:verifiedSupabasePoolerTls(),max:3,connectionTimeoutMillis:8000,query_timeout:8000,statement_timeout:7000,idleTimeoutMillis:20000});
   await verify(pool);
   const {makeMvpHttp}=await load();
   app=makeMvpHttp({pool,origin:cfg.origin,pepper:cfg.pepper,enabled:true,writesEnabled:cfg.writesEnabled});
   for(const [path,type] of assets){files.set(path,{bytes:await read(new URL('./public'+path,import.meta.url)),type})}
   ready=true;
  }
 }catch{
  await pool?.end().catch(()=>{});pool=null;app=null;
  console.warn(JSON.stringify({event:'MVP_STARTUP_UNAVAILABLE',legacyServiceUnaffected:true}));
 }
 const json=(res,status,error)=>{res.writeHead(status,{...headers,'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error}))};
 return {
  ready,enabled,
  async handle(req,res){
   let url;try{url=new URL(req.url||'/',ORIGIN)}catch{return false}
   if(!(url.pathname==='/v1/mvp'||url.pathname.startsWith('/v1/mvp/')||url.pathname==='/mvp'||url.pathname.startsWith('/mvp/')))return false;
   if(req.headers.host!==new URL(ORIGIN).host||url.search||url.hash){json(res,403,'MVP_ORIGIN_DENIED');return true}
   if(!enabled){json(res,404,'MVP_DISABLED');return true}
   if(!ready){json(res,503,'MVP_UNAVAILABLE');return true}
   if(url.pathname==='/v1/mvp'||url.pathname.startsWith('/v1/mvp/')){
    try{await app.handle(req,res)}catch{if(!res.headersSent&&!res.writableEnded)json(res,503,'MVP_UNAVAILABLE');else res.destroy()}
    return true;
   }
   const file=files.get(url.pathname);
   if(!file||!['GET','HEAD'].includes(req.method)){json(res,404,'MVP_NOT_FOUND');return true}
   res.writeHead(200,{...headers,'Content-Type':file.type,'Content-Length':file.bytes.length,...(url.pathname==='/mvp/merchant.html'?{'Permissions-Policy':'camera=(self),microphone=(),geolocation=()'}:{})});
   res.end(req.method==='HEAD'?undefined:file.bytes);return true;
  },
  async close(){await app?.close?.();await pool?.end()}
 };
}
