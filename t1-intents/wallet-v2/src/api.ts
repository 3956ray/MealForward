import type {Role} from './contract.ts';

export type SubmitApproval={role:Role;roundId:string;digest:string;signature:string};
export interface ApprovalApi {read():Promise<unknown>;submit(input:SubmitApproval):Promise<unknown>}
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
 async function request(path:string,method:'GET'|'POST',csrf?:string,body?:object):Promise<{status:number;value:unknown}>{
  const abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(Error('API_TIMEOUT'))},timeoutMs)});
  try{
   const headers:Record<string,string>={Accept:'application/json'};
   if(method==='POST')headers['Content-Type']='application/json';
   if(csrf)headers['X-Approval-CSRF']=csrf;
   const response=await Promise.race([fetchImpl(path,{method,credentials:'same-origin',mode:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers,...(body===undefined?{}:{body:JSON.stringify(body)}),signal:abort.signal}),timeout]);
   if(!response.ok)return {status:response.status,value:null};
   const value=await Promise.race([response.json(),timeout]);
   return {status:response.status,value};
  }catch(e){if(e instanceof Error&&e.message==='API_TIMEOUT')throw e;return fail('NETWORK')}
  finally{if(timer)clearTimeout(timer)}
 }
 async function getSession():Promise<Session>{
  if(session&&session.expiresAt>clock()+1)return session;
  if(opening)return opening;
  opening=(async()=>{
   const r=await request('/v1/approval/session','POST',undefined,{});
   if(r.status!==200||!r.value||typeof r.value!=='object'||Array.isArray(r.value)||Object.keys(r.value).sort().join(',')!=='csrf,expiresAt')fail('SESSION');
   const x=r.value as Record<string,unknown>;
   if(typeof x.csrf!=='string'||!CSRF.test(x.csrf)||!Number.isSafeInteger(x.expiresAt)||Number(x.expiresAt)<=clock())fail('SESSION');
   const fresh:Session={csrf:x.csrf as string,expiresAt:Number(x.expiresAt)};session=fresh;return fresh;
  })();
  try{return await opening}finally{opening=null}
 }
 async function authorized(path:string,method:'GET'|'POST',body?:object):Promise<unknown>{
  const current=await getSession();
  const r=await request(path,method,current.csrf,body);
  if(r.status===401){if(session===current)session=null;fail('SESSION_EXPIRED')}
  if(r.status!==200)fail('HTTP_'+(Number.isInteger(r.status)?r.status:'ERROR'));
  return r.value;
 }
 return Object.freeze({read:()=>authorized('/v1/approval/state','GET'),submit:(input:SubmitApproval)=>{
  if(!input||typeof input!=='object'||Object.keys(input).sort().join(',')!=='digest,role,roundId,signature'||!['owner','donor'].includes(input.role)||!UUID.test(input.roundId)||!H32.test(input.digest)||!SIGNATURE.test(input.signature))return Promise.reject(Error('API_SUBMIT_INPUT'));
  return authorized('/v1/approval/submit','POST',input);
 }});
}
