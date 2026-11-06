/** Standalone, opt-in real PostgreSQL + Anvil + HTTP acceptance environment.
 * Never reads .env, old runtime state, private wallet files or cloud credentials.
 * Generated identities live only in this process. Public manifest has no secrets. */
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:net';
import {mkdir,lstat,realpath,readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {dirname,join,resolve,basename} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {randomUUID,randomBytes} from 'node:crypto';
import pg from 'pg';
import {Wallet,JsonRpcProvider,ContractFactory,keccak256} from 'ethers';
import {makeProductHost} from './host.mjs';
import {productStore} from './store.mjs';
import {makeAcceptanceWallet} from './acceptance-wallet.mjs';
import {seedAcceptance} from './seed-acceptance.mjs';
const exec=promisify(execFile),root=fileURLToPath(new URL('../../',import.meta.url));
const safeError=(code)=>Object.assign(Error(code),{code});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const freePort=()=>new Promise((resolve,reject)=>{const server=createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(err=>err?reject(err):resolve(port));});});
const run=async(binary,args)=>{try{return await exec(binary,args,{maxBuffer:1024*1024});}catch{throw safeError('LOCAL_DEPENDENCY_COMMAND_FAILED');}};
export function validateAcceptanceOptions(options={}){
 if(options.profile!==undefined&&options.profile!=='local-acceptance'||options.chainId!==undefined&&options.chainId!==31337||options.host!==undefined&&options.host!=='127.0.0.1')throw safeError('LOCAL_ACCEPTANCE_ONLY');
 if(options.workerMs!==undefined&&(!Number.isSafeInteger(options.workerMs)||options.workerMs<250||options.workerMs>10000))throw safeError('INVALID_WORKER_INTERVAL');
 const base=join(root,'.local-product-acceptance'),directory=options.workdir?resolve(options.workdir):join(base,'run-'+randomUUID());
 if(dirname(directory)!==base||!/^[-_a-zA-Z0-9]{1,80}$/.test(basename(directory)))throw safeError('ACCEPTANCE_WORKDIR_OUTSIDE_ROOT');
 return {directory,base,profile:'local-acceptance',chainId:31337,host:'127.0.0.1',pgBin:options.pgBin||'/opt/homebrew/opt/postgresql@17/bin',anvilBin:options.anvilBin||'anvil',workerMs:options.workerMs||1000};
}
export async function prepareAcceptanceDirectory(options={}){
 const config=validateAcceptanceOptions(options);
 await mkdir(config.base,{recursive:true,mode:0o700});
 if((await lstat(config.base)).isSymbolicLink()||await realpath(config.base)!==config.base)throw safeError('ACCEPTANCE_SYMLINK_DENIED');
 try{await mkdir(config.directory,{mode:0o700});}catch(error){if(error.code==='EEXIST')throw safeError('ACCEPTANCE_WORKDIR_EXISTS');throw error;}
 return config;
}
async function stopChild(child){if(!child||child.exitCode!==null||child.signalCode)return;child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),sleep(3000)]);if(child.exitCode===null&&!child.signalCode){child.kill('SIGKILL');await new Promise(r=>child.once('exit',r));}}
const artifact=async(name,file=name)=>JSON.parse(await readFile(new URL(`../../mvp-contracts/out/${file}.sol/${name}.json`,import.meta.url),'utf8'));

export async function startAcceptanceStack(options={}){
 const config=await prepareAcceptanceDirectory(options),directory=config.directory;const guard=()=>{if(options.signal?.aborted)throw safeError('ACCEPTANCE_START_CANCELLED');};let pgStarted=false,anvil,provider,admin,pool,host,socketDirectory,timer,worker=null,stopping=null,publicInfo;
 let phase='DEPENDENCY_CHECK',workerError=null;
 const manifest=async status=>writeFile(join(directory,'status.json'),JSON.stringify({status,phase,profile:'local-acceptance',chainId:31337,processId:process.pid,...(publicInfo||{}),...(workerError?{workerError}:{})},null,2)+'\n',{mode:0o600});
 async function stop(){if(stopping)return stopping;stopping=(async()=>{clearInterval(timer);if(worker)await worker.catch(()=>{});if(host?.server.listening){host.server.closeAllConnections?.();await new Promise(r=>host.server.close(r));}await pool?.end();await admin?.end();provider?.destroy();await stopChild(anvil);if(pgStarted){await run(join(config.pgBin,'pg_ctl'),['-D',join(directory,'database'),'-m','fast','-w','stop']);pgStarted=false;}if(socketDirectory)await rm(socketDirectory,{recursive:true,force:true});await manifest('STOPPED');})();return stopping;}
 try{
  await manifest('STARTING');guard();
  const version=await run(join(config.pgBin,'postgres'),['--version']);if(!/PostgreSQL\) 17\./.test(version.stdout))throw safeError('POSTGRES_17_REQUIRED');
  await readFile(new URL('../public/product-v2/index.html',import.meta.url));
  const httpPort=await freePort();let rpcPort;do{rpcPort=await freePort();}while(rpcPort===httpPort);const pgPort=await freePort();guard();
  // Unix-only PG socket in a private short path; no TCP listener or password/DSN.
  socketDirectory=await mkdtemp(join(tmpdir(),'mfpa-'));
  phase='POSTGRES_START';await run(join(config.pgBin,'initdb'),['-D',join(directory,'database'),'-A','trust','-U','product_acceptance_admin']);
  await run(join(config.pgBin,'pg_ctl'),['-D',join(directory,'database'),'-l',join(directory,'postgres.log'),'-o',`-h '' -p ${pgPort} -k ${socketDirectory}`,'-w','start']);pgStarted=true;guard();
  admin=new pg.Pool({host:socketDirectory,port:pgPort,user:'product_acceptance_admin',database:'postgres'});
  await admin.query(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
  await admin.query('CREATE ROLE product_acceptance_login LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS');await admin.query('GRANT mf_product_v2_runtime TO product_acceptance_login');
  pool=new pg.Pool({host:socketDirectory,port:pgPort,user:'product_acceptance_login',database:'postgres',options:'-c role=mf_product_v2_runtime'});
  phase='ANVIL_START';const rpcUrl=`http://127.0.0.1:${rpcPort}`;let childError;
  anvil=spawn(config.anvilBin,['--host','127.0.0.1','--port',String(rpcPort),'--chain-id','31337','--accounts','0','--block-time','1','--slots-in-an-epoch','1','--silent'],{stdio:'ignore'});anvil.on('error',()=>childError=true);
  for(let i=0;i<100;i++){guard();if(childError||anvil.exitCode!==null)throw safeError('LOCAL_ANVIL_START_FAILED');try{const response=await fetch(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]}),signal:AbortSignal.timeout(500)});if((await response.json()).result==='0x7a69')break;}catch{}if(i===99)throw safeError('LOCAL_ANVIL_NOT_READY');await sleep(50);}
  provider=new JsonRpcProvider(rpcUrl,31337,{cacheTimeout:-1,pollingInterval:100});
  const wallets=Object.fromEntries(['merchant','donor','recipient','platform','verifier'].map(role=>[role,Wallet.createRandom().connect(provider)]));
  for(const wallet of Object.values(wallets))await provider.send('anvil_setBalance',[wallet.address,'0x56bc75e2d63100000']);
  guard();phase='LOCAL_DEPLOY';const tokenArtifact=await artifact('AcceptanceTestAsset'),escrowArtifact=await artifact('ProductEscrow');
  const token=await new ContractFactory(tokenArtifact.abi,tokenArtifact.bytecode.object,wallets.merchant).deploy();await token.waitForDeployment();guard();
  const escrow=await new ContractFactory(escrowArtifact.abi,escrowArtifact.bytecode.object,wallets.merchant).deploy(await token.getAddress(),wallets.platform.address,wallets.verifier.address,7200);await escrow.waitForDeployment();guard();
  await (await token.mint(wallets.donor.address,1000000000n)).wait();
  const target={chainId:31337,escrow:await escrow.getAddress(),asset:await token.getAddress(),claimAuthority:wallets.platform.address,redemptionAuthority:wallets.verifier.address,maxFeePerGas:'10000000000',maxTransactionFee:'50000000000000000'};
  // The shared adapter is real RPC/receipt verification, never a fake API.
  const {makeProductChain}=await import('./chain-adapter.mjs');
  await provider.send('anvil_mine',['0x3','0x1']);const deploymentReceipt=await provider.getTransactionReceipt(escrow.deploymentTransaction().hash);
  const chainManifest={...target,escrowCodeHash:keccak256(await provider.getCode(target.escrow)),assetCodeHash:keccak256(await provider.getCode(target.asset)),policySeconds:7200,assetDecimals:6,deploymentBlock:deploymentReceipt.blockNumber,claimGasLimit:'1000000'};
  const store=productStore(pool);
  const chain=await makeProductChain({provider,manifest:chainManifest,store,claimSigner:wallets.platform,redemptionSigner:wallets.verifier,profile:'local-acceptance'});
  const origin=`http://127.0.0.1:${httpPort}`;
  const localWallet=options.localWallet===false?null:makeAcceptanceWallet({origin,provider,wallets,target});
  guard();phase='HTTP_START';host=await makeProductHost({localWallet,profile:'local-acceptance',pool,chain,origin,pepper:randomBytes(32).toString('hex'),policySeconds:7200,defaultImageDigest:'0x'+'47'.repeat(32),enabled:true});
  await new Promise((resolve,reject)=>{host.server.once('error',reject);host.server.listen(httpPort,'127.0.0.1',resolve);});
  const tick=()=>{if(worker||stopping)return;worker=host.tickClaims().catch(error=>{workerError=/^[A-Z_]{3,64}$/.test(error.code||'')?error.code:'CLAIM_WORKER_UNAVAILABLE';}).finally(()=>worker=null);};
  guard();timer=setInterval(tick,config.workerMs);tick();
  publicInfo={url:origin+'/product-v2/index.html',rpcUrl,workdir:directory,accounts:Object.fromEntries(Object.entries(wallets).map(([role,w])=>[role,w.address])),contracts:{asset:target.asset,escrow:target.escrow}};phase='READY';await manifest('READY');
  return {public:publicInfo,stop,seed:()=>seedAcceptance({origin,wallets}),verify:()=>runAcceptanceScenario({origin,provider,wallets,token,escrow,tickClaims:host.tickClaims}),status:()=>({phase,workerError})};
 }catch(error){phase='FAILED';try{await stop();}catch{}throw safeError(error.code&&/^[A-Z_]{3,64}$/.test(error.code)?error.code:'ACCEPTANCE_START_FAILED');}
}

async function runAcceptanceScenario({origin,provider,wallets,token,escrow,tickClaims}){
 let seq=0;const requestId=()=>`acceptance-${++seq}-${randomUUID()}`,checks=[];
 async function request(path,{method='GET',body,session,headers={}}={}){const response=await fetch(origin+'/v1/product'+path,{method,headers:{origin,'content-type':'application/json',...headers,...(session?{cookie:session.cookie,'x-mf-product-v2-csrf':session.csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});let value;try{value=await response.json();}catch{throw safeError('ACCEPTANCE_INVALID_HTTP_RESPONSE');}if(!response.ok)throw safeError(/^[A-Z_]{3,64}$/.test(value.error||'')?value.error:'ACCEPTANCE_HTTP_FAILED');return {value,cookie:response.headers.get('set-cookie')?.split(';')[0]};}
 async function login(wallet){const pre=await request('/auth/pre-session',{method:'POST',body:{},headers:{'x-mf-product-v2-bootstrap':'1'}}),session={cookie:pre.cookie,csrf:pre.value.csrf};const challenge=await request('/identity/wallet/challenge',{method:'POST',body:{address:wallet.address},session});const logged=await request('/identity/wallet/login',{method:'POST',body:{challengeId:challenge.value.challengeId,signature:await wallet.signMessage(challenge.value.message)},session});return {cookie:logged.cookie,csrf:logged.value.csrf};}
 const merchant=await login(wallets.merchant),donor=await login(wallets.donor),recipient=await login(wallets.recipient);checks.push('real SIWE / private PG sessions for three synthetic identities');
 const call=async(session,path,body,method='POST')=>(await request(path,{session,method,body})).value;
 const get=async(session,path)=>(await request(path,{session})).value;
 async function awaitOperation(session,path,predicate){for(let i=0;i<100;i++){const result=await get(session,path);if(predicate(result))return result;if(result.state==='REVERTED')throw safeError('ACCEPTANCE_TRANSACTION_REVERTED');await sleep(100);}throw safeError('ACCEPTANCE_FINALITY_TIMEOUT');}
 async function send(session,wallet,path,operation){const admitted=await call(session,path+'/attempt',{});if(admitted.allowed!==true)throw safeError('ACCEPTANCE_SEND_DENIED');const transaction=await wallet.sendTransaction(operation.transaction);await transaction.wait();await call(session,path+'/hash',{txHash:transaction.hash});return awaitOperation(session,path,result=>result.state==='CONFIRMED');}
 const review=await call(merchant,'/registration-reviews',{name:'本机验收厨房',requestId:requestId()}),registration=await call(merchant,'/registrations',{reviewId:review.id,requestId:requestId()});await send(merchant,wallets.merchant,'/catalog-operations/'+registration.id,registration);const storeId=registration.storeId;
 const mealId='acceptance-meal-'+randomUUID(),deadline=Math.floor(Date.now()/1000)+86400;
 const draft=await call(merchant,'/drafts/'+mealId,{storeId,expectedRevision:0,requestId:requestId(),name:'本机验收套餐',description:'仅独立本机测试资产，不是真实资助',unitPrice:'7000000',quantity:'12',fundingDeadline:deadline,windows:[[0,1440]]},'PUT');
 const publicationReview=await call(merchant,'/publication-reviews',{draftId:mealId,revision:draft.revision,requestId:requestId()}),publication=await call(merchant,'/publications',{reviewId:publicationReview.id,requestId:requestId()});await send(merchant,wallets.merchant,'/catalog-operations/'+publication.id,publication);checks.push('merchant registration, immutable publication and real catalog projection');
 await call(merchant,'/kitchens/'+storeId+'/settings',{expectedRevision:0,requestId:requestId(),hours:[[0,1440]],announcement:'本机验收环境',restToday:true},'PUT');
 const supportReview=await call(donor,'/support-reviews',{storeId,mealId,version:1,quantity:'3',requestId:requestId()}),approval=await call(donor,'/approvals',{reviewId:supportReview.id,requestId:requestId()});await send(donor,wallets.donor,'/approvals/'+approval.id,approval);
 const support=await call(donor,'/support-intents',{reviewId:supportReview.id,requestId:requestId()});await send(donor,wallets.donor,'/intents/'+support.id,support);checks.push('exact token approval and three-portion funding over real HTTP/PG/chain');
 const before=await provider.getBalance(wallets.recipient.address),claimReview=await call(recipient,'/claim-reviews',{storeId,mealId,requestId:requestId()}),claim=await call(recipient,'/claim-intents',{reviewId:claimReview.id,requestId:requestId()});await tickClaims();const claimed=await awaitOperation(recipient,'/claims/'+claim.id,result=>result.state==='CONFIRMED');if(await provider.getBalance(wallets.recipient.address)!==before)throw safeError('RECIPIENT_GAS_WAS_CHARGED');
 const voucher=await get(recipient,'/vouchers/'+claimed.voucherId);checks.push('platform-gas Claim during today-rest and original-wallet voucher lookup');
 const display=await call(recipient,'/vouchers/'+voucher.id+'/display',{}),checked=await call(merchant,'/merchant/check',{storeId,code:display.code}),locked=await call(merchant,'/merchant/locks',{handle:checked.handle,requestId:requestId()});if(locked.state!=='AWAITING_HANDOVER'||!locked.canConfirmHandover)throw safeError('ACCEPTANCE_LOCK_FAILED');
 const handover=await call(merchant,'/merchant/handovers',{handle:locked.handle,handedOver:true,requestId:requestId()});await send(merchant,wallets.merchant,'/merchant/operations/'+handover.id,handover);
 // A second wallet holds an unused voucher when the original kitchen closes.
 const unusedReview=await call(donor,'/claim-reviews',{storeId,mealId,requestId:requestId()}),unusedClaim=await call(donor,'/claim-intents',{reviewId:unusedReview.id,requestId:requestId()});await tickClaims();const unused=await awaitOperation(donor,'/claims/'+unusedClaim.id,r=>r.state==='CONFIRMED');
 const closure=await call(merchant,'/merchant/closure',{storeId,acknowledge:true,requestId:requestId()});await send(merchant,wallets.merchant,'/catalog-operations/'+closure.id,closure);
 if((await get(donor,'/vouchers/'+unused.voucherId)).state!=='CANCELLED'||await escrow.nextEligibleAt(wallets.donor.address)!==0n)throw safeError('ACCEPTANCE_CLOSURE_DID_NOT_RELEASE');
 const refunds=await get(merchant,'/merchant/refunds?storeId='+storeId),batch=refunds.items.find(i=>!i.refunded&&i.amount==='14000000');if(!refunds.closed||!batch)throw safeError('ACCEPTANCE_REFUND_LIST_MISMATCH');
 const refundBefore=await token.balanceOf(wallets.donor.address),refund=await call(merchant,'/merchant/refunds',{storeId,batchId:batch.batchId,requestId:requestId()});await send(merchant,wallets.merchant,'/catalog-operations/'+refund.id,refund);
 if(await token.balanceOf(wallets.donor.address)!==refundBefore+14000000n)throw safeError('ACCEPTANCE_REFUND_AMOUNT_MISMATCH');
 const repeated=await call(merchant,'/merchant/refunds',{storeId,batchId:batch.batchId,requestId:refund.requestId});if(repeated.id!==refund.id||repeated.state!=='CONFIRMED'||await token.balanceOf(wallets.donor.address)!==refundBefore+14000000n)throw safeError('ACCEPTANCE_DUPLICATE_REFUND');
 checks.push('permanent closure cancels unused voucher, refunds original payer exactly once, preserves handed-over liability');
 const nextReview=await call(recipient,'/registration-reviews',{name:'另一家验收厨房',requestId:requestId()}),nextRegistration=await call(recipient,'/registrations',{reviewId:nextReview.id,requestId:requestId()});await send(recipient,wallets.recipient,'/catalog-operations/'+nextRegistration.id,nextRegistration);
 const nextStore=nextRegistration.storeId,nextMeal='next-meal-'+randomUUID(),nextDraft=await call(recipient,'/drafts/'+nextMeal,{storeId:nextStore,expectedRevision:0,requestId:requestId(),name:'另一家套餐',description:'验证停业后立即领取',unitPrice:'5000000',quantity:'1',fundingDeadline:deadline,windows:[[0,1440]]},'PUT');
 const nextPublicationReview=await call(recipient,'/publication-reviews',{draftId:nextMeal,revision:nextDraft.revision,requestId:requestId()}),nextPublication=await call(recipient,'/publications',{reviewId:nextPublicationReview.id,requestId:requestId()});await send(recipient,wallets.recipient,'/catalog-operations/'+nextPublication.id,nextPublication);
 const nextSupportReview=await call(donor,'/support-reviews',{storeId:nextStore,mealId:nextMeal,version:1,quantity:'1',requestId:requestId()}),nextApproval=await call(donor,'/approvals',{reviewId:nextSupportReview.id,requestId:requestId()});await send(donor,wallets.donor,'/approvals/'+nextApproval.id,nextApproval);
 const nextSupport=await call(donor,'/support-intents',{reviewId:nextSupportReview.id,requestId:requestId()});await send(donor,wallets.donor,'/intents/'+nextSupport.id,nextSupport);
 const nextClaimReview=await call(donor,'/claim-reviews',{storeId:nextStore,mealId:nextMeal,requestId:requestId()}),nextClaim=await call(donor,'/claim-intents',{reviewId:nextClaimReview.id,requestId:requestId()});await tickClaims();await awaitOperation(donor,'/claims/'+nextClaim.id,r=>r.state==='CONFIRMED');
 checks.push('cancelled recipient immediately claims a meal at another kitchen through normal HTTP eligibility');
 await provider.send('evm_increaseTime',[181]);await provider.send('anvil_mine',['0x4','0x1']);
 const settlementReview=await call(merchant,'/merchant/settlement-reviews',{voucherId:voucher.id,requestId:requestId()}),settlement=await call(merchant,'/merchant/settlements',{reviewId:settlementReview.id,requestId:requestId()}),balanceBefore=await token.balanceOf(wallets.merchant.address);await send(merchant,wallets.merchant,'/merchant/operations/'+settlement.id,settlement);if(await token.balanceOf(wallets.merchant.address)!==balanceBefore+7000000n)throw safeError('ACCEPTANCE_SETTLEMENT_AMOUNT_MISMATCH');
 const accounting=await escrow.accounting();if(await token.balanceOf(await escrow.getAddress())!==accounting.liability)throw safeError('ACCEPTANCE_LIABILITY_MISMATCH');checks.push('exclusive handler, real handover, chain 180-second wait, one settlement and liability conservation');
 return {result:'PASS',scope:'real HTTP + PostgreSQL 17 + Anvil 31337; synthetic wallets and local test assets only',checks,storeId,mealId};
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const [command='start',...args]=process.argv.slice(2);let stack;const abort=new AbortController();
 const stop=async()=>{abort.abort();try{await stack?.stop();process.exitCode=0;}catch{process.exitCode=1;}};
 process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop());
 try{if(!['start','verify','seed'].includes(command)||args.length>2||args.length&&args[0]!=='--workdir'||args.length===1)throw safeError('USAGE_START_VERIFY_OR_SEED_WITH_OPTIONAL_WORKDIR');stack=await startAcceptanceStack({workdir:args[1],signal:abort.signal});console.log(JSON.stringify(stack.public,null,2));if(command==='seed')console.log(JSON.stringify(await stack.seed(),null,2));if(command==='verify'){console.log(JSON.stringify(await stack.verify(),null,2));await stop();}}
 catch(error){await stop();console.error('Local acceptance failed:',error.code||'ACCEPTANCE_FAILED');process.exitCode=1;}
}
