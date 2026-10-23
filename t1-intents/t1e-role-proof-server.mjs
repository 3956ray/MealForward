/**
 * T1-E first real human acceptance gate. Separate Render hostname.
 * Public ROLE-POSSESSION proof only. Does not create a session, claim, voucher,
 * nonce reservation, onchain transaction, financial quote, or settlement.
 * Challenges expire, are process-local and are atomically consumed once.
 *
 * Never connect original T1-D Supabase credentials, Mac CP30 or signer keys.
 */
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {getAddress,verifyMessage} from 'ethers';

export const T1E_ORIGIN='https://mealforward-t1e-role-proof-laodao.onrender.com';
export const AUTHORITY=Object.freeze({
 issuer:'0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3',
 owner:'0xc4f8a468f10d5f98dcff3282516125e97f26433b',
 catalog:'0x41dcbfed391b79fac7b2951dd136c6b7e1384259',
 operator:'0x3dc9d4509062cba2cfcb8edd3a8d656839a50165',
 quote:'0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952'
});
const USED_ADDRS=new Set(Object.values(AUTHORITY));
const HEX_ADDR=/^0x[0-9a-fA-F]{40}$/;
const HEX_SIG=/^0x[0-9a-fA-F]{130}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHECK=(p,c)=>{if(!p)throw Error(c)};
const HEADERS=Object.freeze({
 'Cache-Control':'no-store, max-age=0',
 'X-Content-Type-Options':'nosniff',
 'X-Frame-Options':'DENY',
 'Referrer-Policy':'no-referrer',
 'Content-Security-Policy':"default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; connect-src 'self'; script-src 'self'; style-src 'self'",
 'Permissions-Policy':'camera=(),microphone=(),geolocation=()'
});
const json=(res,status,body,head=false)=>{
 const payload=Buffer.from(JSON.stringify(body));
 res.writeHead(status,{...HEADERS,'Content-Type':'application/json; charset=utf-8',
  'Content-Length':payload.length});
 res.end(head?undefined:payload);
};
const error=(status,code)=>Object.assign(Error(code),{status,code});
const exact=(body,keys)=>body&&typeof body==='object'&&!Array.isArray(body)&&
 Object.keys(body).sort().join(',')===keys.slice().sort().join(',');
const originName=u=>new URL(u).host;
export function proofWallet(role,address){
 if(!['issuer','recipient'].includes(role)||!HEX_ADDR.test(address||''))throw error(422,'ROLE_OR_ADDRESS_INVALID');
 let normalized;
 try{normalized=getAddress(address).toLowerCase()}catch{throw error(422,'ROLE_OR_ADDRESS_INVALID')}
 if(role==='issuer'&&normalized!==AUTHORITY.issuer)throw error(403,'ONLY_PINNED_ISSUER_ALLOWED');
 if(role==='recipient'&&(USED_ADDRS.has(normalized)||normalized==='0x'+'0'.repeat(40)))
  throw error(403,'RECIPIENT_MUST_BE_INDEPENDENT');
 return normalized;
}
export function challengeText({origin,role,wallet,id,nonce,issuedAt,expiresAt}){
 return [
  'MealForward T1-E · WALLET CONTROL PROOF',
  'NOT A LOGIN. NOT A FUNDING QUOTE. NOT AN ISSUE OR PAYMENT AUTHORIZATION.',
  'Origin: '+origin,'Monad Testnet chain ID: 10143',
  'Original StoreEscrow: 0xcF0C8827C8610EEFF1ecbd9719E559d805FafE58',
  'Role: '+role.toUpperCase(),
  'Wallet: '+wallet,
  'Challenge ID: '+id,
  'Nonce: '+nonce,
  'Issued: '+new Date(issuedAt*1000).toISOString(),
  'Expires: '+new Date(expiresAt*1000).toISOString(),
  'Signing proves control of this test wallet only.',
  'It does not issue a voucher, approve tokens, claim eligibility or settle funds.'
 ].join('\n');
}
export function validateT1EProofConfig(env=process.env){
 const ci=env.GITHUB_ACTIONS==='true'&&env.T1E_ROLE_PROOF_CI==='ack-loopback-only';
 const origin=env.PUBLIC_ORIGIN,port=Number(env.PORT);
 CHECK(origin===T1E_ORIGIN||
  ci&&/^http:\/\/127\.0\.0\.1:[0-9]{2,5}$/.test(origin||''),
  'T1E_EXACT_ORIGIN_REQUIRED');
 CHECK(Number.isInteger(port)&&port>=1&&port<=65535&&
  (!ci||origin.endsWith(':'+port)), 'T1E_PORT_INVALID');
 CHECK(env.T1E_DEPLOYMENT_STAGE==='ROLE_PROOF_ONLY'&&
  env.T1E_CLAIM_WRITES_ENABLED==='false'&&
  env.T1E_WALLET_TX_ENABLED==='false'&&
  env.T1E_SETTLEMENT_ENABLED==='false',
  'T1E_ROLE_PROOF_MUST_NOT_MUTATE');
 for(const key of [
  'T1E_AUTH_DB_URL','T1E_CLAIM_DB_URL',
  'T1E_SUPABASE_ADMIN_DSN','T1C_AUTH_DB_URL',
  'T1C_INTENT_DB_URL','T1C_SUPABASE_ADMIN_DSN'
 ])CHECK(!env[key],'T1E_ROLE_PROOF_DATABASE_SECRETS_FORBIDDEN');
 return Object.freeze({origin,port,ci});
}
async function readJson(req){
 if((req.headers['content-type']||'').split(';')[0].trim()!=='application/json')throw error(415,'JSON_REQUIRED');
 let size=0,parts=[];
 for await(const chunk of req){
  size+=chunk.length;
  if(size>1500)throw error(413,'REQUEST_TOO_LARGE');
  parts.push(chunk);
 }
 try{
  const value=JSON.parse(Buffer.concat(parts).toString('utf8'));
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error();
  return value;
 }catch{throw error(400,'INVALID_JSON')}
}
export async function startT1ERoleProof({env=process.env,clock=()=>Math.floor(Date.now()/1000)}={}){
 const cfg=validateT1EProofConfig(env);
 CHECK(typeof clock==='function','T1E_CLOCK_REQUIRED');
 const pageFiles=[
  ['/', 't1e-role-proof.html','text/html; charset=utf-8'],
  ['/t1e-role-proof.css','t1e-role-proof.css','text/css; charset=utf-8'],
  ['/t1e-role-proof.mjs','t1e-role-proof.mjs','text/javascript; charset=utf-8'],
  ['/t1e-wallet-roles.mjs','t1e-wallet-roles.mjs','text/javascript; charset=utf-8']
 ];
 const files=new Map(await Promise.all(pageFiles.map(async([url,file,type])=>
  [url,{bytes:await readFile(new URL('./public/'+file,import.meta.url)),type}])));
 const current=new Map(),maxPending=48;
 let issuedInMinute=0,windowStart=clock();
 const domain=originName(cfg.origin);
 const serve=(req,res)=>{const now=clock();
  if(now-windowStart>=60){windowStart=now;issuedInMinute=0}
  for(const [id,challenge] of current)if(challenge.expiresAt<=now)current.delete(id);
  const url=new URL(req.url||'/',cfg.origin);
  const path=url.pathname,method=req.method;
  if(req.headers.host!==domain||url.hash||url.username||url.password||
   req.headers.authorization||req.headers['x-wallet-address']||
   (method==='POST'&&(
     req.headers.origin!==cfg.origin||
     req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin'
   ))){json(res,403,{error:'ORIGIN_OR_WALLET_OVERRIDE_DENIED'});return;}
  const f=files.get(path);
  if(f&&(method==='GET'||method==='HEAD')){
   // Tracking params are discarded and never reflected into static HTML.
   if((path!=='/'&&url.search)||url.search.length>400){
    json(res,403,{error:'STATIC_QUERY_DENIED'});return;
   }
   res.writeHead(200,{...HEADERS,'Content-Type':f.type,'Content-Length':f.bytes.length});
   res.end(method==='HEAD'?undefined:f.bytes);return;
  }
  if(url.search){json(res,403,{error:'QUERY_DENIED'});return}
  if(path==='/health'&&(method==='GET'||method==='HEAD')){
   json(res,200,{status:'T1E_ROLE_PROOF_ONLY_ALIVE',noDatabase:true,noFunds:true},method==='HEAD');return;
  }
  if(path==='/v1/t1e/status'&&method==='GET'){
   json(res,200,{status:'T1E_ISSUER_RECIPIENT_WALLET_PROOF_READY',
    chainId:10143,issuer:AUTHORITY.issuer,
    originalUnit:0,originalGeneration:1,
    realFundingAlreadyCompleted:true,
    walletProofOnly:true,authSessionCreated:false,
    beneficiaryEligibilityVerified:false,recipientConsentStored:false,
    claimWriteEnabled:false,onchainIssueEnabled:false,
    fundEnabled:false,settleEnabled:false,
    existingFundedUSDCUnchanged:true});return;
  }
  if(path==='/v1/t1e/role/challenge'&&method==='POST'){
   if(current.size>=maxPending||issuedInMinute>=60){
    json(res,429,{error:'T1E_PROOF_RATE_LIMIT'});return;
   }
   return readJson(req).then(body=>{
    if(!exact(body,['role','address']))throw error(422,'EXACT_ROLE_REQUEST_REQUIRED');
    const wallet=proofWallet(body.role,body.address);
    const id=randomUUID(),nonce=randomBytes(32).toString('hex');
    const expiresAt=now+180;
    const message=challengeText({origin:cfg.origin,role:body.role,wallet,id,nonce,issuedAt:now,expiresAt});
    current.set(id,{role:body.role,wallet,expiresAt,message});
    issuedInMinute++;
    json(res,200,{status:'CHALLENGE_ISSUED',role:body.role,
     address:wallet,challengeId:id,message,expiresAt,
     noWalletTransaction:true,authenticationSession:false});
   }).catch(err=>json(res,err.status||503,{error:err.code||'T1E_PROOF_UNAVAILABLE'}));
  }
  if(path==='/v1/t1e/role/verify'&&method==='POST'){
   return readJson(req).then(body=>{
    if(!exact(body,['challengeId','signature'])||
      !UUID.test(body.challengeId||'')||!HEX_SIG.test(body.signature||''))
      throw error(422,'EXACT_SIGNATURE_REQUIRED');
    const existing=current.get(body.challengeId);
    if(!existing||existing.expiresAt<=now)throw error(409,'CHALLENGE_MISSING_OR_EXPIRED');
    // Consume before any asynchronous or error-prone verification.
    current.delete(body.challengeId);
    let signer;
    try{signer=verifyMessage(existing.message,body.signature).toLowerCase()}
    catch{throw error(401,'T1E_SIGNATURE_REJECTED')}
    if(signer!==existing.wallet)throw error(401,'T1E_SIGNATURE_REJECTED');
    json(res,200,{status:existing.role==='issuer'?
      'ISSUER_WALLET_CONTROL_PROVED':'RECIPIENT_WALLET_CONTROL_PROVED',
      role:existing.role,address:existing.wallet,
      chainId:10143,originalUnit:0,
      noSessionCreated:true,noClaimCreated:true,
      noOnchainIssue:true,noFundsTransaction:true,
      noMerchantSettlement:true});
   }).catch(err=>json(res,err.status||503,{error:err.code||'T1E_PROOF_UNAVAILABLE'}));
  }
  json(res,method==='POST'?405:404,{
    error:'T1E_ROLE_PROOF_ONLY_NO_CLAIM_OR_ISSUE'});
 };
 const server=http.createServer(serve);
 await new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen(cfg.port,cfg.ci?'127.0.0.1':'0.0.0.0',resolve);
 });
 return Object.freeze({server,origin:cfg.origin,async close(){
  await new Promise(resolve=>server.close(resolve));current.clear();
 }});
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 try{
  const runtime=await startT1ERoleProof();
  process.stdout.write(JSON.stringify({status:'T1E_ROLE_PROOF_ONLY_READY',
   noFinancialWrites:true,noDatabaseConnected:true,origin:runtime.origin})+'\n');
  let closing=false;
  const close=async()=>{if(closing)return;closing=true;await runtime.close();process.exit(0)};
  process.on('SIGTERM',close);process.on('SIGINT',close);
 }catch(e){
  const reason=typeof e?.message==='string'&&/^T1E_[A-Z_]+$/.test(e.message)?
   e.message:'T1E_FAIL_CLOSED';
  process.stderr.write(reason+'\n');process.exitCode=1;
 }
}
