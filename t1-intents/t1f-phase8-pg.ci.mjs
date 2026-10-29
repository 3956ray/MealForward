/** Fresh loopback PG17 only. Exact 009–018; synthetic fixed predecessor, no cloud/RPC/wallet. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import pg from 'pg';
import {seedApprovalFixture} from './t1f-approval-fixture.mjs';
import {buildSuccessorReleaseManifest} from './t1f-successor-dual-approval.mjs';
import {PHASE8_FIXED as f,buildRecoveryManifest} from './t1f-phase8-protocol.mjs';
import {makePhase8Store,phase8CapabilityPool,verifyPhase8Runtime} from './t1f-phase8-store.mjs';
assert.equal(process.env.MF_T1F_PHASE6_DISPOSABLE_ONLY,'ack-fresh-phase6-pg17');
for(const [k,v] of Object.entries({PGHOST:'127.0.0.1',PGPORT:'15439',PGDATABASE:'postgres',PGUSER:'postgres'}))assert.equal(process.env[k],v);
assert.equal(process.env.DATABASE_URL,undefined);
const cfg={host:'127.0.0.1',port:15439,database:'postgres',user:'postgres',statement_timeout:5000,connectionTimeoutMillis:3000},c=new pg.Client(cfg),pools=[];
const hex=()=> '0x'+randomBytes(32).toString('hex'),now=()=>Math.floor(Date.now()/1000);let tests=0;
const pass=s=>{tests++;console.log('PASS '+s)},fail=fn=>assert.rejects(fn,e=>e?.code==='P0001');
try{
 await c.connect();await seedApprovalFixture(c);
 await c.query(await readFile(new URL('./supabase/016_t1f_recovery_approval_collection.sql',import.meta.url),'utf8'));
 await c.query(await readFile(new URL('./supabase/migrations/20261026201810_t1f_controlled_successor_execution.sql',import.meta.url),'utf8'));
 // Disposable synthetic history seeding only. NOT a production recovery procedure.
 await c.query('BEGIN; SET LOCAL session_replication_role=replica');
 await c.query('UPDATE mf_t1e.expired_issue_reviews SET review_id=$1',[f.reviewId]);
 await c.query('UPDATE mf_t1e.issuer_issue_attempts SET attempt_id=$1,review_id=$2',[f.slotId,f.reviewId]);
 await c.query('COMMIT');
 const oldContext=(await c.query('SELECT mf_t1f_recovery.context() v')).rows[0].v;
 const created=f.predecessor.issuer_issue_deadline-480;
 const chain={chainId:10143,escrow:f.escrow,issuer:f.issuer,originalOperationId:f.originalOperationId,reservedOriginalNonce:'0',originalImmutableDeadline:f.originalDeadline,
 observedBlockNumber:'74583297',observedBlockHash:'0xb2bc0d81daef124b86a83b2db9ab2d731e47eff70598931086a3b8dbdd7fa393',observedBlockTime:created,issuerLatestNonce:'0',issuerPendingNonce:'0',originalOperationSeen:false,unitAvailable:true,unitIssued:false,issuerTransactionHashFound:false,noPendingTxProven:false,userWalletActivityMustBeChecked:true,canIssueOrResetAutomatically:false,status:'T1F_EXPIRED_NO_ISSUE_OBSERVED_NOT_ABSENCE_PROOF'};
 const old=buildSuccessorReleaseManifest({...oldContext,chain,walletObservation:'OWNER_REPORTED_NO_TRANSACTIONS_VISIBLE',candidateOperationId:f.predecessor.operation_id,candidateNonce:'0',candidateDeadline:String(created+480),nonceDomain:'0x8f2d1e6e65194b85751f9747117cb8d79f61d8569bd7d6305175dbb1073e0bfe',approvalExpiresAt:String(created+300),now:created});
 assert.equal(old.digest,f.predecessorDigest);
 const release=randomUUID(),oldConsumption=randomUUID(),fingerprints={owner:hex(),donor:hex()};
 await c.query('BEGIN; SET LOCAL session_replication_role=replica');
 await c.query('INSERT INTO mf_t1f_recovery.approval_rounds(round_id,value,digest,created_at_epoch,observed_block_time,candidate_calldata_hash) VALUES($1,$2,$3,$4,$4,$5)',[f.predecessorRoundId,old.value,old.digest,created,old.candidateCalldataHash]);
 for(const role of ['owner','donor'])await c.query('INSERT INTO mf_t1f_recovery.role_approvals(round_id,role,wallet,digest,fingerprint,verified_at_epoch) VALUES($1,$2,$3,$4,$5,$6)',[f.predecessorRoundId,role,f[role],old.digest,fingerprints[role],created+10]);
 await c.query('INSERT INTO mf_t1f_execution.consumptions(consumption_id,round_id,digest,claim_id,slot_id,release_id,successor_id,consumed_at_epoch) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[oldConsumption,f.predecessorRoundId,old.digest,f.claimId,f.slotId,release,f.predecessor.successor_id,created+20]);
 await c.query(`INSERT INTO mf_t1e.successor_issue_releases(release_id,claim_id,slot_id,review_id,candidate_op_id,candidate_issuer_nonce,candidate_issue_deadline,nonce_domain,approval_expires_at,observed_block_number,observed_block_hash,owner_wallet,donor_wallet,signed_payload_digest,owner_signature_fingerprint,donor_signature_fingerprint,signer_verification_version,stage,may_release_to_wallet) VALUES($1,$2,$3,$4,$5,0,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'T1F_PROTECTED_COLLECTOR_RECEIPTS_V1','RELEASED_FOR_ONE_ISSUE',true)`,[release,f.claimId,f.slotId,f.reviewId,f.predecessor.operation_id,created+480,old.value.nonceDomain,created+300,old.value.observedBlockNumber,old.value.observedBlockHash,f.owner,f.donor,old.digest,fingerprints.owner,fingerprints.donor]);
 await c.query(`INSERT INTO mf_t1e.successor_issue_operations(successor_id,claim_id,slot_id,release_id,voucher_id,issuer_wallet,operation_id,issuer_nonce,issuer_issue_deadline,calldata_hash) VALUES($1,$2,$3,$4,$5,$6,$7,0,$8,$9)`,[f.predecessor.successor_id,f.claimId,f.slotId,release,f.voucherId,f.issuer,f.predecessor.operation_id,created+480,old.candidateCalldataHash]);
 await c.query("INSERT INTO mf_t1e.successor_issue_events(successor_id,event_type) VALUES($1,'ISSUE_RESERVED')",[f.predecessor.successor_id]);
 await c.query('COMMIT');
 const original=async()=> (await c.query(`SELECT jsonb_build_object('original',mf_t1f_execution.execution_context(),'events',(SELECT jsonb_agg(to_jsonb(x) ORDER BY event_id) FROM mf_t1e.successor_issue_events x)) v`)).rows[0].v;
 const before=await original();
 await assert.rejects(()=>c.query('SELECT mf_t1f_phase8.context()'),e=>e.code==='3F000');pass('RED Phase8 schema unavailable before migration');
 await c.query('CREATE ROLE mf_phase8_migrator LOGIN NOINHERIT NOSUPERUSER CREATEROLE NOBYPASSRLS; GRANT CREATE ON DATABASE postgres TO mf_phase8_migrator; GRANT mf_t1f_execution_owner TO mf_phase8_migrator WITH ADMIN TRUE, INHERIT FALSE, SET FALSE; ALTER SCHEMA mf_t1e OWNER TO mf_phase8_migrator; ALTER TABLE mf_t1e.successor_issue_operations OWNER TO mf_phase8_migrator');
 const migrator=new pg.Client({...cfg,user:'mf_phase8_migrator'});await migrator.connect();try{
 await migrator.query("SET createrole_self_grant=''");await migrator.query(await readFile(new URL('./supabase/migrations/20261027061724_t1f_phase8_recovery.sql',import.meta.url),'utf8'));
 await assert.rejects(()=>migrator.query('SET ROLE mf_t1f_phase8_owner'),e=>e.code==='42501');
 await assert.rejects(()=>migrator.query('SET ROLE mf_t1f_execution_owner'),e=>e.code==='42501');
 }finally{await migrator.end()}
 const stores={};
 for(const kind of ['operator','collector','execution']){
  await c.query(`CREATE ROLE mf_t1f_phase8_${kind}_login LOGIN NOINHERIT; GRANT mf_t1f_phase8_${kind}_runtime TO mf_t1f_phase8_${kind}_login`);
  const pool=phase8CapabilityPool(new pg.Pool({...cfg,user:`mf_t1f_phase8_${kind}_login`,max:6}),kind);pools.push(pool);await verifyPhase8Runtime(pool,kind);stores[kind]=makePhase8Store({pool});
 }
 const {operator,collector,execution}=stores;
 assert.equal((await operator.context()).operation,null);pass('GREEN exact migration and separated operator/collector/execution capability audits');
 const ts=now(),obs={version:'T1F_PHASE8_OBSERVATION_V1',chainId:10143,issuer:f.issuer,escrow:f.escrow,finalizedBlockNumber:'80000000',finalizedBlockHash:hex(),finalizedBlockTime:ts-2,finalizedCanonical:true,observedBlockNumber:'80000002',observedBlockHash:hex(),observedBlockTime:ts,freshCanonical:true,issuerLatestNonce:'0',issuerPendingNonce:'0',originalOperationSeen:false,predecessorOperationSeen:false,unitAvailable:true,unitIssued:false,unitGeneration:'0',unitSeq:'0',mealId:f.mealId,termsHash:f.termsHash,codeAndAuthorityValid:true,accountingValid:true};
 const wallet={value:'ISSUER_REPORTED_NO_PENDING_OR_SENT_TRANSACTIONS',observedAt:ts};
 const manifest=buildRecoveryManifest({predecessor:f.predecessor,observation:obs,walletObservation:wallet,now:ts,newOpId:hex(),nonceDomain:hex()}),id=randomUUID();
 const proposal={roundId:id,manifest,createdAt:ts,observedBlockTime:ts,evidence:obs,walletObservation:wallet};
 for(const evidence of [{...obs,predecessorOperationSeen:true},{...obs,finalizedBlockTime:created+479},{...obs,issuerPendingNonce:'1'},{...obs,unitGeneration:'1'},{...obs,extra:true},{...obs,observedBlockNumber:obs.finalizedBlockNumber},{...obs,finalizedBlockHash:'0x'+'0'.repeat(64)},{...obs,observedBlockHash:'0x'+'0'.repeat(64)}])await fail(()=>operator.create({...proposal,evidence}));
 await assert.rejects(()=>collector.create(proposal),e=>e.code==='42501');await assert.rejects(()=>execution.create(proposal),e=>e.code==='42501');
 await assert.rejects(()=>operator.record({roundId:id,digest:manifest.digest,role:'owner',wallet:f.owner,fingerprint:hex(),evidence:obs}),e=>e.code==='42501');
 await assert.rejects(()=>collector.consume({roundId:id,digest:manifest.digest,evidence:obs}),e=>e.code==='42501');
 await operator.create(proposal);await fail(()=>operator.create({...proposal,roundId:randomUUID()}));pass('creation denies unsafe observations, duplicate active rounds and collector authority');
 const consumption={roundId:id,digest:manifest.digest,evidence:{...obs,simulationPassed:true,calldataHash:manifest.candidateCalldataHash,signedAnchorCanonical:true,signedFinalizedCanonical:true}};
 await fail(()=>execution.consume(consumption));
 await fail(()=>collector.record({roundId:id,digest:manifest.digest,role:'owner',wallet:f.donor,fingerprint:hex(),evidence:obs}));
 await fail(()=>collector.record({roundId:id,digest:hex(),role:'owner',wallet:f.owner,fingerprint:hex(),evidence:obs}));
 const blockedId=randomUUID(),blockedDigest=hex();
 await c.query("INSERT INTO mf_t1f_phase8.rounds SELECT $1,value || jsonb_build_object('approvalExpiresAt',($2::bigint+300)::text,'newDeadline',($2::bigint+480)::text),$3,$2,observed_block_time,candidate_calldata_hash,$4,$5,$2 FROM mf_t1f_phase8.rounds WHERE round_id=$6",[blockedId,ts-211,blockedDigest,hex(),hex(),id]);
 for(const role of ['owner','donor'])await c.query('INSERT INTO mf_t1f_phase8.approvals(round_id,role,wallet,digest,fingerprint,verified_at_epoch) VALUES($1,$2,$3,$4,$5,$6)',[blockedId,role,f[role],blockedDigest,hex(),ts-200]);
 await fail(()=>execution.consume({...consumption,roundId:blockedId,digest:blockedDigest}));
 for(const role of ['owner','donor'])await collector.record({roundId:id,digest:manifest.digest,role,wallet:f[role],fingerprint:hex(),evidence:obs});
 for(const evidence of [{...consumption.evidence,simulationPassed:false},{...consumption.evidence,signedAnchorCanonical:false},{...consumption.evidence,signedFinalizedCanonical:false},{...consumption.evidence,calldataHash:hex()},{...consumption.evidence,unitAvailable:false}])await fail(()=>execution.consume({...consumption,evidence}));
 await assert.rejects(()=>execution.consume({...consumption,beforeExecute:()=>{throw Error('ABORTED')}}),/ABORTED/);
 assert.equal((await execution.context()).operation,null);pass('dual approvals, exact evidence, simulation, anchors and last-moment cancellation guard reservation');
 await c.query(`CREATE FUNCTION mf_t1f_phase8.fixture_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'AUDIT_FAIL'; END $$; CREATE TRIGGER fixture_reject BEFORE INSERT ON mf_t1f_phase8.events FOR EACH ROW EXECUTE FUNCTION mf_t1f_phase8.fixture_reject()`);
 await fail(()=>execution.consume(consumption));assert.equal((await execution.context()).operation,null);
 await c.query('DROP TRIGGER fixture_reject ON mf_t1f_phase8.events; DROP FUNCTION mf_t1f_phase8.fixture_reject()');pass('failed audit insert rolls back whole reservation');
 const result=await Promise.all(Array.from({length:6},()=>execution.consume(consumption)));assert.equal(result.filter(x=>x.created).length,1);
 const op=result[0].operation;assert.equal((await execution.consume({...consumption,digest:hex()})).created,false);
 await fail(()=>operator.create({...proposal,roundId:randomUUID()}));await fail(()=>collector.record({roundId:id,digest:manifest.digest,role:'owner',wallet:f.owner,fingerprint:hex(),evidence:obs}));pass('concurrent consume creates one child; replay returns existing only; collector/operator writes close');
 const hash=hex(),bind={version:'T1F_BOUND_TRANSACTION_V1',chainId:'10143',from:f.issuer,to:f.escrow,nonce:'0',value:'0',calldataHash:manifest.candidateCalldataHash,txHash:hash};
 await fail(()=>execution.bind({successorId:op.successor_id,revision:1,txHash:hash,evidence:bind}));
 await fail(()=>execution.bind({successorId:op.successor_id,revision:0,txHash:hash,evidence:{...bind,value:'1'}}));
 await execution.bind({successorId:op.successor_id,revision:0,txHash:hash,evidence:bind});
 const receipt={version:'T1F_RECONCILIATION_V1',txHash:hash,blockNumber:'80000003',blockHash:hex(),canonical:true,receiptSucceeded:true,expectedEventsValid:true,operationValid:true,accountingValid:true};
 await fail(()=>execution.reconcile({successorId:op.successor_id,revision:1,evidence:{...receipt,canonical:false}}));
 await assert.rejects(()=>c.query("UPDATE mf_t1f_phase8.operations SET stage='ISSUED',revision=2,receipt_block=80000003,receipt_block_hash=NULL WHERE successor_id=$1",[op.successor_id]),e=>e.code==='23514');
 await execution.reconcile({successorId:op.successor_id,revision:1,evidence:receipt});assert.equal((await execution.context()).operation.stage,'ISSUED');pass('bind identity/CAS and exact receipt evidence control child transitions');
 for(const table of ['rounds','approvals','events','operations']){await fail(()=>c.query(`DELETE FROM mf_t1f_phase8.${table}`));await fail(()=>c.query(`TRUNCATE mf_t1f_phase8.${table} CASCADE`));}
 await fail(()=>c.query("UPDATE mf_t1f_phase8.operations SET operation_id=$1",[hex()]));
 await c.query('BEGIN; SET LOCAL session_replication_role=replica');await c.query("UPDATE mf_t1e.successor_issue_operations SET revision=1,stage='ISSUE_HASH_BOUND',tx_hash=$1",[hex()]);await fail(()=>c.query('SELECT mf_t1f_phase8.context()'));await c.query('ROLLBACK');
 assert.deepEqual(await original(),before);pass('immutable child records and late predecessor change fail closed; old history byte-equivalent');
 const collectorPool=pools[1];
 await c.query('GRANT SELECT ON mf_t1f_phase8.operations TO mf_t1f_phase8_collector_login');
 await assert.rejects(()=>verifyPhase8Runtime(collectorPool,'collector'),/RUNTIME_CAPABILITY/);
 await c.query('REVOKE SELECT ON mf_t1f_phase8.operations FROM mf_t1f_phase8_collector_login');
 await c.query('GRANT mf_t1f_phase8_collector_runtime TO mf_t1f_phase8_collector_login WITH INHERIT TRUE');
 await assert.rejects(()=>verifyPhase8Runtime(collectorPool,'collector'),/RUNTIME_CAPABILITY/);
 await c.query('GRANT mf_t1f_phase8_collector_runtime TO mf_t1f_phase8_collector_login WITH INHERIT FALSE');
 pass('catalog audit rejects accidental login table privileges and inherited membership');
 for(const [kind,store] of Object.entries(stores)){const pool=pools[['operator','collector','execution'].indexOf(kind)];await verifyPhase8Runtime(pool,kind);await assert.rejects(()=>pool.query('SELECT * FROM mf_t1f_phase8.operations'),e=>e.code==='42501');}
 for(const role of ['anon','authenticated','service_role','mf_t1f_approval_runtime','mf_t1f_execution_runtime','mf_t1e_auth_runtime','mf_t1e_claim_runtime']){await c.query('BEGIN; SET LOCAL ROLE '+role);await assert.rejects(()=>c.query('SELECT mf_t1f_phase8.context()'),e=>e.code==='42501');await c.query('ROLLBACK');}
 pass('old/public runtime capabilities cannot enter Phase8');
 console.log(JSON.stringify({status:'T1F_PHASE8_DISPOSABLE_PG17_PASS',tests,liveDatabaseUsed:false,transactions:0}));
}finally{await Promise.all(pools.map(p=>p.end()));await c.end().catch(()=>{});}
