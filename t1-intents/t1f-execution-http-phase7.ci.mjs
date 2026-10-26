import {publicApproval} from './t1f-approval-protocol.mjs';
/** Standalone exact009–017 fresh PG17 + actual HTTP + synthetic read-only RPC. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import pg from 'pg';
import {seedApprovalFixture} from './t1f-approval-fixture.mjs';
import {executionCapabilityPool,verifyExecutionRuntime,makeExecutionStore} from './t1f-execution-store.mjs';
import {makeApprovalStore} from './t1f-approval-store.mjs';
import {makeExecutionService} from './t1f-execution-service.mjs';
import {buildSuccessorReleaseManifest} from './t1f-successor-dual-approval.mjs';
import {APPROVAL_WALLETS} from './t1f-approval-protocol.mjs';
import {executionRpcFixture} from './t1f-execution-test-fixture.mjs';
import {httpFixture,RECIPIENT} from './t1f-execution-http-fixture.mjs';
import {fixture,HEX} from './t1f-approval-test-fixture.mjs';
assert.equal(process.env.MF_T1F_PHASE6_DISPOSABLE_ONLY,'ack-fresh-phase6-pg17');
assert.equal(process.env.MF_T1F_EXECUTION_HTTP_DISPOSABLE_ONLY,'ack-fresh-execution-http-pg17');
for(const [k,v] of Object.entries({PGHOST:'127.0.0.1',PGPORT:'15439',PGDATABASE:'postgres',PGUSER:'postgres'}))assert.equal(process.env[k],v);
assert.equal(process.env.DATABASE_URL,undefined);
const cfg={host:'127.0.0.1',port:15439,database:'postgres',user:'postgres',connectionTimeoutMillis:3000,statement_timeout:5000};
const admin=new pg.Client(cfg);let executionPool,approvalPool,http,count=0;
const pass=x=>{count++;console.log('PASS '+x)},hex=()=>'0x'+randomBytes(32).toString('hex');
try{
 await admin.connect();await seedApprovalFixture(admin);
 await admin.query(await readFile(new URL('./supabase/016_t1f_recovery_approval_collection.sql',import.meta.url),'utf8'));
 await admin.query(await readFile(new URL('./supabase/migrations/20261026201810_t1f_controlled_successor_execution.sql',import.meta.url),'utf8'));
 await admin.query('CREATE ROLE mf_t1f_approval_login LOGIN NOINHERIT; GRANT mf_t1f_approval_runtime TO mf_t1f_approval_login; CREATE ROLE mf_t1f_execution_login LOGIN NOINHERIT; GRANT mf_t1f_execution_runtime TO mf_t1f_execution_login');
 approvalPool=new pg.Pool({...cfg,user:'mf_t1f_approval_login',options:'-c role=mf_t1f_approval_runtime'});
 executionPool=executionCapabilityPool(new pg.Pool({...cfg,user:'mf_t1f_execution_login',max:8}));await verifyExecutionRuntime(executionPool);
 const a=makeApprovalStore({pool:approvalPool}),store=makeExecutionStore({pool:executionPool}),context=await a.context(),now=Math.floor(Date.now()/1000),roundId=randomUUID();
 const f=fixture(),chain={...f.chain,observedBlockNumber:'73688845',observedBlockHash:HEX('4'),observedBlockTime:now-10};
 const manifest=buildSuccessorReleaseManifest({...context,chain,walletObservation:context.review.wallet_observation,nonceDomain:hex(),candidateOperationId:hex(),candidateNonce:0,candidateDeadline:now+480,approvalExpiresAt:now+300,now});
 await a.create({roundId,manifest,createdAt:now,observedBlockTime:now-10});
 for(const [role,wallet] of Object.entries(APPROVAL_WALLETS))await a.record({roundId,digest:manifest.digest,role,wallet,fingerprint:hex()});
 const row=await a.get(roundId),fake=await executionRpcFixture({row,now}),service=makeExecutionService({store,rpc:fake.rpc});
 const fingerprint=async()=>(await admin.query(`SELECT jsonb_build_object('claims',(SELECT jsonb_agg(to_jsonb(t)) FROM mf_t1e.recipient_claims t),'consents',(SELECT jsonb_agg(to_jsonb(t)) FROM mf_t1e.consent_rounds t),'funds',(SELECT jsonb_agg(to_jsonb(t)) FROM mf_t1c.intents t),'events',(SELECT jsonb_agg(to_jsonb(t)) FROM mf_t1e.claim_events t),'reviews',(SELECT jsonb_agg(to_jsonb(t)) FROM mf_t1e.expired_issue_reviews t),'slots',(SELECT jsonb_agg(to_jsonb(t)) FROM mf_t1e.issuer_issue_attempts t)) v`)).rows[0].v;
 const before=await fingerprint(),counts=async()=>(await admin.query('SELECT (SELECT count(*)::int FROM mf_t1f_execution.consumptions) c,(SELECT count(*)::int FROM mf_t1e.successor_issue_releases) r,(SELECT count(*)::int FROM mf_t1e.successor_issue_operations) o,(SELECT count(*)::int FROM mf_t1e.successor_issue_events) e')).rows[0];
 http=await httpFixture({service});const prepare={roundId,digest:manifest.digest};
 for(const args of [{token:''},{token:RECIPIENT},{csrf:''},{headers:{origin:'https://evil.invalid'}},{headers:{'x-wallet-address':context.claim.issuer_wallet}}])assert.ok((await http.request('prepare',{body:prepare,...args})).status>=400);
 for(const body of [{...prepare,issuer:context.claim.issuer_wallet},{...prepare,digest:hex()},{...prepare,evidence:{simulationPassed:true}}])assert.ok((await http.request('prepare',{body})).status>=400);
 assert.deepEqual(await counts(),{c:0,r:0,o:0,e:0});pass('RED unauthorized, CSRF, origin, spoofed body and digest yield zero writes through actualHTTP');
 // Cancellation after actual connection acquisition/SET ROLE cannot issue mutation.
 const ac=new AbortController();const cancelled=makeExecutionService({store:{...store,get:async id=>{const e=await store.get(id);ac.abort();return e}},rpc:fake.rpc});
 await assert.rejects(()=>cancelled.prepare(prepare,{signal:ac.signal}));assert.deepEqual(await counts(),{c:0,r:0,o:0,e:0});pass('cancelled service after awaitedPG read cannot write');
 const results=await Promise.all(Array.from({length:4},()=>http.request('prepare',{body:prepare})));
 assert.ok(results.every(r=>[200,201].includes(r.status)),JSON.stringify(results.map(r=>({status:r.status,error:r.body.error}))));
 assert.equal(results.filter(r=>r.body.created).length,1);const first=results.find(r=>r.body.created).body;
 assert.ok(first.transaction);assert.deepEqual(await counts(),{c:1,r:1,o:1,e:1});
 assert.ok(results.filter(r=>!r.body.created).every(r=>!r.body.transaction));pass('GREEN concurrent actualHTTP prepares commit exactly one consumption/release/operation and bytes response');
 for(const result of [await http.request('status'),await http.request('prepare',{body:prepare})]){assert.equal(result.status,200);assert.equal(result.body.transaction,undefined);assert.equal(result.cache,'no-store')}
 const restarted=makeExecutionService({store,rpc:{send(){throw Error('RECOVERY_MUST_NOT_FETCH')}},clock:()=>now+1000});assert.equal((await restarted.prepare(prepare)).transaction,undefined);assert.equal((await restarted.status()).operation.id,first.operation.id);pass('status/replay/restart/expired approval are recovery-only beforeRPC');
 const txHash=hex();fake.bind(first.transaction,txHash);
 const bind={roundId,successorId:first.operation.id,revision:0,txHash};
 for(const [key,value] of Object.entries({hash:hex(),from:APPROVAL_WALLETS.owner,to:APPROVAL_WALLETS.donor,chainId:'0x1',nonce:'0x1',value:'0x1',input:'0x1234'})){
  const original=fake.tx[key];fake.tx[key]=value;assert.equal((await http.request('bind',{body:bind})).status,409,key);assert.equal((await store.context()).operation.tx_hash,null);fake.tx[key]=original;
 }
 let result=await http.request('bind',{body:bind});assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.operation.stage,'ISSUE_HASH_BOUND');pass('bound hash independently matches chain/from/to/nonce/value/calldata beforeCAS');
 await http.close();http=await httpFixture({service});
 const reconcile={roundId,successorId:first.operation.id,revision:1};
 result=await http.request('reconcile',{body:reconcile});assert.equal(result.status,200);assert.equal(result.body.operation.stage,'ISSUE_HASH_BOUND');assert.equal(result.body.receiptStatus,'PENDING_NO_REBROADCAST');
 fake.setMode('reverted');result=await http.request('reconcile',{body:reconcile});assert.equal(result.body.operation.stage,'ISSUE_HASH_BOUND');assert.equal(result.body.receiptStatus,'REVERTED_NO_AUTORETRY');
 for(const mode of ['wrongEvents','noncanonical','operationMismatch','accountingMismatch']){fake.setMode(mode);assert.equal((await http.request('reconcile',{body:reconcile})).status,503,mode);assert.equal((await store.context()).operation.stage,'ISSUE_HASH_BOUND')}pass('pending/reverted/noncanonical/wrong events/operation/accounting never mark issued or resend');
 fake.setMode('issued');result=await http.request('reconcile',{body:reconcile});assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.operation.stage,'ISSUED');assert.equal(result.body.transaction,undefined);assert.deepEqual(await counts(),{c:1,r:1,o:1,e:3});pass('canonical receipt, unique events, operation, voucher and accounting mark successorISSUED only');
 assert.deepEqual(await fingerprint(),before);assert.equal((await a.get(roundId)).consumption.successor_id,first.operation.id);const collectorDto=publicApproval({row:await a.current(),context:await a.context(),now:Math.floor(Date.now()/1000)});assert.equal(collectorDto.status,'CONSUMED_NO_RELEASE');assert.equal(collectorDto.canIssue,false);assert.equal(collectorDto.noRelease,true);pass('all original Claim/Consent/Fund/events/review/slot fingerprints unchanged; collector reads survive');
 console.log(JSON.stringify({status:'T1F_PHASE7_EXECUTION_HTTP_PG17_PASS',tests:count,actualHttp:true,exactMigrations:'009-017',liveDatabaseUsed:false,realSignatures:0,transactions:0}));
}finally{await http?.close();await approvalPool?.end();await executionPool?.end();await admin.end().catch(()=>{});}
