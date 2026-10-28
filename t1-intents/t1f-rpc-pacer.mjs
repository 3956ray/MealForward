/** Bounded FIFO permits for read-only RPC starts. No retries or transport calls. */
export function createRpcPacer({intervalMs=250,maxPending=8,clock=()=>performance.now()}={}){
 if(!Number.isFinite(intervalMs)||intervalMs<=0||intervalMs>500||!Number.isInteger(maxPending)||maxPending<1||maxPending>8||typeof clock!=='function')throw Error('T1F_EXECUTION_RPC_CONFIG');
 const queue=[];let nextStart=-Infinity,timer=null;
 const stopTimer=()=>{if(timer!==null){clearTimeout(timer);timer=null}};
 const remove=entry=>{const i=queue.indexOf(entry);if(i!==-1)queue.splice(i,1);entry.signal?.removeEventListener('abort',entry.abort)};
 const drain=()=>{
  stopTimer();
  // Abort is rechecked at the actual permit boundary as well as on enqueue.
  while(queue.length&&queue[0].signal?.aborted){const entry=queue[0];remove(entry);entry.reject(Error('T1F_EXECUTION_RPC_TIMEOUT'))}
  if(!queue.length)return;
  const now=clock(),delay=nextStart-now;
  if(delay>0){timer=setTimeout(drain,Math.max(1,Math.ceil(delay)));return}
  const entry=queue[0];remove(entry);nextStart=now+intervalMs;entry.resolve();
  if(queue.length)timer=setTimeout(drain,Math.max(1,Math.ceil(intervalMs)));
 };
 return async function wait(signal){
  if(signal?.aborted)throw Error('T1F_EXECUTION_RPC_TIMEOUT');
  if(queue.length>=maxPending)throw Error('T1F_EXECUTION_RPC_BUSY');
  return new Promise((resolve,reject)=>{
   const entry={signal,resolve,reject,abort:null};
   entry.abort=()=>{remove(entry);reject(Error('T1F_EXECUTION_RPC_TIMEOUT'));drain()};
   queue.push(entry);signal?.addEventListener('abort',entry.abort,{once:true});
   drain();
  });
 };
}
