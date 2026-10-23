-- T1-E isolated recipient+Issuer SIWE login: NEW private schema + NOLOGIN role.
-- Never share live T1-D credentials, historical CP30 sessions, or any funding
-- signing keys. Owner must activate separately after disposable-PG17 CI.
DO $gate$
BEGIN
 IF current_database()<>'postgres'
 OR current_setting('server_version_num')::integer<170000
 OR to_regclass('mf_t1e.recipient_claims') IS NULL
 OR to_regclass('mf_t1d_auth.sessions') IS NULL
 OR to_regnamespace('mf_t1e_auth') IS NOT NULL
 OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname='mf_t1e_auth_runtime')
 OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='mf_t1e_claim_runtime'
                  AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls)
 OR (SELECT count(*) FROM mf_t1e.recipient_claims)<>0
 OR (SELECT count(*) FROM mf_t1e.claim_events)<>0
 OR (SELECT count(*) FROM mf_t1c.intents WHERE stage='FUNDED')<>1
 OR has_schema_privilege('mf_t1d_fund_runtime','mf_t1e','USAGE')
 THEN RAISE EXCEPTION 'T1E_ISOLATED_SIWE_NOCLAIMS_BASELINE_REQUIRED'; END IF;
END $gate$;

CREATE SCHEMA mf_t1e_auth;
REVOKE ALL ON SCHEMA mf_t1e_auth FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE mf_t1e_auth.schema_version(
 version integer PRIMARY KEY CHECK(version=1)
);
INSERT INTO mf_t1e_auth.schema_version(version) VALUES(1);

CREATE TABLE mf_t1e_auth.pre_sessions(
 pre_hash text PRIMARY KEY CHECK(pre_hash ~ '^[0-9a-f]{64}$'),
 csrf_hash text NOT NULL CHECK(csrf_hash ~ '^[0-9a-f]{64}$'),
 expires_at bigint NOT NULL CHECK(expires_at>0),
 used boolean NOT NULL DEFAULT false
);
CREATE TABLE mf_t1e_auth.challenges(
 id uuid PRIMARY KEY,
 pre_hash text NOT NULL REFERENCES mf_t1e_auth.pre_sessions(pre_hash),
 csrf_hash text NOT NULL CHECK(csrf_hash ~ '^[0-9a-f]{64}$'),
 payload jsonb NOT NULL,
 expires_at bigint NOT NULL CHECK(expires_at>0),
 used boolean NOT NULL DEFAULT false
);
CREATE INDEX t1e_challenges_by_pre_expiry
 ON mf_t1e_auth.challenges(pre_hash,expires_at);
CREATE TABLE mf_t1e_auth.sessions(
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[0-9a-f]{64}$'),
 csrf_hash text NOT NULL CHECK(csrf_hash ~ '^[0-9a-f]{64}$'),
 wallet text NOT NULL CHECK(wallet ~ '^0x[0-9a-f]{40}$'),
 expires_at bigint NOT NULL CHECK(expires_at>0),
 revoked boolean NOT NULL DEFAULT false
);
CREATE INDEX t1e_sessions_expiry_active
 ON mf_t1e_auth.sessions(expires_at) WHERE NOT revoked;

CREATE ROLE mf_t1e_auth_runtime NOLOGIN NOINHERIT
 NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT CONNECT ON DATABASE postgres TO mf_t1e_auth_runtime;
GRANT USAGE ON SCHEMA mf_t1e_auth TO mf_t1e_auth_runtime;
GRANT SELECT ON mf_t1e_auth.schema_version TO mf_t1e_auth_runtime;
GRANT SELECT,INSERT,UPDATE ON mf_t1e_auth.pre_sessions,
 mf_t1e_auth.challenges,mf_t1e_auth.sessions TO mf_t1e_auth_runtime;

-- Explicitly deny cross-service privileged access. T1-C cannot forge T1-E
-- login sessions; T1-E Auth cannot access original Auth or financial data.
REVOKE ALL ON SCHEMA mf_t1e_auth FROM mf_t1c_auth_runtime,
 mf_t1c_intent_runtime,mf_t1d_fund_runtime,mf_t1d_auth_runtime,mf_t1e_claim_runtime;
REVOKE ALL ON SCHEMA mf_cp31_auth_pilot FROM mf_t1e_auth_runtime;
REVOKE ALL ON SCHEMA mf_t1d_auth FROM mf_t1e_auth_runtime;
REVOKE ALL ON SCHEMA mf_t1c FROM mf_t1e_auth_runtime;
REVOKE ALL ON SCHEMA mf_t1e FROM mf_t1e_auth_runtime;
REVOKE ALL ON ALL TABLES IN SCHEMA mf_t1e_auth FROM PUBLIC,
 anon,authenticated,service_role,mf_t1c_auth_runtime,
 mf_t1c_intent_runtime,mf_t1d_fund_runtime,mf_t1d_auth_runtime,mf_t1e_claim_runtime;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA mf_t1e_auth FROM PUBLIC,
 anon,authenticated,service_role;
COMMENT ON SCHEMA mf_t1e_auth IS
 'MealForward T1-E private SIWE digests isolated from exposed T1-C credentials. No PostgREST/Data API exposure.';
