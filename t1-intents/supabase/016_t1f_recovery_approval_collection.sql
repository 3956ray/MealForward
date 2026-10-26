-- SOURCE ONLY. Durable OFFCHAIN approval collection, NEVER an Issue release.
-- Apply only to an independently approved database. No LOGIN or membership.
-- Cryptographic verification is the reviewed collector's responsibility;
-- fingerprints accepted by these functions are attestations, not SQL proofs.
BEGIN;
DO $gate$
BEGIN
 IF current_database()<>'postgres'
 OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
 OR to_regclass('mf_t1e.successor_issue_releases') IS NULL
 OR to_regclass('mf_t1e.successor_issue_operations') IS NULL
 OR to_regnamespace('mf_t1f_recovery') IS NOT NULL
 OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN
  ('mf_t1f_approval_owner','mf_t1f_approval_runtime'))
 THEN RAISE EXCEPTION 'T1F_016_PREREQUISITE_FAILED'; END IF;
END $gate$;
CREATE ROLE mf_t1f_approval_owner NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS
 NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE mf_t1f_approval_runtime NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS
 NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE SCHEMA mf_t1f_recovery AUTHORIZATION mf_t1f_approval_owner;
REVOKE ALL ON SCHEMA mf_t1f_recovery FROM PUBLIC;
GRANT USAGE ON SCHEMA mf_t1e,mf_t1c TO mf_t1f_approval_owner;
GRANT SELECT ON mf_t1e.recipient_claims,mf_t1e.consent_rounds,
 mf_t1e.claim_events,mf_t1e.expired_issue_reviews,mf_t1e.issuer_issue_attempts,
 mf_t1e.successor_issue_releases,mf_t1e.successor_issue_operations,
 mf_t1e.successor_issue_events,mf_t1c.intents TO mf_t1f_approval_owner;
SET LOCAL ROLE mf_t1f_approval_owner;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE FUNCTION mf_t1f_recovery.context() RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
 SET statement_timeout='5s' SET lock_timeout='2s' AS $fn$
DECLARE c mf_t1e.recipient_claims;
DECLARE r mf_t1e.expired_issue_reviews;
DECLARE s mf_t1e.issuer_issue_attempts;
BEGIN
 SELECT * INTO c FROM mf_t1e.recipient_claims
  WHERE claim_id='fbab3b22-965d-44e2-b144-d7307b7aa8ea'::uuid;
 SELECT * INTO r FROM mf_t1e.expired_issue_reviews WHERE claim_id=c.claim_id;
 SELECT * INTO s FROM mf_t1e.issuer_issue_attempts WHERE claim_id=c.claim_id;
 IF c.claim_id IS NULL OR r.review_id IS NULL OR s.attempt_id IS NULL
 OR (SELECT count(*) FROM mf_t1e.recipient_claims)<>1
 OR (SELECT count(*) FROM mf_t1e.expired_issue_reviews)<>1
 OR (SELECT count(*) FROM mf_t1e.issuer_issue_attempts)<>1
 OR c.stage IS DISTINCT FROM 'ISSUE_UNKNOWN' OR c.revision IS DISTINCT FROM 2
 OR c.issuer_op_id IS DISTINCT FROM '0x2e709dee8113d2dac73cbea53d016d6629fc3730c6f85325a17c98bc4777445b'
 OR c.issuer_tx_nonce IS DISTINCT FROM 0
 OR c.issuer_issue_deadline IS DISTINCT FROM 1792765625
 OR c.issuer_issue_deadline>=floor(extract(epoch from clock_timestamp()))
 OR c.issuer_tx_data_hash IS DISTINCT FROM '0x089cb2b0a35e81f31a9f9a658cd298ad7c9d3376ea01fac6fb77013451e1f0ed'
 OR c.issuer_tx_hash IS NOT NULL OR c.receipt_block IS NOT NULL
 OR c.receipt_block_hash IS NOT NULL OR c.consent_digest IS NULL
 OR c.consent_signature_fingerprint IS NULL
 OR c.funding_intent IS DISTINCT FROM '2b9ae6f1-2bb7-4096-8136-70f30f302eea'::uuid
 OR c.chain_id IS DISTINCT FROM 10143
 OR c.escrow IS DISTINCT FROM '0xcf0c8827c8610eeff1ecbd9719e559d805fafe58'
 OR c.meal_id IS DISTINCT FROM '0x44f977bbf22112030199e42ccf232d08fe6e8223be9c274944c8a40671f6ae6b'
 OR c.terms_hash IS DISTINCT FROM '0x0ec28ec279f5a4b4321da6d4b1698fea8e57cd8a64743de02677c73cb86a9222'
 OR c.unit_seq IS DISTINCT FROM 0 OR c.generation IS DISTINCT FROM 1
 OR c.beneficiary_wallet IS DISTINCT FROM '0x2539fefe77a5ce4d09d2225c2e8a7517b22b9135'
 OR c.issuer_wallet IS DISTINCT FROM '0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3'
 OR c.voucher_id IS DISTINCT FROM '0x170f16ef9ea00697bcfad635e33d521159db5e852b8b5499ddf8db819278b605'
 OR (SELECT count(*) FROM mf_t1e.consent_rounds WHERE claim_id=c.claim_id
   AND state='VERIFIED' AND digest=c.consent_digest
   AND signature_fingerprint=c.consent_signature_fingerprint)<>1
 OR (SELECT count(*) FROM mf_t1e.claim_events WHERE claim_id=c.claim_id
   AND event_type='ISSUE_RESERVED')<>1
 OR (SELECT count(*) FROM mf_t1c.intents)<>1
 OR (SELECT count(*) FROM mf_t1c.intents WHERE intent_id=c.funding_intent
  AND stage='FUNDED' AND amount=7000000 AND quantity=1
  AND payer='0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952')<>1
 OR r.review_state IS DISTINCT FROM 'MANUAL_REVIEW_ONLY_NO_NEW_ISSUE'
 OR r.wallet_observation IS DISTINCT FROM 'OWNER_REPORTED_NO_TRANSACTIONS_VISIBLE'
 OR r.wallet_observation_is_mempool_proof IS DISTINCT FROM false
 OR r.original_operation_seen IS DISTINCT FROM false
 OR r.original_unit_available IS DISTINCT FROM true
 OR r.observed_issuer_latest_nonce IS DISTINCT FROM 0
 OR r.observed_issuer_pending_nonce IS DISTINCT FROM 0
 OR r.may_create_second_operation IS DISTINCT FROM false
 OR r.may_broadcast_transaction IS DISTINCT FROM false
 OR r.may_modify_original_claim IS DISTINCT FROM false
 OR (r.original_operation_id,r.original_issuer_nonce,r.original_deadline,r.original_calldata_hash)
  IS DISTINCT FROM (c.issuer_op_id,c.issuer_tx_nonce,c.issuer_issue_deadline,c.issuer_tx_data_hash)
 OR s.review_id IS DISTINCT FROM r.review_id OR s.stage IS DISTINCT FROM 'REVIEW_HOLD'
 OR s.attempt_sequence IS DISTINCT FROM 2 OR s.chain_id IS DISTINCT FROM 10143
 OR s.issuer_wallet IS DISTINCT FROM c.issuer_wallet
 OR (s.original_operation_id,s.original_issuer_nonce,s.original_deadline,s.original_calldata_hash)
  IS DISTINCT FROM (c.issuer_op_id,c.issuer_tx_nonce,c.issuer_issue_deadline,c.issuer_tx_data_hash)
 OR s.successor_operation_id IS NOT NULL OR s.successor_nonce IS NOT NULL
 OR s.successor_issue_deadline IS NOT NULL OR s.successor_calldata_hash IS NOT NULL
 OR s.successor_tx_hash IS NOT NULL OR s.receipt_block IS NOT NULL
 OR s.receipt_block_hash IS NOT NULL OR s.security_release_id IS NOT NULL
 OR s.may_prepare_wallet_tx IS DISTINCT FROM false
 OR s.may_sign_or_broadcast IS DISTINCT FROM false
 OR s.may_mark_issued IS DISTINCT FROM false
 OR s.legacy_claim_rewrite_allowed IS DISTINCT FROM false
 OR EXISTS(SELECT 1 FROM mf_t1e.successor_issue_releases)
 OR EXISTS(SELECT 1 FROM mf_t1e.successor_issue_operations)
 OR EXISTS(SELECT 1 FROM mf_t1e.successor_issue_events)
 THEN RAISE EXCEPTION 'T1F_016_ORIGINAL_CONTEXT_CHANGED'; END IF;
 RETURN jsonb_build_object('claim',to_jsonb(c),'review',to_jsonb(r),'slot',to_jsonb(s));
END $fn$;
-- Fail migration atomically unless the exact pinned original is present.
DO $gate$ BEGIN PERFORM mf_t1f_recovery.context(); END $gate$;

CREATE TABLE mf_t1f_recovery.approval_rounds(
 round_id uuid PRIMARY KEY,
 value jsonb NOT NULL CHECK(jsonb_typeof(value)='object'),
 digest text NOT NULL UNIQUE CHECK(digest ~ '^0x[0-9a-f]{64}$'),
 created_at_epoch bigint NOT NULL CHECK(created_at_epoch>0),
 observed_block_time bigint NOT NULL CHECK(observed_block_time>0),
 candidate_calldata_hash text NOT NULL CHECK(candidate_calldata_hash ~ '^0x[0-9a-f]{64}$'),
 approval_expires_at bigint GENERATED ALWAYS AS ((value->>'approvalExpiresAt')::bigint) STORED NOT NULL,
 nonce_domain text GENERATED ALWAYS AS (value->>'nonceDomain') STORED NOT NULL UNIQUE,
 candidate_op_id text GENERATED ALWAYS AS (value->>'newOpId') STORED NOT NULL UNIQUE,
 may_release_to_wallet boolean NOT NULL DEFAULT false CHECK(may_release_to_wallet=false),
 may_broadcast boolean NOT NULL DEFAULT false CHECK(may_broadcast=false),
 may_settle boolean NOT NULL DEFAULT false CHECK(may_settle=false),
 CHECK(approval_expires_at=created_at_epoch+300)
);
CREATE TABLE mf_t1f_recovery.role_approvals(
 round_id uuid NOT NULL REFERENCES mf_t1f_recovery.approval_rounds(round_id),
 role text NOT NULL CHECK(role IN ('owner','donor')),
 wallet text NOT NULL,
 digest text NOT NULL CHECK(digest ~ '^0x[0-9a-f]{64}$'),
 fingerprint text NOT NULL UNIQUE CHECK(fingerprint ~ '^0x[0-9a-f]{64}$'),
 verified_at_epoch bigint NOT NULL,
 verification_version text NOT NULL DEFAULT 'T1F_EIP712_PINNED_EOA_V1'
  CHECK(verification_version='T1F_EIP712_PINNED_EOA_V1'),
 PRIMARY KEY(round_id,role),
 CHECK((role='owner' AND wallet='0xc4f8a468f10d5f98dcff3282516125e97f26433b')
  OR (role='donor' AND wallet='0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952'))
);
CREATE TABLE mf_t1f_recovery.approval_events(
 event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 round_id uuid NOT NULL REFERENCES mf_t1f_recovery.approval_rounds(round_id),
 event_type text NOT NULL CHECK(event_type IN ('ROUND_CREATED','ROLE_VERIFIED')),
 role text CHECK(role IN ('owner','donor')),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((event_type='ROUND_CREATED' AND role IS NULL)
  OR (event_type='ROLE_VERIFIED' AND role IS NOT NULL))
);
CREATE FUNCTION mf_t1f_recovery.immutable() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN RAISE EXCEPTION 'T1F_016_APPEND_ONLY'; END $fn$;
CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON mf_t1f_recovery.approval_rounds
 FOR EACH ROW EXECUTE FUNCTION mf_t1f_recovery.immutable();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON mf_t1f_recovery.approval_rounds
 FOR EACH STATEMENT EXECUTE FUNCTION mf_t1f_recovery.immutable();
CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON mf_t1f_recovery.role_approvals
 FOR EACH ROW EXECUTE FUNCTION mf_t1f_recovery.immutable();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON mf_t1f_recovery.role_approvals
 FOR EACH STATEMENT EXECUTE FUNCTION mf_t1f_recovery.immutable();
CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON mf_t1f_recovery.approval_events
 FOR EACH ROW EXECUTE FUNCTION mf_t1f_recovery.immutable();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON mf_t1f_recovery.approval_events
 FOR EACH STATEMENT EXECUTE FUNCTION mf_t1f_recovery.immutable();

CREATE FUNCTION mf_t1f_recovery.row_json(p_round_id uuid) RETURNS jsonb
 LANGUAGE sql SET search_path=pg_catalog AS $fn$
 SELECT jsonb_build_object('round_id',r.round_id,'value',r.value,'digest',r.digest,
  'created_at_epoch',r.created_at_epoch,'observed_block_time',r.observed_block_time,
  'candidate_calldata_hash',r.candidate_calldata_hash,'approvals',
  COALESCE((SELECT jsonb_agg(jsonb_build_object('role',a.role,'wallet',a.wallet,
   'fingerprint',a.fingerprint) ORDER BY a.role)
   FROM mf_t1f_recovery.role_approvals a WHERE a.round_id=r.round_id),'[]'::jsonb))
 FROM mf_t1f_recovery.approval_rounds r WHERE r.round_id=p_round_id
$fn$;
CREATE FUNCTION mf_t1f_recovery.get_round(p_round_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
 SET statement_timeout='5s' SET lock_timeout='2s' AS $fn$
BEGIN
 PERFORM mf_t1f_recovery.context();
 RETURN mf_t1f_recovery.row_json(p_round_id);
END $fn$;
CREATE FUNCTION mf_t1f_recovery.current_round() RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
 SET statement_timeout='5s' SET lock_timeout='2s' AS $fn$
DECLARE id uuid;
BEGIN
 PERFORM mf_t1f_recovery.context();
 SELECT round_id INTO id FROM mf_t1f_recovery.approval_rounds
 ORDER BY created_at_epoch DESC,round_id DESC LIMIT 1;
 RETURN mf_t1f_recovery.row_json(id);
END $fn$;
CREATE FUNCTION mf_t1f_recovery.create_round(p_round_id uuid,p_value jsonb,
 p_digest text,p_created_at bigint,p_observed_time bigint,p_calldata_hash text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
 SET statement_timeout='5s' SET lock_timeout='2s' AS $fn$
DECLARE ctx jsonb; ts bigint; active mf_t1f_recovery.approval_rounds;
DECLARE keys text[]; expected text[]:=ARRAY['claimId','reviewId','slotId','voucherId',
 'originalOpId','originalNonce','originalDeadline','originalDataHash','newOpId',
 'newNonce','newDeadline','nonceDomain','observedBlockNumber','observedBlockHash','approvalExpiresAt'];
BEGIN
 PERFORM pg_advisory_xact_lock(10143,160026);
 ctx=mf_t1f_recovery.context();
 ts=floor(extract(epoch from clock_timestamp()));
 SELECT * INTO active FROM mf_t1f_recovery.approval_rounds
 WHERE approval_expires_at>ts ORDER BY created_at_epoch DESC LIMIT 1;
 IF FOUND THEN
  IF active.round_id=p_round_id AND
   (active.value,active.digest,active.created_at_epoch,active.observed_block_time,
    active.candidate_calldata_hash) IS DISTINCT FROM
   (p_value,p_digest,p_created_at,p_observed_time,p_calldata_hash)
  THEN RAISE EXCEPTION 'T1F_016_ROUND_CONFLICT'; END IF;
  RETURN mf_t1f_recovery.row_json(active.round_id);
 END IF;
 IF p_round_id IS NULL OR p_value IS NULL OR jsonb_typeof(p_value)<>'object'
 THEN RAISE EXCEPTION 'T1F_016_ROUND_INVALID'; END IF;
 SELECT array_agg(k ORDER BY k) INTO keys FROM jsonb_object_keys(p_value) AS k;
 IF keys IS DISTINCT FROM (SELECT array_agg(k ORDER BY k) FROM unnest(expected) AS k)
 OR EXISTS(SELECT 1 FROM jsonb_each(p_value) AS e WHERE jsonb_typeof(e.value)<>'string')
 OR p_created_at IS NULL OR abs(p_created_at-ts)>5
 OR p_observed_time IS NULL OR p_observed_time>p_created_at OR p_created_at-p_observed_time>120
 OR p_digest IS NULL OR p_digest !~ '^0x[0-9a-f]{64}$'
 OR p_calldata_hash IS NULL OR p_calldata_hash !~ '^0x[0-9a-f]{64}$'
 OR p_value->>'claimId' IS DISTINCT FROM ctx->'claim'->>'claim_id'
 OR p_value->>'reviewId' IS DISTINCT FROM ctx->'review'->>'review_id'
 OR p_value->>'slotId' IS DISTINCT FROM ctx->'slot'->>'attempt_id'
 OR p_value->>'voucherId' IS DISTINCT FROM ctx->'claim'->>'voucher_id'
 OR p_value->>'originalOpId' IS DISTINCT FROM ctx->'claim'->>'issuer_op_id'
 OR p_value->>'originalNonce' IS DISTINCT FROM '0'
 OR p_value->>'originalDeadline' IS DISTINCT FROM '1792765625'
 OR p_value->>'originalDataHash' IS DISTINCT FROM ctx->'claim'->>'issuer_tx_data_hash'
 OR p_value->>'newNonce' IS DISTINCT FROM '0'
 OR p_value->>'newOpId' !~ '^0x[0-9a-f]{64}$'
 OR p_value->>'newOpId' IN (ctx->'claim'->>'issuer_op_id','0x'||repeat('0',64))
 OR p_value->>'nonceDomain' !~ '^0x[0-9a-f]{64}$'
 OR p_value->>'nonceDomain'='0x'||repeat('0',64)
 OR p_value->>'observedBlockHash' !~ '^0x[0-9a-f]{64}$'
 OR p_value->>'observedBlockHash'='0x'||repeat('0',64)
 OR p_value->>'observedBlockNumber' !~ '^[1-9][0-9]{0,15}$'
 OR p_value->>'newDeadline' IS DISTINCT FROM (p_created_at+480)::text
 OR p_value->>'approvalExpiresAt' IS DISTINCT FROM (p_created_at+300)::text
 THEN RAISE EXCEPTION 'T1F_016_ROUND_INVALID'; END IF;
 IF (p_value->>'observedBlockNumber')::bigint<(ctx->'review'->>'observed_block_number')::bigint
 THEN RAISE EXCEPTION 'T1F_016_OBSERVATION_TOO_OLD'; END IF;
 INSERT INTO mf_t1f_recovery.approval_rounds(round_id,value,digest,
  created_at_epoch,observed_block_time,candidate_calldata_hash)
 VALUES(p_round_id,p_value,p_digest,p_created_at,p_observed_time,p_calldata_hash);
 INSERT INTO mf_t1f_recovery.approval_events(round_id,event_type)
 VALUES(p_round_id,'ROUND_CREATED');
 RETURN mf_t1f_recovery.row_json(p_round_id);
END $fn$;
CREATE FUNCTION mf_t1f_recovery.record_approval(p_round_id uuid,p_digest text,
 p_role text,p_wallet text,p_fingerprint text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
 SET statement_timeout='5s' SET lock_timeout='2s' AS $fn$
DECLARE r mf_t1f_recovery.approval_rounds; a mf_t1f_recovery.role_approvals; ts bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(10143,160026);
 PERFORM mf_t1f_recovery.context();
 ts=floor(extract(epoch from clock_timestamp()));
 SELECT * INTO r FROM mf_t1f_recovery.approval_rounds WHERE round_id=p_round_id FOR UPDATE;
 IF NOT FOUND OR r.approval_expires_at<=ts OR r.created_at_epoch>ts
 OR p_digest IS DISTINCT FROM r.digest
 OR p_role IS NULL OR p_role NOT IN ('owner','donor')
 OR p_wallet IS DISTINCT FROM (CASE p_role
  WHEN 'owner' THEN '0xc4f8a468f10d5f98dcff3282516125e97f26433b'
  WHEN 'donor' THEN '0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952' END)
 OR p_fingerprint IS NULL OR p_fingerprint !~ '^0x[0-9a-f]{64}$'
 THEN RAISE EXCEPTION 'T1F_016_APPROVAL_INVALID_OR_EXPIRED'; END IF;
 SELECT * INTO a FROM mf_t1f_recovery.role_approvals
 WHERE round_id=p_round_id AND role=p_role;
 IF FOUND THEN
  IF (a.digest,a.wallet,a.fingerprint) IS DISTINCT FROM (p_digest,p_wallet,p_fingerprint)
  THEN RAISE EXCEPTION 'T1F_016_APPROVAL_CONFLICT'; END IF;
  RETURN mf_t1f_recovery.row_json(p_round_id);
 END IF;
 INSERT INTO mf_t1f_recovery.role_approvals(round_id,role,wallet,digest,fingerprint,verified_at_epoch)
 VALUES(p_round_id,p_role,p_wallet,p_digest,p_fingerprint,ts);
 INSERT INTO mf_t1f_recovery.approval_events(round_id,event_type,role)
 VALUES(p_round_id,'ROLE_VERIFIED',p_role);
 RETURN mf_t1f_recovery.row_json(p_round_id);
END $fn$;

REVOKE ALL ON ALL TABLES IN SCHEMA mf_t1f_recovery FROM PUBLIC,anon,authenticated,service_role,
 mf_t1c_auth_runtime,mf_t1c_intent_runtime,mf_t1d_auth_runtime,mf_t1d_fund_runtime,
 mf_t1e_auth_runtime,mf_t1e_claim_runtime,mf_t1f_approval_runtime;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA mf_t1f_recovery FROM PUBLIC,anon,authenticated,service_role,
 mf_t1c_auth_runtime,mf_t1c_intent_runtime,mf_t1d_auth_runtime,mf_t1d_fund_runtime,
 mf_t1e_auth_runtime,mf_t1e_claim_runtime,mf_t1f_approval_runtime;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA mf_t1f_recovery FROM PUBLIC,anon,authenticated,service_role,
 mf_t1c_auth_runtime,mf_t1c_intent_runtime,mf_t1d_auth_runtime,mf_t1d_fund_runtime,
 mf_t1e_auth_runtime,mf_t1e_claim_runtime,mf_t1f_approval_runtime;
GRANT USAGE ON SCHEMA mf_t1f_recovery TO mf_t1f_approval_runtime;
GRANT EXECUTE ON FUNCTION mf_t1f_recovery.context(),mf_t1f_recovery.current_round(),
 mf_t1f_recovery.get_round(uuid),
 mf_t1f_recovery.create_round(uuid,jsonb,text,bigint,bigint,text),
 mf_t1f_recovery.record_approval(uuid,text,text,text,text) TO mf_t1f_approval_runtime;
COMMENT ON SCHEMA mf_t1f_recovery IS
 'Source-only durable OFFCHAIN dual approvals. Trusted service attestations, not SQL signature proof. No release, raw signature, Issue reservation, broadcast or settlement. No live LOGIN or grants to existing runtimes.';
RESET ROLE;
COMMIT;
