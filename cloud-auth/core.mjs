/**
 * Authentication-only, same-origin CP31 test pilot; no smart-contract actions.
 * Client protocol mirrors the CP30 Wallet Login Extension SIWE field names.
 * This module is dependency-free so authorization failures can be tested offline.
 */
import { randomBytes, randomUUID, createHash } from 'node:crypto';

const SESSION_COOKIE = '__Host-mcpay_c1_session';
const PRE_COOKIE = '__Host-mcpay_c1_pre';
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SIG = /^0x[0-9a-fA-F]{130}$/;
const HEX = /^[0-9a-f]{64}$/;
const HASH = text => createHash('sha256').update(text, 'utf8').digest('hex');
const nowSeconds = () => Math.floor(Date.now() / 1000);
const newToken = () => randomBytes(32).toString('base64url');
const cookies = header => Object.fromEntries((header || '').split(';').map(v => v.trim().split(/=(.*)/s).slice(0,2)).filter(x=>x.length===2 && x[0]));
const cookie = (name,value,age) => `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${age}`;

export function makePilotHandler({store,siwe,origin,clock=nowSeconds,issueToken=newToken,newId=randomUUID}) {
  if (typeof origin !== 'string' || !/^https:\/\/[a-z0-9-]+\.onrender\.com$/.test(origin) && !/^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(origin)) throw Error('PINNED_PUBLIC_ORIGIN_REQUIRED');
  const expectedHost = new URL(origin).host;
  const json = (res,status,value,additional={}) => {
    res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...additional});
    res.end(JSON.stringify(value));
  };
  const issueError=(status,code)=>({status,code});
  const readJson=async(req)=>{
    if ((req.headers['content-type']||'').split(';')[0].trim()!=='application/json')throw issueError(415,'JSON_REQUIRED');
    let total=0,bufs=[];
    for await(const chunk of req){total+=chunk.length;if(total>8192)throw issueError(413,'BODY_TOO_LARGE');bufs.push(chunk)}
    try{return JSON.parse(Buffer.concat(bufs).toString('utf8'))}catch{throw issueError(400,'INVALID_JSON')}
  };
  const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
  const active = async(req) => {
    const token=cookies(req.headers.cookie)[SESSION_COOKIE];
    return typeof token==='string' && token.length===43 ? await store.getSession(HASH(token),clock()) : null;
  };
  return async function handler(req,res){
    const u=new URL(req.url || '/',origin),path=u.pathname, method=req.method,now=clock();
    try {
      // The origin and Host must remain pinned to one Render-managed origin.
      if(req.headers.host!==expectedHost || u.search || u.username || u.password)throw issueError(403,'ORIGIN_DENIED');
      if(method!=='GET' && (req.headers.origin!==origin || req.headers['sec-fetch-site'] && req.headers['sec-fetch-site']!=='same-origin'))throw issueError(403,'ORIGIN_DENIED');
      if(path==='/health' && method==='GET'){
        const available=await store.health();
        return json(res,available?200:503,{status:available?'ready':'not_ready',mode:'AUTH_PILOT_ONLY'});
      }
      if(path==='/v1/connection' && method==='GET')return json(res,200,{
        mode:'CP31_AUTH_PILOT_ONLY',registrationEnabled:false,assetDecimals:6,assetSymbol:'test USDC',
        transactionActionsEnabled:false,authPilot:true,businessSourceConnected:false,
        originalPrincipalCompatible:false,serverTime:now
      });
      if(path==='/v1/identity/setup' && method==='GET')return json(res,200,{
        walletLoginEnabled:true,walletLoginChainId:10143,walletLoginOrigin:origin,authPilot:true
      });
      if(path==='/v1/stores' && method==='GET')
        return json(res,503,{error:'ORIGINAL_BUSINESS_NOT_CONNECTED',mode:'CP31_AUTH_PILOT_ONLY'});

      if(path==='/v1/me' && method==='GET'){
        const s=await active(req);
        return s?json(res,200,{walletAddress:s.wallet,stores:[],authPilot:true}):json(res,401,{error:'UNAUTHENTICATED'});
      }
      if(path==='/v1/store-registrations' && method==='GET'){
        if(!await active(req))throw issueError(401,'UNAUTHENTICATED');
        // Even the authenticated pilot has no original CP30 registration data.
        return json(res,503,{error:'ORIGINAL_BUSINESS_NOT_CONNECTED',mode:'CP31_AUTH_PILOT_ONLY'});
      }
      if(path==='/v1/auth/pre-session' && method==='POST'){
        const body=await readJson(req);
        if(!exact(body,[]) || req.headers['x-c1-bootstrap']!=='1')throw issueError(422,'INVALID_REQUEST');
        const pre=issueToken(),csrf=issueToken();
        await store.createPre({preHash:HASH(pre),csrfHash:HASH(csrf),expiresAt:now+300,now});
        return json(res,200,{csrf}, {'Set-Cookie':cookie(PRE_COOKIE,pre,300)});
      }
      if(path==='/v1/identity/wallet/challenge' && method==='POST'){
        const body=await readJson(req);
        if(!exact(body,['address']) || typeof body.address!=='string' || !ADDRESS.test(body.address) || BigInt(body.address)===0n)throw issueError(422,'INVALID_ADDRESS');
        const pre=cookies(req.headers.cookie)[PRE_COOKIE],csrf=req.headers['x-c1-csrf'];
        if(typeof pre!=='string'||pre.length!==43||typeof csrf!=='string'||csrf.length!==43)throw issueError(403,'CSRF');
        const challenge=siwe.makeChallenge({wallet:body.address.toLowerCase(),origin,chainId:10143,nonce:randomBytes(32).toString('hex'),challengeId:newId(),issuedAt:now,expiresAt:now+180});
        if(!await store.createChallenge({preHash:HASH(pre),csrfHash:HASH(csrf),challenge,now}))throw issueError(409,'CHALLENGE_REJECTED');
        return json(res,200,challenge);
      }
      if(path==='/v1/identity/wallet/login' && method==='POST'){
        const body=await readJson(req);
        if(!exact(body,['challengeId','signature'])||typeof body.challengeId!=='string'||!UUID.test(body.challengeId)||typeof body.signature!=='string'||!SIG.test(body.signature))throw issueError(422,'INVALID_LOGIN');
        const pre=cookies(req.headers.cookie)[PRE_COOKIE],csrf=req.headers['x-c1-csrf'];
        if(typeof pre!=='string'||pre.length!==43||typeof csrf!=='string'||csrf.length!==43)throw issueError(403,'CSRF');
        const p=HASH(pre),c=HASH(csrf);
        const challenge=await store.getChallenge({preHash:p,csrfHash:c,challengeId:body.challengeId,now});
        if(!challenge)throw issueError(401,'CHALLENGE_EXPIRED_OR_CONSUMED');
        // Cryptographic verification operates OUTSIDE the DB transaction.
        let signer;try{signer=await siwe.verifyChallenge(challenge,body.signature,now)}catch{throw issueError(401,'WALLET_LOGIN_REJECTED')}
        if(signer!==challenge.address)throw issueError(401,'WALLET_LOGIN_REJECTED');
        const session=issueToken(),newCsrf=issueToken();
        const stored=await store.consumeAndCreateSession({preHash:p,csrfHash:c,challenge,sessionHash:HASH(session),sessionCsrfHash:HASH(newCsrf),wallet:signer,expiresAt:now+3600,now});
        if(!stored)throw issueError(409,'CHALLENGE_EXPIRED_OR_CONSUMED');
        return json(res,200,{csrf:newCsrf,authPilot:true}, {'Set-Cookie':cookie(SESSION_COOKIE,session,3600)});
      }
      if(path==='/v1/auth/logout' && method==='POST'){
        const body=await readJson(req);
        if(!exact(body,[]))throw issueError(422,'INVALID_REQUEST');
        const session=cookies(req.headers.cookie)[SESSION_COOKIE],csrf=req.headers['x-c1-csrf'];
        if(!session||session.length!==43||!csrf||csrf.length!==43)throw issueError(403,'CSRF');
        const ok=await store.revokeSession(HASH(session),HASH(csrf),now);
        if(!ok)throw issueError(401,'UNAUTHENTICATED');
        const preserve=req.headers['x-c1-preserve-session-cookie']==='1';
        return json(res,200,{ok:true},{...(preserve?{}:{'Set-Cookie':cookie(SESSION_COOKIE,'',0)})});
      }
      if(path.startsWith('/v1/'))return json(res,503,{
        error:method==='GET'?'ORIGINAL_BUSINESS_NOT_CONNECTED':'AUTH_PILOT_NO_BUSINESS_WRITES',
        mode:'CP31_AUTH_PILOT_ONLY'
      });
      return json(res,404,{error:'NOT_FOUND'});
    }catch(err){
      // Never put raw body, signature, cookie, URL query, database error or stack in logs.
      const status=Number.isInteger(err?.status)?err.status:503;
      const code=typeof err?.code==='string'&&/^[A-Z_]{3,64}$/.test(err.code)?err.code:'SERVICE_UNAVAILABLE';
      if(status>=500){
        // Strictly structural diagnostics: never log headers, body, cookies,
        // signature, wallet address, challenge, SQL statements or exception text.
        const route=['/v1/auth/pre-session','/v1/identity/wallet/challenge',
          '/v1/identity/wallet/login','/v1/me','/v1/store-registrations'].includes(path)?path:'OTHER';
        const sqlstate=typeof err?.code==='string'&&/^[0-9A-Z]{5}$/.test(err.code)?err.code:'NONE';
        const type=err instanceof TypeError?'TYPE_ERROR':err instanceof RangeError?'RANGE_ERROR':'OTHER';
        console.error('CP31_AUTH_PILOT_REQUEST_5XX',JSON.stringify({route,method:method==='GET'||method==='POST'?method:'OTHER',status,sqlstate,type}));
      }
      return json(res,status,{error:code});
    }
  };
}
