-- MealForward T1-D · ONE 7 Test USDC funding wallet demo ONLY.
-- New dedicated PG role; DO NOT promote the live T1-C SELECT-only role.
-- No historical CP30 data, real-money chain, signer key or wallet password.
--
-- This creates NOLOGIN identity only. An authorized owner must independently
-- activate its credentials and point a NEW isolated T1-D Render service at it.
-- Preserve the existing T1-C service and mf_t1c_intent_runtime unchanged.
--
-- The migration must be applied to the verified isolated
-- mealforward-t1-staging project, never to the old Mac or Render G0 PG.
DO $gate$
BEGIN
 IF current_database()<>'postgres'
    OR current_setting('server_version_num')::int < 170000
    OR to_regclass('mf_t1c.intents') IS NULL
    OR to_regclass('mf_t1c.wallet_attempts') IS NULL
    OR to_regclass('mf_t1c.audit_events') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mf_t1c_auth_runtime' AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls)
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mf_t1c_intent_runtime' AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls)
    OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mf_t1d_fund_runtime')
    OR has_table_privilege('mf_t1c_intent_runtime','mf_t1c.intents','INSERT')
    OR has_column_privilege('mf_t1c_intent_runtime','mf_t1c.intents','stage','UPDATE')
    OR has_table_privilege('mf_t1c_auth_runtime','mf_t1c.intents','SELECT')
 THEN RAISE EXCEPTION 'T1D_ISOLATED_READONLY_BASELINE_REQUIRED'; END IF;
 IF EXISTS (SELECT 1 FROM mf_t1c.intents LIMIT 1)
    OR EXISTS (SELECT 1 FROM mf_t1c.wallet_attempts LIMIT 1)
    OR EXISTS (SELECT 1 FROM mf_t1c.audit_events LIMIT 1)
 THEN RAISE EXCEPTION 'T1D_EXPECTED_EMPTY_TESTNET_FUNDING_LEDGER'; END IF;
END $gate$;

CREATE ROLE mf_t1d_fund_runtime NOLOGIN NOINHERIT
 NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT CONNECT ON DATABASE postgres TO mf_t1d_fund_runtime;
GRANT USAGE ON SCHEMA mf_t1c TO mf_t1d_fund_runtime;

-- Read ONLY the original immutable T1-C funding ledger; the new role
-- cannot read Auth Sessions or operate on other business/CP30 schemas.
GRANT SELECT ON mf_t1c.intents,mf_t1c.wallet_attempts
 TO mf_t1d_fund_runtime;
GRANT INSERT ON mf_t1c.intents,mf_t1c.wallet_attempts
 TO mf_t1d_fund_runtime;

-- Database immutable triggers still enforce Quote ID, payer, amount,
-- nonce, stage progression and append-only original TX identity.
GRANT UPDATE(stage,revision,quote_digest,quote_signature_hash)
 ON mf_t1c.intents TO mf_t1d_fund_runtime;
GRANT UPDATE(status,tx_hash,receipt_block,receipt_block_hash,receipt_status)
 ON mf_t1c.wallet_attempts TO mf_t1d_fund_runtime;
GRANT SELECT,INSERT ON mf_t1c.audit_events TO mf_t1d_fund_runtime;
GRANT USAGE,SELECT ON SEQUENCE mf_t1c.audit_events_event_id_seq
 TO mf_t1d_fund_runtime;

-- Never create a public data API financial writer. No DELETE/TRUNCATE,
-- Auth schema, new table DDL, role administration or BYPASSRLS privileges.
REVOKE DELETE,TRUNCATE,REFERENCES,TRIGGER
 ON mf_t1c.intents,mf_t1c.wallet_attempts,mf_t1c.audit_events
 FROM mf_t1d_fund_runtime;
REVOKE ALL ON SCHEMA mf_t1c FROM mf_t1c_auth_runtime;
REVOKE ALL ON ALL TABLES IN SCHEMA mf_t1c FROM anon,authenticated;
-- Intentionally no credential, no LOGIN and no live service restart.
