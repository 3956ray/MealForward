-- SOURCE ONLY: isolated execution capability. No LOGIN or live membership.
BEGIN;
GRANT mf_t1f_approval_owner TO CURRENT_USER WITH INHERIT TRUE GRANTED BY CURRENT_USER;
GRANT mf_t1f_approval_owner TO CURRENT_USER WITH SET TRUE GRANTED BY CURRENT_USER;
DO $$ BEGIN
 PERFORM pg_advisory_xact_lock(10143,160026);
 IF current_database()<>'postgres' OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
 OR to_regnamespace('mf_t1f_execution') IS NOT NULL
 OR to_regclass('mf_t1f_recovery.role_approvals') IS NULL
 OR EXISTS(SELECT 1 FROM mf_t1e.successor_issue_releases)
 OR EXISTS(SELECT 1 FROM mf_t1e.successor_issue_operations)
 OR EXISTS(SELECT 1 FROM mf_t1e.successor_issue_events)
 THEN RAISE EXCEPTION 'T1F_017_PREREQUISITE_FAILED'; END IF;
 PERFORM mf_t1f_recovery.context();
END $$;
CREATE ROLE mf_t1f_execution_owner NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE mf_t1f_execution_runtime NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT mf_t1f_execution_owner TO CURRENT_USER WITH INHERIT TRUE GRANTED BY CURRENT_USER;
GRANT mf_t1f_execution_owner TO CURRENT_USER WITH SET TRUE GRANTED BY CURRENT_USER;
CREATE SCHEMA mf_t1f_execution AUTHORIZATION mf_t1f_execution_owner;
REVOKE ALL ON SCHEMA mf_t1f_execution FROM PUBLIC;
GRANT USAGE ON SCHEMA mf_t1e,mf_t1c,mf_t1f_recovery TO mf_t1f_execution_owner;
GRANT SELECT ON mf_t1e.recipient_claims,mf_t1e.consent_rounds,mf_t1e.claim_events,
 mf_t1e.expired_issue_reviews,mf_t1e.issuer_issue_attempts,mf_t1e.successor_issue_releases,
 mf_t1e.successor_issue_operations,mf_t1e.successor_issue_events TO mf_t1f_execution_owner;
GRANT SELECT ON mf_t1c.intents,mf_t1f_recovery.approval_rounds,mf_t1f_recovery.role_approvals TO mf_t1f_execution_owner;
-- PostgreSQL row locks require UPDATE privilege; append-only triggers forbid actual mutations.
GRANT UPDATE(round_id) ON mf_t1f_recovery.approval_rounds TO mf_t1f_execution_owner;
GRANT UPDATE(claim_id) ON mf_t1e.recipient_claims TO mf_t1f_execution_owner;
GRANT UPDATE(release_id) ON mf_t1e.successor_issue_releases TO mf_t1f_execution_owner;
GRANT UPDATE(attempt_id) ON mf_t1e.issuer_issue_attempts TO mf_t1f_execution_owner;
GRANT INSERT ON mf_t1e.successor_issue_releases,mf_t1e.successor_issue_operations,mf_t1e.successor_issue_events TO mf_t1f_execution_owner;
GRANT UPDATE(stage,tx_hash,receipt_block,receipt_block_hash,revision) ON mf_t1e.successor_issue_operations TO mf_t1f_execution_owner;
GRANT USAGE ON SEQUENCE mf_t1e.successor_issue_events_event_id_seq TO mf_t1f_execution_owner;
-- Replace exactly the HOLD-only constraints; server and settlement checks stay.
ALTER TABLE mf_t1e.successor_issue_releases DROP CONSTRAINT successor_issue_releases_stage_check;
ALTER TABLE mf_t1e.successor_issue_releases DROP CONSTRAINT successor_issue_releases_may_release_to_wallet_check;
ALTER TABLE mf_t1e.successor_issue_releases DROP CONSTRAINT successor_issue_releases_signer_verification_version_check;
ALTER TABLE mf_t1e.successor_issue_releases ADD CONSTRAINT t1f_017_released_only CHECK(
 stage='RELEASED_FOR_ONE_ISSUE' AND may_release_to_wallet=true AND
 signer_verification_version='T1F_PROTECTED_COLLECTOR_RECEIPTS_V1');
CREATE TABLE mf_t1f_execution.consumptions(
 consumption_id uuid PRIMARY KEY,
 version text NOT NULL DEFAULT 'T1F_CONSUMPTION_V1' CHECK(version='T1F_CONSUMPTION_V1'),
 round_id uuid NOT NULL UNIQUE REFERENCES mf_t1f_recovery.approval_rounds(round_id),
 digest text NOT NULL UNIQUE CHECK(digest ~ '^0x[0-9a-f]{64}$'),
 claim_id uuid NOT NULL UNIQUE REFERENCES mf_t1e.recipient_claims(claim_id),
 slot_id uuid NOT NULL UNIQUE REFERENCES mf_t1e.issuer_issue_attempts(attempt_id),
 release_id uuid NOT NULL UNIQUE,
 successor_id uuid NOT NULL UNIQUE,
 consumed_at_epoch bigint NOT NULL,
 no_release boolean NOT NULL DEFAULT true CHECK(no_release=true),
 can_issue boolean NOT NULL DEFAULT false CHECK(can_issue=false),
 may_broadcast_by_server boolean NOT NULL DEFAULT false CHECK(may_broadcast_by_server=false),
 approved_for_settlement boolean NOT NULL DEFAULT false CHECK(approved_for_settlement=false),
 FOREIGN KEY(release_id) REFERENCES mf_t1e.successor_issue_releases(release_id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(successor_id) REFERENCES mf_t1e.successor_issue_operations(successor_id) DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE mf_t1f_execution.consumptions OWNER TO mf_t1f_execution_owner;
CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON mf_t1f_execution.consumptions FOR EACH ROW EXECUTE FUNCTION mf_t1f_recovery.immutable();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON mf_t1f_execution.consumptions FOR EACH STATEMENT EXECUTE FUNCTION mf_t1f_recovery.immutable();
GRANT USAGE ON SCHEMA mf_t1f_execution TO mf_t1f_approval_owner;
GRANT SELECT ON mf_t1f_execution.consumptions TO mf_t1f_approval_owner;
CREATE FUNCTION mf_t1f_recovery.original_context() RETURNS jsonb
 LANGUAGE plpgsql SET search_path=pg_catalog
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
 THEN RAISE EXCEPTION 'T1F_016_ORIGINAL_CONTEXT_CHANGED'; END IF;
 RETURN jsonb_build_object('claim',to_jsonb(c),'review',to_jsonb(r),'slot',to_jsonb(s));
END $fn$;
-- Exact linkage is required for every successor row, including all audit rows.
CREATE FUNCTION mf_t1f_recovery.valid_consumption() RETURNS jsonb
 LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE x mf_t1f_execution.consumptions; r mf_t1f_recovery.approval_rounds;
DECLARE l mf_t1e.successor_issue_releases; o mf_t1e.successor_issue_operations;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM mf_t1f_execution.consumptions) THEN
  IF EXISTS(SELECT 1 FROM mf_t1e.successor_issue_releases)
   OR EXISTS(SELECT 1 FROM mf_t1e.successor_issue_operations)
   OR EXISTS(SELECT 1 FROM mf_t1e.successor_issue_events)
  THEN RAISE EXCEPTION 'T1F_017_ORPHAN_SUCCESSOR'; END IF;
  RETURN NULL;
 END IF;
 IF (SELECT count(*) FROM mf_t1f_execution.consumptions)<>1
 OR (SELECT count(*) FROM mf_t1e.successor_issue_releases)<>1
 OR (SELECT count(*) FROM mf_t1e.successor_issue_operations)<>1
 THEN RAISE EXCEPTION 'T1F_017_CONSUMPTION_LINKAGE'; END IF;
 SELECT * INTO x FROM mf_t1f_execution.consumptions;
 SELECT * INTO r FROM mf_t1f_recovery.approval_rounds WHERE round_id=x.round_id;
 SELECT * INTO l FROM mf_t1e.successor_issue_releases WHERE release_id=x.release_id;
 SELECT * INTO o FROM mf_t1e.successor_issue_operations WHERE successor_id=x.successor_id;
 IF r.round_id IS NULL OR l.release_id IS NULL OR o.successor_id IS NULL
 OR x.version<>'T1F_CONSUMPTION_V1' OR x.no_release IS DISTINCT FROM true
 OR x.can_issue IS DISTINCT FROM false OR x.may_broadcast_by_server IS DISTINCT FROM false
 OR x.approved_for_settlement IS DISTINCT FROM false
 OR (x.digest,x.claim_id::text,x.slot_id::text) IS DISTINCT FROM
 (r.digest,r.value->>'claimId',r.value->>'slotId')
 OR (l.claim_id,l.slot_id,l.review_id::text,l.candidate_op_id,l.candidate_issuer_nonce::text,
 l.candidate_issue_deadline::text,l.nonce_domain,l.approval_expires_at::text,
 l.observed_block_number::text,l.observed_block_hash,l.signed_payload_digest)
 IS DISTINCT FROM (x.claim_id,x.slot_id,r.value->>'reviewId',r.value->>'newOpId',r.value->>'newNonce',
 r.value->>'newDeadline',r.value->>'nonceDomain',r.value->>'approvalExpiresAt',
 r.value->>'observedBlockNumber',r.value->>'observedBlockHash',r.digest)
 OR l.stage<>'RELEASED_FOR_ONE_ISSUE' OR l.may_release_to_wallet IS DISTINCT FROM true
 OR l.may_broadcast_by_server IS DISTINCT FROM false OR l.approved_for_settlement IS DISTINCT FROM false
 OR l.signer_verification_version<>'T1F_PROTECTED_COLLECTOR_RECEIPTS_V1'
 OR (o.claim_id,o.slot_id,o.release_id,o.operation_id,o.issuer_nonce,o.issuer_issue_deadline,
 o.calldata_hash,o.voucher_id) IS DISTINCT FROM
 (x.claim_id,x.slot_id,x.release_id,l.candidate_op_id,l.candidate_issuer_nonce,l.candidate_issue_deadline,
 r.candidate_calldata_hash,r.value->>'voucherId')
 OR o.issuer_wallet<>'0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3'
 OR EXISTS(SELECT 1 FROM mf_t1e.successor_issue_events e WHERE e.successor_id<>x.successor_id
 OR (e.event_type='ISSUE_RESERVED' AND e.tx_hash IS NOT NULL)
 OR (e.event_type<>'ISSUE_RESERVED' AND e.tx_hash IS DISTINCT FROM o.tx_hash))
 OR (SELECT count(*) FROM mf_t1e.successor_issue_events WHERE event_type='ISSUE_RESERVED')<>1
 OR (SELECT count(*) FROM mf_t1e.successor_issue_events)<>o.revision+1
 OR (SELECT count(*) FROM mf_t1e.successor_issue_events WHERE event_type='ISSUE_HASH_BOUND')<>(CASE WHEN o.stage IN ('ISSUE_HASH_BOUND','ISSUED') THEN 1 ELSE 0 END)
 OR (SELECT count(*) FROM mf_t1e.successor_issue_events WHERE event_type='ISSUED_CONFIRMED')<>(CASE WHEN o.stage='ISSUED' THEN 1 ELSE 0 END)
 OR EXISTS(SELECT 1 FROM mf_t1e.successor_issue_events WHERE event_type='ISSUE_BLOCKED')
 OR x.consumed_at_epoch<r.created_at_epoch OR x.consumed_at_epoch>r.approval_expires_at-90
 OR (SELECT count(*) FROM mf_t1f_recovery.role_approvals a WHERE a.round_id=r.round_id
 AND a.digest=r.digest AND a.verification_version='T1F_EIP712_PINNED_EOA_V1'
 AND a.verified_at_epoch>=r.created_at_epoch AND a.verified_at_epoch<r.approval_expires_at
 AND ((a.role='owner' AND a.wallet=l.owner_wallet AND a.fingerprint=l.owner_signature_fingerprint)
 OR (a.role='donor' AND a.wallet=l.donor_wallet AND a.fingerprint=l.donor_signature_fingerprint)))<>2
 THEN RAISE EXCEPTION 'T1F_017_CONSUMPTION_LINKAGE'; END IF;
 RETURN to_jsonb(x);
END $$;
CREATE OR REPLACE FUNCTION mf_t1f_recovery.context() RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='5s' SET lock_timeout='2s' AS $$
DECLARE ctx jsonb; x jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(10143,160026);
 ctx=mf_t1f_recovery.original_context(); x=mf_t1f_recovery.valid_consumption();
 IF x IS NOT NULL THEN ctx=ctx||jsonb_build_object('consumption',x); END IF;
 RETURN ctx;
END $$;
CREATE FUNCTION mf_t1f_recovery.write_context() RETURNS jsonb
 LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE ctx jsonb;
BEGIN
 ctx=mf_t1f_recovery.context();
 IF ctx ? 'consumption' THEN RAISE EXCEPTION 'T1F_017_ALREADY_CONSUMED'; END IF;
 RETURN ctx;
END $$;
CREATE OR REPLACE FUNCTION mf_t1f_recovery.row_json(p_round_id uuid) RETURNS jsonb
 LANGUAGE sql SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('round_id',r.round_id,'value',r.value,'digest',r.digest,
 'created_at_epoch',r.created_at_epoch,'observed_block_time',r.observed_block_time,
 'candidate_calldata_hash',r.candidate_calldata_hash,'approvals',COALESCE((
 SELECT jsonb_agg(jsonb_build_object('role',a.role,'wallet',a.wallet,'fingerprint',a.fingerprint) ORDER BY a.role)
 FROM mf_t1f_recovery.role_approvals a WHERE a.round_id=r.round_id),'[]'::jsonb))
 || CASE WHEN x.round_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('consumption',to_jsonb(x)) END
 FROM mf_t1f_recovery.approval_rounds r LEFT JOIN mf_t1f_execution.consumptions x ON x.round_id=r.round_id
 WHERE r.round_id=p_round_id
$$;
CREATE OR REPLACE FUNCTION mf_t1f_recovery.create_round(p_round_id uuid,p_value jsonb,
 p_digest text,p_created_at bigint,p_observed_time bigint,p_calldata_hash text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
 SET statement_timeout='5s' SET lock_timeout='2s' AS $fn$
DECLARE ctx jsonb; ts bigint; active mf_t1f_recovery.approval_rounds;
DECLARE keys text[]; expected text[]:=ARRAY['claimId','reviewId','slotId','voucherId',
 'originalOpId','originalNonce','originalDeadline','originalDataHash','newOpId',
 'newNonce','newDeadline','nonceDomain','observedBlockNumber','observedBlockHash','approvalExpiresAt'];
BEGIN
 PERFORM pg_advisory_xact_lock(10143,160026);
 ctx=mf_t1f_recovery.write_context();
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
CREATE OR REPLACE FUNCTION mf_t1f_recovery.record_approval(p_round_id uuid,p_digest text,
 p_role text,p_wallet text,p_fingerprint text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
 SET statement_timeout='5s' SET lock_timeout='2s' AS $fn$
DECLARE r mf_t1f_recovery.approval_rounds; a mf_t1f_recovery.role_approvals; ts bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(10143,160026);
 PERFORM mf_t1f_recovery.write_context();
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

CREATE OR REPLACE FUNCTION mf_t1e.successor_release_guard() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE r mf_t1f_recovery.approval_rounds; x mf_t1f_execution.consumptions; ts bigint;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'T1F_015_APPROVAL_IMMUTABLE'; END IF;
 IF current_user<>'mf_t1f_execution_owner' THEN RAISE EXCEPTION 'T1F_017_EXECUTION_OWNER_REQUIRED'; END IF;
 PERFORM mf_t1f_recovery.original_context();
 ts=floor(extract(epoch from clock_timestamp()));
 SELECT * INTO x FROM mf_t1f_execution.consumptions WHERE release_id=NEW.release_id;
 SELECT * INTO r FROM mf_t1f_recovery.approval_rounds WHERE round_id=x.round_id;
 IF x.consumption_id IS NULL OR r.round_id IS NULL
 OR (NEW.claim_id,NEW.slot_id,NEW.review_id::text,NEW.signed_payload_digest,
 NEW.candidate_op_id,NEW.candidate_issuer_nonce::text,NEW.candidate_issue_deadline::text,
 NEW.nonce_domain,NEW.approval_expires_at::text,NEW.observed_block_number::text,NEW.observed_block_hash)
 IS DISTINCT FROM (x.claim_id,x.slot_id,r.value->>'reviewId',r.digest,r.value->>'newOpId',
 r.value->>'newNonce',r.value->>'newDeadline',r.value->>'nonceDomain',r.value->>'approvalExpiresAt',
 r.value->>'observedBlockNumber',r.value->>'observedBlockHash')
 OR NEW.candidate_issue_deadline<ts+120 OR NEW.candidate_issue_deadline>ts+600
 OR NEW.approval_expires_at<ts+90 OR NEW.approval_expires_at>NEW.candidate_issue_deadline
 OR NEW.stage<>'RELEASED_FOR_ONE_ISSUE' OR NEW.may_release_to_wallet IS DISTINCT FROM true
 OR (SELECT count(*) FROM mf_t1f_recovery.role_approvals a WHERE a.round_id=r.round_id
 AND a.digest=r.digest AND a.verification_version='T1F_EIP712_PINNED_EOA_V1'
 AND a.verified_at_epoch>=r.created_at_epoch AND a.verified_at_epoch<r.approval_expires_at
 AND ((a.role='owner' AND a.wallet=NEW.owner_wallet AND a.fingerprint=NEW.owner_signature_fingerprint)
 OR (a.role='donor' AND a.wallet=NEW.donor_wallet AND a.fingerprint=NEW.donor_signature_fingerprint)))<>2
 THEN RAISE EXCEPTION 'T1F_017_RELEASE_PROVENANCE'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION mf_t1e.successor_operation_guard() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog AS $guard$
DECLARE parent mf_t1e.recipient_claims;
DECLARE slot mf_t1e.issuer_issue_attempts;
DECLARE approval mf_t1e.successor_issue_releases;
DECLARE ts bigint;
BEGIN
 IF current_user<>'mf_t1f_execution_owner' THEN RAISE EXCEPTION 'T1F_017_EXECUTION_OWNER_REQUIRED'; END IF;
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
  OR approval.approval_expires_at<ts+90
 OR NOT EXISTS(SELECT 1 FROM mf_t1f_execution.consumptions x WHERE x.successor_id=NEW.successor_id AND x.release_id=NEW.release_id AND x.claim_id=NEW.claim_id AND x.slot_id=NEW.slot_id)
 THEN RAISE EXCEPTION USING ERRCODE='P0001',
  MESSAGE='T1F_015_DUAL_RELEASE_EXPIRED_OR_CHANGED'; END IF;
 RETURN NEW;
END $guard$;
CREATE FUNCTION mf_t1f_execution.envelope(p_round_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE ctx jsonb; x jsonb; o jsonb;
BEGIN
 ctx=mf_t1f_recovery.context(); x=ctx->'consumption';
 IF x IS NOT NULL THEN SELECT to_jsonb(t) INTO o FROM mf_t1e.successor_issue_operations t WHERE successor_id=(x->>'successor_id')::uuid; END IF;
 RETURN jsonb_build_object('context',ctx-'consumption','round',mf_t1f_recovery.row_json(p_round_id),'consumption',x,'operation',o);
END $$;
CREATE FUNCTION mf_t1f_execution.execution_context() RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='5s' SET lock_timeout='2s' AS $$
DECLARE id uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(10143,160026);
 SELECT round_id INTO id FROM mf_t1f_recovery.approval_rounds ORDER BY created_at_epoch DESC,round_id DESC LIMIT 1;
 RETURN mf_t1f_execution.envelope(id);
END $$;
CREATE FUNCTION mf_t1f_execution.execution_round(p_round_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='5s' SET lock_timeout='2s' AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(10143,160026);
 RETURN mf_t1f_execution.envelope(p_round_id);
END $$;
-- Exact JSON schema validator: rejects nulls, extra keys and untrusted versions.
CREATE FUNCTION mf_t1f_execution.exact(p jsonb,expected text[]) RETURNS boolean
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT COALESCE(jsonb_typeof(p)='object' AND
 (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p) k)=
 (SELECT array_agg(k ORDER BY k) FROM unnest(expected) k)
 AND NOT EXISTS(SELECT 1 FROM jsonb_each(p) e WHERE e.value='null'::jsonb),false)
$$;
CREATE FUNCTION mf_t1f_execution.consume_round_and_reserve(p_round_id uuid,p_digest text,p_evidence jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='5s' SET lock_timeout='2s' AS $$
DECLARE ctx jsonb; r mf_t1f_recovery.approval_rounds; x mf_t1f_execution.consumptions;
DECLARE o mf_t1e.successor_issue_operations; ts bigint; release uuid; successor uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(10143,160026);
 ctx=mf_t1f_recovery.context();
 -- Recovery first: no expiry or fresh-chain prerequisite can regenerate send ability.
 IF ctx ? 'consumption' THEN
  SELECT * INTO x FROM mf_t1f_execution.consumptions;
  SELECT * INTO o FROM mf_t1e.successor_issue_operations WHERE successor_id=x.successor_id;
  RETURN jsonb_build_object('created',false,'operation',to_jsonb(o),'consumption',to_jsonb(x));
 END IF;
 SELECT * INTO r FROM mf_t1f_recovery.approval_rounds WHERE round_id=p_round_id FOR UPDATE;
 PERFORM 1 FROM mf_t1e.issuer_issue_attempts WHERE attempt_id=(ctx->'slot'->>'attempt_id')::uuid FOR SHARE;
 ts=floor(extract(epoch from clock_timestamp()));
 IF r.round_id IS NULL OR p_digest IS DISTINCT FROM r.digest OR r.approval_expires_at<ts+90
 OR r.created_at_epoch>ts
 OR (r.value->>'claimId',r.value->>'reviewId',r.value->>'slotId',r.value->>'voucherId',
 r.value->>'originalOpId',r.value->>'originalNonce',r.value->>'originalDeadline',r.value->>'originalDataHash')
 IS DISTINCT FROM (ctx->'claim'->>'claim_id',ctx->'review'->>'review_id',ctx->'slot'->>'attempt_id',ctx->'claim'->>'voucher_id',
 ctx->'claim'->>'issuer_op_id',ctx->'claim'->>'issuer_tx_nonce',ctx->'claim'->>'issuer_issue_deadline',ctx->'claim'->>'issuer_tx_data_hash')
 OR (r.value->>'newDeadline')::bigint<ts+120 OR (r.value->>'newDeadline')::bigint>ts+600
 OR NOT mf_t1f_execution.exact(p_evidence,ARRAY['version','roundId','digest','signedBlockNumber','signedBlockHash','observedBlockNumber','observedBlockHash','observedAt','issuerLatestNonce','issuerPendingNonce','calldataHash','historicalAnchorCanonical','freshAnchorCanonical','originalOperationSeen','unitAvailable','unitIssued','codeAndAuthorityValid','accountingValid','simulationPassed'])
 OR EXISTS(SELECT 1 FROM jsonb_each(p_evidence) e WHERE e.key NOT IN ('historicalAnchorCanonical','freshAnchorCanonical','originalOperationSeen','unitAvailable','unitIssued','codeAndAuthorityValid','accountingValid','simulationPassed') AND jsonb_typeof(e.value)<>'string')
 OR p_evidence->>'version' IS DISTINCT FROM 'T1F_EXECUTION_OBSERVATION_V1'
 OR p_evidence->>'roundId' IS DISTINCT FROM r.round_id::text
 OR p_evidence->>'digest' IS DISTINCT FROM r.digest
 OR p_evidence->>'signedBlockNumber' IS DISTINCT FROM r.value->>'observedBlockNumber'
 OR p_evidence->>'signedBlockHash' IS DISTINCT FROM r.value->>'observedBlockHash'
 OR p_evidence->>'issuerLatestNonce' IS DISTINCT FROM r.value->>'newNonce'
 OR p_evidence->>'issuerPendingNonce' IS DISTINCT FROM r.value->>'newNonce'
 OR p_evidence->>'calldataHash' IS DISTINCT FROM r.candidate_calldata_hash
 OR p_evidence->'historicalAnchorCanonical' IS DISTINCT FROM 'true'::jsonb
 OR p_evidence->'freshAnchorCanonical' IS DISTINCT FROM 'true'::jsonb
 OR p_evidence->'originalOperationSeen' IS DISTINCT FROM 'false'::jsonb
 OR p_evidence->'unitAvailable' IS DISTINCT FROM 'true'::jsonb
 OR p_evidence->'unitIssued' IS DISTINCT FROM 'false'::jsonb
 OR p_evidence->'codeAndAuthorityValid' IS DISTINCT FROM 'true'::jsonb
 OR p_evidence->'accountingValid' IS DISTINCT FROM 'true'::jsonb
 OR p_evidence->'simulationPassed' IS DISTINCT FROM 'true'::jsonb
 OR p_evidence->>'observedAt' !~ '^[1-9][0-9]{0,15}$'
 OR (p_evidence->>'observedAt')::bigint>ts OR ts-(p_evidence->>'observedAt')::bigint>120
 OR p_evidence->>'observedBlockNumber' !~ '^[1-9][0-9]{0,15}$'
 OR (p_evidence->>'observedBlockNumber')::bigint<(r.value->>'observedBlockNumber')::bigint
 OR p_evidence->>'observedBlockHash' !~ '^0x[0-9a-f]{64}$'
 OR (SELECT count(*) FROM mf_t1f_recovery.role_approvals a WHERE a.round_id=r.round_id AND a.digest=r.digest
 AND a.verification_version='T1F_EIP712_PINNED_EOA_V1' AND a.verified_at_epoch>=r.created_at_epoch
 AND a.verified_at_epoch<r.approval_expires_at AND a.verified_at_epoch<=ts
 AND ((a.role='owner' AND a.wallet='0xc4f8a468f10d5f98dcff3282516125e97f26433b')
 OR (a.role='donor' AND a.wallet='0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952')))<>2
 THEN RAISE EXCEPTION 'T1F_017_CONSUME_INVALID'; END IF;
 release=gen_random_uuid(); successor=gen_random_uuid();
 INSERT INTO mf_t1f_execution.consumptions(consumption_id,round_id,digest,claim_id,slot_id,release_id,successor_id,consumed_at_epoch)
 VALUES(gen_random_uuid(),r.round_id,r.digest,(r.value->>'claimId')::uuid,(r.value->>'slotId')::uuid,release,successor,ts) RETURNING * INTO x;
 INSERT INTO mf_t1e.successor_issue_releases(release_id,claim_id,slot_id,review_id,candidate_op_id,candidate_issuer_nonce,candidate_issue_deadline,
 nonce_domain,approval_expires_at,observed_block_number,observed_block_hash,owner_wallet,donor_wallet,signed_payload_digest,
 owner_signature_fingerprint,donor_signature_fingerprint,signer_verification_version,stage,may_release_to_wallet)
 SELECT release,x.claim_id,x.slot_id,(r.value->>'reviewId')::uuid,r.value->>'newOpId',(r.value->>'newNonce')::bigint,
 (r.value->>'newDeadline')::bigint,r.value->>'nonceDomain',r.approval_expires_at,(r.value->>'observedBlockNumber')::bigint,
 r.value->>'observedBlockHash','0xc4f8a468f10d5f98dcff3282516125e97f26433b','0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952',r.digest,
 (SELECT fingerprint FROM mf_t1f_recovery.role_approvals WHERE round_id=r.round_id AND role='owner'),
 (SELECT fingerprint FROM mf_t1f_recovery.role_approvals WHERE round_id=r.round_id AND role='donor'),
 'T1F_PROTECTED_COLLECTOR_RECEIPTS_V1','RELEASED_FOR_ONE_ISSUE',true;
 INSERT INTO mf_t1e.successor_issue_operations(successor_id,claim_id,slot_id,release_id,voucher_id,issuer_wallet,operation_id,issuer_nonce,issuer_issue_deadline,calldata_hash)
 VALUES(successor,x.claim_id,x.slot_id,release,r.value->>'voucherId',ctx->'claim'->>'issuer_wallet',r.value->>'newOpId',
 (r.value->>'newNonce')::bigint,(r.value->>'newDeadline')::bigint,r.candidate_calldata_hash) RETURNING * INTO o;
 PERFORM mf_t1f_recovery.valid_consumption();
 RETURN jsonb_build_object('created',true,'operation',to_jsonb(o),'consumption',to_jsonb(x));
END $$;
CREATE FUNCTION mf_t1f_execution.bind_successor(p_id uuid,p_revision bigint,p_hash text,p_evidence jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='5s' SET lock_timeout='2s' AS $$
DECLARE o mf_t1e.successor_issue_operations;
BEGIN
 PERFORM pg_advisory_xact_lock(10143,160026); PERFORM mf_t1f_recovery.context();
 SELECT * INTO o FROM mf_t1e.successor_issue_operations WHERE successor_id=p_id FOR UPDATE;
 IF o.successor_id IS NULL OR p_hash IS NULL OR p_hash !~ '^0x[0-9a-f]{64}$'
 OR NOT mf_t1f_execution.exact(p_evidence,ARRAY['version','chainId','from','to','nonce','value','calldataHash','txHash'])
 OR p_evidence IS DISTINCT FROM jsonb_build_object('version','T1F_BOUND_TRANSACTION_V1','chainId','10143',
 'from',o.issuer_wallet,'to',o.escrow,'nonce',o.issuer_nonce::text,'value','0','calldataHash',o.calldata_hash,'txHash',p_hash)
 THEN RAISE EXCEPTION 'T1F_017_BIND_INVALID'; END IF;
 IF o.tx_hash=p_hash AND o.stage IN ('ISSUE_HASH_BOUND','ISSUED') AND p_revision=o.revision THEN RETURN to_jsonb(o); END IF;
 IF o.stage<>'ISSUE_UNKNOWN' OR o.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'T1F_017_CAS_CONFLICT'; END IF;
 UPDATE mf_t1e.successor_issue_operations SET stage='ISSUE_HASH_BOUND',tx_hash=p_hash,revision=revision+1 WHERE successor_id=p_id RETURNING * INTO o;
 PERFORM mf_t1f_recovery.valid_consumption(); RETURN to_jsonb(o);
END $$;
CREATE FUNCTION mf_t1f_execution.reconcile_successor(p_id uuid,p_revision bigint,p_evidence jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='5s' SET lock_timeout='2s' AS $$
DECLARE o mf_t1e.successor_issue_operations;
BEGIN
 PERFORM pg_advisory_xact_lock(10143,160026); PERFORM mf_t1f_recovery.context();
 SELECT * INTO o FROM mf_t1e.successor_issue_operations WHERE successor_id=p_id FOR UPDATE;
 IF o.successor_id IS NULL OR o.tx_hash IS NULL
 OR NOT mf_t1f_execution.exact(p_evidence,ARRAY['version','txHash','blockNumber','blockHash','canonical','receiptSucceeded','expectedEventsValid','operationValid','accountingValid'])
 OR p_evidence->>'version' IS DISTINCT FROM 'T1F_RECONCILIATION_V1'
 OR p_evidence->>'txHash' IS DISTINCT FROM o.tx_hash
 OR p_evidence->>'blockNumber' !~ '^[1-9][0-9]{0,15}$' OR jsonb_typeof(p_evidence->'blockNumber')<>'string'
 OR p_evidence->>'blockHash' !~ '^0x[0-9a-f]{64}$'
 OR p_evidence->'canonical' IS DISTINCT FROM 'true'::jsonb
 OR p_evidence->'receiptSucceeded' IS DISTINCT FROM 'true'::jsonb
 OR p_evidence->'expectedEventsValid' IS DISTINCT FROM 'true'::jsonb
 OR p_evidence->'operationValid' IS DISTINCT FROM 'true'::jsonb
 OR p_evidence->'accountingValid' IS DISTINCT FROM 'true'::jsonb
 THEN RAISE EXCEPTION 'T1F_017_RECONCILE_INVALID'; END IF;
 IF o.stage='ISSUED' AND p_revision=o.revision AND o.receipt_block::text=p_evidence->>'blockNumber' AND o.receipt_block_hash=p_evidence->>'blockHash' THEN RETURN to_jsonb(o); END IF;
 IF o.stage<>'ISSUE_HASH_BOUND' OR o.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'T1F_017_CAS_CONFLICT'; END IF;
 UPDATE mf_t1e.successor_issue_operations SET stage='ISSUED',receipt_block=(p_evidence->>'blockNumber')::bigint,
 receipt_block_hash=p_evidence->>'blockHash',revision=revision+1 WHERE successor_id=p_id RETURNING * INTO o;
 PERFORM mf_t1f_recovery.valid_consumption(); RETURN to_jsonb(o);
END $$;
-- Ownership and ACLs: only five execution entrypoints and five collector ones.
ALTER FUNCTION mf_t1f_recovery.original_context() OWNER TO mf_t1f_approval_owner;
ALTER FUNCTION mf_t1f_recovery.valid_consumption() OWNER TO mf_t1f_approval_owner;
ALTER FUNCTION mf_t1f_recovery.write_context() OWNER TO mf_t1f_approval_owner;
DO $$ DECLARE f regprocedure; BEGIN
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='mf_t1f_execution' LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO mf_t1f_execution_owner',f);
 END LOOP;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA mf_t1f_execution FROM PUBLIC;
REVOKE ALL ON FUNCTION mf_t1f_recovery.original_context(),mf_t1f_recovery.valid_consumption(),mf_t1f_recovery.write_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mf_t1f_recovery.original_context(),mf_t1f_recovery.valid_consumption(),mf_t1f_recovery.context(),mf_t1f_recovery.row_json(uuid) TO mf_t1f_execution_owner;
GRANT USAGE ON SCHEMA mf_t1f_execution TO mf_t1f_execution_runtime;
GRANT EXECUTE ON FUNCTION mf_t1f_execution.execution_context(),mf_t1f_execution.execution_round(uuid),
 mf_t1f_execution.consume_round_and_reserve(uuid,text,jsonb),mf_t1f_execution.bind_successor(uuid,bigint,text,jsonb),
 mf_t1f_execution.reconcile_successor(uuid,bigint,jsonb) TO mf_t1f_execution_runtime;
REVOKE ALL ON mf_t1f_execution.consumptions FROM PUBLIC;
REVOKE mf_t1f_execution_owner FROM CURRENT_USER GRANTED BY CURRENT_USER;
REVOKE mf_t1f_approval_owner FROM CURRENT_USER GRANTED BY CURRENT_USER;
COMMIT;
