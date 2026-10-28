/** Isolated MVP SIWE storage. Derived from reviewed auth/t1e-db.mjs queries; only the fixed schema changes. No old-schema access or runtime DDL. */
async function insertChallengeLocked(
  client,
  { preHash, csrfHash, challenge, now },
) {
  const parent = await client.query(
    `SELECT pre_hash FROM mf_mvp.pre_sessions
    WHERE pre_hash=$1 AND csrf_hash=$2 AND expires_at>$3 AND NOT used
    FOR UPDATE`,
    [preHash, csrfHash, now],
  );
  if (parent.rowCount !== 1) return false;
  const existing = await client.query(
    "SELECT count(*)::int AS n FROM mf_mvp.challenges WHERE pre_hash=$1",
    [preHash],
  );
  if (existing.rows[0].n >= 3) return false;
  const result = await client.query(
    `INSERT INTO mf_mvp.challenges
    (id,pre_hash,csrf_hash,payload,expires_at)
    VALUES($1::uuid,$2,$3,$4::jsonb,$5::bigint)
    ON CONFLICT DO NOTHING RETURNING id`,
    [
      challenge.challengeId,
      preHash,
      csrfHash,
      JSON.stringify(challenge),
      challenge.expiresAt,
    ],
  );
  return result.rowCount === 1;
}

export function pgAuthStore(pool) {
  return {
    async health() {
      try {
        const q = await pool.query(
          "SELECT 1 FROM mf_mvp.schema_version WHERE version=1",
        );
        return q.rowCount === 1;
      } catch {
        return false;
      }
    },
    async createPre({ preHash, csrfHash, expiresAt }) {
      await pool.query(
        "INSERT INTO mf_mvp.pre_sessions(pre_hash,csrf_hash,expires_at) VALUES($1,$2,$3)",
        [preHash, csrfHash, expiresAt],
      );
    },
    async createChallenge({ preHash, csrfHash, challenge, now }) {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const accepted = await insertChallengeLocked(c, {
          preHash,
          csrfHash,
          challenge,
          now,
        });
        await c.query("COMMIT");
        return accepted;
      } catch (e) {
        await c.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
    async getChallenge({ preHash, csrfHash, challengeId, now }) {
      const r = await pool.query(
        `SELECT x.payload FROM mf_mvp.challenges x JOIN mf_mvp.pre_sessions p ON p.pre_hash=x.pre_hash
        WHERE x.id=$1::uuid AND x.pre_hash=$2 AND x.csrf_hash=$3 AND x.expires_at>$4 AND NOT x.used AND p.csrf_hash=$3 AND p.expires_at>$4 AND NOT p.used`,
        [challengeId, preHash, csrfHash, now],
      );
      return r.rows[0]?.payload || null;
    },
    async consumeAndCreateSession({
      preHash,
      csrfHash,
      challenge,
      sessionHash,
      sessionCsrfHash,
      wallet,
      expiresAt,
      now,
    }) {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const p = await c.query(
          "UPDATE mf_mvp.pre_sessions SET used=true WHERE pre_hash=$1 AND csrf_hash=$2 AND expires_at>$3 AND NOT used RETURNING pre_hash",
          [preHash, csrfHash, now],
        );
        if (p.rowCount !== 1) {
          await c.query("ROLLBACK");
          return false;
        }
        const x = await c.query(
          `UPDATE mf_mvp.challenges SET used=true WHERE id=$1::uuid AND pre_hash=$2 AND csrf_hash=$3 AND NOT used AND expires_at>$4 AND payload=$5::jsonb RETURNING id`,
          [
            challenge.challengeId,
            preHash,
            csrfHash,
            now,
            JSON.stringify(challenge),
          ],
        );
        if (x.rowCount !== 1) {
          await c.query("ROLLBACK");
          return false;
        }
        await c.query(
          "INSERT INTO mf_mvp.sessions(token_hash,csrf_hash,wallet,expires_at) VALUES($1,$2,$3,$4)",
          [sessionHash, sessionCsrfHash, wallet, expiresAt],
        );
        await c.query("COMMIT");
        return true;
      } catch (e) {
        await c.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
    async getSession(hash, now) {
      const r = await pool.query(
        "SELECT wallet FROM mf_mvp.sessions WHERE token_hash=$1 AND expires_at>$2 AND NOT revoked",
        [hash, now],
      );
      return r.rows[0] || null;
    },
    // Claim endpoints require BOTH HttpOnly session cookie and same-origin
    // per-session CSRF. Never trust a frontend wallet address.
    async getSessionWithCsrf(hash, csrfHash, now) {
      const r = await pool.query(
        "SELECT wallet FROM mf_mvp.sessions WHERE token_hash=$1 AND csrf_hash=$2 AND expires_at>$3 AND NOT revoked",
        [hash, csrfHash, now],
      );
      return r.rows[0] || null;
    },
    async revokeSession(hash, csrfHash, now) {
      const r = await pool.query(
        "UPDATE mf_mvp.sessions SET revoked=true WHERE token_hash=$1 AND csrf_hash=$2 AND expires_at>$3 AND NOT revoked",
        [hash, csrfHash, now],
      );
      return r.rowCount === 1;
    },
  };
}
