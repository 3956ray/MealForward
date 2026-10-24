-- T1-F Phase 2 / 014: SINGLE successor-attempt identity in REVIEW_HOLD only.
-- Migration is SOURCE-ONLY; review prerequisite 013 is not installed in live.
-- There is NO real attempt release, new tx, signer, broadcast, reset or payout.
-- Original recipient_claims row remains ISSUE_UNKNOWN for life.
BEGIN;
DO $gate$
BEGIN
 IF current_database()<>'postgres'
  OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
  OR to_regclass('mf_t1e.expired_issue_reviews') IS NULL
  OR to_regclass('mf_t1e.recipient_claims') IS NULL
  OR to_regclass('mf_t1e.consent_rounds') IS NULL
  OR to_regclass('mf_t1e.claim_events') IS NULL
  OR to_regclass('mf_t1e.issuer_issue_attempts') IS NOT NULL
  OR (SELECT count(*) FROM mf_t1c.intents
      WHERE intent_id='2b9ae6f1-2bb7-4096-8136-70f30f302eea'::uuid
      AND stage='FUNDED' AND quantity=1 AND amount=7000000)<>1
  OR (SELECT count(*) FROM mf_t1e.recipient_claims)<>1
  OR (SELECT count(*) FROM mf_t1e.recipient_claims
      WHERE claim_id='fbab3b22-965d-44e2-b144-d7307b7aa8ea'::uuid
      AND stage='ISSUE_UNKNOWN' AND revision=2
      AND issuer_op_id='0x2e709dee8113d2dac73cbea53d016d6629fc3730c6f85325a17c98bc4777445b'
      AND issuer_tx_nonce=0 AND issuer_issue_deadline=1792765625
      AND issuer_tx_data_hash='0x089cb2b0a35e81f31a9f9a658cd298ad7c9d3376ea01fac6fb77013451e1f0ed'
      AND issuer_tx_hash IS NULL AND receipt_block IS NULL
      AND receipt_block_hash IS NULL
      AND consent_digest IS NOT NULL AND consent_signature_fingerprint IS NOT NULL)<>1
  OR (SELECT count(*) FROM mf_t1e.claim_events
      WHERE claim_id='fbab3b22-965d-44e2-b144-d7307b7aa8ea'::uuid
      AND event_type='ISSUE_RESERVED')<>1
  OR (SELECT count(*) FROM mf_t1e.consent_rounds
      WHERE claim_id='fbab3b22-965d-44e2-b144-d7307b7aa8ea'::uuid
      AND state='VERIFIED')<>1
  OR has_schema_privilege('mf_t1e_claim_runtime','mf_t1c','USAGE')
  OR has_schema_privilege('mf_t1e_auth_runtime','mf_t1e','USAGE')
 THEN
  RAISE EXCEPTION 'T1F_014_ORIGINAL_SINGLE_UNKNOWN_PHASE2_GATE_FAILED';
 END IF;
END $gate$;

-- This is a LOCKED successor SLOT, not a wallet operation.
-- The next migration must independently define a reviewed, bounded
-- release/state transition; 014 itself cannot store nonce/tx/hash or send.
CREATE TABLE mf_t1e.issuer_issue_attempts (
 attempt_id uuid PRIMARY KEY,
 claim_id uuid NOT NULL UNIQUE
  REFERENCES mf_t1e.recipient_claims(claim_id) ON DELETE RESTRICT
  CHECK (claim_id='fbab3b22-965d-44e2-b144-d7307b7aa8ea'::uuid),
 review_id uuid NOT NULL UNIQUE
  REFERENCES mf_t1e.expired_issue_reviews(review_id) ON DELETE RESTRICT,
 attempt_sequence smallint NOT NULL DEFAULT 2 CHECK(attempt_sequence=2),
 chain_id integer NOT NULL DEFAULT 10143 CHECK(chain_id=10143),
 issuer_wallet text NOT NULL
  DEFAULT '0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3'
  CHECK(issuer_wallet='0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3'),
 original_operation_id text NOT NULL
  CHECK(original_operation_id='0x2e709dee8113d2dac73cbea53d016d6629fc3730c6f85325a17c98bc4777445b'),
 original_issuer_nonce bigint NOT NULL CHECK(original_issuer_nonce=0),
 original_deadline bigint NOT NULL CHECK(original_deadline=1792765625),
 original_calldata_hash text NOT NULL
  CHECK(original_calldata_hash='0x089cb2b0a35e81f31a9f9a658cd298ad7c9d3376ea01fac6fb77013451e1f0ed'),
 stage text NOT NULL DEFAULT 'REVIEW_HOLD' CHECK(stage='REVIEW_HOLD'),
 -- Explicitly NULL until an entirely DIFFERENT approved migration.
 successor_operation_id text UNIQUE CHECK(successor_operation_id IS NULL),
 successor_nonce bigint CHECK(successor_nonce IS NULL),
 successor_issue_deadline bigint CHECK(successor_issue_deadline IS NULL),
 successor_calldata_hash text CHECK(successor_calldata_hash IS NULL),
 successor_tx_hash text UNIQUE CHECK(successor_tx_hash IS NULL),
 receipt_block bigint CHECK(receipt_block IS NULL),
 receipt_block_hash text CHECK(receipt_block_hash IS NULL),
 security_release_id uuid CHECK(security_release_id IS NULL),
 may_prepare_wallet_tx boolean NOT NULL DEFAULT false
  CHECK(may_prepare_wallet_tx=false),
 may_sign_or_broadcast boolean NOT NULL DEFAULT false
  CHECK(may_sign_or_broadcast=false),
 may_mark_issued boolean NOT NULL DEFAULT false
  CHECK(may_mark_issued=false),
 legacy_claim_rewrite_allowed boolean NOT NULL DEFAULT false
  CHECK(legacy_claim_rewrite_allowed=false),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(successor_operation_id IS NULL AND successor_nonce IS NULL AND
   successor_issue_deadline IS NULL AND successor_calldata_hash IS NULL AND
   successor_tx_hash IS NULL AND receipt_block IS NULL AND
   receipt_block_hash IS NULL AND security_release_id IS NULL)
);
REVOKE ALL ON TABLE mf_t1e.issuer_issue_attempts FROM
 PUBLIC, anon, authenticated, service_role,
 mf_t1c_auth_runtime,mf_t1c_intent_runtime,
 mf_t1d_auth_runtime,mf_t1d_fund_runtime,
 mf_t1e_auth_runtime,mf_t1e_claim_runtime;

CREATE FUNCTION mf_t1e.successor_attempt_review_hold_guard()
 RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $guard$
DECLARE parent mf_t1e.recipient_claims;
DECLARE review mf_t1e.expired_issue_reviews;
BEGIN
 IF TG_OP<>'INSERT' THEN
  RAISE EXCEPTION USING ERRCODE='P0001',
   MESSAGE='T1F_014_SUCCESSOR_HOLD_IMMUTABLE';
 END IF;
 SELECT * INTO parent FROM mf_t1e.recipient_claims
   WHERE claim_id=NEW.claim_id FOR SHARE;
 SELECT * INTO review FROM mf_t1e.expired_issue_reviews
   WHERE review_id=NEW.review_id AND claim_id=NEW.claim_id FOR SHARE;
 IF NOT FOUND OR parent.claim_id IS NULL
   OR parent.stage<>'ISSUE_UNKNOWN'
   OR parent.revision<>2
   OR parent.issuer_tx_hash IS NOT NULL OR parent.receipt_block IS NOT NULL
   OR parent.receipt_block_hash IS NOT NULL
   OR review.review_state<>'MANUAL_REVIEW_ONLY_NO_NEW_ISSUE'
   OR review.wallet_observation<>'OWNER_REPORTED_NO_TRANSACTIONS_VISIBLE'
   OR review.original_operation_seen IS DISTINCT FROM false
   OR review.original_unit_available IS DISTINCT FROM true
   OR review.observed_issuer_latest_nonce<>parent.issuer_tx_nonce
   OR review.observed_issuer_pending_nonce<>parent.issuer_tx_nonce
   OR review.original_operation_id IS DISTINCT FROM parent.issuer_op_id
   OR review.original_issuer_nonce IS DISTINCT FROM parent.issuer_tx_nonce
   OR review.original_deadline IS DISTINCT FROM parent.issuer_issue_deadline
   OR review.original_calldata_hash IS DISTINCT FROM parent.issuer_tx_data_hash
   OR NEW.original_operation_id IS DISTINCT FROM parent.issuer_op_id
   OR NEW.original_issuer_nonce IS DISTINCT FROM parent.issuer_tx_nonce
   OR NEW.original_deadline IS DISTINCT FROM parent.issuer_issue_deadline
   OR NEW.original_calldata_hash IS DISTINCT FROM parent.issuer_tx_data_hash
 THEN
  RAISE EXCEPTION USING ERRCODE='P0001',
   MESSAGE='T1F_014_SUCCESSOR_ORIGINAL_REVIEW_NOT_PROVEN';
 END IF;
 RETURN NEW;
END $guard$;

CREATE TRIGGER t1f_successor_attempt_only_review_hold
 BEFORE INSERT OR UPDATE OR DELETE ON mf_t1e.issuer_issue_attempts
 FOR EACH ROW EXECUTE FUNCTION mf_t1e.successor_attempt_review_hold_guard();
CREATE TRIGGER t1f_successor_attempt_no_truncate
 BEFORE TRUNCATE ON mf_t1e.issuer_issue_attempts
 FOR EACH STATEMENT EXECUTE FUNCTION mf_t1e.claim_forbid_delete();

REVOKE ALL ON FUNCTION mf_t1e.successor_attempt_review_hold_guard() FROM
 PUBLIC,anon,authenticated,service_role,
 mf_t1e_claim_runtime,mf_t1e_auth_runtime;
COMMENT ON TABLE mf_t1e.issuer_issue_attempts IS
 'T1-F Phase2: at most one append-only successor SLOT in review hold. Not a transaction, not a reissue authorization. 015+ is a separate owner-approved security release. Original Claim and 013 review must NEVER be overwritten.';
COMMIT;