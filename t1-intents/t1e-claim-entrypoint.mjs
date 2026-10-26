/**
 * T1-E dedicated isolated Claim web service lifecycle.
 * SETUP_ONLY: NO DB connection, NO SIWE session, NO Claim, NO Issue/Fund/Settle.
 * CLAIM_SIWE_ONLY / CLAIM_CONSENT: dynamically load audited private dual-PG
 * backend only after exact stage/role/TLS checks. Never deploy to T1-D.
 */
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {T1E_CLAIM_ORIGIN} from './t1e-claim-server.mjs';
const fail=(x,c)=>{if(!x)throw Error(c)};
export function validateSetupOnly(env=process.env){
 const testing=env.GITHUB_ACTIONS==='true'&&
  env.T1E_SETUP_CI==='ack-disposable-loopback';
 const origin=env.PUBLIC_ORIGIN,port=Number(env.PORT);
 fail(origin===T1E_CLAIM_ORIGIN||
   testing&&/^http:\/\/127\.0\.0\.1:[0-9]{2,5}$/.test(origin||''),
  'T1E_SETUP_ONLY_EXACT_ORIGIN');
 fail(Number.isSafeInteger(port)&&port>=1&&port<=65535&&
  (!testing||origin.endsWith(':'+port)),
  'T1E_SETUP_ONLY_PORT_INVALID');
 fail(env.T1E_DEPLOYMENT_STAGE==='SETUP_ONLY'&&
  env.T1E_CLAIM_WRITES_ENABLED==='false'&&
  env.T1E_WALLET_TX_ENABLED==='false'&&
  env.T1E_SETTLEMENT_ENABLED==='false',
  'T1E_SETUP_MUST_DISABLE_ALL_WRITES');
 for(const key of [
  'T1E_AUTH_DB_URL','T1E_CLAIM_DB_URL',
  'T1E_SUPABASE_ADMIN_DSN','T1C_AUTH_DB_URL',
  'T1C_INTENT_DB_URL','T1C_SUPABASE_ADMIN_DSN'
 ])fail(!env[key],'T1E_SETUP_PRIVATE_CREDENTIALS_FORBIDDEN');
 return Object.freeze({origin,port,testing});
}
const SAFE_HEADERS=Object.freeze({
 'Cache-Control':'no-store, max-age=0',
 'Content-Security-Policy':"default-src 'none'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
 'X-Content-Type-Options':'nosniff',
 'X-Frame-Options':'DENY',
 'Referrer-Policy':'no-referrer'
});
export async function startT1ESafeSetup({env=process.env}={}){
 const cfg=validateSetupOnly(env);
 const [html,css]=await Promise.all([
  readFile(new URL('./public/t1e-claim-setup.html',import.meta.url)),
  readFile(new URL('./public/t1e-claim.css',import.meta.url))
 ]);
 const host=new URL(cfg.origin).host;
 const server=http.createServer((req,res)=>{
  const u=new URL(req.url||'/',cfg.origin),path=u.pathname;
  if(req.headers.host!==host||u.hash||req.headers.authorization||
   req.headers['x-wallet-address']){
   res.writeHead(403,SAFE_HEADERS);res.end();return;
  }
  if(path==='/'&&['GET','HEAD'].includes(req.method)&&u.search.length<=400){
   res.writeHead(200,{...SAFE_HEADERS,
    'Content-Type':'text/html; charset=utf-8','Content-Length':html.length});
   res.end(req.method==='HEAD'?undefined:html);return;
  }
  if(path==='/t1e-claim.css'&&['GET','HEAD'].includes(req.method)&&!u.search){
   res.writeHead(200,{...SAFE_HEADERS,
    'Content-Type':'text/css; charset=utf-8','Content-Length':css.length});
   res.end(req.method==='HEAD'?undefined:css);return;
  }
  if(u.search){res.writeHead(403,SAFE_HEADERS);res.end();return}
  if((path==='/health'||path==='/v1/t1e/status')&&req.method==='GET'){
   const result=path==='/health'?
    {status:'T1E_SAFE_SETUP_ONLY_ALIVE',noDatabase:true}:
    {
     status:'T1E_SAFE_SETUP_ONLY_NO_SESSIONS',
     chainId:10143,originalUnit:0,originalGeneration:1,
     independentRecipientLoginEnabled:false,
     claimWriteEnabled:false,...issuerCapabilities({},true),
     fundingEnabled:false,settleEnabled:false,
     originalCp30Connected:false
    };
   const encoded=Buffer.from(JSON.stringify(result));
   res.writeHead(200,{...SAFE_HEADERS,
    'Content-Type':'application/json; charset=utf-8',
    'Content-Length':encoded.length});res.end(encoded);return;
  }
  const encoded=Buffer.from(JSON.stringify({
   error:req.method==='POST'?'T1E_SETUP_ALL_WRITES_DISABLED':'T1E_SETUP_ONLY_NOT_EXPOSED'
  }));
  res.writeHead(req.method==='POST'?405:404,{...SAFE_HEADERS,
   'Content-Type':'application/json; charset=utf-8'});
  res.end(encoded);
 });
 await new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen(cfg.port,cfg.testing?'127.0.0.1':'0.0.0.0',resolve);
 });
 return Object.freeze({server,origin:cfg.origin,async close(){
  await new Promise(resolve=>server.close(resolve));
 }});
}
export async function startT1EClaimEntrypoint({env=process.env}={}){
 if(env.T1E_DEPLOYMENT_STAGE==='SETUP_ONLY')return startT1ESafeSetup({env});
 if(!['CLAIM_SIWE_ONLY','CLAIM_CONSENT'].includes(env.T1E_DEPLOYMENT_STAGE))
  throw Error('T1E_UNREVIEWED_DEPLOYMENT_STAGE');
 const {startT1EClaimServer}=await import('./t1e-claim-server.mjs');
 return startT1EClaimServer({env});
}
export function issuerCapabilities(config={},setup=false){
 const issuerIssueEnabled=!setup&&config.issueEnabled===true,successorEnabled=!setup&&config.successorEnabled===true;
 return {issuerTransactionEnabled:issuerIssueEnabled||successorEnabled,issuerIssueEnabled,successorEnabled};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 try{
  const runtime=await startT1EClaimEntrypoint();
  const setup=process.env.T1E_DEPLOYMENT_STAGE==='SETUP_ONLY';
  process.stdout.write(JSON.stringify({
   status:setup?'T1E_SAFE_SETUP_ONLY_READY':'T1E_PRIVATE_SIWE_STAGE_READY',
   stage:process.env.T1E_DEPLOYMENT_STAGE,
   fundingEnabled:false,
   ...issuerCapabilities(runtime.config,setup),
   merchantSettlementEnabled:false,
   databaseConnected:!setup
  })+'\n');
  let busy=false;
  const close=async()=>{if(busy)return;busy=true;await runtime.close();process.exit(0)};
  process.on('SIGTERM',close);process.on('SIGINT',close);
 }catch(e){
  const code=typeof e?.message==='string'&&
   /^T1E_[A-Z0-9_]{5,100}$/.test(e.message)?
   e.message:'T1E_SAFE_STARTUP_FAIL_CLOSED';
  process.stderr.write(code+'\n');process.exitCode=1;
 }
}
