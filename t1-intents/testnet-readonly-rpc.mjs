/**
 * PUBLIC MONAD TESTNET 10143 *READ-ONLY* RPC for T1-D.
 * Only two fixed endpoints, no user-supplied RPC URLs/headers/credentials.
 * Never signs, broadcasts or calls eth_sendTransaction. Response null is
 * allowed for pending original TX/Receipt; it is NEVER interpreted as paid.
 */
const ENDPOINTS=Object.freeze([
 'https://testnet-rpc.monad.xyz',
 'https://rpc.ankr.com/monad_testnet'
]);
const METHODS=new Set([
 'eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getCode',
 'eth_call','eth_getTransactionByHash','eth_getTransactionReceipt',
 'eth_getTransactionCount'
]);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const strict=(ok,why)=>{if(!ok)throw Error(why)};
export function makeReadOnlyPublicRpc({
 fetchImpl=fetch,intervalMs=400,timeoutMs=12000
}={}){
 strict(typeof fetchImpl==='function','T1D_FETCH_REQUIRED');
 let chain=Promise.resolve(),cursor=0,id=0,lastAt=0;
 const used=new Set();
 async function invoke(endpoint,method,params){
  const wait=Math.max(0,intervalMs-(Date.now()-lastAt));
  if(wait)await sleep(wait);
  lastAt=Date.now();
  const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),timeoutMs);
  try{
   const result=await fetchImpl(endpoint,{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),
    redirect:'error',signal:ac.signal
   });
   strict(result&&typeof result.status==='number','T1D_BAD_RPC_HTTP');
   if(!result.ok){
    const err=Error('T1D_PUBLIC_RPC_HTTP_'+result.status);
    err.retryable=[429,500,502,503,504].includes(result.status);
    throw err;
   }
   const payload=await result.json();
   if(payload?.jsonrpc!=='2.0'||payload.error){
    const err=Error('T1D_PUBLIC_RPC_JSON_ERROR');
    err.retryable=payload?.error?.code===-32005;
    throw err;
   }
   strict(Object.prototype.hasOwnProperty.call(payload,'result'),
    'T1D_PUBLIC_RPC_RESULT_MISSING');
   return payload.result;
  }finally{clearTimeout(timer)}
 }
 async function perform(method,params){
  for(let step=0;step<4;step++){
   const endpointIndex=(cursor+step)%ENDPOINTS.length;
   const endpoint=ENDPOINTS[endpointIndex];
   try{
    // The caller can never choose chain by supplying another URL.
    const chainId=await invoke(endpoint,'eth_chainId',[]);
    strict(BigInt(chainId)===10143n,'T1D_RPC_WRONG_NETWORK');
    const x=method==='eth_chainId'?chainId:
     await invoke(endpoint,method,params);
    used.add(endpoint);cursor=endpointIndex;
    return x;
   }catch(e){
    if(e?.message==='T1D_RPC_WRONG_NETWORK')throw e;
    if(!e?.retryable){
     if(step===0&&e?.name==='AbortError')continue;
     throw e;
    }
    if(step===3)throw Error('T1D_PUBLIC_RPC_RETRY_LIMIT');
    await sleep(300*(step+1));
   }
  }
  throw Error('T1D_PUBLIC_RPC_UNAVAILABLE');
 }
 return Object.freeze({
  send(method,params=[]){
   if(!METHODS.has(method)||!Array.isArray(params))
    return Promise.reject(Error('T1D_WRITE_RPC_METHOD_FORBIDDEN'));
   const result=chain.then(()=>perform(method,params));
   chain=result.catch(()=>{});
   return result;
  },
  providersUsed(){return [...used]}
 });
}
