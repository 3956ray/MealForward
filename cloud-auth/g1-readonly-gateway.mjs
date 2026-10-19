/**
 * G1 Render same-origin bridge: authentic CP31 SIWE, narrowly scoped signed
 * public-read API. SOURCE ONLY: no original CP30 signer, DB or Journal.
 * When no independently anchored public cache is configured, G1 public
 * GETs still return ORIGINAL_BUSINESS_NOT_CONNECTED from Auth Pilot.
 */
import {makeG1PublicSitesReadHandler} from '../cp30-backend/g1-export/public-sites-read.mjs';

const publicPath = path => path === '/v1/stores' || path === '/v1/ledger' ||
  /^\/v1\/stores\/[^/]+\/meals$/.test(path);

export function makeG1RenderReadGateway({authHandler,publicCache=null,probeHandler=null,origin,clock}={}){
 if(typeof authHandler !== 'function')throw Error('ORIGINAL_AUTH_HANDLER_REQUIRED');
 // An unverified source or unsigned fake payload must never be enabled by
 // a public request or browser option. Only injected trusted cache.current()
 // can open these public routes, and the adapter rechecks every envelope.
 if(publicCache!==null && typeof publicCache?.current!=='function')
  throw Error('G1_ANCHORED_PUBLIC_CACHE_REQUIRED');
 if(probeHandler!==null&&typeof probeHandler!=='function')
  throw Error('G1_TEST_PROBE_HANDLER_REQUIRED');
 const publicReader=publicCache===null?null:makeG1PublicSitesReadHandler({
  cache:publicCache,origin,...(clock?{clock}:{})
 });
 return async function gateway(req,res){
  const path=new URL(req.url||'/',origin).pathname;
  // Completely separate synthetic test-only endpoints; never alias /v1/my/*.
  if(path.startsWith('/__g1_probe/')&&probeHandler)
   return probeHandler(req,res);
  if(publicPath(path)&&req.method==='GET'&&publicReader)
   return publicReader(req,res);
  // Auth Pilot handles all remaining methods, genuine login cookies and
  // business-private routes with their original fail-closed behavior.
  return authHandler(req,res);
 };
}
