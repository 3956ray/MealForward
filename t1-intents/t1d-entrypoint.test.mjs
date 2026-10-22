import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import {validateT1DDeployment,startT1DEntrypoint} from './t1d-entrypoint.mjs';

const base=Object.freeze({
 PUBLIC_ORIGIN:'https://mealforward-t1d-funding-laodao.onrender.com',
 PORT:'10000',T1D_DEPLOYMENT_STAGE:'SETUP_ONLY',
 T1C_SERVER_MODE:'SETUP_ONLY_NO_FUNDS',T1C_FUNDING_ENABLED:'false',
 T1C_TESTNET_FUND_SCOPE:'DISABLED',
 T1C_QUOTE_SIGNER_ENABLED:'false'
});
test('T1-D standalone setup refuses financial flags, secrets and unpinned origins',()=>{
 assert.equal(validateT1DDeployment(base).stage,'SETUP_ONLY');
 const fail=(mod,code)=>assert.throws(()=>validateT1DDeployment({...base,...mod}),new RegExp(code));
 fail({T1C_SERVER_MODE:'TESTNET_SINGLE_SEVEN_USDC_FUND'},'T1D_SETUP_MUST_DISABLE_FUNDS');
 fail({T1C_FUNDING_ENABLED:'true'},'T1D_SETUP_MUST_DISABLE_FUNDS');
 fail({T1C_TESTNET_FUND_SCOPE:'ONE_QUOTE_AUTHORITY_WALLET_SEVEN_USDC'},'T1D_SETUP_MUST_DISABLE_FUNDS');
 fail({T1C_AUTH_DB_URL:'postgres://example.invalid'},'T1D_SETUP_SECRETS_FORBIDDEN');
 fail({T1C_INTENT_DB_URL:'postgres://example.invalid'},'T1D_SETUP_SECRETS_FORBIDDEN');
 fail({T1C_SUPABASE_ADMIN_DSN:'postgres://example.invalid'},'T1D_SETUP_SECRETS_FORBIDDEN');
 fail({PUBLIC_ORIGIN:'https://unreviewed.onrender.com'},'T1D_ORIGIN_NOT_PINNED');
 fail({PUBLIC_ORIGIN:'http://mealforward-t1d-funding-laodao.onrender.com'},'T1D_ORIGIN_NOT_PINNED');
 fail({T1D_DEPLOYMENT_STAGE:'FUNDING'},'T1D_FUNDING_SCOPE_NOT_EXPLICIT');
 fail({T1D_DEPLOYMENT_STAGE:'FUNDING',T1C_SERVER_MODE:'TESTNET_SINGLE_SEVEN_USDC_FUND',
 T1C_FUNDING_ENABLED:'true',T1C_TESTNET_FUND_SCOPE:'INVALID'},'T1D_FUNDING_SCOPE_NOT_EXPLICIT');
 fail({T1C_QUOTE_SIGNER_ENABLED:'true'},'T1D_NO_PLATFORM_QUOTE_SIGNER');
 fail({PORT:'0'},'T1D_INVALID_PORT');
});

test('identity-only mode requires exact no-funds scope and cannot auto-upgrade to FUNDING',()=>{
 const identity={...base,T1D_DEPLOYMENT_STAGE:'SIWE_ONLY',
  T1C_SERVER_MODE:'T1D_SIWE_READ_ONLY'};
 assert.equal(validateT1DDeployment(identity).stage,'SIWE_ONLY');
 const bad=over=>assert.throws(()=>validateT1DDeployment({...identity,...over}),
  /T1D_SIWE_STAGE_CANNOT_FUND/);
 bad({T1C_FUNDING_ENABLED:'true'});
 bad({T1C_SERVER_MODE:'TESTNET_SINGLE_SEVEN_USDC_FUND'});
 bad({T1C_TESTNET_FUND_SCOPE:'ONE_QUOTE_AUTHORITY_WALLET_SEVEN_USDC'});
});
test('real setup-only HTTP refuses every signing, SIWE and payment path',async()=>{
 const s=net.createServer();
 await new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));
 const port=s.address().port;
 await new Promise(resolve=>s.close(resolve));
 const origin='http://127.0.0.1:'+port;
 const env={...base,PORT:String(port),PUBLIC_ORIGIN:origin,
  GITHUB_ACTIONS:'true',MF_T1D_SETUP_CI:'ack-disposable-loopback'};
 const runtime=await startT1DEntrypoint({env});
 try{
  assert.equal(runtime.setupOnly,true);
  assert.equal(runtime.fundingEnabled,false);
  const send=async(path,opts={})=>{
   const r=await fetch(origin+path,{redirect:'manual',...opts});
   return {r,body:await r.text()};
  };
  const health=await send('/health');
  assert.equal(health.r.status,200);
  assert.equal(JSON.parse(health.body).fundingEnabled,false);
  const homepage=await send('/');
  assert.equal(homepage.r.status,200);
  assert.ok(homepage.body.includes('T1-D'));
  assert.ok(homepage.r.headers.get('content-security-policy').includes("default-src 'none'"));
  const status=await send('/v1/t1/status');
  assert.equal(status.r.status,503);
  assert.deepEqual(JSON.parse(status.body),{
   status:'T1D_OWNER_SETUP_REQUIRED',network:10143,
   fundingEnabled:false,quoteSigningEnabled:false,
   authEnabled:false,transactionActionsEnabled:false,
   originalCp30DataConnected:false,testnetOnly:true
  });
  for(const [path,method] of [
   ['/v1/t1/fund/prepare','POST'],
   ['/v1/t1/fund/quote','POST'],
   ['/v1/t1/fund/approve-call','POST'],
   ['/v1/t1/fund/build-call','POST'],
   ['/v1/t1/fund/reserve','POST'],
   ['/v1/t1/fund/reconcile','POST'],
   ['/v1/t1/fund/quote/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','GET'],
   ['/v1/me','GET'],['/fund-testnet.html','GET'],
   ['/v1/auth/pre-session','POST'],
   ['/v1/t1/my-intents','GET'],['/v1/t1/status','POST']
  ]){
   const v=await send(path,{method,headers:method==='POST'?
    {'Origin':origin,'Content-Type':'application/json'}:{}});
   assert.equal(v.r.status,503,path);
   assert.equal(JSON.parse(v.body).error,'T1D_SETUP_NO_FUNDS');
  }
  // Node fetch may normalize/disallow the Host override. Send a real raw
  // HTTP request so the negative Host check is tested, not the Fetch API.
  const wrongHost=await new Promise((resolve,reject)=>{
   const request=http.request({
    hostname:'127.0.0.1',port,method:'GET',path:'/',
    headers:{Host:'evil.example'}
   },response=>{
    response.resume();
    response.on('end',()=>resolve(response.statusCode));
   });
   request.on('error',reject);
   request.end();
  });
  assert.equal(wrongHost,403);
  const crossOrigin=await send('/',{headers:{Origin:'https://evil.example'}});
  assert.equal(crossOrigin.r.status,403);
  const query=await send('/?debug=1');
  assert.equal(query.r.status,403);
 }finally{await runtime.close()}
});
