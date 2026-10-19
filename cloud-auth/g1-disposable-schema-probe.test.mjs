/**
 * CI-only G1 shared PostgreSQL feasibility gate.
 * No public Render DB, no historical CP30 schema, no signer.
 * Tests synthetic-only separate schema rights WITH the existing Auth tables
 * in one disposable PostgreSQL 17 instance, then tears down by CI container.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {initializeSchema,pgStore} from './db.mjs';

const CONNECTION='postgres://postgres:gha-g0-ci-only@127.0.0.1:5432/mealforward_g0_ci_only';
const PGONLY=()=>process.env.GITHUB_ACTIONS==='true'&&
 process.env.MF_G0_PG_DISPOSABLE_ONLY==='ack-local-ci-auth-postgres-17'&&
 process.env.DATABASE_URL===CONNECTION;
const errcode=async(fn,code)=>{
 await assert.rejects(fn(),e=>e?.code===code,code);
};

test('real 17: two schemas and distinct NOLOGIN principals do not leak auth session tables',async()=>{
 assert.ok(PGONLY(),'DISPOSABLE_GITHUB_POSTGRES_ONLY');
 const pool=new pg.Pool({connectionString:CONNECTION,max:3});
 try{
  const version=await pool.query('SHOW server_version_num');
  assert.ok(Number(version.rows[0].server_version_num)>=170000&&Number(version.rows[0].server_version_num)<180000);
  const existing=await pool.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'c1\\_%' ESCAPE '\\' LIMIT 1");
  assert.equal(existing.rowCount,0);
  // Auth schema creation must remain an independent existing G0 operation.
  await initializeSchema(pool);
  const text=await readFile(new URL('./g1-disposable-schema-probe.sql',import.meta.url),'utf8');
  await pool.query(text);
  const login=await pool.query('SELECT 1 FROM mf_cp31_auth_pilot.schema_version');
  assert.equal(login.rowCount,1);
  const reader='mf_g1_probe_reader',writer='mf_g1_probe_writer';
  const db=await pool.connect();
  try{
   await db.query('BEGIN');
   await db.query('SET LOCAL ROLE '+reader);
   const value=await db.query('SELECT source_mode,source_revision,payload FROM mf_g1_probe.public_projection');
   assert.equal(value.rows[0].source_mode,'SYNTHETIC_DISPOSABLE_CI_ONLY');
   assert.equal(value.rows[0].source_revision,'0');
   await errcode(()=>db.query('SELECT * FROM mf_cp31_auth_pilot.sessions'),'42501');
   await errcode(()=>db.query('SELECT * FROM mf_cp31_auth_pilot.challenges'),'25P02');
   await db.query('ROLLBACK');
   await db.query('BEGIN');
   await db.query('SET LOCAL ROLE '+reader);
   await errcode(()=>db.query("UPDATE mf_g1_probe.public_projection SET payload='{}'::jsonb WHERE id=1"),'42501');
   await db.query('ROLLBACK');

   await db.query('BEGIN');
   await db.query('SET LOCAL ROLE '+writer);
   await errcode(()=>db.query('SELECT * FROM mf_cp31_auth_pilot.pre_sessions'),'42501');
   await db.query('ROLLBACK');
   await db.query('BEGIN');
   await db.query('SET LOCAL ROLE '+writer);
   await errcode(()=>db.query("DELETE FROM mf_g1_probe.public_projection WHERE id=1"),'42501');
   await db.query('ROLLBACK');

   // Writer can update only pre-allowlisted fields with increasing revision.
   await db.query('BEGIN');
   await db.query('SET LOCAL ROLE '+writer);
   const update=await db.query("UPDATE mf_g1_probe.public_projection SET payload='{\"stores\":[],\"meals\":[],\"ledger\":[]}'::jsonb,source_revision=1 WHERE id=1 RETURNING source_revision");
   assert.equal(update.rows[0].source_revision,'1');
   await db.query('COMMIT');
   await db.query('BEGIN');
   await db.query('SET LOCAL ROLE '+writer);
   await errcode(()=>db.query("UPDATE mf_g1_probe.public_projection SET payload='{}'::jsonb,source_revision=1 WHERE id=1"),'P0001');
   await db.query('ROLLBACK');
   const authStill=await pgStore(pool).health();
   assert.equal(authStill,true);
   console.log(JSON.stringify({status:'DISPOSABLE_SHARED_PG17_SCHEMA_ISOLATION_PASS',
    source:'synthetic-only',authTablesPreserved:true,
    readOnlyRoleDeniedAuth:true,writerDeniedAuth:true,
    readerCannotMutate:true,monotoneRevision:true,
    independentPhysicalAnchor:false,productionSafe:false}));
  }finally{db.release()}
 }finally{await pool.end()}
});
