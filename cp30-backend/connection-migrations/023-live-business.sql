GRANT REFERENCES ON c1_private.store_registrations TO c1_runtime_table_owner;
-- Source-only real chain business. Never feeds synthetic model/source/009.
SET ROLE c1_runtime_table_owner;
CREATE SCHEMA c1_live_private AUTHORIZATION c1_runtime_table_owner;
REVOKE ALL ON SCHEMA c1_live_private FROM PUBLIC;
CREATE TABLE c1_live_private.stores(ns text,store text,registration_id text,meal text,profile jsonb NOT NULL,snapshot jsonb,rows jsonb,revision bigint NOT NULL DEFAULT 1,
 PRIMARY KEY(ns,store),UNIQUE(ns,registration_id),FOREIGN KEY(ns,registration_id) REFERENCES c1_private.store_registrations(ns,id));
CREATE TABLE c1_live_private.reviews(ns text,id uuid,subject text,store text,kind text,payload jsonb NOT NULL,store_revision bigint NOT NULL,identity_revision bigint NOT NULL,wallet_revision bigint,expires bigint NOT NULL,used boolean NOT NULL DEFAULT false,revision bigint NOT NULL DEFAULT 1,
 PRIMARY KEY(ns,id),FOREIGN KEY(ns,store) REFERENCES c1_live_private.stores(ns,store));
CREATE TABLE c1_live_private.intents(ns text,id uuid,subject text,email_key bytea,store text,action text,idem text,client jsonb NOT NULL,parameters jsonb NOT NULL,session_hash text NOT NULL,csrf_hash text NOT NULL,identity_revision bigint NOT NULL,credential_epoch bigint NOT NULL,
 op_id text NOT NULL,stage text NOT NULL CHECK(stage IN('ACCEPTED','UNKNOWN','WAIT_ACTOR','FINAL_SUCCEEDED')),private_record jsonb,observer_record jsonb,signed_quote jsonb,transaction_hash text,result jsonb,parent uuid,revision bigint NOT NULL DEFAULT 1,
 PRIMARY KEY(ns,id),UNIQUE(ns,subject,action,idem),UNIQUE(ns,op_id),FOREIGN KEY(ns,store) REFERENCES c1_live_private.stores(ns,store));
CREATE TABLE c1_live_private.leases(ns text,store text,seq text,generation text,kind text,intent uuid NOT NULL,PRIMARY KEY(ns,store,seq,generation,kind),FOREIGN KEY(ns,intent) REFERENCES c1_live_private.intents(ns,id));
CREATE TABLE c1_live_private.wallet_attempts(ns text,intent uuid,kind text CHECK(kind IN('approve','fund','settle')),deployment jsonb NOT NULL,hash text,confirmed boolean NOT NULL DEFAULT false,proof jsonb,revision bigint NOT NULL DEFAULT 1,
 PRIMARY KEY(ns,intent,kind),FOREIGN KEY(ns,intent) REFERENCES c1_live_private.intents(ns,id));
CREATE TABLE c1_live_private.claims(ns text,id text,intent uuid,store text,subject text,email_key bytea,seq text,generation text,access_epoch bigint NOT NULL DEFAULT 0,display_epoch bigint NOT NULL DEFAULT 0,revision bigint NOT NULL DEFAULT 1,
 PRIMARY KEY(ns,id),UNIQUE(ns,intent),FOREIGN KEY(ns,intent) REFERENCES c1_live_private.intents(ns,id));
CREATE TABLE c1_live_private.credentials(ns text,hash text,kind text CHECK(kind IN('access','display')),voucher text,session_hash text,identity_revision bigint,credential_epoch bigint,access_epoch bigint,display_epoch bigint,valid_until bigint,active boolean NOT NULL,revision bigint NOT NULL DEFAULT 1,
 PRIMARY KEY(ns,hash),FOREIGN KEY(ns,voucher) REFERENCES c1_live_private.claims(ns,id));
CREATE TABLE c1_live_private.token_ops(ns text,subject text,kind text,idem text,voucher text,result jsonb NOT NULL,PRIMARY KEY(ns,subject,kind,idem));
CREATE TABLE c1_live_private.receipts(ns text,intent uuid,hash text,block_number numeric,block_hash text,log_index numeric,proof jsonb NOT NULL,revision bigint NOT NULL DEFAULT 1,
 PRIMARY KEY(ns,intent),UNIQUE(ns,hash,log_index),FOREIGN KEY(ns,intent) REFERENCES c1_live_private.intents(ns,id));
RESET ROLE;
GRANT USAGE ON SCHEMA c1_live_private TO c1_live_code_owner,c1_runtime_code_owner,c1_runtime_policy_owner,c1_runtime_controller_code_owner,c1_auth_code_owner;
GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA c1_live_private TO c1_live_code_owner,c1_runtime_code_owner;
GRANT SELECT ON ALL TABLES IN SCHEMA c1_live_private TO c1_runtime_policy_owner,c1_runtime_controller_code_owner;
GRANT SELECT ON c1_private.confirmed_store_registrations,c1_private.store_registrations,c1_private.identities,c1_private.verified_owner_bindings,c1_private.deployment,c1_private.sessions,c1_private.external_session_expiry TO c1_live_code_owner,c1_runtime_code_owner,c1_runtime_policy_owner;
GRANT INSERT,UPDATE ON c1_private.sessions,c1_private.external_session_expiry TO c1_live_code_owner;
GRANT USAGE ON SCHEMA c1_private,c1_runtime_private,c1_runtime_internal TO c1_live_code_owner;
GRANT EXECUTE ON FUNCTION c1_runtime_private.check_open(text,jsonb),c1_runtime_private.base_guard(text,boolean,uuid),c1_private.auth(text,jsonb,boolean),c1_private.h(text),c1_private.fail(text) TO c1_live_code_owner;
-- The single independently anchored ledger now includes real business material.
ALTER FUNCTION c1_runtime_private.material(text) RENAME TO material_core;
CREATE FUNCTION c1_runtime_private.material(n text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,c1_live_private,c1_runtime_private,pg_temp AS $$
 SELECT c1_runtime_private.material_core(n)||jsonb_build_object('live',jsonb_build_object(
 'stores',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY store) FROM stores t WHERE ns=n),'[]'),
 'reviews',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM reviews t WHERE ns=n),'[]'),
 'intents',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM intents t WHERE ns=n),'[]'),
 'leases',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY store,seq,generation,kind) FROM leases t WHERE ns=n),'[]'),
 'wallet',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY intent,kind) FROM wallet_attempts t WHERE ns=n),'[]'),
 'claims',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM claims t WHERE ns=n),'[]'),
 'credentials',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY hash) FROM credentials t WHERE ns=n),'[]'),
 'tokens',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY subject,kind,idem) FROM token_ops t WHERE ns=n),'[]'),
 'receipts',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY intent) FROM receipts t WHERE ns=n),'[]')))
$$;
ALTER FUNCTION c1_runtime_private.floors(text) RENAME TO floors_core;
CREATE FUNCTION c1_runtime_private.floors(n text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,c1_live_private,c1_runtime_private,pg_temp AS $$
 SELECT c1_runtime_private.floors_core(n)||jsonb_build_object('runtime_attempt',(c1_runtime_private.floors_core(n)->'runtime_attempt')||coalesce((SELECT jsonb_object_agg(k,r) FROM (
 SELECT 'live-store:'||store k,revision r FROM stores WHERE ns=n UNION ALL SELECT 'live-review:'||id,revision FROM reviews WHERE ns=n UNION ALL SELECT 'live-intent:'||id,revision FROM intents WHERE ns=n
 UNION ALL SELECT 'live-wallet:'||intent||':'||kind,revision FROM wallet_attempts WHERE ns=n UNION ALL SELECT 'live-claim:'||id,revision FROM claims WHERE ns=n UNION ALL SELECT 'live-credential:'||hash,revision FROM credentials WHERE ns=n
 UNION ALL SELECT 'live-receipt:'||intent,revision FROM receipts WHERE ns=n) z),'{}'))
$$;
ALTER FUNCTION c1_runtime_private.material(text) OWNER TO c1_runtime_code_owner;
ALTER FUNCTION c1_runtime_private.floors(text) OWNER TO c1_runtime_code_owner;
GRANT EXECUTE ON FUNCTION c1_runtime_private.material(text),c1_runtime_private.floors(text) TO c1_runtime_controller_code_owner,c1_live_code_owner;

CREATE FUNCTION c1_live_private.context(n text,q jsonb,mutation boolean) RETURNS c1_private.sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_private,c1_runtime_private,pg_temp AS $$
BEGIN PERFORM check_open(n,q->'ticket');PERFORM base_guard(n,true,NULL);RETURN c1_private.auth(n,q,mutation);END $$;
CREATE FUNCTION c1_live_private.store(n text,k text,risk boolean DEFAULT false) RETURNS c1_live_private.stores LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_live_private,c1_private,pg_temp AS $$
DECLARE t stores;d c1_private.deployment;r c1_private.store_registrations;BEGIN
 SELECT * INTO t FROM stores WHERE ns=n AND store=k;SELECT * INTO d FROM c1_private.deployment WHERE ns=n;
 SELECT * INTO r FROM c1_private.store_registrations WHERE ns=n AND id=t.registration_id;
 IF t.store IS NULL OR r.state IS DISTINCT FROM 'CONFIRMED' OR r.record->'verifiedEvidence' IS DISTINCT FROM t.profile->'registrationEvidence' OR t.profile->'binding'->>'escrow' IS DISTINCT FROM r.record->>'escrow' THEN PERFORM c1_private.fail('VERIFIED_REGISTRATION_REQUIRED');END IF;
 IF risk AND (t.snapshot IS NULL OR d.now-(t.snapshot->>'timestamp')::bigint>(t.profile->>'maxSnapshotAgeSeconds')::bigint) THEN PERFORM c1_private.fail('FINALIZED_FACTS_STALE');END IF;RETURN t;END $$;
CREATE FUNCTION c1_live_private.owner(n text,t c1_live_private.stores,s c1_private.sessions) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_private,pg_temp AS $$
DECLARE b verified_owner_bindings;r store_registrations;d deployment;BEGIN
 SELECT * INTO r FROM store_registrations WHERE ns=n AND id=t.registration_id;SELECT * INTO b FROM verified_owner_bindings WHERE ns=n AND subject=s.subject;SELECT * INTO d FROM deployment WHERE ns=n;
 IF r.subject IS DISTINCT FROM s.subject OR NOT coalesce(b.enabled,false) OR b.owner IS DISTINCT FROM t.profile->'binding'->>'owner' OR b.revision::text IS DISTINCT FROM r.record->>'bindingRevision' OR b.identity_revision<>s.identity_revision OR b.credential_epoch<>s.epoch OR b.verified_until<=d.now THEN PERFORM fail('OWNER_BINDING_CHANGED');END IF;END $$;
CREATE FUNCTION c1_live_private.intent_dto(i c1_live_private.intents) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$ SELECT jsonb_build_object('id',i.id,'intentId',i.id,'store',i.store,'action',CASE i.action WHEN 'markHandover' THEN 'handover' ELSE i.action END,'stage',i.stage,'result',i.result,'transactionHash',i.transaction_hash) $$;
CREATE FUNCTION c1_live_private.unit(t c1_live_private.stores,v text) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT value FROM jsonb_array_elements(t.rows->'units') WHERE value->>'voucher_id'=v $$;
CREATE FUNCTION c1_live_private.voucher_dto(n text,c c1_live_private.claims,t c1_live_private.stores) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE u jsonb=c1_live_private.unit(t,c.id);v jsonb;pending boolean;BEGIN
 SELECT value INTO v FROM jsonb_array_elements(t.rows->'vouchers') WHERE value->>'id'=c.id;
 pending=EXISTS(SELECT 1 FROM c1_live_private.intents WHERE ns=n AND store=t.store AND parameters->>'voucherId'=c.id AND action IN('lock','markHandover','report','settle') AND stage<>'FINAL_SUCCEEDED');
 RETURN jsonb_build_object('id',c.id,'voucherId',c.id,'store',c.store,'state',coalesce(u->>'bucket','OLD_GENERATION'),'generation',c.generation,'expiresAt',v->>'expires_at','locked',v->>'lock_id' IS NOT NULL,'marked',v->>'marker_id' IS NOT NULL,'pending',pending,'accessEpoch',c.access_epoch,'displayEpoch',c.display_epoch,'price',u->>'price','terms',t.profile->'firstMeal');END $$;
CREATE FUNCTION c1_live_private.redeemable(n text,c c1_live_private.claims,t c1_live_private.stores,at_time bigint) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE u jsonb=c1_live_private.unit(t,c.id);v jsonb;terms jsonb;minute integer=(at_time%86400)/60;BEGIN
 SELECT value INTO v FROM jsonb_array_elements(t.rows->'vouchers') WHERE value->>'id'=c.id;
 SELECT value INTO terms FROM jsonb_array_elements(t.snapshot->'terms') WHERE value->>'mealId'=u->>'meal_id' AND value->>'version'=u->>'version';
 RETURN coalesce(u->>'bucket'='R' AND u->>'generation'=c.generation AND v->>'lock_id' IS NULL AND v->>'marker_id' IS NULL AND NOT (v->>'expired')::boolean AND at_time<(v->>'expires_at')::bigint
 AND NOT EXISTS(SELECT 1 FROM c1_live_private.intents WHERE ns=n AND store=t.store AND parameters->>'voucherId'=c.id AND action IN('lock','markHandover','report') AND stage<>'FINAL_SUCCEEDED')
 AND NOT (t.rows->'controls'->>'paused')::boolean AND (minute BETWEEN (terms->>'startMinute0')::int AND (terms->>'endMinute0')::int-1 OR ((terms->>'windowCount')::int=2 AND minute BETWEEN (terms->>'startMinute1')::int AND (terms->>'endMinute1')::int-1)),false);END $$;

CREATE FUNCTION c1_live_private.utc_window_end(t c1_live_private.stores,voucher text,at_time bigint) RETURNS bigint LANGUAGE plpgsql STABLE AS $$
DECLARE u jsonb=c1_live_private.unit(t,voucher);terms jsonb;second bigint=at_time%86400;base bigint=at_time-at_time%86400;BEGIN
 SELECT value INTO terms FROM jsonb_array_elements(t.snapshot->'terms') WHERE value->>'mealId'=u->>'meal_id' AND value->>'version'=u->>'version';
 IF second>=(terms->>'startMinute0')::int*60 AND second<(terms->>'endMinute0')::int*60 THEN RETURN base+(terms->>'endMinute0')::int*60;END IF;
 IF (terms->>'windowCount')::int=2 AND second>=(terms->>'startMinute1')::int*60 AND second<(terms->>'endMinute1')::int*60 THEN RETURN base+(terms->>'endMinute1')::int*60;END IF;RETURN at_time;END $$;
ALTER FUNCTION c1_live_private.utc_window_end(c1_live_private.stores,text,bigint) OWNER TO c1_live_code_owner;
REVOKE ALL ON FUNCTION c1_live_private.utc_window_end(c1_live_private.stores,text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION c1_live_private.utc_window_end(c1_live_private.stores,text,bigint) TO c1_runtime_code_owner;

CREATE FUNCTION c1_runtime_internal.live_api(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_live_private,c1_private,pg_temp AS $$
DECLARE op text=q->>'op';s c1_private.sessions;d c1_private.deployment;t stores;i intents;r reviews;c claims;cred credentials;ident c1_private.identities;b c1_private.verified_owner_bindings;v jsonb;u jsonb;p jsonb;j jsonb;result jsonb;store_key text;route_store text=q->>'store';now bigint;is_read boolean=op IN('public_stores','public_meals','public_meal','public_ledger','my_orders','order_get','intent_get','my_vouchers','voucher_get','workbench','case_get','payouts','wallet_material','auth_me');BEGIN
 PERFORM c1_runtime_private.check_open(n,q->'ticket');PERFORM c1_runtime_private.base_guard(n,true,NULL);SELECT * INTO d FROM c1_private.deployment WHERE ns=n;now=d.now;
 IF NOT is_read AND NOT EXISTS(SELECT 1 FROM c1_live_private.first_binding WHERE ns=n AND state='BOUND') THEN PERFORM c1_private.fail('BUSINESS_BINDING_PENDING');END IF;
 IF op NOT IN('public_stores','public_meals','public_meal','public_ledger') THEN s=c1_live_private.context(n,q,NOT is_read);SELECT * INTO ident FROM c1_private.identities WHERE ns=n AND subject=s.subject;END IF;
 IF op='auth_me' THEN RETURN jsonb_build_object('displayName','Signed in','walletBound',EXISTS(SELECT 1 FROM c1_private.verified_owner_bindings WHERE ns=n AND subject=s.subject AND enabled),'realIdentity',true);END IF;
 IF op='public_stores' THEN RETURN jsonb_build_object('items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',store,'store',store,'name',profile->'request'->>'name','controlRevision',rows->'controls'->>'control_revision')) FROM stores WHERE ns=n),'[]'));END IF;
 IF op='public_ledger' THEN RETURN jsonb_build_object('items',coalesce((SELECT jsonb_agg(jsonb_build_object('store',store,'financial',rows->'accounting'->'totals','funded',rows->'accounting'->'totals'->'counts'->>'F')) FROM stores WHERE ns=n),'[]'));END IF;
 IF op IN('my_orders','order_get','intent_get') THEN
  IF op='my_orders' THEN RETURN jsonb_build_object('items',coalesce((SELECT jsonb_agg(c1_live_private.intent_dto(z)||jsonb_build_object('quantity',z.parameters->>'quantity','amount',z.parameters->>'amount')) FROM intents z WHERE ns=n AND subject=s.subject AND action='fund'),'[]'));END IF;
  SELECT * INTO i FROM intents WHERE ns=n AND id=(q->>'id')::uuid AND subject=s.subject;IF NOT FOUND THEN PERFORM fail('NOT_FOUND');END IF;RETURN c1_live_private.intent_dto(i);END IF;
 IF op='my_vouchers' THEN RETURN jsonb_build_object('items',coalesce((SELECT jsonb_agg(c1_live_private.voucher_dto(n,z,c1_live_private.store(n,z.store))) FROM claims z WHERE ns=n AND email_key=ident.email_key),'[]'));END IF;
 IF op='voucher_get' THEN SELECT * INTO c FROM claims WHERE ns=n AND id=q->>'id' AND email_key=ident.email_key;IF NOT FOUND THEN PERFORM fail('NOT_FOUND');END IF;t=c1_live_private.store(n,c.store);RETURN c1_live_private.voucher_dto(n,c,t);END IF;
 IF op IN('wallet_material','wallet_attempt','wallet_hash') THEN
  IF is_read THEN SELECT * INTO i FROM intents WHERE ns=n AND id=(q->>'id')::uuid AND subject=s.subject;ELSE SELECT * INTO i FROM intents WHERE ns=n AND id=(q->>'id')::uuid AND subject=s.subject FOR UPDATE;END IF;
  IF NOT FOUND OR i.action NOT IN('fund','settle') THEN PERFORM fail('NOT_FOUND');END IF;t=c1_live_private.store(n,i.store,NOT is_read);
  IF i.action='settle' THEN PERFORM c1_live_private.owner(n,t,s);ELSE
   SELECT * INTO b FROM c1_private.verified_owner_bindings WHERE ns=n AND subject=s.subject;
   IF NOT coalesce(b.enabled,false) OR b.owner IS DISTINCT FROM i.parameters->>'payer' OR b.identity_revision<>s.identity_revision OR b.credential_epoch<>s.epoch OR b.verified_until<=now THEN PERFORM fail('PAYER_BINDING_CHANGED');END IF;END IF;
  IF op='wallet_material' THEN RETURN jsonb_build_object('intent',to_jsonb(i),'store',to_jsonb(t),'attempts',coalesce((SELECT jsonb_object_agg(kind,to_jsonb(a)) FROM wallet_attempts a WHERE ns=n AND intent=i.id),'{}'),'now',now);END IF;
  IF i.stage='FINAL_SUCCEEDED' OR q->>'kind' NOT IN('approve','fund','settle') OR (i.action='settle') IS DISTINCT FROM (q->>'kind'='settle') THEN PERFORM fail('ORIGINAL_WALLET_KIND_REQUIRED');END IF;
  IF op='wallet_attempt' THEN
   IF EXISTS(SELECT 1 FROM wallet_attempts WHERE ns=n AND intent=i.id AND kind=q->>'kind') THEN PERFORM fail('ORIGINAL_WALLET_ATTEMPT_UNKNOWN');END IF;
   IF q->>'kind'='fund' AND NOT EXISTS(SELECT 1 FROM wallet_attempts WHERE ns=n AND intent=i.id AND kind='approve' AND confirmed) THEN PERFORM fail('ORIGINAL_APPROVAL_NOT_CONFIRMED');END IF;
   IF q->'deployment'->>'from' IS DISTINCT FROM (CASE WHEN i.action='fund' THEN i.parameters->>'payer' ELSE t.profile->'binding'->>'owner' END) OR (q->'deployment'->>'chainId')::int IS DISTINCT FROM (t.profile->'binding'->>'chainId')::int OR q->'deployment'->>'to' IS DISTINCT FROM (CASE WHEN q->>'kind'='approve' THEN t.profile->'binding'->>'asset' ELSE t.profile->'binding'->>'escrow' END) OR q->'deployment'->>'value' IS DISTINCT FROM '0' THEN PERFORM fail('ORIGINAL_WALLET_BINDING_REQUIRED');END IF;
   INSERT INTO wallet_attempts(ns,intent,kind,deployment) VALUES(n,i.id,q->>'kind',q->'deployment');
   UPDATE intents SET stage='UNKNOWN',observer_record=CASE WHEN q->>'kind' IN('fund','settle') THEN q->'observerRecord' ELSE observer_record END,revision=revision+1 WHERE ns=n AND id=i.id;
  ELSE
   IF q->>'hash' !~'^0x[0-9a-f]{64}$' OR NOT EXISTS(SELECT 1 FROM wallet_attempts WHERE ns=n AND intent=i.id AND kind=q->>'kind' AND (hash IS NULL OR hash=q->>'hash')) THEN PERFORM fail('ORIGINAL_WALLET_LOCATOR_CONFLICT');END IF;
   UPDATE wallet_attempts SET hash=q->>'hash',revision=revision+1 WHERE ns=n AND intent=i.id AND kind=q->>'kind' AND hash IS NULL;
   IF q->>'kind'<>'approve' THEN UPDATE intents SET transaction_hash=q->>'hash',revision=revision+1 WHERE ns=n AND id=i.id AND transaction_hash IS NULL;END IF;
  END IF;RETURN jsonb_build_object('id',i.id,'kind',q->>'kind','stage','UNKNOWN','locatorOnly',true);END IF;
 IF op IN('support_confirm','claim_confirm','settle_confirm') THEN SELECT store INTO store_key FROM reviews WHERE ns=n AND id=(q->'client'->>'reviewId')::uuid AND subject=s.subject;IF route_store IS NOT NULL AND route_store IS DISTINCT FROM store_key THEN PERFORM fail('ORIGINAL_STORE_ROUTE_REQUIRED');END IF;q=q||jsonb_build_object('store',store_key);END IF;
 IF op IN('recover','display') THEN SELECT store INTO store_key FROM claims WHERE ns=n AND id=q->>'voucher' AND email_key=ident.email_key;q=q||jsonb_build_object('store',store_key);END IF;
 t=c1_live_private.store(n,q->>'store',op NOT IN('public_meals','public_meal','workbench','payouts','case_get'));
 IF op IN('public_meals','public_meal') THEN RETURN jsonb_build_object('items',jsonb_build_array(t.profile->'firstMeal'||jsonb_build_object('id',t.meal,'meal',t.meal,'store',t.store,'listed',t.snapshot->'menu'->('0x'||t.meal)->'listed','eligible',t.rows->'accounting'->'totals'->'counts'->>'A','financial',t.rows->'accounting'->'totals')));END IF;
 IF op IN('workbench','payouts','case_get','code_check','lock_confirm','handover_confirm','settle_review','settle_confirm') THEN PERFORM c1_live_private.owner(n,t,s);END IF;
 IF op='workbench' THEN RETURN jsonb_build_object('store',t.store,'financial',t.rows->'accounting'->'totals','items',jsonb_build_array(t.profile->'firstMeal'||jsonb_build_object('id',t.meal)));END IF;
 IF op='payouts' THEN RETURN jsonb_build_object('items',coalesce((SELECT jsonb_agg(value||jsonb_build_object('id',value->>'voucher_id','amount',value->>'price','state',value->>'bucket','settled',value->>'bucket'='S')) FROM jsonb_array_elements(t.rows->'units') WHERE value->>'bucket' IN('H','S')),'[]'));END IF;
 IF op='case_get' THEN
  SELECT value INTO v FROM jsonb_array_elements(t.rows->'vouchers') WHERE value->>'lock_id'=q->>'id';IF v IS NULL THEN PERFORM fail('NOT_FOUND');END IF;
  SELECT * INTO c FROM claims WHERE ns=n AND id=v->>'id';RETURN c1_live_private.voucher_dto(n,c,t)||jsonb_build_object('id',q->>'id','voucher',c.id);END IF;
 IF op IN('support_review','claim_review','settle_review') THEN
  IF (SELECT count(*) FROM reviews WHERE ns=n AND subject=s.subject AND expires>now AND NOT used)>=20 THEN PERFORM fail('QUEUE_FULL');END IF;
  IF op='settle_review' THEN
   SELECT value INTO u FROM jsonb_array_elements(t.rows->'units') WHERE value->>'voucher_id'=q->>'voucher' AND value->>'bucket'='H';IF u IS NULL THEN PERFORM fail('NOT_SETTLEABLE');END IF;p=jsonb_build_object('voucherId',q->>'voucher','generation',u->>'generation','amount',u->>'price','deadline',(now+600)::text);
  ELSE
   IF q->>'meal' IS DISTINCT FROM t.meal OR NOT coalesce((t.snapshot->'menu'->('0x'||t.meal)->>'listed')::boolean,false) OR (t.rows->'controls'->>'paused')::boolean OR (t.rows->'controls'->>'closed')::boolean THEN PERFORM fail('UNAVAILABLE');END IF;
   j=t.snapshot->'menu'->('0x'||t.meal);p=jsonb_build_object('mealId','0x'||t.meal,'currentVersion',j->>'currentVersion','termsHash',j->'candidate'->>'termsHash','unitPrice',j->'terms'->>'unitPrice','deadline',(now+600)::text);
   IF op='support_review' THEN
    SELECT * INTO b FROM c1_private.verified_owner_bindings WHERE ns=n AND subject=s.subject;
    IF NOT coalesce(b.enabled,false) OR b.identity_revision<>s.identity_revision OR b.credential_epoch<>s.epoch OR b.verified_until<=now THEN PERFORM fail('PAYER_BINDING_CHANGED');END IF;
    IF (q->>'quantity')::int NOT BETWEEN 1 AND 10 OR (t.rows->'controls'->>'lifetime')::int+(q->>'quantity')::int+coalesce((SELECT sum((parameters->>'quantity')::int) FROM intents WHERE ns=n AND store=t.store AND action='fund' AND stage<>'FINAL_SUCCEEDED'),0)>10 THEN PERFORM fail('CAPACITY');END IF;
    -- Funding terms hash comes from trusted current terms, not candidate availability.
    p=p||jsonb_build_object('payer',b.owner,'termsHash',j->'terms'->>'termsHash','quantity',(q->>'quantity'),'amount',(((q->>'quantity')::numeric)*(j->'terms'->>'unitPrice')::numeric)::text);
   ELSE
    IF NOT coalesce((j->'candidate'->>'available')::boolean,false) OR EXISTS(SELECT 1 FROM claims WHERE ns=n AND email_key=ident.email_key AND (c1_live_private.voucher_dto(n,claims,t)->>'expiresAt')::bigint>now) OR EXISTS(SELECT 1 FROM intents WHERE ns=n AND email_key=ident.email_key AND action='issue' AND stage<>'FINAL_SUCCEEDED') THEN PERFORM fail('CLAIM_UNAVAILABLE');END IF;
    p=jsonb_build_object('mealId','0x'||t.meal,'expectedUnitSeq',j->'candidate'->>'unitSeq','expectedNextGeneration',j->'candidate'->>'nextGeneration','expectedTermsHash',j->'candidate'->>'termsHash','deadline',(now+600)::text);
   END IF;
  END IF;
  INSERT INTO reviews VALUES(n,(q->>'review_id')::uuid,s.subject,t.store,replace(op,'_review',''),p,t.revision,s.identity_revision,CASE WHEN op='support_review' THEN b.revision ELSE NULL END,now+300,false,1);
  RETURN jsonb_build_object('reviewId',q->>'review_id','store',t.store,'review',p||t.profile->'firstMeal'||jsonb_build_object('reviewId',q->>'review_id','expiresAt',now+300,'collectionTimeZone','UTC'));END IF;
 IF op IN('support_confirm','claim_confirm','settle_confirm') THEN
  SELECT * INTO i FROM intents WHERE ns=n AND subject=s.subject AND action=CASE op WHEN 'support_confirm' THEN 'fund' WHEN 'claim_confirm' THEN 'issue' ELSE 'settle' END AND idem=q->>'key';
  IF FOUND THEN IF i.client IS DISTINCT FROM q->'client' THEN PERFORM fail('IDEMPOTENCY_CONFLICT');END IF;RETURN c1_live_private.intent_dto(i);END IF;
  IF (SELECT count(*) FROM intents WHERE ns=n AND stage<>'FINAL_SUCCEEDED')>=24 THEN PERFORM fail('QUEUE_FULL');END IF;
  SELECT * INTO r FROM reviews WHERE ns=n AND id=(q->'client'->>'reviewId')::uuid AND subject=s.subject FOR UPDATE;
  IF r.id IS NULL OR r.store<>t.store OR r.used OR r.expires<=now OR r.store_revision<>t.revision OR r.identity_revision<>s.identity_revision OR r.kind<>replace(op,'_confirm','') THEN PERFORM fail('STALE_REVIEW');END IF;
  IF r.kind='support' THEN SELECT * INTO b FROM c1_private.verified_owner_bindings WHERE ns=n AND subject=s.subject;IF b.revision IS DISTINCT FROM r.wallet_revision OR b.owner IS DISTINCT FROM r.payload->>'payer' OR NOT b.enabled OR b.verified_until<=now THEN PERFORM fail('PAYER_BINDING_CHANGED');END IF;END IF;
  INSERT INTO intents(ns,id,subject,email_key,store,action,idem,client,parameters,session_hash,csrf_hash,identity_revision,credential_epoch,op_id,stage) VALUES(n,(q->>'new_id')::uuid,s.subject,ident.email_key,t.store,CASE r.kind WHEN 'support' THEN 'fund' WHEN 'claim' THEN 'issue' ELSE 'settle' END,q->>'key',q->'client',r.payload||jsonb_build_object('opId',q->>'op_id'),q->>'session_hash',q->>'csrf_hash',s.identity_revision,s.epoch,q->>'op_id','ACCEPTED') RETURNING * INTO i;
  IF r.kind='claim' THEN INSERT INTO leases VALUES(n,t.store,r.payload->>'expectedUnitSeq',r.payload->>'expectedNextGeneration','issue',i.id);ELSIF r.kind='settle' THEN SELECT value INTO u FROM jsonb_array_elements(t.rows->'units') WHERE value->>'voucher_id'=r.payload->>'voucherId';INSERT INTO leases VALUES(n,t.store,u->>'seq',r.payload->>'generation','settle',i.id);END IF;
  UPDATE reviews SET used=true,revision=revision+1 WHERE ns=n AND id=r.id;RETURN c1_live_private.intent_dto(i);END IF;
 IF op IN('code_check','lock_confirm') THEN
  IF op='lock_confirm' THEN SELECT * INTO i FROM intents WHERE ns=n AND subject=s.subject AND store=t.store AND action='lock' AND idem=q->>'key';IF FOUND THEN IF i.client IS DISTINCT FROM jsonb_build_object('display_hash',q->>'display_hash') THEN PERFORM fail('IDEMPOTENCY_CONFLICT');END IF;RETURN c1_live_private.intent_dto(i);END IF;END IF;
  SELECT * INTO cred FROM credentials WHERE ns=n AND hash=q->>'display_hash' AND kind='display' AND active AND valid_until>now;
  SELECT * INTO c FROM claims WHERE ns=n AND id=cred.voucher AND store=t.store;
  IF c.id IS NULL OR cred.access_epoch<>c.access_epoch OR cred.display_epoch<>c.display_epoch OR cred.credential_epoch<>d.credential_epoch OR NOT EXISTS(SELECT 1 FROM c1_private.sessions ss JOIN c1_private.identities ii ON ii.ns=ss.ns AND ii.subject=ss.subject JOIN c1_private.external_session_expiry ee ON ee.ns=ss.ns AND ee.hash=ss.hash WHERE ss.ns=n AND ss.hash=c1_private.h(cred.session_hash) AND NOT ss.revoked AND ss.identity_revision=ii.revision AND ss.epoch=d.credential_epoch AND ee.expires_at>now) OR NOT c1_live_private.redeemable(n,c,t,now) THEN PERFORM fail('INVALID_CODE');END IF;
  IF op='code_check' THEN RETURN c1_live_private.voucher_dto(n,c,t)||jsonb_build_object('valid',true);END IF;
  SELECT * INTO i FROM intents WHERE ns=n AND subject=s.subject AND action='lock' AND idem=q->>'key';IF FOUND THEN RETURN c1_live_private.intent_dto(i);END IF;
  UPDATE credentials SET active=false,revision=revision+1 WHERE ns=n AND voucher=c.id AND active;
  UPDATE claims SET access_epoch=access_epoch+1,display_epoch=display_epoch+1,revision=revision+1 WHERE ns=n AND id=c.id;
  INSERT INTO intents(ns,id,subject,email_key,store,action,idem,client,parameters,session_hash,csrf_hash,identity_revision,credential_epoch,op_id,stage) VALUES(n,(q->>'new_id')::uuid,s.subject,ident.email_key,t.store,'lock',q->>'key',jsonb_build_object('display_hash',q->>'display_hash'),jsonb_build_object('opId',q->>'op_id','voucherId',c.id,'generation',c.generation,'deadline',(now+120)::text),q->>'session_hash',q->>'csrf_hash',s.identity_revision,s.epoch,q->>'op_id','ACCEPTED') RETURNING * INTO i;
  INSERT INTO leases VALUES(n,t.store,c.seq,c.generation,'lock',i.id);RETURN c1_live_private.intent_dto(i);END IF;
 IF op='handover_confirm' THEN
  SELECT * INTO i FROM intents WHERE ns=n AND subject=s.subject AND store=t.store AND action='markHandover' AND idem=q->>'key';IF FOUND THEN IF i.client IS DISTINCT FROM jsonb_build_object('caseId',q->>'case_id') THEN PERFORM fail('IDEMPOTENCY_CONFLICT');END IF;RETURN c1_live_private.intent_dto(i);END IF;
  SELECT value INTO v FROM jsonb_array_elements(t.rows->'vouchers') WHERE value->>'lock_id'=q->>'case_id' AND value->>'marker_id' IS NULL;
  SELECT * INTO i FROM intents WHERE ns=n AND store=t.store AND action='lock' AND op_id=q->>'case_id' AND subject=s.subject AND stage='FINAL_SUCCEEDED';
  IF v IS NULL OR i.id IS NULL THEN PERFORM fail('ORIGINAL_LOCK_OWNER_REQUIRED');END IF;
  SELECT * INTO i FROM intents WHERE ns=n AND subject=s.subject AND action='markHandover' AND idem=q->>'key';IF FOUND THEN RETURN c1_live_private.intent_dto(i);END IF;
  INSERT INTO intents(ns,id,subject,email_key,store,action,idem,client,parameters,session_hash,csrf_hash,identity_revision,credential_epoch,op_id,stage) VALUES(n,(q->>'new_id')::uuid,s.subject,ident.email_key,t.store,'markHandover',q->>'key',jsonb_build_object('caseId',q->>'case_id'),jsonb_build_object('opId',q->>'op_id','voucherId',v->>'id','generation',v->>'generation','lockId',q->>'case_id','deadline',(now+120)::text),q->>'session_hash',q->>'csrf_hash',s.identity_revision,s.epoch,q->>'op_id','ACCEPTED') RETURNING * INTO i;
  INSERT INTO leases VALUES(n,t.store,v->>'seq',v->>'generation','markHandover',i.id);
  UPDATE credentials SET active=false,revision=revision+1 WHERE ns=n AND voucher=v->>'id' AND active;RETURN c1_live_private.intent_dto(i);END IF;
 IF op IN('recover','display') THEN
  SELECT * INTO c FROM claims WHERE ns=n AND id=q->>'voucher' AND email_key=ident.email_key FOR UPDATE;IF NOT FOUND OR c.store<>t.store THEN PERFORM fail('NOT_FOUND');END IF;
  SELECT z.result INTO result FROM token_ops z WHERE ns=n AND subject=s.subject AND kind=op AND idem=q->>'key';IF FOUND THEN RETURN result||jsonb_build_object('replay',true);END IF;
  IF op='recover' THEN
   UPDATE credentials SET active=false,revision=revision+1 WHERE ns=n AND voucher=c.id AND active;
   UPDATE claims SET access_epoch=access_epoch+1,display_epoch=display_epoch+1,revision=revision+1 WHERE ns=n AND id=c.id RETURNING * INTO c;
   INSERT INTO c1_private.sessions(ns,hash,csrf,subject,identity_revision,epoch,created,activity,authenticated) VALUES(n,c1_private.h(q->>'new_session_hash'),c1_private.h(q->>'new_csrf_hash'),s.subject,s.identity_revision,s.epoch,now,now,s.authenticated);
   INSERT INTO c1_private.external_session_expiry SELECT ns,c1_private.h(q->>'new_session_hash'),expires_at FROM c1_private.external_session_expiry WHERE ns=n AND hash=s.hash;
   UPDATE c1_private.sessions SET revoked=true,revision=revision+1 WHERE ns=n AND hash=s.hash;
   IF c1_live_private.redeemable(n,c,t,now) THEN INSERT INTO credentials VALUES(n,q->>'new_access_hash','access',c.id,q->>'new_session_hash',s.identity_revision,s.epoch,c.access_epoch,c.display_epoch,now+86400,true,1);END IF;
   result=c1_live_private.voucher_dto(n,c,t)||jsonb_build_object('redeemable',c1_live_private.redeemable(n,c,t,now));
  ELSE
   IF NOT EXISTS(SELECT 1 FROM credentials WHERE ns=n AND hash=q->>'access_hash' AND kind='access' AND voucher=c.id AND session_hash=q->>'session_hash' AND active AND valid_until>now AND credential_epoch=s.epoch AND identity_revision=s.identity_revision AND access_epoch=c.access_epoch) OR NOT c1_live_private.redeemable(n,c,t,now) THEN PERFORM fail('INVALID_CODE');END IF;
   UPDATE credentials SET active=false,revision=revision+1 WHERE ns=n AND voucher=c.id AND kind='display' AND active;
   UPDATE claims SET display_epoch=display_epoch+1,revision=revision+1 WHERE ns=n AND id=c.id RETURNING * INTO c;
   INSERT INTO credentials VALUES(n,q->>'new_display_hash','display',c.id,q->>'session_hash',s.identity_revision,s.epoch,c.access_epoch,c.display_epoch,least(now+120,(c1_live_private.voucher_dto(n,c,t)->>'expiresAt')::bigint,c1_live_private.utc_window_end(t,c.id,now),(SELECT ee.expires_at FROM c1_private.external_session_expiry ee WHERE ee.ns=n AND ee.hash=s.hash)),true,1);
   result=c1_live_private.voucher_dto(n,c,t)||jsonb_build_object('validUntil',least(now+120,(c1_live_private.voucher_dto(n,c,t)->>'expiresAt')::bigint,c1_live_private.utc_window_end(t,c.id,now),(SELECT ee.expires_at FROM c1_private.external_session_expiry ee WHERE ee.ns=n AND ee.hash=s.hash)));
  END IF;
  INSERT INTO token_ops VALUES(n,s.subject,op,q->>'key',c.id,result);RETURN result;END IF;
 PERFORM fail('LIVE_OPERATION_NOT_IMPLEMENTED');RETURN NULL;
END $$;

CREATE FUNCTION c1_runtime_internal.live_material(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_live_private,c1_private,pg_temp AS $$
DECLARE i intents;t stores;r c1_private.store_registrations;out jsonb;BEGIN
 PERFORM c1_runtime_private.check_open(n,q->'ticket');PERFORM c1_runtime_private.base_guard(n,true,NULL);
 IF q->>'op'='registration' THEN
  SELECT * INTO r FROM c1_private.store_registrations WHERE ns=n AND state='CONFIRMED' AND (q->>'registrationId' IS NULL OR id=q->>'registrationId') AND (NOT EXISTS(SELECT 1 FROM c1_live_private.first_binding WHERE ns=n) OR id=(SELECT registration_id FROM c1_live_private.first_binding WHERE ns=n)) ORDER BY id LIMIT 1;
  IF r.id IS NULL THEN RETURN jsonb_build_object('registration',NULL);END IF;
  SELECT * INTO t FROM stores WHERE ns=n AND registration_id=r.id;
  RETURN jsonb_build_object('registration',to_jsonb(r),'store',CASE WHEN t.store IS NULL THEN NULL ELSE to_jsonb(t) END);END IF;
 IF q->>'op'='tasks' THEN RETURN jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(z)) FROM (SELECT * FROM intents WHERE ns=n AND (stage IN('ACCEPTED','UNKNOWN') OR (stage='WAIT_ACTOR' AND EXISTS(SELECT 1 FROM wallet_attempts a WHERE a.ns=n AND a.intent=intents.id AND a.kind='approve' AND a.hash IS NOT NULL AND NOT a.confirmed))) ORDER BY id LIMIT 24) z),'[]'));END IF;
 SELECT * INTO i FROM intents WHERE ns=n AND id=(q->>'id')::uuid;IF i.id IS NULL THEN PERFORM fail('NOT_FOUND');END IF;t=c1_live_private.store(n,i.store);
 RETURN jsonb_build_object('intent',to_jsonb(i),'store',to_jsonb(t),'attempts',coalesce((SELECT jsonb_object_agg(kind,to_jsonb(a)) FROM wallet_attempts a WHERE ns=n AND intent=i.id),'{}'),'now',(SELECT dep.now FROM c1_private.deployment dep WHERE dep.ns=n));END $$;

CREATE FUNCTION c1_runtime_internal.live_result(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_live_private,c1_private,pg_temp AS $$
DECLARE i intents;t stores;BEGIN
 PERFORM c1_runtime_private.check_open(n,q->'ticket');PERFORM c1_runtime_private.base_guard(n,true,NULL);
 SELECT * INTO i FROM intents WHERE ns=n AND id=(q->>'id')::uuid FOR UPDATE;t=c1_live_private.store(n,i.store);
 IF i.id IS NULL OR i.private_record IS NULL OR i.private_record IS DISTINCT FROM q->'privateRecord' THEN PERFORM fail('ORIGINAL_PRIVATE_RESULT_REQUIRED');END IF;
 IF i.action='fund' THEN
  IF i.signed_quote IS NOT NULL THEN IF i.signed_quote IS DISTINCT FROM q->'signedQuote' THEN PERFORM fail('ORIGINAL_QUOTE_CONFLICT');END IF;RETURN jsonb_build_object('retained',true,'replay',true);END IF;
  IF q->'signedQuote'->'quote' IS DISTINCT FROM i.private_record->'quote' OR q->'signedQuote'->>'quoteAuthority' IS DISTINCT FROM t.profile->'binding'->>'quoteAuthority' OR q->'signedQuote'->>'escrow' IS DISTINCT FROM t.profile->'binding'->>'escrow' THEN PERFORM fail('ORIGINAL_QUOTE_CONFLICT');END IF;
  UPDATE intents SET signed_quote=q->'signedQuote',stage='WAIT_ACTOR',revision=revision+1 WHERE ns=n AND id=i.id;
 ELSE
  IF q->>'hash'!~'^0x[0-9a-f]{64}$' OR (i.transaction_hash IS NOT NULL AND i.transaction_hash<>q->>'hash') THEN PERFORM fail('ORIGINAL_PRIVATE_HASH_CONFLICT');END IF;
  UPDATE intents SET transaction_hash=q->>'hash',observer_record=q->'observerRecord',stage='UNKNOWN',revision=revision+1 WHERE ns=n AND id=i.id AND transaction_hash IS NULL;
 END IF;RETURN jsonb_build_object('retained',true,'locatorOnly',true);END $$;

CREATE FUNCTION c1_runtime_internal.live_projection(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_live_private,c1_private,pg_temp AS $$
DECLARE t stores;r c1_private.store_registrations;i intents;old receipts;rows jsonb=q->'rows';snap jsonb=q->'snapshot';receipt jsonb=rows->'receipt';v jsonb;j jsonb;b numeric;report_id uuid;BEGIN
 PERFORM c1_runtime_private.check_open(n,q->'ticket');PERFORM c1_runtime_private.base_guard(n,true,NULL);
 SELECT * INTO t FROM stores WHERE ns=n AND store=q->>'store' FOR UPDATE;
 IF t.store IS NULL THEN
  SELECT * INTO r FROM c1_private.store_registrations WHERE ns=n AND id=q->>'registrationId' AND state='CONFIRMED';
  IF r.id IS NULL OR r.record IS DISTINCT FROM q->'registrationRecord' OR q->>'store' IS DISTINCT FROM substring(r.store_id FROM 3) OR q->'profile'->'registrationEvidence' IS DISTINCT FROM r.record->'verifiedEvidence'
  OR q->'profile'->'binding' IS DISTINCT FROM (SELECT jsonb_object_agg(k,CASE WHEN k='chainId' THEN to_jsonb((r.record->'verifiedEvidence'->>k)::bigint) ELSE r.record->'verifiedEvidence'->k END) FROM unnest(ARRAY['chainId','escrow','asset','storeId','owner','receiver','quoteAuthority','catalogAuthority','issuerAuthority','operatorAuthority']) AS x(k)) THEN PERFORM fail('VERIFIED_REGISTRATION_REQUIRED');END IF;
  INSERT INTO stores(ns,store,registration_id,meal,profile) VALUES(n,q->>'store',r.id,substring(r.record->'original'->'catalog'->0->'terms'->>'mealId' FROM 3),q->'profile') RETURNING * INTO t;
 ELSE
  IF t.revision IS DISTINCT FROM (q->>'expectedRevision')::bigint OR t.profile IS DISTINCT FROM q->'profile' THEN PERFORM fail('PROJECTION_CAS_CONFLICT');END IF;
 END IF;
 IF rows->>'schema' IS DISTINCT FROM 'CP30_CHAIN_PROJECTION_V1' OR rows->'snapshot'->>'blockHash' IS DISTINCT FROM snap->>'blockHash' OR rows->'snapshot'->>'blockNumber' IS DISTINCT FROM snap->>'blockNumber' OR snap->>'authority' IS DISTINCT FROM 'CANONICAL_FINALIZED_CHAIN_FACTS'
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
   INSERT INTO claims(ns,id,intent,store,subject,email_key,seq,generation) VALUES(n,v->>'voucherId',i.id,t.store,i.subject,i.email_key,v->>'unitSeq',v->>'generation');
  END IF;
  UPDATE intents SET stage='FINAL_SUCCEEDED',result=jsonb_build_object('result',CASE WHEN i.action='fund' THEN receipt->'event'->'args'->>'batchId' ELSE receipt->'operation'->>'result' END,'transactionHash',receipt->>'transactionHash','blockHash',receipt->>'blockHash'),revision=revision+1 WHERE ns=n AND id=i.id;
  IF i.action='markHandover' THEN
   report_id=(q->>'reportIntentId')::uuid;
   INSERT INTO intents(ns,id,subject,email_key,store,action,idem,client,parameters,session_hash,csrf_hash,identity_revision,credential_epoch,op_id,stage,parent) VALUES(n,report_id,i.subject,i.email_key,t.store,'report','report:'||i.id,jsonb_build_object('parent',i.id),jsonb_build_object('opId',q->>'reportOpId','voucherId',i.parameters->>'voucherId','generation',i.parameters->>'generation','lockId',i.parameters->>'lockId','markerId',receipt->'operation'->>'result'),i.session_hash,i.csrf_hash,i.identity_revision,i.credential_epoch,q->>'reportOpId','ACCEPTED',i.id);
  END IF;
 END IF;
 -- Older original receipts are retained without rolling back newer actual facts.
 IF t.snapshot IS NULL OR b>=(t.snapshot->>'blockNumber')::numeric THEN
  IF t.snapshot IS NOT NULL AND b=(t.snapshot->>'blockNumber')::numeric THEN
   IF (t.snapshot-'operations'-'vouchers') IS DISTINCT FROM (snap-'operations'-'vouchers') OR EXISTS(SELECT 1 FROM jsonb_each(t.snapshot->'operations') z WHERE snap->'operations' ? z.key AND snap->'operations'->z.key IS DISTINCT FROM z.value) OR EXISTS(SELECT 1 FROM jsonb_each(t.snapshot->'vouchers') z WHERE snap->'vouchers' ? z.key AND snap->'vouchers'->z.key IS DISTINCT FROM z.value) THEN PERFORM fail('SAME_BLOCK_FACT_CONFLICT');END IF;
   snap=snap||jsonb_build_object('operations',(t.snapshot->'operations')||(snap->'operations'),'vouchers',(t.snapshot->'vouchers')||(snap->'vouchers'));
  END IF;
  UPDATE stores SET snapshot=snap,rows=rows-'receipt',revision=revision+1 WHERE ns=n AND store=t.store;
 END IF;
 UPDATE credentials cr SET active=false,revision=cr.revision+1 WHERE cr.ns=n AND cr.active AND cr.voucher IN(SELECT value->>'id' FROM jsonb_array_elements(rows->'vouchers') WHERE value->>'lock_id' IS NOT NULL OR value->>'marker_id' IS NOT NULL OR value->>'report_id' IS NOT NULL OR value->>'settle_id' IS NOT NULL OR (value->>'expired')::boolean);
 RETURN jsonb_build_object('projected',true,'originalConfirmed',receipt IS NOT NULL);END $$;

CREATE FUNCTION c1_runtime_internal.live_approval(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_live_private,c1_private,pg_temp AS $$
DECLARE i intents;a wallet_attempts;b verified_owner_bindings;d deployment;t stores;p jsonb=q->'proof';BEGIN
 PERFORM c1_runtime_private.check_open(n,q->'ticket');PERFORM c1_runtime_private.base_guard(n,true,NULL);
 SELECT * INTO i FROM intents WHERE ns=n AND id=(q->>'id')::uuid FOR UPDATE;SELECT * INTO a FROM wallet_attempts WHERE ns=n AND intent=i.id AND kind='approve' FOR UPDATE;SELECT * INTO d FROM deployment WHERE ns=n;t=c1_live_private.store(n,i.store,true);
 PERFORM c1_private.auth(n,jsonb_build_object('session_hash',i.session_hash,'csrf_hash',i.csrf_hash),true);SELECT * INTO b FROM verified_owner_bindings WHERE ns=n AND subject=i.subject;
 IF i.id IS NULL OR i.action<>'fund' OR i.signed_quote IS NULL OR (i.signed_quote->'quote'->>'deadline')::bigint<=d.now OR NOT coalesce(b.enabled,false) OR b.owner IS DISTINCT FROM i.parameters->>'payer' OR b.verified_until<=d.now OR a.hash IS NULL OR a.revision IS DISTINCT FROM (q->>'attemptRevision')::bigint OR i.revision IS DISTINCT FROM (q->>'intentRevision')::bigint OR q->'record'->'deployment' IS DISTINCT FROM a.deployment OR q->'record'->>'transactionHash' IS DISTINCT FROM a.hash OR p->>'verification' IS DISTINCT FROM 'VERIFIED_ORIGINAL_APPROVAL' OR p->>'status' IS DISTINCT FROM 'READY_FOR_ORIGINAL_FUND' THEN PERFORM fail('ORIGINAL_APPROVAL_REQUIRED');END IF;
 IF p->>'asset' IS DISTINCT FROM t.profile->'binding'->>'asset' OR p->>'escrow' IS DISTINCT FROM t.profile->'binding'->>'escrow' OR p->>'assetCodeHash' IS DISTINCT FROM t.profile->'assetMetadata'->>'codeHash' OR p->>'attemptId' IS DISTINCT FROM i.id::text||':approve' OR p->>'quoteId' IS DISTINCT FROM i.op_id OR p->>'transactionHash' IS DISTINCT FROM a.hash OR p->>'payer' IS DISTINCT FROM i.parameters->>'payer' OR p->>'amount' IS DISTINCT FROM i.parameters->>'amount' OR q->'record'->>'quoteId' IS DISTINCT FROM i.op_id OR q->'record'->>'payer' IS DISTINCT FROM i.parameters->>'payer' OR q->'record'->>'amount' IS DISTINCT FROM i.parameters->>'amount' OR (p->>'allowance')::numeric<(i.parameters->>'amount')::numeric THEN PERFORM fail('ORIGINAL_APPROVAL_REQUIRED');END IF;
 UPDATE wallet_attempts SET confirmed=true,proof=p,revision=revision+1 WHERE ns=n AND intent=i.id AND kind='approve' AND NOT confirmed;RETURN jsonb_build_object('approvalReady',true,'funded',false);END $$;

-- Fresh authority signature admission; direct browser/gateway roles have no grant.
CREATE FUNCTION c1_runtime_internal.business_admission_material(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_live_private,c1_runtime_private,c1_private,pg_temp AS $$
DECLARE i c1_live_private.intents;t c1_live_private.stores;g grants;a authorizations;role_name text;next_nonce numeric;BEGIN
 PERFORM check_open(n,q->'ticket');PERFORM base_guard(n,true,NULL);SELECT * INTO i FROM c1_live_private.intents WHERE ns=n AND id=(q->>'id')::uuid;t=c1_live_private.store(n,i.store);
 role_name=CASE i.action WHEN 'fund' THEN 'quoteAuthority' WHEN 'issue' THEN 'issuerAuthority' WHEN 'lock' THEN 'operatorAuthority' WHEN 'markHandover' THEN 'operatorAuthority' WHEN 'report' THEN 'operatorAuthority' ELSE NULL END;
 SELECT * INTO g FROM grants WHERE ns=n AND id=q->>'grantId' AND role=role_name AND system_account=t.profile->'binding'->>role_name;
 IF g.id IS NULL OR NOT EXISTS(SELECT 1 FROM principals WHERE ns=n AND login_name=session_user AND role=role_name AND system_account=g.system_account AND chain_id=g.chain_id) THEN PERFORM c1_private.fail('PRIVATE_BUSINESS_ROLE_REQUIRED');END IF;
 SELECT * INTO a FROM authorizations WHERE kind=CASE WHEN i.action='fund' THEN 'quote' ELSE 'operation' END AND original_id=i.op_id AND ns=n;
 SELECT coalesce(max(nonce)+1,0) INTO next_nonce FROM authorizations WHERE chain_id=g.chain_id AND system_account=g.system_account;
 RETURN jsonb_build_object('intent',to_jsonb(i),'store',to_jsonb(t),'approval',a.approval,'nextNonce',next_nonce::text,'grant',jsonb_build_object('id',g.id,'revision',g.revision,'enabled',g.enabled,'expiresAt',g.expires_at,'signatureUnits',g.signature_cap::text,'gasUnits',g.gas_cap::text));END $$;
CREATE FUNCTION c1_runtime_internal.business_admit(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_live_private,c1_runtime_private,c1_private,pg_temp AS $$
DECLARE m jsonb;approval jsonb=q->'approval';record jsonb=approval->'original';i c1_live_private.intents;t c1_live_private.stores;g grants;nonce_value numeric;kind_name text;BEGIN
 PERFORM check_open(n,q->'ticket');m=c1_runtime_internal.business_admission_material(n,q);SELECT * INTO i FROM c1_live_private.intents WHERE ns=n AND id=(q->>'id')::uuid FOR UPDATE;t=c1_live_private.store(n,i.store,true);
 IF m->>'approval' IS NOT NULL THEN IF m->'approval' IS DISTINCT FROM approval THEN PERFORM c1_private.fail('ORIGINAL_APPROVAL_CONFLICT');END IF;RETURN jsonb_build_object('admitted',true,'replay',true);END IF;
 PERFORM c1_private.auth(n,jsonb_build_object('session_hash',i.session_hash,'csrf_hash',i.csrf_hash),true);
 IF i.identity_revision<>(SELECT identity_revision FROM c1_private.sessions WHERE ns=n AND hash=c1_private.h(i.session_hash)) OR i.credential_epoch<>(SELECT credential_epoch FROM c1_private.deployment WHERE ns=n) OR i.revision IS DISTINCT FROM (q->>'expectedRevision')::bigint OR i.stage<>'ACCEPTED' OR i.private_record IS NOT NULL OR record->>'namespace' IS DISTINCT FROM n OR record->'binding' IS DISTINCT FROM t.profile->'binding' OR approval->'grant' IS DISTINCT FROM m->'grant' OR approval->'profile'->'binding' IS DISTINCT FROM record->'binding' OR approval->'profile'->>'escrowCodeHash' IS DISTINCT FROM record->>'escrowCodeHash' OR approval->'profile'->>'chainProfileDigest' IS DISTINCT FROM record->>'chainProfileDigest' THEN PERFORM c1_private.fail('CURRENT_ORIGINAL_APPROVAL_REQUIRED');END IF;
 IF i.action='fund' THEN
  kind_name='quote';IF record->>'quoteId' IS DISTINCT FROM i.op_id OR record->'quote' IS DISTINCT FROM ((i.parameters-'opId')||jsonb_build_object('quoteId',i.op_id)) THEN PERFORM c1_private.fail('ORIGINAL_QUOTE_REQUIRED');END IF;
 ELSE
  kind_name='operation';IF record->>'opId' IS DISTINCT FROM i.op_id OR record->>'operation' IS DISTINCT FROM i.action OR record->'parameters' IS DISTINCT FROM i.parameters THEN PERFORM c1_private.fail('ORIGINAL_OPERATION_REQUIRED');END IF;
  nonce_value=(record->'transaction'->>'nonce')::numeric;IF nonce_value<>greatest((q->>'observedNonce')::numeric,(m->>'nextNonce')::numeric) THEN PERFORM c1_private.fail('APPROVED_NONCE_REQUIRED');END IF;
 END IF;
 SELECT * INTO g FROM grants WHERE id=q->>'grantId' FOR UPDATE;
 IF q->'initialRow'->'original' IS DISTINCT FROM record OR q->'initialRow'->'reservation' IS DISTINCT FROM m->'grant' THEN PERFORM c1_private.fail('ORIGINAL_INITIAL_ROW_REQUIRED');END IF;
 INSERT INTO authorizations VALUES(kind_name,g.chain_id,t.profile->'binding'->>'escrow',i.op_id,n,1,true,g.role,g.system_account,nonce_value,g.id,g.revision,record,q->'initialRow',approval);
 UPDATE c1_live_private.intents SET private_record=record,stage='UNKNOWN',revision=revision+1 WHERE ns=n AND id=i.id;
 RETURN jsonb_build_object('admitted',true);END $$;

-- Owner roles are never inherited by API/observer/authority application logins.
ALTER FUNCTION c1_runtime_internal.live_api(text,jsonb) OWNER TO c1_live_code_owner;
ALTER FUNCTION c1_runtime_internal.live_material(text,jsonb) OWNER TO c1_runtime_code_owner;
ALTER FUNCTION c1_runtime_internal.live_result(text,jsonb) OWNER TO c1_runtime_code_owner;
ALTER FUNCTION c1_runtime_internal.live_projection(text,jsonb) OWNER TO c1_runtime_code_owner;
ALTER FUNCTION c1_runtime_internal.live_approval(text,jsonb) OWNER TO c1_runtime_code_owner;
ALTER FUNCTION c1_runtime_internal.business_admission_material(text,jsonb) OWNER TO c1_runtime_policy_owner;
ALTER FUNCTION c1_runtime_internal.business_admit(text,jsonb) OWNER TO c1_runtime_policy_owner;
GRANT UPDATE ON c1_live_private.intents TO c1_runtime_policy_owner;
GRANT USAGE ON SCHEMA c1_private TO c1_runtime_policy_owner;
GRANT EXECUTE ON FUNCTION c1_private.auth(text,jsonb,boolean),c1_private.h(text),c1_runtime_private.check_open(text,jsonb),c1_runtime_private.base_guard(text,boolean,uuid) TO c1_runtime_policy_owner,c1_runtime_code_owner;
DO $$ DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure sig FROM pg_proc p WHERE p.pronamespace='c1_live_private'::regnamespace LOOP EXECUTE format('ALTER FUNCTION %s OWNER TO c1_live_code_owner',f.sig);END LOOP;END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA c1_live_private FROM PUBLIC;
REVOKE ALL ON FUNCTION c1_runtime_private.material(text),c1_runtime_private.floors(text),c1_runtime_internal.live_api(text,jsonb),c1_runtime_internal.live_material(text,jsonb),c1_runtime_internal.live_result(text,jsonb),c1_runtime_internal.live_projection(text,jsonb),c1_runtime_internal.live_approval(text,jsonb),c1_runtime_internal.business_admission_material(text,jsonb),c1_runtime_internal.business_admit(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA c1_live_private TO c1_runtime_code_owner,c1_runtime_policy_owner;
GRANT USAGE ON SCHEMA c1_runtime_internal TO c1_live_api,c1_live_observer,c1_business_private;
GRANT EXECUTE ON FUNCTION c1_runtime_internal.ledger_open(text,jsonb),c1_runtime_internal.ledger_seal(text,jsonb) TO c1_live_api,c1_live_observer;
GRANT EXECUTE ON FUNCTION c1_runtime_internal.live_api(text,jsonb) TO c1_live_api;
GRANT EXECUTE ON FUNCTION c1_runtime_internal.live_material(text,jsonb),c1_runtime_internal.live_result(text,jsonb),c1_runtime_internal.live_projection(text,jsonb),c1_runtime_internal.live_approval(text,jsonb) TO c1_live_observer;
GRANT EXECUTE ON FUNCTION c1_runtime_internal.business_admission_material(text,jsonb),c1_runtime_internal.business_admit(text,jsonb) TO c1_business_private;

CREATE FUNCTION c1_runtime_internal.business_fence(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_live_private,c1_runtime_private,c1_private,pg_temp AS $$
DECLARE m jsonb;i c1_live_private.intents;a authorizations;g grants;r attempts;s c1_private.sessions;t c1_live_private.stores;BEGIN
 PERFORM check_open(n,q->'ticket');m=c1_runtime_internal.business_admission_material(n,q);SELECT * INTO i FROM c1_live_private.intents WHERE ns=n AND id=(q->>'id')::uuid;t=c1_live_private.store(n,i.store,true);
 SELECT * INTO a FROM authorizations WHERE ns=n AND original_id=i.op_id AND kind='operation';SELECT * INTO g FROM grants WHERE id=a.grant_id;SELECT * INTO r FROM attempts WHERE ns=n AND original_id=i.op_id AND kind='operation';
 IF i.private_record IS DISTINCT FROM q->'record' OR a.approval->'original' IS DISTINCT FROM i.private_record OR NOT g.enabled OR g.revision<>a.grant_revision OR g.expires_at<=(SELECT dep.now FROM c1_private.deployment dep WHERE dep.ns=n) OR r.payload->>'stage' IS DISTINCT FROM 'BROADCAST_UNKNOWN' OR r.payload->>'transactionHash' IS NULL OR r.payload->>'raw' IS NULL THEN PERFORM c1_private.fail('ORIGINAL_BROADCAST_FENCE_REQUIRED');END IF;
 s=c1_private.auth(n,jsonb_build_object('session_hash',i.session_hash,'csrf_hash',i.csrf_hash),true);IF i.action<>'issue' THEN PERFORM c1_live_private.owner(n,t,s);END IF;
 RETURN jsonb_build_object('matched',true);END $$;
ALTER FUNCTION c1_runtime_internal.business_fence(text,jsonb) OWNER TO c1_runtime_policy_owner;
REVOKE ALL ON FUNCTION c1_runtime_internal.business_fence(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION c1_runtime_internal.business_fence(text,jsonb) TO c1_business_private;

CREATE FUNCTION c1_live_private.authority_reservation_binding() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_live_private,c1_private,pg_temp AS $$
DECLARE i intents;t stores;s c1_private.sessions;b c1_private.verified_owner_bindings;BEGIN
 IF NEW.kind NOT IN('quote','operation') THEN RETURN NEW;END IF;
 SELECT * INTO i FROM intents WHERE ns=NEW.ns AND private_record=NEW.original;
 IF i.id IS NULL THEN PERFORM fail('DURABLE_BUSINESS_INTENT_REQUIRED');END IF;t=c1_live_private.store(NEW.ns,i.store,true);
 s=c1_private.auth(NEW.ns,jsonb_build_object('session_hash',i.session_hash,'csrf_hash',i.csrf_hash),true);
 IF i.identity_revision<>s.identity_revision OR i.credential_epoch<>s.epoch THEN PERFORM fail('ORIGINAL_IDENTITY_CHANGED');END IF;
 IF i.action='fund' THEN SELECT * INTO b FROM c1_private.verified_owner_bindings WHERE ns=NEW.ns AND subject=s.subject;
 IF NOT coalesce(b.enabled,false) OR b.owner IS DISTINCT FROM i.parameters->>'payer' OR b.verified_until<=(SELECT now FROM c1_private.deployment WHERE ns=NEW.ns) THEN PERFORM fail('PAYER_BINDING_CHANGED');END IF;
 ELSIF i.action<>'issue' THEN PERFORM c1_live_private.owner(NEW.ns,t,s);END IF;RETURN NEW;END $$;
ALTER FUNCTION c1_live_private.authority_reservation_binding() OWNER TO c1_live_code_owner;
REVOKE ALL ON FUNCTION c1_live_private.authority_reservation_binding() FROM PUBLIC;
CREATE TRIGGER live_authority_reservation BEFORE INSERT ON c1_runtime_private.reservations FOR EACH ROW EXECUTE FUNCTION c1_live_private.authority_reservation_binding();

GRANT SELECT ON c1_runtime_private.attempts TO c1_runtime_policy_owner;

