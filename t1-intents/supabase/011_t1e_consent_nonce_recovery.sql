-- T1-E: durable, bounded, IMMUTABLE nonce history for recipient EIP-712.
-- Prevents a single expired 7-minute consent window from permanently
-- orphaning the only originally FUNDED Unit 0. Each renewal uses a NEW nonce
-- under the SAME Claim UUID, recipient, escrow and voucher: NEVER duplicates
-- a Claim, changes original 009 identity, or touches any T1-D funding row.
--
-- This adds ONLY a private child table and least-privilege Claim-role grants.
DO $safe$
BEGIN
 IF current_database()<>'postgres'
 OR current_setting('server_version_num')::int<170000
 OR to_regclass('mf_t1e.recipient_claims') IS NULL
 OR to_regclass('mf_t1e.claim_events') IS NULL
 OR to_regclass('mf_t1e_auth.sessions') IS NULL
 OR to_regclass('mf_t1e.consent_rounds') IS NOT NULL
 OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='mf_t1e_claim_runtime'
   AND NOT rolsuper AND NOT rolbypassrls)
 OR (SELECT count(*) FROM mf_t1e.recipient_claims)<>0
 OR (SELECT count(*) FROM mf_t1e.claim_events)<>0
 OR (SELECT count(*) FROM mf_t1c.intents WHERE stage='FUNDED')<>1
 OR has_schema_privilege('mf_t1d_fund_runtime','mf_t1e','USAGE')
 THEN RAISE EXCEPTION 'T1E_CONSENT_RECOVERY_EMPTY_PRIVATE_BASELINE_REQUIRED'; END IF;
END $safe$;

CREATE TABLE mf_t1e.consent_rounds(
 round_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 claim_id uuid NOT NULL REFERENCES mf_t1e.recipient_claims(claim_id) ON DELETE RESTRICT,
 seq smallint NOT NULL CHECK (seq BETWEEN 1 AND 3),
 nonce text NOT NULL UNIQUE CHECK (
  nonce ~ '^0x[0-9a-f]{64}$' AND nonce<>'0x'||repeat('0',64)
 ),
 deadline bigint NOT NULL CHECK(deadline>0),
 state text NOT NULL DEFAULT 'PENDING'
   CHECK(state IN ('PENDING','EXPIRED','VERIFIED')),
 digest text CHECK(digest ~ '^0x[0-9a-f]{64}$'),
 signature_fingerprint text CHECK(signature_fingerprint ~ '^0x[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(claim_id,seq),
 CHECK ((digest IS NULL)=(signature_fingerprint IS NULL)),
 CHECK ((state='VERIFIED')=(digest IS NOT NULL))
);
-- No two parallel requests can create or authorize different pending nonces.
CREATE UNIQUE INDEX t1e_one_pending_round_per_claim
 ON mf_t1e.consent_rounds(claim_id) WHERE state='PENDING';

CREATE FUNCTION mf_t1e.consent_round_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE previous mf_t1e.consent_rounds;
DECLARE parent mf_t1e.recipient_claims;
BEGIN
 IF TG_OP='DELETE' THEN
  RAISE EXCEPTION USING ERRCODE='P0001',
    MESSAGE='T1E_CONSENT_ROUND_DELETE_FORBIDDEN';
 END IF;
 IF TG_OP='INSERT' THEN
  SELECT * INTO parent FROM mf_t1e.recipient_claims
    WHERE claim_id=NEW.claim_id FOR SHARE;
  IF NOT FOUND OR parent.stage<>'PREPARED' OR
     parent.beneficiary_wallet<>'0x2539fefe77a5ce4d09d2225c2e8a7517b22b9135'
  THEN RAISE EXCEPTION USING ERRCODE='P0001',
     MESSAGE='T1E_ORIGINAL_CONSENT_CLAIM_REQUIRED'; END IF;
  IF NEW.state<>'PENDING' OR NEW.digest IS NOT NULL
     OR NEW.signature_fingerprint IS NOT NULL
  THEN RAISE EXCEPTION USING ERRCODE='P0001',
     MESSAGE='T1E_CONSENT_MUST_START_PENDING'; END IF;
  IF NEW.seq=1 THEN
   IF NEW.nonce<>parent.consent_nonce OR
      NEW.deadline<>parent.consent_deadline
   THEN RAISE EXCEPTION USING ERRCODE='P0001',
      MESSAGE='T1E_FIRST_NONCE_NOT_BOUND_TO_ORIGINAL'; END IF;
  ELSE
   SELECT * INTO previous FROM mf_t1e.consent_rounds
     WHERE claim_id=NEW.claim_id AND seq=NEW.seq-1;
   IF NOT FOUND OR previous.state<>'EXPIRED' OR
      NEW.nonce=previous.nonce OR
      NEW.deadline<=previous.deadline
   THEN RAISE EXCEPTION USING ERRCODE='P0001',
      MESSAGE='T1E_RECOVERY_ONLY_AFTER_PREVIOUS_EXPIRED'; END IF;
  END IF;
  RETURN NEW;
 END IF;
 IF (NEW.round_id,NEW.claim_id,NEW.seq,NEW.nonce,NEW.deadline,NEW.created_at)
  IS DISTINCT FROM
    (OLD.round_id,OLD.claim_id,OLD.seq,OLD.nonce,OLD.deadline,OLD.created_at)
 THEN RAISE EXCEPTION USING ERRCODE='P0001',
  MESSAGE='T1E_CONSENT_NONCE_IMMUTABLE'; END IF;
 IF OLD.state<>'PENDING'
 OR NOT (
   (NEW.state='EXPIRED' AND NEW.digest IS NULL
      AND NEW.signature_fingerprint IS NULL AND
      OLD.deadline<=extract(epoch from clock_timestamp())::bigint)
   OR
   (NEW.state='VERIFIED' AND NEW.digest IS NOT NULL AND
      NEW.signature_fingerprint IS NOT NULL)
 )
 THEN RAISE EXCEPTION USING ERRCODE='P0001',
   MESSAGE='T1E_CONSENT_ROUND_TRANSITION_DENIED'; END IF;
 NEW.changed_at=clock_timestamp();
 RETURN NEW;
END $fn$;

CREATE TRIGGER t1e_consent_before_insert_or_update
 BEFORE INSERT OR UPDATE OR DELETE ON mf_t1e.consent_rounds
 FOR EACH ROW EXECUTE FUNCTION mf_t1e.consent_round_guard();
CREATE TRIGGER t1e_consent_forbid_truncate
 BEFORE TRUNCATE ON mf_t1e.consent_rounds
 FOR EACH STATEMENT EXECUTE FUNCTION mf_t1e.claim_forbid_delete();
REVOKE ALL ON FUNCTION mf_t1e.consent_round_guard() FROM
 PUBLIC,anon,authenticated,service_role;

-- One narrow runtime is allowed to advance its own challenge state.
GRANT SELECT,INSERT ON mf_t1e.consent_rounds TO mf_t1e_claim_runtime;
GRANT UPDATE(state,digest,signature_fingerprint,changed_at)
 ON mf_t1e.consent_rounds TO mf_t1e_claim_runtime;
GRANT USAGE,SELECT ON SEQUENCE mf_t1e.consent_rounds_round_id_seq
 TO mf_t1e_claim_runtime;
REVOKE ALL ON TABLE mf_t1e.consent_rounds FROM
 PUBLIC,anon,authenticated,service_role,
 mf_t1d_auth_runtime,mf_t1d_fund_runtime,
 mf_t1c_auth_runtime,mf_t1c_intent_runtime,mf_t1e_auth_runtime;

COMMENT ON TABLE mf_t1e.consent_rounds IS
 'First Claim retains a single original Immutable Unit and original nonce. Bounded 3 independently signed 10-min-or-less consent windows; expired rounds preserved, NO second Claim, no onchain Issue or settlement.';
