-- Disposable ONLY G1 storage co-location feasibility probe.
-- This is NOT the source publisher's independent anchor; no original CP30.
-- Never run in existing Render PG without separate reviewed migration approval.
BEGIN;
CREATE ROLE mf_g1_probe_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE mf_g1_probe_writer NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA mf_g1_probe AUTHORIZATION CURRENT_USER;
REVOKE ALL ON SCHEMA mf_g1_probe FROM PUBLIC;
CREATE TABLE mf_g1_probe.public_projection (
 id smallint PRIMARY KEY CHECK(id=1),
 source_mode text NOT NULL CHECK(source_mode='SYNTHETIC_DISPOSABLE_CI_ONLY'),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 source_revision bigint NOT NULL CHECK(source_revision>=0)
);
REVOKE ALL ON TABLE mf_g1_probe.public_projection FROM PUBLIC;
GRANT USAGE ON SCHEMA mf_g1_probe TO mf_g1_probe_reader,mf_g1_probe_writer;
GRANT SELECT ON mf_g1_probe.public_projection TO mf_g1_probe_reader;
GRANT SELECT ON mf_g1_probe.public_projection TO mf_g1_probe_writer;
GRANT UPDATE(payload,source_revision) ON mf_g1_probe.public_projection TO mf_g1_probe_writer;
CREATE FUNCTION mf_g1_probe.enforce_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id
 OR NEW.source_mode IS DISTINCT FROM OLD.source_mode
 OR NEW.source_revision<>OLD.source_revision+1
 THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='PROBE_REVISION_REJECTED';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER probe_monotone BEFORE UPDATE ON mf_g1_probe.public_projection
FOR EACH ROW EXECUTE FUNCTION mf_g1_probe.enforce_revision();
REVOKE ALL ON FUNCTION mf_g1_probe.enforce_revision() FROM PUBLIC;
INSERT INTO mf_g1_probe.public_projection VALUES (1,'SYNTHETIC_DISPOSABLE_CI_ONLY','{"stores":[],"meals":[],"ledger":[]}',0);
COMMIT;
