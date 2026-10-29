import type {Role} from './contract.ts';

export type SubmitApproval={role:Role;roundId:string;digest:string;signature:string};
export interface ApprovalApi {read(signal?:AbortSignal):Promise<unknown>;submit(input:SubmitApproval,signal?:AbortSignal):Promise<unknown>}
export type ApprovalApiOptions={fetchImpl?:typeof fetch;clock?:()=>number;timeoutMs?:number};
type Session={csrf:string;expiresAt:number};
const CSRF=/^[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const H32=/^0x[0-9a-f]{64}$/;
const SIGNATURE=/^0x[0-9a-fA-F]{130}$/;
const fail=(code:string):never=>{throw Error('API_'+code)};
/** No user content, CSRF, signature or original exception reaches an error. */
export function createApprovalApi({fetchImpl=fetch,clock=()=>Math.floor(Date.now()/1000),timeoutMs=15000}:ApprovalApiOptions={}):ApprovalApi{
 let session:Session|null=null;
 let opening:Promise<Session>|null=null;
 async function request(path:string,method:'GET'|'POST',csrf?:string,body?:object,signal?:AbortSignal):Promise<{status:number;value:unknown}>{
  if(signal?.aborted)fail('CANCELLED');
  const abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  let cancel:()=>void=()=>{};
  const interruption=new Promise<never>((_,reject)=>{
   cancel=()=>{abort.abort();reject(Error('API_CANCELLED'))};
   signal?.addEventListener('abort',cancel,{once:true});
   timer=setTimeout(()=>{abort.abort();reject(Error('API_TIMEOUT'))},timeoutMs);
  });
  try{
   const headers:Record<string,string>={Accept:'application/json'};
   if(method==='POST')headers['Content-Type']='application/json';
   if(csrf)headers['X-Approval-CSRF']=csrf;
   const response=await Promise.race([fetchImpl(path,{method,credentials:'same-origin',mode:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers,...(body===undefined?{}:{body:JSON.stringify(body)}),signal:abort.signal}),interruption]);
   if(!response.ok)return {status:response.status,value:null};
   const value=await Promise.race([response.json(),interruption]);
   return {status:response.status,value};
  }catch(e){if(signal?.aborted)fail('CANCELLED');if(e instanceof Error&&['API_TIMEOUT','API_CANCELLED'].includes(e.message))throw e;return fail('NETWORK')}
  finally{if(timer)clearTimeout(timer);signal?.removeEventListener('abort',cancel)}
 }
 async function getSession(signal?:AbortSignal):Promise<Session>{
  if(signal?.aborted)fail('CANCELLED');
  if(session&&session.expiresAt>clock()+1)return session;
  if(opening)return awaitOpening(opening,signal);
  const pending=(async()=>{
   // A shared session fetch has its own deadline. One cancelled waiter must
   // not abort a concurrent live caller or force a second session request.
   const r=await request('/v1/approval/session','POST',undefined,{});
   if(r.status!==200||!r.value||typeof r.value!=='object'||Array.isArray(r.value)||Object.keys(r.value).sort().join(',')!=='csrf,expiresAt')fail('SESSION');
   const x=r.value as Record<string,unknown>;
   if(typeof x.csrf!=='string'||!CSRF.test(x.csrf)||!Number.isSafeInteger(x.expiresAt)||Number(x.expiresAt)<=clock())fail('SESSION');
   const fresh:Session={csrf:x.csrf as string,expiresAt:Number(x.expiresAt)};session=fresh;return fresh;
  })();
  opening=pending;
  const clear=()=>{if(opening===pending)opening=null};
  void pending.then(clear,clear);
  return awaitOpening(pending,signal);
 }
 async function awaitOpening(promise:Promise<Session>,signal?:AbortSignal):Promise<Session>{
  if(!signal)return promise;
  if(signal.aborted)fail('CANCELLED');
  let cancel:()=>void=()=>{};
  const interruption=new Promise<never>((_,reject)=>{cancel=()=>reject(Error('API_CANCELLED'));signal.addEventListener('abort',cancel,{once:true})});
  try{return await Promise.race([promise,interruption])}finally{signal.removeEventListener('abort',cancel)}
 }
 async function authorized(path:string,method:'GET'|'POST',body?:object,signal?:AbortSignal):Promise<unknown>{
  const current=await getSession(signal);
  if(signal?.aborted)fail('CANCELLED');
  const r=await request(path,method,current.csrf,body,signal);
  if(r.status===401){if(session===current)session=null;fail('SESSION_EXPIRED')}
  if(r.status!==200)fail('HTTP_'+(Number.isInteger(r.status)?r.status:'ERROR'));
  return r.value;
 }
 return Object.freeze({read:(signal?:AbortSignal)=>authorized('/v1/approval/state','GET',undefined,signal),submit:(input:SubmitApproval,signal?:AbortSignal)=>{
  if(!input||typeof input!=='object'||Object.keys(input).sort().join(',')!=='digest,role,roundId,signature'||!['owner','donor'].includes(input.role)||!UUID.test(input.roundId)||!H32.test(input.digest)||!SIGNATURE.test(input.signature))return Promise.reject(Error('API_SUBMIT_INPUT'));
  return authorized('/v1/approval/submit','POST',input,signal);
 }});
}
