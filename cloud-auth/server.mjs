/** CP31 test-only Render Web Service: real SIWE with isolated PostgreSQL sessions. */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {makePilotHandler} from './core.mjs';
import {makeG1RenderReadGateway} from './g1-readonly-gateway.mjs';
import {makeG1IsolatedProbeReader} from './g1a-isolated-probe-read.mjs';
import {makeChallenge,verifyChallenge} from './siwe.mjs';
import {pgStore,initializeSchema,probeAuthStorage} from './db.mjs';

const origin=process.env.PUBLIC_ORIGIN;
if(!/^https:\/\/[a-z0-9-]+\.onrender\.com$/.test(origin||''))throw Error('PUBLIC_ORIGIN_MUST_BE_EXACT_RENDER_URL');
const port=Number(process.env.PORT||10000);
if(!Number.isSafeInteger(port)||port<=0||port>=65536)throw Error('INVALID_PORT');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../sites-frontend/dist');
const assets=Object.freeze({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon'});
const databaseUrl=process.env.DATABASE_URL;
let ready=false,store=null;
if(databaseUrl){
  const pool=new pg.Pool({connectionString:databaseUrl,max:3,connectionTimeoutMillis:5000,idleTimeoutMillis:20000});
  try{
    if(process.env.CP31_EMPTY_TEST_DB_INIT!=='yes')throw Error('EXPLICIT_EMPTY_TEST_DB_INIT_REQUIRED');
    await initializeSchema(pool);
    await probeAuthStorage(pool,makeChallenge,origin);
    store=pgStore(pool);ready=await store.health();
  }catch(e){console.error('CP31_AUTH_PILOT_DATABASE_NOT_READY',JSON.stringify({kind:e?.message==='AUTH_SQL_PROBE_FAILED'?'SQL_PROBE':'INIT',stage:e?.stage||'init',sqlstate:e?.sqlstate||(/^[0-9A-Z]{5}$/.test(e?.code||'')?e.code:'NONE')}));await pool.end().catch(()=>{});}
}
if(!store){store={health:async()=>false};}
const auth=makePilotHandler({store,origin,siwe:{makeChallenge,verifyChallenge}});
// An isolated, test-only namespace can be activated only with an independent
// read-login credential. It NEVER upgrades a SIWE session into the original
// CP30 wallet principal, and it never enables real /v1/my/* business routes.
let probeHandler=null;
const probeMode=process.env.MF_G1A_PROBE_MODE;
if(probeMode!==undefined&&probeMode!==''){
  const readerUrl=process.env.MF_G1A_READONLY_DATABASE_URL;
  if(probeMode!=='isolated-synthetic-read-only'||!ready||
     typeof readerUrl!=='string'||!readerUrl||readerUrl===databaseUrl)
    throw Error('G1A_TEST_PROBE_CONFIGURATION_REJECTED');
  const probePool=new pg.Pool({
    connectionString:readerUrl,max:2,connectionTimeoutMillis:4000,
    idleTimeoutMillis:10000
  });
  probeHandler=makeG1IsolatedProbeReader({
    authStore:store,readPool:probePool,origin,enabled:true
  });
}
// No independently signed + anchored ORIGINAL source is connected:
// publicCache remains null. Existing authenticated wallet sessions are
// not original CP30 business principals.
const gateway=makeG1RenderReadGateway({
 authHandler:auth,publicCache:null,probeHandler,origin
});
const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,origin),p=u.pathname;
    if(p==='/health'||p.startsWith('/v1/')||p.startsWith('/__g1_probe/')){
      if(!ready && p!=='/health'){
        res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'AUTH_PILOT_DATABASE_NOT_READY'}));return;
      }
      await gateway(req,res);return;
    }
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return}
    const file=p==='/'?'/index.html':p;
    if(!/^\/[a-zA-Z0-9/_\-.]+$/.test(file)||file.includes('..')){res.writeHead(404);res.end();return}
    const absolute=path.resolve(root,'.'+file);
    if(!absolute.startsWith(root+path.sep)){res.writeHead(404);res.end();return}
    const data=await fs.readFile(absolute).catch(()=>null);
    if(!data){res.writeHead(404);res.end();return}
    const ext=path.extname(absolute);
    res.writeHead(200,{'Content-Type':assets[ext]||'application/octet-stream','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':ext==='.html'?'no-store':'public,max-age=120'});
    res.end(req.method==='HEAD'?undefined:data);
  }catch(e){console.error('CP31_AUTH_PILOT_HTTP_ERROR',e?.code||'ERROR');if(!res.headersSent){res.writeHead(503,{'Content-Type':'application/json'});res.end('{"error":"SERVICE_UNAVAILABLE"}')}else res.end()}
});
server.requestTimeout=12000;server.headersTimeout=13000;server.keepAliveTimeout=5000;
server.listen(port,'0.0.0.0',()=>console.log('CP31_AUTH_PILOT_BOUND',{port,dbReady:ready,mode:'auth_only',transactions:false}));
