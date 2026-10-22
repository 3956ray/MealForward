/**
 * Executes the EXACT T1-D production-role migration on a separate disposable
 * PostgreSQL 17 database named "postgres" inside GitHub Actions Docker.
 * No Supabase, Render, CP30, external host, wallet or blockchain side effects.
 *
 * The production script must not escalate the original T1-C readonly principal.
 */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
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
 console.log(JSON.stringify({
  status:'T1D_EXACT_NOLOGIN_WRITER_MIGRATION_DISPOSABLE_PG17_PASS',
  originalReadonlyPrincipalUntouched:true,
  newFundingPrincipalCanLogin:false,
  postgresVersion:env.rows[0].version,
  noHistoricalData:true
 }));
}finally{await client.end().catch(()=>{})}
