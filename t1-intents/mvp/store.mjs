import { createHash, randomBytes, createHmac } from "node:crypto";
export const hash = (v) => createHash("sha256").update(v).digest("hex");
export const token = () => randomBytes(32).toString("base64url");
export const codeHash = (pepper, code) =>
  createHmac("sha256", pepper).update(code).digest("hex");
export const fail = (code, status = 409) => {
  throw Object.assign(Error(code), { code, status });
};
export const check = (condition, code, status = 409) => {
  if (!condition) fail(code, status);
};
export const json = (v) =>
  JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x));
export async function verifyRuntime(pool) {
  const r = (
    await pool.query(
      "SELECT current_user AS name,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=current_user",
    )
  ).rows[0];
  check(
    r?.name === "mf_mvp_runtime" &&
      !r.rolsuper &&
      !r.rolbypassrls &&
      !r.rolcreaterole &&
      !r.rolcreatedb,
    "UNSAFE_DB_ROLE",
    503,
  );
  const old = await pool.query(
    "SELECT nspname FROM pg_namespace WHERE nspname LIKE 'mf_%' AND nspname<>'mf_mvp' AND has_schema_privilege(current_user,oid,'USAGE')",
  );
  check(old.rowCount === 0, "OLD_SCHEMA_ACCESS", 503);
  const bad = await pool.query(
    "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='mf_mvp' AND c.relkind='r' AND (c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) OR NOT c.relrowsecurity OR has_table_privilege(current_user,c.oid,'DELETE') OR has_table_privilege(current_user,c.oid,'TRUNCATE'))",
  );
  check(bad.rowCount === 0, "UNSAFE_DB_PRIVILEGES", 503);
  check(
    !(
      await pool.query(
        "SELECT has_table_privilege(current_user,'mf_mvp.events','UPDATE') AS unsafe",
      )
    ).rows[0].unsafe,
    "MUTABLE_AUDIT",
    503,
  );
  await pool.query("SELECT revision FROM mf_mvp.state WHERE id=1");
  return true;
}
export function makeStore(pool) {
  const read = async () =>
    (await pool.query("SELECT revision,data FROM mf_mvp.state WHERE id=1"))
      .rows[0];
  return {
    pool,
    read,
    async transaction(fn) {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const row = (
          await c.query(
            "SELECT revision,data FROM mf_mvp.state WHERE id=1 FOR UPDATE",
          )
        ).rows[0];
        check(row, "STORE_UNAVAILABLE", 503);
        const out = await fn(c, row);
        await c.query(
          "UPDATE mf_mvp.state SET data=$1::jsonb,revision=revision+CASE WHEN data IS DISTINCT FROM $1::jsonb THEN 1 ELSE 0 END WHERE id=1",
          [json(row.data)],
        );
        await c.query("COMMIT");
        return out;
      } catch (e) {
        await c.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
    async operation(id) {
      return (
        await pool.query("SELECT * FROM mf_mvp.operations WHERE id=$1", [id])
      ).rows[0];
    },
    async action(action) {
      return (
        await pool.query("SELECT * FROM mf_mvp.operations WHERE action=$1", [
          action,
        ])
      ).rows[0];
    },
    async rate(key, now, limit) {
      const r = await pool.query(
        `INSERT INTO mf_mvp.rates(key,window_id,count) VALUES($1,$2,1) ON CONFLICT(key) DO UPDATE SET window_id=EXCLUDED.window_id,count=CASE WHEN mf_mvp.rates.window_id=EXCLUDED.window_id THEN mf_mvp.rates.count+1 ELSE 1 END RETURNING count`,
        [key, Math.floor(now / 60)],
      );
      check(r.rows[0].count <= limit, "RATE_LIMIT", 429);
    },
  };
}
export async function event(c, kind, id = null) {
  await c.query("INSERT INTO mf_mvp.events(kind,operation_id) VALUES($1,$2)", [
    kind,
    id,
  ]);
}
export async function putCredential(c, kind, key, data) {
  await c.query(
    "INSERT INTO mf_mvp.credentials(kind,hash,data) VALUES($1,$2,$3::jsonb) ON CONFLICT(kind,hash) DO UPDATE SET data=EXCLUDED.data",
    [kind, key, json(data)],
  );
}
export async function credential(c, kind, key) {
  return (
    await c.query(
      "SELECT data FROM mf_mvp.credentials WHERE kind=$1 AND hash=$2",
      [kind, key],
    )
  ).rows[0]?.data;
}
