-- MealForward Supabase private DB roles, user approved project only.
-- NOLOGIN roles are security grants, not credentials. Login must be
-- provisioned later via secure secret-management flow.
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('mf_t1c_auth_reader','mf_t1c_intent_reader')) THEN
  RAISE EXCEPTION 'T1C_READ_ROLES_ALREADY_EXIST_STOP';
 END IF;
END $$;
CREATE ROLE mf_t1c_auth_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE mf_t1c_intent_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT USAGE ON SCHEMA mf_cp31_auth_pilot TO mf_t1c_auth_reader;
GRANT SELECT ON mf_cp31_auth_pilot.schema_version,mf_cp31_auth_pilot.sessions
 TO mf_t1c_auth_reader;
GRANT USAGE ON SCHEMA mf_t1c TO mf_t1c_intent_reader;
GRANT SELECT ON mf_t1c.intents,mf_t1c.wallet_attempts TO mf_t1c_intent_reader;
-- No login role exists; nothing has been allowed to INSERT financial rows.
COMMENT ON ROLE mf_t1c_auth_reader IS 'No-login read-only Auth session verifier, T1 funds disabled';
COMMENT ON ROLE mf_t1c_intent_reader IS 'No-login read-only original Intent; no Approve, Quote or Fund';
