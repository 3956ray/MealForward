-- Isolated new MVP only. Runtime login/password provisioned separately, never here.
BEGIN;
CREATE ROLE mf_mvp_usdc_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE SCHEMA mf_mvp_usdc;
REVOKE ALL ON SCHEMA mf_mvp_usdc FROM PUBLIC;
GRANT USAGE ON SCHEMA mf_mvp_usdc TO mf_mvp_usdc_runtime;
CREATE TABLE mf_mvp_usdc.state(id integer PRIMARY KEY CHECK(id=1), revision bigint NOT NULL DEFAULT 0, data jsonb NOT NULL DEFAULT '{"phase":"TOKEN_READY","token":"0x534b2f3a21130d7a60830c2df862319e593943a3"}');
INSERT INTO mf_mvp_usdc.state(id) VALUES(1);
CREATE TABLE mf_mvp_usdc.operations(id uuid PRIMARY KEY, action text UNIQUE NOT NULL CHECK(action IN ('escrow','approve','fund','issue','redeem','settle')), wallet text NOT NULL, nonce bigint NOT NULL, immutable jsonb NOT NULL, state text NOT NULL CHECK(state IN ('PREPARED','SEND_UNKNOWN','HASH_BOUND','CONFIRMED','REVERTED')), candidate_hash text, tx_hash text UNIQUE, receipt jsonb, UNIQUE(wallet,nonce));
CREATE UNIQUE INDEX one_pending_wallet ON mf_mvp_usdc.operations(wallet) WHERE state IN ('PREPARED','SEND_UNKNOWN','HASH_BOUND');
CREATE TABLE mf_mvp_usdc.events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, kind text NOT NULL, operation_id uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE mf_mvp_usdc.credentials(kind text NOT NULL, hash text NOT NULL, data jsonb NOT NULL, PRIMARY KEY(kind,hash));
CREATE TABLE mf_mvp_usdc.rates(key text PRIMARY KEY, window_id bigint NOT NULL, count integer NOT NULL);
CREATE TABLE mf_mvp_usdc.pre_sessions(pre_hash text PRIMARY KEY, csrf_hash text NOT NULL, expires_at bigint NOT NULL, used boolean NOT NULL DEFAULT false);
CREATE TABLE mf_mvp_usdc.challenges(id uuid PRIMARY KEY, pre_hash text NOT NULL REFERENCES mf_mvp_usdc.pre_sessions, csrf_hash text NOT NULL, payload jsonb NOT NULL, expires_at bigint NOT NULL, used boolean NOT NULL DEFAULT false);
CREATE TABLE mf_mvp_usdc.sessions(token_hash text PRIMARY KEY, csrf_hash text NOT NULL, wallet text NOT NULL, expires_at bigint NOT NULL, revoked boolean NOT NULL DEFAULT false);
CREATE TABLE mf_mvp_usdc.schema_version(version integer PRIMARY KEY);
INSERT INTO mf_mvp_usdc.schema_version VALUES(1);
CREATE FUNCTION mf_mvp_usdc.guard_operation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF NEW.id<>OLD.id OR NEW.action<>OLD.action OR NEW.wallet<>OLD.wallet OR NEW.nonce<>OLD.nonce OR NEW.immutable<>OLD.immutable OR (OLD.tx_hash IS NOT NULL AND NEW.tx_hash IS DISTINCT FROM OLD.tx_hash) THEN RAISE EXCEPTION 'immutable operation'; END IF;
 IF NOT (NEW.state=OLD.state OR (OLD.state='PREPARED' AND NEW.state='SEND_UNKNOWN') OR (OLD.state='SEND_UNKNOWN' AND NEW.state='HASH_BOUND') OR (OLD.state='HASH_BOUND' AND NEW.state IN ('CONFIRMED','REVERTED'))) THEN RAISE EXCEPTION 'invalid transition'; END IF;
 IF OLD.receipt IS NOT NULL AND NEW.receipt IS DISTINCT FROM OLD.receipt THEN RAISE EXCEPTION 'immutable receipt'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER guard_operation BEFORE UPDATE ON mf_mvp_usdc.operations FOR EACH ROW EXECUTE FUNCTION mf_mvp_usdc.guard_operation();
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['state','operations','events','credentials','rates','pre_sessions','challenges','sessions','schema_version'] LOOP
 EXECUTE format('ALTER TABLE mf_mvp_usdc.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY runtime_access ON mf_mvp_usdc.%I TO mf_mvp_usdc_runtime USING (true) WITH CHECK (true)',t);
 EXECUTE format('GRANT SELECT ON mf_mvp_usdc.%I TO mf_mvp_usdc_runtime',t);
 END LOOP; END $$;
GRANT INSERT,UPDATE ON mf_mvp_usdc.state,mf_mvp_usdc.operations,mf_mvp_usdc.credentials,mf_mvp_usdc.rates,mf_mvp_usdc.pre_sessions,mf_mvp_usdc.challenges,mf_mvp_usdc.sessions TO mf_mvp_usdc_runtime;
GRANT INSERT ON mf_mvp_usdc.events TO mf_mvp_usdc_runtime;
GRANT USAGE ON SEQUENCE mf_mvp_usdc.events_id_seq TO mf_mvp_usdc_runtime;
REVOKE ALL ON FUNCTION mf_mvp_usdc.guard_operation() FROM PUBLIC;
COMMIT;
