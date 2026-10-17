-- CP31 G1 isolated public cache candidate ONLY.
-- Not migration 046; never install on original CP30 or Auth Pilot DB.
-- Designed for a separately provisioned, disposable PostgreSQL 17 database.
-- No c1_* tables, roles, wallet or private Session data may be present.

CREATE ROLE mf_g1_cache_writer NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE mf_g1_cache_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA mf_g1_public_cache;
REVOKE ALL ON SCHEMA mf_g1_public_cache FROM PUBLIC;
CREATE TABLE mf_g1_public_cache.active (
  singleton smallint PRIMARY KEY CHECK(singleton=1),
  key_id text NOT NULL CHECK(length(key_id) BETWEEN 8 AND 128),
  audience text NOT NULL CHECK(audience ~ '^https://[a-z0-9-]+\.onrender\.com$'),
  last_sequence numeric(78,0) NOT NULL DEFAULT 0 CHECK(last_sequence>=0),
  signed_issued_at bigint,
  signed_expires_at bigint,
  source_as_of bigint,
  receipt_digest text CHECK(receipt_digest ~ '^[0-9a-f]{64}$'),
  signed_envelope jsonb CHECK(octet_length(signed_envelope::text)<=65536),
  accepted_at timestamptz,
  CHECK (
    (last_sequence=0 AND signed_envelope IS NULL AND receipt_digest IS NULL
       AND signed_issued_at IS NULL AND signed_expires_at IS NULL
       AND source_as_of IS NULL AND accepted_at IS NULL)
    OR
    (last_sequence>0 AND signed_envelope IS NOT NULL AND receipt_digest IS NOT NULL
       AND signed_issued_at IS NOT NULL AND signed_expires_at IS NOT NULL
       AND source_as_of IS NOT NULL AND accepted_at IS NOT NULL)
  )
);
REVOKE ALL ON TABLE mf_g1_public_cache.active FROM PUBLIC;
GRANT USAGE ON SCHEMA mf_g1_public_cache TO mf_g1_cache_writer,mf_g1_cache_reader;
-- Writer can only publish a new signed snapshot; key ID and audience are
-- immutable after out-of-band provisioning. No DELETE/INSERT/TRUNCATE/DDL.
CREATE FUNCTION mf_g1_public_cache.reject_nonmonotone()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.key_id IS DISTINCT FROM OLD.key_id
     OR NEW.audience IS DISTINCT FROM OLD.audience THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='G1_CACHE_ROOT_IMMUTABLE';
  END IF;
  IF NEW.last_sequence<>OLD.last_sequence+1
     OR NEW.source_as_of IS NULL
     OR (OLD.source_as_of IS NOT NULL AND NEW.source_as_of<OLD.source_as_of)
     OR NEW.signed_issued_at IS NULL
     OR (OLD.signed_issued_at IS NOT NULL AND
         NEW.signed_issued_at<OLD.signed_issued_at)
     OR NEW.signed_expires_at<=NEW.signed_issued_at
     OR NEW.receipt_digest IS NULL
     OR NEW.signed_envelope IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='G1_CACHE_SEQUENCE_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER mf_g1_cache_monotone
BEFORE UPDATE ON mf_g1_public_cache.active
FOR EACH ROW EXECUTE FUNCTION mf_g1_public_cache.reject_nonmonotone();
REVOKE ALL ON FUNCTION mf_g1_public_cache.reject_nonmonotone() FROM PUBLIC;
GRANT SELECT ON mf_g1_public_cache.active TO mf_g1_cache_writer;
GRANT UPDATE (
  last_sequence,source_as_of,signed_issued_at,signed_expires_at,
  receipt_digest,signed_envelope,accepted_at
) ON mf_g1_public_cache.active TO mf_g1_cache_writer;
GRANT SELECT ON mf_g1_public_cache.active TO mf_g1_cache_reader;
-- A provisioner MUST set singleton=1, key_id and audience explicitly after
-- pinning the trusted public key out of band. No login/grant/key is created.
