-- Dedicated catalog authority extension; old grants/bindings remain unchanged.
ALTER TABLE c1_runtime_private.principals DROP CONSTRAINT principals_role_check;
ALTER TABLE c1_runtime_private.principals ADD CONSTRAINT principals_role_check CHECK(role IN('quoteAuthority','issuerAuthority','operatorAuthority','registrar','catalogAuthority'));
ALTER TABLE c1_runtime_private.grants DROP CONSTRAINT grants_role_check;
ALTER TABLE c1_runtime_private.grants ADD CONSTRAINT grants_role_check CHECK(role IN('quoteAuthority','issuerAuthority','operatorAuthority','registrar','catalogAuthority'));
ALTER TABLE c1_runtime_private.authorizations DROP CONSTRAINT authorizations_check3;
ALTER TABLE c1_runtime_private.authorizations ADD CONSTRAINT authorizations_check3 CHECK((kind='quote' AND role='quoteAuthority' AND nonce IS NULL) OR (kind='registration' AND role='registrar' AND nonce IS NOT NULL) OR (kind='operation' AND role IN('issuerAuthority','operatorAuthority','catalogAuthority') AND nonce IS NOT NULL));
ALTER TABLE c1_live_private.authority_profiles DROP CONSTRAINT authority_profiles_role_check;
ALTER TABLE c1_live_private.authority_profiles ADD CONSTRAINT authority_profiles_role_check CHECK(role IN('quoteAuthority','issuerAuthority','operatorAuthority','catalogAuthority'));
SET ROLE c1_runtime_table_owner;
CREATE TABLE c1_live_private.catalog_versions(
 ns text,store text,meal text,version text,draft_id text,draft_revision bigint,body jsonb NOT NULL,image bytea NOT NULL,image_digest text NOT NULL,
 terms jsonb NOT NULL,terms_hash text NOT NULL,needs_listing boolean NOT NULL,target_listed boolean NOT NULL,
 publish_intent uuid NOT NULL,listing_intent uuid,state text NOT NULL CHECK(state IN('PENDING','PUBLISHED','LIVE')),revision bigint NOT NULL DEFAULT 1,
 PRIMARY KEY(ns,store,meal,version),UNIQUE(ns,publish_intent),FOREIGN KEY(ns,store) REFERENCES c1_live_private.stores(ns,store),
 CHECK(octet_length(image)<=8388608 AND version~'^[1-9][0-9]*$'));
RESET ROLE;
GRANT SELECT,INSERT,UPDATE ON c1_live_private.catalog_versions TO c1_live_code_owner,c1_runtime_code_owner;
GRANT SELECT ON c1_live_private.catalog_versions TO c1_runtime_policy_owner;
ALTER FUNCTION c1_runtime_private.material(text) RENAME TO material_before_catalog_versions;
CREATE FUNCTION c1_runtime_private.material(n text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,c1_live_private,c1_runtime_private,pg_temp AS $$
 SELECT material_before_catalog_versions(n)||CASE WHEN EXISTS(SELECT 1 FROM catalog_versions WHERE ns=n) THEN jsonb_build_object('catalogVersions',
 (SELECT jsonb_agg((to_jsonb(v)-'image')||jsonb_build_object('imageSha256',encode(sha256(image),'hex')) ORDER BY store,meal,version) FROM catalog_versions v WHERE ns=n)) ELSE '{}'::jsonb END $$;
ALTER FUNCTION c1_runtime_private.floors(text) RENAME TO floors_before_catalog_versions;
CREATE FUNCTION c1_runtime_private.floors(n text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,c1_live_private,c1_runtime_private,pg_temp AS $$
 SELECT floors_before_catalog_versions(n)||jsonb_build_object('runtime_attempt',(floors_before_catalog_versions(n)->'runtime_attempt')||coalesce((SELECT jsonb_object_agg('catalog-version:'||store||':'||meal||':'||version,revision) FROM catalog_versions WHERE ns=n),'{}')) $$;
ALTER FUNCTION c1_runtime_private.material(text) OWNER TO c1_runtime_code_owner;
ALTER FUNCTION c1_runtime_private.floors(text) OWNER TO c1_runtime_code_owner;
REVOKE ALL ON FUNCTION c1_runtime_private.material(text),c1_runtime_private.floors(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION c1_runtime_private.material(text),c1_runtime_private.floors(text) TO c1_runtime_controller_code_owner,c1_live_code_owner;

ALTER FUNCTION c1_runtime_internal.business_provision(text,jsonb) RENAME TO business_provision_before_catalog;
CREATE FUNCTION c1_runtime_internal.business_provision(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_runtime_private,c1_live_private,c1_private,pg_temp AS $$
DECLARE t stores;p jsonb=q->'catalogProfile';g jsonb=q->'grant';old jsonb;until bigint;BEGIN
 IF p IS NULL THEN RETURN c1_runtime_internal.business_provision_before_catalog(n,q);END IF;
 PERFORM check_open(n,q->'ticket');PERFORM base_guard(n,true,NULL);
 IF session_user<>'c1_connection_bootstrap' OR EXISTS(SELECT 1 FROM authority_profiles WHERE ns=n AND role='catalogAuthority') THEN PERFORM c1_private.fail('FRESH_CATALOG_PROVISION_REQUIRED');END IF;
 t=c1_live_private.store(n,q->>'store',true);
 SELECT profile INTO old FROM authority_profiles WHERE ns=n AND role='issuerAuthority';
 SELECT min(expires_at) INTO until FROM grants WHERE ns=n AND role IN('issuerAuthority','operatorAuthority','quoteAuthority') AND enabled;
 IF p IS DISTINCT FROM old OR p->'binding' IS DISTINCT FROM t.profile->'binding' OR p->>'namespace' IS DISTINCT FROM n
 OR until IS NULL OR g->>'signatureUnits' IS NULL OR g->>'gasUnits' IS NULL OR g->>'expiresAt' IS NULL OR g->>'id' IS NULL OR (g->>'enabled')::boolean IS DISTINCT FROM true OR (g->>'signatureUnits')::numeric NOT BETWEEN 1 AND 6
 OR (g->>'gasUnits')::numeric NOT BETWEEN 1 AND 720000000000000000 OR (g->>'expiresAt')::bigint>until
 OR (g->>'expiresAt')::bigint<=(SELECT now FROM deployment WHERE ns=n) THEN PERFORM c1_private.fail('BOUNDED_CATALOG_PROFILE_REQUIRED');END IF;
 INSERT INTO authority_profiles VALUES(n,'catalogAuthority',p,1);
 INSERT INTO principals VALUES(n,'c1_business_catalog_login','catalogAuthority',p->'binding'->>'chainId',p->'binding'->>'catalogAuthority');
 INSERT INTO grants(id,ns,revision,chain_id,system_account,role,enabled,expires_at,signature_cap,gas_cap) VALUES(g->>'id',n,1,p->'binding'->>'chainId',p->'binding'->>'catalogAuthority','catalogAuthority',true,(g->>'expiresAt')::bigint,(g->>'signatureUnits')::numeric,(g->>'gasUnits')::numeric);
 RETURN jsonb_build_object('provisioned',true,'role','catalogAuthority');END $$;
ALTER FUNCTION c1_runtime_internal.business_provision(text,jsonb) OWNER TO c1_runtime_policy_owner;
REVOKE ALL ON FUNCTION c1_runtime_internal.business_provision(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION c1_runtime_internal.business_provision(text,jsonb) TO c1_connection_bootstrap;

CREATE FUNCTION c1_live_private.catalog_available(n text,t c1_live_private.stores) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,c1_live_private,c1_runtime_private,c1_private,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM authority_profiles p JOIN grants g ON g.ns=p.ns AND g.role=p.role WHERE p.ns=n AND p.role='catalogAuthority' AND p.profile->'binding'=t.profile->'binding' AND g.enabled AND g.system_account=t.profile->'binding'->>'catalogAuthority' AND g.expires_at>(SELECT now FROM deployment WHERE ns=n) AND g.signature_spent<g.signature_cap AND g.gas_spent<g.gas_cap) $$;
ALTER FUNCTION c1_live_private.catalog_available(text,c1_live_private.stores) OWNER TO c1_runtime_code_owner;
REVOKE ALL ON FUNCTION c1_live_private.catalog_available(text,c1_live_private.stores) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION c1_live_private.catalog_available(text,c1_live_private.stores) TO c1_live_code_owner;

ALTER FUNCTION c1_runtime_internal.live_draft(text,jsonb) RENAME TO live_draft_with_catalog_review;
CREATE FUNCTION c1_runtime_internal.live_draft(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_live_private,c1_private,pg_temp AS $$
DECLARE s sessions;t stores;d drafts;r catalog_reviews;i intents;p jsonb;now bigint;ident identities;answer jsonb;BEGIN
 IF q->>'op' NOT IN('catalog_publish','catalog_capabilities') THEN RETURN c1_runtime_internal.live_draft_with_catalog_review(n,q);END IF;
 s=c1_live_private.context(n,q,q->>'op'='catalog_publish');t=c1_live_private.store(n,q->>'store',true);PERFORM c1_live_private.owner(n,t,s);
 IF q->>'op'='catalog_capabilities' THEN RETURN jsonb_build_object('publish',c1_live_private.catalog_available(n,t));END IF;
 IF q->>'key' IS NULL OR q->>'key'!~'^[ -~]{16,128}$' THEN PERFORM fail('INVALID_REQUEST');END IF;
 SELECT * INTO i FROM intents WHERE ns=n AND subject=s.subject AND store=t.store AND action='publish' AND idem=q->>'key';
 IF FOUND THEN IF i.client->>'reviewId' IS DISTINCT FROM q->>'reviewId' OR i.client->>'draftId' IS DISTINCT FROM q->>'meal' THEN PERFORM fail('IDEMPOTENCY_CONFLICT');END IF;RETURN c1_live_private.intent_dto(i);END IF;
 IF NOT c1_live_private.catalog_available(n,t) THEN PERFORM fail('LIVE_CATALOG_EXECUTION_UNAVAILABLE');END IF;
 SELECT dep.now INTO now FROM deployment dep WHERE ns=n;
 SELECT * INTO r FROM catalog_reviews WHERE ns=n AND id=(q->>'reviewId')::uuid AND subject=s.subject FOR UPDATE;
 SELECT * INTO d FROM drafts WHERE ns=n AND store=t.store AND meal=q->>'meal';
 IF r.id IS NULL OR r.store IS DISTINCT FROM t.store OR r.draft_id IS DISTINCT FROM d.meal OR r.draft_revision IS DISTINCT FROM d.revision
 OR r.used OR r.expires<=now OR r.store_revision IS DISTINCT FROM t.revision OR r.payload->>'expectedControlRevision' IS DISTINCT FROM t.rows->'controls'->>'control_revision' THEN PERFORM fail('STALE_REVIEW');END IF;
 IF EXISTS(SELECT 1 FROM intents WHERE ns=n AND store=t.store AND action IN('publish','setListed') AND stage<>'FINAL_SUCCEEDED') THEN PERFORM fail('ORIGINAL_CATALOG_PENDING');END IF;
 IF (SELECT count(*) FROM intents WHERE ns=n AND stage NOT IN('FINAL_SUCCEEDED','FINAL_REVERT'))>=24 THEN PERFORM fail('QUEUE_FULL');END IF;
 IF (SELECT count(*) FROM (SELECT t.meal UNION SELECT meal FROM catalog_versions WHERE ns=n AND store=t.store UNION SELECT substring(r.payload->>'mealId' FROM 3)) z)>3 THEN PERFORM fail('CATALOG_MEAL_LIMIT');END IF;
 SELECT * INTO ident FROM identities WHERE ns=n AND subject=s.subject;p=r.payload;
 INSERT INTO intents(ns,id,subject,recipient_key,store,action,idem,client,parameters,session_hash,csrf_hash,identity_revision,credential_epoch,op_id,stage)
 VALUES(n,(q->>'new_id')::uuid,s.subject,ident.recipient_key,t.store,'publish',q->>'key',jsonb_build_object('reviewId',r.id,'draftId',d.meal,'mealId',p->>'mealId','version',p->>'version','needsListing',p->'needsListing','targetListed',p->'targetListed'),
 jsonb_build_object('opId',q->>'op_id','expectedControlRevision',p->>'expectedControlRevision','input',p->'input'),q->>'session_hash',q->>'csrf_hash',s.identity_revision,s.epoch,q->>'op_id','ACCEPTED') RETURNING * INTO i;
 INSERT INTO catalog_versions VALUES(n,t.store,substring(p->>'mealId' FROM 3),p->>'version',d.meal,d.revision,d.body,d.image,d.image_digest,p->'input',p->>'termsHash',(p->>'needsListing')::boolean,(p->>'targetListed')::boolean,i.id,NULL,'PENDING',1);
 UPDATE catalog_reviews SET used=true,revision=revision+1 WHERE ns=n AND id=r.id;
 RETURN c1_live_private.intent_dto(i);END $$;
ALTER FUNCTION c1_runtime_internal.live_draft(text,jsonb) OWNER TO c1_live_code_owner;
REVOKE ALL ON FUNCTION c1_runtime_internal.live_draft(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION c1_runtime_internal.live_draft(text,jsonb) TO c1_live_api;

CREATE OR REPLACE FUNCTION c1_live_private.intent_dto(i c1_live_private.intents)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('id',i.id,'intentId',i.id,'store',i.store,
   'action',CASE i.action WHEN 'markHandover' THEN 'handover' ELSE i.action END,
   'stage',i.stage,'result',i.result,'transactionHash',i.transaction_hash)
 || CASE WHEN i.action='fund' THEN jsonb_build_object(
   'mealId',i.parameters->>'mealId',
   'quantity',i.parameters->>'quantity','amount',i.parameters->>'amount',
   'quoteExpiresAt',i.parameters->>'deadline') WHEN i.action='settle' THEN jsonb_build_object('voucherId',i.parameters->>'voucherId','amount',i.parameters->>'amount','generation',i.parameters->>'generation') WHEN i.action IN('publish','setListed') THEN jsonb_build_object('draftId',i.client->>'draftId','mealId',i.client->>'mealId','version',i.client->>'version','needsListing',i.client->'needsListing','targetListed',i.client->'targetListed','parentIntentId',i.parent) ELSE '{}'::jsonb END
$$;
CREATE OR REPLACE FUNCTION c1_runtime_internal.business_admission_material(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_live_private,c1_runtime_private,c1_private,pg_temp AS $$
DECLARE i c1_live_private.intents;t c1_live_private.stores;g grants;a authorizations;role_name text;next_nonce numeric;BEGIN
 PERFORM check_open(n,q->'ticket');PERFORM base_guard(n,true,NULL);SELECT * INTO i FROM c1_live_private.intents WHERE ns=n AND id=(q->>'id')::uuid;t=c1_live_private.store(n,i.store);
 role_name=CASE i.action WHEN 'fund' THEN 'quoteAuthority' WHEN 'issue' THEN 'issuerAuthority' WHEN 'lock' THEN 'operatorAuthority' WHEN 'markHandover' THEN 'operatorAuthority' WHEN 'report' THEN 'operatorAuthority' WHEN 'publish' THEN 'catalogAuthority' WHEN 'setListed' THEN 'catalogAuthority' ELSE NULL END;
 SELECT * INTO g FROM grants WHERE ns=n AND id=q->>'grantId' AND role=role_name AND system_account=t.profile->'binding'->>role_name;
 IF g.id IS NULL OR NOT EXISTS(SELECT 1 FROM principals WHERE ns=n AND login_name=session_user AND role=role_name AND system_account=g.system_account AND chain_id=g.chain_id) THEN PERFORM c1_private.fail('PRIVATE_BUSINESS_ROLE_REQUIRED');END IF;
 SELECT * INTO a FROM authorizations WHERE kind=CASE WHEN i.action='fund' THEN 'quote' ELSE 'operation' END AND original_id=i.op_id AND ns=n;
 SELECT coalesce(max(nonce)+1,0) INTO next_nonce FROM authorizations WHERE chain_id=g.chain_id AND system_account=g.system_account;
 RETURN jsonb_build_object('intent',to_jsonb(i),'store',to_jsonb(t),'approval',a.approval,'nextNonce',next_nonce::text,'grant',jsonb_build_object('id',g.id,'revision',g.revision,'enabled',g.enabled,'expiresAt',g.expires_at,'signatureUnits',g.signature_cap::text,'gasUnits',g.gas_cap::text));END $$;
CREATE OR REPLACE FUNCTION c1_runtime_internal.live_projection(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_live_private,c1_private,pg_temp AS $$
DECLARE t stores;r c1_private.store_registrations;i intents;old receipts;v_rows jsonb=q->'rows';snap jsonb=q->'snapshot';receipt jsonb=v_rows->'receipt';v jsonb;j jsonb;b numeric;report_id uuid;failed jsonb=q->'lockRevert';current_v jsonb;current_u jsonb;cv catalog_versions;listing_id uuid;BEGIN
 PERFORM c1_runtime_private.check_open(n,q->'ticket');PERFORM c1_runtime_private.base_guard(n,true,NULL);
 SELECT * INTO t FROM stores WHERE ns=n AND store=q->>'store' FOR UPDATE;
 IF failed IS NOT NULL THEN
  SELECT * INTO i FROM intents WHERE ns=n AND id=(q->>'id')::uuid FOR UPDATE;
  SELECT * INTO old FROM receipts WHERE ns=n AND intent=i.id;
  IF old.intent IS NOT NULL THEN
   IF i.stage IS DISTINCT FROM 'FINAL_REVERT' OR old.proof IS DISTINCT FROM failed THEN PERFORM fail('ORIGINAL_RECEIPT_CONFLICT');END IF;
   RETURN jsonb_build_object('state','FINAL_REVERT','replay',true);END IF;
  t=c1_live_private.store(n,q->>'store',true);
  SELECT value INTO current_v FROM jsonb_array_elements(t.rows->'vouchers') WHERE value->>'id'=i.parameters->>'voucherId';
  current_u=c1_live_private.unit(t,i.parameters->>'voucherId');
  IF i.id IS NULL OR i.action IS DISTINCT FROM 'lock' OR i.stage IS DISTINCT FROM 'UNKNOWN'
   OR i.store IS DISTINCT FROM t.store OR i.revision IS DISTINCT FROM (q->>'intentRevision')::bigint
   OR t.revision IS DISTINCT FROM (q->>'expectedRevision')::bigint
   OR failed->>'authority' IS DISTINCT FROM 'VERIFIED_ORIGINAL_LOCK_REVERT' OR failed->>'receiptStatus' IS DISTINCT FROM '0'
   OR i.transaction_hash IS NULL OR failed->>'transactionHash' IS DISTINCT FROM i.transaction_hash
   OR i.observer_record IS NULL OR failed->'original' IS DISTINCT FROM i.observer_record
   OR (failed->>'blockHash') IS NULL OR (failed->>'blockHash') !~ '^0x[0-9a-f]{64}$'
   OR (failed->>'blockNumber') IS NULL OR (failed->>'blockNumber') !~ '^[0-9]+$'
   OR (t.snapshot->>'blockNumber')::numeric < (failed->>'blockNumber')::numeric
   OR ((t.snapshot->>'blockNumber')::numeric=(failed->>'blockNumber')::numeric AND t.snapshot->>'blockHash' IS DISTINCT FROM failed->>'blockHash')
   OR current_u->>'bucket' IS DISTINCT FROM 'R' OR current_u->>'generation' IS DISTINCT FROM i.parameters->>'generation'
   OR current_v->>'generation' IS DISTINCT FROM i.parameters->>'generation'
   OR current_v->>'lock_id' IS NOT NULL OR current_v->>'marker_id' IS NOT NULL OR current_v->>'report_id' IS NOT NULL OR current_v->>'settle_id' IS NOT NULL
   OR failed->'voucher'->>'generation' IS DISTINCT FROM i.parameters->>'generation'
   OR failed->'operation'->>'kind' IS DISTINCT FROM '0'
   OR failed->'voucher'->>'lockId' IS DISTINCT FROM ('0x'||repeat('0',64))
   OR failed->'voucher'->>'markerId' IS DISTINCT FROM ('0x'||repeat('0',64))
   OR failed->'voucher'->>'reportId' IS DISTINCT FROM ('0x'||repeat('0',64))
   OR failed->'voucher'->>'settleId' IS DISTINCT FROM ('0x'||repeat('0',64))
   THEN PERFORM fail('VERIFIED_LOCK_REVERT_REQUIRED');END IF;
  INSERT INTO receipts VALUES(n,i.id,i.transaction_hash,(failed->>'blockNumber')::numeric,failed->>'blockHash',NULL,failed,1);
  UPDATE intents SET stage='FINAL_REVERT',result=jsonb_build_object('outcome','FINAL_REVERT','reason','TRANSACTION_REVERTED','transactionHash',i.transaction_hash,'blockHash',failed->>'blockHash'),revision=revision+1 WHERE ns=n AND id=i.id;
  DELETE FROM leases WHERE ns=n AND store=i.store AND kind='lock' AND intent=i.id;
  RETURN jsonb_build_object('state','FINAL_REVERT','id',i.id);
 END IF;

 IF t.store IS NULL THEN
  SELECT * INTO r FROM c1_private.store_registrations WHERE ns=n AND id=q->>'registrationId' AND state='CONFIRMED';
  IF r.id IS NULL OR r.record IS DISTINCT FROM q->'registrationRecord' OR q->>'store' IS DISTINCT FROM substring(r.store_id FROM 3) OR q->'profile'->'registrationEvidence' IS DISTINCT FROM r.record->'verifiedEvidence'
  OR q->'profile'->'binding' IS DISTINCT FROM (SELECT jsonb_object_agg(k,CASE WHEN k='chainId' THEN to_jsonb((r.record->'verifiedEvidence'->>k)::bigint) ELSE r.record->'verifiedEvidence'->k END) FROM unnest(ARRAY['chainId','escrow','asset','storeId','owner','receiver','quoteAuthority','catalogAuthority','issuerAuthority','operatorAuthority']) AS x(k)) THEN PERFORM fail('VERIFIED_REGISTRATION_REQUIRED');END IF;
  INSERT INTO stores(ns,store,registration_id,meal,profile) VALUES(n,q->>'store',r.id,substring(r.record->'original'->'catalog'->0->'terms'->>'mealId' FROM 3),q->'profile') RETURNING * INTO t;
 ELSE
  IF t.revision IS DISTINCT FROM (q->>'expectedRevision')::bigint OR t.profile IS DISTINCT FROM q->'profile' THEN PERFORM fail('PROJECTION_CAS_CONFLICT');END IF;
 END IF;
 IF v_rows->>'schema' IS DISTINCT FROM 'CP30_CHAIN_PROJECTION_V1' OR v_rows->'snapshot'->>'blockHash' IS DISTINCT FROM snap->>'blockHash' OR v_rows->'snapshot'->>'blockNumber' IS DISTINCT FROM snap->>'blockNumber' OR snap->>'authority' IS DISTINCT FROM 'CANONICAL_FINALIZED_CHAIN_FACTS'
 OR (snap->>'chainId')::int IS DISTINCT FROM (t.profile->'binding'->>'chainId')::int OR snap->>'escrow' IS DISTINCT FROM t.profile->'binding'->>'escrow' THEN PERFORM fail('VERIFIED_PROJECTION_REQUIRED');END IF;
 b=(snap->>'blockNumber')::numeric;
 IF t.snapshot IS NOT NULL AND b=(t.snapshot->>'blockNumber')::numeric AND snap->>'blockHash' IS DISTINCT FROM t.snapshot->>'blockHash' THEN PERFORM fail('CANONICAL_WATERMARK_CONFLICT');END IF;
 IF receipt IS NOT NULL THEN
  SELECT * INTO i FROM intents WHERE ns=n AND id=(receipt->>'intentId')::uuid FOR UPDATE;
  SELECT * INTO old FROM receipts WHERE ns=n AND intent=i.id;
  IF old.intent IS NOT NULL THEN IF old.proof IS DISTINCT FROM receipt->'proof' THEN PERFORM fail('ORIGINAL_RECEIPT_CONFLICT');END IF;RETURN jsonb_build_object('replay',true);END IF;
  IF i.id IS NULL OR i.store<>t.store OR i.revision IS DISTINCT FROM (q->>'intentRevision')::bigint OR i.observer_record IS DISTINCT FROM receipt->'original' OR i.transaction_hash IS DISTINCT FROM receipt->>'transactionHash'
  OR receipt->>'functionName' IS DISTINCT FROM i.action OR receipt->>'store' IS DISTINCT FROM t.store OR receipt->'proof'->>'authority' IS DISTINCT FROM 'VERIFIED_ORIGINAL_CHAIN_OPERATION' OR receipt->'proof'->'original' IS DISTINCT FROM i.observer_record THEN PERFORM fail('ORIGINAL_RECEIPT_REQUIRED');END IF;
  IF i.action IN('fund','settle') AND NOT EXISTS(SELECT 1 FROM wallet_attempts WHERE ns=n AND intent=i.id AND kind=i.action AND hash=i.transaction_hash AND deployment=i.observer_record->'deployment') THEN PERFORM fail('ORIGINAL_WALLET_ATTEMPT_REQUIRED');END IF;
  INSERT INTO receipts VALUES(n,i.id,receipt->>'transactionHash',(receipt->>'blockNumber')::numeric,receipt->>'blockHash',(receipt->>'logIndex')::numeric,receipt->'proof',1);
  IF i.action='issue' THEN
   v=receipt->'event'->'args';
   IF v->>'unitSeq' IS DISTINCT FROM i.parameters->>'expectedUnitSeq' OR v->>'generation' IS DISTINCT FROM i.parameters->>'expectedNextGeneration' OR v->>'termsHash' IS DISTINCT FROM i.parameters->>'expectedTermsHash' THEN PERFORM fail('ORIGINAL_ISSUE_CANDIDATE_REQUIRED');END IF;
   INSERT INTO claims(ns,id,intent,store,subject,recipient_key,seq,generation) VALUES(n,v->>'voucherId',i.id,t.store,i.subject,i.recipient_key,v->>'unitSeq',v->>'generation');
  END IF;
  UPDATE intents SET stage='FINAL_SUCCEEDED',result=jsonb_build_object('result',CASE WHEN i.action='fund' THEN receipt->'event'->'args'->>'batchId' ELSE receipt->'operation'->>'result' END,'transactionHash',receipt->>'transactionHash','blockHash',receipt->>'blockHash'),revision=revision+1 WHERE ns=n AND id=i.id;
  IF i.action='publish' THEN
   SELECT * INTO cv FROM catalog_versions WHERE ns=n AND store=t.store AND publish_intent=i.id FOR UPDATE;
   IF cv.publish_intent IS NULL OR cv.state IS DISTINCT FROM 'PENDING' OR receipt->'event'->'args'->>'termsHash' IS DISTINCT FROM cv.terms_hash
    OR receipt->'event'->'args'->>'mealId' IS DISTINCT FROM '0x'||cv.meal OR receipt->'event'->'args'->>'version' IS DISTINCT FROM cv.version
    OR i.parameters->'input' IS DISTINCT FROM cv.terms THEN PERFORM fail('ORIGINAL_CATALOG_VERSION_REQUIRED');END IF;
   IF cv.needs_listing THEN
    listing_id=(q->>'listingIntentId')::uuid;
    INSERT INTO intents(ns,id,subject,recipient_key,store,action,idem,client,parameters,session_hash,csrf_hash,identity_revision,credential_epoch,op_id,stage,parent)
    VALUES(n,listing_id,i.subject,i.recipient_key,t.store,'setListed','listing:'||i.id,i.client,
     jsonb_build_object('opId',q->>'listingOpId','expectedControlRevision',receipt->'event'->'args'->>'revision','mealId','0x'||cv.meal,'value',true),
     i.session_hash,i.csrf_hash,i.identity_revision,i.credential_epoch,q->>'listingOpId','ACCEPTED',i.id);
   END IF;
   UPDATE catalog_versions SET state=CASE WHEN needs_listing THEN 'PUBLISHED' ELSE 'LIVE' END,listing_intent=listing_id,revision=revision+1 WHERE ns=n AND publish_intent=i.id;
  ELSIF i.action='setListed' THEN
   SELECT * INTO cv FROM catalog_versions WHERE ns=n AND store=t.store AND listing_intent=i.id FOR UPDATE;
   IF cv.listing_intent IS NULL OR cv.state IS DISTINCT FROM 'PUBLISHED' OR NOT cv.needs_listing OR i.parent IS DISTINCT FROM cv.publish_intent
    OR receipt->'event'->'args'->>'mealId' IS DISTINCT FROM '0x'||cv.meal OR receipt->'event'->'args'->'value' IS DISTINCT FROM 'true'::jsonb
    OR receipt->'event'->'args'->>'kind' IS DISTINCT FROM '2' THEN PERFORM fail('ORIGINAL_LISTING_REQUIRED');END IF;
   UPDATE catalog_versions SET state='LIVE',revision=revision+1 WHERE ns=n AND listing_intent=i.id;
  END IF;
  IF i.action='markHandover' THEN
   report_id=(q->>'reportIntentId')::uuid;
   INSERT INTO intents(ns,id,subject,recipient_key,store,action,idem,client,parameters,session_hash,csrf_hash,identity_revision,credential_epoch,op_id,stage,parent) VALUES(n,report_id,i.subject,i.recipient_key,t.store,'report','report:'||i.id,jsonb_build_object('parent',i.id),jsonb_build_object('opId',q->>'reportOpId','voucherId',i.parameters->>'voucherId','generation',i.parameters->>'generation','lockId',i.parameters->>'lockId','markerId',receipt->'operation'->>'result'),i.session_hash,i.csrf_hash,i.identity_revision,i.credential_epoch,q->>'reportOpId','ACCEPTED',i.id);
  END IF;
 END IF;
 -- Older original receipts are retained without rolling back newer actual facts.
 IF t.snapshot IS NULL OR b>=(t.snapshot->>'blockNumber')::numeric THEN
  IF t.snapshot IS NOT NULL AND b=(t.snapshot->>'blockNumber')::numeric THEN
   IF (t.snapshot-'operations'-'vouchers') IS DISTINCT FROM (snap-'operations'-'vouchers') OR EXISTS(SELECT 1 FROM jsonb_each(t.snapshot->'operations') z WHERE snap->'operations' ? z.key AND snap->'operations'->z.key IS DISTINCT FROM z.value) OR EXISTS(SELECT 1 FROM jsonb_each(t.snapshot->'vouchers') z WHERE snap->'vouchers' ? z.key AND snap->'vouchers'->z.key IS DISTINCT FROM z.value) THEN PERFORM fail('SAME_BLOCK_FACT_CONFLICT');END IF;
   snap=snap||jsonb_build_object('operations',(t.snapshot->'operations')||(snap->'operations'),'vouchers',(t.snapshot->'vouchers')||(snap->'vouchers'));
  END IF;
  UPDATE stores SET snapshot=snap,rows=v_rows-'receipt',revision=revision+1 WHERE ns=n AND store=t.store;
 END IF;
 UPDATE credentials cr SET active=false,revision=cr.revision+1 WHERE cr.ns=n AND cr.active AND cr.voucher IN(SELECT value->>'id' FROM jsonb_array_elements(v_rows->'vouchers') WHERE value->>'lock_id' IS NOT NULL OR value->>'marker_id' IS NOT NULL OR value->>'report_id' IS NOT NULL OR value->>'settle_id' IS NOT NULL OR (value->>'expired')::boolean);
 RETURN jsonb_build_object('projected',true,'originalConfirmed',receipt IS NOT NULL);END $$;

ALTER FUNCTION c1_runtime_internal.first_binding_material(text,jsonb) RENAME TO first_binding_material_before_catalog;
CREATE FUNCTION c1_runtime_internal.first_binding_material(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,c1_live_private,c1_runtime_private,c1_private,pg_temp AS $$
DECLARE answer jsonb;activation jsonb;BEGIN
 answer=c1_runtime_internal.first_binding_material_before_catalog(n,q);
 SELECT jsonb_build_object('profile',p.profile,'grantId',g.id) INTO activation FROM authority_profiles p JOIN grants g ON g.ns=p.ns AND g.role=p.role
 WHERE p.ns=n AND p.role='catalogAuthority' AND g.enabled AND g.system_account=p.profile->'binding'->>'catalogAuthority' AND g.expires_at>(SELECT now FROM deployment WHERE ns=n);
 RETURN answer||CASE WHEN activation IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('catalogActivation',activation) END;END $$;
ALTER FUNCTION c1_runtime_internal.first_binding_material(text,jsonb) OWNER TO c1_runtime_policy_owner;
REVOKE ALL ON FUNCTION c1_runtime_internal.first_binding_material(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION c1_runtime_internal.first_binding_material(text,jsonb) TO c1_connection_bootstrap;
