/**
 * T1-F original Issuer-only HTTP controller. Must be mounted BEHIND the
 * existing T1-E same-origin SIWE+CSRF middleware, with the real original
 * Issuer wallet role. The backend is read-only against Monad: it cannot
 * sign or broadcast; the human MetaMask wallet sends at most once.
 */
import {FIXED} from './t1e-first-issue-readiness.mjs';
const error=(status,code)=>Object.assign(Error(code),{status,code});
const requireShape=(x,fields)=>
 x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).sort().join(',')===fields.slice().sort().join(',');
const H32=/^0x[0-9a-f]{64}$/i;
const send=(res,status,data)=>{
 res.writeHead(status,{
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer'
 });
 res.end(JSON.stringify(data));
};
export async function t1fIssuerRoute({
 path,method,request,response,issuer,ledger,rpc,readiness,now,readBody
}={}){
 if(typeof issuer!=='string'||issuer.toLowerCase()!==
  FIXED.issuerAuthority.toLowerCase())
  throw error(403,'T1F_ORIGINAL_ISSUER_SESSION_REQUIRED');
 if(!ledger||typeof rpc?.send!=='function'||
  typeof readiness!=='function'||typeof readBody!=='function')
  throw error(503,'T1F_ISSUER_BACKEND_UNAVAILABLE');
 if(path==='/v1/t1f/issuer/status'&&method==='GET'){
  return send(response,200,{
   status:'T1F_ISSUER_WALLET_ONLY',
   claim:await ledger.status({issuer}),
   fundedAgainAllowed:false,
   onchainRecipientConsentEnforced:false,
   merchantSettlementEnabled:false
  });
 }
 if(path==='/v1/t1f/issuer/prepare'&&method==='POST'){
  const body=await readBody(request);
  if(!requireShape(body,['issuerPendingNonce'])||
   typeof body.issuerPendingNonce!=='string'||
   !/^(0|[1-9][0-9]{0,15})$/.test(body.issuerPendingNonce))
   throw error(422,'T1F_EXACT_PENDING_NONCE_REQUIRED');
  // Double check independently via the pinned read-only public chain
  // BEFORE the durable transaction reservation and wallet popup.
  const [proof,chainNonce]=await Promise.all([
   readiness(),rpc.send('eth_getTransactionCount',[issuer,'pending'])
  ]);
  if(BigInt(body.issuerPendingNonce)!==BigInt(chainNonce))
   throw error(409,'T1F_ISSUER_NONCE_CHANGED_BEFORE_RESERVATION');
  const result=await ledger.reserve({
   issuer,now,issuerPendingNonce:body.issuerPendingNonce,chainProof:proof
  });
  return send(response,result.created?201:200,result);
 }
 if(path==='/v1/t1f/issuer/bind'&&method==='POST'){
  const body=await readBody(request);
  if(!requireShape(body,['transactionHash'])||
   typeof body.transactionHash!=='string'||!H32.test(body.transactionHash))
   throw error(422,'T1F_EXACT_ORIGINAL_TX_HASH_REQUIRED');
  const result=await ledger.bind({
   issuer,txHash:body.transactionHash.toLowerCase(),rpc
  });
  return send(response,200,result);
 }
 if(path==='/v1/t1f/issuer/reconcile'&&method==='POST'){
  const body=await readBody(request);
  if(!requireShape(body,[]))
   throw error(422,'T1F_RECONCILE_MUST_HAVE_EMPTY_BODY');
  const result=await ledger.reconcile({issuer,rpc,now});
  return send(response,200,result);
 }
 throw error(method==='POST'?405:404,'T1F_UNREVIEWED_ISSUER_ROUTE');
}