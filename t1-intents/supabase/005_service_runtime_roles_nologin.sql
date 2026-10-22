-- Auth LOGIN will be enabled only after strong secrets have been generated and
-- securely bound to one new FREE Render read-only test service.
-- Keep both as NOLOGIN until that service and pooler are configured.
DO $gate$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN
  ('mf_t1c_auth_runtime','mf_t1c_intent_runtime')) THEN
  RAISE EXCEPTION 'T1C_RUNTIME_ROLES_ALREADY_PRESENT';
 END IF;
END $gate$;
CREATE ROLE mf_t1c_auth_runtime NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE mf_t1c_intent_runtime NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

GRANT CONNECT ON DATABASE postgres TO mf_t1c_auth_runtime,mf_t1c_intent_runtime;
GRANT USAGE ON SCHEMA mf_cp31_auth_pilot TO mf_t1c_auth_runtime;
GRANT SELECT ON mf_cp31_auth_pilot.schema_version TO mf_t1c_auth_runtime;
GRANT SELECT,INSERT,UPDATE ON mf_cp31_auth_pilot.pre_sessions,
 mf_cp31_auth_pilot.challenges,mf_cp31_auth_pilot.sessions TO mf_t1c_auth_runtime;
GRANT USAGE ON SCHEMA mf_t1c TO mf_t1c_intent_runtime;
GRANT SELECT ON mf_t1c.intents,mf_t1c.wallet_attempts TO mf_t1c_intent_runtime;

COMMENT ON ROLE mf_t1c_auth_runtime IS
 'MealForward independent T1-C staging Auth SIWE runtime only. No financial schema rights. NOLOGIN pending secret setup.';
COMMENT ON ROLE mf_t1c_intent_runtime IS
 'MealForward independent T1-C staging immutable-Intent SELECT only. No Auth rights. NOLOGIN pending secret setup.';
