-- Private test controller alone configures these fixed transactional rollback points.
SET ROLE c1_table_owner;
CREATE TABLE c1_private.failpoints(ns text REFERENCES c1_private.deployment(ns),name text,enabled boolean NOT NULL,PRIMARY KEY(ns,name));
RESET ROLE;
GRANT SELECT ON c1_private.failpoints TO c1_api_code_owner,c1_projection_code_owner;
GRANT SELECT,INSERT,UPDATE ON c1_private.failpoints TO c1_auth_code_owner;
CREATE FUNCTION c1_private.failpoint(n text,p text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM c1_private.failpoints WHERE ns=n AND name=p AND enabled) THEN
  PERFORM c1_private.fail('INJECTED_FAILURE');
 END IF;
END $$;
CREATE OR REPLACE FUNCTION c1_api.fixture_fault(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_private,pg_temp AS $$
BEGIN
 PERFORM c1_private.guard(n);
 IF q->>'kind'='missing_content' THEN
  UPDATE c1_private.terms SET available=false WHERE ns=n AND store=q->>'store' AND meal=q->>'meal' AND version=(q->>'version')::bigint;
 ELSIF q->>'kind' IN('missing_body','missing_image','corrupt_body','corrupt_image') THEN
  UPDATE c1_private.terms SET
   body=CASE WHEN q->>'kind'='missing_body' THEN ''::bytea WHEN q->>'kind'='corrupt_body' THEN set_byte(body,0,get_byte(body,0)#1) ELSE body END,
   image=CASE WHEN q->>'kind'='missing_image' THEN ''::bytea WHEN q->>'kind'='corrupt_image' THEN set_byte(image,0,get_byte(image,0)#1) ELSE image END
  WHERE ns=n AND store=q->>'store' AND meal=q->>'meal' AND version=(q->>'version')::bigint;
 ELSIF q->>'kind'='halt' THEN
  UPDATE c1_private.deployment SET halt=true,reason='TEST_QUARANTINE' WHERE ns=n;
 ELSIF q->>'kind'='sql_fail' AND q->>'point' IN('domain_before_outbox','domain_after_outbox','apply_after_ledger') THEN
  INSERT INTO c1_private.failpoints VALUES(n,q->>'point',coalesce((q->>'enabled')::boolean,false)) ON CONFLICT(ns,name) DO UPDATE SET enabled=EXCLUDED.enabled;
 ELSE PERFORM c1_private.fail('UNSUPPORTED_FAULT');END IF;
 RETURN jsonb_build_object('injected',true);
END $$;
REVOKE ALL ON FUNCTION c1_private.failpoint(text,text) FROM PUBLIC;
