-- Security-only opaque journal checkpoint. No economic authority snapshots.
CREATE FUNCTION c1_api.identity_security_checkpoint(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_private,pg_temp AS $$
DECLARE a journal_anchors;d deployment;matched jsonb;BEGIN
 SELECT * INTO a FROM journal_anchors WHERE ns=n;SELECT * INTO d FROM deployment WHERE ns=n;
 IF a.ns IS NULL OR d.ns IS NULL OR d.halt OR a.sequence IS DISTINCT FROM (q->>'sequence')::bigint OR a.digest IS DISTINCT FROM q->>'digest' THEN RETURN jsonb_build_object('matched',false,'reason','SECURITY_ANCHOR_MISMATCH');END IF;
 IF coalesce(q->'epochs','{}'::jsonb)='{}'::jsonb AND (d.source_epoch,d.credential_epoch,d.restore_generation) IS DISTINCT FROM (1::bigint,1::bigint,1::bigint) THEN RETURN jsonb_build_object('matched',false,'reason','INITIAL_SECURITY_EPOCH_CHANGED');END IF;
 matched=c1_api.security_startup(n,q);IF matched->>'matched' IS DISTINCT FROM 'true' THEN RETURN matched;END IF;
 -- Existing security BINDINGS carry opaque control checkpoint/cursor fields;
 -- this height is explicitly a security journal cursor, never a chain block.
 RETURN jsonb_build_object('matched',true,'parent',a.digest,'height',a.sequence,'authority','IDENTITY_SECURITY_JOURNAL','source_epoch',d.source_epoch,'credential_epoch',d.credential_epoch,'restore_generation',d.restore_generation);END $$;
ALTER FUNCTION c1_api.identity_security_checkpoint(text,jsonb) OWNER TO c1_auth_code_owner;
REVOKE ALL ON FUNCTION c1_api.identity_security_checkpoint(text,jsonb) FROM PUBLIC;
GRANT USAGE ON SCHEMA c1_api TO c1_app_api,c1_identity_security;
GRANT EXECUTE ON FUNCTION c1_api.identity_security_checkpoint(text,jsonb),c1_api.security_reserve(text,jsonb),c1_api.security_prepare(text,jsonb),c1_api.security_apply(text,jsonb),c1_api.security_proof(text,jsonb),c1_api.security_finish(text,jsonb),c1_api.security_abort(text,jsonb),c1_api.security_abort_finish(text,jsonb),c1_api.security_startup(text,jsonb),c1_api.journal_anchor(text,jsonb) TO c1_identity_security;
GRANT EXECUTE ON FUNCTION c1_api.auth_pre_session(text,jsonb),c1_api.auth_touch(text,jsonb),c1_api.rate_limit(text,jsonb),c1_api.security_apply(text,jsonb),c1_api.onboarding_authorize(text,jsonb),c1_api.onboarding_get_by_key(text,jsonb),c1_api.onboarding_get_by_id(text,jsonb),c1_api.onboarding_insert(text,jsonb),c1_api.onboarding_save(text,jsonb),c1_api.onboarding_reserve_slot(text,jsonb),c1_api.onboarding_enqueue(text,jsonb),c1_api.onboarding_image_save(text,jsonb),c1_api.onboarding_image_get(text,jsonb),c1_api.onboarding_public_catalog(text,jsonb),c1_api.onboarding_public_image(text,jsonb) TO c1_app_api;
GRANT USAGE ON SCHEMA c1_onboarding_internal TO c1_identity_authority,c1_registration_worker;
GRANT EXECUTE ON FUNCTION c1_onboarding_internal.wallet_session(text,jsonb),c1_onboarding_internal.wallet_challenge_create(text,jsonb),c1_onboarding_internal.wallet_challenge_get(text,jsonb) TO c1_identity_authority;
GRANT EXECUTE ON FUNCTION c1_onboarding_internal.registration_get(text,jsonb),c1_onboarding_internal.registration_save(text,jsonb),c1_onboarding_internal.registration_publish(text,jsonb),c1_onboarding_internal.registration_authorize(text,jsonb),c1_onboarding_internal.registration_next(text,jsonb),c1_onboarding_internal.factory_capacity(text,jsonb) TO c1_registration_worker;

SET ROLE c1_runtime_table_owner;
CREATE TABLE c1_live_private.binding_templates(ns text PRIMARY KEY,template_digest text NOT NULL CHECK(template_digest~'^[0-9a-f]{64}$'),body jsonb NOT NULL);
CREATE TABLE c1_live_private.first_binding(ns text PRIMARY KEY,registration_id text NOT NULL,registration_record jsonb NOT NULL,profile_digest text NOT NULL,profiles jsonb NOT NULL,state text NOT NULL CHECK(state IN('PREPARED','BOUND')),journal_digest text,revision bigint NOT NULL CHECK(revision>0),FOREIGN KEY(ns,registration_id) REFERENCES c1_private.store_registrations(ns,id));
RESET ROLE;
GRANT SELECT ON c1_live_private.binding_templates,c1_live_private.first_binding TO c1_runtime_code_owner,c1_runtime_policy_owner,c1_live_code_owner,c1_runtime_controller_code_owner;
GRANT INSERT,UPDATE ON c1_live_private.first_binding TO c1_runtime_policy_owner;
ALTER FUNCTION c1_runtime_private.material(text) RENAME TO material_application;
CREATE FUNCTION c1_runtime_private.material(n text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,c1_live_private,c1_runtime_private,pg_temp AS $$ SELECT material_application(n)||jsonb_build_object('bindingTemplates',(SELECT to_jsonb(t) FROM binding_templates t WHERE ns=n),'firstBinding',(SELECT to_jsonb(b) FROM first_binding b WHERE ns=n)) $$;
ALTER FUNCTION c1_runtime_private.floors(text) RENAME TO floors_application;
CREATE FUNCTION c1_runtime_private.floors(n text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,c1_live_private,c1_runtime_private,pg_temp AS $$ SELECT floors_application(n)||jsonb_build_object('runtime_attempt',(floors_application(n)->'runtime_attempt')||coalesce((SELECT jsonb_build_object('first-store-binding',revision) FROM first_binding WHERE ns=n),'{}')) $$;
ALTER FUNCTION c1_runtime_private.material(text) OWNER TO c1_runtime_code_owner;ALTER FUNCTION c1_runtime_private.floors(text) OWNER TO c1_runtime_code_owner;
REVOKE ALL ON FUNCTION c1_runtime_private.material(text),c1_runtime_private.floors(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION c1_runtime_private.material(text),c1_runtime_private.floors(text) TO c1_runtime_controller_code_owner,c1_live_code_owner;
CREATE FUNCTION c1_runtime_internal.first_binding_material(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_live_private,c1_runtime_private,c1_private,pg_temp AS $$
DECLARE template binding_templates;b first_binding;r c1_private.store_registrations;count_registered bigint;BEGIN
 PERFORM check_open(n,q->'ticket');PERFORM base_guard(n,true,NULL);SELECT * INTO template FROM binding_templates WHERE ns=n;SELECT * INTO b FROM first_binding WHERE ns=n;
 IF template.ns IS NULL THEN PERFORM c1_private.fail('BINDING_TEMPLATE_REQUIRED');END IF;
 IF b.ns IS NULL THEN SELECT count(*) INTO count_registered FROM c1_private.store_registrations WHERE ns=n AND state='CONFIRMED';IF count_registered>1 THEN PERFORM c1_private.fail('FIRST_REGISTRATION_CONFLICT');END IF;SELECT * INTO r FROM c1_private.store_registrations WHERE ns=n AND state='CONFIRMED';ELSE SELECT * INTO r FROM c1_private.store_registrations WHERE ns=n AND id=b.registration_id AND state='CONFIRMED';END IF;
 IF b.ns IS NOT NULL AND r.record IS DISTINCT FROM b.registration_record THEN PERFORM c1_private.fail('ORIGINAL_BINDING_REGISTRATION_CONFLICT');END IF;
 RETURN jsonb_build_object('template',to_jsonb(template),'binding',CASE WHEN b.ns IS NULL THEN NULL ELSE to_jsonb(b) END,'registration',CASE WHEN r.id IS NULL THEN NULL ELSE to_jsonb(r) END);END $$;
CREATE FUNCTION c1_runtime_internal.first_binding_begin(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_live_private,c1_runtime_private,c1_private,pg_temp AS $$
DECLARE m jsonb;b first_binding;r jsonb;p jsonb;x jsonb;role_name text;t jsonb;binding jsonb;BEGIN
 PERFORM check_open(n,q->'ticket');m=c1_runtime_internal.first_binding_material(n,q);r=m->'registration';t=m->'template'->'body';
 IF r->>'id' IS NULL OR r->'record' IS DISTINCT FROM q->'registrationRecord' OR m->'template'->>'template_digest' IS DISTINCT FROM q->>'templateDigest' OR jsonb_array_length(q->'profiles')<>3 THEN PERFORM c1_private.fail('VERIFIED_BINDING_MATERIAL_REQUIRED');END IF;
 SELECT * INTO b FROM first_binding WHERE ns=n FOR UPDATE;
 IF FOUND THEN IF b.registration_record IS DISTINCT FROM q->'registrationRecord' OR b.profiles IS DISTINCT FROM q->'profiles' OR b.profile_digest IS DISTINCT FROM q->>'profileDigest' THEN PERFORM c1_private.fail('ORIGINAL_FIRST_BINDING_CONFLICT');END IF;RETURN jsonb_build_object('prepared',true,'replay',true);END IF;
 binding=(SELECT jsonb_object_agg(k,CASE WHEN k='chainId' THEN to_jsonb((r->'record'->'verifiedEvidence'->>k)::bigint) ELSE r->'record'->'verifiedEvidence'->k END) FROM unnest(ARRAY['chainId','escrow','asset','storeId','owner','receiver','quoteAuthority','catalogAuthority','issuerAuthority','operatorAuthority']) z(k));
 FOR x IN SELECT value FROM jsonb_array_elements(q->'profiles') LOOP p=x->'profile';role_name=x->>'role';
  IF role_name NOT IN('quoteAuthority','issuerAuthority','operatorAuthority') OR p->'binding' IS DISTINCT FROM binding OR p->>'namespace' IS DISTINCT FROM n OR p->>'registrar' IS DISTINCT FROM r->'record'->'original'->>'registrar' OR (p-'binding'-'escrowCodeHash'-'chainProfileDigest'-'namespace') IS DISTINCT FROM (t->'roles'->role_name->'profileCaps') THEN PERFORM c1_private.fail('APPROVED_BINDING_TEMPLATE_REQUIRED');END IF;
  INSERT INTO authority_profiles VALUES(n,role_name,p,1);
 END LOOP;
 INSERT INTO first_binding VALUES(n,r->>'id',q->'registrationRecord',q->>'profileDigest',q->'profiles','PREPARED',NULL,1);
 RETURN jsonb_build_object('prepared',true);END $$;
CREATE FUNCTION c1_runtime_internal.first_binding_finish(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_live_private,c1_runtime_private,pg_temp AS $$
DECLARE b first_binding;BEGIN PERFORM check_open(n,q->'ticket');SELECT * INTO b FROM first_binding WHERE ns=n FOR UPDATE;
 IF b.ns IS NULL OR b.profile_digest IS DISTINCT FROM q->>'profileDigest' OR q->>'journalDigest'!~'^[0-9a-f]{64}$' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='RETAINED_FIRST_BINDING_REQUIRED';END IF;
 IF b.state='BOUND' THEN IF b.journal_digest IS DISTINCT FROM q->>'journalDigest' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='ORIGINAL_BINDING_JOURNAL_CONFLICT';END IF;RETURN jsonb_build_object('bound',true,'replay',true);END IF;
 UPDATE first_binding SET state='BOUND',journal_digest=q->>'journalDigest',revision=revision+1 WHERE ns=n;
 RETURN jsonb_build_object('bound',true);END $$;
ALTER FUNCTION c1_runtime_internal.first_binding_material(text,jsonb) OWNER TO c1_runtime_policy_owner;
ALTER FUNCTION c1_runtime_internal.first_binding_begin(text,jsonb) OWNER TO c1_runtime_policy_owner;
ALTER FUNCTION c1_runtime_internal.first_binding_finish(text,jsonb) OWNER TO c1_runtime_policy_owner;
REVOKE ALL ON FUNCTION c1_runtime_internal.first_binding_material(text,jsonb),c1_runtime_internal.first_binding_begin(text,jsonb),c1_runtime_internal.first_binding_finish(text,jsonb) FROM PUBLIC;
GRANT USAGE ON SCHEMA c1_runtime_internal TO c1_auto_binding;
GRANT EXECUTE ON FUNCTION c1_runtime_internal.ledger_open(text,jsonb),c1_runtime_internal.ledger_seal(text,jsonb),c1_runtime_internal.first_binding_material(text,jsonb),c1_runtime_internal.first_binding_begin(text,jsonb),c1_runtime_internal.first_binding_finish(text,jsonb) TO c1_auto_binding;
