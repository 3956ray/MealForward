-- MealForward T1-C cloud staging: Supabase PRIVATE CP31 SIWE schema.
-- Project ref ketfrukrcuosrqynnsay (PostgreSQL17, user-approved).
-- Never import old Mac CP30 Journal, or reuse old Render G0 PostgreSQL.
-- Apply once via Supabase migration API, and only to confirmed EMPTY project.
DO $pre$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname IN ('mf_cp31_auth_pilot','mf_t1c'))
 THEN RAISE EXCEPTION 'MEALFORWARD_T1_SCHEMA_ALREADY_EXISTS_STOP'; END IF;
END $pre$;

CREATE SCHEMA mf_cp31_auth_pilot;
REVOKE ALL ON SCHEMA mf_cp31_auth_pilot FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE mf_cp31_auth_pilot.schema_version(
 version integer PRIMARY KEY CHECK(version=1)
);
INSERT INTO mf_cp31_auth_pilot.schema_version(version) VALUES(1);

CREATE TABLE mf_cp31_auth_pilot.pre_sessions(
 pre_hash text PRIMARY KEY CHECK(pre_hash ~ '^[0-9a-f]{64}$'),
 csrf_hash text NOT NULL CHECK(csrf_hash ~ '^[0-9a-f]{64}$'),
 expires_at bigint NOT NULL CHECK(expires_at>0),
 used boolean NOT NULL DEFAULT false
);
CREATE TABLE mf_cp31_auth_pilot.challenges(
 id uuid PRIMARY KEY,
 pre_hash text NOT NULL REFERENCES mf_cp31_auth_pilot.pre_sessions(pre_hash),
 csrf_hash text NOT NULL CHECK(csrf_hash ~ '^[0-9a-f]{64}$'),
 payload jsonb NOT NULL,
 expires_at bigint NOT NULL CHECK(expires_at>0),
 used boolean NOT NULL DEFAULT false
);
CREATE INDEX t1_auth_challenges_by_pre_expiry ON mf_cp31_auth_pilot.challenges(pre_hash,expires_at);
CREATE TABLE mf_cp31_auth_pilot.sessions(
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[0-9a-f]{64}$'),
 csrf_hash text NOT NULL CHECK(csrf_hash ~ '^[0-9a-f]{64}$'),
 wallet text NOT NULL CHECK(wallet ~ '^0x[0-9a-f]{40}$'),
 expires_at bigint NOT NULL CHECK(expires_at>0),
 revoked boolean NOT NULL DEFAULT false
);
CREATE INDEX t1_auth_sessions_expiry_active ON mf_cp31_auth_pilot.sessions(expires_at) WHERE NOT revoked;

-- No public Data API access. Only future narrow SQL LOGIN roles
-- will receive permissions; the owner postgres retains migration rights.
REVOKE ALL ON ALL TABLES IN SCHEMA mf_cp31_auth_pilot FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA mf_cp31_auth_pilot
 REVOKE ALL ON TABLES FROM PUBLIC,anon,authenticated,service_role;

-- Supabase exposes public by default. These custom schemas MUST NOT be
-- added to the project's PostgREST exposed schemas list.
COMMENT ON SCHEMA mf_cp31_auth_pilot IS
 'MealForward T1 staging G0 SIWE private digest-only login state. NOT a Data API schema; old CP30 original principal not connected.';
