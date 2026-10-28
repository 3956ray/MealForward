/** One bounded read-only observation per process boot. No public route, signature or write. */
import {makeExecutionPublicRpc,boundedExecutionRpc} from './t1f-execution-rpc.mjs';
import {observeRecovery} from './t1f-phase8-observe.mjs';
import {phase8Failure} from './t1f-phase8-diagnostics.mjs';
export async function probePhase8Rpc({store,rpc=makeExecutionPublicRpc(),clock=()=>Math.floor(Date.now()/1000),budgetMs=45000,signal}={}){
 let calls=0,method=null;const started=Date.now();const b=boundedExecutionRpc({rpc:{send(m,p,s){calls++;method=m;return rpc.send(m,p,s)}},budgetMs,signal});
 try{const e=await store.context();b.check();await observeRecovery({rpc:b.rpc,row:e.round,clock});return {event:'PHASE8_RPC_BOOT_PROBE',ok:true,calls,elapsedMs:Date.now()-started};}
 catch(e){if(['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getCode','eth_call','eth_getTransactionCount'].includes(e?.rpcMethod))method=e.rpcMethod;return {event:'PHASE8_RPC_BOOT_PROBE',ok:false,calls,method,elapsedMs:Date.now()-started,...phase8Failure(e)};}
 finally{b.close()}
}
