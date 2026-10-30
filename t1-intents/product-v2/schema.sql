-- New private product storage specification; NOT a deployed Supabase migration.
-- Apply only to a newly created disposable local test database in this phase.
CREATE SCHEMA mf_product_v2;
REVOKE ALL ON SCHEMA mf_product_v2 FROM PUBLIC;
CREATE ROLE mf_product_v2_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA mf_product_v2 TO mf_product_v2_runtime;
CREATE TABLE mf_product_v2.state (
 id integer PRIMARY KEY CHECK(id=1),
 revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object')
);
ALTER TABLE mf_product_v2.state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mf_product_v2.state FROM PUBLIC;
INSERT INTO mf_product_v2.state(id,data) VALUES(1,'{"drafts":{},"reviews":{},"intents":{},"requests":{}}');
CREATE TABLE mf_product_v2.pre_sessions(pre_hash text PRIMARY KEY,csrf_hash text NOT NULL,expires_at bigint NOT NULL,used boolean NOT NULL DEFAULT false);
CREATE TABLE mf_product_v2.challenges(id uuid PRIMARY KEY,pre_hash text NOT NULL REFERENCES mf_product_v2.pre_sessions,csrf_hash text NOT NULL,payload jsonb NOT NULL,expires_at bigint NOT NULL,used boolean NOT NULL DEFAULT false);
CREATE TABLE mf_product_v2.sessions(token_hash text PRIMARY KEY,csrf_hash text NOT NULL,wallet text NOT NULL,expires_at bigint NOT NULL,revoked boolean NOT NULL DEFAULT false);
CREATE TABLE mf_product_v2.schema_version(version integer PRIMARY KEY);
INSERT INTO mf_product_v2.schema_version VALUES(1);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['state','pre_sessions','challenges','sessions','schema_version'] LOOP
 EXECUTE format('ALTER TABLE mf_product_v2.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON mf_product_v2.%I FROM PUBLIC',t);
 EXECUTE format('CREATE POLICY runtime_access ON mf_product_v2.%I TO mf_product_v2_runtime USING (true) WITH CHECK (true)',t);
 EXECUTE format('GRANT SELECT ON mf_product_v2.%I TO mf_product_v2_runtime',t);
 END LOOP; END $$;
GRANT INSERT,UPDATE ON mf_product_v2.state,mf_product_v2.pre_sessions,mf_product_v2.challenges,mf_product_v2.sessions TO mf_product_v2_runtime;
-- Role has no LOGIN, password, membership, DELETE, DDL or network configuration.
-- Production login provisioning and formal migration remain separate steps.
