-- MealForward T1-E: ONE original FUNDED Testnet voucher claimant, no issue tx.
-- NEW private schema and a distinct NOLOGIN runtime principal.
-- This only prepares secure offchain state. No recipient is enrolled by DDL,
-- and no onchain Issue, Lock, MarkHandover, Report or Settle is authorized.
--
-- Apply ONLY to the isolated mealforward-t1-staging PG17 project AFTER
-- independently proving the first funded 7 Test USDC donor Intent is canonical.
DO $gate$
BEGIN
 IF current_database()<>'postgres'
  OR current_setting('server_version_num')::integer<170000
  OR to_regclass('mf_t1c.intents') IS NULL
  OR to_regclass('mf_t1c.wallet_attempts') IS NULL
  OR to_regclass('mf_t1d_auth.sessions') IS NULL
  OR to_regnamespace('mf_t1e') IS NOT NULL
  OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname='mf_t1e_claim_runtime')
  OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='mf_t1d_fund_runtime' AND NOT rolsuper AND NOT rolbypassrls)
  OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='mf_t1d_auth_runtime' AND NOT rolsuper AND NOT rolbypassrls)
  OR has_table_privilege('mf_t1c_intent_runtime','mf_t1c.intents','INSERT')
  OR (SELECT count(*) FROM mf_t1c.intents)<>1
  OR (SELECT count(*) FROM mf_t1c.intents
      WHERE intent_id='2b9ae6f1-2bb7-4096-8136-70f30f302eea'::uuid
       AND stage='FUNDED'
       AND payer='0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952'
       AND quote_id='0xd19b6ca862dc452dd13246bac6faba2d024ba7c59add7e614c6d3b9b54421e12'
       AND quantity=1 AND amount=7000000)<>1
  OR (SELECT count(*) FROM mf_t1c.wallet_attempts
      WHERE intent_id='2b9ae6f1-2bb7-4096-8136-70f30f302eea'::uuid
      AND status='CONFIRMED' AND receipt_status=1
      AND ((kind='approve' AND tx_hash='0x0b5ef56afe4e8ffcba6349b7893929231213a130896a7810d5f428723b4a218d')
        OR (kind='fund' AND tx_hash='0x6d241844fc0edda40af1c30eceab11ac0b95057337218de21e0c4026954ce219')))<>2
 THEN RAISE EXCEPTION 'T1E_ORIGINAL_FUNDED_ONE_UNIT_MIGRATION_GATE_DENIED'; END IF;
END $gate$;

CREATE SCHEMA mf_t1e;
REVOKE ALL ON SCHEMA mf_t1e FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE mf_t1e.recipient_claims(
 claim_id uuid PRIMARY KEY,
 funding_intent uuid NOT NULL REFERENCES mf_t1c.intents(intent_id) ON DELETE RESTRICT
  CHECK (funding_intent='2b9ae6f1-2bb7-4096-8136-70f30f302eea'::uuid),
 chain_id integer NOT NULL DEFAULT 10143 CHECK(chain_id=10143),
 escrow text NOT NULL DEFAULT '0xcf0c8827c8610eeff1ecbd9719e559d805fafe58'
  CHECK(escrow='0xcf0c8827c8610eeff1ecbd9719e559d805fafe58'),
 meal_id text NOT NULL DEFAULT '0x44f977bbf22112030199e42ccf232d08fe6e8223be9c274944c8a40671f6ae6b'
  CHECK(meal_id='0x44f977bbf22112030199e42ccf232d08fe6e8223be9c274944c8a40671f6ae6b'),
 terms_hash text NOT NULL DEFAULT '0x0ec28ec279f5a4b4321da6d4b1698fea8e57cd8a64743de02677c73cb86a9222'
  CHECK(terms_hash='0x0ec28ec279f5a4b4321da6d4b1698fea8e57cd8a64743de02677c73cb86a9222'),
 unit_seq smallint NOT NULL DEFAULT 0 CHECK(unit_seq=0),
 generation bigint NOT NULL DEFAULT 1 CHECK(generation=1),
 voucher_id text NOT NULL UNIQUE CHECK(voucher_id ~ '^0x[0-9a-f]{64}$' AND voucher_id <> '0x' || repeat('0',64)),
 beneficiary_wallet text NOT NULL CHECK(
  beneficiary_wallet ~ '^0x[0-9a-f]{40}$'
  AND beneficiary_wallet NOT IN (
   '0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952',
   '0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3',
   '0xc4f8a468f10d5f98dcff3282516125e97f26433b',
   '0x3dc9d4509062cba2cfc8edd3a8d656839a50165',
   '0x41dcbfed391b79fac7b2951dd136c6b7e1384259'
  )
 ),
 issuer_wallet text NOT NULL DEFAULT '0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3'
  CHECK(issuer_wallet='0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3'),
 consent_nonce text NOT NULL UNIQUE CHECK(
  consent_nonce ~ '^0x[0-9a-f]{64}$' AND consent_nonce <> '0x' || repeat('0',64)
 ),
 consent_deadline bigint NOT NULL CHECK(consent_deadline>0),
 consent_digest text CHECK(consent_digest ~ '^0x[0-9a-f]{64}$'),
 consent_signature_fingerprint text CHECK(consent_signature_fingerprint ~ '^0x[0-9a-f]{64}$'),
 stage text NOT NULL DEFAULT 'PREPARED' CHECK(stage IN
  ('PREPARED','CONSENT_VERIFIED','ISSUE_UNKNOWN','ISSUE_HASH_BOUND','ISSUED','BLOCKED')),
 issuer_op_id text UNIQUE CHECK(issuer_op_id ~ '^0x[0-9a-f]{64}$'),
 issuer_tx_nonce bigint CHECK(issuer_tx_nonce>=0),
 issuer_tx_data_hash text CHECK(issuer_tx_data_hash ~ '^0x[0-9a-f]{64}$'),
 issuer_tx_hash text UNIQUE CHECK(issuer_tx_hash ~ '^0x[0-9a-f]{64}$'),
 receipt_block bigint CHECK(receipt_block>=0),
 receipt_block_hash text CHECK(receipt_block_hash ~ '^0x[0-9a-f]{64}$'),
 revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(funding_intent,unit_seq,generation),
 UNIQUE(issuer_wallet,issuer_tx_nonce),
 CHECK ((consent_digest IS NULL)=(consent_signature_fingerprint IS NULL)),
 CHECK ((stage='PREPARED' AND consent_digest IS NULL)
  OR (stage IN ('CONSENT_VERIFIED','ISSUE_UNKNOWN','ISSUE_HASH_BOUND','ISSUED')
    AND consent_digest IS NOT NULL) OR stage='BLOCKED'),
 CHECK ((stage IN ('ISSUE_UNKNOWN','ISSUE_HASH_BOUND','ISSUED')
  AND issuer_op_id IS NOT NULL AND issuer_tx_nonce IS NOT NULL AND issuer_tx_data_hash IS NOT NULL)
  OR (stage IN ('PREPARED','CONSENT_VERIFIED')
    AND issuer_op_id IS NULL AND issuer_tx_nonce IS NULL AND issuer_tx_data_hash IS NULL)
  OR stage='BLOCKED'),
 CHECK ((stage IN ('ISSUE_HASH_BOUND','ISSUED') AND issuer_tx_hash IS NOT NULL)
  OR (stage IN ('PREPARED','CONSENT_VERIFIED','ISSUE_UNKNOWN') AND issuer_tx_hash IS NULL)
  OR stage='BLOCKED'),
 CHECK ((stage='ISSUED' AND receipt_block IS NOT NULL AND receipt_block_hash IS NOT NULL)
  OR (stage<>'ISSUED' AND receipt_block IS NULL AND receipt_block_hash IS NULL))
);
CREATE UNIQUE INDEX t1e_first_unit_generation_claim_unique
 ON mf_t1e.recipient_claims(chain_id,escrow,unit_seq,generation);

CREATE FUNCTION mf_t1e.claim_before_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $claim$
DECLARE parent mf_t1c.intents;
BEGIN
 SELECT * INTO parent FROM mf_t1c.intents
 WHERE intent_id=NEW.funding_intent FOR SHARE;
 IF NOT FOUND OR parent.stage<>'FUNDED'
  OR parent.amount<>7000000 OR parent.quantity<>1
  OR parent.payer<>'0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952'
 THEN RAISE EXCEPTION USING ERRCODE='P0001',
  MESSAGE='T1E_ORIGINAL_FUNDED_INTENT_REQUIRED'; END IF;
 RETURN NEW;
END $claim$;
CREATE TRIGGER t1e_claim_funded_only BEFORE INSERT ON mf_t1e.recipient_claims
 FOR EACH ROW EXECUTE FUNCTION mf_t1e.claim_before_insert();
REVOKE ALL ON FUNCTION mf_t1e.claim_before_insert() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION mf_t1e.claim_immutable_update() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF (NEW.claim_id,NEW.funding_intent,NEW.chain_id,NEW.escrow,NEW.meal_id,
     NEW.terms_hash,NEW.unit_seq,NEW.generation,NEW.voucher_id,
     NEW.beneficiary_wallet,NEW.issuer_wallet,NEW.consent_nonce,
     NEW.consent_deadline,NEW.created_at)
 IS DISTINCT FROM
    (OLD.claim_id,OLD.funding_intent,OLD.chain_id,OLD.escrow,OLD.meal_id,
     OLD.terms_hash,OLD.unit_seq,OLD.generation,OLD.voucher_id,
     OLD.beneficiary_wallet,OLD.issuer_wallet,OLD.consent_nonce,
     OLD.consent_deadline,OLD.created_at)
 THEN RAISE EXCEPTION USING ERRCODE='P0001',
  MESSAGE='T1E_CLAIM_IDENTITY_IMMUTABLE'; END IF;
 IF NEW.revision<>OLD.revision+1 THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='T1E_REVISION_REQUIRED'; END IF;
 IF OLD.consent_digest IS NOT NULL AND
  (NEW.consent_digest,NEW.consent_signature_fingerprint) IS DISTINCT FROM
  (OLD.consent_digest,OLD.consent_signature_fingerprint)
 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='T1E_CONSENT_IMMUTABLE'; END IF;
 IF OLD.issuer_op_id IS NOT NULL AND
  (NEW.issuer_op_id,NEW.issuer_tx_nonce,NEW.issuer_tx_data_hash) IS DISTINCT FROM
  (OLD.issuer_op_id,OLD.issuer_tx_nonce,OLD.issuer_tx_data_hash)
 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='T1E_ISSUER_ORIGINAL_TX_IMMUTABLE'; END IF;
 IF OLD.issuer_tx_hash IS NOT NULL AND NEW.issuer_tx_hash IS DISTINCT FROM OLD.issuer_tx_hash
 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='T1E_ORIGINAL_HASH_IMMUTABLE'; END IF;
 IF NOT (
  (OLD.stage='PREPARED' AND NEW.stage='CONSENT_VERIFIED') OR
  (OLD.stage='CONSENT_VERIFIED' AND NEW.stage='ISSUE_UNKNOWN') OR
  (OLD.stage='ISSUE_UNKNOWN' AND NEW.stage='ISSUE_HASH_BOUND') OR
  (OLD.stage='ISSUE_HASH_BOUND' AND NEW.stage='ISSUED') OR
  (NEW.stage='BLOCKED' AND OLD.stage NOT IN ('ISSUED','BLOCKED'))
 ) THEN RAISE EXCEPTION USING ERRCODE='P0001',
  MESSAGE='T1E_INVALID_CLAIM_STAGE_TRANSITION'; END IF;
 NEW.updated_at=clock_timestamp();
 RETURN NEW;
END $$;
CREATE TRIGGER t1e_claim_immutable BEFORE UPDATE ON mf_t1e.recipient_claims
 FOR EACH ROW EXECUTE FUNCTION mf_t1e.claim_immutable_update();

CREATE FUNCTION mf_t1e.claim_forbid_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='T1E_CLAIM_DELETE_FORBIDDEN'; END $$;
CREATE TRIGGER t1e_claim_no_delete BEFORE DELETE ON mf_t1e.recipient_claims
 FOR EACH ROW EXECUTE FUNCTION mf_t1e.claim_forbid_delete();
CREATE TRIGGER t1e_claim_no_truncate BEFORE TRUNCATE ON mf_t1e.recipient_claims
 FOR EACH STATEMENT EXECUTE FUNCTION mf_t1e.claim_forbid_delete();

CREATE TABLE mf_t1e.claim_events(
 event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 claim_id uuid NOT NULL REFERENCES mf_t1e.recipient_claims(claim_id) ON DELETE RESTRICT,
 event_type text NOT NULL CHECK(event_type IN(
  'CLAIM_PREPARED','CONSENT_VERIFIED','ISSUE_RESERVED',
  'ISSUE_HASH_BOUND','ISSUE_CONFIRMED','CLAIM_BLOCKED')),
 original_tx_hash text CHECK(original_tx_hash ~ '^0x[0-9a-f]{64}$'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER t1e_claim_event_no_update_delete
 BEFORE UPDATE OR DELETE ON mf_t1e.claim_events FOR EACH ROW
 EXECUTE FUNCTION mf_t1e.claim_forbid_delete();
CREATE TRIGGER t1e_claim_event_no_truncate
 BEFORE TRUNCATE ON mf_t1e.claim_events FOR EACH STATEMENT
 EXECUTE FUNCTION mf_t1e.claim_forbid_delete();

-- This role cannot authenticate to the database until an owner-local
-- human approval. It cannot access any T1-C/T1-D Auth or money table.
CREATE ROLE mf_t1e_claim_runtime NOLOGIN NOINHERIT
 NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT CONNECT ON DATABASE postgres TO mf_t1e_claim_runtime;
GRANT USAGE ON SCHEMA mf_t1e TO mf_t1e_claim_runtime;
GRANT SELECT,INSERT ON mf_t1e.recipient_claims TO mf_t1e_claim_runtime;
GRANT UPDATE(
 stage,revision,consent_digest,consent_signature_fingerprint,
 issuer_op_id,issuer_tx_nonce,issuer_tx_data_hash,issuer_tx_hash,
 receipt_block,receipt_block_hash
) ON mf_t1e.recipient_claims TO mf_t1e_claim_runtime;
REVOKE DELETE,TRUNCATE,TRIGGER,REFERENCES
 ON mf_t1e.recipient_claims FROM mf_t1e_claim_runtime;
GRANT SELECT,INSERT ON mf_t1e.claim_events TO mf_t1e_claim_runtime;
GRANT USAGE,SELECT ON SEQUENCE mf_t1e.claim_events_event_id_seq
 TO mf_t1e_claim_runtime;
REVOKE ALL ON SCHEMA mf_t1e FROM
 mf_t1c_auth_runtime,mf_t1c_intent_runtime,
 mf_t1d_auth_runtime,mf_t1d_fund_runtime;
REVOKE ALL ON ALL TABLES IN SCHEMA mf_t1e FROM
 PUBLIC,anon,authenticated,service_role,
 mf_t1c_auth_runtime,mf_t1c_intent_runtime,
 mf_t1d_auth_runtime,mf_t1d_fund_runtime;

COMMENT ON SCHEMA mf_t1e IS
 'Isolated Testnet recipient consent and issuer operation ledger; not an onchain recipient binding or food delivery proof.';
