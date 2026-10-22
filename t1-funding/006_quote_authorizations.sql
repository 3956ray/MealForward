-- MealForward T1-D: AUTHORITY-signed ORIGINAL FundingQuote handoff.
-- For NEW disposable PG17.11 or new isolated Supabase Testnet staging only.
-- Raw FundingQuote signature is a short-lived PAYER-SPECIFIC testnet
-- authorization capability; never put it in public DTO/logs.
--
-- T1-B T1RoleControl signatures are deliberately incompatible and not stored.
CREATE TABLE mf_t1c.quote_authorizations(
 intent_id uuid PRIMARY KEY REFERENCES mf_t1c.intents(intent_id) ON DELETE RESTRICT,
 quote_id text NOT NULL UNIQUE CHECK (quote_id ~ '^0x[0-9a-f]{64}$'),
 signed_authority text NOT NULL
  CHECK (signed_authority='0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952'),
 quote_digest text NOT NULL CHECK (quote_digest ~ '^0x[0-9a-f]{64}$'),
 signature text NOT NULL CHECK (signature ~ '^0x[0-9a-f]{130}$'),
 signature_fingerprint text NOT NULL CHECK (signature_fingerprint ~ '^0x[0-9a-f]{64}$'),
 authorized_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION mf_t1c.enforce_frozen_funding_quote_link() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $l$
DECLARE original mf_t1c.intents;
BEGIN
 SELECT * INTO original FROM mf_t1c.intents WHERE intent_id=NEW.intent_id FOR UPDATE;
 IF NOT FOUND OR original.stage<>'QUOTE_BOUND'
  OR original.quote_id IS DISTINCT FROM NEW.quote_id
  OR original.quote_digest IS DISTINCT FROM NEW.quote_digest
  OR original.quote_signature_hash IS DISTINCT FROM NEW.signature_fingerprint
  OR original.quantity<>1 OR original.amount<>7000000
 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='T1D_SIGNED_QUOTE_NOT_ORIGINAL_INTENT'; END IF;
 RETURN NEW;
END $l$;
CREATE TRIGGER t1d_funding_quote_link BEFORE INSERT ON mf_t1c.quote_authorizations
 FOR EACH ROW EXECUTE FUNCTION mf_t1c.enforce_frozen_funding_quote_link();
CREATE INDEX t1d_quote_signatures_by_auth ON mf_t1c.quote_authorizations(signed_authority,authorized_at);
CREATE FUNCTION mf_t1c.deny_quote_rewrite() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $q$
BEGIN
 RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='T1D_ORIGINAL_SIGNED_QUOTE_APPEND_ONLY';
END $q$;
CREATE TRIGGER t1d_deny_quote_update_delete BEFORE UPDATE OR DELETE
 ON mf_t1c.quote_authorizations FOR EACH ROW
 EXECUTE FUNCTION mf_t1c.deny_quote_rewrite();
CREATE TRIGGER t1d_deny_quote_truncate BEFORE TRUNCATE
 ON mf_t1c.quote_authorizations FOR EACH STATEMENT
 EXECUTE FUNCTION mf_t1c.deny_quote_rewrite();
REVOKE ALL ON mf_t1c.quote_authorizations FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION mf_t1c.deny_quote_rewrite() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION mf_t1c.enforce_frozen_funding_quote_link() FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE mf_t1c.quote_authorizations IS
 'T1-D original signed FundingQuote bearer authorization, visible ONLY to matching payer through verified SIWE backend; old T1-B proof cannot be used.';
