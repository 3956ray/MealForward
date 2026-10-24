-- T1-F expired original issue: source-only, REVIEW ONLY, NO re-issuance.
-- This does NOT reset ISSUE_UNKNOWN, original operation/nonce/deadline,
-- Recipient Consent, Fund, or transaction history. Does not authorize
-- a second issue() transaction. Never apply to live without a separate
-- migration approval and fresh public-chain/MetaMask revalidation.
BEGIN;
DO $gate$
BEGIN
 IF current_database()<>'postgres'
 OR current_setting('server_version_num')::integer<170000
 OR current_setting('server_version_num')::integer>=180000
 OR to_regclass('mf_t1e.recipient_claims') IS NULL
 OR to_regclass('mf_t1e.consent_rounds') IS NULL
 OR to_regclass('mf_t1e.claim_events') IS NULL
 OR to_regclass('mf_t1c.intents') IS NULL
 OR to_regclass('mf_t1e.expired_issue_reviews') IS NOT NULL
 OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='mf_t1e_claim_runtime'
  AND NOT rolsuper AND NOT rolbypassrls)
 OR (SELECT count(*) FROM mf_t1c.intents WHERE stage='FUNDED'
  AND intent_id='2b9ae6f1-2bb7-4096-8136-70f30f302eea'::uuid
  AND amount=7000000 AND quantity=1)<>1
 OR (SELECT count(*) FROM mf_t1e.recipient_claims)<>1
 OR (SELECT count(*) FROM mf_t1e.recipient_claims
  WHERE claim_id='fbab3b22-965d-44e2-b144-d7307b7aa8ea'::uuid
   AND stage='ISSUE_UNKNOWN' AND revision=2
   AND issuer_op_id IS NOT NULL
   AND issuer_tx_nonce IS NOT NULL
   AND issuer_tx_data_hash IS NOT NULL
   AND issuer_issue_deadline IS NOT NULL
   AND issuer_tx_hash IS NULL AND receipt_block IS NULL
   AND receipt_block_hash IS NULL
   AND consent_digest IS NOT NULL
   AND consent_signature_fingerprint IS NOT NULL)<>1
 OR (SELECT count(*) FROM mf_t1e.claim_events
   WHERE event_type='ISSUE_RESERVED'
   AND claim_id='fbab3b22-965d-44e2-b144-d7307b7aa8ea'::uuid)<>1
 OR (SELECT count(*) FROM mf_t1e.consent_rounds
   WHERE state='VERIFIED'
   AND claim_id='fbab3b22-965d-44e2-b144-d7307b7aa8ea'::uuid)<>1
 OR has_schema_privilege('mf_t1e_claim_runtime','mf_t1c','USAGE')
 OR has_schema_privilege('mf_t1e_auth_runtime','mf_t1e','USAGE')
 THEN
  RAISE EXCEPTION 'T1F_REVIEW_ONLY_EXACT_ORIGINAL_UNKNOWN_GATE';
 END IF;
END $gate$;

-- A forensic snapshot of the *original* immutable reservation.
-- No table or function can confer permission to sign/broadcast/issue.
CREATE TABLE mf_t1e.expired_issue_reviews (
 review_id uuid PRIMARY KEY,
 claim_id uuid NOT NULL UNIQUE
  REFERENCES mf_t1e.recipient_claims(claim_id) ON DELETE RESTRICT
  CHECK(claim_id='fbab3b22-965d-44e2-b144-d7307b7aa8ea'::uuid),
 original_operation_id text NOT NULL
  CHECK(original_operation_id ~ '^0x[0-9a-f]{64}$'),
 original_issuer_nonce bigint NOT NULL CHECK(original_issuer_nonce>=0),
 original_deadline bigint NOT NULL CHECK(original_deadline>0),
 original_calldata_hash text NOT NULL
  CHECK(original_calldata_hash ~ '^0x[0-9a-f]{64}$'),
 chain_id integer NOT NULL DEFAULT 10143 CHECK(chain_id=10143),
 observed_block_number bigint NOT NULL CHECK(observed_block_number>0),
 observed_block_hash text NOT NULL
  CHECK(observed_block_hash ~ '^0x[0-9a-f]{64}$'),
 observed_issuer_latest_nonce bigint NOT NULL
  CHECK(observed_issuer_latest_nonce>=0),
 observed_issuer_pending_nonce bigint NOT NULL
  CHECK(observed_issuer_pending_nonce>=observed_issuer_latest_nonce),
 original_operation_seen boolean NOT NULL,
 original_unit_available boolean NOT NULL,
 wallet_observation text NOT NULL
  CHECK(wallet_observation IN (
   'OWNER_REPORTED_NO_TRANSACTIONS_VISIBLE',
   'OWNER_FOUND_ORIGINAL_TRANSACTION',
   'OWNER_ACTIVITY_NOT_CHECKED'
  )),
 wallet_observation_is_mempool_proof boolean NOT NULL DEFAULT false
  CHECK(wallet_observation_is_mempool_proof=false),
 review_state text NOT NULL DEFAULT 'MANUAL_REVIEW_ONLY_NO_NEW_ISSUE'
  CHECK(review_state='MANUAL_REVIEW_ONLY_NO_NEW_ISSUE'),
 may_create_second_operation boolean NOT NULL DEFAULT false
  CHECK(may_create_second_operation=false),
 may_broadcast_transaction boolean NOT NULL DEFAULT false
  CHECK(may_broadcast_transaction=false),
 may_modify_original_claim boolean NOT NULL DEFAULT false
  CHECK(may_modify_original_claim=false),
 evidence_recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON TABLE mf_t1e.expired_issue_reviews FROM
 PUBLIC,anon,authenticated,service_role,
 mf_t1c_auth_runtime,mf_t1c_intent_runtime,
 mf_t1d_auth_runtime,mf_t1d_fund_runtime,
 mf_t1e_auth_runtime,mf_t1e_claim_runtime;

CREATE FUNCTION mf_t1e.expired_issue_review_guard() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog AS $audit$
DECLARE original mf_t1e.recipient_claims;
BEGIN
 IF TG_OP<>'INSERT' THEN
  RAISE EXCEPTION USING ERRCODE='P0001',
   MESSAGE='T1F_REVIEW_IMMUTABLE_NO_UPDATE_OR_DELETE';
 END IF;
 SELECT * INTO original FROM mf_t1e.recipient_claims
  WHERE claim_id=NEW.claim_id FOR SHARE;
 IF NOT FOUND
 OR original.stage<>'ISSUE_UNKNOWN'
 OR original.issuer_tx_hash IS NOT NULL
 OR original.receipt_block IS NOT NULL
 OR original.receipt_block_hash IS NOT NULL
 OR original.revision<>2
 OR NEW.original_operation_id IS DISTINCT FROM original.issuer_op_id
 OR NEW.original_issuer_nonce IS DISTINCT FROM original.issuer_tx_nonce
 OR NEW.original_deadline IS DISTINCT FROM original.issuer_issue_deadline
 OR NEW.original_calldata_hash IS DISTINCT FROM original.issuer_tx_data_hash
 THEN
  RAISE EXCEPTION USING ERRCODE='P0001',
   MESSAGE='T1F_REVIEW_ORIGINAL_IMMUTABLE_RESERVATION_MISMATCH';
 END IF;
 -- Even a perfect public RPC nonce/receipt check does not prove all nodes'
 -- mempools are empty. This is an audit observation, NEVER permission.
 RETURN NEW;
END $audit$;
CREATE TRIGGER t1f_review_guard_insert
 BEFORE INSERT ON mf_t1e.expired_issue_reviews
 FOR EACH ROW EXECUTE FUNCTION mf_t1e.expired_issue_review_guard();
CREATE TRIGGER t1f_review_guard_update_delete
 BEFORE UPDATE OR DELETE ON mf_t1e.expired_issue_reviews
 FOR EACH ROW EXECUTE FUNCTION mf_t1e.expired_issue_review_guard();
CREATE TRIGGER t1f_review_forbid_truncate
 BEFORE TRUNCATE ON mf_t1e.expired_issue_reviews
 FOR EACH STATEMENT EXECUTE FUNCTION mf_t1e.claim_forbid_delete();

REVOKE ALL ON FUNCTION mf_t1e.expired_issue_review_guard() FROM
 PUBLIC,anon,authenticated,service_role,
 mf_t1e_claim_runtime,mf_t1e_auth_runtime;
COMMENT ON TABLE mf_t1e.expired_issue_reviews IS
 'Append-only, manual, non-authoritative forensic review of one expired original Issuer reservation. This table never authorizes new Issue, nonce reset, fund or settle.';
COMMIT;