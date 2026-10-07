// Test-build alias only. No vendor SDK, email or real credential is used.
import type {DynamicAuthClient, IdentityView} from '../src/dynamic/contracts'
export function createDynamicAuthClient(): DynamicAuthClient {
  let token:string|null=null, state:IdentityView={status:'signed-out'}
  const listeners=new Set<()=>void>(), invalidators=new Set<(reason:any)=>void>()
  const publish=(next:IdentityView)=>{state=next;listeners.forEach(fn=>fn())}
  window.addEventListener('fixture-token-change',()=>{token=null;publish({status:'signed-out'});invalidators.forEach(fn=>fn('token-changed'))})
  return {getSnapshot:()=>state,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},
    onInvalidate:fn=>{invalidators.add(fn);return()=>invalidators.delete(fn)},initialize:async()=>{},getAccessToken:()=>token,
    startEmail:async()=>{token=null;invalidators.forEach(fn=>fn('subject-changed'));publish({status:'email-pending'})},
    verifyOtp:async code=>{if(code!=='000000')throw new Error('Synthetic code is 000000');
      token=(await(await fetch('/test-token')).json()).token;publish({status:'authenticated'});invalidators.forEach(fn=>fn('token-changed'))},
    logout:async()=>{token=null;publish({status:'signed-out'});invalidators.forEach(fn=>fn('logout'))},getWalletProvider:async()=>null}
}
