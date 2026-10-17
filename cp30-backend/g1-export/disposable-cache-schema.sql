-- G1 CLOUD SNAPSHOT CACHE CI ONLY. Not an original CP30 migration.
-- Must run in a fresh disposable PostgreSQL 17, never in original Mac PG
-- or the existing Render Auth Pilot database.
DO $guard$
BEGIN
 IF current_database()<>'mf_g1_cache_ci_only'
 OR EXISTS(SELECT 1 FROM information_schema.schemata
           WHERE schema_name LIKE 'c1\_%' ESCAPE '\')
 THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='DISPOSABLE_CACHE_POSTGRES_ONLY';
 END IF;
END
$guard$;
-- The caller creates a throwaway restricted LOGIN role
-- mf_g1_cache_app with a test-only password on this disposable database.
CREATE SCHEMA mf_g1_public_cache;
REVOKE ALL ON SCHEMA mf_g1_public_cache FROM PUBLIC;
CREATE TABLE mf_g1_public_cache.snapshots(
 source_id text PRIMARY KEY CHECK(source_id='cp30-public-v1'),
 sequence numeric(78,0) NOT NULL DEFAULT 0 CHECK(sequence>=0),
 envelope jsonb,
 digest text CHECK(digest IS NULL OR digest~'^[0-9a-f]{64}$'),
 issued_at bigint,
 expires_at bigint,
 accepted_at bigint,
 CHECK (
  (sequence=0 AND envelope IS NULL AND digest IS NULL AND issued_at IS NULL
   AND expires_at IS NULL AND accepted_at IS NULL)
  OR
  (sequence>0 AND envelope IS NOT NULL AND digest IS NOT NULL
   AND issued_at IS NOT NULL AND expires_at IS NOT NULL
   AND accepted_at IS NOT NULL AND issued_at<expires_at)
 )
);
INSERT INTO mf_g1_public_cache.snapshots(source_id) VALUES ('cp30-public-v1');
-- Independently enforce append-only sequence at the PostgreSQL level.
-- The application role can UPDATE a restricted set of cache columns, but
-- cannot reset/rewrite the currently accepted sequence or expire backwards.
CREATE FUNCTION mf_g1_public_cache.enforce_sequence_monotone()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $guard$
BEGIN
 IF NEW.source_id IS DISTINCT FROM OLD.source_id
    OR NEW.sequence<=OLD.sequence
    OR NEW.envelope->>'sequence' IS DISTINCT FROM NEW.sequence::text
    OR NEW.expires_at-NEW.issued_at>120
    OR (OLD.issued_at IS NOT NULL AND NEW.issued_at<OLD.issued_at)
    OR (OLD.accepted_at IS NOT NULL AND NEW.accepted_at<OLD.accepted_at) THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='G1_SNAPSHOT_SEQUENCE_MONOTONE_REQUIRED';
 END IF;
 RETURN NEW;
END
$guard$;
REVOKE ALL ON FUNCTION mf_g1_public_cache.enforce_sequence_monotone() FROM PUBLIC;
CREATE TRIGGER g1_sequence_monotone
BEFORE UPDATE ON mf_g1_public_cache.snapshots
FOR EACH ROW EXECUTE FUNCTION mf_g1_public_cache.enforce_sequence_monotone();

GRANT USAGE ON SCHEMA mf_g1_public_cache TO mf_g1_cache_app;
GRANT SELECT ON mf_g1_public_cache.snapshots TO mf_g1_cache_app;
GRANT UPDATE (sequence,envelope,digest,issued_at,expires_at,accepted_at)
 ON mf_g1_public_cache.snapshots TO mf_g1_cache_app;
-- No INSERT, DELETE, TRUNCATE, CREATE, direct original CP30 table access,
-- mixed dispatcher execution, signer, wallet, or business role membership.
