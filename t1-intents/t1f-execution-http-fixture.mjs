/** In-process synthetic cookie authStore for isolated tests only; never server-mounted. */
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {makeT1EClaimGateway} from './t1e-claim-http.mjs';
import {FIXED} from './t1e-first-issue-readiness.mjs';
import {PILOT_RECIPIENT} from './t1e-claim-store.mjs';
const h=x=>createHash('sha256').update(x).digest('hex');
export const TOKEN='b'.repeat(43),CSRF='c'.repeat(43),RECIPIENT='a'.repeat(43);
export const syntheticAuth={getSession:async t=>t===h(TOKEN)?{wallet:FIXED.issuerAuthority}:t===h(RECIPIENT)?{wallet:PILOT_RECIPIENT}:null,getSessionWithCsrf:async(t,c)=>c===h(CSRF)?syntheticAuth.getSession(t):null};
export async function httpFixture({service,enabled=true}={}){
 let app;const server=createServer((req,res)=>void app(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 app=makeT1EClaimGateway({origin,stage:'CLAIM_CONSENT',authStore:syntheticAuth,claimStore:{},readiness:async()=>{},loginHandler:(req,res)=>{res.writeHead(404);res.end()},successorEnabled:enabled,executionService:service});
 return {origin,server,close:()=>new Promise(r=>server.close(r)),async request(action,{method=action==='status'?'GET':'POST',body={},token=TOKEN,csrf=CSRF,headers={}}={}){const r=await fetch(origin+'/v1/t1f/successor/'+action,{method,headers:{cookie:'__Host-mcpay_c1_session='+token,origin,'x-c1-csrf':csrf,'content-type':'application/json',...headers},...(method==='POST'?{body:JSON.stringify(body)}:{})});return {status:r.status,cache:r.headers.get('cache-control'),body:await r.json()}}};
}
