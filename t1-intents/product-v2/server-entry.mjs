/** Dedicated cloud entry. No environment, signer or socket is accessed on import. */
import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';
import {FetchRequest,JsonRpcProvider,Wallet} from 'ethers';
import {verifiedSupabasePoolerTls} from '../supabase-tls.mjs';
import {productStore} from './store.mjs';
import {makeProductHost} from './host.mjs';
const requireValue=(ok,code)=>{if(!ok)throw Error(code);};
export function productServerConfiguration(env){
 requireValue(env.MF_PRODUCT_ENABLED==='true','PRODUCT_EXPLICIT_ENABLE_REQUIRED');
 const origin=env.MF_PRODUCT_ORIGIN;
 requireValue(/^https:\/\/[a-z0-9-]+\.onrender\.com$/.test(origin||''),'PRODUCT_PUBLIC_ORIGIN_REQUIRED');
 let db,rpc,manifest;
 try{db=new URL(env.MF_PRODUCT_DATABASE_URL);rpc=new URL(env.MF_PRODUCT_RPC_URL);manifest=JSON.parse(env.MF_PRODUCT_MANIFEST);}catch{throw Error('PRODUCT_CONFIGURATION_REQUIRED');}
 requireValue(db.protocol==='postgresql:'&&db.hostname==='aws-0-ap-southeast-2.pooler.supabase.com'&&['5432','6543'].includes(db.port)&&decodeURIComponent(db.username)==='mf_product_v2_runtime.ketfrukrcuosrqynnsay'&&db.password&&db.pathname==='/postgres'&&!db.search&&!db.hash,'PRODUCT_DEDICATED_DATABASE_REQUIRED');
 requireValue(rpc.protocol==='https:'&&!rpc.username&&!rpc.password&&!rpc.hash,'PRODUCT_HTTPS_RPC_REQUIRED');
 requireValue(manifest?.chainId===10143&&manifest.asset?.toLowerCase()==='0x534b2f3a21130d7a60830c2df862319e593943a3'&&manifest.policySeconds===7200,'PRODUCT_TESTNET_MANIFEST_REQUIRED');
 for(const name of ['MF_PRODUCT_CLAIM_KEY','MF_PRODUCT_REDEMPTION_KEY'])requireValue(/^0x[0-9a-f]{64}$/i.test(env[name]||''),'PRODUCT_DEDICATED_SIGNERS_REQUIRED');
 requireValue(typeof env.MF_PRODUCT_CREDENTIAL_PEPPER==='string'&&env.MF_PRODUCT_CREDENTIAL_PEPPER.length>=32,'PRODUCT_CREDENTIAL_KEY_REQUIRED');
 requireValue(/^0x[0-9a-f]{64}$/i.test(env.MF_PRODUCT_DEFAULT_IMAGE_DIGEST||'')&&BigInt(env.MF_PRODUCT_DEFAULT_IMAGE_DIGEST)!==0n,'PRODUCT_IMAGE_DIGEST_REQUIRED');
 const port=Number(env.PORT||10000);requireValue(Number.isInteger(port)&&port>=1024&&port<=65535,'PRODUCT_PORT_INVALID');
 return {origin,manifest,port,connectionString:env.MF_PRODUCT_DATABASE_URL,rpcUrl:env.MF_PRODUCT_RPC_URL,claimKey:env.MF_PRODUCT_CLAIM_KEY,redemptionKey:env.MF_PRODUCT_REDEMPTION_KEY,pepper:env.MF_PRODUCT_CREDENTIAL_PEPPER,defaultImageDigest:env.MF_PRODUCT_DEFAULT_IMAGE_DIGEST};
}
export async function startProductServer(env=process.env){
 const config=productServerConfiguration(env);
 const {makeProductChain}=await import('./chain-adapter.mjs');
 const pool=new Pool({connectionString:config.connectionString,ssl:verifiedSupabasePoolerTls(),max:4,connectionTimeoutMillis:10000,idleTimeoutMillis:30000});
 pool.on('error',()=>process.stderr.write('PRODUCT_DATABASE_UNAVAILABLE\n'));
 const request=new FetchRequest(config.rpcUrl);request.timeout=10000;
 const provider=new JsonRpcProvider(request,undefined,{batchMaxCount:1,cacheTimeout:-1});
 let server,timer,active=Promise.resolve(),stopping=false;
 async function stop(){if(stopping)return;stopping=true;clearInterval(timer);if(server?.listening)await new Promise(resolve=>server.close(resolve));await active;await pool.end();provider.destroy();}
 try{
  const chain=makeProductChain({provider,manifest:config.manifest,store:productStore(pool),claimSigner:new Wallet(config.claimKey,provider),redemptionSigner:new Wallet(config.redemptionKey,provider),profile:'monad-testnet'});
  const host=await makeProductHost({pool,chain,origin:config.origin,pepper:config.pepper,policySeconds:7200,defaultImageDigest:config.defaultImageDigest,enabled:true,profile:'monad-testnet'});
  server=host.server;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.port,'0.0.0.0',resolve);});
  let busy=false;
  timer=setInterval(()=>{if(stopping||busy)return;busy=true;active=host.tickClaims().catch(()=>{process.stderr.write('PRODUCT_WORKER_QUERY_FAILED; original operations retained\n');}).finally(()=>{busy=false;});},2000);
  return {server,stop,origin:config.origin};
 }catch{await stop();throw Error('PRODUCT_STARTUP_REJECTED');}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 startProductServer().then(({stop,origin})=>{process.stdout.write('MealForward product testnet ready: '+origin+'/product-v2/index.html\n');for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>stop().catch(()=>{process.exitCode=1;}));}).catch(()=>{process.stderr.write('PRODUCT_STARTUP_REJECTED: verify dedicated deployment configuration\n');process.exitCode=1;});
}
