/** Bounded public read-only execution transport; no signing or broadcast methods. */
const check=(ok,code)=>{if(!ok)throw Error('T1F_EXECUTION_'+code)};
const METHODS=new Set(['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getCode','eth_call','eth_getTransactionReceipt','eth_getTransactionCount','eth_getTransactionByHash']);
/** Fixed public endpoint, one attempt, bounded response; never follows redirects. */
export function makeExecutionPublicRpc({fetchImpl=fetch}={}){
 let nextId=0;
 return {async send(method,params,signal){
  check(METHODS.has(method)&&Array.isArray(params),'RPC_METHOD');
  const id=++nextId;
  const response=await fetchImpl('https://testnet-rpc.monad.xyz',{method:'POST',headers:{'content-type':'application/json'},redirect:'error',signal,body:JSON.stringify({jsonrpc:'2.0',id,method,params})});
  check(response.ok&&response.body,'RPC_HTTP');
  const reader=response.body.getReader();let size=0;const parts=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;check(size<=1048576,'RPC_SIZE');parts.push(Buffer.from(value));}}
  finally{await reader.cancel().catch(()=>{})}
  let data;try{data=JSON.parse(Buffer.concat(parts).toString('utf8'))}catch{throw Error('T1F_EXECUTION_RPC_JSON')}
  check(data?.jsonrpc==='2.0'&&data.id===id&&!data.error&&Object.hasOwn(data,'result'),'RPC_RESPONSE');return data.result;
 }};
}
/** Cancellation also guards continuations when a test/custom transport ignores AbortSignal. */
export function boundedExecutionRpc({rpc,budgetMs=45000,signal}){
 check(typeof rpc?.send==='function'&&Number.isInteger(budgetMs)&&budgetMs>0&&budgetMs<=45000,'RPC_CONFIG');
 const ac=new AbortController();let calls=0,inflight=0,closed=false;
 const end=Date.now()+budgetMs;
 const alive=()=>check(!closed&&!ac.signal.aborted&&!signal?.aborted&&Date.now()<end,'RPC_TIMEOUT');
 const timer=setTimeout(()=>ac.abort(),budgetMs);
 return {check:alive,close(){closed=true;clearTimeout(timer);ac.abort()},rpc:{async send(method,params=[]){
  alive();check(METHODS.has(method)&&Array.isArray(params),'RPC_METHOD');check(++calls<=80&&inflight<8,'RPC_BUDGET');
  inflight++;let timeout;
  const remaining=Math.max(1,Math.min(6000,end-Date.now()));
  try{
   const result=await Promise.race([Promise.resolve().then(()=>{alive();return rpc.send(method,params,ac.signal)}),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('T1F_EXECUTION_RPC_TIMEOUT')),remaining)})]);
   alive();return result;
  }finally{clearTimeout(timeout);inflight--}
 }}};
}
