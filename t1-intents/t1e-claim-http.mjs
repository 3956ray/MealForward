/**
 * T1-E isolated recipient Claim HTTP policy, same-origin and SIWE only.
 * Exact origin, verified session wallet from T1-E Auth PG, session-CSRF on
 * POST, independent Claim PG. Server NEVER signs / broadcasts an Issue tx.
 */
import {createHash} from 'node:crypto';
import {verifyRecipientConsent} from './t1e-recipient-consent.mjs';
import {consentFromClaim} from './t1e-consent-payload.mjs';
import {publicClaim,PILOT_RECIPIENT} from './t1e-claim-store.mjs';
import {FIXED} from './t1e-first-issue-readiness.mjs';

const HASH=x=>createHash('sha256').update(x,'utf8').digest('hex');
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const SIG=/^0x[0-9a-fA-F]{130}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ERR=(status,code)=>Object.assign(Error(code),{status,code});
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).sort().join(',')===keys.slice().sort().join(',');
function cookieMap(header=''){
 const result={};
 for(const part of header.split(';')){
  const idx=part.indexOf('=');
  if(idx<1)continue;
  const key=part.slice(0,idx).trim(),value=part.slice(idx+1).trim();
  if(!Object.hasOwn(result,key))result[key]=value;
 }
 return result;
}
const writeJson=(res,status,body)=>{
 res.writeHead(status,{
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer'
 });
 res.end(JSON.stringify(body));
};
async function requestJson(req){
 if((req.headers['content-type']||'').split(';')[0].trim()!=='application/json')
  throw ERR(415,'T1E_JSON_REQUIRED');
 let count=0,buffers=[];
 for await(const chunk of req){
  count+=chunk.length;
  if(count>2048)throw ERR(413,'T1E_BODY_TOO_LARGE');
  buffers.push(chunk);
 }
 try{const obj=JSON.parse(Buffer.concat(buffers).toString('utf8'));
  if(!obj||typeof obj!=='object'||Array.isArray(obj))throw Error();
  return obj;
 }catch{throw ERR(400,'T1E_JSON_INVALID')}
}
export function makeT1EClaimGateway({
 origin,stage,authStore,claimStore,readiness,loginHandler,
 clock=()=>Math.floor(Date.now()/1000)
}={}){
 const isConsent=stage==='CLAIM_CONSENT';
 if(!['CLAIM_SIWE_ONLY','CLAIM_CONSENT'].includes(stage)||
   typeof origin!=='string'||!/^https:\/\/[a-z0-9-]+\.onrender\.com$/.test(origin)&&
   !/^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(origin)||
   !authStore||!claimStore||
   typeof readiness!=='function'||typeof loginHandler!=='function')
  throw Error('T1E_CLAIM_GATEWAY_INVALID_CONFIG');
 const host=new URL(origin).host;
 const active=async(req,csrf=false)=>{
  const cookies=cookieMap(req.headers.cookie);
  const token=cookies['__Host-mcpay_c1_session'];
  if(!TOKEN.test(token||''))throw ERR(401,'UNAUTHENTICATED');
  const now=clock();
  const session=csrf?(
   TOKEN.test(req.headers['x-c1-csrf']||'')?
    await authStore.getSessionWithCsrf(HASH(token),HASH(req.headers['x-c1-csrf']),now):
    null
  ):await authStore.getSession(HASH(token),now);
  if(!session?.wallet)throw ERR(csrf?403:401,csrf?'T1E_CSRF_DENIED':'UNAUTHENTICATED');
  const wallet=session.wallet.toLowerCase();
  if(wallet!==PILOT_RECIPIENT&&wallet!==FIXED.issuerAuthority)
   throw ERR(403,'T1E_NOT_PINNED_TO_PILOT_ROLES');
  return wallet;
 };
 const route=async(req,res)=>{
  const now=clock();
  const u=new URL(req.url||'/',origin);
  const path=u.pathname,method=req.method;
  try{
   if(req.headers.host!==host||u.search||u.hash||
    req.headers.authorization||req.headers['x-wallet-address']||
    method==='POST'&&(
      req.headers.origin!==origin||
      req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin'
    ))throw ERR(403,'T1E_ORIGIN_DENIED');
   if(path==='/v1/t1e/status'&&method==='GET')return writeJson(res,200,{
    status:isConsent?'T1E_RECIPIENT_CONSENT_ONLY':'T1E_ISOLATED_SIWE_READ_ONLY',
    chainId:10143,pinnedRecipient:PILOT_RECIPIENT,
    walletLoginEnabled:true,recipientClaimWriteEnabled:isConsent,
    issuerIssueEnabled:false,fundEnabled:false,settleEnabled:false,
    beneficiaryEligibilityVerified:false,
    onchainRecipientSignatureEnforced:false,
    originalCp30Connected:false
   });
   if(path==='/v1/t1e/me'&&method==='GET'){
    const wallet=await active(req);
    return writeJson(res,200,{walletAddress:wallet,
     role:wallet===FIXED.issuerAuthority?'issuer':'recipient',
     sessionScope:'T1E_ISOLATED',issuerIssueEnabled:false});
   }
   if(path==='/v1/t1e/issuer/readiness'&&method==='GET'){
    const wallet=await active(req);
    if(wallet!==FIXED.issuerAuthority)throw ERR(403,'T1E_ISSUER_ROLE_REQUIRED');
    const snapshot=await claimStore.issuerReadiness();
    return writeJson(res,200,{
     originalUnit:0,generation:1,issuance:snapshot,
     issuerTransactionEnabled:false,
     nextAction:snapshot?.claimStage==='CONSENT_VERIFIED'?
      'AWAIT_EXPLICIT_WALLET_ISSUE_RELEASE':'AWAIT_BENEFICIARY_DURABLE_CONSENT'
    });
   }
   if(path==='/v1/t1e/claim/me'&&method==='GET'){
    const wallet=await active(req);
    if(wallet!==PILOT_RECIPIENT)throw ERR(403,'T1E_RECIPIENT_ROLE_REQUIRED');
    const row=await claimStore.own(wallet);
    const basic=publicClaim(row,now);
    let consent=null;
    if(row?.stage==='PREPARED'&&row.round?.state==='PENDING'&&
       Number(row.round.deadline)>now+5){
     consent=consentFromClaim(row,now);
    }
    return writeJson(res,200,{
     claim:basic,consent,
     consentNeedsRenewal:basic?.consentNeedsRenewal===true,
     originalUnitEligibleAsTestOnly:true,
     beneficiaryEligibilityVerified:false
    });
   }
   if(path==='/v1/t1e/claim/prepare'&&method==='POST'){
    if(!isConsent)throw ERR(405,'T1E_CLAIM_WRITES_DISABLED');
    const wallet=await active(req,true);
    if(wallet!==PILOT_RECIPIENT)throw ERR(403,'T1E_RECIPIENT_ROLE_REQUIRED');
    const body=await requestJson(req);
    if(!exact(body,[]))throw ERR(422,'T1E_EXACT_PREPARE_REQUIRED');
    // Real public RPC gate: first funded Unit must still be Available, not
    // blocked/issued/refunded, BEFORE a new private claim nonce can be made.
    const proof=await readiness();
    const state=await claimStore.prepare({wallet,now,proof});
    const consent=state.row.stage==='PREPARED'&&
      state.row.round?.state==='PENDING'&&
      Number(state.row.round.deadline)>now+5?
     consentFromClaim(state.row,now):null;
    return writeJson(res,state.created?201:200,{
     claim:publicClaim(state.row,now),consent,
     created:state.created,mayAttemptNewClaim:false,
     onchainIssued:false,issuerIssueEnabled:false
    });
   }
   if(path==='/v1/t1e/claim/renew'&&method==='POST'){
    if(!isConsent)throw ERR(405,'T1E_CLAIM_WRITES_DISABLED');
    const wallet=await active(req,true);
    if(wallet!==PILOT_RECIPIENT)throw ERR(403,'T1E_RECIPIENT_ROLE_REQUIRED');
    const body=await requestJson(req);
    if(!exact(body,[]))throw ERR(422,'T1E_EXACT_RENEW_REQUEST_REQUIRED');
    // A stalled wallet popup can expire a 7 minute EIP712 challenge.
    // Immutable original Claim/nonce stays; bounded at most THREE rounds
    // and never a second voucher/Unit. Only after real chain gate still
    // proves original Unit 0 is Available.
    const proof=await readiness();
    const row=await claimStore.renew({wallet,now,proof});
    const consent=consentFromClaim(row,now);
    return writeJson(res,200,{
     claim:publicClaim(row,now),consent,
     originalClaimReused:true,
     fundEnabled:false,issuerIssueEnabled:false
    });
   }
   if(path==='/v1/t1e/claim/consent'&&method==='POST'){
    if(!isConsent)throw ERR(405,'T1E_CLAIM_WRITES_DISABLED');
    const wallet=await active(req,true);
    if(wallet!==PILOT_RECIPIENT)throw ERR(403,'T1E_RECIPIENT_ROLE_REQUIRED');
    const body=await requestJson(req);
    if(!exact(body,['claimId','signature'])||
      !UUID.test(body.claimId||'')||!SIG.test(body.signature||''))
      throw ERR(422,'T1E_EXACT_CONSENT_REQUIRED');
    const row=await claimStore.own(wallet);
    if(!row||row.claim_id!==body.claimId)throw ERR(404,'T1E_CLAIM_NOT_OWNED');
    const prepared=consentFromClaim(row,now);
    let verified;
    try{
     verified=verifyRecipientConsent({
      prepared,signature:body.signature,sessionWallet:wallet,
      nonceReservedInPrivateDatabase:true,now
     });
    }catch{throw ERR(422,'T1E_CONSENT_CRYPTO_DENIED')}
    // Raw signature exists only inside this request, never in PG, journal,
    // request logs or cookie. Exactly one original nonce is consumed.
    const updated=await claimStore.verifyConsent({
     wallet,claimId:body.claimId,
     expectedNonce:prepared.message.nonce,
     digest:verified.digest.toLowerCase(),
     fingerprint:verified.signatureFingerprint.toLowerCase(),
     now
    });
    return writeJson(res,200,{
     status:'T1E_OFFCHAIN_CONSENT_DURABLY_VERIFIED',
     claim:publicClaim(updated,now),
     onchainIssued:false,issuerIssueEnabled:false,
     beneficiaryEligibilityVerified:false
    });
   }
   if(path.startsWith('/v1/t1e/'))
    throw ERR(method==='POST'?405:404,'T1E_ISSUE_AND_SETTLEMENT_DISABLED');
   return loginHandler(req,res);
  }catch(e){
   let status=Number.isInteger(e?.status)?e.status:503;
   let code=typeof e?.code==='string'&&/^T1E_[A-Z_]{3,80}$/.test(e.code)?
    e.code:'T1E_SERVICE_UNAVAILABLE';
   // Explicit safe programmatic state errors, no raw SQL or wallet data.
   if(status===503&&typeof e?.message==='string'&&/^T1E_[A-Z_]{3,80}$/.test(e.message)){
    code=e.message;
    status=['T1E_ORIGINAL_UNIT_ALREADY_CLAIMED',
     'T1E_CONSENT_ALREADY_USED_OR_EXPIRED','T1E_ORIGINAL_AVAILABLE_UNIT_REQUIRED',
     'T1E_PREPARED_CONSENT_EXPIRED_OR_ALREADY_USED',
     'T1E_CONSENT_RENEW_ONLY_AFTER_EXPIRED',
     'T1E_CONSENT_RETRY_LIMIT',
     'T1E_CONSENT_ROUND_CAS_CONFLICT'].includes(code)?409:403;
   }
   return writeJson(res,status,{error:code});
  }
 };
 return route;
}
