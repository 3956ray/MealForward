-- MealForward G1-A STRICTLY ISOLATED test-data read schema
-- Never run on the original CP30 Mac database. No original c1_* roles/objects,
-- private Journals, payments, keys, or beneficiary data may be imported.
-- This is NOT the signed CP30 public snapshot/anchor production schema.
BEGIN;
DO $gate$
DECLARE
  name text := current_database();
BEGIN
  IF name NOT IN ('mealforward_g1_read_ci_only','mealforward_cp31_test_pg') THEN
    RAISE EXCEPTION 'G1_ISOLATED_TEST_DATABASE_REQUIRED';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname LIKE 'c1\_%' ESCAPE '\') THEN
    RAISE EXCEPTION 'ORIGINAL_CP30_SCHEMA_FORBIDDEN';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='mf_g1_probe') THEN
    RAISE EXCEPTION 'G1_PROBE_MUST_START_FRESH';
  END IF;
  IF current_setting('transaction_read_only')='on' THEN
    RAISE EXCEPTION 'MIGRATION_READ_ONLY';
  END IF;
END
$gate$;
-- Role contains no LOGIN and is NOT granted to the existing auth application.
DO $role$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='mf_g1_probe_reader') THEN
    CREATE ROLE mf_g1_probe_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF EXISTS(
    SELECT 1 FROM pg_roles WHERE rolname='mf_g1_probe_reader'
    AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
  ) THEN RAISE EXCEPTION 'G1_PROBE_ROLE_NOT_RESTRICTED';
  END IF;
  IF EXISTS(
    SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member
    WHERE r.rolname='mf_g1_probe_reader'
  ) THEN RAISE EXCEPTION 'G1_PROBE_ROLE_INHERITS_OTHER_ROLES';
  END IF;
END
$role$;
CREATE SCHEMA mf_g1_probe;
REVOKE ALL ON SCHEMA mf_g1_probe FROM PUBLIC;
GRANT USAGE ON SCHEMA mf_g1_probe TO mf_g1_probe_reader;
CREATE TABLE mf_g1_probe.provenance (
 singleton smallint PRIMARY KEY CHECK(singleton=1),
 scope text NOT NULL CHECK(scope='ISOLATED_SYNTHETIC_READ_TEST'),
 actual_original_cp30_connected boolean NOT NULL DEFAULT false CHECK(NOT actual_original_cp30_connected),
 funded_or_settled_on_chain boolean NOT NULL DEFAULT false CHECK(NOT funded_or_settled_on_chain)
);
INSERT INTO mf_g1_probe.provenance(singleton,scope) VALUES (1,'ISOLATED_SYNTHETIC_READ_TEST');
CREATE TABLE mf_g1_probe.orders (
 id uuid PRIMARY KEY,
 owner_wallet text NOT NULL CHECK(owner_wallet ~ '^0x[0-9a-f]{40}$'),
 store_id text NOT NULL CHECK(store_id ~ '^[0-9a-f]{64}$'),
 meal_id text NOT NULL CHECK(meal_id ~ '^[0-9a-f]{64}$'),
 quantity integer NOT NULL CHECK(quantity > 0 AND quantity <= 10),
 amount_base_units numeric(78,0) NOT NULL CHECK(amount_base_units > 0),
 status text NOT NULL DEFAULT 'TEST_RECORD_ONLY' CHECK(status='TEST_RECORD_ONLY'),
 record_origin text NOT NULL DEFAULT 'SYNTHETIC_G1_PROBE' CHECK(record_origin='SYNTHETIC_G1_PROBE'),
 tx_hash text CHECK(tx_hash IS NULL)
);
CREATE TABLE mf_g1_probe.vouchers (
 id text PRIMARY KEY CHECK(id ~ '^0x[0-9a-f]{64}$'),
 owner_wallet text NOT NULL CHECK(owner_wallet ~ '^0x[0-9a-f]{40}$'),
 store_id text NOT NULL CHECK(store_id ~ '^[0-9a-f]{64}$'),
 meal_id text NOT NULL CHECK(meal_id ~ '^[0-9a-f]{64}$'),
 status text NOT NULL DEFAULT 'TEST_RECORD_ONLY' CHECK(status='TEST_RECORD_ONLY'),
 record_origin text NOT NULL DEFAULT 'SYNTHETIC_G1_PROBE' CHECK(record_origin='SYNTHETIC_G1_PROBE'),
 private_code text CHECK(private_code IS NULL)
);
CREATE INDEX idx_mf_g1_probe_orders_owner ON mf_g1_probe.orders(owner_wallet);
CREATE INDEX idx_mf_g1_probe_vouchers_owner ON mf_g1_probe.vouchers(owner_wallet);
REVOKE ALL ON ALL TABLES IN SCHEMA mf_g1_probe FROM PUBLIC;
GRANT SELECT ON mf_g1_probe.provenance, mf_g1_probe.orders, mf_g1_probe.vouchers TO mf_g1_probe_reader;
-- With the original Render auth role, no GRANT/ALTER on mf_cp31_auth_pilot,
-- no CREATE privilege on public, and no membership in mf_g1_probe_reader.
COMMIT;
