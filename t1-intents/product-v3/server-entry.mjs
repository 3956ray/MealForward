/** Explicit dual-target entry. New deployments remain disabled until their reviewed manifest is committed. */
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';
import {FetchRequest,JsonRpcProvider,Wallet} from 'ethers';
import {productServerConfiguration,approvedProductDeployment} from '../product-v2/server-entry.mjs';
import {verifiedSupabasePoolerTls} from '../supabase-tls.mjs';
import {productStore} from '../product-v2/store.mjs';
import {makeTargetRegistry,targetIdOf} from '../product-v2/target-registry.mjs';
import {makeTargetStore} from '../product-v2/target-store.mjs';
import {makeAtomicChain} from '../product-v2/atomic-chain.mjs';
import {makeProductChain} from '../product-v2/chain-adapter.mjs';
import {makeMultiTargetRuntime} from '../product-v2/multi-target-runtime.mjs';
import {makeWorkerMonitor} from '../product-v2/worker-monitor.mjs';
import {makeProductHost} from '../product-v2/host.mjs';
export function multiTargetConfiguration(env){
 const base=productServerConfiguration(env),targets=JSON.parse(readFileSync(new URL('./approved-deployments.json',import.meta.url),'utf8'));
 if(!Array.isArray(targets)||targets.some(t=>t.contractVersion!==3))throw Error('V3_APPROVED_DEPLOYMENTS_REQUIRED');
 const activeTargetId=env.MF_PRODUCT_ACTIVE_TARGET||targetIdOf(approvedProductDeployment),registry=makeTargetRegistry({legacyTarget:approvedProductDeployment,targets,activeTargetId});
 if(!['web','worker','web-with-worker'].includes(env.MF_PRODUCT_PROCESS_ROLE))throw Error('PRODUCT_PROCESS_ROLE_REQUIRED');
 if(env.MF_PRODUCT_LEGACY_WORKER_STOPPED!=='true')throw Error('LEGACY_WORKER_HANDOFF_REQUIRED');
 if(![undefined,'false','true'].includes(env.MF_PRODUCT_NEW_FUNDING_ENABLED))throw Error('INVALID_NEW_FUNDING_SWITCH');
 return {...base,registry,newFundingEnabled:env.MF_PRODUCT_NEW_FUNDING_ENABLED==='true',role:env.MF_PRODUCT_PROCESS_ROLE};
}
export async function startMultiTargetServer(env=process.env){
 const config=multiTargetConfiguration(env),pool=new Pool({connectionString:config.connectionString,ssl:verifiedSupabasePoolerTls(),max:4,connectionTimeoutMillis:10000,idleTimeoutMillis:30000});
 pool.on('error',()=>process.stderr.write('PRODUCT_DATABASE_UNAVAILABLE\n'));
 const request=new FetchRequest(config.rpcUrl);request.timeout=10000;const provider=new JsonRpcProvider(request,undefined,{batchMaxCount:1,cacheTimeout:-1});
 const store=productStore(pool),chains=new Map();let server,timer,impactTimer,stopping=false,active=Promise.resolve(),impactActive=Promise.resolve();
 async function stop(){if(stopping)return;stopping=true;clearTimeout(timer);clearTimeout(impactTimer);if(server?.listening)await new Promise(resolve=>server.close(resolve));await active;await impactActive;await pool.end();provider.destroy();}
 try{
  for(const id of config.registry.ids()){
   const manifest=config.registry.get(id),scope=makeTargetStore({store,registry:config.registry,targetId:id});
   const baseChain=makeProductChain({provider,manifest,store:scope,claimSigner:new Wallet(config.claimKey,provider),redemptionSigner:new Wallet(config.redemptionKey,provider)});chains.set(id,makeAtomicChain({provider,manifest,baseChain}));
  }
  const runtime=await makeMultiTargetRuntime({newFundingEnabled:config.newFundingEnabled,registry:config.registry,store,chains,pool,origin:config.origin,pepper:config.pepper,defaultImageDigest:config.defaultImageDigest});
  if(config.role!=='worker'){
   ({server}=await makeProductHost({runtime,origin:config.origin}));await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.port,'0.0.0.0',resolve);});
  }
  if(config.role!=='web'){
   const monitor=makeWorkerMonitor({store,provider,targets:config.registry.ids().map(id=>config.registry.get(id))});
   const runImpact=()=>{if(stopping)return;impactActive=runtime.tickImpact().catch(()=>{}).finally(()=>{if(!stopping)impactTimer=setTimeout(runImpact,30000);});};runImpact();
   const run=()=>{if(stopping)return;active=runtime.tickClaims().then(()=>monitor.sample()).catch(()=>process.stderr.write('PRODUCT_WORKER_RECOVERY_PENDING\n')).finally(()=>{if(!stopping)timer=setTimeout(run,2000);});};run();
  }
  return {server,stop,role:config.role};
 }catch{await stop();throw Error('PRODUCT_MULTI_TARGET_STARTUP_REJECTED');}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)startMultiTargetServer().then(({stop,role})=>{process.stdout.write('MealForward multi-target '+role+' ready\n');for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>stop().catch(()=>{process.exitCode=1;}));}).catch(()=>{process.stderr.write('PRODUCT_MULTI_TARGET_STARTUP_REJECTED\n');process.exitCode=1;});
