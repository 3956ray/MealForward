-- MealForward T1-D testnet SIWE data isolation.
-- The original T1-C authentication credentials appeared in chat and can
-- write rows in mf_cp31_auth_pilot. Therefore T1-D MUST NOT trust that schema.
-- No real wallet logins, CP30 Journal, existing sessions or money are copied.
--
-- This migration only creates a new PRIVATE schema + NOLOGIN role, and
-- never changes the old T1-C role or existing Render database configuration.
DO $preflight$
BEGIN
 IF current_database()<>'postgres' OR current_setting('server_version_num')::int<170000
 OR to_regclass('mf_cp31_auth_pilot.sessions') IS NULL
 OR to_regclass('mf_t1c.intents') IS NULL
 OR to_regclass('mf_t1c.quote_authorizations') IS NULL
 OR to_regnamespace('mf_t1d_auth') IS NOT NULL
 OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname='mf_t1d_auth_runtime')
 OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='mf_t1d_fund_runtime'
   AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls)
 OR has_table_privilege('mf_t1c_auth_runtime','mf_t1c.intents','SELECT')
 OR has_table_privilege('mf_t1c_intent_runtime','mf_t1c.intents','INSERT')
 THEN RAISE EXCEPTION 'T1D_ISOLATED_AUTH_BASELINE_REQUIRED'; END IF;
END $preflight$;

CREATE SCHEMA mf_t1d_auth;
REVOKE ALL ON SCHEMA mf_t1d_auth FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE mf_t1d_auth.schema_version(
 version integer PRIMARY KEY CHECK(version=1)
);
INSERT INTO mf_t1d_auth.schema_version(version) VALUES(1);

CREATE TABLE mf_t1d_auth.pre_sessions(
 pre_hash text PRIMARY KEY CHECK(pre_hash ~ '^[0-9a-f]{64}$'),
 csrf_hash text NOT NULL CHECK(csrf_hash ~ '^[0-9a-f]{64}$'),
 expires_at bigint NOT NULL CHECK(expires_at>0),
 used boolean NOT NULL DEFAULT false
);
CREATE TABLE mf_t1d_auth.challenges(
 id uuid PRIMARY KEY,
 pre_hash text NOT NULL REFERENCES mf_t1d_auth.pre_sessions(pre_hash),
 csrf_hash text NOT NULL CHECK(csrf_hash ~ '^[0-9a-f]{64}$'),
 payload jsonb NOT NULL,
 expires_at bigint NOT NULL CHECK(expires_at>0),
 used boolean NOT NULL DEFAULT false
);
CREATE INDEX t1d_challenges_by_pre_expiry
 ON mf_t1d_auth.challenges(pre_hash,expires_at);
CREATE TABLE mf_t1d_auth.sessions(
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[0-9a-f]{64}$'),
 csrf_hash text NOT NULL CHECK(csrf_hash ~ '^[0-9a-f]{64}$'),
 wallet text NOT NULL CHECK(wallet ~ '^0x[0-9a-f]{40}$'),
 expires_at bigint NOT NULL CHECK(expires_at>0),
 revoked boolean NOT NULL DEFAULT false
);
CREATE INDEX t1d_sessions_expiry_active
 ON mf_t1d_auth.sessions(expires_at) WHERE NOT revoked;

CREATE ROLE mf_t1d_auth_runtime NOLOGIN NOINHERIT
 NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT CONNECT ON DATABASE postgres TO mf_t1d_auth_runtime;
GRANT USAGE ON SCHEMA mf_t1d_auth TO mf_t1d_auth_runtime;
GRANT SELECT ON mf_t1d_auth.schema_version TO mf_t1d_auth_runtime;
GRANT SELECT,INSERT,UPDATE ON mf_t1d_auth.pre_sessions,
 mf_t1d_auth.challenges,mf_t1d_auth.sessions TO mf_t1d_auth_runtime;

-- Explicitly deny cross-service privileged access. T1-C cannot forge T1-D
-- login sessions; T1-D Auth cannot access original Auth or financial data.
REVOKE ALL ON SCHEMA mf_t1d_auth FROM mf_t1c_auth_runtime,
 mf_t1c_intent_runtime,mf_t1d_fund_runtime;
REVOKE ALL ON SCHEMA mf_cp31_auth_pilot FROM mf_t1d_auth_runtime;
REVOKE ALL ON SCHEMA mf_t1c FROM mf_t1d_auth_runtime;
REVOKE ALL ON ALL TABLES IN SCHEMA mf_t1d_auth FROM PUBLIC,
 anon,authenticated,service_role,mf_t1c_auth_runtime,
 mf_t1c_intent_runtime,mf_t1d_fund_runtime;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA mf_t1d_auth FROM PUBLIC,
 anon,authenticated,service_role;
COMMENT ON SCHEMA mf_t1d_auth IS
 'MealForward T1-D private SIWE digests isolated from exposed T1-C credentials. No PostgREST/Data API exposure.';
