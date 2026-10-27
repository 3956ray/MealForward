-- SOURCE ONLY: bounded Phase8 child; no LOGIN, membership, live activation or old-row mutations.
BEGIN;
GRANT mf_t1f_execution_owner TO CURRENT_USER WITH INHERIT TRUE GRANTED BY CURRENT_USER;
GRANT mf_t1f_execution_owner TO CURRENT_USER WITH SET TRUE GRANTED BY CURRENT_USER;
DO $$ BEGIN
 PERFORM pg_advisory_xact_lock(10143,160026);
 IF current_database()<>'postgres' OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
 OR to_regnamespace('mf_t1f_phase8') IS NOT NULL OR to_regprocedure('mf_t1f_execution.execution_context()') IS NULL
 THEN RAISE EXCEPTION 'T1F_PHASE8_PREREQUISITE'; END IF;
END $$;
CREATE ROLE mf_t1f_phase8_owner NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE mf_t1f_phase8_operator_runtime NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE mf_t1f_phase8_collector_runtime NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE mf_t1f_phase8_execution_runtime NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT mf_t1f_phase8_owner TO CURRENT_USER WITH INHERIT TRUE GRANTED BY CURRENT_USER;
GRANT mf_t1f_phase8_owner TO CURRENT_USER WITH SET TRUE GRANTED BY CURRENT_USER;
CREATE SCHEMA mf_t1f_phase8 AUTHORIZATION mf_t1f_phase8_owner;
REVOKE ALL ON SCHEMA mf_t1f_phase8 FROM PUBLIC;
GRANT USAGE ON SCHEMA mf_t1f_execution,mf_t1e TO mf_t1f_phase8_owner;
GRANT EXECUTE ON FUNCTION mf_t1f_execution.execution_context() TO mf_t1f_phase8_owner;
-- Row locking needs a column UPDATE privilege; old immutable trigger still rejects edits.
GRANT SELECT,UPDATE(successor_id),REFERENCES(successor_id) ON mf_t1e.successor_issue_operations TO mf_t1f_phase8_owner;
SET LOCAL ROLE mf_t1f_phase8_owner;
ALTER DEFAULT PRIVILEGES IN SCHEMA mf_t1f_phase8 REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
CREATE FUNCTION mf_t1f_phase8.exact(p jsonb,k text[]) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_typeof(p)='object' AND (SELECT array_agg(x ORDER BY x) FROM jsonb_object_keys(p) x)=(SELECT array_agg(x ORDER BY x) FROM unnest(k) x) AND NOT EXISTS(SELECT 1 FROM jsonb_each(p) e WHERE e.value='null'::jsonb),false)
$$;
CREATE FUNCTION mf_t1f_phase8.immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'T1F_PHASE8_IMMUTABLE'; END $$;
CREATE TABLE mf_t1f_phase8.rounds(
 round_id uuid PRIMARY KEY,value jsonb NOT NULL,digest text NOT NULL UNIQUE CHECK(digest ~ '^0x[0-9a-f]{64}$'),
 created_at_epoch bigint NOT NULL,observed_block_time bigint NOT NULL,candidate_calldata_hash text NOT NULL CHECK(candidate_calldata_hash ~ '^0x[0-9a-f]{64}$'),
 nonce_domain text NOT NULL UNIQUE,new_op_id text NOT NULL UNIQUE,wallet_observed_at bigint NOT NULL,
 CHECK(wallet_observed_at<=created_at_epoch AND created_at_epoch-wallet_observed_at<=120)
);
CREATE TABLE mf_t1f_phase8.approvals(
 round_id uuid REFERENCES mf_t1f_phase8.rounds NOT NULL,role text NOT NULL CHECK(role IN ('owner','donor')),wallet text NOT NULL,
 digest text NOT NULL,fingerprint text NOT NULL CHECK(fingerprint ~ '^0x[0-9a-f]{64}$'),verified_at_epoch bigint NOT NULL,
 verification_version text NOT NULL DEFAULT 'T1F_PHASE8_EIP712_EOA_V1' CHECK(verification_version='T1F_PHASE8_EIP712_EOA_V1'),
 PRIMARY KEY(round_id,role),CHECK((role='owner' AND wallet='0xc4f8a468f10d5f98dcff3282516125e97f26433b') OR (role='donor' AND wallet='0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952'))
);
CREATE TABLE mf_t1f_phase8.operations(
 successor_id uuid PRIMARY KEY,round_id uuid NOT NULL UNIQUE REFERENCES mf_t1f_phase8.rounds,
 predecessor_id uuid NOT NULL UNIQUE REFERENCES mf_t1e.successor_issue_operations(successor_id) CHECK(predecessor_id='8872119f-8c4c-4f0d-8c3a-10c841f1018f'::uuid),
 claim_id uuid NOT NULL UNIQUE CHECK(claim_id='fbab3b22-965d-44e2-b144-d7307b7aa8ea'::uuid),slot_id uuid NOT NULL CHECK(slot_id='e197f0cb-412e-4412-b8d5-9c15059e21e7'::uuid),release_id uuid NOT NULL UNIQUE,
 chain_id integer NOT NULL CHECK(chain_id=10143),escrow text NOT NULL CHECK(escrow='0xcf0c8827c8610eeff1ecbd9719e559d805fafe58'),voucher_id text NOT NULL CHECK(voucher_id='0x170f16ef9ea00697bcfad635e33d521159db5e852b8b5499ddf8db819278b605'),issuer_wallet text NOT NULL CHECK(issuer_wallet='0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3'),
 operation_id text NOT NULL UNIQUE CHECK(operation_id ~ '^0x[0-9a-f]{64}$'),issuer_nonce bigint NOT NULL CHECK(issuer_nonce=0),issuer_issue_deadline bigint NOT NULL,
 calldata_hash text NOT NULL CHECK(calldata_hash ~ '^0x[0-9a-f]{64}$'),stage text NOT NULL CHECK(stage IN ('ISSUE_UNKNOWN','ISSUE_HASH_BOUND','ISSUED')),
 tx_hash text UNIQUE CHECK(tx_hash ~ '^0x[0-9a-f]{64}$'),receipt_block bigint,receipt_block_hash text,revision bigint NOT NULL DEFAULT 0,
 consumed_at_epoch bigint NOT NULL,may_broadcast_by_server boolean NOT NULL DEFAULT false CHECK(NOT may_broadcast_by_server),approved_for_settlement boolean NOT NULL DEFAULT false CHECK(NOT approved_for_settlement),
 CHECK((stage='ISSUE_UNKNOWN' AND revision=0 AND tx_hash IS NULL AND receipt_block IS NULL AND receipt_block_hash IS NULL) OR (stage='ISSUE_HASH_BOUND' AND revision=1 AND tx_hash IS NOT NULL AND receipt_block IS NULL AND receipt_block_hash IS NULL) OR (stage='ISSUED' AND revision=2 AND tx_hash IS NOT NULL AND receipt_block IS NOT NULL AND receipt_block_hash IS NOT NULL AND receipt_block>0 AND receipt_block_hash ~ '^0x[0-9a-f]{64}$'))
);
CREATE TABLE mf_t1f_phase8.events(event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,successor_id uuid NOT NULL REFERENCES mf_t1f_phase8.operations,
 event_type text NOT NULL CHECK(event_type IN ('ISSUE_RESERVED','ISSUE_HASH_BOUND','ISSUED_CONFIRMED')),revision bigint NOT NULL,tx_hash text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(successor_id,revision));
CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON mf_t1f_phase8.rounds FOR EACH ROW EXECUTE FUNCTION mf_t1f_phase8.immutable();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON mf_t1f_phase8.rounds FOR EACH STATEMENT EXECUTE FUNCTION mf_t1f_phase8.immutable();
CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON mf_t1f_phase8.approvals FOR EACH ROW EXECUTE FUNCTION mf_t1f_phase8.immutable();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON mf_t1f_phase8.approvals FOR EACH STATEMENT EXECUTE FUNCTION mf_t1f_phase8.immutable();
CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON mf_t1f_phase8.events FOR EACH ROW EXECUTE FUNCTION mf_t1f_phase8.immutable();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON mf_t1f_phase8.events FOR EACH STATEMENT EXECUTE FUNCTION mf_t1f_phase8.immutable();
CREATE TRIGGER immutable_delete BEFORE DELETE ON mf_t1f_phase8.operations FOR EACH ROW EXECUTE FUNCTION mf_t1f_phase8.immutable();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON mf_t1f_phase8.operations FOR EACH STATEMENT EXECUTE FUNCTION mf_t1f_phase8.immutable();
CREATE FUNCTION mf_t1f_phase8.operation_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['stage','tx_hash','receipt_block','receipt_block_hash','revision']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['stage','tx_hash','receipt_block','receipt_block_hash','revision']) OR NEW.revision<>OLD.revision+1 OR NOT ((OLD.stage='ISSUE_UNKNOWN' AND NEW.stage='ISSUE_HASH_BOUND') OR (OLD.stage='ISSUE_HASH_BOUND' AND NEW.stage='ISSUED' AND NEW.tx_hash=OLD.tx_hash))) THEN RAISE EXCEPTION 'T1F_PHASE8_OPERATION_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_identity BEFORE UPDATE ON mf_t1f_phase8.operations FOR EACH ROW EXECUTE FUNCTION mf_t1f_phase8.operation_guard();
CREATE FUNCTION mf_t1f_phase8.predecessor_context() RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$ DECLARE e jsonb; BEGIN
 e=mf_t1f_execution.execution_context();
 IF NOT coalesce(e->'operation' @> '{"successor_id":"8872119f-8c4c-4f0d-8c3a-10c841f1018f","operation_id":"0xa26a490285c09acf65c4970a05c69574bc1502e6d92e8e1538b7da84ef21443b","issuer_nonce":0,"issuer_issue_deadline":1793079867,"calldata_hash":"0x0b656a95e4880d19b9cd131ff5504286fb27ef4a2714723cd32e8da9b99cc393","stage":"ISSUE_UNKNOWN","tx_hash":null,"revision":0,"claim_id":"fbab3b22-965d-44e2-b144-d7307b7aa8ea","slot_id":"e197f0cb-412e-4412-b8d5-9c15059e21e7","voucher_id":"0x170f16ef9ea00697bcfad635e33d521159db5e852b8b5499ddf8db819278b605","issuer_wallet":"0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3","escrow":"0xcf0c8827c8610eeff1ecbd9719e559d805fafe58","chain_id":10143,"receipt_block":null,"receipt_block_hash":null}'::jsonb,false)
 OR e->'round'->>'round_id' IS DISTINCT FROM 'cb9ca0dc-d466-4a6f-83e1-53b0d50f07c0' OR e->'round'->>'digest' IS DISTINCT FROM '0xebcf24ea5e1738f09e0093881e7058b55e660c45a815d597c9b16a7dde72ad58'
 OR e->'context'->'claim'->>'stage' IS DISTINCT FROM 'ISSUE_UNKNOWN' THEN RAISE EXCEPTION 'T1F_PHASE8_PREDECESSOR_CHANGED'; END IF;
 RETURN e;
END $$;
CREATE FUNCTION mf_t1f_phase8.lock_context() RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(10143,160026);
 PERFORM 1 FROM mf_t1e.successor_issue_operations WHERE successor_id='8872119f-8c4c-4f0d-8c3a-10c841f1018f'::uuid FOR SHARE;
 RETURN mf_t1f_phase8.predecessor_context();
END $$;
CREATE FUNCTION mf_t1f_phase8.row_json(p_id uuid) RETURNS jsonb LANGUAGE sql SET search_path=pg_catalog AS $$
 SELECT to_jsonb(r)-ARRAY['nonce_domain','new_op_id','wallet_observed_at'] || jsonb_build_object('approvals',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.role) FROM mf_t1f_phase8.approvals a WHERE a.round_id=r.round_id),'[]'::jsonb)) FROM mf_t1f_phase8.rounds r WHERE r.round_id=p_id
$$;
CREATE FUNCTION mf_t1f_phase8.context() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='5s' SET lock_timeout='2s' AS $$ DECLARE e jsonb; o mf_t1f_phase8.operations; rid uuid; BEGIN
 e=mf_t1f_phase8.predecessor_context(); SELECT * INTO o FROM mf_t1f_phase8.operations;
 IF o.successor_id IS NOT NULL THEN rid=o.round_id; ELSE SELECT round_id INTO rid FROM mf_t1f_phase8.rounds ORDER BY created_at_epoch DESC,round_id DESC LIMIT 1; END IF;
 RETURN jsonb_build_object('context',e->'context','predecessor',e->'operation','round',mf_t1f_phase8.row_json(rid),'operation',CASE WHEN o.successor_id IS NULL THEN NULL ELSE to_jsonb(o) END);
END $$;
CREATE FUNCTION mf_t1f_phase8.get_round(p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='5s' SET lock_timeout='2s' AS $$ DECLARE e jsonb; o mf_t1f_phase8.operations; BEGIN
 e=mf_t1f_phase8.predecessor_context(); SELECT * INTO o FROM mf_t1f_phase8.operations WHERE round_id=p_id;
 RETURN jsonb_build_object('context',e->'context','predecessor',e->'operation','round',mf_t1f_phase8.row_json(p_id),'operation',CASE WHEN o.successor_id IS NULL THEN NULL ELSE to_jsonb(o) END);
END $$;
CREATE FUNCTION mf_t1f_phase8.observation(p jsonb,ts bigint) RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF NOT mf_t1f_phase8.exact(p,ARRAY['version','chainId','issuer','escrow','finalizedBlockNumber','finalizedBlockHash','finalizedBlockTime','finalizedCanonical','observedBlockNumber','observedBlockHash','observedBlockTime','freshCanonical','issuerLatestNonce','issuerPendingNonce','originalOperationSeen','predecessorOperationSeen','unitAvailable','unitIssued','unitGeneration','unitSeq','mealId','termsHash','codeAndAuthorityValid','accountingValid']) THEN RETURN false; END IF;
 IF p->>'version' IS DISTINCT FROM 'T1F_PHASE8_OBSERVATION_V1' OR p->'chainId' IS DISTINCT FROM '10143'::jsonb OR p->>'issuer' IS DISTINCT FROM '0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3' OR p->>'escrow' IS DISTINCT FROM '0xcf0c8827c8610eeff1ecbd9719e559d805fafe58'
 OR p->>'mealId' IS DISTINCT FROM '0x44f977bbf22112030199e42ccf232d08fe6e8223be9c274944c8a40671f6ae6b' OR p->>'termsHash' IS DISTINCT FROM '0x0ec28ec279f5a4b4321da6d4b1698fea8e57cd8a64743de02677c73cb86a9222'
 OR p->>'issuerLatestNonce' IS DISTINCT FROM '0' OR p->>'issuerPendingNonce' IS DISTINCT FROM '0' OR p->>'unitGeneration' IS DISTINCT FROM '0' OR p->>'unitSeq' IS DISTINCT FROM '0'
 OR p->'originalOperationSeen' IS DISTINCT FROM 'false'::jsonb OR p->'predecessorOperationSeen' IS DISTINCT FROM 'false'::jsonb OR p->'unitIssued' IS DISTINCT FROM 'false'::jsonb
 OR p->'unitAvailable' IS DISTINCT FROM 'true'::jsonb OR p->'finalizedCanonical' IS DISTINCT FROM 'true'::jsonb OR p->'freshCanonical' IS DISTINCT FROM 'true'::jsonb OR p->'codeAndAuthorityValid' IS DISTINCT FROM 'true'::jsonb OR p->'accountingValid' IS DISTINCT FROM 'true'::jsonb
 OR jsonb_typeof(p->'finalizedBlockTime')<>'number' OR jsonb_typeof(p->'observedBlockTime')<>'number'
 OR p->>'finalizedBlockTime' !~ '^[1-9][0-9]{0,15}$' OR p->>'observedBlockTime' !~ '^[1-9][0-9]{0,15}$'
 OR p->>'finalizedBlockNumber' !~ '^[1-9][0-9]{0,15}$' OR p->>'observedBlockNumber' !~ '^[1-9][0-9]{0,15}$'
 OR p->>'finalizedBlockHash' !~ '^0x[0-9a-f]{64}$' OR p->>'observedBlockHash' !~ '^0x[0-9a-f]{64}$' OR p->>'finalizedBlockHash'='0x0000000000000000000000000000000000000000000000000000000000000000' OR p->>'observedBlockHash'='0x0000000000000000000000000000000000000000000000000000000000000000'
 OR EXISTS(SELECT 1 FROM jsonb_each(p) e WHERE e.key IN ('finalizedBlockNumber','observedBlockNumber','issuerLatestNonce','issuerPendingNonce','unitGeneration','unitSeq') AND jsonb_typeof(e.value)<>'string')
 THEN RETURN false; END IF;
 IF p->>'finalizedBlockNumber'=p->>'observedBlockNumber' AND (p->>'finalizedBlockHash' IS DISTINCT FROM p->>'observedBlockHash' OR p->>'finalizedBlockTime' IS DISTINCT FROM p->>'observedBlockTime') THEN RETURN false; END IF;
 RETURN (p->>'finalizedBlockTime')::bigint>=1793079867 AND (p->>'observedBlockTime')::bigint>=(p->>'finalizedBlockTime')::bigint AND (p->>'observedBlockTime')::bigint<=ts AND ts-(p->>'observedBlockTime')::bigint<=120 AND (p->>'observedBlockNumber')::bigint>=(p->>'finalizedBlockNumber')::bigint;
END $$;
CREATE FUNCTION mf_t1f_phase8.create_round(p_id uuid,p_value jsonb,p_digest text,p_created bigint,p_observed bigint,p_calldata text,p_evidence jsonb,p_wallet jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='5s' SET lock_timeout='2s' AS $$ DECLARE ts bigint; BEGIN
 PERFORM mf_t1f_phase8.lock_context(); ts=floor(extract(epoch from clock_timestamp()));
 IF EXISTS(SELECT 1 FROM mf_t1f_phase8.operations) OR EXISTS(SELECT 1 FROM mf_t1f_phase8.rounds WHERE (value->>'approvalExpiresAt')::bigint>ts)
 OR p_id IS NULL OR p_created>ts OR ts-p_created>30 OR p_observed>p_created OR p_created-p_observed>120 OR p_observed IS DISTINCT FROM (p_evidence->>'observedBlockTime')::bigint
 OR p_digest IS NULL OR p_digest !~ '^0x[0-9a-f]{64}$' OR p_calldata IS NULL OR p_calldata !~ '^0x[0-9a-f]{64}$'
 OR NOT mf_t1f_phase8.exact(p_value,ARRAY['claimId','reviewId','slotId','voucherId','originalOpId','originalNonce','originalDeadline','originalDataHash','predecessorId','predecessorOpId','predecessorNonce','predecessorDeadline','predecessorDataHash','predecessorRoundId','predecessorDigest','newOpId','newNonce','newDeadline','nonceDomain','finalizedBlockNumber','finalizedBlockHash','finalizedBlockTime','observedBlockNumber','observedBlockHash','observedBlockTime','approvalExpiresAt'])
 OR EXISTS(SELECT 1 FROM jsonb_each(p_value) e WHERE jsonb_typeof(e.value)<>'string')
 OR NOT mf_t1f_phase8.observation(p_evidence,ts)
 OR NOT mf_t1f_phase8.exact(p_wallet,ARRAY['value','observedAt']) OR p_wallet->>'value' IS DISTINCT FROM 'ISSUER_REPORTED_NO_PENDING_OR_SENT_TRANSACTIONS' OR jsonb_typeof(p_wallet->'observedAt')<>'number'
 OR p_wallet->>'observedAt' !~ '^[1-9][0-9]{0,15}$' OR (p_wallet->>'observedAt')::bigint>p_created OR ts-(p_wallet->>'observedAt')::bigint>120
 OR p_value->>'claimId' IS DISTINCT FROM 'fbab3b22-965d-44e2-b144-d7307b7aa8ea'
 OR p_value->>'reviewId' IS DISTINCT FROM 'bc78fcf5-a76c-4301-b0c3-5fcd37411d30'
 OR p_value->>'slotId' IS DISTINCT FROM 'e197f0cb-412e-4412-b8d5-9c15059e21e7'
 OR p_value->>'voucherId' IS DISTINCT FROM '0x170f16ef9ea00697bcfad635e33d521159db5e852b8b5499ddf8db819278b605'
 OR p_value->>'originalOpId' IS DISTINCT FROM '0x2e709dee8113d2dac73cbea53d016d6629fc3730c6f85325a17c98bc4777445b'
 OR p_value->>'originalNonce' IS DISTINCT FROM '0'
 OR p_value->>'originalDeadline' IS DISTINCT FROM '1792765625'
 OR p_value->>'originalDataHash' IS DISTINCT FROM '0x089cb2b0a35e81f31a9f9a658cd298ad7c9d3376ea01fac6fb77013451e1f0ed'
 OR p_value->>'predecessorId' IS DISTINCT FROM '8872119f-8c4c-4f0d-8c3a-10c841f1018f'
 OR p_value->>'predecessorOpId' IS DISTINCT FROM '0xa26a490285c09acf65c4970a05c69574bc1502e6d92e8e1538b7da84ef21443b'
 OR p_value->>'predecessorNonce' IS DISTINCT FROM '0'
 OR p_value->>'predecessorDeadline' IS DISTINCT FROM '1793079867'
 OR p_value->>'predecessorDataHash' IS DISTINCT FROM '0x0b656a95e4880d19b9cd131ff5504286fb27ef4a2714723cd32e8da9b99cc393'
 OR p_value->>'predecessorRoundId' IS DISTINCT FROM 'cb9ca0dc-d466-4a6f-83e1-53b0d50f07c0'
 OR p_value->>'predecessorDigest' IS DISTINCT FROM '0xebcf24ea5e1738f09e0093881e7058b55e660c45a815d597c9b16a7dde72ad58'
 OR p_value->>'voucherId' !~ '^0x[0-9a-f]{64}$' OR p_value->>'voucherId'='0x0000000000000000000000000000000000000000000000000000000000000000'
 OR p_value->>'originalOpId' !~ '^0x[0-9a-f]{64}$' OR p_value->>'originalOpId'='0x0000000000000000000000000000000000000000000000000000000000000000'
 OR p_value->>'originalDataHash' !~ '^0x[0-9a-f]{64}$' OR p_value->>'originalDataHash'='0x0000000000000000000000000000000000000000000000000000000000000000'
 OR p_value->>'predecessorOpId' !~ '^0x[0-9a-f]{64}$' OR p_value->>'predecessorOpId'='0x0000000000000000000000000000000000000000000000000000000000000000'
 OR p_value->>'predecessorDataHash' !~ '^0x[0-9a-f]{64}$' OR p_value->>'predecessorDataHash'='0x0000000000000000000000000000000000000000000000000000000000000000'
 OR p_value->>'predecessorDigest' !~ '^0x[0-9a-f]{64}$' OR p_value->>'predecessorDigest'='0x0000000000000000000000000000000000000000000000000000000000000000'
 OR p_value->>'newOpId' !~ '^0x[0-9a-f]{64}$' OR p_value->>'newOpId'='0x0000000000000000000000000000000000000000000000000000000000000000'
 OR p_value->>'nonceDomain' !~ '^0x[0-9a-f]{64}$' OR p_value->>'nonceDomain'='0x0000000000000000000000000000000000000000000000000000000000000000'
 OR p_value->>'finalizedBlockHash' !~ '^0x[0-9a-f]{64}$' OR p_value->>'finalizedBlockHash'='0x0000000000000000000000000000000000000000000000000000000000000000'
 OR p_value->>'observedBlockHash' !~ '^0x[0-9a-f]{64}$' OR p_value->>'observedBlockHash'='0x0000000000000000000000000000000000000000000000000000000000000000'
 OR p_value->>'originalNonce' !~ '^(0|[1-9][0-9]{0,15})$'
 OR p_value->>'originalDeadline' !~ '^(0|[1-9][0-9]{0,15})$'
 OR p_value->>'predecessorNonce' !~ '^(0|[1-9][0-9]{0,15})$'
 OR p_value->>'predecessorDeadline' !~ '^(0|[1-9][0-9]{0,15})$'
 OR p_value->>'newNonce' !~ '^(0|[1-9][0-9]{0,15})$'
 OR p_value->>'newDeadline' !~ '^(0|[1-9][0-9]{0,15})$'
 OR p_value->>'finalizedBlockNumber' !~ '^(0|[1-9][0-9]{0,15})$'
 OR p_value->>'finalizedBlockTime' !~ '^(0|[1-9][0-9]{0,15})$'
 OR p_value->>'observedBlockNumber' !~ '^(0|[1-9][0-9]{0,15})$'
 OR p_value->>'observedBlockTime' !~ '^(0|[1-9][0-9]{0,15})$'
 OR p_value->>'approvalExpiresAt' !~ '^(0|[1-9][0-9]{0,15})$'
 OR p_value->>'newNonce' IS DISTINCT FROM '0' OR p_value->>'newOpId' IN ('0x2e709dee8113d2dac73cbea53d016d6629fc3730c6f85325a17c98bc4777445b','0xa26a490285c09acf65c4970a05c69574bc1502e6d92e8e1538b7da84ef21443b')
 OR p_value->>'newDeadline' IS DISTINCT FROM (p_created+480)::text OR p_value->>'approvalExpiresAt' IS DISTINCT FROM (p_created+300)::text
 OR p_value->>'observedBlockNumber' IS DISTINCT FROM p_evidence->>'observedBlockNumber'
 OR p_value->>'observedBlockHash' IS DISTINCT FROM p_evidence->>'observedBlockHash'
 OR p_value->>'observedBlockTime' IS DISTINCT FROM p_evidence->>'observedBlockTime'
 OR p_value->>'finalizedBlockNumber' IS DISTINCT FROM p_evidence->>'finalizedBlockNumber'
 OR p_value->>'finalizedBlockHash' IS DISTINCT FROM p_evidence->>'finalizedBlockHash'
 OR p_value->>'finalizedBlockTime' IS DISTINCT FROM p_evidence->>'finalizedBlockTime'
 THEN RAISE EXCEPTION 'T1F_PHASE8_ROUND_INVALID'; END IF;
 INSERT INTO mf_t1f_phase8.rounds VALUES(p_id,p_value,p_digest,p_created,p_observed,p_calldata,p_value->>'nonceDomain',p_value->>'newOpId',(p_wallet->>'observedAt')::bigint);
 RETURN mf_t1f_phase8.row_json(p_id);
END $$;
CREATE FUNCTION mf_t1f_phase8.record_approval(p_id uuid,p_digest text,p_role text,p_wallet text,p_fingerprint text,p_evidence jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='5s' SET lock_timeout='2s' AS $$ DECLARE r mf_t1f_phase8.rounds; a mf_t1f_phase8.approvals; ts bigint; BEGIN
 PERFORM mf_t1f_phase8.lock_context(); SELECT * INTO r FROM mf_t1f_phase8.rounds WHERE round_id=p_id FOR UPDATE; ts=floor(extract(epoch from clock_timestamp()));
 IF EXISTS(SELECT 1 FROM mf_t1f_phase8.operations) OR r.round_id IS NULL OR r.digest IS DISTINCT FROM p_digest OR ts>=(r.value->>'approvalExpiresAt')::bigint OR ts<r.created_at_epoch
 OR p_role IS NULL OR p_role NOT IN ('owner','donor') OR p_wallet IS DISTINCT FROM (CASE p_role WHEN 'owner' THEN '0xc4f8a468f10d5f98dcff3282516125e97f26433b' ELSE '0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952' END)
 OR p_fingerprint IS NULL OR p_fingerprint !~ '^0x[0-9a-f]{64}$' OR NOT mf_t1f_phase8.observation(p_evidence,ts)
 OR (p_evidence->>'observedBlockNumber')::bigint<(r.value->>'observedBlockNumber')::bigint OR (p_evidence->>'finalizedBlockNumber')::bigint<(r.value->>'finalizedBlockNumber')::bigint
 THEN RAISE EXCEPTION 'T1F_PHASE8_APPROVAL_INVALID'; END IF;
 SELECT * INTO a FROM mf_t1f_phase8.approvals WHERE round_id=p_id AND role=p_role;
 IF a.round_id IS NOT NULL THEN IF a.fingerprint IS DISTINCT FROM p_fingerprint THEN RAISE EXCEPTION 'T1F_PHASE8_APPROVAL_CONFLICT'; END IF; RETURN mf_t1f_phase8.row_json(p_id); END IF;
 INSERT INTO mf_t1f_phase8.approvals(round_id,role,wallet,digest,fingerprint,verified_at_epoch) VALUES(p_id,p_role,p_wallet,p_digest,p_fingerprint,ts);
 RETURN mf_t1f_phase8.row_json(p_id);
END $$;
CREATE FUNCTION mf_t1f_phase8.consume(p_id uuid,p_digest text,p_evidence jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='5s' SET lock_timeout='2s' AS $$ DECLARE r mf_t1f_phase8.rounds; o mf_t1f_phase8.operations; ts bigint; BEGIN
 PERFORM mf_t1f_phase8.lock_context(); SELECT * INTO o FROM mf_t1f_phase8.operations;
 IF o.successor_id IS NOT NULL THEN RETURN jsonb_build_object('created',false,'operation',to_jsonb(o)); END IF;
 SELECT * INTO r FROM mf_t1f_phase8.rounds WHERE round_id=p_id FOR UPDATE; ts=floor(extract(epoch from clock_timestamp()));
 IF r.round_id IS NULL OR r.digest IS DISTINCT FROM p_digest OR ts>=r.created_at_epoch+210 OR ts<r.created_at_epoch
 OR NOT mf_t1f_phase8.exact(p_evidence,ARRAY['version','chainId','issuer','escrow','finalizedBlockNumber','finalizedBlockHash','finalizedBlockTime','finalizedCanonical','observedBlockNumber','observedBlockHash','observedBlockTime','freshCanonical','issuerLatestNonce','issuerPendingNonce','originalOperationSeen','predecessorOperationSeen','unitAvailable','unitIssued','unitGeneration','unitSeq','mealId','termsHash','codeAndAuthorityValid','accountingValid','simulationPassed','calldataHash','signedAnchorCanonical','signedFinalizedCanonical'])
 OR NOT mf_t1f_phase8.observation(p_evidence-ARRAY['simulationPassed','calldataHash','signedAnchorCanonical','signedFinalizedCanonical'],ts)
 OR p_evidence->'simulationPassed' IS DISTINCT FROM 'true'::jsonb OR p_evidence->'signedAnchorCanonical' IS DISTINCT FROM 'true'::jsonb OR p_evidence->'signedFinalizedCanonical' IS DISTINCT FROM 'true'::jsonb
 OR p_evidence->>'calldataHash' IS DISTINCT FROM r.candidate_calldata_hash OR (p_evidence->>'observedBlockNumber')::bigint<(r.value->>'observedBlockNumber')::bigint OR (p_evidence->>'finalizedBlockNumber')::bigint<(r.value->>'finalizedBlockNumber')::bigint
 OR (SELECT count(*) FROM mf_t1f_phase8.approvals a WHERE a.round_id=p_id AND a.digest=r.digest AND a.verified_at_epoch>=r.created_at_epoch AND a.verified_at_epoch<r.created_at_epoch+300 AND a.verified_at_epoch<=ts AND a.verification_version='T1F_PHASE8_EIP712_EOA_V1')<>2
 THEN RAISE EXCEPTION 'T1F_PHASE8_CONSUME_INVALID'; END IF;
 INSERT INTO mf_t1f_phase8.operations(successor_id,round_id,predecessor_id,claim_id,slot_id,release_id,chain_id,escrow,voucher_id,issuer_wallet,operation_id,issuer_nonce,issuer_issue_deadline,calldata_hash,stage,consumed_at_epoch)
 VALUES(gen_random_uuid(),p_id,'8872119f-8c4c-4f0d-8c3a-10c841f1018f'::uuid,'fbab3b22-965d-44e2-b144-d7307b7aa8ea'::uuid,'e197f0cb-412e-4412-b8d5-9c15059e21e7'::uuid,gen_random_uuid(),10143,'0xcf0c8827c8610eeff1ecbd9719e559d805fafe58','0x170f16ef9ea00697bcfad635e33d521159db5e852b8b5499ddf8db819278b605','0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3',r.value->>'newOpId',0,(r.value->>'newDeadline')::bigint,r.candidate_calldata_hash,'ISSUE_UNKNOWN',ts) RETURNING * INTO o;
 INSERT INTO mf_t1f_phase8.events(successor_id,event_type,revision) VALUES(o.successor_id,'ISSUE_RESERVED',0);
 RETURN jsonb_build_object('created',true,'operation',to_jsonb(o));
END $$;
CREATE FUNCTION mf_t1f_phase8.bind(p_id uuid,p_revision bigint,p_hash text,p_evidence jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='5s' SET lock_timeout='2s' AS $$ DECLARE o mf_t1f_phase8.operations; BEGIN
 PERFORM mf_t1f_phase8.lock_context(); SELECT * INTO o FROM mf_t1f_phase8.operations WHERE successor_id=p_id FOR UPDATE;
 IF o.successor_id IS NULL OR p_hash IS NULL OR p_hash !~ '^0x[0-9a-f]{64}$' OR o.stage<>'ISSUE_UNKNOWN' OR o.revision IS DISTINCT FROM p_revision
 OR NOT mf_t1f_phase8.exact(p_evidence,ARRAY['version','chainId','from','to','nonce','value','calldataHash','txHash'])
 OR p_evidence IS DISTINCT FROM jsonb_build_object('version','T1F_BOUND_TRANSACTION_V1','chainId','10143','from',o.issuer_wallet,'to',o.escrow,'nonce',o.issuer_nonce::text,'value','0','calldataHash',o.calldata_hash,'txHash',p_hash)
 THEN RAISE EXCEPTION 'T1F_PHASE8_BIND_INVALID'; END IF;
 UPDATE mf_t1f_phase8.operations SET stage='ISSUE_HASH_BOUND',revision=1,tx_hash=p_hash WHERE successor_id=p_id RETURNING * INTO o;
 INSERT INTO mf_t1f_phase8.events(successor_id,event_type,revision,tx_hash) VALUES(p_id,'ISSUE_HASH_BOUND',1,p_hash); RETURN to_jsonb(o);
END $$;
CREATE FUNCTION mf_t1f_phase8.reconcile(p_id uuid,p_revision bigint,p_evidence jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='5s' SET lock_timeout='2s' AS $$ DECLARE o mf_t1f_phase8.operations; BEGIN
 PERFORM mf_t1f_phase8.lock_context(); SELECT * INTO o FROM mf_t1f_phase8.operations WHERE successor_id=p_id FOR UPDATE;
 IF o.successor_id IS NULL OR o.stage<>'ISSUE_HASH_BOUND' OR o.revision IS DISTINCT FROM p_revision
 OR NOT mf_t1f_phase8.exact(p_evidence,ARRAY['version','txHash','blockNumber','blockHash','canonical','receiptSucceeded','expectedEventsValid','operationValid','accountingValid'])
 OR p_evidence->>'version' IS DISTINCT FROM 'T1F_RECONCILIATION_V1' OR p_evidence->>'txHash' IS DISTINCT FROM o.tx_hash
 OR p_evidence->>'blockNumber' !~ '^[1-9][0-9]{0,15}$' OR jsonb_typeof(p_evidence->'blockNumber')<>'string' OR p_evidence->>'blockHash' !~ '^0x[0-9a-f]{64}$'
 OR p_evidence->'canonical' IS DISTINCT FROM 'true'::jsonb OR p_evidence->'receiptSucceeded' IS DISTINCT FROM 'true'::jsonb OR p_evidence->'expectedEventsValid' IS DISTINCT FROM 'true'::jsonb OR p_evidence->'operationValid' IS DISTINCT FROM 'true'::jsonb OR p_evidence->'accountingValid' IS DISTINCT FROM 'true'::jsonb
 THEN RAISE EXCEPTION 'T1F_PHASE8_RECONCILE_INVALID'; END IF;
 UPDATE mf_t1f_phase8.operations SET stage='ISSUED',revision=2,receipt_block=(p_evidence->>'blockNumber')::bigint,receipt_block_hash=p_evidence->>'blockHash' WHERE successor_id=p_id RETURNING * INTO o;
 INSERT INTO mf_t1f_phase8.events(successor_id,event_type,revision,tx_hash) VALUES(p_id,'ISSUED_CONFIRMED',2,o.tx_hash); RETURN to_jsonb(o);
END $$;
-- Applying this migration requires the exact already-consumed predecessor.
DO $$ BEGIN PERFORM mf_t1f_phase8.predecessor_context(); END $$;
-- All internal helpers remain owner-only. No table/sequence privileges for runtime roles.
REVOKE ALL ON ALL TABLES IN SCHEMA mf_t1f_phase8 FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA mf_t1f_phase8 FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA mf_t1f_phase8 FROM PUBLIC;
GRANT USAGE ON SCHEMA mf_t1f_phase8 TO mf_t1f_phase8_operator_runtime,mf_t1f_phase8_collector_runtime,mf_t1f_phase8_execution_runtime;
GRANT EXECUTE ON FUNCTION mf_t1f_phase8.context(),mf_t1f_phase8.get_round(uuid) TO mf_t1f_phase8_operator_runtime,mf_t1f_phase8_collector_runtime,mf_t1f_phase8_execution_runtime;
GRANT EXECUTE ON FUNCTION mf_t1f_phase8.create_round(uuid,jsonb,text,bigint,bigint,text,jsonb,jsonb) TO mf_t1f_phase8_operator_runtime;
GRANT EXECUTE ON FUNCTION mf_t1f_phase8.record_approval(uuid,text,text,text,text,jsonb) TO mf_t1f_phase8_collector_runtime;
GRANT EXECUTE ON FUNCTION mf_t1f_phase8.consume(uuid,text,jsonb),mf_t1f_phase8.bind(uuid,bigint,text,jsonb),mf_t1f_phase8.reconcile(uuid,bigint,jsonb) TO mf_t1f_phase8_execution_runtime;
RESET ROLE;
REVOKE mf_t1f_phase8_owner FROM CURRENT_USER GRANTED BY CURRENT_USER;
REVOKE mf_t1f_execution_owner FROM CURRENT_USER GRANTED BY CURRENT_USER;
COMMIT;
