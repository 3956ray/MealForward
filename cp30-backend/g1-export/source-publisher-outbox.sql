-- CP31 G1 PUBLIC SOURCE PUBLISHER OUTBOX: TEST-ONLY CANDIDATE.
-- NOT migration 046, not a modification to original CP30 or Render Auth PG.
-- Must be provisioned in a separate, independently authorized PostgreSQL 17.
-- Stores public signed envelopes ONLY, never private source row/recipient,
-- wallet, Session, operator key, claim permit or original Journal.

CREATE ROLE mf_g1_publisher_writer NOLOGIN NOINHERIT NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE mf_g1_publisher_reader NOLOGIN NOINHERIT NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA mf_g1_publisher;
REVOKE ALL ON SCHEMA mf_g1_publisher FROM PUBLIC;

CREATE TABLE mf_g1_publisher.outbox (
 singleton smallint PRIMARY KEY CHECK (singleton=1),
 key_id text NOT NULL CHECK (length(key_id) BETWEEN 8 AND 128),
 audience text NOT NULL CHECK (audience ~ '^https://[a-z0-9-]+\.onrender\.com$'),
 last_ack_sequence numeric(78,0) NOT NULL DEFAULT 0 CHECK(last_ack_sequence>=0),
 last_ack_digest text CHECK(last_ack_digest ~ '^[0-9a-f]{64}$'),
 last_ack_source_as_of bigint,
 last_ack_at timestamptz,
 pending_sequence numeric(78,0) CHECK(pending_sequence>0),
 pending_receipt_digest text CHECK(pending_receipt_digest ~ '^[0-9a-f]{64}$'),
 pending_source_as_of bigint,
 pending_expires_at bigint,
 pending_signed_envelope jsonb CHECK (
  octet_length(pending_signed_envelope::text)<=48000
 ),
 pending_created_at timestamptz,
 CHECK (
  (last_ack_sequence=0 AND last_ack_digest IS NULL AND
   last_ack_source_as_of IS NULL AND last_ack_at IS NULL)
  OR
  (last_ack_sequence>0 AND last_ack_digest IS NOT NULL AND
   last_ack_source_as_of IS NOT NULL AND last_ack_at IS NOT NULL)
 ),
 CHECK (
  (pending_sequence IS NULL AND pending_receipt_digest IS NULL AND
   pending_source_as_of IS NULL AND pending_expires_at IS NULL AND
   pending_signed_envelope IS NULL AND pending_created_at IS NULL)
  OR
  (pending_sequence=last_ack_sequence+1 AND pending_receipt_digest IS NOT NULL
   AND pending_source_as_of IS NOT NULL AND pending_expires_at IS NOT NULL
   AND pending_signed_envelope IS NOT NULL AND pending_created_at IS NOT NULL)
 )
);
REVOKE ALL ON TABLE mf_g1_publisher.outbox FROM PUBLIC;

CREATE FUNCTION mf_g1_publisher.assert_append_only()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog AS $g1$
BEGIN
 IF NEW.singleton IS DISTINCT FROM OLD.singleton
    OR NEW.key_id IS DISTINCT FROM OLD.key_id
    OR NEW.audience IS DISTINCT FROM OLD.audience
 THEN RAISE EXCEPTION USING ERRCODE='P0001',
  MESSAGE='G1_PUBLISHER_TRUST_ROOT_IMMUTABLE';
 END IF;

 IF NEW.last_ack_sequence=OLD.last_ack_sequence THEN
  -- Preparing the first candidate. Never replace a persisted signed payload.
  IF NEW.last_ack_digest IS DISTINCT FROM OLD.last_ack_digest
    OR NEW.last_ack_source_as_of IS DISTINCT FROM OLD.last_ack_source_as_of
    OR NEW.last_ack_at IS DISTINCT FROM OLD.last_ack_at
  THEN RAISE EXCEPTION USING ERRCODE='P0001',
    MESSAGE='G1_PUBLISHER_ACK_IMMUTABLE';END IF;
  IF OLD.pending_sequence IS NOT NULL OR OLD.pending_signed_envelope IS NOT NULL THEN
   IF NEW.pending_sequence IS DISTINCT FROM OLD.pending_sequence
      OR NEW.pending_receipt_digest IS DISTINCT FROM OLD.pending_receipt_digest
      OR NEW.pending_source_as_of IS DISTINCT FROM OLD.pending_source_as_of
      OR NEW.pending_expires_at IS DISTINCT FROM OLD.pending_expires_at
      OR NEW.pending_signed_envelope IS DISTINCT FROM OLD.pending_signed_envelope
      OR NEW.pending_created_at IS DISTINCT FROM OLD.pending_created_at
   THEN RAISE EXCEPTION USING ERRCODE='P0001',
     MESSAGE='G1_PUBLISHER_PENDING_IMMUTABLE'; END IF;
  ELSIF NEW.pending_sequence IS NULL THEN
   RAISE EXCEPTION USING ERRCODE='P0001',
    MESSAGE='G1_PUBLISHER_NOOP_UPDATE_FORBIDDEN';
  END IF;
 ELSIF NEW.last_ack_sequence=OLD.last_ack_sequence+1 THEN
  -- Acknowledgement consumes the exact previously signed pending receipt.
  IF OLD.pending_sequence IS NULL
   OR OLD.pending_sequence IS DISTINCT FROM NEW.last_ack_sequence
   OR NEW.last_ack_digest IS DISTINCT FROM OLD.pending_receipt_digest
   OR NEW.last_ack_source_as_of IS DISTINCT FROM OLD.pending_source_as_of
   OR NEW.last_ack_at IS NULL
   OR NEW.pending_sequence IS NOT NULL
   OR NEW.pending_receipt_digest IS NOT NULL
   OR NEW.pending_source_as_of IS NOT NULL
   OR NEW.pending_expires_at IS NOT NULL
   OR NEW.pending_signed_envelope IS NOT NULL
   OR NEW.pending_created_at IS NOT NULL
  THEN RAISE EXCEPTION USING ERRCODE='P0001',
   MESSAGE='G1_PUBLISHER_ACK_MISMATCH';END IF;
 ELSE
  RAISE EXCEPTION USING ERRCODE='P0001',
   MESSAGE='G1_PUBLISHER_SEQUENCE_REWIND_OR_GAP';
 END IF;
 RETURN NEW;
END $g1$;
CREATE TRIGGER mf_g1_publisher_transition
BEFORE UPDATE ON mf_g1_publisher.outbox
FOR EACH ROW EXECUTE FUNCTION mf_g1_publisher.assert_append_only();
REVOKE ALL ON FUNCTION mf_g1_publisher.assert_append_only() FROM PUBLIC;

GRANT USAGE ON SCHEMA mf_g1_publisher
 TO mf_g1_publisher_writer,mf_g1_publisher_reader;
GRANT SELECT ON mf_g1_publisher.outbox
 TO mf_g1_publisher_writer,mf_g1_publisher_reader;
GRANT UPDATE(last_ack_sequence,last_ack_digest,last_ack_source_as_of,
 last_ack_at,pending_sequence,pending_receipt_digest,
 pending_source_as_of,pending_expires_at,pending_signed_envelope,
 pending_created_at)
 ON mf_g1_publisher.outbox TO mf_g1_publisher_writer;
-- Provisioner alone inserts singleton=1 with pinned key_id and audience.
-- Writer may NEVER INSERT, DELETE, ALTER, rotate key/audience or read CP30.
