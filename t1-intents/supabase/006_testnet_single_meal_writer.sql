-- MealForward T1-D *TESTNET-ONLY* 1 x 7 Circle Test USDC demo.
-- The deployed T0 StoreEscrow on Monad chain 10143 is not redeployed.
-- No mainnet, no real USDC, no private key/signature storage.
-- Rights attach ONLY to the preexisting testnet-app DB role.
--
-- IMPORTANT: apply only when the audited TESTNET_SINGLE_SEVEN_USDC_FUND
-- server has passed CI. Existing T1-C readonly server must switch mode
-- in the same rollout (otherwise its strict no-write startup guard fails).
DO $gate$
BEGIN
 IF current_database()<>'postgres' OR
   NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='mf_t1c') OR
   NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='mf_t1c_intent_runtime' AND
      rolcanlogin AND NOT rolsuper AND NOT rolbypassrls)
 THEN RAISE EXCEPTION 'T1D_WRITER_ROLE_OR_PROJECT_MISMATCH'; END IF;
END $gate$;

GRANT INSERT ON mf_t1c.intents,mf_t1c.wallet_attempts
 TO mf_t1c_intent_runtime;
-- The original PostgreSQL immutable triggers block changes to payer,
-- quote ID, amount, chainId, escrow, meal, nonce and original tx input.
GRANT UPDATE(stage,revision,quote_digest,quote_signature_hash)
 ON mf_t1c.intents TO mf_t1c_intent_runtime;
GRANT UPDATE(status,tx_hash,receipt_block,receipt_block_hash,receipt_status)
 ON mf_t1c.wallet_attempts TO mf_t1c_intent_runtime;
GRANT SELECT,INSERT ON mf_t1c.audit_events TO mf_t1c_intent_runtime;
GRANT USAGE,SELECT ON SEQUENCE mf_t1c.audit_events_event_id_seq
 TO mf_t1c_intent_runtime;

-- Explicitly no DELETE/TRUNCATE/DROP/CREATE/ALTER/SUPERUSER/BYPASSRLS.
REVOKE DELETE,TRUNCATE,REFERENCES,TRIGGER ON mf_t1c.intents,
 mf_t1c.wallet_attempts,mf_t1c.audit_events FROM mf_t1c_intent_runtime;

-- Existing MetaMask SIWE Auth principal has NO financial schema privileges.
REVOKE ALL ON SCHEMA mf_t1c FROM mf_t1c_auth_runtime;
REVOKE ALL ON ALL TABLES IN SCHEMA mf_t1c FROM anon,authenticated,service_role;
COMMENT ON ROLE mf_t1c_intent_runtime IS
 'T1-D Testnet 7 Test USDC only: immutable Intent+UNKNOWN and original onchain receipt indexing. Never expose this role to frontend.';
