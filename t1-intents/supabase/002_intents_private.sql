-- MealForward T1-C: NEW disposable testnet funding-intent store.
-- Fresh PG17.11 CI only. NEVER migrate original CP30 or Render Auth Pilot PG.
-- No private keys, signed vouchers, raw quote signatures or user sessions.
BEGIN;
DO $pre$ BEGIN IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='mf_t1c') THEN RAISE EXCEPTION 'T1C_SCHEMA_EXISTS_STOP'; END IF; END $pre$;
CREATE SCHEMA mf_t1c;
REVOKE ALL ON SCHEMA mf_t1c FROM anon,authenticated,service_role;
REVOKE ALL ON SCHEMA mf_t1c FROM PUBLIC;

CREATE TABLE mf_t1c.intents (
 intent_id uuid PRIMARY KEY,
 chain_id integer NOT NULL DEFAULT 10143 CHECK (chain_id=10143),
 escrow text NOT NULL DEFAULT '0xcf0c8827c8610eeff1ecbd9719e559d805fafe58' CHECK (escrow='0xcf0c8827c8610eeff1ecbd9719e559d805fafe58'),
 payer text NOT NULL CHECK (payer ~ '^0x[0-9a-f]{40}$'),
 idempotency_key uuid NOT NULL,
 quote_id text NOT NULL UNIQUE CHECK (quote_id ~ '^0x[0-9a-f]{64}$' AND quote_id <> '0x' || repeat('0',64)),
 meal_id text NOT NULL CHECK (meal_id='0x44f977bbf22112030199e42ccf232d08fe6e8223be9c274944c8a40671f6ae6b'),
 terms_hash text NOT NULL CHECK (terms_hash='0x0ec28ec279f5a4b4321da6d4b1698fea8e57cd8a64743de02677c73cb86a9222'),
 version integer NOT NULL CHECK (version=1),
 quantity smallint NOT NULL CHECK (quantity BETWEEN 1 AND 10),
 unit_price bigint NOT NULL CHECK (unit_price=7000000),
 amount bigint NOT NULL CHECK (amount=quantity::bigint * unit_price),
 quote_deadline bigint NOT NULL CHECK (quote_deadline>0),
 quote_digest text CHECK (quote_digest ~ '^0x[0-9a-f]{64}$'),
 quote_signature_hash text CHECK (quote_signature_hash ~ '^0x[0-9a-f]{64}$'),
 stage text NOT NULL DEFAULT 'PREPARED'
  CHECK (stage IN ('PREPARED','QUOTE_BOUND','APPROVE_UNKNOWN','APPROVED','FUND_UNKNOWN','FUNDED','FAILED','BLOCKED')),
 revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(chain_id,escrow,payer,idempotency_key),
 CHECK ((quote_digest IS NULL) = (quote_signature_hash IS NULL)),
 CHECK (stage='PREPARED' OR quote_digest IS NOT NULL)
);

CREATE TABLE mf_t1c.wallet_attempts (
 intent_id uuid NOT NULL REFERENCES mf_t1c.intents(intent_id) ON DELETE RESTRICT,
 kind text NOT NULL CHECK (kind IN ('approve','fund')),
 chain_id integer NOT NULL CHECK (chain_id=10143),
 payer text NOT NULL CHECK (payer ~ '^0x[0-9a-f]{40}$'),
 tx_to text NOT NULL CHECK (tx_to ~ '^0x[0-9a-f]{40}$'),
 tx_data_hash text NOT NULL CHECK (tx_data_hash ~ '^0x[0-9a-f]{64}$'),
 tx_nonce bigint NOT NULL CHECK (tx_nonce>=0),
 tx_hash text CHECK (tx_hash ~ '^0x[0-9a-f]{64}$'),
 status text NOT NULL DEFAULT 'UNKNOWN' CHECK(status IN ('UNKNOWN','HASH_BOUND','CONFIRMED','REVERTED','BLOCKED')),
 receipt_block bigint CHECK (receipt_block>=0),
 receipt_block_hash text CHECK (receipt_block_hash ~ '^0x[0-9a-f]{64}$'),
 receipt_status smallint CHECK (receipt_status IN (0,1)),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(intent_id,kind),
 UNIQUE(chain_id,payer,tx_nonce),
 CHECK ((status IN ('UNKNOWN') AND receipt_block IS NULL AND receipt_status IS NULL)
  OR (status='HASH_BOUND' AND tx_hash IS NOT NULL AND receipt_block IS NULL AND receipt_status IS NULL)
  OR (status IN ('CONFIRMED','REVERTED') AND tx_hash IS NOT NULL AND receipt_block IS NOT NULL AND receipt_block_hash IS NOT NULL AND receipt_status IS NOT NULL)
  OR status='BLOCKED')
);
CREATE UNIQUE INDEX wallet_attempt_unique_hash ON mf_t1c.wallet_attempts(chain_id,tx_hash) WHERE tx_hash IS NOT NULL;

CREATE TABLE mf_t1c.audit_events(
 event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 intent_id uuid NOT NULL REFERENCES mf_t1c.intents(intent_id),
 event_type text NOT NULL CHECK (event_type IN (
  'INTENT_PREPARED','QUOTE_BOUND','APPROVE_RESERVED','APPROVE_HASH_BOUND',
  'APPROVE_CONFIRMED','FUND_RESERVED','FUND_HASH_BOUND','FUND_CONFIRMED',
  'TX_REVERTED','INTENT_BLOCKED'
 )),
 public_tx_hash text CHECK(public_tx_hash ~ '^0x[0-9a-f]{64}$'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION mf_t1c.enforce_immutable_intent() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF (NEW.intent_id, NEW.chain_id, NEW.escrow, NEW.payer, NEW.idempotency_key,
  NEW.quote_id, NEW.meal_id, NEW.terms_hash, NEW.version, NEW.quantity,
  NEW.unit_price, NEW.amount, NEW.quote_deadline, NEW.created_at)
  IS DISTINCT FROM
  (OLD.intent_id, OLD.chain_id, OLD.escrow, OLD.payer, OLD.idempotency_key,
   OLD.quote_id, OLD.meal_id, OLD.terms_hash, OLD.version, OLD.quantity,
   OLD.unit_price, OLD.amount, OLD.quote_deadline, OLD.created_at)
 THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='T1C_IMMUTABLE_INTENT'; END IF;
 IF NEW.revision <> OLD.revision+1 THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='T1C_REVISION_MISMATCH';
 END IF;
 IF OLD.quote_digest IS NOT NULL AND
  (NEW.quote_digest,NEW.quote_signature_hash) IS DISTINCT FROM
  (OLD.quote_digest,OLD.quote_signature_hash)
 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='T1C_QUOTE_IMMUTABLE'; END IF;
 IF NOT (
  (OLD.stage='PREPARED' AND NEW.stage='QUOTE_BOUND') OR
  (OLD.stage='QUOTE_BOUND' AND NEW.stage='APPROVE_UNKNOWN') OR
  (OLD.stage='APPROVE_UNKNOWN' AND NEW.stage IN ('APPROVED','FAILED')) OR
  (OLD.stage='APPROVED' AND NEW.stage='FUND_UNKNOWN') OR
  (OLD.stage='FUND_UNKNOWN' AND NEW.stage IN ('FUNDED','FAILED')) OR
  (NEW.stage='BLOCKED' AND OLD.stage NOT IN ('FUNDED','FAILED','BLOCKED'))
 ) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='T1C_ILLEGAL_INTENT_TRANSITION'; END IF;
 NEW.updated_at=clock_timestamp();
 RETURN NEW;
END $$;
CREATE TRIGGER t1c_intent_immutable BEFORE UPDATE ON mf_t1c.intents FOR EACH ROW
EXECUTE FUNCTION mf_t1c.enforce_immutable_intent();

CREATE FUNCTION mf_t1c.enforce_immutable_attempt() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF (NEW.intent_id,NEW.kind,NEW.chain_id,NEW.payer,NEW.tx_to,NEW.tx_data_hash,NEW.tx_nonce,NEW.created_at)
 IS DISTINCT FROM
 (OLD.intent_id,OLD.kind,OLD.chain_id,OLD.payer,OLD.tx_to,OLD.tx_data_hash,OLD.tx_nonce,OLD.created_at)
 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='T1C_ATTEMPT_IMMUTABLE'; END IF;
 IF OLD.tx_hash IS NOT NULL AND NEW.tx_hash IS DISTINCT FROM OLD.tx_hash
 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='T1C_ORIGINAL_TX_IMMUTABLE'; END IF;
 IF NOT (
  (OLD.status='UNKNOWN' AND NEW.status='HASH_BOUND' AND NEW.tx_hash IS NOT NULL) OR
  (OLD.status='HASH_BOUND' AND NEW.status IN ('CONFIRMED','REVERTED')) OR
  (OLD.status='CONFIRMED' AND NEW.status='CONFIRMED' AND
   (NEW.receipt_block,NEW.receipt_block_hash,NEW.receipt_status) IS NOT DISTINCT FROM
   (OLD.receipt_block,OLD.receipt_block_hash,OLD.receipt_status)) OR
  (NEW.status='BLOCKED' AND OLD.status IN ('UNKNOWN','HASH_BOUND'))
 ) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='T1C_ILLEGAL_ATTEMPT_TRANSITION'; END IF;
 NEW.updated_at=clock_timestamp();
 RETURN NEW;
END $$;
CREATE TRIGGER t1c_attempt_immutable BEFORE UPDATE ON mf_t1c.wallet_attempts FOR EACH ROW
EXECUTE FUNCTION mf_t1c.enforce_immutable_attempt();

CREATE FUNCTION mf_t1c.deny_audit_rewrite() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $audit$
BEGIN
 RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='T1C_AUDIT_APPEND_ONLY';
END $audit$;
CREATE TRIGGER t1c_append_only BEFORE UPDATE OR DELETE ON mf_t1c.audit_events
FOR EACH ROW EXECUTE FUNCTION mf_t1c.deny_audit_rewrite();
CREATE TRIGGER t1c_no_audit_truncate BEFORE TRUNCATE ON mf_t1c.audit_events
FOR EACH STATEMENT EXECUTE FUNCTION mf_t1c.deny_audit_rewrite();

REVOKE ALL ON ALL TABLES IN SCHEMA mf_t1c FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA mf_t1c FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA mf_t1c FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON SCHEMA mf_t1c IS 'MealForward private Testnet Intent, never expose via Data API; no payment enabled';
