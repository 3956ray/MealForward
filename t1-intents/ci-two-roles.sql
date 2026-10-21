-- DISPOSABLE-ONLY fixture: two independent application PostgreSQL identities.
-- Never execute this file on the old CP30 Mac or existing Render Auth Pilot DB.
-- Fixed passwords below are CI-only; not production credentials.
BEGIN;
CREATE ROLE mf_t1c_ci_auth LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS
 PASSWORD 't1c-ci-auth-only-local';
CREATE ROLE mf_t1c_ci_intent LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS
 PASSWORD 't1c-ci-intent-only-local';

GRANT CONNECT ON DATABASE mf_t1c_http_ci TO mf_t1c_ci_auth,mf_t1c_ci_intent;

GRANT USAGE ON SCHEMA mf_cp31_auth_pilot TO mf_t1c_ci_auth;
GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA mf_cp31_auth_pilot TO mf_t1c_ci_auth;

GRANT USAGE ON SCHEMA mf_t1c TO mf_t1c_ci_intent;
GRANT SELECT,INSERT,UPDATE ON mf_t1c.intents,mf_t1c.wallet_attempts TO mf_t1c_ci_intent;
GRANT SELECT,INSERT ON mf_t1c.audit_events TO mf_t1c_ci_intent;
GRANT USAGE,SELECT ON SEQUENCE mf_t1c.audit_events_event_id_seq TO mf_t1c_ci_intent;

-- Neither role receives TRUNCATE, DELETE, ALTER, CREATE, DDL, superuser,
-- auth-to-intent or intent-to-auth table privilege.
COMMIT;
