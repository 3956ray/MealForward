/** Exact 009–017, new disposable PostgreSQL17 only. Synthetic attestations, zero RPC/wallet. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import pg from 'pg';
import {seedApprovalFixture} from './t1f-approval-fixture.mjs';
import {makeApprovalStore} from './t1f-approval-store.mjs';
import {executionCapabilityPool,verifyExecutionRuntime,makeExecutionStore} from './t1f-execution-store.mjs';
import {validateConsumption,OBSERVATION_VERSION,BIND_VERSION,RECONCILE_VERSION} from './t1f-execution-contract.mjs';
import {buildSuccessorReleaseManifest,T1F_RELEASE_OWNER,T1F_RELEASE_DONOR} from './t1f-successor-dual-approval.mjs';
import {CHAIN,ESCROW} from './core.mjs';
import {FIXED} from './t1e-first-issue-readiness.mjs';
import {ORIGINAL_OPERATION} from './t1f-successor-issue-protocol.mjs';
import {verifyApprovalRuntime} from './t1f-approval-server.mjs';
assert.equal(process.env.MF_T1F_PHASE6_DISPOSABLE_ONLY,'ack-fresh-phase6-pg17');
for(const [key,value] of Object.entries({PGHOST:'127.0.0.1',PGPORT:'15439',PGDATABASE:'postgres',PGUSER:'postgres'}))assert.equal(process.env[key],value);
assert.equal(process.env.DATABASE_URL,undefined);
const config={host:'127.0.0.1',port:15439,database:'postgres',user:'postgres',connectionTimeoutMillis:3000,statement_timeout:5000};
const admin=new pg.Client(config);let approvalPool,executionPool,count=0;
const passed=label=>{count++;console.log('PASS '+label)};
const reject=task=>assert.rejects(task,e=>e?.code==='P0001');
const hex=()=> '0x'+randomBytes(32).toString('hex');
const now=()=>Math.floor(Date.now()/1000);
try{
 await admin.connect(); await seedApprovalFixture(admin);
 // Hosted-equivalent existing-object owner: CREATEROLE, not superuser; empty self-grant.
 await admin.query('CREATE ROLE mf_phase7_migrator LOGIN NOINHERIT NOSUPERUSER CREATEROLE NOBYPASSRLS; GRANT CREATE ON DATABASE postgres TO mf_phase7_migrator');
 await admin.query(`DO $$ DECLARE x record; BEGIN
 FOR x IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('mf_t1e','mf_t1c') AND c.relkind IN ('r','p') LOOP
 EXECUTE format('ALTER TABLE %I.%I OWNER TO mf_phase7_migrator',x.nspname,x.relname); END LOOP;
 FOR x IN SELECT p.oid::regprocedure f FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('mf_t1e','mf_t1c') LOOP
 EXECUTE format('ALTER FUNCTION %s OWNER TO mf_phase7_migrator',x.f); END LOOP;
 END $$; ALTER SCHEMA mf_t1e OWNER TO mf_phase7_migrator; ALTER SCHEMA mf_t1c OWNER TO mf_phase7_migrator`);
 const migrator=new pg.Client({...config,user:'mf_phase7_migrator'});await migrator.connect();
 await migrator.query("SET createrole_self_grant=''");
 await migrator.query(await readFile(new URL('./supabase/016_t1f_recovery_approval_collection.sql',import.meta.url),'utf8'));
 await assert.rejects(()=>admin.query('SELECT mf_t1f_execution.execution_context()'),e=>e?.code==='3F000');
 passed('RED missing execution function/schema before017');
 const original=async()=> (await admin.query(`SELECT jsonb_build_object(
 'claims',(SELECT jsonb_agg(to_jsonb(t)) FROM mf_t1e.recipient_claims t),
 'consents',(SELECT jsonb_agg(to_jsonb(t)) FROM mf_t1e.consent_rounds t),
 'funds',(SELECT jsonb_agg(to_jsonb(t)) FROM mf_t1c.intents t),
 'events',(SELECT jsonb_agg(to_jsonb(t)) FROM mf_t1e.claim_events t),
 'reviews',(SELECT jsonb_agg(to_jsonb(t)) FROM mf_t1e.expired_issue_reviews t),
 'slots',(SELECT jsonb_agg(to_jsonb(t)) FROM mf_t1e.issuer_issue_attempts t)) v`)).rows[0].v;
 const before=await original();
 try{await migrator.query(await readFile(new URL('./supabase/migrations/20261026201810_t1f_controlled_successor_execution.sql',import.meta.url),'utf8'));
 await assert.rejects(()=>migrator.query('SET ROLE mf_t1f_execution_owner'),x=>x.code==='42501');
 await assert.rejects(()=>migrator.query('SET ROLE mf_t1f_approval_owner'),x=>x.code==='42501');
 const memberships=(await admin.query(`SELECT parent.rolname,m.inherit_option,m.set_option FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid WHERE m.member=(SELECT oid FROM pg_roles WHERE rolname='mf_phase7_migrator')`)).rows;
 assert.equal(memberships.length,4);assert.ok(memberships.every(m=>!m.inherit_option&&!m.set_option));
 passed('exact016/017 non-superuser migration owner and temporary owner membership teardown');
 }finally{await migrator.end();}
 await admin.query('CREATE ROLE mf_t1f_approval_login LOGIN NOINHERIT; GRANT mf_t1f_approval_runtime TO mf_t1f_approval_login; CREATE ROLE mf_t1f_execution_login LOGIN NOINHERIT; GRANT mf_t1f_execution_runtime TO mf_t1f_execution_login');
 approvalPool=new pg.Pool({...config,user:'mf_t1f_approval_login',options:'-c role=mf_t1f_approval_runtime',max:8});
 executionPool=executionCapabilityPool(new pg.Pool({...config,user:'mf_t1f_execution_login',max:8}));
 await verifyExecutionRuntime(executionPool);
 const a=makeApprovalStore({pool:approvalPool}),e=makeExecutionStore({pool:executionPool});
 await verifyApprovalRuntime(approvalPool); const context=await a.context();
 assert.equal((await e.context()).operation,null);passed('GREEN017 execution/collector reads and unchanged collector capability audit');
 const proposal=(time=now())=>{
 const chain={chainId:CHAIN,escrow:ESCROW,issuer:FIXED.issuerAuthority,originalOperationId:ORIGINAL_OPERATION,
 originalOperationSeen:false,reservedOriginalNonce:'0',originalImmutableDeadline:'1792765625',issuerTransactionHashFound:false,
 userWalletActivityMustBeChecked:true,unitAvailable:true,unitIssued:false,canIssueOrResetAutomatically:false,
 noPendingTxProven:false,issuerLatestNonce:'0',issuerPendingNonce:'0',observedBlockNumber:'73645549',observedBlockHash:hex(),observedBlockTime:time,
 originalDeadlineExpired:true,originalTransactionHash:null,status:'T1F_EXPIRED_NO_ISSUE_OBSERVED_NOT_ABSENCE_PROOF'};
 return {roundId:randomUUID(),createdAt:time,observedBlockTime:time,manifest:buildSuccessorReleaseManifest({...context,chain,
 walletObservation:'OWNER_REPORTED_NO_TRANSACTIONS_VISIBLE',nonceDomain:hex(),candidateOperationId:hex(),candidateNonce:0,
 candidateDeadline:time+480,approvalExpiresAt:time+300,now:time})};};
 const p=proposal(); await a.create(p);
 const observation={version:OBSERVATION_VERSION,roundId:p.roundId,digest:p.manifest.digest,
 signedBlockNumber:p.manifest.value.observedBlockNumber,signedBlockHash:p.manifest.value.observedBlockHash,
 observedBlockNumber:'73645550',observedBlockHash:hex(),observedAt:String(now()),issuerLatestNonce:'0',issuerPendingNonce:'0',
 calldataHash:p.manifest.candidateCalldataHash,historicalAnchorCanonical:true,freshAnchorCanonical:true,originalOperationSeen:false,
 unitAvailable:true,unitIssued:false,codeAndAuthorityValid:true,accountingValid:true,simulationPassed:true};
 const input={roundId:p.roundId,digest:p.manifest.digest,evidence:observation};
 const state=async()=> (await admin.query(`SELECT jsonb_build_object('c',(SELECT count(*) FROM mf_t1f_execution.consumptions),
 'r',(SELECT count(*) FROM mf_t1e.successor_issue_releases),'o',(SELECT count(*) FROM mf_t1e.successor_issue_operations),
 'e',(SELECT count(*) FROM mf_t1e.successor_issue_events)) v`)).rows[0].v;
 const zero={c:0,r:0,o:0,e:0};
 // Transactional synthetic corruption cannot escape its rolled-back transaction.
 const asExecution=async(sql,args=[])=>{await admin.query('SET LOCAL ROLE mf_t1f_execution_runtime');return admin.query(sql,args)};
 await admin.query('BEGIN');try{
 await admin.query("UPDATE mf_t1e.recipient_claims SET stage='ISSUE_HASH_BOUND',revision=revision+1,issuer_tx_hash=$1",[hex()]);
 await reject(()=>asExecution('SELECT mf_t1f_execution.consume_round_and_reserve($1,$2,$3)',[p.roundId,p.manifest.digest,observation]));
 }finally{await admin.query('ROLLBACK');}
 await admin.query('BEGIN');try{
 await admin.query(`INSERT INTO mf_t1f_execution.consumptions(consumption_id,round_id,digest,claim_id,slot_id,release_id,successor_id,consumed_at_epoch) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[randomUUID(),p.roundId,p.manifest.digest,context.claim.claim_id,context.slot.attempt_id,randomUUID(),randomUUID(),now()]);
 await admin.query('SET LOCAL ROLE mf_t1f_approval_runtime');await reject(()=>admin.query('SELECT mf_t1f_recovery.context()'));
 }finally{await admin.query('ROLLBACK');}
 const expired=proposal(now()-400);
 await admin.query(`INSERT INTO mf_t1f_recovery.approval_rounds(round_id,value,digest,created_at_epoch,observed_block_time,candidate_calldata_hash) VALUES($1,$2,$3,$4,$4,$5)`,[expired.roundId,expired.manifest.value,expired.manifest.digest,expired.createdAt,expired.manifest.candidateCalldataHash]);
 await reject(()=>e.consume({roundId:expired.roundId,digest:expired.manifest.digest,evidence:{...observation,roundId:expired.roundId,digest:expired.manifest.digest}}));
 for(const [role,wallet] of [['owner',T1F_RELEASE_OWNER],['donor',T1F_RELEASE_DONOR]])await admin.query(`INSERT INTO mf_t1f_recovery.role_approvals(round_id,role,wallet,digest,fingerprint,verified_at_epoch) VALUES($1,$2,$3,$4,$5,$6)`,[expired.roundId,role,wallet,expired.manifest.digest,hex(),expired.createdAt+1]);
 await reject(()=>e.consume({roundId:expired.roundId,digest:expired.manifest.digest,evidence:{...observation,roundId:expired.roundId,digest:expired.manifest.digest,signedBlockHash:expired.manifest.value.observedBlockHash,calldataHash:expired.manifest.candidateCalldataHash}}));
 const near=proposal(now()-211);
 await admin.query(`INSERT INTO mf_t1f_recovery.approval_rounds(round_id,value,digest,created_at_epoch,observed_block_time,candidate_calldata_hash) VALUES($1,$2,$3,$4,$4,$5)`,[near.roundId,near.manifest.value,near.manifest.digest,near.createdAt,near.manifest.candidateCalldataHash]);
 for(const [role,wallet] of [['owner',T1F_RELEASE_OWNER],['donor',T1F_RELEASE_DONOR]])await admin.query(`INSERT INTO mf_t1f_recovery.role_approvals(round_id,role,wallet,digest,fingerprint,verified_at_epoch) VALUES($1,$2,$3,$4,$5,$6)`,[near.roundId,role,wallet,near.manifest.digest,hex(),near.createdAt+1]);
 await reject(()=>e.consume({roundId:near.roundId,digest:near.manifest.digest,evidence:{...observation,roundId:near.roundId,digest:near.manifest.digest,signedBlockHash:near.manifest.value.observedBlockHash,calldataHash:near.manifest.candidateCalldataHash}}));
 assert.deepEqual(await state(),zero);

 await assert.rejects(()=>admin.query(`INSERT INTO mf_t1f_recovery.role_approvals(round_id,role,wallet,digest,fingerprint,verified_at_epoch,verification_version) VALUES($1,'owner',$2,$3,$4,$5,'UNREVIEWED')`,[expired.roundId,T1F_RELEASE_OWNER,expired.manifest.digest,hex(),expired.createdAt+5]),x=>x.code==='23514');
 passed('changed original, orphan receipt, dual-approved expiry and below90s margin and unreviewed verification version fail closed');
 let beforeExecuteCalled=false;
 await assert.rejects(()=>e.consume({...input,beforeExecute:()=>{beforeExecuteCalled=true;throw Error('ABORTED')}}),/ABORTED/);
 assert.equal(beforeExecuteCalled,true);assert.deepEqual(await state(),zero);
 const setup=[];const guarded=executionCapabilityPool({connect:async()=>({query:async sql=>{setup.push(sql);return {rows:[],rowCount:0}},release:()=>setup.push('release')})});
 await assert.rejects(()=>guarded.query('MUTATION',[],{beforeExecute:()=>{assert.match(setup[0],/SET ROLE/);throw Error('STOP')}}),/STOP/);
 assert.equal(setup.includes('MUTATION'),false);
 await assert.rejects(()=>makeExecutionStore({pool:{query:async()=>{throw Error('RAW_QUERY')}}}).consume({...input,beforeExecute:()=>{}}),/GUARDED_POOL_REQUIRED/);
 passed('guard runs after capability setup and before SQL; cancellation and unguarded raw pool cause zero writes');

 await reject(()=>e.consume(input)); assert.deepEqual(await state(),zero);passed('missing dual roles rejects atomically');
 for(const [role,wallet] of [['owner',T1F_RELEASE_OWNER],['donor',T1F_RELEASE_DONOR]])await a.record({roundId:p.roundId,digest:p.manifest.digest,role,wallet,fingerprint:hex()});
 for(const change of [{historicalAnchorCanonical:false},{freshAnchorCanonical:false},{observedAt:String(now()-121)},
 {issuerLatestNonce:'1'},{issuerPendingNonce:'1'},{originalOperationSeen:true},{unitAvailable:false},{unitIssued:true},
 {codeAndAuthorityValid:false},{accountingValid:false},{simulationPassed:false},{calldataHash:hex()},{signedBlockHash:hex()},
 {signedBlockNumber:'73645548'},{observedBlockNumber:'73645548'}]){
 await reject(()=>e.consume({...input,evidence:{...observation,...change}}));assert.deepEqual(await state(),zero);
 }
 await reject(()=>e.consume({...input,digest:hex()}));
 await reject(()=>executionPool.query('SELECT mf_t1f_execution.consume_round_and_reserve($1,$2,$3)',[p.roundId,p.manifest.digest,{...observation,extra:true}]));
 passed('wrong digest, signed/fresh reorg, stale observation, nonce, authority, unit, accounting, simulation and exact shape deny zero writes');
 // Audit errors must roll back receipt, release and operation together.
 await admin.query(`CREATE FUNCTION mf_t1e.fixture_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'FIXTURE_AUDIT_FAILURE'; END $$;
 CREATE TRIGGER fixture_reject BEFORE INSERT ON mf_t1e.successor_issue_events FOR EACH ROW EXECUTE FUNCTION mf_t1e.fixture_reject()`);
 try{await reject(()=>e.consume(input));assert.deepEqual(await state(),zero);}
 finally{await admin.query('DROP TRIGGER fixture_reject ON mf_t1e.successor_issue_events; DROP FUNCTION mf_t1e.fixture_reject()');}
 passed('audit failure rolls back entire consume transaction');
 // Both protected capabilities must wait on the same advisory lock.
 await admin.query('BEGIN');await admin.query('SELECT pg_advisory_xact_lock(10143,160026)');
 const racedApproval=a.record({roundId:p.roundId,digest:p.manifest.digest,role:'owner',wallet:T1F_RELEASE_OWNER,fingerprint:(await admin.query("SELECT fingerprint FROM mf_t1f_recovery.role_approvals WHERE round_id=$1 AND role='owner'",[p.roundId])).rows[0].fingerprint}).then(v=>({ok:true,v}),error=>({ok:false,error}));
 const pendingConsume=Array.from({length:6},()=>e.consume(input));
 await new Promise(resolve=>setTimeout(resolve,60));
 const waiting=(await admin.query("SELECT count(*)::int n FROM pg_stat_activity WHERE wait_event='advisory'")).rows[0].n;
 assert.ok(waiting>=2,'collector and consume are both blocked by shared advisory lock');
 await admin.query('COMMIT');
 const results=await Promise.all(pendingConsume);const approvalRace=await racedApproval;
 assert.ok(approvalRace.ok||approvalRace.error.code==='P0001');
 assert.equal(results.filter(r=>r.created).length,1);assert.deepEqual(await state(),{c:1,r:1,o:1,e:1});
 const result=results.find(r=>r.created),o=result.operation;
 validateConsumption(result.consumption,{round:await a.get(p.roundId),context,operation:o});
 assert.deepEqual((await e.consume({roundId:randomUUID(),digest:hex(),evidence:null})).operation,o);
 assert.equal((await e.consume(input)).created,false);
 passed('shared collector/consume lock and concurrent race create exactly one linked receipt/release/operation/audit; recovery never createdtrue');
 await verifyApprovalRuntime(approvalPool);
 assert.equal((await a.context()).consumption.successor_id,o.successor_id);
 assert.equal((await a.current()).consumption.round_id,p.roundId);
 assert.equal((await a.get(p.roundId)).consumption.digest,p.manifest.digest);
 await reject(()=>a.create(proposal()));await reject(()=>a.record({roundId:p.roundId,digest:p.manifest.digest,role:'owner',wallet:T1F_RELEASE_OWNER,fingerprint:hex()}));
 passed('collector startup capabilities/context/current/get survive consume; both writes remain closed');
 for(const [grant,revoke] of [
 ['GRANT SELECT ON mf_t1f_execution.consumptions TO mf_t1f_execution_login','REVOKE SELECT ON mf_t1f_execution.consumptions FROM mf_t1f_execution_login'],
 ['GRANT USAGE ON SCHEMA mf_t1e TO mf_t1f_execution_runtime','REVOKE USAGE ON SCHEMA mf_t1e FROM mf_t1f_execution_runtime'],
 ['GRANT SELECT ON SEQUENCE mf_t1e.successor_issue_events_event_id_seq TO mf_t1f_execution_runtime','REVOKE SELECT ON SEQUENCE mf_t1e.successor_issue_events_event_id_seq FROM mf_t1f_execution_runtime']]){
 await admin.query(grant);try{await assert.rejects(()=>verifyExecutionRuntime(executionPool),/RUNTIME_CAPABILITY/);}finally{await admin.query(revoke);}}
 await verifyExecutionRuntime(executionPool);passed('execution catalog audit rejects login table grants, extra schema and sequence capabilities');
 // Every audit row must point to exactly the consumed successor and hash.
 await admin.query('BEGIN');try{await admin.query("INSERT INTO mf_t1e.successor_issue_events(successor_id,event_type,tx_hash) VALUES($1,'ISSUE_HASH_BOUND',$2)",[o.successor_id,hex()]);
 await admin.query('SET LOCAL ROLE mf_t1f_approval_runtime');await reject(()=>admin.query('SELECT mf_t1f_recovery.context()'));}finally{await admin.query('ROLLBACK');}
 passed('orphan or mismatched audit linkage rejects collector read');
 const hash=hex();const bind={version:BIND_VERSION,chainId:'10143',from:o.issuer_wallet,to:o.escrow,nonce:String(o.issuer_nonce),value:'0',calldataHash:o.calldata_hash,txHash:hash};
 for(const change of [{chainId:'1'},{from:T1F_RELEASE_OWNER},{to:T1F_RELEASE_DONOR},{nonce:'1'},{value:'1'},{calldataHash:hex()},{txHash:hex()}])await reject(()=>e.bind({successorId:o.successor_id,revision:0,txHash:hash,evidence:{...bind,...change}}));
 await reject(()=>e.bind({successorId:o.successor_id,revision:1,txHash:hash,evidence:bind}));
 await assert.rejects(()=>e.bind({successorId:o.successor_id,revision:0,txHash:hash,evidence:bind,beforeExecute:()=>{throw Error('ABORTED')}}),/ABORTED/);
 const bound=await e.bind({successorId:o.successor_id,revision:0,txHash:hash,evidence:bind});assert.equal(bound.stage,'ISSUE_HASH_BOUND');
 await reject(()=>e.bind({successorId:o.successor_id,revision:0,txHash:hash,evidence:bind}));
 passed('bind exact transaction identity, immutable hash and revision CAS');
 const receipt={version:RECONCILE_VERSION,txHash:hash,blockNumber:'73645551',blockHash:hex(),canonical:true,receiptSucceeded:true,expectedEventsValid:true,operationValid:true,accountingValid:true};
 for(const key of ['canonical','receiptSucceeded','expectedEventsValid','operationValid','accountingValid'])await reject(()=>e.reconcile({successorId:o.successor_id,revision:1,evidence:{...receipt,[key]:false}}));
 await reject(()=>e.reconcile({successorId:o.successor_id,revision:0,evidence:receipt}));
 await assert.rejects(()=>e.reconcile({successorId:o.successor_id,revision:1,evidence:receipt,beforeExecute:()=>{throw Error('ABORTED')}}),/ABORTED/);
 const issued=await e.reconcile({successorId:o.successor_id,revision:1,evidence:receipt});assert.equal(issued.stage,'ISSUED');
 assert.equal((await e.context()).operation.revision,2);
 await reject(()=>e.reconcile({successorId:o.successor_id,revision:1,evidence:receipt}));
 await verifyApprovalRuntime(approvalPool);passed('reconcile canonical receipt, events/operation/accounting and CAS; collector still readable');
 for(const role of ['anon','authenticated','service_role','mf_t1e_auth_runtime','mf_t1e_claim_runtime','mf_t1f_approval_runtime','mf_t1f_execution_runtime']){
 await admin.query('BEGIN');try{await admin.query('SET LOCAL ROLE '+role);await admin.query('SAVEPOINT denied');
 await assert.rejects(()=>admin.query('SELECT * FROM mf_t1f_execution.consumptions'),e=>e.code==='42501');await admin.query('ROLLBACK TO SAVEPOINT denied');
 await assert.rejects(()=>admin.query('INSERT INTO mf_t1e.successor_issue_events(successor_id,event_type) VALUES($1,\'ISSUE_RESERVED\')',[o.successor_id]),e=>e.code==='42501');await admin.query('ROLLBACK TO SAVEPOINT denied');
 if(role!=='mf_t1f_execution_runtime')await assert.rejects(()=>admin.query('SELECT mf_t1f_execution.execution_context()'),e=>e.code==='42501');await admin.query('ROLLBACK TO SAVEPOINT denied');
 }finally{await admin.query('ROLLBACK');}}
 const acl=(await admin.query(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='mf_t1f_execution' AND has_function_privilege('mf_t1f_execution_runtime',p.oid,'EXECUTE') ORDER BY p.proname`)).rows.map(r=>r.proname);
 assert.deepEqual(acl,['bind_successor','consume_round_and_reserve','execution_context','execution_round','reconcile_successor']);
 const attrs=(await admin.query(`SELECT rolcanlogin,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication FROM pg_roles WHERE rolname IN ('mf_t1f_execution_owner','mf_t1f_execution_runtime')`)).rows;
 assert.equal(attrs.length,2);assert.ok(attrs.every(r=>Object.values(r).every(v=>v===false)));
 assert.deepEqual(await original(),before);passed('runtime exactly five functions, all direct writes denied, original rows/events byte-equivalent');
 console.log(JSON.stringify({status:'T1F_PHASE7_DISPOSABLE_PG17_PASS',tests:count,migrations:'009-017 exact',liveDatabaseUsed:false,realSignatures:0,transactions:0}));
}finally{await approvalPool?.end();await executionPool?.end();await admin.end().catch(()=>{});}
