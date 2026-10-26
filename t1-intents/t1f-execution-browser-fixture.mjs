/** Loopback-only synthetic browser fixture. Never imported or served by production. */
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {fixture,HEX,ROUND} from './t1f-approval-test-fixture.mjs';
import {buildSuccessorReleaseManifest} from './t1f-successor-dual-approval.mjs';
import {APPROVAL_WALLETS} from './t1f-approval-protocol.mjs';
import {CONSUMPTION_VERSION} from './t1f-execution-contract.mjs';
import {makeExecutionService} from './t1f-execution-service.mjs';
import {executionRpcFixture} from './t1f-execution-test-fixture.mjs';
import {makeT1EClaimGateway} from './t1e-claim-http.mjs';
import {syntheticAuth,TOKEN,CSRF} from './t1f-execution-http-fixture.mjs';
import {MEAL,TERMS} from './core.mjs';
import {PILOT_RECIPIENT} from './t1e-claim-store.mjs';
import {makeChallenge} from './auth/siwe.mjs';
export async function browserFixture({port=0}={}){
 const f=fixture(),now=Math.floor(Date.now()/1000);f.chain.observedBlockTime=now-10;Object.assign(f.context.claim,{meal_id:MEAL,terms_hash:TERMS,beneficiary_wallet:PILOT_RECIPIENT,consent_nonce:HEX('1'),consent_deadline:String(now+600)});
 const manifest=buildSuccessorReleaseManifest({...f.context,chain:f.chain,walletObservation:f.context.review.wallet_observation,nonceDomain:HEX('5'),candidateOperationId:HEX('6'),candidateNonce:0,candidateDeadline:now+480,approvalExpiresAt:now+300,now});
 Object.assign(f.row,{value:manifest.value,digest:manifest.digest,created_at_epoch:now,observed_block_time:now-10,candidate_calldata_hash:manifest.candidateCalldataHash,approvals:Object.entries(APPROVAL_WALLETS).map(([role,wallet])=>({role,wallet,fingerprint:HEX('a')}))});
 const envelope={context:f.context,round:f.row,operation:null,consumption:null};const fake=await executionRpcFixture({row:f.row,now});let transaction=null,delay=0,bindFail=false;
 const store={context:async()=>structuredClone(envelope),get:async()=>structuredClone(envelope),async consume({beforeExecute}){beforeExecute?.();if(envelope.operation)return {created:false,...structuredClone(envelope)};
 envelope.operation={successor_id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',claim_id:f.context.claim.claim_id,slot_id:f.context.slot.attempt_id,release_id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',operation_id:f.row.value.newOpId,issuer_nonce:'0',issuer_issue_deadline:f.row.value.newDeadline,calldata_hash:f.row.candidate_calldata_hash,issuer_wallet:f.context.claim.issuer_wallet,escrow:f.context.claim.escrow,stage:'ISSUE_UNKNOWN',revision:0,tx_hash:null};
 envelope.consumption={consumption_id:'ffffffff-ffff-4fff-8fff-ffffffffffff',version:CONSUMPTION_VERSION,round_id:ROUND,digest:f.row.digest,claim_id:f.context.claim.claim_id,slot_id:f.context.slot.attempt_id,release_id:envelope.operation.release_id,successor_id:envelope.operation.successor_id,consumed_at_epoch:now,no_release:true,can_issue:false,may_broadcast_by_server:false,approved_for_settlement:false};return {created:true,operation:structuredClone(envelope.operation),consumption:structuredClone(envelope.consumption)};},async bind({beforeExecute,...args}){beforeExecute?.();Object.assign(envelope.operation,{tx_hash:args.evidence.txHash,stage:'ISSUE_HASH_BOUND',revision:1});return structuredClone(envelope.operation)},async reconcile({beforeExecute}){beforeExecute?.();Object.assign(envelope.operation,{stage:'ISSUED',revision:2,receipt_block:'73688855',receipt_block_hash:HEX('7')});return structuredClone(envelope.operation)}};
 const base=makeExecutionService({store,rpc:fake.rpc});
 const service={status:()=>base.status(),async prepare(...args){if(delay)await new Promise(r=>setTimeout(r,delay));const s=await base.prepare(...args);if(s.transaction)transaction=s.transaction;return s},async bind(...args){if(bindFail)throw Error('SYNTHETIC_BIND_UNCERTAINTY');return base.bind(...args)},reconcile:(...args)=>base.reconcile(...args)};
 let origin,app;
 const json=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data))};
 const server=createServer(async(req,res)=>{try{
 const path=new URL(req.url,origin).pathname;
 if(req.headers.host!==new URL(origin).host)return json(res,403,{});
 if(path==='/fixture/control'&&req.method==='POST'){if(req.headers.origin!==origin)return json(res,403,{});let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw);if(body.mode==='sent'){if(!transaction)throw Error();fake.bind(transaction,HEX('9'));}else if(body.mode==='canonical')fake.setMode('canonical');else if(body.mode==='bind-fail')bindFail=true;else if(body.mode==='bind-ok')bindFail=false;else if(body.mode==='delay')delay=1200;else if(body.mode==='fast')delay=0;return json(res,200,{ok:true});}
 if(path==='/v1/auth/pre-session')return json(res,200,{csrf:CSRF});
 if(path==='/v1/identity/wallet/challenge')return json(res,200,makeChallenge({wallet:f.context.claim.issuer_wallet,origin,chainId:10143,nonce:'a'.repeat(64),challengeId:ROUND,issuedAt:Math.floor(Date.now()/1000),expiresAt:Math.floor(Date.now()/1000)+180}));
 if(path==='/v1/identity/wallet/login'){res.setHeader('set-cookie','fixture_session=synthetic; HttpOnly; SameSite=Strict; Path=/');return json(res,200,{csrf:CSRF,authPilot:true});}
 const files={'/t1f-execution.css':'t1f-execution.css','/':'t1f-execution.html','/t1f-execution.html':'t1f-execution.html','/t1f-execution-controller.mjs':'t1f-execution-controller.mjs','/t1f-execution-page.mjs':'t1f-execution-page.mjs','/t1f-execution-crypto.mjs':'t1f-execution-crypto.mjs','/fixture-provider.mjs':'../t1f-execution-browser-provider.mjs'};
 if(files[path]&&req.method==='GET'){let text=await readFile(new URL('./public/'+files[path],import.meta.url),'utf8');if(path==='/t1f-execution-page.mjs'){text="if(!globalThis.ethereum?.syntheticMealforwardFixture)throw Error('SYNTHETIC_PROVIDER_REQUIRED');\n"+text.split('\n').filter(line=>!line.startsWith("addEventListener('eip6963:announceProvider'")&&!line.startsWith("dispatchEvent(new Event('eip6963:requestProvider'")).join('\n');}if(path==='/'||path.endsWith('.html'))text=text.replace('<script type="module"',`<aside><b>SYNTHETIC LOOPBACK FIXTURE · no real wallet, database or chain</b><p>Wallet controls: <button onclick="fixtureMode='reject'">Reject next send</button><button onclick="fixtureMode='ok'">Accept fake send</button><button onclick="fixtureSwitch()">Switch account</button><button onclick="location.reload()">Reload</button><button onclick="fixtureControl('bind-fail')">Fail bind</button><button onclick="fixtureControl('bind-ok')">Allow bind</button><button onclick="fixtureControl('canonical')">Canonical receipt</button><button onclick="fixtureControl('delay')">Delay service</button></p>Restart fixture for a fresh scenario.</aside><script type="module" src="/fixture-provider.mjs"></script><script type="module"`);res.writeHead(200,{'content-type':path==='/'||path.endsWith('.html')?'text/html':path.endsWith('.css')?'text/css':'text/javascript','cache-control':'no-store'});return res.end(text);}
 if(req.headers.cookie?.includes('fixture_session=synthetic'))req.headers.cookie='__Host-mcpay_c1_session='+TOKEN;
 return app(req,res);
 }catch{if(!res.writableEnded)json(res,503,{error:'FIXTURE_UNAVAILABLE'})}});
 await new Promise(r=>server.listen(port,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 app=makeT1EClaimGateway({origin,stage:'CLAIM_CONSENT',authStore:syntheticAuth,claimStore:{},readiness:async()=>{},loginHandler:()=>{},successorEnabled:true,executionService:service});
 return {origin,server,close:()=>new Promise(r=>server.close(r))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const f=await browserFixture({port:Number(process.env.FIXTURE_PORT||15449)});console.log('SYNTHETIC ONLY '+f.origin);for(const s of ['SIGINT','SIGTERM'])process.once(s,()=>f.close().then(()=>process.exit(0)));}
