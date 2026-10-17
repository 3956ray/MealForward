-- CP31 G1 independently durable public snapshot high-watermark.
-- SOURCE-ONLY disposable candidate. NOT a CP30 migration and NOT a Render
-- Auth Pilot migration. Deploy only to a physically/administratively separate
-- PostgreSQL 17 data store AFTER explicit security review and user approval.
--
-- A full privileged restore of the *cache* database must NOT rewind this DB.
-- Anchor and cache MUST NOT share snapshots, backups, credentials or admin.
-- This DB never stores a voucher, recipient, session, signer private key,
-- original CP30 source row, or complete public envelope.

CREATE ROLE mf_g1_anchor_writer NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE mf_g1_anchor_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA mf_g1_independent_anchor;
REVOKE ALL ON SCHEMA mf_g1_independent_anchor FROM PUBLIC;

CREATE TABLE mf_g1_independent_anchor.checkpoint (
  singleton smallint PRIMARY KEY CHECK (singleton=1),
  key_id text NOT NULL CHECK(length(key_id) BETWEEN 8 AND 128),
  audience text NOT NULL CHECK(audience ~ '^https://[a-z0-9-]+\.onrender\.com$'),
  last_sequence numeric(78,0) NOT NULL DEFAULT 0 CHECK(last_sequence>=0),
  receipt_digest text CHECK(receipt_digest ~ '^[0-9a-f]{64}$'),
  source_as_of bigint,
  signed_expires_at bigint,
  accepted_at timestamptz,
  CHECK (
    (last_sequence=0 AND receipt_digest IS NULL AND source_as_of IS NULL
     AND signed_expires_at IS NULL AND accepted_at IS NULL)
    OR
    (last_sequence>0 AND receipt_digest IS NOT NULL AND source_as_of IS NOT NULL
     AND signed_expires_at IS NOT NULL AND accepted_at IS NOT NULL)
  )
);
REVOKE ALL ON TABLE mf_g1_independent_anchor.checkpoint FROM PUBLIC;

CREATE FUNCTION mf_g1_independent_anchor.enforce_monotone()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog AS $g1$
BEGIN
 IF NEW.singleton IS DISTINCT FROM OLD.singleton
 OR NEW.key_id IS DISTINCT FROM OLD.key_id
 OR NEW.audience IS DISTINCT FROM OLD.audience
 THEN
  RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='G1_ANCHOR_TRUST_ROOT_IMMUTABLE';
 END IF;
 IF NEW.last_sequence IS DISTINCT FROM OLD.last_sequence+1
 OR NEW.receipt_digest IS NULL
 OR NEW.source_as_of IS NULL
 OR NEW.signed_expires_at IS NULL
 OR (OLD.source_as_of IS NOT NULL AND NEW.source_as_of<OLD.source_as_of)
 THEN
  RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='G1_ANCHOR_REWIND_OR_GAP';
 END IF;
 RETURN NEW;
END $g1$;
CREATE TRIGGER mf_g1_anchor_monotone
BEFORE UPDATE ON mf_g1_independent_anchor.checkpoint
FOR EACH ROW EXECUTE FUNCTION mf_g1_independent_anchor.enforce_monotone();

REVOKE ALL ON FUNCTION mf_g1_independent_anchor.enforce_monotone() FROM PUBLIC;
GRANT USAGE ON SCHEMA mf_g1_independent_anchor TO mf_g1_anchor_writer,mf_g1_anchor_reader;
GRANT SELECT ON mf_g1_independent_anchor.checkpoint TO mf_g1_anchor_writer,mf_g1_anchor_reader;
GRANT UPDATE(last_sequence,receipt_digest,source_as_of,signed_expires_at,accepted_at)
 ON mf_g1_independent_anchor.checkpoint TO mf_g1_anchor_writer;
-- The out-of-band provisioner, not the writer/reader, must initialize the
-- unique row, trusted key id and audience. NOLOGIN role credentials not issued.
