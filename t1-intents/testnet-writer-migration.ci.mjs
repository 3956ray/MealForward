/**
 * Executes the EXACT T1-D production-role migration on a separate disposable
 * PostgreSQL 17 database named "postgres" inside GitHub Actions Docker.
 * No Supabase, Render, CP30, external host, wallet or blockchain side effects.
 *
 * The production script must not escalate the original T1-C readonly principal.
 */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {Wallet} from 'ethers';
import {makeChallenge,verifyChallenge} from './auth/siwe.mjs';
import {pgStoreT1D} from './auth/t1d-db.mjs';
import pg from 'pg';

const LOCAL='postgres://postgres:t1c-disposable-only@127.0.0.1:5433/postgres';
assert.equal(process.env.GITHUB_ACTIONS,'true','GITHUB_ACTIONS_ONLY');
assert.equal(process.env.MF_T1C_DISPOSABLE_ONLY,'ack-fresh-t1c-postgres17','DISPOSABLE_LABEL_REQUIRED');
assert.equal(process.env.MF_T1C_HTTP_DISPOSABLE_ONLY,'ack-original-siwe-pg17','HTTP_DISPOSABLE_LABEL_REQUIRED');
assert.equal(process.env.DATABASE_URL,
 'postgres://postgres:t1c-disposable-only@127.0.0.1:5433/mf_t1c_http_ci',
 'WRONG_DISPOSABLE_PG_HOST');

const client=new pg.Client({connectionString:LOCAL,connectionTimeoutMillis:3000});
try{
 await client.connect();
 const env=await client.query("SELECT current_database() AS db,current_user AS who, current_setting('server_version_num')::int AS version");
 assert.equal(env.rows[0].db,'postgres');
 assert.equal(env.rows[0].who,'postgres');
 assert.ok(env.rows[0].version>=170000&&env.rows[0].version<180000);
 const fresh=await client.query(
  "SELECT to_regnamespace('mf_t1c') IS NULL AS no_money_schema, "+
  "to_regnamespace('mf_cp31_auth_pilot') IS NULL AS no_auth_schema"
 );
 assert.equal(fresh.rows[0].no_money_schema,true);
 assert.equal(fresh.rows[0].no_auth_schema,true);

 await client.query('CREATE SCHEMA mf_cp31_auth_pilot; CREATE TABLE mf_cp31_auth_pilot.sessions (id text);');
 const schema=await readFile(new URL('./schema.sql',import.meta.url),'utf8');
 await client.query(schema);
 await client.query(`CREATE ROLE mf_t1c_auth_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE mf_t1c_intent_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
GRANT USAGE ON SCHEMA mf_t1c TO mf_t1c_intent_runtime;
GRANT SELECT ON mf_t1c.intents,mf_t1c.wallet_attempts TO mf_t1c_intent_runtime;`);

 const migration=await readFile(new URL('./supabase/006_testnet_single_meal_writer.sql',import.meta.url),'utf8');
 // Exercise the real SQL, not a hand-maintained imitation.
 assert.ok(migration.includes('CREATE ROLE mf_t1d_fund_runtime NOLOGIN'));
 assert.ok(!/GRANT\s+(?:SELECT|INSERT|UPDATE)[^;]*TO\s+mf_t1c_intent_runtime/i.test(migration),
  'READONLY_ROLE_ESCALATION_ATTEMPT');
 await client.query(migration);

 const {rows:[role]}=await client.query(
  "SELECT rolcanlogin,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb "+
  "FROM pg_roles WHERE rolname='mf_t1d_fund_runtime'"
 );
 assert.ok(role,'T1D_ROLE_NOT_CREATED');
 assert.equal(role.rolcanlogin,false);
 assert.equal(role.rolsuper,false);
 assert.equal(role.rolbypassrls,false);
 assert.equal(role.rolcreaterole,false);
 assert.equal(role.rolcreatedb,false);

 const {rows:[p]}=await client.query(`SELECT
 has_table_privilege('mf_t1d_fund_runtime','mf_t1c.intents','INSERT') AS fund_can_insert,
 has_table_privilege('mf_t1d_fund_runtime','mf_t1c.intents','SELECT') AS fund_can_select,
 has_column_privilege('mf_t1d_fund_runtime','mf_t1c.intents','stage','UPDATE') AS fund_can_update_stage,
 has_column_privilege('mf_t1d_fund_runtime','mf_t1c.intents','payer','UPDATE') AS fund_can_update_payer,
 has_table_privilege('mf_t1d_fund_runtime','mf_t1c.intents','DELETE') AS fund_can_delete,
 has_table_privilege('mf_t1d_fund_runtime','mf_t1c.wallet_attempts','INSERT') AS fund_can_insert_attempt,
 has_table_privilege('mf_t1d_fund_runtime','mf_t1c.audit_events','INSERT') AS fund_can_audit,
 has_table_privilege('mf_t1d_fund_runtime','mf_cp31_auth_pilot.sessions','SELECT') AS fund_can_read_auth,
 has_table_privilege('mf_t1c_intent_runtime','mf_t1c.intents','INSERT') AS old_role_can_insert,
 has_column_privilege('mf_t1c_intent_runtime','mf_t1c.intents','stage','UPDATE') AS old_role_can_update,
 has_table_privilege('mf_t1c_auth_runtime','mf_t1c.intents','SELECT') AS auth_can_read_funds`);
 for(const property of [
  'fund_can_insert','fund_can_select','fund_can_update_stage','fund_can_insert_attempt','fund_can_audit'
 ])assert.equal(p[property],true,property);
 for(const property of [
  'fund_can_update_payer','fund_can_delete','fund_can_read_auth','old_role_can_insert',
  'old_role_can_update','auth_can_read_funds'
 ])assert.equal(p[property],false,property);

 // Execute the unchanged PR32-derived migration for append-only signature
 // handoff against disposable PG17. It may not touch the T1-C roles.
 const quoteMigration=await readFile(new URL('./supabase/007_testnet_quote_authorizations.sql',import.meta.url),'utf8');
 await client.query(quoteMigration);
 const q=await client.query(`SELECT
  has_table_privilege('mf_t1d_fund_runtime','mf_t1c.quote_authorizations','SELECT') AS writer_read,
  has_table_privilege('mf_t1d_fund_runtime','mf_t1c.quote_authorizations','INSERT') AS writer_insert,
  has_table_privilege('mf_t1d_fund_runtime','mf_t1c.quote_authorizations','DELETE') AS writer_delete,
  has_table_privilege('mf_t1c_intent_runtime','mf_t1c.quote_authorizations','SELECT') AS old_reader_read,
  has_table_privilege('mf_t1c_auth_runtime','mf_t1c.quote_authorizations','SELECT') AS auth_read,
  has_table_privilege('anon','mf_t1c.quote_authorizations','SELECT') AS anon_read,
  (SELECT count(*) FROM mf_t1c.quote_authorizations) AS signed_quotes`);
 assert.deepEqual(q.rows[0],{
  writer_read:true,writer_insert:true,writer_delete:false,
  old_reader_read:false,auth_read:false,anon_read:false,signed_quotes:'0'
 });
 console.log(JSON.stringify({
  status:'T1D_EXACT_APPEND_ONLY_SIGNED_QUOTE_MIGRATION_PG17_PASS',
  newFundingRoleHasOnlyReadInsert:true,
  originalReadonlyRoleCannotReadQuote:true,
  signedQuotes:0
 }));
 // The exact 008 migration is tested on disposable PG17; all previous
 // T1-C Sessions and the two original cloud roles stay untouched.
 const isolatedAuth=await readFile(new URL('./supabase/008_t1d_isolated_siwe_auth.sql',import.meta.url),'utf8');
 await client.query(isolatedAuth);
 const authGrants=await client.query(`SELECT
  (SELECT rolcanlogin FROM pg_roles WHERE rolname='mf_t1d_auth_runtime') AS can_login,
  has_table_privilege('mf_t1d_auth_runtime','mf_t1d_auth.sessions','SELECT') AS can_read_new,
  has_table_privilege('mf_t1d_auth_runtime','mf_t1d_auth.sessions','INSERT') AS can_insert_new,
  has_table_privilege('mf_t1d_auth_runtime','mf_t1d_auth.sessions','UPDATE') AS can_update_new,
  has_table_privilege('mf_t1d_auth_runtime','mf_t1d_auth.sessions','DELETE') AS can_delete_new,
  has_schema_privilege('mf_t1d_auth_runtime','mf_cp31_auth_pilot','USAGE') AS new_sees_old,
  has_schema_privilege('mf_t1c_auth_runtime','mf_t1d_auth','USAGE') AS old_sees_new,
  has_schema_privilege('mf_t1d_fund_runtime','mf_t1d_auth','USAGE') AS funding_sees_auth,
  has_schema_privilege('mf_t1d_auth_runtime','mf_t1c','USAGE') AS auth_sees_funding,
  (SELECT count(*) FROM mf_t1d_auth.sessions) AS sessions`);
 assert.deepEqual(authGrants.rows[0],{
  can_login:false,can_read_new:true,can_insert_new:true,
  can_update_new:true,can_delete_new:false,new_sees_old:false,
  old_sees_new:false,funding_sees_auth:false,auth_sees_funding:false,
  sessions:'0'
 });

 // Create disposable login identity only in GitHub Docker and verify the
 // unmodified original EIP-191 challenge semantics on the new schema.
 await client.query(`CREATE ROLE mf_t1d_ci_auth LOGIN NOINHERIT
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS
  PASSWORD 't1d-ci-new-auth-only';
  GRANT CONNECT ON DATABASE postgres TO mf_t1d_ci_auth;
  GRANT USAGE ON SCHEMA mf_t1d_auth TO mf_t1d_ci_auth;
  GRANT SELECT ON mf_t1d_auth.schema_version TO mf_t1d_ci_auth;
  GRANT SELECT,INSERT,UPDATE ON mf_t1d_auth.pre_sessions,
  mf_t1d_auth.challenges,mf_t1d_auth.sessions TO mf_t1d_ci_auth;
  CREATE ROLE mf_t1d_ci_fund LOGIN NOINHERIT
   NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS
   PASSWORD 't1d-ci-new-fund-only';
  GRANT CONNECT ON DATABASE postgres TO mf_t1d_ci_fund;
  GRANT USAGE ON SCHEMA mf_t1c TO mf_t1d_ci_fund;
  GRANT SELECT,INSERT ON mf_t1c.intents,mf_t1c.wallet_attempts TO mf_t1d_ci_fund;
  GRANT UPDATE(stage,revision,quote_digest,quote_signature_hash)
   ON mf_t1c.intents TO mf_t1d_ci_fund;
  GRANT UPDATE(status,tx_hash,receipt_block,receipt_block_hash,receipt_status)
   ON mf_t1c.wallet_attempts TO mf_t1d_ci_fund;
  GRANT SELECT,INSERT ON mf_t1c.audit_events,mf_t1c.quote_authorizations
   TO mf_t1d_ci_fund;
  GRANT USAGE,SELECT ON SEQUENCE mf_t1c.audit_events_event_id_seq
   TO mf_t1d_ci_fund;`);
 const authPool=new pg.Pool({
  connectionString:'postgres://mf_t1d_ci_auth:t1d-ci-new-auth-only@127.0.0.1:5433/postgres',
  max:3,connectionTimeoutMillis:3000
 });
 try{
  const store=pgStoreT1D(authPool);
  assert.equal(await store.health(),true);
  const now=Math.floor(Date.now()/1000);
  const sh=()=>createHash('sha256').update(randomBytes(32)).digest('hex');
  const preHash=sh(),csrfHash=sh();
  const w=Wallet.createRandom();
  const challenge=makeChallenge({
   wallet:w.address.toLowerCase(),
   origin:'https://mealforward-t1d-funding-laodao.onrender.com',
   chainId:10143,nonce:randomBytes(32).toString('hex'),
   challengeId:randomUUID(),issuedAt:now,expiresAt:now+180
  });
  await store.createPre({preHash,csrfHash,expiresAt:now+300});
  const created=await store.createChallenge({preHash,csrfHash,challenge,now});
  assert.equal(created,true);
  const reread=await store.getChallenge({
   preHash,csrfHash,challengeId:challenge.challengeId,now
  });
  assert.equal(reread.message,challenge.message);
  const signed=await w.signMessage(challenge.message);
  assert.equal(await verifyChallenge(reread,signed,now),w.address.toLowerCase());
  const sessionHash=sh(),sessionCsrfHash=sh();
  assert.equal(await store.consumeAndCreateSession({
   preHash,csrfHash,challenge,sessionHash,sessionCsrfHash,
   wallet:w.address.toLowerCase(),expiresAt:now+3600,now
  }),true);
  assert.equal((await store.getSession(sessionHash,now))?.wallet,w.address.toLowerCase());
  assert.equal(await store.revokeSession(sessionHash,sessionCsrfHash,now),true);
  assert.equal(await store.getSession(sessionHash,now),null);
  // The formerly leaked T1-C credentials could still access their own
  // separate test schema, but NEVER T1-D sessions.
  assert.equal((await client.query(
   "SELECT count(*)::int AS n FROM mf_cp31_auth_pilot.sessions"
  )).rows[0].n,0);
  console.log(JSON.stringify({
   status:'T1D_ISOLATED_PRIVATE_SIWE_EIP191_PG17_PASS',
   existingT1CAuthSchemaUntouched:true,newRoleCanLogin:false,
   oldAuthCannotReadOrForgeNew:true,
   fundingRoleCannotReadSessions:true,actualTestnetSessionsCreated:0,
   disposableOnly:true
  }));
 }finally{await authPool.end()}
 console.log(JSON.stringify({
  status:'T1D_EXACT_NOLOGIN_WRITER_MIGRATION_DISPOSABLE_PG17_PASS',
  originalReadonlyPrincipalUntouched:true,
  newFundingPrincipalCanLogin:false,
  postgresVersion:env.rows[0].version,
  noHistoricalData:true
 }));
}finally{await client.end().catch(()=>{})}
