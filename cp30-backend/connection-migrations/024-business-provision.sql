-- Internal fresh-owned provisioning only, sealed through the same runtime ledger.
-- Never direct UPDATE of counters/state or a public grant/approval setter.
SET ROLE c1_runtime_table_owner;
CREATE TABLE c1_live_private.authority_profiles(ns text,role text CHECK(role IN('quoteAuthority','issuerAuthority','operatorAuthority')),profile jsonb NOT NULL,revision bigint NOT NULL DEFAULT 1 CHECK(revision=1),PRIMARY KEY(ns,role));
RESET ROLE;
GRANT SELECT ON c1_live_private.authority_profiles TO c1_runtime_code_owner,c1_runtime_policy_owner,c1_live_code_owner,c1_runtime_controller_code_owner;
GRANT INSERT ON c1_live_private.authority_profiles TO c1_runtime_policy_owner;
ALTER FUNCTION c1_runtime_private.material(text) RENAME TO material_live;
CREATE FUNCTION c1_runtime_private.material(n text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,c1_runtime_private,c1_live_private,pg_temp AS $$
 SELECT material_live(n)||jsonb_build_object('authorityProfiles',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY role) FROM authority_profiles p WHERE ns=n),'[]')) $$;
ALTER FUNCTION c1_runtime_private.floors(text) RENAME TO floors_live;
CREATE FUNCTION c1_runtime_private.floors(n text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,c1_runtime_private,c1_live_private,pg_temp AS $$
 SELECT floors_live(n)||jsonb_build_object('runtime_attempt',(floors_live(n)->'runtime_attempt')||coalesce((SELECT jsonb_object_agg('live-authority-profile:'||role,revision) FROM authority_profiles WHERE ns=n),'{}')) $$;
ALTER FUNCTION c1_runtime_private.material(text) OWNER TO c1_runtime_code_owner;
ALTER FUNCTION c1_runtime_private.floors(text) OWNER TO c1_runtime_code_owner;
REVOKE ALL ON FUNCTION c1_runtime_private.material(text),c1_runtime_private.floors(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION c1_runtime_private.material(text),c1_runtime_private.floors(text) TO c1_runtime_controller_code_owner,c1_live_code_owner;
CREATE FUNCTION c1_runtime_internal.business_provision(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_runtime_private,c1_live_private,c1_private,pg_temp AS $$
DECLARE x jsonb;r c1_private.store_registrations;p jsonb;b jsonb;role_name text;login_name text;BEGIN
 PERFORM check_open(n,q->'ticket');PERFORM base_guard(n,true,NULL);
 IF session_user<>'c1_connection_bootstrap' OR jsonb_array_length(q->'profiles')<>3 OR EXISTS(SELECT 1 FROM authority_profiles WHERE ns=n) THEN PERFORM c1_private.fail('FRESH_PRIVATE_PROVISION_REQUIRED');END IF;
 SELECT * INTO r FROM c1_private.store_registrations WHERE ns=n AND id=q->>'registrationId' AND state='CONFIRMED';
 IF r.id IS NULL OR r.record->'verifiedEvidence' IS NULL THEN PERFORM c1_private.fail('VERIFIED_REGISTRATION_REQUIRED');END IF;
 b=(SELECT jsonb_object_agg(k,CASE WHEN k='chainId' THEN to_jsonb((r.record->'verifiedEvidence'->>k)::bigint) ELSE r.record->'verifiedEvidence'->k END) FROM unnest(ARRAY['chainId','escrow','asset','storeId','owner','receiver','quoteAuthority','catalogAuthority','issuerAuthority','operatorAuthority']) x(k));
 FOR x IN SELECT value FROM jsonb_array_elements(q->'profiles') LOOP
  p=x->'profile';role_name=x->>'role';login_name=CASE role_name WHEN 'quoteAuthority' THEN 'c1_business_quote_login' WHEN 'issuerAuthority' THEN 'c1_business_issuer_login' WHEN 'operatorAuthority' THEN 'c1_business_operator_login' ELSE NULL END;
  IF (x->'grant'->>'enabled')::boolean IS DISTINCT FROM true OR login_name IS NULL OR p->>'namespace' IS DISTINCT FROM n OR p->'binding' IS DISTINCT FROM b OR NOT (x->'grant'->>'expiresAt')::bigint>(SELECT now FROM c1_private.deployment WHERE ns=n) THEN PERFORM c1_private.fail('FIXED_AUTHORITY_PROVISION_REQUIRED');END IF;
  INSERT INTO authority_profiles VALUES(n,role_name,p,1);
  INSERT INTO principals VALUES(n,login_name,role_name,b->>'chainId',b->>role_name);
  INSERT INTO grants(id,ns,revision,chain_id,system_account,role,enabled,expires_at,signature_cap,gas_cap) VALUES(x->'grant'->>'id',n,1,b->>'chainId',b->>role_name,role_name,true,(x->'grant'->>'expiresAt')::bigint,(x->'grant'->>'signatureUnits')::numeric,(x->'grant'->>'gasUnits')::numeric);
 END LOOP;
 INSERT INTO principals VALUES(n,'c1_live_gateway_login','quoteAuthority',b->>'chainId',b->>'quoteAuthority'),(n,'c1_live_observer_login','quoteAuthority',b->>'chainId',b->>'quoteAuthority');
 RETURN jsonb_build_object('provisioned',true);END $$;
ALTER FUNCTION c1_runtime_internal.business_provision(text,jsonb) OWNER TO c1_runtime_policy_owner;
REVOKE ALL ON FUNCTION c1_runtime_internal.business_provision(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION c1_runtime_internal.business_provision(text,jsonb) TO c1_connection_bootstrap;
-- Stored profiles bind exact authority originals before any reservation.
CREATE FUNCTION c1_live_private.fixed_authority_profile() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_live_private,pg_temp AS $$
DECLARE p jsonb;BEGIN IF NEW.kind NOT IN('quote','operation') THEN RETURN NEW;END IF;
 SELECT profile INTO p FROM authority_profiles WHERE ns=NEW.ns AND role=NEW.role;
 IF p IS NULL OR NEW.approval->'original'->'binding' IS DISTINCT FROM p->'binding' OR NEW.approval->'original'->>'escrowCodeHash' IS DISTINCT FROM p->>'escrowCodeHash' OR NEW.approval->'original'->>'chainProfileDigest' IS DISTINCT FROM p->>'chainProfileDigest' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='PINNED_AUTHORITY_PROFILE_REQUIRED';END IF;
 RETURN NEW;END $$;
ALTER FUNCTION c1_live_private.fixed_authority_profile() OWNER TO c1_runtime_policy_owner;
REVOKE ALL ON FUNCTION c1_live_private.fixed_authority_profile() FROM PUBLIC;
CREATE TRIGGER fixed_authority_profile BEFORE INSERT ON c1_runtime_private.authorizations FOR EACH ROW EXECUTE FUNCTION c1_live_private.fixed_authority_profile();
