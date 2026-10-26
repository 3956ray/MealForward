/** Exact source migrations, disposable PG17 only. No RPC, wallet or cloud. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import pg from 'pg';
import {seedApprovalFixture} from './t1f-approval-fixture.mjs';
import {buildSuccessorReleaseManifest,T1F_RELEASE_OWNER,T1F_RELEASE_DONOR} from './t1f-successor-dual-approval.mjs';
import {CHAIN,ESCROW} from './core.mjs';
import {FIXED} from './t1e-first-issue-readiness.mjs';
import {ORIGINAL_OPERATION} from './t1f-successor-issue-protocol.mjs';

assert.equal(process.env.MF_T1F_PHASE6_DISPOSABLE_ONLY,'ack-fresh-phase6-pg17');
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.equal(process.env.PGPORT,'15439');
assert.equal(process.env.PGDATABASE,'postgres');
assert.equal(process.env.PGUSER,'postgres');
assert.equal(process.env.DATABASE_URL,undefined,'Do not provide a real database URL');
const config={host:'127.0.0.1',port:15439,database:'postgres',user:'postgres',
 connectionTimeoutMillis:3000,statement_timeout:5000};
const admin=new pg.Client(config);
let count=0,pool;
const passed=label=>{count++;console.log('PASS '+label)};
const fail=(f,code)=>assert.rejects(f,e=>e?.code===code);
const hex=()=> '0x'+randomBytes(32).toString('hex');
try{
 await admin.connect();
 await seedApprovalFixture(admin);
 const legacy=async()=> (await admin.query(`SELECT jsonb_build_object(
  'claims',(SELECT jsonb_agg(to_jsonb(t)) FROM mf_t1e.recipient_claims t),
  'consents',(SELECT jsonb_agg(to_jsonb(t)) FROM mf_t1e.consent_rounds t),
  'funds',(SELECT jsonb_agg(to_jsonb(t)) FROM mf_t1c.intents t),
  'events',(SELECT jsonb_agg(to_jsonb(t)) FROM mf_t1e.claim_events t),
  'reviews',(SELECT jsonb_agg(to_jsonb(t)) FROM mf_t1e.expired_issue_reviews t),
  'slots',(SELECT jsonb_agg(to_jsonb(t)) FROM mf_t1e.issuer_issue_attempts t)) AS value`)).rows[0].value;
 const before=await legacy();
 // Supabase's postgres is CREATEROLE, not SUPERUSER, with no automatic SET grant.
 // Give a separate synthetic executor only the existing-object grants needed by016.
 await admin.query('CREATE ROLE mf_t1f_fixture_migrator LOGIN NOINHERIT NOSUPERUSER CREATEROLE NOBYPASSRLS');
 await admin.query('GRANT CREATE ON DATABASE postgres TO mf_t1f_fixture_migrator');
 await admin.query('GRANT USAGE ON SCHEMA mf_t1e,mf_t1c TO mf_t1f_fixture_migrator WITH GRANT OPTION');
 await admin.query(`GRANT SELECT ON mf_t1e.recipient_claims,mf_t1e.consent_rounds,
  mf_t1e.claim_events,mf_t1e.expired_issue_reviews,mf_t1e.issuer_issue_attempts,
  mf_t1e.successor_issue_releases,mf_t1e.successor_issue_operations,
  mf_t1e.successor_issue_events,mf_t1c.intents TO mf_t1f_fixture_migrator WITH GRANT OPTION`);
 const migrator=new pg.Client({...config,user:'mf_t1f_fixture_migrator'});
 try{
  await migrator.connect();
  await migrator.query("SET createrole_self_grant=''");
  const meta=(await migrator.query(`SELECT current_user,session_user,rolsuper,rolcreaterole,
   current_setting('createrole_self_grant') AS self_grant FROM pg_roles WHERE rolname=current_user`)).rows[0];
  assert.deepEqual(meta,{current_user:'mf_t1f_fixture_migrator',session_user:'mf_t1f_fixture_migrator',rolsuper:false,rolcreaterole:true,self_grant:''});
  await migrator.query(await readFile(new URL('./supabase/016_t1f_recovery_approval_collection.sql',import.meta.url),'utf8'));
  const memberships=(await admin.query(`SELECT parent.rolname AS role_name,grantor.rolname AS grantor,
   m.admin_option,m.inherit_option,m.set_option FROM pg_auth_members m
   JOIN pg_roles parent ON parent.oid=m.roleid JOIN pg_roles grantor ON grantor.oid=m.grantor
   WHERE m.member=(SELECT oid FROM pg_roles WHERE rolname='mf_t1f_fixture_migrator')
   ORDER BY parent.rolname,grantor.rolname`)).rows;
  assert.equal(memberships.length,2);
  assert.ok(memberships.every(m=>['mf_t1f_approval_owner','mf_t1f_approval_runtime'].includes(m.role_name)&&m.admin_option&&!m.inherit_option&&!m.set_option&&m.grantor==='postgres'));
  await fail(()=>migrator.query('SET ROLE mf_t1f_approval_owner'),'42501');
  await fail(()=>migrator.query('SELECT * FROM mf_t1f_recovery.approval_rounds'),'42501');
  passed('exact016 non-superuser CREATEROLE migration; temporary owner membership removed, native ADMIN-only memberships preserved');
 }finally{await migrator.end();}

 const {makeApprovalStore}=await import('./t1f-approval-store.mjs');
 // Synthetic local login tests real role membership, not superuser SET ROLE.
 await admin.query('CREATE ROLE mf_t1f_approval_login LOGIN NOINHERIT; GRANT mf_t1f_approval_runtime TO mf_t1f_approval_login');
 pool=new pg.Pool({...config,user:'mf_t1f_approval_login',options:'-c role=mf_t1f_approval_runtime',max:8});
 const store=makeApprovalStore({pool});
 const {openApprovalRuntime,verifyApprovalRuntime}=await import('./t1f-approval-server.mjs');
 const runtime=await openApprovalRuntime({env:{
  T1F_APPROVAL_MODE:'COLLECTION_NO_RELEASE',MF_T1F_APPROVAL_FIXTURE:'ack-local-phase6-fixture',
  T1F_APPROVAL_ORIGIN:'http://127.0.0.1:15440',PORT:'15440',
  T1F_APPROVAL_DB_URL:'postgresql://mf_t1f_approval_login:synthetic-local-password@127.0.0.1:15439/postgres'
 }});
 try{assert.equal((await runtime.service.status()).status,'NO_ROUND');}
 finally{await runtime.pool.end();}
 for(const [grant,revoke] of [
  ['GRANT UPDATE(issuer_tx_hash) ON mf_t1e.recipient_claims TO mf_t1f_approval_login','REVOKE UPDATE(issuer_tx_hash) ON mf_t1e.recipient_claims FROM mf_t1f_approval_login'],
  ['GRANT USAGE ON SCHEMA mf_t1e TO mf_t1f_approval_runtime','REVOKE USAGE ON SCHEMA mf_t1e FROM mf_t1f_approval_runtime'],
  ['GRANT SELECT ON SEQUENCE mf_t1f_recovery.approval_events_event_id_seq TO mf_t1f_approval_runtime','REVOKE SELECT ON SEQUENCE mf_t1f_recovery.approval_events_event_id_seq FROM mf_t1f_approval_runtime']
 ]){
  await admin.query(grant);
  try{await assert.rejects(()=>verifyApprovalRuntime(pool),/RUNTIME_CAPABILITY/);}
  finally{await admin.query(revoke);}
 }
 await verifyApprovalRuntime(pool);
 passed('actual dedicated runtime startup and column/sequence/old-schema escalation denial');
 // Hosted PostgreSQL can expose PUBLIC SELECT on platform views whose schema
 // is private. Inaccessible ambient grants differ from direct app capability.
 await admin.query('CREATE SCHEMA platform_diagnostics; REVOKE ALL ON SCHEMA platform_diagnostics FROM PUBLIC');
 await admin.query('CREATE VIEW platform_diagnostics.stats AS SELECT 1 AS sample; GRANT SELECT ON platform_diagnostics.stats TO PUBLIC');
 try{
  await verifyApprovalRuntime(pool);
  for(const [grant,revoke] of [
   ['GRANT USAGE ON SCHEMA platform_diagnostics TO mf_t1f_approval_runtime','REVOKE USAGE ON SCHEMA platform_diagnostics FROM mf_t1f_approval_runtime'],
   ['GRANT SELECT ON platform_diagnostics.stats TO mf_t1f_approval_login','REVOKE SELECT ON platform_diagnostics.stats FROM mf_t1f_approval_login'],
   ['GRANT SELECT(sample) ON platform_diagnostics.stats TO mf_t1f_approval_runtime','REVOKE SELECT(sample) ON platform_diagnostics.stats FROM mf_t1f_approval_runtime']
  ]){
   await admin.query(grant);
   try{await assert.rejects(()=>verifyApprovalRuntime(pool),/RUNTIME_CAPABILITY/);}
   finally{await admin.query(revoke);}
   await verifyApprovalRuntime(pool);
  }
 }finally{await admin.query('DROP VIEW platform_diagnostics.stats; DROP SCHEMA platform_diagnostics');}
 passed('inaccessible platform PUBLIC view reads tolerated; schema access and direct table/column grants rejected');

 const context=await store.context();
 assert.equal(context.claim.issuer_tx_nonce,0);
 assert.equal(context.claim.issuer_op_id,ORIGINAL_OPERATION);
 assert.equal(await store.current(),null);
 passed('exact migrations 009-016 and pinned original context');
 const now=()=>Math.floor(Date.now()/1000);
 const proposal=(extra={})=>{
  const time=extra.time??now();
  const chain={chainId:CHAIN,escrow:ESCROW,issuer:FIXED.issuerAuthority,
   originalOperationId:ORIGINAL_OPERATION,originalOperationSeen:false,
   reservedOriginalNonce:'0',originalImmutableDeadline:'1792765625',
   issuerTransactionHashFound:false,userWalletActivityMustBeChecked:true,
   unitAvailable:true,unitIssued:false,canIssueOrResetAutomatically:false,
   noPendingTxProven:false,issuerLatestNonce:'0',issuerPendingNonce:'0',
   observedBlockNumber:'73645549',observedBlockHash:hex(),observedBlockTime:time,
   originalDeadlineExpired:true,originalTransactionHash:null,
   status:'T1F_EXPIRED_NO_ISSUE_OBSERVED_NOT_ABSENCE_PROOF'};
  return {roundId:randomUUID(),createdAt:time,observedBlockTime:time,
   manifest:buildSuccessorReleaseManifest({...context,chain,
    walletObservation:'OWNER_REPORTED_NO_TRANSACTIONS_VISIBLE',nonceDomain:hex(),
    candidateOperationId:hex(),candidateNonce:0,candidateDeadline:time+480,
    approvalExpiresAt:time+300,now:time}),...extra};
 };
 // Historical synthetic round: no clock mocking and no disabled triggers.
 // It represents a round which expired before this new disposable run.
 const past=now()-400,historical=proposal({time:past});
 const oldValue=historical.manifest.value;
 await admin.query(`INSERT INTO mf_t1f_recovery.approval_rounds
  (round_id,value,digest,created_at_epoch,observed_block_time,candidate_calldata_hash)
  VALUES($1,$2,$3,$4,$4,$5)`,[historical.roundId,oldValue,historical.manifest.digest,past,historical.manifest.candidateCalldataHash]);
 await admin.query(`INSERT INTO mf_t1f_recovery.approval_events(round_id,event_type)
  VALUES($1,'ROUND_CREATED')`,[historical.roundId]);
 const oldOwnerFingerprint=hex();
 for(const [role,wallet,fingerprint] of [['owner',T1F_RELEASE_OWNER,oldOwnerFingerprint],['donor',T1F_RELEASE_DONOR,hex()]]){
  await admin.query(`INSERT INTO mf_t1f_recovery.role_approvals
   (round_id,role,wallet,digest,fingerprint,verified_at_epoch) VALUES($1,$2,$3,$4,$5,$6)`,
   [historical.roundId,role,wallet,historical.manifest.digest,fingerprint,past+10]);
  await admin.query(`INSERT INTO mf_t1f_recovery.approval_events(round_id,event_type,role)
   VALUES($1,'ROLE_VERIFIED',$2)`,[historical.roundId,role]);
 }
 assert.equal((await store.current()).round_id,historical.roundId);
 assert.equal((await store.current()).approvals.length,2);
 await fail(()=>store.record({roundId:historical.roundId,digest:historical.manifest.digest,
  role:'owner',wallet:T1F_RELEASE_OWNER,fingerprint:oldOwnerFingerprint}),'P0001');
 assert.equal((await store.current()).round_id,historical.roundId,'reads never roll over');
 passed('expired completed round remains visible but identical replay rejects and reads never roll over');
 const p=proposal();
 for(const value of [{...p.manifest.value,newNonce:0},{...p.manifest.value,newNonce:'00'},
  {...p.manifest.value,approvalExpiresAt:'0'+p.manifest.value.approvalExpiresAt},
  {...p.manifest.value,observedBlockNumber:'073645549'},
  {...p.manifest.value,slotId:randomUUID()},
  {...p.manifest.value,nonceDomain:'0x'+'0'.repeat(64)},
  {...p.manifest.value,unexpected:'field'}]){
  await fail(()=>pool.query('SELECT mf_t1f_recovery.create_round($1,$2,$3,$4,$5,$6)',
   [randomUUID(),value,p.manifest.digest,p.createdAt,p.observedBlockTime,p.manifest.candidateCalldataHash]),'P0001');
 }
 for(const [created,observed] of [[now()+60,now()],[now(),now()-121],[now(),now()+1]]){
  await fail(()=>pool.query('SELECT mf_t1f_recovery.create_round($1,$2,$3,$4,$5,$6)',
   [randomUUID(),p.manifest.value,p.manifest.digest,created,observed,p.manifest.candidateCalldataHash]),'P0001');
 }
 passed('malformed/noncanonical JSON, wrong linkage and invalid creation time rejected');
 const rounds=await Promise.all(Array.from({length:6},()=>store.create(p)));
 assert.ok(rounds.every(r=>r.round_id===p.roundId));
 assert.deepEqual(rounds[0].value,p.manifest.value);
 assert.deepEqual(rounds[0].approvals,[]);
 assert.equal((await store.create(proposal())).round_id,p.roundId);
 assert.notEqual(p.roundId,historical.roundId);
 assert.equal((await store.get(historical.roundId)).value.approvalExpiresAt,String(past+300));
 passed('concurrent create and explicit repeated create recover one active round');
 const owner={roundId:p.roundId,digest:p.manifest.digest,role:'owner',wallet:T1F_RELEASE_OWNER,fingerprint:hex()};
 const donor={...owner,role:'donor',wallet:T1F_RELEASE_DONOR,fingerprint:hex()};
 await admin.query(`CREATE FUNCTION mf_t1f_recovery.ci_reject_event() RETURNS trigger
  LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_AUDIT_FAILURE'; END $$;
  CREATE TRIGGER ci_reject_event BEFORE INSERT ON mf_t1f_recovery.approval_events
  FOR EACH ROW EXECUTE FUNCTION mf_t1f_recovery.ci_reject_event()`);
 try{await fail(()=>store.record(owner),'P0001');}
 finally{await admin.query('DROP TRIGGER ci_reject_event ON mf_t1f_recovery.approval_events; DROP FUNCTION mf_t1f_recovery.ci_reject_event()');}
 assert.equal((await store.get(p.roundId)).approvals.length,0);
 passed('audit failure atomically rolls back approval');
 await Promise.all([store.record(owner),store.record(donor),store.record(owner),store.record(donor)]);
 const row=await store.get(p.roundId);
 assert.equal(row.approvals.length,2);
 assert.equal((await makeApprovalStore({pool}).current()).approvals.length,2);
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM mf_t1f_recovery.approval_events WHERE round_id=$1',[p.roundId])).rows[0].n,3);
 passed('concurrent dual acceptance, exact retry and restart preserve three audit events');
 for(const input of [{...owner,digest:hex()},{...owner,wallet:T1F_RELEASE_DONOR},
  {...owner,role:'issuer'},{...owner,fingerprint:hex()},{...owner,roundId:randomUUID()}]){
  await fail(()=>store.record(input),'P0001');
 }
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM mf_t1f_recovery.approval_events WHERE round_id=$1',[p.roundId])).rows[0].n,3);
 passed('wrong digest, role, wallet, round and conflicting replay cannot append');
 for(const table of ['approval_rounds','role_approvals','approval_events']){
  const update=table==='approval_rounds'?'digest=digest':table==='role_approvals'?'fingerprint=fingerprint':'event_type=event_type';
  await fail(()=>admin.query('UPDATE mf_t1f_recovery.'+table+' SET '+update),'P0001');
  await fail(()=>admin.query('DELETE FROM mf_t1f_recovery.'+table),'P0001');
  await fail(()=>admin.query('TRUNCATE mf_t1f_recovery.'+table+' CASCADE'),'P0001');
 }
 passed('rounds, attestations and events deny update/delete/truncate even to administrator');
 const roles=['anon','authenticated','service_role','mf_t1c_auth_runtime','mf_t1c_intent_runtime',
  'mf_t1d_auth_runtime','mf_t1d_fund_runtime','mf_t1e_auth_runtime','mf_t1e_claim_runtime','mf_t1f_approval_runtime'];
 const deniedAs=async(role,sql,args=[])=>{
  await admin.query('BEGIN');
  try{await admin.query('SET LOCAL ROLE '+role);await fail(()=>admin.query(sql,args),'42501');}
  finally{await admin.query('ROLLBACK');}
 };
 for(const role of roles){
  await deniedAs(role,'SELECT * FROM mf_t1f_recovery.approval_rounds');
  await deniedAs(role,'INSERT INTO mf_t1f_recovery.approval_events(round_id,event_type) VALUES($1,\'ROUND_CREATED\')',[p.roundId]);
  await deniedAs(role,"SELECT nextval('mf_t1f_recovery.approval_events_event_id_seq')");
  if(role!=='mf_t1f_approval_runtime')await deniedAs(role,'SELECT mf_t1f_recovery.current_round()');
 }
 for(const table of ['mf_t1e.recipient_claims','mf_t1e.successor_issue_releases','mf_t1c.intents']){
  await deniedAs('mf_t1f_approval_runtime','SELECT * FROM '+table);
  await deniedAs('mf_t1f_approval_owner','DELETE FROM '+table+' WHERE false');
 }
 await fail(()=>pool.query('SET ROLE mf_t1f_approval_owner'),'42501');
 await deniedAs('mf_t1f_approval_runtime','SELECT mf_t1f_recovery.row_json($1)',[p.roundId]);
 const attributes=(await admin.query(`SELECT rolname,rolcanlogin,rolsuper,rolbypassrls,
  rolcreatedb,rolcreaterole,rolreplication FROM pg_roles
  WHERE rolname IN ('mf_t1f_approval_owner','mf_t1f_approval_runtime')`)).rows;
 assert.equal(attributes.length,2);
 for(const attrs of attributes)for(const [k,v] of Object.entries(attrs))if(k!=='rolname')assert.equal(v,false);
 const definers=(await admin.query(`SELECT p.proname,r.rolname,p.proconfig
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  JOIN pg_roles r ON r.oid=p.proowner
  WHERE n.nspname='mf_t1f_recovery' AND p.prosecdef`)).rows;
 assert.equal(definers.length,5);
 assert.ok(definers.every(r=>r.rolname==='mf_t1f_approval_owner'&&r.proconfig.includes('search_path=pg_catalog')&&r.proconfig.includes('statement_timeout=5s')));
 assert.equal((await admin.query(`SELECT count(*)::int AS n FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace,
  LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
  WHERE n.nspname='mf_t1f_recovery' AND a.grantee=0 AND a.privilege_type='EXECUTE'`)).rows[0].n,0);
 passed('actual runtime/legacy privileges, internal functions, owner and PUBLIC execution bounded');
 await admin.query('BEGIN');
 try{
  await admin.query("UPDATE mf_t1e.recipient_claims SET stage='ISSUE_HASH_BOUND',revision=revision+1,issuer_tx_hash=$1",[hex()]);
  await admin.query('SET LOCAL ROLE mf_t1f_approval_runtime');
  await fail(()=>admin.query('SELECT mf_t1f_recovery.record_approval($1,$2,$3,$4,$5)',Object.values(owner)),'P0001');
 }finally{await admin.query('ROLLBACK');}
 passed('changed original state blocks even an otherwise idempotent approval');
 await admin.query('BEGIN');
 try{
  const release=randomUUID(),m=p.manifest.value;
  await admin.query(`INSERT INTO mf_t1e.successor_issue_releases
   (release_id,claim_id,slot_id,review_id,candidate_op_id,candidate_issuer_nonce,
   candidate_issue_deadline,nonce_domain,approval_expires_at,observed_block_number,
   observed_block_hash,owner_wallet,donor_wallet,signed_payload_digest,
   owner_signature_fingerprint,donor_signature_fingerprint,signer_verification_version)
   VALUES($1,$2,$3,$4,$5,0,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'T1F_EIP712_TWO_INDEPENDENT_EOA_V1')`,
   [release,m.claimId,m.slotId,m.reviewId,m.newOpId,m.newDeadline,m.nonceDomain,m.approvalExpiresAt,
    m.observedBlockNumber,m.observedBlockHash,T1F_RELEASE_OWNER,T1F_RELEASE_DONOR,p.manifest.digest,owner.fingerprint,donor.fingerprint]);
  await fail(()=>admin.query(`INSERT INTO mf_t1e.successor_issue_operations
   (successor_id,claim_id,slot_id,release_id,voucher_id,issuer_wallet,
    operation_id,issuer_nonce,issuer_issue_deadline,calldata_hash)
   VALUES($1,$2,$3,$4,$5,$6,$7,0,$8,$9)`,
   [randomUUID(),m.claimId,m.slotId,release,m.voucherId,FIXED.issuerAuthority,m.newOpId,m.newDeadline,p.manifest.candidateCalldataHash]),'P0001');
 }finally{await admin.query('ROLLBACK');}
 for(const table of ['successor_issue_releases','successor_issue_operations','successor_issue_events']){
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM mf_t1e.'+table)).rows[0].n,0);
 }
 passed('015 HOLD still denies successor insertion; release/operation/event rows remain zero');
 assert.deepEqual(await legacy(),before);
 passed('legacy records byte-equivalent');
 console.log(JSON.stringify({status:'T1F_PHASE6_DISPOSABLE_PG17_PASS',tests:count,
  migrations:'009-016 exact',liveDatabaseUsed:false,realSignatures:0,transactions:0}));
}finally{await pool?.end();await admin.end().catch(()=>{})}
