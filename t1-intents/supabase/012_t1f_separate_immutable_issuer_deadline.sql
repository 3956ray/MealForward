-- T1-F: independent, immutable issue() deadline for ONE original Testnet voucher.
-- Recipient EIP-712 deadline was for initial signature verification; its
-- consent was already verified within that window and persisted.
-- Atomically store a NEW short issue deadline with original opId/nonce
-- BEFORE presenting the transaction to the actual Issuer's wallet.
-- No grant to T1-C/T1-D, no funding, no payout, no original contract changes.
BEGIN;
DO $gate$
BEGIN
 IF current_database()<>'postgres'
 OR current_setting('server_version_num')::integer<170000
 OR to_regclass('mf_t1e.recipient_claims') IS NULL
 OR to_regclass('mf_t1e.consent_rounds') IS NULL
 OR to_regclass('mf_t1e.claim_events') IS NULL
 OR to_regclass('mf_t1c.intents') IS NULL
 OR EXISTS(SELECT 1 FROM information_schema.columns
  WHERE table_schema='mf_t1e' AND table_name='recipient_claims'
   AND column_name='issuer_issue_deadline')
 OR (SELECT count(*) FROM mf_t1c.intents
     WHERE intent_id='2b9ae6f1-2bb7-4096-8136-70f30f302eea'::uuid
     AND stage='FUNDED' AND amount=7000000 AND quantity=1)<>1
 OR (SELECT count(*) FROM mf_t1e.recipient_claims)>1
 OR EXISTS(SELECT 1 FROM mf_t1e.recipient_claims WHERE
     stage IN ('ISSUE_UNKNOWN','ISSUE_HASH_BOUND','ISSUED','BLOCKED')
     OR issuer_op_id IS NOT NULL OR issuer_tx_nonce IS NOT NULL
     OR issuer_tx_data_hash IS NOT NULL OR issuer_tx_hash IS NOT NULL)
 OR EXISTS(SELECT 1 FROM mf_t1e.recipient_claims x WHERE
     x.stage='CONSENT_VERIFIED' AND NOT EXISTS(
       SELECT 1 FROM mf_t1e.consent_rounds r WHERE
       r.claim_id=x.claim_id AND r.state='VERIFIED'
       AND r.digest=x.consent_digest
       AND r.signature_fingerprint=x.consent_signature_fingerprint))
 OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE
     rolname='mf_t1e_claim_runtime' AND NOT rolsuper AND NOT rolbypassrls)
 OR has_schema_privilege('mf_t1e_claim_runtime','mf_t1c','USAGE')
 OR has_schema_privilege('mf_t1e_auth_runtime','mf_t1e','USAGE')
 THEN RAISE EXCEPTION 'T1F_ORIGINAL_CONSENTED_STAGING_GATE_FAILED'; END IF;
END $gate$;

ALTER TABLE mf_t1e.recipient_claims
 ADD COLUMN issuer_issue_deadline bigint
 CHECK(issuer_issue_deadline IS NULL OR issuer_issue_deadline BETWEEN 1 AND 9999999999);
ALTER TABLE mf_t1e.recipient_claims
 ADD CONSTRAINT t1f_deadline_required_for_issuer_operation CHECK(
   (stage IN ('PREPARED','CONSENT_VERIFIED') AND issuer_issue_deadline IS NULL)
   OR (stage IN ('ISSUE_UNKNOWN','ISSUE_HASH_BOUND','ISSUED')
       AND issuer_issue_deadline IS NOT NULL)
   OR stage='BLOCKED'
 );
CREATE FUNCTION mf_t1e.issuer_issue_deadline_guard() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
DECLARE now_epoch bigint;
BEGIN
 IF OLD.issuer_issue_deadline IS NOT NULL AND
    NEW.issuer_issue_deadline IS DISTINCT FROM OLD.issuer_issue_deadline
 THEN RAISE EXCEPTION USING ERRCODE='P0001',
   MESSAGE='T1F_IMMUTABLE_ISSUE_DEADLINE'; END IF;
 IF OLD.stage='CONSENT_VERIFIED' AND NEW.stage='ISSUE_UNKNOWN' THEN
  now_epoch=extract(epoch from clock_timestamp())::bigint;
  IF NEW.issuer_issue_deadline IS NULL
     OR NEW.issuer_issue_deadline<now_epoch+90
     OR NEW.issuer_issue_deadline>now_epoch+620
  THEN RAISE EXCEPTION USING ERRCODE='P0001',
    MESSAGE='T1F_FRESH_ISSUER_DEADLINE_REQUIRED'; END IF;
 ELSIF OLD.stage IN ('PREPARED','CONSENT_VERIFIED') AND
       NEW.issuer_issue_deadline IS NOT NULL
 THEN RAISE EXCEPTION USING ERRCODE='P0001',
   MESSAGE='T1F_NO_ISSUE_DEADLINE_BEFORE_RESERVATION'; END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER t1f_issuer_deadline_guard
 BEFORE UPDATE ON mf_t1e.recipient_claims FOR EACH ROW
 EXECUTE FUNCTION mf_t1e.issuer_issue_deadline_guard();
REVOKE ALL ON FUNCTION mf_t1e.issuer_issue_deadline_guard()
 FROM PUBLIC,anon,authenticated,service_role;
GRANT UPDATE(issuer_issue_deadline) ON mf_t1e.recipient_claims TO mf_t1e_claim_runtime;
COMMENT ON COLUMN mf_t1e.recipient_claims.issuer_issue_deadline IS
 'Immutable original issuer issue() transaction deadline, NOT the recipient signing deadline.';
COMMIT;