/**
 * Standalone T1-D Render Free deployment entry point.
 * SETUP_ONLY verifies cloud build and origin WITHOUT a database, sessions,
 * signer, wallet operations or funds. FUNDING loads the audited T1-D server
 * only after separate owner-supplied credentials and explicit mode change.
 *
 * Old T1-C Render service uses read-only-server.mjs and is NEVER touched.
 */
import http from 'node:http';

const ORIGIN='https://mealforward-t1d-funding-laodao.onrender.com';
const SETUP='SETUP_ONLY_NO_FUNDS';
const USER_WALLET='TESTNET_SINGLE_SEVEN_USDC_FUND';
const fail=(pass,reason)=>{if(!pass)throw Error(reason)};
export function validateT1DDeployment(env=process.env){
 fail(env.PUBLIC_ORIGIN===ORIGIN||
  (env.GITHUB_ACTIONS==='true'&&env.MF_T1D_SETUP_CI==='ack-disposable-loopback'&&
   /^http:\/\/127\.0\.0\.1:[0-9]{2,5}$/.test(env.PUBLIC_ORIGIN||'')),
  'T1D_ORIGIN_NOT_PINNED');
 const port=Number(env.PORT);
 fail(Number.isSafeInteger(port)&&port>=1&&port<=65535,
  'T1D_INVALID_PORT');
 fail(env.T1D_DEPLOYMENT_STAGE==='SETUP_ONLY'||env.T1D_DEPLOYMENT_STAGE==='FUNDING',
  'T1D_UNKNOWN_STAGE');
 fail(env.T1C_QUOTE_SIGNER_ENABLED!=='true','T1D_NO_PLATFORM_QUOTE_SIGNER');
 if(env.T1D_DEPLOYMENT_STAGE==='SETUP_ONLY'){
  fail(env.T1C_SERVER_MODE===SETUP&&env.T1C_FUNDING_ENABLED==='false'&&
   env.T1C_TESTNET_FUND_SCOPE==='DISABLED',
   'T1D_SETUP_MUST_DISABLE_FUNDS');
  for(const name of ['T1C_AUTH_DB_URL','T1C_INTENT_DB_URL','T1C_SUPABASE_ADMIN_DSN']){
   fail(!env[name],'T1D_SETUP_SECRETS_FORBIDDEN');
  }
 }else{
  fail(env.T1C_SERVER_MODE===USER_WALLET&&
   env.T1C_FUNDING_ENABLED==='true'&&
   env.T1C_TESTNET_FUND_SCOPE==='ONE_QUOTE_AUTHORITY_WALLET_SEVEN_USDC',
   'T1D_FUNDING_SCOPE_NOT_EXPLICIT');
 }
 return Object.freeze({origin:env.PUBLIC_ORIGIN,port,stage:env.T1D_DEPLOYMENT_STAGE});
}
const headers=Object.freeze({
 'Cache-Control':'no-store',
 'Content-Security-Policy':"default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
 'X-Content-Type-Options':'nosniff',
 'X-Frame-Options':'DENY',
 'Referrer-Policy':'no-referrer'
});
export async function startT1DEntrypoint({env=process.env}={}){
 const cfg=validateT1DDeployment(env);
 if(cfg.stage==='FUNDING'){
  // Do not bind any listener until real PG roles, TLS, original T0 chain
  // and append-only quote stores pass all their existing startup gates.
  const {startT1ReadOnlyServer}=await import('./read-only-server.mjs');
  const real=await startT1ReadOnlyServer({env});
  return {...real,setupOnly:false};
 }
 const host=new URL(cfg.origin).host;
 const html='<!doctype html><html lang="zh"><meta charset="utf-8">'+
  '<meta name="viewport" content="width=device-width,initial-scale=1">'+
  '<title>MealForward T1-D · 待激活</title>'+
  '<main><h1>留膳 · T1-D</h1><p>独立测试服务部署就绪，但尚未开放钱包登录、签名或资助。</p>'+
  '<p>7 Test USDC 仅在安全验收及钱包本人确认后才能进行。</p></main></html>';
 const server=http.createServer((req,res)=>{
  const u=new URL(req.url||'/',cfg.origin);
  if(req.headers.host!==host||u.host!==host||u.search||u.hash||
   (req.headers.origin&&req.headers.origin!==cfg.origin)){
   res.writeHead(403,headers);res.end();return;
  }
  const path=u.pathname;
  if(path==='/health'&&['GET','HEAD'].includes(req.method)){
   res.writeHead(200,{...headers,'Content-Type':'application/json'});
   res.end(req.method==='HEAD'?'':JSON.stringify({status:'T1D_SETUP_PROCESS_ALIVE',fundingEnabled:false}));
   return;
  }
  if(path==='/'&&['GET','HEAD'].includes(req.method)){
   res.writeHead(200,{...headers,'Content-Type':'text/html; charset=utf-8'});
   res.end(req.method==='HEAD'?'':html);return;
  }
  if(path==='/v1/t1/status'&&req.method==='GET'){
   res.writeHead(503,{...headers,'Content-Type':'application/json'});
   res.end(JSON.stringify({
    status:'T1D_OWNER_SETUP_REQUIRED',network:10143,
    fundingEnabled:false,quoteSigningEnabled:false,
    authEnabled:false,transactionActionsEnabled:false,
    originalCp30DataConnected:false,testnetOnly:true
   }));
   return;
  }
  res.writeHead(503,{...headers,'Content-Type':'application/json'});
  res.end(JSON.stringify({error:'T1D_SETUP_NO_FUNDS',fundingEnabled:false}));
 });
 await new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen(cfg.port,
   cfg.origin.startsWith('http://127.0.0.1:')?'127.0.0.1':'0.0.0.0',resolve);
 });
 return {
  server,origin:cfg.origin,setupOnly:true,fundingEnabled:false,
  close:()=>new Promise(resolve=>server.close(resolve))
 };
}

if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 try{
  const running=await startT1DEntrypoint();
  process.stdout.write(JSON.stringify({
   status:running.setupOnly?'T1D_SAFE_SETUP_ONLY_READY':'T1D_FUNDING_WALLET_SERVICE_READY',
   fundingEnabled:running.fundingEnabled,origin:running.origin
  })+'\n');
  let stopping=false;
  async function shutdown(){
   if(stopping)return;
   stopping=true;
   await running.close().catch(()=>{});
   process.exit(0);
  }
  process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
 }catch{
  process.stderr.write('T1D_DEPLOYMENT_FAIL_CLOSED\n');
  process.exitCode=1;
 }
}
