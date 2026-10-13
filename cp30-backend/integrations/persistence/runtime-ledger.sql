-- UNINSTALLED FULL REPLACEMENT for uninstalled migration 019, never co-install.
-- Main alone replaces the installation entry, provisions roles and connects controller.
-- Installing this beside private_original_ledger/private_execution_grants is forbidden.
-- No grant/binding/success setter, reset, release, dynamic SQL or public execution.
-- Prerequisite NOLOGIN owners/groups: c1_runtime_table_owner,c1_runtime_code_owner,
-- c1_runtime_policy_owner,c1_runtime_controller_code_owner,c1_runtime_executor,
-- c1_runtime_controller. Do not grant API/fixture users membership in these roles.

GRANT USAGE ON SCHEMA c1_private TO c1_runtime_table_owner;
GRANT USAGE ON DOMAIN c1_private.uint256 TO c1_runtime_table_owner;
GRANT REFERENCES ON c1_private.deployment TO c1_runtime_table_owner;
SET ROLE c1_runtime_table_owner;
CREATE SCHEMA c1_runtime_private AUTHORIZATION c1_runtime_table_owner;
REVOKE ALL ON SCHEMA c1_runtime_private FROM PUBLIC;

CREATE TABLE c1_runtime_private.state(
 ns text PRIMARY KEY REFERENCES c1_private.deployment(ns),revision bigint NOT NULL CHECK(revision>=0),
 head text NOT NULL CHECK(head~'^[0-9a-f]{64}$'),material_hash text NOT NULL CHECK(material_hash~'^[0-9a-f]{64}$'),
 source_epoch bigint NOT NULL,credential_epoch bigint NOT NULL,restore_generation bigint NOT NULL,
 journal_sequence bigint NOT NULL CHECK(journal_sequence>=1),journal_digest text NOT NULL CHECK(journal_digest~'^[0-9a-f]{64}$'),
 pending uuid,pending_xid bigint,pending_sequence bigint,pending_digest text,
 CHECK((pending IS NULL AND pending_xid IS NULL AND pending_sequence IS NULL AND pending_digest IS NULL)
    OR (pending IS NOT NULL AND pending_xid IS NOT NULL AND pending_sequence>0 AND pending_digest~'^[0-9a-f]{64}$')));
CREATE TABLE c1_runtime_private.principals(
 ns text REFERENCES c1_private.deployment(ns),login_name name,role text CHECK(role IN('quoteAuthority','issuerAuthority','operatorAuthority','registrar')),
 chain_id text CHECK(chain_id~'^[1-9][0-9]{0,77}$'),system_account text CHECK(system_account~'^0x[0-9a-f]{40}$'),
 PRIMARY KEY(ns,login_name,role,chain_id,system_account),CHECK(system_account<>'0x'||repeat('0',40)));
CREATE TABLE c1_runtime_private.grants(
 id text PRIMARY KEY,ns text NOT NULL REFERENCES c1_private.deployment(ns),revision bigint NOT NULL CHECK(revision>0),
 chain_id text NOT NULL,system_account text NOT NULL,role text NOT NULL,
 enabled boolean NOT NULL,expires_at bigint NOT NULL,signature_cap c1_private.uint256 NOT NULL,gas_cap c1_private.uint256 NOT NULL,
 signature_spent c1_private.uint256 NOT NULL DEFAULT 0,gas_spent c1_private.uint256 NOT NULL DEFAULT 0,
 budget_revision bigint NOT NULL DEFAULT 0 CHECK(budget_revision>=0),
 CHECK(signature_spent<=signature_cap AND gas_spent<=gas_cap),
 CHECK(chain_id~'^[1-9][0-9]{0,77}$' AND system_account~'^0x[0-9a-f]{40}$' AND system_account<>'0x'||repeat('0',40)),
 CHECK(role IN('quoteAuthority','issuerAuthority','operatorAuthority','registrar')));
CREATE TABLE c1_runtime_private.authorizations(
 kind text CHECK(kind IN('quote','operation','registration')),chain_id text,target text,original_id text,
 ns text NOT NULL REFERENCES c1_private.deployment(ns),revision bigint NOT NULL CHECK(revision>0),enabled boolean NOT NULL,
 role text NOT NULL,system_account text NOT NULL,nonce c1_private.uint256,
 grant_id text NOT NULL REFERENCES c1_runtime_private.grants(id),grant_revision bigint NOT NULL,
 reservation_original jsonb NOT NULL,initial_row jsonb NOT NULL,approval jsonb NOT NULL,
 PRIMARY KEY(kind,chain_id,target,original_id),
 CHECK(target~'^0x[0-9a-f]{40}$' AND original_id~'^0x[0-9a-f]{64}$' AND chain_id~'^[1-9][0-9]{0,77}$'),
 CHECK(jsonb_typeof(reservation_original)='object' AND jsonb_typeof(initial_row)='object' AND jsonb_typeof(approval)='object'),
 CHECK(approval->'original' IS NOT NULL AND approval->'original'=initial_row->'original' AND approval->'original'->>'namespace'=ns),
 CHECK((kind='quote' AND role='quoteAuthority' AND nonce IS NULL) OR
       (kind='registration' AND role='registrar' AND nonce IS NOT NULL) OR
       (kind='operation' AND role IN('issuerAuthority','operatorAuthority') AND nonce IS NOT NULL)));
CREATE TABLE c1_runtime_private.reservations(
 kind text,chain_id text,target text,original_id text,ns text NOT NULL,
 grant_id text NOT NULL REFERENCES c1_runtime_private.grants(id),grant_revision bigint NOT NULL,
 original jsonb NOT NULL,signature_units c1_private.uint256 NOT NULL CHECK(signature_units=1),gas_units c1_private.uint256 NOT NULL,
 revision bigint NOT NULL CHECK(revision=1),PRIMARY KEY(kind,chain_id,target,original_id),
 FOREIGN KEY(kind,chain_id,target,original_id) REFERENCES c1_runtime_private.authorizations(kind,chain_id,target,original_id));
CREATE TABLE c1_runtime_private.nonces(
 chain_id text,system_account text,nonce c1_private.uint256,ns text NOT NULL,
 kind text,target text,original_id text,
 PRIMARY KEY(chain_id,system_account,nonce),UNIQUE(kind,chain_id,target,original_id));
CREATE TABLE c1_runtime_private.attempts(
 kind text,chain_id text,target text,original_id text,ns text NOT NULL,
 payload jsonb NOT NULL,revision bigint NOT NULL CHECK(revision>0),
 PRIMARY KEY(kind,chain_id,target,original_id),
 FOREIGN KEY(kind,chain_id,target,original_id) REFERENCES c1_runtime_private.reservations(kind,chain_id,target,original_id));
CREATE TABLE c1_runtime_private.checkpoints(
 ns text,mutation uuid,prepared_sequence bigint NOT NULL,prepared_digest text NOT NULL,
 ticket jsonb NOT NULL,proof jsonb NOT NULL,finished boolean NOT NULL DEFAULT false,
 PRIMARY KEY(ns,mutation));
RESET ROLE;

CREATE SCHEMA c1_runtime_internal AUTHORIZATION c1_runtime_code_owner;
REVOKE ALL ON SCHEMA c1_runtime_internal FROM PUBLIC;
GRANT USAGE ON SCHEMA c1_runtime_private TO c1_runtime_code_owner,c1_runtime_controller_code_owner,c1_runtime_policy_owner;
GRANT SELECT ON ALL TABLES IN SCHEMA c1_runtime_private TO c1_runtime_code_owner,c1_runtime_controller_code_owner;
GRANT INSERT,UPDATE ON c1_runtime_private.state,c1_runtime_private.attempts,c1_runtime_private.reservations,
 c1_runtime_private.nonces,c1_runtime_private.checkpoints TO c1_runtime_code_owner;
GRANT UPDATE(signature_spent,gas_spent,budget_revision) ON c1_runtime_private.grants TO c1_runtime_code_owner;
GRANT UPDATE ON c1_runtime_private.state,c1_runtime_private.checkpoints TO c1_runtime_controller_code_owner;
-- Main's actual private approved-intent/grant code only. No function below provisions them.
GRANT SELECT,INSERT ON c1_runtime_private.principals,c1_runtime_private.grants,c1_runtime_private.authorizations TO c1_runtime_policy_owner;
GRANT UPDATE(revision,enabled,expires_at,signature_cap,gas_cap) ON c1_runtime_private.grants TO c1_runtime_policy_owner;
GRANT UPDATE(revision,enabled) ON c1_runtime_private.authorizations TO c1_runtime_policy_owner;

CREATE FUNCTION c1_runtime_private.monotone_grant() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (NEW.id,NEW.ns,NEW.chain_id,NEW.system_account,NEW.role) IS DISTINCT FROM (OLD.id,OLD.ns,OLD.chain_id,OLD.system_account,OLD.role)
 OR NEW.signature_spent<OLD.signature_spent OR NEW.gas_spent<OLD.gas_spent OR NEW.budget_revision<OLD.budget_revision
 OR (NOT OLD.enabled AND NEW.enabled) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='IMMUTABLE_GRANT_OR_BUDGET_ROLLBACK';END IF;
 IF (NEW.signature_spent,NEW.gas_spent) IS DISTINCT FROM (OLD.signature_spent,OLD.gas_spent) AND NEW.budget_revision<>OLD.budget_revision+1 THEN
 RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='BUDGET_REVISION_REQUIRED';END IF;
 IF (NEW.enabled,NEW.expires_at,NEW.signature_cap,NEW.gas_cap) IS DISTINCT FROM (OLD.enabled,OLD.expires_at,OLD.signature_cap,OLD.gas_cap)
 AND NEW.revision<=OLD.revision THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='GRANT_REVISION_REQUIRED';END IF;
 RETURN NEW;END $$;
CREATE TRIGGER runtime_grant_monotone BEFORE UPDATE ON c1_runtime_private.grants FOR EACH ROW EXECUTE FUNCTION c1_runtime_private.monotone_grant();
CREATE FUNCTION c1_runtime_private.monotone_authorization() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (to_jsonb(NEW)-'revision'-'enabled') IS DISTINCT FROM (to_jsonb(OLD)-'revision'-'enabled')
 OR NEW.revision<OLD.revision OR (NOT OLD.enabled AND NEW.enabled)
 OR (NEW.enabled IS DISTINCT FROM OLD.enabled AND NEW.revision<=OLD.revision) THEN
 RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='IMMUTABLE_ORIGINAL_AUTHORIZATION';END IF;RETURN NEW;END $$;
CREATE TRIGGER runtime_authorization_monotone BEFORE UPDATE ON c1_runtime_private.authorizations FOR EACH ROW EXECUTE FUNCTION c1_runtime_private.monotone_authorization();
ALTER FUNCTION c1_runtime_private.monotone_grant() OWNER TO c1_runtime_table_owner;
ALTER FUNCTION c1_runtime_private.monotone_authorization() OWNER TO c1_runtime_table_owner;

-- Reuse established C1 guard without granting new runtime code owner direct UPDATE on C1 tables.
CREATE FUNCTION c1_runtime_private.base_guard(n text,ro boolean,m uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,c1_private,pg_temp AS $$ DECLARE d c1_private.deployment;BEGIN
 IF ro THEN SELECT * INTO d FROM c1_private.deployment WHERE ns=n;
 IF NOT FOUND OR d.halt OR d.now<d.clock_floor OR d.now-d.heartbeat>30 OR EXISTS(SELECT 1 FROM c1_private.transaction_guard WHERE ns=n
 AND (security_pending IS NOT NULL OR execution_pending IS NOT NULL)) THEN PERFORM c1_private.fail('UNAVAILABLE');END IF;
 ELSE d=c1_private.guard(n,true,m);END IF;
 RETURN jsonb_build_object('now',d.now,'source_epoch',d.source_epoch,'credential_epoch',d.credential_epoch,'restore_generation',d.restore_generation);END $$;
ALTER FUNCTION c1_runtime_private.base_guard(text,boolean,uuid) OWNER TO c1_auth_code_owner;
GRANT EXECUTE ON FUNCTION c1_runtime_private.base_guard(text,boolean,uuid),c1_private.fail(text),c1_private.money(jsonb,boolean)
 TO c1_runtime_code_owner,c1_runtime_controller_code_owner;
GRANT USAGE ON SCHEMA c1_private TO c1_runtime_code_owner,c1_runtime_controller_code_owner;

CREATE FUNCTION c1_runtime_private.object_key(k jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$ BEGIN
 IF jsonb_typeof(k) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='INVALID_LEDGER_KEY';END IF;
 IF jsonb_array_length(k)<>4 OR k->>0 NOT IN('quote','operation','registration') OR k->>1!~'^[1-9][0-9]{0,77}$'
 OR k->>2!~'^0x[0-9a-f]{40}$' OR k->>2='0x'||repeat('0',40) OR k->>3!~'^0x[0-9a-f]{64}$' OR k->>3='0x'||repeat('0',64)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(k) e WHERE jsonb_typeof(e) IS DISTINCT FROM 'string') THEN
 RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='INVALID_LEDGER_KEY';END IF;
 RETURN encode(sha256(convert_to(k::text,'UTF8')),'hex');END $$;

CREATE FUNCTION c1_runtime_private.strict_money(x jsonb,z boolean DEFAULT false) RETURNS numeric LANGUAGE plpgsql IMMUTABLE
SET search_path=pg_catalog,c1_private,pg_temp AS $$ DECLARE v numeric;BEGIN
 IF x IS NULL OR jsonb_typeof(x) IS DISTINCT FROM 'string' THEN PERFORM c1_private.fail('INVALID_INTEGER');END IF;
 v=c1_private.money(x,z);IF v IS NULL THEN PERFORM c1_private.fail('INVALID_INTEGER');END IF;RETURN v;END $$;

CREATE FUNCTION c1_runtime_private.material(n text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,c1_runtime_private,pg_temp AS $$
 SELECT jsonb_build_object(
 'principals',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY login_name,role,chain_id,system_account) FROM principals p WHERE ns=n),'[]'),
 'grants',coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM grants g WHERE ns=n),'[]'),
 'authorizations',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY kind,chain_id,target,original_id) FROM authorizations a WHERE ns=n),'[]'),
 'reservations',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY kind,chain_id,target,original_id) FROM reservations r WHERE ns=n),'[]'),
 'attempts',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY kind,chain_id,target,original_id) FROM attempts t WHERE ns=n),'[]'),
 'nonces',coalesce((SELECT jsonb_agg(to_jsonb(z) ORDER BY chain_id,system_account,nonce) FROM nonces z WHERE ns=n),'[]'))
$$;
CREATE FUNCTION c1_runtime_private.floors(n text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,c1_runtime_private,pg_temp AS $$
 SELECT jsonb_build_object(
 'runtime_attempt',coalesce((SELECT jsonb_object_agg(object_key(jsonb_build_array(kind,chain_id,target,original_id)),revision) FROM attempts WHERE ns=n),'{}'),
 'runtime_reservation',coalesce((SELECT jsonb_object_agg(object_key(jsonb_build_array(kind,chain_id,target,original_id)),revision) FROM reservations WHERE ns=n),'{}'),
 'runtime_budget',coalesce((SELECT jsonb_object_agg(id,budget_revision) FROM grants WHERE ns=n),'{}'),
 'runtime_authorization',coalesce((SELECT jsonb_object_agg(object_key(jsonb_build_array(kind,chain_id,target,original_id)),revision) FROM authorizations WHERE ns=n),'{}'),
 'runtime_nonce',coalesce((SELECT jsonb_object_agg(encode(sha256(convert_to(jsonb_build_array(chain_id,system_account,nonce::text)::text,'UTF8')),'hex'),1) FROM nonces WHERE ns=n),'{}'))
$$;

CREATE FUNCTION c1_runtime_private.global_floors() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,c1_runtime_private,pg_temp AS $$
 SELECT jsonb_build_object('runtime_nonce',coalesce((SELECT jsonb_object_agg(
 encode(sha256(convert_to(jsonb_build_array(chain_id,system_account,nonce::text)::text,'UTF8')),'hex'),1) FROM nonces),'{}'))
$$;

CREATE FUNCTION c1_runtime_private.check_open(n text,t jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,c1_runtime_private,pg_temp AS $$ DECLARE s state;ro boolean=current_setting('transaction_read_only')='on';d jsonb;BEGIN
 IF t->>'protocol' IS DISTINCT FROM 'CP30_RUNTIME_LEDGER_CONTROLLER_V1' OR t->>'namespace' IS DISTINCT FROM n
 OR (t->>'readOnly')::boolean IS DISTINCT FROM ro THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='EXTERNAL_RESTORE_FLOOR_REQUIRED';END IF;
 SELECT * INTO s FROM state WHERE ns=n;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='LEDGER_BOOTSTRAP_REQUIRED';END IF;
 d=base_guard(n,ro,CASE WHEN ro THEN NULL ELSE (t->'mutation'->>'id')::uuid END);
 IF s.source_epoch<>(d->>'source_epoch')::bigint OR s.credential_epoch<>(d->>'credential_epoch')::bigint
 OR s.restore_generation<>(d->>'restore_generation')::bigint OR t->'checkpoint'->'epochs' IS DISTINCT FROM d-'now'
 OR (t->'checkpoint'->>'ledgerRevision')::bigint IS DISTINCT FROM s.revision OR t->'checkpoint'->>'ledgerHead' IS DISTINCT FROM s.head
 OR t->'checkpoint'->>'materialHash' IS DISTINCT FROM s.material_hash
 OR (t->'checkpoint'->>'journalSequence')::bigint<s.journal_sequence
 OR ((t->'checkpoint'->>'journalSequence')::bigint=s.journal_sequence AND t->'checkpoint'->>'journalDigest'<>s.journal_digest) THEN
 RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='RUNTIME_RESTORE_FLOOR_MISMATCH';END IF;
 IF ro THEN IF s.pending IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='RUNTIME_ANCHOR_PENDING';END IF;
 ELSE IF current_setting('transaction_isolation')<>'serializable' OR s.pending IS DISTINCT FROM (t->'mutation'->>'id')::uuid
 OR s.pending_xid IS DISTINCT FROM txid_current() OR s.pending_sequence IS DISTINCT FROM (t->'mutation'->>'sequence')::bigint
 OR s.pending_digest IS DISTINCT FROM t->'mutation'->>'digest' THEN
 RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='SERIALIZABLE_CONTROLLER_PREPARATION_REQUIRED';END IF;END IF;
END $$;

CREATE FUNCTION c1_runtime_private.authorized(n text,k jsonb) RETURNS c1_runtime_private.authorizations LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,c1_runtime_private,pg_temp AS $$ DECLARE a authorizations;BEGIN
 PERFORM object_key(k);
 SELECT * INTO a FROM authorizations WHERE kind=k->>0 AND chain_id=k->>1 AND target=k->>2 AND original_id=k->>3;
 IF NOT FOUND OR a.ns<>n OR NOT a.enabled OR NOT EXISTS(SELECT 1 FROM principals p WHERE p.ns=n AND p.login_name=session_user
 AND p.role=a.role AND p.chain_id=a.chain_id AND p.system_account=a.system_account) THEN
 RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='PRIVATE_ORIGINAL_NOT_AUTHORIZED';END IF;RETURN a;
END $$;

CREATE FUNCTION c1_runtime_internal.ledger_open(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,c1_runtime_private,pg_temp AS $$ DECLARE s state;t jsonb=q->'ticket';ro boolean=current_setting('transaction_read_only')='on';d jsonb;mh text;BEGIN
 IF t->>'protocol' IS DISTINCT FROM 'CP30_RUNTIME_LEDGER_CONTROLLER_V1' OR t->>'namespace' IS DISTINCT FROM n
 OR (t->>'readOnly')::boolean IS DISTINCT FROM ro THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='EXTERNAL_RESTORE_FLOOR_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM principals WHERE ns=n AND login_name=session_user) THEN
 RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='PRIVATE_RUNTIME_NAMESPACE_REQUIRED';END IF;
 IF ro THEN SELECT * INTO s FROM state WHERE ns=n;ELSE
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='SERIALIZABLE_REQUIRED';END IF;
 SELECT * INTO s FROM state WHERE ns=n FOR UPDATE;END IF;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='LEDGER_BOOTSTRAP_REQUIRED';END IF;
 IF s.pending IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='RUNTIME_ANCHOR_PENDING';END IF;
 IF NOT ro AND EXISTS(SELECT 1 FROM checkpoints WHERE ns=n AND mutation=(t->'mutation'->>'id')::uuid) THEN
 RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='ORIGINAL_RUNTIME_MUTATION_ALREADY_SEALED';END IF;
 mh=encode(sha256(convert_to(material(n)::text,'UTF8')),'hex');
 IF mh IS DISTINCT FROM s.material_hash OR t->'checkpoint'->'floors' IS DISTINCT FROM floors(n)
 OR t->'checkpoint'->'globalFloors' IS DISTINCT FROM global_floors() THEN
 RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='RUNTIME_ORIGINAL_MATERIAL_OR_FLOOR_MISSING';END IF;
 IF NOT ro THEN UPDATE state SET pending=(t->'mutation'->>'id')::uuid,pending_xid=txid_current(),
 pending_sequence=(t->'mutation'->>'sequence')::bigint,pending_digest=t->'mutation'->>'digest' WHERE ns=n;END IF;
 PERFORM check_open(n,t);RETURN jsonb_build_object('opened',true);
END $$;

CREATE FUNCTION c1_runtime_internal.ledger_get(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,c1_runtime_private,pg_temp AS $$ DECLARE a authorizations;r attempts;BEGIN
 PERFORM check_open(n,q->'ticket');a=authorized(n,q->'key');
 IF current_setting('transaction_read_only')='on' THEN SELECT * INTO r FROM attempts WHERE kind=a.kind AND chain_id=a.chain_id AND target=a.target AND original_id=a.original_id;
 ELSE SELECT * INTO r FROM attempts WHERE kind=a.kind AND chain_id=a.chain_id AND target=a.target AND original_id=a.original_id FOR UPDATE;END IF;
 RETURN jsonb_build_object('row',r.payload,'revision',r.revision);END $$;

CREATE FUNCTION c1_runtime_internal.ledger_authorization(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,c1_runtime_private,pg_temp AS $$ DECLARE a authorizations;g grants;cap jsonb;BEGIN
 PERFORM check_open(n,q->'ticket');a=authorized(n,q->'key');SELECT * INTO g FROM grants WHERE id=a.grant_id;
 cap=jsonb_build_object('id',g.id,'revision',g.revision,'enabled',g.enabled,'expiresAt',g.expires_at,
 'signatureUnits',g.signature_cap::text,'gasUnits',g.gas_cap::text);
 IF g.id IS NULL OR g.ns<>n OR g.chain_id<>a.chain_id OR g.system_account<>a.system_account OR g.role<>a.role
 OR g.revision<>a.grant_revision OR a.approval->'grant' IS DISTINCT FROM cap
 OR (a.approval->>'revision')::bigint IS DISTINCT FROM a.revision THEN
 RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='APPROVED_GRANT_PROFILE_MISMATCH';END IF;
 RETURN jsonb_build_object('authorization',to_jsonb(a),'approval',a.approval);END $$;

CREATE FUNCTION c1_runtime_internal.ledger_reserve(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,c1_runtime_private,c1_private,pg_temp AS $$
DECLARE a authorizations;g grants;r reservations;z nonces;d jsonb;cap jsonb;cost numeric;BEGIN
 PERFORM check_open(n,q->'ticket');a=authorized(n,q->'key');
 IF q->'original' IS DISTINCT FROM a.reservation_original OR a.reservation_original->>'namespace' IS DISTINCT FROM n
 OR q->>'signatureUnits' IS DISTINCT FROM '1' THEN PERFORM c1_private.fail('ORIGINAL_RESERVATION_MISMATCH');END IF;
 SELECT * INTO r FROM reservations WHERE kind=a.kind AND chain_id=a.chain_id AND target=a.target AND original_id=a.original_id FOR UPDATE;
 IF FOUND THEN IF r.ns<>n OR r.original IS DISTINCT FROM q->'original' OR r.gas_units<>strict_money(q->'gasUnits',true)
 OR r.grant_id IS DISTINCT FROM q->'grant'->>'id' OR r.grant_revision IS DISTINCT FROM (q->'grant'->>'revision')::bigint THEN
 PERFORM c1_private.fail('ORIGINAL_RESERVATION_CONFLICT');END IF;RETURN jsonb_build_object('reserved',true,'replay',true);END IF;
 SELECT * INTO g FROM grants WHERE id=a.grant_id FOR UPDATE;
 IF NOT FOUND OR g.ns<>n OR g.revision<>a.grant_revision OR g.role<>a.role OR g.system_account<>a.system_account
 OR g.chain_id<>a.chain_id THEN PERFORM c1_private.fail('APPROVED_GRANT_PROFILE_MISMATCH');END IF;
 cap=jsonb_build_object('id',g.id,'revision',g.revision,'enabled',g.enabled,'expiresAt',g.expires_at,
 'signatureUnits',g.signature_cap::text,'gasUnits',g.gas_cap::text);
 d=base_guard(n,false,(q->'ticket'->'mutation'->>'id')::uuid);
 IF cap IS DISTINCT FROM q->'grant' OR NOT g.enabled OR g.expires_at<=(d->>'now')::bigint THEN PERFORM c1_private.fail('SIGNING_GRANT_REQUIRED');END IF;
 IF a.kind='quote' THEN cost=0;
 IF a.reservation_original->'binding'->>'quoteAuthority' IS DISTINCT FROM a.system_account THEN PERFORM c1_private.fail('QUOTE_AUTHORITY_MISMATCH');END IF;
 ELSE
 cost=strict_money(a.reservation_original->'transaction'->'gas')*strict_money(a.reservation_original->'transaction'->'maxFeePerGas');
 IF strict_money(a.reservation_original->'transaction'->'nonce',true)<>a.nonce
 OR a.reservation_original->'deployment'->>'from' IS DISTINCT FROM a.system_account
 OR a.reservation_original->'deployment'->>'to' IS DISTINCT FROM a.target
 OR a.reservation_original->'deployment'->>'chainId' IS DISTINCT FROM a.chain_id
 OR a.reservation_original->'deployment'->>'value' IS DISTINCT FROM '0' THEN PERFORM c1_private.fail('APPROVED_NONCE_OR_PAYLOAD_MISMATCH');END IF;
 IF a.kind='registration' THEN
 IF a.reservation_original->'original'->>'registrar' IS DISTINCT FROM a.system_account
 OR a.reservation_original->'original'->>'registrationId' IS DISTINCT FROM a.original_id
 OR strict_money(a.reservation_original->'original'->'deadline')<=(d->>'now')::numeric THEN PERFORM c1_private.fail('ORIGINAL_REGISTRATION_EXPIRED_OR_MISMATCH');END IF;
 ELSE
 IF a.reservation_original->>'opId' IS DISTINCT FROM a.original_id
 OR NOT ((a.role='issuerAuthority' AND a.reservation_original->>'operation'='issue')
 OR (a.role='operatorAuthority' AND a.reservation_original->>'operation' IN('lock','markHandover','report'))) THEN
 PERFORM c1_private.fail('PRIVATE_OPERATION_FORBIDDEN');END IF;END IF;
 SELECT * INTO z FROM nonces WHERE chain_id=a.chain_id AND system_account=a.system_account AND nonce=a.nonce FOR UPDATE;
 IF FOUND THEN PERFORM c1_private.fail('ORIGINAL_NONCE_ALREADY_RESERVED');END IF;
 INSERT INTO nonces VALUES(a.chain_id,a.system_account,a.nonce,n,a.kind,a.target,a.original_id);
 END IF;
 IF cost<>strict_money(q->'gasUnits',true) OR g.signature_spent+1>g.signature_cap OR g.gas_spent+cost>g.gas_cap THEN
 PERFORM c1_private.fail('SIGNATURE_OR_GAS_BUDGET_EXHAUSTED');END IF;
 UPDATE grants SET signature_spent=signature_spent+1,gas_spent=gas_spent+cost,budget_revision=budget_revision+1 WHERE id=g.id;
 INSERT INTO reservations VALUES(a.kind,a.chain_id,a.target,a.original_id,n,g.id,g.revision,q->'original',1,cost,1);
 RETURN jsonb_build_object('reserved',true,'replay',false);END $$;

CREATE FUNCTION c1_runtime_internal.ledger_insert(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,c1_runtime_private,c1_private,pg_temp AS $$ DECLARE a authorizations;r reservations;BEGIN
 PERFORM check_open(n,q->'ticket');a=authorized(n,q->'key');
 SELECT * INTO r FROM reservations WHERE kind=a.kind AND chain_id=a.chain_id AND target=a.target AND original_id=a.original_id FOR UPDATE;
 IF NOT FOUND OR r.ns<>n OR q->'row' IS DISTINCT FROM a.initial_row
 OR q->'row'->'original'->>'namespace' IS DISTINCT FROM n
 OR q->'row'->>'stage' IS DISTINCT FROM (CASE WHEN a.kind='quote' THEN 'QUOTE_SIGNING' ELSE 'TRANSACTION_SIGNING' END)
 OR q->'row' ?| ARRAY['raw','transactionHash','signature','success','confirmed'] THEN PERFORM c1_private.fail('IMMUTABLE_INITIAL_ROW_REQUIRED');END IF;
 IF (SELECT count(*) FROM attempts WHERE ns=n)>=200 THEN PERFORM c1_private.fail('RUNTIME_QUEUE_FULL');END IF;
 INSERT INTO attempts VALUES(a.kind,a.chain_id,a.target,a.original_id,n,q->'row',1);
 RETURN jsonb_build_object('inserted',true,'revision',1);END $$;

CREATE FUNCTION c1_runtime_internal.ledger_save(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,c1_runtime_private,c1_private,pg_temp AS $$ DECLARE a authorizations;r attempts;p jsonb=q->'row';BEGIN
 PERFORM check_open(n,q->'ticket');a=authorized(n,q->'key');
 SELECT * INTO r FROM attempts WHERE kind=a.kind AND chain_id=a.chain_id AND target=a.target AND original_id=a.original_id FOR UPDATE;
 IF NOT FOUND OR r.ns<>n OR r.revision IS DISTINCT FROM (q->>'expectedRevision')::bigint OR r.payload IS DISTINCT FROM q->'expectedRow' THEN
 PERFORM c1_private.fail('ORIGINAL_LEDGER_CAS_CONFLICT');END IF;
 IF p=r.payload THEN RETURN jsonb_build_object('saved',true,'revision',r.revision,'replay',true);END IF;
 IF (r.payload-'stage'-'signature'-'raw'-'transactionHash') IS DISTINCT FROM (p-'stage'-'signature'-'raw'-'transactionHash') THEN
 PERFORM c1_private.fail('IMMUTABLE_ORIGINAL_ROW');END IF;
 IF a.kind='quote' THEN
 IF r.payload->>'stage' IS DISTINCT FROM 'QUOTE_SIGNING' OR p->>'stage' IS DISTINCT FROM 'QUOTE_RETAINED'
 OR p->>'signature' IS NULL OR p->>'signature'!~'^0x[0-9a-fA-F]{130}$'
 OR p ?| ARRAY['raw','transactionHash'] THEN PERFORM c1_private.fail('ORIGINAL_SIGNATURE_STAGE_CONFLICT');END IF;
 ELSE
 IF r.payload->>'stage' IS DISTINCT FROM 'TRANSACTION_SIGNING' OR p->>'stage' IS DISTINCT FROM 'BROADCAST_UNKNOWN'
 OR p->>'raw' IS NULL OR p->>'raw'!~'^0x([0-9a-f]{2})+$' OR length(p->>'raw')>131072
 OR p->>'transactionHash' IS NULL OR p->>'transactionHash'!~'^0x[0-9a-f]{64}$' OR p->>'transactionHash'='0x'||repeat('0',64)
 OR p ? 'signature' THEN PERFORM c1_private.fail('ORIGINAL_RAW_OR_HASH_STAGE_CONFLICT');END IF;END IF;
 UPDATE attempts SET payload=p,revision=revision+1 WHERE kind=a.kind AND chain_id=a.chain_id AND target=a.target AND original_id=a.original_id;
 RETURN jsonb_build_object('saved',true,'revision',r.revision+1);END $$;

CREATE FUNCTION c1_runtime_internal.ledger_seal(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,c1_runtime_private,pg_temp AS $$ DECLARE s state;t jsonb=q->'ticket';mh text;nh text;f jsonb;p jsonb;BEGIN
 PERFORM check_open(n,t);SELECT * INTO s FROM state WHERE ns=n FOR UPDATE;
 IF current_setting('transaction_read_only')='on' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='READ_ONLY_LEDGER';END IF;
 mh=encode(sha256(convert_to(material(n)::text,'UTF8')),'hex');f=floors(n);
 nh=encode(sha256(convert_to(jsonb_build_object('priorHead',s.head,'revision',s.revision+1,'materialHash',mh,
 'mutation',s.pending,'epochs',t->'checkpoint'->'epochs','floors',f)::text,'UTF8')),'hex');
 p=jsonb_build_object('namespace',n,'mutation_id',s.pending,'sequence',s.pending_sequence,'digest',s.pending_digest,
 'priorRevision',s.revision,'priorHead',s.head,'ledgerRevision',s.revision+1,'ledgerHead',nh,'materialHash',mh,
 'epochs',t->'checkpoint'->'epochs','floors',f,'globalFloors',global_floors(),'committed',true);
 INSERT INTO checkpoints VALUES(n,s.pending,s.pending_sequence,s.pending_digest,t,p,false);
 UPDATE state SET revision=revision+1,head=nh,material_hash=mh WHERE ns=n;
 RETURN p;END $$;

-- Controller-only independent DB evidence and exact terminal acknowledgement.
CREATE FUNCTION c1_runtime_internal.ledger_status(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,c1_runtime_private,pg_temp AS $$ DECLARE s state;mh text;BEGIN
 SELECT * INTO s FROM state WHERE ns=n;
 mh=encode(sha256(convert_to(material(n)::text,'UTF8')),'hex');
 IF s.ns IS NULL THEN RETURN jsonb_build_object('configured',false,'reason','LEDGER_BOOTSTRAP_REQUIRED','materialHash',mh,'floors',floors(n),'globalFloors',global_floors());END IF;
 RETURN jsonb_build_object('configured',true,'ledgerRevision',s.revision,'ledgerHead',s.head,'materialHash',s.material_hash,
 'materialMatches',mh=s.material_hash,'pending',s.pending,'journalSequence',s.journal_sequence,'journalDigest',s.journal_digest,
 'epochs',jsonb_build_object('source_epoch',s.source_epoch,'credential_epoch',s.credential_epoch,'restore_generation',s.restore_generation),'floors',floors(n),'globalFloors',global_floors());END $$;

CREATE FUNCTION c1_runtime_internal.ledger_proof(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,c1_runtime_private,pg_temp AS $$ DECLARE c checkpoints;BEGIN
 SELECT * INTO c FROM checkpoints WHERE ns=n AND mutation=(q->>'mutation_id')::uuid;
 IF NOT FOUND THEN RETURN jsonb_build_object('absent',true,'mutation_id',q->>'mutation_id');END IF;
 IF c.prepared_sequence IS DISTINCT FROM (q->>'sequence')::bigint OR c.prepared_digest IS DISTINCT FROM q->>'digest' THEN
 RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='ORIGINAL_RUNTIME_PROOF_MISMATCH';END IF;
 RETURN c.proof||jsonb_build_object('finished',c.finished,'ticket',c.ticket);END $$;

CREATE FUNCTION c1_runtime_private.finish_proof(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,c1_runtime_private,pg_temp AS $$ DECLARE s state;c checkpoints;seq bigint=(q->>'journal_sequence')::bigint;dg text=q->>'journal_digest';BEGIN
 SELECT * INTO s FROM state WHERE ns=n FOR UPDATE;
 SELECT * INTO c FROM checkpoints WHERE ns=n AND mutation=(q->>'mutation_id')::uuid FOR UPDATE;
 IF s.ns IS NULL OR NOT FOUND OR c.proof IS DISTINCT FROM q->'proof' OR c.prepared_sequence IS DISTINCT FROM (q->>'sequence')::bigint
 OR c.prepared_digest IS DISTINCT FROM q->>'digest' OR seq IS NULL OR seq<=c.prepared_sequence OR dg IS NULL OR dg!~'^[0-9a-f]{64}$'
 OR s.revision IS DISTINCT FROM (c.proof->>'ledgerRevision')::bigint OR s.head IS DISTINCT FROM c.proof->>'ledgerHead'
 OR s.material_hash IS DISTINCT FROM encode(sha256(convert_to(material(n)::text,'UTF8')),'hex') THEN
 RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='EXTERNAL_RUNTIME_COMMIT_PROOF_REQUIRED';END IF;
 IF c.finished THEN
 IF s.journal_sequence<>seq OR s.journal_digest<>dg THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='RUNTIME_JOURNAL_ACK_CONFLICT';END IF;
 RETURN jsonb_build_object('finished',true,'replay',true);END IF;
 IF s.pending IS DISTINCT FROM c.mutation OR seq<s.journal_sequence THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='RUNTIME_ANCHOR_CONFLICT';END IF;
 UPDATE state SET journal_sequence=seq,journal_digest=dg,pending=NULL,pending_xid=NULL,pending_sequence=NULL,pending_digest=NULL WHERE ns=n;
 UPDATE checkpoints SET finished=true WHERE ns=n AND mutation=c.mutation;
 RETURN jsonb_build_object('finished',true);END $$;

CREATE FUNCTION c1_runtime_internal.ledger_finish(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,c1_runtime_private,pg_temp AS $$ BEGIN
 IF q->'proof'->>'committed' IS DISTINCT FROM 'true' THEN
 RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='ORIGINAL_RUNTIME_COMMIT_PROOF_REQUIRED';END IF;
 RETURN finish_proof(n,q);END $$;

-- Absence is sealed under the same state-row lock as ledger_open. A later
-- transaction cannot use this mutation id even if it starts after abort_finish.
CREATE FUNCTION c1_runtime_internal.ledger_abort(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,c1_runtime_private,pg_temp AS $$
DECLARE s state;c checkpoints;t jsonb=q->'ticket';p jsonb;mh text;nh text;d jsonb;BEGIN
 SELECT * INTO s FROM state WHERE ns=n FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='LEDGER_BOOTSTRAP_REQUIRED';END IF;
 SELECT * INTO c FROM checkpoints WHERE ns=n AND mutation=(q->>'mutation_id')::uuid;
 IF FOUND THEN
 IF c.ticket IS DISTINCT FROM t OR c.proof->>'aborted' IS DISTINCT FROM 'true' THEN
 RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='ORIGINAL_RUNTIME_ABORT_CONFLICT';END IF;
 RETURN c.proof;END IF;
 IF t->>'protocol' IS DISTINCT FROM 'CP30_RUNTIME_LEDGER_CONTROLLER_V1' OR t->>'namespace' IS DISTINCT FROM n
 OR t->>'readOnly' IS DISTINCT FROM 'false' OR t->'mutation'->>'id' IS DISTINCT FROM q->>'mutation_id'
 OR t->'mutation'->>'sequence' IS DISTINCT FROM q->>'sequence' OR t->'mutation'->>'digest' IS DISTINCT FROM q->>'digest'
 OR q->>'digest' IS NULL OR q->>'digest'!~'^[0-9a-f]{64}$' OR (q->>'sequence')::bigint IS NULL OR (q->>'sequence')::bigint<1
 OR s.pending IS NOT NULL OR (t->'checkpoint'->>'ledgerRevision')::bigint IS DISTINCT FROM s.revision
 OR t->'checkpoint'->>'ledgerHead' IS DISTINCT FROM s.head
 OR t->'checkpoint'->>'materialHash' IS DISTINCT FROM s.material_hash
 OR t->'checkpoint'->'floors' IS DISTINCT FROM floors(n) OR t->'checkpoint'->'globalFloors' IS DISTINCT FROM global_floors()
 OR (t->'checkpoint'->>'journalSequence')::bigint IS DISTINCT FROM s.journal_sequence
 OR t->'checkpoint'->>'journalDigest' IS DISTINCT FROM s.journal_digest THEN
 RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='ORIGINAL_RUNTIME_ABORT_PROOF_REQUIRED';END IF;
 d=base_guard(n,false,(q->>'mutation_id')::uuid);
 IF t->'checkpoint'->'epochs' IS DISTINCT FROM d-'now' THEN
 RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='RUNTIME_EPOCH_CHANGED';END IF;
 mh=encode(sha256(convert_to(material(n)::text,'UTF8')),'hex');
 IF mh IS DISTINCT FROM s.material_hash THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='RUNTIME_MATERIAL_CHANGED';END IF;
 nh=encode(sha256(convert_to(jsonb_build_object('priorHead',s.head,'revision',s.revision+1,
 'abortedMutation',q->>'mutation_id','materialHash',mh)::text,'UTF8')),'hex');
 p=jsonb_build_object('namespace',n,'mutation_id',q->>'mutation_id','sequence',(q->>'sequence')::bigint,'digest',q->>'digest',
 'priorRevision',s.revision,'priorHead',s.head,'ledgerRevision',s.revision+1,'ledgerHead',nh,'materialHash',mh,
 'epochs',d-'now','floors',floors(n),'globalFloors',global_floors(),'aborted',true);
 INSERT INTO checkpoints VALUES(n,(q->>'mutation_id')::uuid,(q->>'sequence')::bigint,q->>'digest',t,p,false);
 UPDATE state SET revision=revision+1,head=nh,pending=(q->>'mutation_id')::uuid,pending_xid=txid_current(),
 pending_sequence=(q->>'sequence')::bigint,pending_digest=q->>'digest' WHERE ns=n;
 RETURN p;END $$;

CREATE FUNCTION c1_runtime_internal.ledger_abort_finish(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,c1_runtime_private,pg_temp AS $$ BEGIN
 IF q->'proof'->>'aborted' IS DISTINCT FROM 'true' THEN
 RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='ORIGINAL_RUNTIME_ABORT_PROOF_REQUIRED';END IF;
 RETURN finish_proof(n,q);END $$;

-- Complete fixed-function allowlists. Runtime callers cannot finish/erase recovery fences.
ALTER FUNCTION c1_runtime_private.object_key(jsonb) OWNER TO c1_runtime_code_owner;
ALTER FUNCTION c1_runtime_private.strict_money(jsonb,boolean) OWNER TO c1_runtime_code_owner;
ALTER FUNCTION c1_runtime_private.material(text) OWNER TO c1_runtime_code_owner;
ALTER FUNCTION c1_runtime_private.floors(text) OWNER TO c1_runtime_code_owner;
ALTER FUNCTION c1_runtime_private.global_floors() OWNER TO c1_runtime_code_owner;
ALTER FUNCTION c1_runtime_private.check_open(text,jsonb) OWNER TO c1_runtime_code_owner;
ALTER FUNCTION c1_runtime_private.authorized(text,jsonb) OWNER TO c1_runtime_code_owner;
ALTER FUNCTION c1_runtime_internal.ledger_open(text,jsonb) OWNER TO c1_runtime_code_owner;
ALTER FUNCTION c1_runtime_internal.ledger_get(text,jsonb) OWNER TO c1_runtime_code_owner;
ALTER FUNCTION c1_runtime_internal.ledger_authorization(text,jsonb) OWNER TO c1_runtime_code_owner;
ALTER FUNCTION c1_runtime_internal.ledger_reserve(text,jsonb) OWNER TO c1_runtime_code_owner;
ALTER FUNCTION c1_runtime_internal.ledger_insert(text,jsonb) OWNER TO c1_runtime_code_owner;
ALTER FUNCTION c1_runtime_internal.ledger_save(text,jsonb) OWNER TO c1_runtime_code_owner;
ALTER FUNCTION c1_runtime_internal.ledger_seal(text,jsonb) OWNER TO c1_runtime_code_owner;
ALTER FUNCTION c1_runtime_internal.ledger_status(text,jsonb) OWNER TO c1_runtime_controller_code_owner;
ALTER FUNCTION c1_runtime_internal.ledger_proof(text,jsonb) OWNER TO c1_runtime_controller_code_owner;
ALTER FUNCTION c1_runtime_private.finish_proof(text,jsonb) OWNER TO c1_runtime_controller_code_owner;
ALTER FUNCTION c1_runtime_internal.ledger_finish(text,jsonb) OWNER TO c1_runtime_controller_code_owner;
ALTER FUNCTION c1_runtime_internal.ledger_abort(text,jsonb) OWNER TO c1_runtime_controller_code_owner;
ALTER FUNCTION c1_runtime_internal.ledger_abort_finish(text,jsonb) OWNER TO c1_runtime_controller_code_owner;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA c1_runtime_private FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA c1_runtime_internal FROM PUBLIC;
GRANT EXECUTE ON FUNCTION c1_runtime_private.material(text),c1_runtime_private.floors(text),c1_runtime_private.global_floors(),c1_runtime_private.object_key(jsonb)
 TO c1_runtime_controller_code_owner;
GRANT USAGE ON SCHEMA c1_runtime_internal TO c1_runtime_executor,c1_runtime_controller;
GRANT EXECUTE ON FUNCTION c1_runtime_internal.ledger_open(text,jsonb),c1_runtime_internal.ledger_get(text,jsonb),
 c1_runtime_internal.ledger_authorization(text,jsonb),c1_runtime_internal.ledger_reserve(text,jsonb),
 c1_runtime_internal.ledger_insert(text,jsonb),c1_runtime_internal.ledger_save(text,jsonb),c1_runtime_internal.ledger_seal(text,jsonb)
 TO c1_runtime_executor;
GRANT EXECUTE ON FUNCTION c1_runtime_internal.ledger_status(text,jsonb),c1_runtime_internal.ledger_proof(text,jsonb),
 c1_runtime_internal.ledger_finish(text,jsonb),c1_runtime_internal.ledger_abort(text,jsonb),
 c1_runtime_internal.ledger_abort_finish(text,jsonb) TO c1_runtime_controller;
