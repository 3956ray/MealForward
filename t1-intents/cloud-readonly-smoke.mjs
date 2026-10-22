/**
 * MealForward T1-C public read-only HTTPS acceptance probe.
 * ZERO cookies, ZERO secrets, ZERO keys, ZERO signing, ZERO onchain actions.
 *
 * Never accepts an arbitrary destination from CLI/environment:
 * only the isolated, reviewed Render Free pilot can be inspected.
 *
 * A successful probe means "public NO-FUNDS service responds correctly";
 * it does NOT mean an original CP30 principal or funding flow is live.
 */
const PINNED='https://mealforward-t1c-readonly-laodao.onrender.com';
const TEST_HOST=/^http:\/\/127\.0\.0\.1:[0-9]{2,5}$/;
const ERRORS=Object.freeze({
 NO_AUTH:'UNAUTHENTICATED',FUNDS:'FUNDING_DISABLED'
});
function assert(x,code){if(!x)throw Error(code)}
export async function verifyReadOnlyCloud({origin=PINNED,fetchImpl=fetch,allowCiLoopback=false}={}){
 assert(origin===PINNED||(allowCiLoopback&&TEST_HOST.test(origin)),
  'T1C_UNTRUSTED_CLOUD_ORIGIN');
 assert(typeof fetchImpl==='function','T1C_FETCH_REQUIRED');
 let calls=0;
 const invoke=async(path,method='GET',body)=>{
  assert(/^\/(?:v1\/[a-z0-9-_/]+)?$/.test(path),'T1C_DISALLOWED_API_PATH');
  assert(['GET','POST'].includes(method),'T1C_METHOD_DENIED');
  const response=await fetchImpl(origin+path,{
   method,redirect:'error',cache:'no-store',
   headers:{
    Accept:'application/json',
    ...(method==='POST'?{
     Origin:origin,'Content-Type':'application/json'
    }:{})
   },
   ...(body===undefined?{}:{body:JSON.stringify(body)}),
   signal:AbortSignal.timeout(15000)
  });
  calls++;
  assert(response?.headers&&typeof response.status==='number',
   'T1C_HTTP_RESPONSE_INVALID');
  const contentType=response.headers.get('content-type')||'';
  const data=contentType.startsWith('application/json')?await response.json():null;
  return {status:response.status,data,headers:response.headers};
 };
 const status=await invoke('/v1/t1/status');
 assert(status.status===200&&
  status.data?.status==='READY_NO_FUNDS'&&
  status.data.mode==='T1_C_READ_ONLY_AUTH_GATE'&&
  status.data.network===10143&&
  status.data.transactionActionsEnabled===false&&
  status.data.quoteSigningEnabled===false&&
  status.data.fundingEnabled===false&&
  status.data.originalCp30DataConnected===false,
 'T1C_LIVE_READONLY_GATE_NOT_READY');
 const who=await invoke('/v1/me');
 assert(who.status===401&&who.data?.error===ERRORS.NO_AUTH,
  'T1C_LIVE_UNAUTHENTICATED_SESSION_LEAK');
 const mine=await invoke('/v1/t1/my-intents');
 assert(mine.status===401&&mine.data?.error===ERRORS.NO_AUTH,
  'T1C_LIVE_PRIVATE_INTENT_EXPOSED');
 const prepare=await invoke('/v1/t1/intents/prepare','POST',{
  idempotencyKey:'00000000-0000-4000-8000-000000000001',quantity:1
 });
 assert(prepare.status===503&&prepare.data?.error===ERRORS.FUNDS,
  'T1C_LIVE_FINANCIAL_INTENT_WRITABLE');
 const fund=await invoke('/v1/t1/intents/fund','POST',{});
 assert(fund.status===405&&fund.data?.error===ERRORS.FUNDS,
  'T1C_LIVE_FUND_ROUTE_OPEN');
 const quote=await invoke('/v1/t1/sign-quote','POST',{});
 assert(quote.status===405&&quote.data?.error===ERRORS.FUNDS,
  'T1C_LIVE_QUOTE_SIGNING_OPEN');
 const old=await invoke('/v1/stores');
 assert(old.status===503&&
  old.data?.error==='ORIGINAL_BUSINESS_NOT_CONNECTED',
  'T1C_LIVE_ORIGINAL_CP30_UNEXPECTEDLY_CONNECTED');
 return {
  status:'T1_C_LIVE_READONLY_HTTP_PASS',
  target:origin,
  noFunds:true,
  authUnauthorizedCorrect:true,
  privateIntentUnauthorizedCorrect:true,
  moneyRoutesBlocked:true,
  originalMacCp30Touched:false,
  requests:calls,
  signedMessages:0,
  fundOrApproveTransactions:0
 };
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 try{
  const summary=await verifyReadOnlyCloud();
  process.stdout.write(JSON.stringify(summary,null,2)+'\n');
 }catch(error){
  const reason=typeof error?.message==='string'&&
   /^T1C_[A-Z_]{4,60}$/.test(error.message)?error.message:'T1C_PUBLIC_PROBE_NOT_READY';
  process.stderr.write(reason+'\n');
  process.exitCode=1;
 }
}
