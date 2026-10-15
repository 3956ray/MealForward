/** CP31 test-only Render Web Service: real SIWE with isolated PostgreSQL sessions. */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {makePilotHandler} from './core.mjs';
import {makeChallenge,verifyChallenge} from './siwe.mjs';
import {pgStore,initializeSchema} from './db.mjs';

const origin=process.env.PUBLIC_ORIGIN;
if(!/^https:\/\/[a-z0-9-]+\.onrender\.com$/.test(origin||''))throw Error('PUBLIC_ORIGIN_MUST_BE_EXACT_RENDER_URL');
const port=Number(process.env.PORT||10000);
if(!Number.isSafeInteger(port)||port<=0||port>=65536)throw Error('INVALID_PORT');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../dist');
const assets=Object.freeze({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon'});
const databaseUrl=process.env.DATABASE_URL;
let ready=false,store=null;
if(databaseUrl){
  const pool=new pg.Pool({connectionString:databaseUrl,max:3,connectionTimeoutMillis:5000,idleTimeoutMillis:20000});
  try{
    if(process.env.CP31_EMPTY_TEST_DB_INIT!=='yes')throw Error('EXPLICIT_EMPTY_TEST_DB_INIT_REQUIRED');
    await initializeSchema(pool);
    store=pgStore(pool);ready=await store.health();
  }catch(e){console.error('CP31_AUTH_PILOT_DATABASE_NOT_READY',e.message);await pool.end().catch(()=>{});}
}
if(!store){store={health:async()=>false};}
const auth=makePilotHandler({store,origin,siwe:{makeChallenge,verifyChallenge}});
const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,origin),p=u.pathname;
    if(p==='/health'||p.startsWith('/v1/')){
      if(!ready && p!=='/health'){
        res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'AUTH_PILOT_DATABASE_NOT_READY'}));return;
      }
      await auth(req,res);return;
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
