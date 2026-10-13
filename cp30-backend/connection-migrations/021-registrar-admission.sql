-- Private registrar admission only. Companion to the single runtime ledger.
CREATE FUNCTION c1_runtime_internal.registrar_admission_material(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,c1_runtime_private,c1_private,pg_temp AS $$
DECLARE r c1_private.store_registrations;b c1_private.verified_owner_bindings;g grants;a authorizations;d jsonb;next_nonce numeric;BEGIN
 PERFORM check_open(n,q->'ticket');d=base_guard(n,true,NULL);
 SELECT * INTO r FROM c1_private.store_registrations WHERE ns=n AND id=q->>'id';
 IF NOT FOUND OR r.state NOT IN('UNKNOWN','CONFIRMED') OR NOT EXISTS(SELECT 1 FROM c1_private.registration_outbox WHERE ns=n AND id=r.id) THEN PERFORM c1_private.fail('DURABLE_ORIGINAL_REGISTRATION_REQUIRED');END IF;
 SELECT * INTO b FROM c1_private.verified_owner_bindings WHERE ns=n AND subject=r.subject;
 IF NOT coalesce((q->>'lookupOnly')::boolean,false) AND (NOT FOUND OR NOT b.enabled OR b.owner IS DISTINCT FROM r.record->>'owner' OR b.revision::text IS DISTINCT FROM r.record->>'bindingRevision'
 OR b.verified_until<=(d->>'now')::bigint) THEN PERFORM c1_private.fail('OWNER_BINDING_CHANGED');END IF;
 SELECT * INTO g FROM grants WHERE id=q->>'grantId' AND ns=n AND role='registrar' AND system_account=r.record->'original'->>'registrar' AND chain_id=r.chain_id;
 IF NOT FOUND THEN PERFORM c1_private.fail('REGISTRAR_GRANT_NOT_CONFIGURED');END IF;
 IF NOT EXISTS(SELECT 1 FROM principals WHERE ns=n AND login_name=session_user AND role='registrar' AND chain_id=r.chain_id AND system_account=g.system_account) THEN PERFORM c1_private.fail('PRIVATE_REGISTRAR_CALLER_REQUIRED');END IF;
 SELECT * INTO a FROM authorizations WHERE kind='registration' AND chain_id=r.chain_id AND target=r.factory AND original_id=r.id;
 SELECT coalesce(max(nonce)+1,0) INTO next_nonce FROM authorizations WHERE chain_id=r.chain_id AND system_account=g.system_account AND nonce IS NOT NULL;
 RETURN jsonb_build_object('record',r.record,'ownerKind',b.owner_kind,'approval',a.approval,'nextNonce',next_nonce::text,
 'grant',jsonb_build_object('id',g.id,'revision',g.revision,'enabled',g.enabled,'expiresAt',g.expires_at,'signatureUnits',g.signature_cap::text,'gasUnits',g.gas_cap::text));END $$;
CREATE FUNCTION c1_runtime_internal.registrar_admit(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,c1_runtime_private,c1_private,pg_temp AS $$
DECLARE m jsonb;approval jsonb=q->'approval';r jsonb=approval->'original';g grants;a authorizations;next_nonce numeric;plan jsonb=approval->'transaction';BEGIN
 PERFORM check_open(n,q->'ticket');m=c1_runtime_internal.registrar_admission_material(n,q||jsonb_build_object('lookupOnly',false));
 IF m->>'ownerKind' IS DISTINCT FROM q->>'ownerKind' OR approval->'grant' IS DISTINCT FROM m->'grant' OR r IS DISTINCT FROM (SELECT jsonb_object_agg(k,m->'record'->k) FROM unnest(ARRAY['namespace','subject','owner','bindingRevision','key','request','requestDigest','registrationId','storeId','original','prepared','ownerSignature','deployment']) AS keys(k))
 OR approval->>'systemRole' IS DISTINCT FROM 'registrar' OR (approval->>'revision')::bigint<>1 THEN PERFORM c1_private.fail('ORIGINAL_REGISTRAR_APPROVAL_REQUIRED');END IF;
 SELECT * INTO a FROM authorizations WHERE kind='registration' AND chain_id=r->'original'->>'chainId' AND target=r->'original'->>'factory' AND original_id=r->>'registrationId' FOR UPDATE;
 IF FOUND THEN IF a.approval IS DISTINCT FROM approval THEN PERFORM c1_private.fail('ORIGINAL_APPROVAL_CONFLICT');END IF;RETURN jsonb_build_object('admitted',true,'replay',true);END IF;
 SELECT * INTO g FROM grants WHERE id=q->>'grantId' FOR UPDATE;
 IF NOT g.enabled OR g.expires_at<=(SELECT now FROM c1_private.deployment WHERE ns=n) OR g.signature_spent>=g.signature_cap THEN PERFORM c1_private.fail('REGISTRAR_GRANT_EXPIRED');END IF;
 SELECT greatest((q->>'observedNonce')::numeric,coalesce(max(nonce)+1,0)) INTO next_nonce FROM authorizations WHERE chain_id=g.chain_id AND system_account=g.system_account AND nonce IS NOT NULL;
 IF (plan->>'nonce')::numeric<>next_nonce OR c1_private.money(plan->'gas')*c1_private.money(plan->'maxFeePerGas')>g.gas_cap-g.gas_spent OR c1_private.money(plan->'maxPriorityFeePerGas',true)>c1_private.money(plan->'maxFeePerGas') THEN PERFORM c1_private.fail('APPROVED_NONCE_OR_GAS_REQUIRED');END IF;
 IF q->'initialRow'->'original' IS DISTINCT FROM r OR q->'initialRow'->'approval' IS DISTINCT FROM approval OR q->'initialRow'->>'stage' IS DISTINCT FROM 'TRANSACTION_SIGNING' OR q->'reservationOriginal' IS DISTINCT FROM (r||jsonb_build_object('transaction',plan,'profile',approval->'profile','grant',approval->'grant')) THEN PERFORM c1_private.fail('REGISTRAR_INITIAL_ROW_REQUIRED');END IF;
 INSERT INTO authorizations VALUES('registration',g.chain_id,r->'original'->>'factory',r->>'registrationId',n,1,true,'registrar',g.system_account,next_nonce,g.id,g.revision,q->'reservationOriginal',q->'initialRow',approval);
 RETURN jsonb_build_object('admitted',true,'replay',false);END $$;
ALTER FUNCTION c1_runtime_internal.registrar_admission_material(text,jsonb) OWNER TO c1_runtime_policy_owner;
ALTER FUNCTION c1_runtime_internal.registrar_admit(text,jsonb) OWNER TO c1_runtime_policy_owner;
GRANT SELECT ON c1_private.store_registrations,c1_private.verified_owner_bindings,c1_private.registration_outbox,c1_private.deployment TO c1_runtime_policy_owner;
GRANT SELECT ON c1_runtime_private.grants,c1_runtime_private.principals,c1_runtime_private.authorizations TO c1_runtime_policy_owner;
GRANT EXECUTE ON FUNCTION c1_runtime_private.check_open(text,jsonb),c1_runtime_private.base_guard(text,boolean,uuid),c1_private.fail(text),c1_private.money(jsonb,boolean) TO c1_runtime_policy_owner;
REVOKE ALL ON FUNCTION c1_runtime_internal.registrar_admission_material(text,jsonb),c1_runtime_internal.registrar_admit(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION c1_runtime_internal.registrar_admission_material(text,jsonb),c1_runtime_internal.registrar_admit(text,jsonb) TO c1_runtime_registrar_admission;

GRANT USAGE ON SCHEMA c1_private TO c1_runtime_policy_owner;

-- Fresh signature reservation rechecks the actual owner binding in the SAME
-- ledger/budget/nonce transaction. Later lookup/retention does not re-sign.
CREATE FUNCTION c1_runtime_private.registrar_binding_at_reservation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,c1_runtime_private,c1_private,pg_temp AS $$
DECLARE b c1_private.verified_owner_bindings;r c1_private.store_registrations;d c1_private.deployment;o jsonb=NEW.original;BEGIN
 IF NEW.kind<>'registration' THEN RETURN NEW;END IF;
 SELECT * INTO d FROM c1_private.deployment WHERE ns=NEW.ns FOR UPDATE;
 SELECT * INTO b FROM c1_private.verified_owner_bindings WHERE ns=NEW.ns AND subject=o->>'subject' FOR UPDATE;
 SELECT * INTO r FROM c1_private.store_registrations WHERE ns=NEW.ns AND id=NEW.original_id FOR UPDATE;
 IF b.subject IS NULL OR r.id IS NULL OR NOT b.enabled OR b.owner IS DISTINCT FROM o->>'owner' OR b.revision::text IS DISTINCT FROM o->>'bindingRevision'
 OR b.verified_until<=d.now OR (o->'original'->>'deadline')::bigint<=d.now OR r.state NOT IN('UNKNOWN','CONFIRMED')
 OR o->'original' IS DISTINCT FROM r.record->'original' OR o->'deployment' IS DISTINCT FROM r.record->'deployment'
 OR o->>'subject' IS DISTINCT FROM r.subject OR NEW.chain_id IS DISTINCT FROM r.chain_id OR NEW.target IS DISTINCT FROM r.factory THEN
 RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='CURRENT_REGISTRAR_OWNER_BINDING_REQUIRED';END IF;
 RETURN NEW;END $$;
ALTER FUNCTION c1_runtime_private.registrar_binding_at_reservation() OWNER TO c1_auth_code_owner;
GRANT USAGE ON SCHEMA c1_runtime_private TO c1_auth_code_owner;
REVOKE ALL ON FUNCTION c1_runtime_private.registrar_binding_at_reservation() FROM PUBLIC;
CREATE TRIGGER registrar_binding_reservation BEFORE INSERT ON c1_runtime_private.reservations
 FOR EACH ROW EXECUTE FUNCTION c1_runtime_private.registrar_binding_at_reservation();

GRANT USAGE ON SCHEMA c1_runtime_internal TO c1_runtime_policy_owner;
