/**
 * T1-C isolated, same-origin SIWE -> immutable Intent HTTP integration.
 *
 * The imported CP31 Auth Pilot handler and its PG schema are byte-identical
 * to reviewed G0 source. They are used to authenticate a NEW Testnet-only
 * principal, never to impersonate the frozen Mac CP30 subject.
 *
 * LIVE/default mode exposes only authenticated READS, no intent creation,
 * Quote signing, transaction preparation/broadcast, Approve or Fund.
 * CREATE is only testable in a named disposable loopback PG17 CI fixture.
 */
import {createHash} from 'node:crypto';
import {makePilotHandler} from './auth/core.mjs';
import {createT1IntentLedger,CHAIN,ESCROW,TOKEN,MEAL,TERMS,QUOTE,PRICE} from './core.mjs';
import {assertRealT0IsOpen,proveFundingQuoteDigest} from './testnet-funding-chain.mjs';
import {verifyOriginalFundingQuote,exactApproveTransaction,exactFundTransaction} from './quote-protocol.mjs';

const frozenFundingRow=x=>({
 intent_id:x.intentId,stage:x.stage,
 chain_id:CHAIN,escrow:ESCROW,payer:x.payer,
 quote_id:x.quoteId,meal_id:MEAL,terms_hash:TERMS,
 version:1,quantity:x.quantity,unit_price:PRICE.toString(),
 amount:x.amount,quote_deadline:x.quoteDeadline,
 quote_digest:x.quoteDigest,
 quote_signature_hash:x.quoteSignatureFingerprint
});

const TOKEN_COOKIE='__Host-mcpay_c1_session';
const COOKIE=/^[a-zA-Z0-9_-]{43}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORIGIN=/^(?:https:\/\/[a-z0-9-]+\.onrender\.com|http:\/\/127\.0\.0\.1:[0-9]{2,5})$/;
const CI_DSN='postgres://postgres:t1c-disposable-only@127.0.0.1:5433/mf_t1c_http_ci';
const MAX_BODY=1024;
const NOW=()=>Math.floor(Date.now()/1000);
const err=(status,reason)=>Object.assign(Error(reason),{status,reason});
const respond=(res,code,body)=>{
 res.writeHead(code,{
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private,no-store,max-age=0',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
  'Content-Security-Policy':"default-src 'none'",
  'Vary':'Cookie'
 });
 res.end(JSON.stringify(body,(_key,value)=>typeof value==='bigint'?value.toString():value));
};
const digest=value=>createHash('sha256').update(value,'utf8').digest('hex');
function getCookie(header){
 if(typeof header!=='string'||header.length>4096)return null;
 let found=null,seen=0;
 for(const item of header.split(';')){
  const eq=item.indexOf('=');
  if(eq<0)continue;
  const name=item.slice(0,eq).trim();
  if(name!==TOKEN_COOKIE)continue;
  found=item.slice(eq+1).trim();
  seen++;
 }
 return seen===1&&COOKIE.test(found)?found:null;
}
async function jsonBody(req,maxBytes=1024){
 if((req.headers['content-type']||'').split(';')[0].trim()!=='application/json')
  throw err(415,'JSON_REQUIRED');
 let size=0,chunks=[];
 for await(const chunk of req){
  size+=chunk.length;
  if(size>maxBytes)throw err(413,'BODY_TOO_LARGE');
  chunks.push(chunk);
 }
 try{
  const val=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(!val||typeof val!=='object'||Array.isArray(val))throw Error();
  return val;
 }catch{throw err(400,'INVALID_JSON')}
}
const exactly=(o,keys)=>Object.keys(o).sort().join(',')===[...keys].sort().join(',');
export function makeT1CAuthenticatedGateway({
 sessionPool,intentPool,authStore,siwe,origin,clock=NOW,mode='read_only',rpc=null
}={}){
 if(!sessionPool?.query||!intentPool?.query||!intentPool?.connect||
  sessionPool===intentPool||!authStore?.getSession||
  typeof siwe?.makeChallenge!=='function'||
  typeof siwe?.verifyChallenge!=='function'||
  !ORIGIN.test(origin||'')||typeof clock!=='function')
  throw Error('T1C_PINNED_AUTH_AND_PG_REQUIRED');
 if(!['read_only','disposable_ci','testnet_fund'].includes(mode))
  throw Error('T1C_UNKNOWN_MODE');
 if(mode==='testnet_fund'&&typeof rpc?.send!=='function')
  throw Error('T1D_READ_ONLY_RPC_REQUIRED');
 if(mode==='disposable_ci'&&!(
  process.env.GITHUB_ACTIONS==='true'&&
  process.env.MF_T1C_DISPOSABLE_ONLY==='ack-fresh-t1c-postgres17'&&
  process.env.MF_T1C_HTTP_DISPOSABLE_ONLY==='ack-original-siwe-pg17'&&
  process.env.DATABASE_URL===CI_DSN&&
  origin.startsWith('http://127.0.0.1:')
 ))throw Error('T1C_CI_MODE_FORBIDDEN');

 const fundMode=mode==='testnet_fund';
 const trusted=new WeakMap();
 const ledger=createT1IntentLedger({
  pool:intentPool,now:clock,persistSignedQuotes:fundMode,resolveWallet:async secret=>{
   const identity=trusted.get(secret);
   if(!identity)throw Error('UNVERIFIED_T1_WALLET_PRINCIPAL');
   return {verified:true,source:'TESTNET_WALLET_AUTHORITY',address:identity.wallet};
  }
 });
 const pilot=makePilotHandler({store:authStore,siwe,origin,clock});
 const expectedHost=new URL(origin).host;
 const validRequest=req=>{
  const u=new URL(req.url||'/',origin);
  if(req.headers.host!==expectedHost||u.host!==expectedHost||
   u.search||u.hash||u.username||u.password||
   req.headers.authorization||req.headers['x-wallet-address']||
   req.headers['x-recipient-key']||
   (req.headers.origin&&req.headers.origin!==origin)||
   (req.headers['sec-fetch-site']&&
    !['same-origin','none'].includes(req.headers['sec-fetch-site'])))
    throw err(403,'ORIGIN_OR_SUBJECT_DENIED');
  if(req.method==='POST'&&req.headers.origin!==origin)
   throw err(403,'ORIGIN_REQUIRED');
  return u.pathname;
 };
 const sessionPrincipal=async(req,isWrite)=>{
  const token=getCookie(req.headers.cookie);
  if(!token)throw err(401,'UNAUTHENTICATED');
  const csrf=req.headers['x-c1-csrf'];
  if(isWrite&&!COOKIE.test(csrf||''))throw err(403,'CSRF_REQUIRED');
  const wallet=await sessionPool.query(
   'SELECT wallet FROM mf_cp31_auth_pilot.sessions '+
   'WHERE token_hash=$1 AND expires_at>$2 AND NOT revoked '+
   'AND ($3::boolean=false OR csrf_hash=$4)',
   [digest(token),clock(),isWrite,isWrite?digest(csrf):'']
  );
  if(wallet.rowCount!==1)throw err(isWrite?403:401,isWrite?'CSRF_OR_SESSION_REVOKED':'UNAUTHENTICATED');
  const identity=Object.freeze({wallet:wallet.rows[0].wallet});
  trusted.set(identity,identity);
  return identity;
 };
 return async function t1cGateway(req,res){
  const raw=req.url||'/';
  if(!raw.startsWith('/v1/t1/'))return pilot(req,res);
  try{
   const path=validRequest(req);
   if(path==='/v1/t1/status'&&req.method==='GET'){
    // Publicly display non-funding readiness only. Health is not
    // authorization to create financial intents in a real environment.
    const [auth,db]=await Promise.all([
     authStore.health(),
     intentPool.query("SELECT to_regclass('mf_t1c.intents') IS NOT NULL AS ready")
    ]);
    return respond(res,auth&&db.rows[0].ready?200:503,{
     status:auth&&db.rows[0].ready?(fundMode?'READY_TESTNET_7_USDC':'READY_NO_FUNDS'):'UNAVAILABLE',
     mode:fundMode?'T1D_WALLET_OWNED_TESTNET_FUND':'T1_C_READ_ONLY_AUTH_GATE',
     network:10143,
     transactionActionsEnabled:fundMode,
     quoteSigningEnabled:fundMode,
     fundingEnabled:fundMode,
     testnetOnly:true,
     testnetFundingPolicy:fundMode?'QUOTE_AUTHORITY_SELF_FUNDED_ONE_UNIT':'DISABLED',
     originalCp30DataConnected:false
    });
   }
   if(fundMode&&path==='/v1/t1/fund/readiness'&&req.method==='GET'){
    const identity=await sessionPrincipal(req,false);
    if(identity.wallet!==QUOTE)throw err(403,'TESTNET_FIRST_PAYER_NOT_QUOTE_AUTHORITY');
    const proof=await assertRealT0IsOpen({rpc,payer:identity.wallet});
    if(proof.unitsFunded!=='0')throw err(409,'FIRST_TEST_FUND_ALREADY_COMPLETED');
    return respond(res,200,{...proof,allowedUnitsPerIntent:1,onlyUserClickedWalletActions:true});
   }
   // Recover the original Authority signature ONLY for its authenticated
   // payer. Never expose raw signatures in public status, DTOs or logs.
   const signedMatch=fundMode&&req.method==='GET'?
    /^\/v1\/t1\/fund\/quote\/([0-9a-f-]{36})$/.exec(path):null;
   if(signedMatch){
    const identity=await sessionPrincipal(req,false);
    if(identity.wallet!==QUOTE)throw err(403,'TESTNET_FIRST_PAYER_NOT_QUOTE_AUTHORITY');
    const signed=await ledger.recoverSignedQuote({
     session:identity,intentId:signedMatch[1]
    });
    return respond(res,200,signed);
   }
   if(fundMode&&path.startsWith('/v1/t1/fund/')&&req.method==='POST'){
    const identity=await sessionPrincipal(req,true);
    if(identity.wallet!==QUOTE)throw err(403,'TESTNET_FIRST_PAYER_NOT_QUOTE_AUTHORITY');
    const action=path.slice('/v1/t1/fund/'.length);
    const body=await jsonBody(req,4096);
    const recordId=body?.intentId;
    if(action==='prepare'){
     if(!exactly(body,['idempotencyKey','quantity'])||body.quantity!==1)
      throw err(422,'FIRST_TEST_ONLY_ONE_MEAL');
     const readiness=await assertRealT0IsOpen({rpc,payer:identity.wallet});
     if(readiness.unitsFunded!=='0')throw err(409,'FIRST_TEST_FUND_ALREADY_COMPLETED');
     if(BigInt(readiness.assets.balance)<PRICE)
      throw err(409,'INSUFFICIENT_TEST_USDC');
     const record=await ledger.prepare({
      session:identity,idempotencyKey:body.idempotencyKey,quantity:1
     });
     return respond(res,200,{
      ...record,fundingEnabled:true,testnetOnly:true,
      limit:'ONE_7_TEST_USDC_MEAL',
      quoteAuthority:QUOTE,
      signatureDomain:{
       name:'MealForward C0 Funding',version:'1',chainId:CHAIN,
       verifyingContract:ESCROW
      }
     });
    }
    if(typeof recordId!=='string'||!UUID.test(recordId))
      throw err(422,'INVALID_ORIGINAL_INTENT_ID');
    if(action==='quote'){
     if(!exactly(body,['intentId','signature']))
      throw err(422,'EXACT_QUOTE_REQUEST_REQUIRED');
     const pending=await ledger.fetchOriginal({session:identity,intentId:recordId});
     if(pending.stage!=='PREPARED')throw err(409,'ORIGINAL_INTENT_NOT_PREPARED');
     const q={
      quoteId:pending.quoteId,payer:pending.payer,
      mealId:MEAL,currentVersion:'1',termsHash:TERMS,
      quantity:'1',unitPrice:PRICE.toString(),
      amount:PRICE.toString(),deadline:pending.quoteDeadline
     };
     await proveFundingQuoteDigest({rpc,quote:q});
     // An independently reviewed PR #32 protocol verifier rejects any
     // mismatched payer, terms, authority, amount or expired FundingQuote.
     verifyOriginalFundingQuote(
      frozenFundingRow(pending),body.signature,{now:clock()}
     );
     const signed=await ledger.bindQuote({
      session:identity,intentId:recordId,signature:body.signature
     });
     return respond(res,200,{...signed,testnetQuoteSignatureAccepted:true});
    }
    if(action==='approve-call'){
     if(!exactly(body,['intentId','nonce']))
      throw err(422,'EXACT_APPROVE_CALL_REQUEST_REQUIRED');
     const pending=await ledger.fetchOriginal({session:identity,intentId:recordId});
     if(pending.stage!=='QUOTE_BOUND')throw err(409,'ORIGINAL_QUOTE_NOT_BOUND');
     const tx=exactApproveTransaction(frozenFundingRow(pending),{
      nonce:body.nonce,now:clock()
     });
     return respond(res,200,{
      ...tx,amount:PRICE.toString(),testnetOnly:true,
      requiresWalletReservation:true
     });
    }
    if(action==='build-call'){
     if(!exactly(body,['intentId','nonce']))
      throw err(422,'EXACT_FUNDED_CALL_REQUEST_REQUIRED');
     const pending=await ledger.fetchOriginal({session:identity,intentId:recordId});
     if(pending.stage!=='APPROVED')throw err(409,'ORIGINAL_APPROVE_NOT_FINAL');
     const saved=await ledger.recoverSignedQuote({
      session:identity,intentId:recordId
     });
     const tx=exactFundTransaction(frozenFundingRow(pending),{
      signature:saved.signature,nonce:body.nonce,now:clock()
     });
     const proof=await assertRealT0IsOpen({rpc,payer:identity.wallet});
     if(proof.unitsFunded!=='0'||BigInt(proof.assets.allowance)<PRICE)
      throw err(409,'APPROVAL_NOT_ONCHAIN_OR_FIRST_TEST_ALREADY_FINISHED');
     return respond(res,200,{
      ...tx,quoteId:pending.quoteId,amount:PRICE.toString(),
      testnetOnly:true,requiresWalletReservation:true
     });
    }
    if(action==='reserve'){
     if(!exactly(body,['intentId','kind','transaction'])||
      !['approve','fund'].includes(body.kind))
      throw err(422,'INVALID_ORIGINAL_TRANSACTION');
     const ready=await assertRealT0IsOpen({rpc,payer:identity.wallet});
     if(ready.unitsFunded!=='0')throw err(409,'FIRST_TEST_FUND_ALREADY_COMPLETED');
     if(BigInt(ready.assets.balance)<PRICE)
      throw err(409,'INSUFFICIENT_TEST_USDC');
     if(body.kind==='fund'&&BigInt(ready.assets.allowance)<PRICE)
      throw err(409,'APPROVAL_NOT_ONCHAIN');
     const reservation=await ledger.reserve({
      session:identity,intentId:recordId,
      kind:body.kind,transaction:body.transaction
     });
     return respond(res,200,reservation);
    }
    if(action==='bind-hash'){
     if(!exactly(body,['intentId','kind','txHash']))
      throw err(422,'INVALID_ORIGINAL_HASH_REQUEST');
     const proof=await ledger.bindOriginalHash({
      session:identity,intentId:recordId,
      kind:body.kind,txHash:body.txHash,rpc
     });
     return respond(res,200,proof);
    }
    if(action==='reconcile'){
     if(!exactly(body,['intentId','kind']))
      throw err(422,'INVALID_RECONCILE_REQUEST');
     const evidence=await ledger.reconcile({
      session:identity,intentId:recordId,
      kind:body.kind,rpc
     });
     return respond(res,200,evidence);
    }
    throw err(405,'TESTNET_FUND_UNKNOWN_ACTION');
   }
   if(path==='/v1/t1/my-intents'&&req.method==='GET'){
    const auth=await sessionPrincipal(req,false);
    // This explicitly scopes every query by its independently verified
    // SIWE cookie-derived wallet. User-provided wallet fields are denied.
    const entries=await intentPool.query(
     'SELECT intent_id,stage,quote_id,quantity,amount,created_at '+
     'FROM mf_t1c.intents WHERE payer=$1 ORDER BY created_at DESC,intent_id DESC LIMIT 20',
     [auth.wallet]
    );
    return respond(res,200,{
     items:entries.rows.map(x=>({
      intentId:x.intent_id,stage:x.stage,quoteId:x.quote_id,
      quantity:Number(x.quantity),amount:String(x.amount)
     })),
     scope:'NEW_TESTNET_ORIGINAL_SIWE_ONLY',fundingEnabled:fundMode
    });
   }
   const match=/^\/v1\/t1\/intents\/([0-9a-f-]{36})$/.exec(path);
   if(match){
    if(req.method!=='GET')throw err(405,'METHOD_NOT_ALLOWED');
    if(!UUID.test(match[1]))throw err(400,'INVALID_INTENT_ID');
    const auth=await sessionPrincipal(req,false);
    const state=await ledger.fetchOriginal({session:auth,intentId:match[1]});
    return respond(res,200,{...state,fundingEnabled:fundMode});
   }
   if(path==='/v1/t1/intents/prepare'&&req.method==='POST'){
    if(mode!=='disposable_ci')throw err(503,'FUNDING_DISABLED');
    const auth=await sessionPrincipal(req,true);
    const body=await jsonBody(req);
    if(!exactly(body,['idempotencyKey','quantity']))throw err(422,'UNEXPECTED_REQUEST_FIELDS');
    const record=await ledger.prepare({
     session:auth,idempotencyKey:body.idempotencyKey,quantity:body.quantity
    });
    return respond(res,200,{...record,fundingEnabled:false,sendTransactionAllowed:false});
   }
   if(path.startsWith('/v1/t1/'))throw err(405,'FUNDING_DISABLED');
   throw err(404,'NOT_FOUND');
  }catch(error){
   // Never reflect a SQL error, Cookie, signature, wallet address, raw
   // request or private UUID on an untrusted API error.
   const safe=error?.reason;
   if(safe)return respond(res,error.status,{error:safe});
   if(error?.message==='INTENT_NOT_FOUND')return respond(res,404,{error:'NOT_FOUND'});
   if(fundMode&&/^(T1D_[A-Z_]+|ORIGINAL_[A-Z_]+|QUOTE_[A-Z_]+|SIGNED_QUOTE_EXPIRED|TX_NOT_ORIGINAL_WALLET_INTENT|UNSUPPORTED_WALLET_KIND|TX_PAYER_MISMATCH|APPROVE_ALLOWANCE_NOT_EXACT|INVALID_WALLET_NONCE|TX_VALUE_MUST_BE_ZERO|WRONG_CHAIN)$/.test(error?.message||''))
    return respond(res,409,{error:error.message});
   if(error?.message==='IDEMPOTENCY_PAYLOAD_CONFLICT')return respond(res,409,{error:'IDEMPOTENCY_CONFLICT'});
   if(['INVALID_IDEMPOTENCY_KEY','INVALID_QUANTITY','INVALID_INTENT_ID'].includes(error?.message))
    return respond(res,422,{error:'INVALID_REQUEST'});
   return respond(res,503,{error:'T1_C_SOURCE_UNAVAILABLE'});
  }
 };
}
