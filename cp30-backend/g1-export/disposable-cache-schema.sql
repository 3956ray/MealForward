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
GRANT USAGE ON SCHEMA mf_g1_public_cache TO mf_g1_cache_app;
GRANT SELECT ON mf_g1_public_cache.snapshots TO mf_g1_cache_app;
GRANT UPDATE (sequence,envelope,digest,issued_at,expires_at,accepted_at)
 ON mf_g1_public_cache.snapshots TO mf_g1_cache_app;
-- No INSERT, DELETE, TRUNCATE, CREATE, direct original CP30 table access,
-- mixed dispatcher execution, signer, wallet, or business role membership.
