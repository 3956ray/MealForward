import {randomBytes, randomUUID, createHash} from 'node:crypto';
/** Dedicated empty Render PG17 schema: never opens/copies CP30 live state. */
const schema='mf_cp31_auth_pilot';
export async function initializeSchema(pool){
  const c=await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['mf_cp31_auth_schema_v1']);
    const existing=await c.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'c1\\_%' ESCAPE '\\' LIMIT 1");
    if(existing.rows.length)throw Error('EXISTING_CP30_SCHEMA_FORBIDDEN');
    await c.query('CREATE SCHEMA IF NOT EXISTS mf_cp31_auth_pilot');
    await c.query(`CREATE TABLE IF NOT EXISTS mf_cp31_auth_pilot.schema_version (version integer PRIMARY KEY)`);
    const versions=await c.query('SELECT version FROM mf_cp31_auth_pilot.schema_version');
    if(versions.rows.length && (versions.rows.length!==1||versions.rows[0].version!==1))throw Error('UNKNOWN_SCHEMA_VERSION');
    if(!versions.rows.length)await c.query('INSERT INTO mf_cp31_auth_pilot.schema_version VALUES (1)');
    await c.query(`CREATE TABLE IF NOT EXISTS mf_cp31_auth_pilot.pre_sessions (
      pre_hash text PRIMARY KEY CHECK(length(pre_hash)=64), csrf_hash text NOT NULL CHECK(length(csrf_hash)=64),
      expires_at bigint NOT NULL, used boolean NOT NULL DEFAULT false)`);
    await c.query(`CREATE TABLE IF NOT EXISTS mf_cp31_auth_pilot.challenges (
      id uuid PRIMARY KEY, pre_hash text NOT NULL REFERENCES mf_cp31_auth_pilot.pre_sessions(pre_hash),
      csrf_hash text NOT NULL, payload jsonb NOT NULL, expires_at bigint NOT NULL,
      used boolean NOT NULL DEFAULT false)`);
    await c.query('CREATE INDEX IF NOT EXISTS cp31_challenges_pre_idx ON mf_cp31_auth_pilot.challenges(pre_hash,expires_at)');
    await c.query(`CREATE TABLE IF NOT EXISTS mf_cp31_auth_pilot.sessions (
      token_hash text PRIMARY KEY CHECK(length(token_hash)=64), csrf_hash text NOT NULL,
      wallet text NOT NULL CHECK(wallet ~ '^0x[0-9a-f]{40}$'), expires_at bigint NOT NULL,
      revoked boolean NOT NULL DEFAULT false)`);
    await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release()}
}
export function pgStore(pool){
  return {
    async health(){try{const q=await pool.query('SELECT 1 FROM mf_cp31_auth_pilot.schema_version WHERE version=1');return q.rowCount===1}catch{return false}},
    async createPre({preHash,csrfHash,expiresAt}){await pool.query('INSERT INTO mf_cp31_auth_pilot.pre_sessions(pre_hash,csrf_hash,expires_at) VALUES($1,$2,$3)',[preHash,csrfHash,expiresAt]);},
    async createChallenge({preHash,csrfHash,challenge,now}){
      const r=await pool.query(`INSERT INTO mf_cp31_auth_pilot.challenges (id,pre_hash,csrf_hash,payload,expires_at)
        SELECT $1::uuid,p.pre_hash,$3,$4::jsonb,$5::bigint FROM mf_cp31_auth_pilot.pre_sessions p
        WHERE p.pre_hash=$2 AND p.csrf_hash=$3 AND p.expires_at>$6 AND NOT p.used
          AND (SELECT count(*) FROM mf_cp31_auth_pilot.challenges x WHERE x.pre_hash=p.pre_hash)<3
        ON CONFLICT DO NOTHING`,[challenge.challengeId,preHash,csrfHash,JSON.stringify(challenge),challenge.expiresAt,now]);
      return r.rowCount===1;
    },
    async getChallenge({preHash,csrfHash,challengeId,now}){
      const r=await pool.query(`SELECT x.payload FROM mf_cp31_auth_pilot.challenges x JOIN mf_cp31_auth_pilot.pre_sessions p ON p.pre_hash=x.pre_hash
        WHERE x.id=$1::uuid AND x.pre_hash=$2 AND x.csrf_hash=$3 AND x.expires_at>$4 AND NOT x.used AND p.csrf_hash=$3 AND p.expires_at>$4 AND NOT p.used`,[challengeId,preHash,csrfHash,now]);
      return r.rows[0]?.payload||null;
    },
    async consumeAndCreateSession({preHash,csrfHash,challenge,sessionHash,sessionCsrfHash,wallet,expiresAt,now}){
      const c=await pool.connect();
      try {
        await c.query('BEGIN');
        const p=await c.query('UPDATE mf_cp31_auth_pilot.pre_sessions SET used=true WHERE pre_hash=$1 AND csrf_hash=$2 AND expires_at>$3 AND NOT used RETURNING pre_hash',[preHash,csrfHash,now]);
        if(p.rowCount!==1){await c.query('ROLLBACK');return false}
        const x=await c.query(`UPDATE mf_cp31_auth_pilot.challenges SET used=true WHERE id=$1::uuid AND pre_hash=$2 AND csrf_hash=$3 AND NOT used AND expires_at>$4 AND payload=$5::jsonb RETURNING id`,[challenge.challengeId,preHash,csrfHash,now,JSON.stringify(challenge)]);
        if(x.rowCount!==1){await c.query('ROLLBACK');return false}
        await c.query('INSERT INTO mf_cp31_auth_pilot.sessions(token_hash,csrf_hash,wallet,expires_at) VALUES($1,$2,$3,$4)',[sessionHash,sessionCsrfHash,wallet,expiresAt]);
        await c.query('COMMIT');return true;
      }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}finally{c.release()}
    },
    async getSession(hash,now){const r=await pool.query('SELECT wallet FROM mf_cp31_auth_pilot.sessions WHERE token_hash=$1 AND expires_at>$2 AND NOT revoked',[hash,now]);return r.rows[0]||null},
    async revokeSession(hash,csrfHash,now){const r=await pool.query('UPDATE mf_cp31_auth_pilot.sessions SET revoked=true WHERE token_hash=$1 AND csrf_hash=$2 AND expires_at>$3 AND NOT revoked',[hash,csrfHash,now]);return r.rowCount===1}
  };
}

// Rollback-only probe of the *real* Postgres write/read queries used before a
// wallet signature is requested. Never commits synthetic auth records.
export async function probeAuthStorage(pool,makeChallenge,origin){
  const c=await pool.connect();
  let inTransaction=false,stage='construct';
  try {
    const now=Math.floor(Date.now()/1000);
    const preHash=createHash('sha256').update(randomBytes(32)).digest('hex');
    const csrfHash=createHash('sha256').update(randomBytes(32)).digest('hex');
    const challenge=makeChallenge({wallet:'0x'+'1'.repeat(40),origin,chainId:10143,
      nonce:randomBytes(32).toString('hex'),challengeId:randomUUID(),issuedAt:now,expiresAt:now+180});
    const store=pgStore({query:(...args)=>c.query(...args)});
    stage='begin';await c.query('BEGIN');inTransaction=true;
    stage='pre_insert';await store.createPre({preHash,csrfHash,expiresAt:now+300});
    stage='challenge_insert';
    const inserted=await store.createChallenge({preHash,csrfHash,challenge,now});
    if(!inserted)throw Error('PROBE_CHALLENGE_NOT_STORED');
    stage='challenge_read';
    const stored=await store.getChallenge({preHash,csrfHash,challengeId:challenge.challengeId,now});
    if(!stored||stored.challengeId!==challenge.challengeId)throw Error('PROBE_CHALLENGE_NOT_READABLE');
    stage='rollback';await c.query('ROLLBACK');inTransaction=false;
    return true;
  }catch(e){
    const error=Error('AUTH_SQL_PROBE_FAILED');
    error.stage=stage;
    error.sqlstate=typeof e?.code==='string'&&/^[0-9A-Z]{5}$/.test(e.code)?e.code:'NONE';
    throw error;
  }finally{
    if(inTransaction)await c.query('ROLLBACK').catch(()=>{});
    c.release();
  }
}
