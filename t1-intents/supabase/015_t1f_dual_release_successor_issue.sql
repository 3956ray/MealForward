-- T1-F / 015 Phase3: source-only separation of independent two-party
-- recovery release and a SINGLE successor issue operation. ZERO RUNTIME GRANTS.
-- THIS IS NOT AUTHORIZATION TO APPLY LIVE. Original Claim remains ISSUE_UNKNOWN.
-- Owner+donor signed EIP712 release must be verified BY A REVIEWED SERVICE
-- BEFORE the trusted review authority inserts a release attestation.
BEGIN;
DO $gate$
BEGIN
 IF current_database()<>'postgres'
 OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
 OR to_regclass('mf_t1e.issuer_issue_attempts') IS NULL
 OR to_regclass('mf_t1e.expired_issue_reviews') IS NULL
 OR to_regclass('mf_t1e.successor_issue_releases') IS NOT NULL
 OR to_regclass('mf_t1e.successor_issue_operations') IS NOT NULL
 OR to_regclass('mf_t1e.successor_issue_events') IS NOT NULL
 OR (SELECT count(*) FROM mf_t1e.recipient_claims)<>1
 OR (SELECT count(*) FROM mf_t1e.recipient_claims WHERE
      claim_id='fbab3b22-965d-44e2-b144-d7307b7aa8ea'::uuid
      AND stage='ISSUE_UNKNOWN' AND revision=2
      AND issuer_op_id ~ '^0x[0-9a-f]{64}$'
      AND issuer_tx_nonce>=0 AND issuer_issue_deadline>0
      AND issuer_tx_data_hash ~ '^0x[0-9a-f]{64}$'
      AND issuer_tx_hash IS NULL AND receipt_block IS NULL
      AND consent_digest IS NOT NULL AND consent_signature_fingerprint IS NOT NULL)<>1
 OR (SELECT count(*) FROM mf_t1e.issuer_issue_attempts
     WHERE stage='REVIEW_HOLD' AND successor_operation_id IS NULL
       AND successor_nonce IS NULL AND successor_tx_hash IS NULL
       AND security_release_id IS NULL AND may_sign_or_broadcast=false)<>1
 OR (SELECT count(*) FROM mf_t1e.issuer_issue_attempts)<>1
 OR (SELECT count(*) FROM mf_t1e.expired_issue_reviews
     WHERE review_state='MANUAL_REVIEW_ONLY_NO_NEW_ISSUE'
       AND may_broadcast_transaction=false)<>1
 OR (SELECT count(*) FROM mf_t1c.intents WHERE
      intent_id='2b9ae6f1-2bb7-4096-8136-70f30f302eea'::uuid
      AND stage='FUNDED' AND amount=7000000 AND quantity=1)<>1
 OR has_schema_privilege('mf_t1e_claim_runtime','mf_t1c','USAGE')
 OR has_schema_privilege('mf_t1e_auth_runtime','mf_t1e','USAGE')
 THEN RAISE EXCEPTION 'T1F_015_PINNED_REVIEW_AND_ORIGINAL_GATE_FAILED'; END IF;
END $gate$;

-- These are *sealed receipts* of an independently verified EIP-712 release.
-- Raw signatures must NOT be stored. Fingerprints alone do NOT prove
-- cryptographic validation: a future release service must verify two
-- independent actual signers BEFORE any insert. No runtime has INSERT here.
CREATE TABLE mf_t1e.successor_issue_releases(
 release_id uuid PRIMARY KEY,
 claim_id uuid NOT NULL UNIQUE REFERENCES mf_t1e.recipient_claims(claim_id)
  ON DELETE RESTRICT CHECK(claim_id='fbab3b22-965d-44e2-b144-d7307b7aa8ea'::uuid),
 slot_id uuid NOT NULL UNIQUE REFERENCES mf_t1e.issuer_issue_attempts(attempt_id)
  ON DELETE RESTRICT,
 review_id uuid NOT NULL UNIQUE REFERENCES mf_t1e.expired_issue_reviews(review_id)
  ON DELETE RESTRICT,
 candidate_op_id text NOT NULL UNIQUE CHECK(candidate_op_id ~ '^0x[0-9a-f]{64}$'
 ),
 candidate_issuer_nonce bigint NOT NULL CHECK(candidate_issuer_nonce>=0),
 candidate_issue_deadline bigint NOT NULL CHECK(candidate_issue_deadline>0),
 nonce_domain text NOT NULL UNIQUE CHECK(nonce_domain ~ '^0x[0-9a-f]{64}$'),
 approval_expires_at bigint NOT NULL CHECK(approval_expires_at>0),
 observed_block_number bigint NOT NULL CHECK(observed_block_number>0),
 observed_block_hash text NOT NULL CHECK(observed_block_hash ~ '^0x[0-9a-f]{64}$'),
 owner_wallet text NOT NULL
  CHECK(owner_wallet='0xc4f8a468f10d5f98dcff3282516125e97f26433b'),
 donor_wallet text NOT NULL
  CHECK(donor_wallet='0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952'),
 signed_payload_digest text NOT NULL UNIQUE
  CHECK(signed_payload_digest ~ '^0x[0-9a-f]{64}$'),
 owner_signature_fingerprint text NOT NULL
  CHECK(owner_signature_fingerprint ~ '^0x[0-9a-f]{64}$'),
 donor_signature_fingerprint text NOT NULL
  CHECK(donor_signature_fingerprint ~ '^0x[0-9a-f]{64}$'),
 signer_verification_version text NOT NULL
  CHECK(signer_verification_version='T1F_EIP712_TWO_INDEPENDENT_EOA_V1'),
 stage text NOT NULL DEFAULT 'HUMAN_REVIEW_HOLD'
  CHECK(stage='HUMAN_REVIEW_HOLD'),
 may_release_to_wallet boolean NOT NULL DEFAULT false
  CHECK(may_release_to_wallet=false),
 may_broadcast_by_server boolean NOT NULL DEFAULT false
  CHECK(may_broadcast_by_server=false),
 approved_for_settlement boolean NOT NULL DEFAULT false
  CHECK(approved_for_settlement=false),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(owner_wallet,donor_wallet,candidate_issuer_nonce),
 CHECK(owner_wallet<>donor_wallet)
);
REVOKE ALL ON mf_t1e.successor_issue_releases FROM
 PUBLIC,anon,authenticated,service_role,
 mf_t1c_auth_runtime,mf_t1c_intent_runtime,
 mf_t1d_auth_runtime,mf_t1d_fund_runtime,
 mf_t1e_auth_runtime,mf_t1e_claim_runtime;

CREATE TABLE mf_t1e.successor_issue_operations(
 successor_id uuid PRIMARY KEY,
 claim_id uuid NOT NULL UNIQUE REFERENCES mf_t1e.recipient_claims(claim_id)
  ON DELETE RESTRICT CHECK(claim_id='fbab3b22-965d-44e2-b144-d7307b7aa8ea'::uuid),
 slot_id uuid NOT NULL UNIQUE REFERENCES mf_t1e.issuer_issue_attempts(attempt_id)
  ON DELETE RESTRICT,
 release_id uuid NOT NULL UNIQUE REFERENCES mf_t1e.successor_issue_releases(release_id)
  ON DELETE RESTRICT,
 chain_id integer NOT NULL DEFAULT 10143 CHECK(chain_id=10143),
 escrow text NOT NULL DEFAULT '0xcf0c8827c8610eeff1ecbd9719e559d805fafe58'
  CHECK(escrow='0xcf0c8827c8610eeff1ecbd9719e559d805fafe58'),
 voucher_id text NOT NULL UNIQUE CHECK(voucher_id ~ '^0x[0-9a-f]{64}$'),
 issuer_wallet text NOT NULL
  CHECK(issuer_wallet='0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3'),
 operation_id text NOT NULL UNIQUE CHECK(operation_id ~ '^0x[0-9a-f]{64}$'
 ),
 issuer_nonce bigint NOT NULL CHECK(issuer_nonce>=0),
 issuer_issue_deadline bigint NOT NULL CHECK(issuer_issue_deadline>0),
 calldata_hash text NOT NULL CHECK(calldata_hash ~ '^0x[0-9a-f]{64}$'),
 stage text NOT NULL DEFAULT 'ISSUE_UNKNOWN' CHECK(stage IN(
  'ISSUE_UNKNOWN','ISSUE_HASH_BOUND','ISSUED','BLOCKED')),
 tx_hash text UNIQUE CHECK(tx_hash ~ '^0x[0-9a-f]{64}$'),
 receipt_block bigint CHECK(receipt_block>=0),
 receipt_block_hash text CHECK(receipt_block_hash ~ '^0x[0-9a-f]{64}$'),
 revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(issuer_wallet,issuer_nonce),
 CHECK(
  (stage='ISSUE_UNKNOWN' AND tx_hash IS NULL AND receipt_block IS NULL
   AND receipt_block_hash IS NULL)
  OR (stage='ISSUE_HASH_BOUND' AND tx_hash IS NOT NULL
   AND receipt_block IS NULL AND receipt_block_hash IS NULL)
  OR (stage='ISSUED' AND tx_hash IS NOT NULL
   AND receipt_block IS NOT NULL AND receipt_block_hash IS NOT NULL)
  OR (stage='BLOCKED' AND receipt_block IS NULL
   AND receipt_block_hash IS NULL)
 )
);
REVOKE ALL ON mf_t1e.successor_issue_operations FROM
 PUBLIC,anon,authenticated,service_role,
 mf_t1c_auth_runtime,mf_t1c_intent_runtime,
 mf_t1d_auth_runtime,mf_t1d_fund_runtime,
 mf_t1e_auth_runtime,mf_t1e_claim_runtime;

CREATE TABLE mf_t1e.successor_issue_events(
 event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 successor_id uuid NOT NULL REFERENCES mf_t1e.successor_issue_operations(successor_id)
  ON DELETE RESTRICT,
 event_type text NOT NULL CHECK(event_type IN (
  'ISSUE_RESERVED','ISSUE_HASH_BOUND','ISSUED_CONFIRMED','ISSUE_BLOCKED')),
 tx_hash text CHECK(tx_hash ~ '^0x[0-9a-f]{64}$'),
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON mf_t1e.successor_issue_events FROM
 PUBLIC,anon,authenticated,service_role,
 mf_t1c_auth_runtime,mf_t1c_intent_runtime,
 mf_t1d_auth_runtime,mf_t1d_fund_runtime,
 mf_t1e_auth_runtime,mf_t1e_claim_runtime;

CREATE FUNCTION mf_t1e.successor_release_guard() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog AS $guard$
DECLARE parent mf_t1e.recipient_claims;
DECLARE review mf_t1e.expired_issue_reviews;
DECLARE slot mf_t1e.issuer_issue_attempts;
DECLARE ts bigint;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION USING ERRCODE='P0001',
   MESSAGE='T1F_015_APPROVAL_IMMUTABLE'; END IF;
 ts=extract(epoch from clock_timestamp())::bigint;
 SELECT * INTO parent FROM mf_t1e.recipient_claims
  WHERE claim_id=NEW.claim_id FOR SHARE;
 SELECT * INTO review FROM mf_t1e.expired_issue_reviews
  WHERE review_id=NEW.review_id AND claim_id=NEW.claim_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',
   MESSAGE='T1F_015_EXPIRED_REVIEW_REQUIRED'; END IF;
 SELECT * INTO slot FROM mf_t1e.issuer_issue_attempts
  WHERE attempt_id=NEW.slot_id AND claim_id=NEW.claim_id
   AND review_id=NEW.review_id FOR SHARE;
 IF NOT FOUND OR parent.claim_id IS NULL
  OR parent.stage<>'ISSUE_UNKNOWN' OR parent.revision<>2
  OR parent.issuer_tx_hash IS NOT NULL OR parent.receipt_block IS NOT NULL
  OR parent.receipt_block_hash IS NOT NULL
  OR parent.issuer_issue_deadline>=ts
  OR slot.stage<>'REVIEW_HOLD'
  OR slot.successor_operation_id IS NOT NULL
  OR review.original_operation_seen IS DISTINCT FROM false
  OR review.original_unit_available IS DISTINCT FROM true
  OR review.review_state<>'MANUAL_REVIEW_ONLY_NO_NEW_ISSUE'
  OR review.wallet_observation<>'OWNER_REPORTED_NO_TRANSACTIONS_VISIBLE'
  OR review.observed_issuer_latest_nonce<>parent.issuer_tx_nonce
  OR review.observed_issuer_pending_nonce<>parent.issuer_tx_nonce
  OR NEW.candidate_op_id=parent.issuer_op_id
  OR NEW.candidate_issuer_nonce<>parent.issuer_tx_nonce
  OR NEW.candidate_issue_deadline<ts+120
  OR NEW.candidate_issue_deadline>ts+600
  OR NEW.approval_expires_at<ts+90
  OR NEW.approval_expires_at>NEW.candidate_issue_deadline
 THEN RAISE EXCEPTION USING ERRCODE='P0001',
  MESSAGE='T1F_015_PINNED_DUAL_RELEASE_INVALID'; END IF;
 RETURN NEW;
END $guard$;
CREATE TRIGGER t1f_successor_release_immutable
 BEFORE INSERT OR UPDATE OR DELETE ON mf_t1e.successor_issue_releases
 FOR EACH ROW EXECUTE FUNCTION mf_t1e.successor_release_guard();

CREATE FUNCTION mf_t1e.successor_operation_guard() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog AS $guard$
DECLARE parent mf_t1e.recipient_claims;
DECLARE slot mf_t1e.issuer_issue_attempts;
DECLARE approval mf_t1e.successor_issue_releases;
DECLARE ts bigint;
BEGIN
 IF TG_OP='DELETE' THEN
  RAISE EXCEPTION USING ERRCODE='P0001',
   MESSAGE='T1F_015_OPERATION_DELETE_FORBIDDEN'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (NEW.successor_id,NEW.claim_id,NEW.slot_id,NEW.release_id,
   NEW.chain_id,NEW.escrow,NEW.voucher_id,NEW.issuer_wallet,
   NEW.operation_id,NEW.issuer_nonce,NEW.issuer_issue_deadline,
   NEW.calldata_hash,NEW.created_at) IS DISTINCT FROM
   (OLD.successor_id,OLD.claim_id,OLD.slot_id,OLD.release_id,
   OLD.chain_id,OLD.escrow,OLD.voucher_id,OLD.issuer_wallet,
   OLD.operation_id,OLD.issuer_nonce,OLD.issuer_issue_deadline,
   OLD.calldata_hash,OLD.created_at) OR
   NEW.revision<>OLD.revision+1
  THEN RAISE EXCEPTION USING ERRCODE='P0001',
   MESSAGE='T1F_015_SUCCESSOR_TX_IMMUTABLE'; END IF;
  IF OLD.tx_hash IS NOT NULL AND NEW.tx_hash IS DISTINCT FROM OLD.tx_hash
  THEN RAISE EXCEPTION USING ERRCODE='P0001',
   MESSAGE='T1F_015_BOUND_HASH_IMMUTABLE'; END IF;
  IF NOT (
   (OLD.stage='ISSUE_UNKNOWN' AND NEW.stage='ISSUE_HASH_BOUND')
   OR (OLD.stage='ISSUE_HASH_BOUND' AND NEW.stage='ISSUED')
   OR (OLD.stage<>'ISSUED' AND OLD.stage<>'BLOCKED' AND NEW.stage='BLOCKED')
  ) THEN RAISE EXCEPTION USING ERRCODE='P0001',
   MESSAGE='T1F_015_INVALID_OPERATION_TRANSITION'; END IF;
  NEW.updated_at=clock_timestamp();
  RETURN NEW;
 END IF;
 ts=extract(epoch from clock_timestamp())::bigint;
 SELECT * INTO approval FROM mf_t1e.successor_issue_releases
  WHERE release_id=NEW.release_id AND claim_id=NEW.claim_id
   AND slot_id=NEW.slot_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',
  MESSAGE='T1F_015_TWO_SIGNATURE_RELEASE_NOT_RECORDED'; END IF;
 SELECT * INTO parent FROM mf_t1e.recipient_claims
  WHERE claim_id=NEW.claim_id FOR SHARE;
 SELECT * INTO slot FROM mf_t1e.issuer_issue_attempts
  WHERE attempt_id=NEW.slot_id AND claim_id=NEW.claim_id FOR SHARE;
 IF NOT FOUND OR parent.claim_id IS NULL
  OR parent.stage<>'ISSUE_UNKNOWN' OR parent.revision<>2
  OR parent.issuer_op_id=NEW.operation_id
  OR parent.issuer_tx_hash IS NOT NULL OR parent.receipt_block IS NOT NULL
  OR slot.stage<>'REVIEW_HOLD' OR slot.successor_operation_id IS NOT NULL
  OR approval.stage IS DISTINCT FROM 'RELEASED_FOR_ONE_ISSUE'
  OR approval.may_release_to_wallet IS DISTINCT FROM true
  OR NEW.voucher_id IS DISTINCT FROM parent.voucher_id
  OR NEW.operation_id IS DISTINCT FROM approval.candidate_op_id
  OR NEW.issuer_nonce IS DISTINCT FROM approval.candidate_issuer_nonce
  OR NEW.issuer_issue_deadline IS DISTINCT FROM approval.candidate_issue_deadline
  OR NEW.issuer_issue_deadline<ts+90
  OR NEW.issuer_issue_deadline>ts+600
  OR approval.approval_expires_at<=ts
 THEN RAISE EXCEPTION USING ERRCODE='P0001',
  MESSAGE='T1F_015_DUAL_RELEASE_EXPIRED_OR_CHANGED'; END IF;
 RETURN NEW;
END $guard$;
CREATE TRIGGER t1f_successor_operation_guard
 BEFORE INSERT OR UPDATE OR DELETE ON mf_t1e.successor_issue_operations
 FOR EACH ROW EXECUTE FUNCTION mf_t1e.successor_operation_guard();

CREATE FUNCTION mf_t1e.successor_auto_audit() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog AS $audit$
BEGIN
 INSERT INTO mf_t1e.successor_issue_events(successor_id,event_type,tx_hash)
 VALUES(NEW.successor_id,
  CASE WHEN TG_OP='INSERT' THEN 'ISSUE_RESERVED'
   WHEN NEW.stage='ISSUE_HASH_BOUND' THEN 'ISSUE_HASH_BOUND'
   WHEN NEW.stage='ISSUED' THEN 'ISSUED_CONFIRMED'
   ELSE 'ISSUE_BLOCKED' END,NEW.tx_hash);
 RETURN NULL;
END $audit$;
CREATE TRIGGER t1f_successor_auto_audit
 AFTER INSERT OR UPDATE ON mf_t1e.successor_issue_operations
 FOR EACH ROW EXECUTE FUNCTION mf_t1e.successor_auto_audit();

CREATE FUNCTION mf_t1e.successor_audit_immutable() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog AS $guard$
BEGIN
 RAISE EXCEPTION USING ERRCODE='P0001',
  MESSAGE='T1F_015_SUCCESSOR_AUDIT_APPEND_ONLY';
END $guard$;
CREATE TRIGGER t1f_successor_release_no_truncate
 BEFORE TRUNCATE ON mf_t1e.successor_issue_releases
 FOR EACH STATEMENT EXECUTE FUNCTION mf_t1e.successor_audit_immutable();
CREATE TRIGGER t1f_successor_operation_no_truncate
 BEFORE TRUNCATE ON mf_t1e.successor_issue_operations
 FOR EACH STATEMENT EXECUTE FUNCTION mf_t1e.successor_audit_immutable();
CREATE TRIGGER t1f_successor_event_no_modify
 BEFORE UPDATE OR DELETE ON mf_t1e.successor_issue_events
 FOR EACH ROW EXECUTE FUNCTION mf_t1e.successor_audit_immutable();
CREATE TRIGGER t1f_successor_event_no_truncate
 BEFORE TRUNCATE ON mf_t1e.successor_issue_events
 FOR EACH STATEMENT EXECUTE FUNCTION mf_t1e.successor_audit_immutable();

REVOKE ALL ON ALL TABLES IN SCHEMA mf_t1e FROM
 PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION mf_t1e.successor_release_guard() FROM
 PUBLIC,anon,authenticated,service_role,mf_t1e_claim_runtime,mf_t1e_auth_runtime;
REVOKE ALL ON FUNCTION mf_t1e.successor_operation_guard() FROM
 PUBLIC,anon,authenticated,service_role,mf_t1e_claim_runtime,mf_t1e_auth_runtime;
REVOKE ALL ON FUNCTION mf_t1e.successor_auto_audit() FROM
 PUBLIC,anon,authenticated,service_role,mf_t1e_claim_runtime,mf_t1e_auth_runtime;
REVOKE ALL ON FUNCTION mf_t1e.successor_audit_immutable() FROM
 PUBLIC,anon,authenticated,service_role,mf_t1e_claim_runtime,mf_t1e_auth_runtime;

COMMENT ON TABLE mf_t1e.successor_issue_releases IS
 'Source-only Phase3 dual-owner+donor EIP712 verification receipts. Schema checks pinned identities but cannot cryptographically verify signatures. NO RUNTIME GRANTS and no live release. Human approval must be reverified before operations.';
COMMENT ON TABLE mf_t1e.successor_issue_operations IS
 'Source-only one successor issue operation, separate from original ISSUE_UNKNOWN Claim. Stage monotonic and single assignment of nonce/hash/receipt; no server broadcaster and no runtime grants. Never touch merchant settlement.';
COMMIT;