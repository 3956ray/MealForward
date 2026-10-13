-- Ordinary onboarding source only. Not applied or PostgreSQL-validated in this slice.
SET ROLE c1_table_owner;
CREATE TABLE c1_private.verified_owner_bindings(
 ns text,subject text,owner text NOT NULL CHECK(owner~'^0x[0-9a-f]{40}$'),
 revision bigint NOT NULL CHECK(revision>0),enabled boolean NOT NULL DEFAULT false,
 identity_source text NOT NULL CHECK(identity_source='VERIFIED_EXTERNAL'),
 owner_kind text NOT NULL CHECK(owner_kind IN('EOA','SMART_WALLET')),
 identity_evidence c1_private.digest32 NOT NULL,wallet_evidence c1_private.digest32 NOT NULL,
 identity_revision bigint NOT NULL,credential_epoch bigint NOT NULL,verified_until bigint NOT NULL,
 PRIMARY KEY(ns,subject),FOREIGN KEY(ns,subject) REFERENCES c1_private.identities(ns,subject));
CREATE TABLE c1_private.registration_images(
 ns text,subject text,id text CHECK(id~'^0x[0-9a-f]{64}$'),image bytea NOT NULL,
 image_digest c1_private.digest32 NOT NULL,idem text NOT NULL,PRIMARY KEY(ns,subject,id),UNIQUE(ns,subject,idem),
 FOREIGN KEY(ns,subject) REFERENCES c1_private.identities(ns,subject),
 CHECK(octet_length(image) BETWEEN 1 AND 8388608));
CREATE TABLE c1_private.store_registrations(
 ns text,subject text,id text CHECK(id~'^0x[0-9a-f]{64}$'),store_id text NOT NULL,
 chain_id text NOT NULL,factory text NOT NULL,idem text NOT NULL,request_digest text NOT NULL,
 state text NOT NULL CHECK(state IN('DRAFT','PENDING','UNKNOWN','CONFIRMED')),
 record jsonb NOT NULL,PRIMARY KEY(ns,id),UNIQUE(ns,subject,idem),
 UNIQUE(chain_id,factory,id),UNIQUE(chain_id,factory,store_id),
 FOREIGN KEY(ns,subject) REFERENCES c1_private.identities(ns,subject));
CREATE TABLE c1_private.registration_factory_capacity(
 chain_id text,factory text,profile jsonb NOT NULL,observed_count integer NOT NULL CHECK(observed_count BETWEEN 0 AND 3),
 observed_at bigint NOT NULL,block_hash c1_private.digest32 NOT NULL,PRIMARY KEY(chain_id,factory));
CREATE TABLE c1_private.registration_slots(
 chain_id text,factory text,id text,ns text,PRIMARY KEY(chain_id,factory,id),UNIQUE(ns,id),
 FOREIGN KEY(ns,id) REFERENCES c1_private.store_registrations(ns,id));
CREATE TABLE c1_private.registration_outbox(
 chain_id text,factory text,id text,ns text,record jsonb NOT NULL,
 PRIMARY KEY(chain_id,factory,id),FOREIGN KEY(ns,id) REFERENCES c1_private.store_registrations(ns,id));
CREATE TABLE c1_private.confirmed_store_registrations(
 ns text,store text,id text,escrow text NOT NULL,evidence jsonb NOT NULL,
 catalog jsonb NOT NULL,public_store text GENERATED ALWAYS AS (substring(store FROM 3)) STORED,public_meal text GENERATED ALWAYS AS (substring(catalog->0->'terms'->>'mealId' FROM 3)) STORED,PRIMARY KEY(ns,store),UNIQUE(ns,id),
 FOREIGN KEY(ns,id) REFERENCES c1_private.store_registrations(ns,id));
CREATE TABLE c1_private.wallet_envelopes(
 ns text,intent uuid,kind text CHECK(kind IN('fund','settle')),material jsonb NOT NULL,
 PRIMARY KEY(ns,intent),FOREIGN KEY(ns,intent) REFERENCES c1_private.intents(ns,id));
CREATE TABLE c1_private.wallet_attempts(ns text,intent uuid,kind text CHECK(kind IN('approve','fund','settle')),PRIMARY KEY(ns,intent,kind),FOREIGN KEY(ns,intent) REFERENCES c1_private.intents(ns,id));
CREATE TABLE c1_private.wallet_transaction_locators(
 ns text,intent uuid,kind text CHECK(kind IN('approve','fund','settle')),hash text NOT NULL,
 PRIMARY KEY(ns,intent,kind),FOREIGN KEY(ns,intent) REFERENCES c1_private.intents(ns,id));
RESET ROLE;
GRANT SELECT,INSERT,UPDATE ON c1_private.verified_owner_bindings,c1_private.registration_images,
 c1_private.store_registrations,c1_private.registration_factory_capacity,c1_private.registration_slots,
 c1_private.registration_outbox,c1_private.confirmed_store_registrations,
 c1_private.wallet_envelopes,c1_private.wallet_attempts,c1_private.wallet_transaction_locators TO c1_api_code_owner,c1_auth_code_owner;

CREATE FUNCTION c1_api.onboarding_authorize(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_private,pg_temp AS $$
DECLARE d c1_private.deployment;s c1_private.sessions;b c1_private.verified_owner_bindings;BEGIN
 IF coalesce((q->>'readOnly')::boolean,false) THEN SELECT * INTO d FROM c1_private.deployment WHERE ns=n;IF d.halt OR d.now<d.clock_floor OR d.now-d.heartbeat>30 OR EXISTS(SELECT 1 FROM c1_private.transaction_guard WHERE ns=n AND (security_pending IS NOT NULL OR execution_pending IS NOT NULL)) THEN PERFORM c1_private.fail('UNAVAILABLE');END IF;ELSE d=c1_private.guard(n,q->>'action'<>'read');END IF;s=c1_private.auth(n,q,q->>'action'<>'read');
 IF coalesce((q->>'readOnly')::boolean,false) THEN SELECT * INTO b FROM c1_private.verified_owner_bindings WHERE ns=n AND subject=s.subject;ELSE SELECT * INTO b FROM c1_private.verified_owner_bindings WHERE ns=n AND subject=s.subject FOR SHARE;END IF;
 IF NOT FOUND OR NOT b.enabled OR b.identity_revision<>s.identity_revision OR b.credential_epoch<>d.credential_epoch OR b.verified_until<=d.now THEN PERFORM c1_private.fail('REAL_IDENTITY_BINDING_REQUIRED');END IF;
 RETURN jsonb_build_object('subject',b.subject,'owner',b.owner,'bindingRevision',b.revision,'ownerKind',b.owner_kind,'now',d.now);END $$;
CREATE FUNCTION c1_api.onboarding_get_by_key(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_private,pg_temp AS $$
DECLARE s c1_private.sessions;r c1_private.store_registrations;BEGIN s=c1_private.auth(n,q);IF coalesce((q->>'readOnly')::boolean,false) THEN SELECT * INTO r FROM c1_private.store_registrations WHERE ns=n AND subject=s.subject AND idem=q->>'key';ELSE PERFORM pg_advisory_xact_lock(hashtextextended(jsonb_build_array(n,s.subject,q->>'key')::text,0));SELECT * INTO r FROM c1_private.store_registrations WHERE ns=n AND subject=s.subject AND idem=q->>'key' FOR UPDATE;END IF;RETURN jsonb_build_object('record',r.record);END $$;
CREATE FUNCTION c1_api.onboarding_get_by_id(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_private,pg_temp AS $$
DECLARE s c1_private.sessions;r c1_private.store_registrations;BEGIN s=c1_private.auth(n,q);IF coalesce((q->>'readOnly')::boolean,false) THEN SELECT * INTO r FROM c1_private.store_registrations WHERE ns=n AND subject=s.subject AND id=q->>'id';ELSE SELECT * INTO r FROM c1_private.store_registrations WHERE ns=n AND subject=s.subject AND id=q->>'id' FOR UPDATE;END IF;RETURN jsonb_build_object('record',r.record);END $$;
CREATE FUNCTION c1_api.onboarding_insert(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_private,pg_temp AS $$
DECLARE a jsonb;r jsonb=q->'record';p jsonb;BEGIN
 a=c1_api.onboarding_authorize(n,q||jsonb_build_object('action','register'));
 IF r->>'namespace'<>n OR r->>'subject'<>a->>'subject' OR r->>'owner'<>a->>'owner' OR r->>'bindingRevision'<>a->>'bindingRevision' OR r->>'state'<>'DRAFT' OR r ? 'ownerSignature' OR r ? 'verifiedEvidence' THEN PERFORM c1_private.fail('ORIGINAL_RECORD_MISMATCH');END IF;
 SELECT profile INTO p FROM c1_private.registration_factory_capacity WHERE chain_id=r->'original'->>'chainId' AND factory=r->'original'->>'factory';
 IF NOT FOUND OR EXISTS(SELECT 1 FROM jsonb_each_text(p) v WHERE r->'original'->>v.key IS DISTINCT FROM v.value) THEN PERFORM c1_private.fail('NOT_CONFIGURED');END IF;
 IF (r->'original'->>'deadline')::numeric<=(a->>'now')::numeric OR (r->'original'->>'deadline')::numeric>(a->>'now')::numeric+900 THEN PERFORM c1_private.fail('INVALID_DEADLINE');END IF;
 IF (SELECT count(*) FROM c1_private.store_registrations WHERE ns=n AND subject=a->>'subject' AND state='DRAFT')>=10 THEN PERFORM c1_private.fail('QUEUE_FULL');END IF;
 INSERT INTO c1_private.store_registrations VALUES(n,a->>'subject',r->>'registrationId',r->>'storeId',r->'original'->>'chainId',r->'original'->>'factory',r->>'key',r->>'requestDigest','DRAFT',r);RETURN jsonb_build_object('saved',true);END $$;
CREATE FUNCTION c1_api.onboarding_save(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_private,pg_temp AS $$
DECLARE a jsonb;old c1_private.store_registrations;r jsonb=q->'record';BEGIN
 a=c1_api.onboarding_authorize(n,q||jsonb_build_object('action','enable'));
 SELECT * INTO old FROM c1_private.store_registrations WHERE ns=n AND id=r->>'registrationId' AND subject=a->>'subject' FOR UPDATE;
 IF NOT FOUND OR old.state<>'DRAFT' OR r->>'state'<>'PENDING' OR (old.record-'state') IS DISTINCT FROM (r-'state'-'ownerSignature'-'deployment') OR r->>'owner'<>a->>'owner' OR r->>'bindingRevision'<>a->>'bindingRevision' OR r->>'ownerSignature' IS NULL OR r->'deployment' IS NULL THEN PERFORM c1_private.fail('ORIGINAL_RECORD_MISMATCH');END IF;
 IF NOT EXISTS(SELECT 1 FROM c1_private.registration_slots WHERE ns=n AND id=old.id) THEN PERFORM c1_private.fail('SLOT_REQUIRED');END IF;
 UPDATE c1_private.store_registrations SET record=r,state='PENDING' WHERE ns=n AND id=old.id;RETURN jsonb_build_object('saved',true);END $$;
CREATE FUNCTION c1_api.onboarding_reserve_slot(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_private,pg_temp AS $$
DECLARE a jsonb;r c1_private.store_registrations;c c1_private.registration_factory_capacity;used integer;known integer;BEGIN
 a=c1_api.onboarding_authorize(n,q||jsonb_build_object('action','enable'));
 SELECT * INTO r FROM c1_private.store_registrations WHERE ns=n AND id=q->>'id' AND subject=a->>'subject' FOR UPDATE;
 IF NOT FOUND OR r.state<>'DRAFT' THEN PERFORM c1_private.fail('NOT_FOUND');END IF;
 SELECT * INTO c FROM c1_private.registration_factory_capacity WHERE chain_id=r.chain_id AND factory=r.factory FOR UPDATE;
 IF NOT FOUND OR c.observed_at<(a->>'now')::bigint-30 OR c.observed_at>(a->>'now')::bigint+2 THEN PERFORM c1_private.fail('CAPACITY_OBSERVATION_REQUIRED');END IF;
 IF EXISTS(SELECT 1 FROM c1_private.registration_slots WHERE chain_id=r.chain_id AND factory=r.factory AND id=r.id) THEN RETURN jsonb_build_object('reserved',true);END IF;
 SELECT count(*) INTO used FROM c1_private.registration_slots WHERE chain_id=r.chain_id AND factory=r.factory;
 SELECT count(*) INTO known FROM c1_private.store_registrations WHERE chain_id=r.chain_id AND factory=r.factory AND state='CONFIRMED';
 IF used+greatest(0,c.observed_count-known)>=3 THEN PERFORM c1_private.fail('FACTORY_CAPACITY');END IF;
 INSERT INTO c1_private.registration_slots VALUES(r.chain_id,r.factory,r.id,n);RETURN jsonb_build_object('reserved',true);END $$;
CREATE FUNCTION c1_api.onboarding_enqueue(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_private,pg_temp AS $$
DECLARE a jsonb;r c1_private.store_registrations;BEGIN a=c1_api.onboarding_authorize(n,q||jsonb_build_object('action','enable'));SELECT * INTO r FROM c1_private.store_registrations WHERE ns=n AND id=q->>'id' AND subject=a->>'subject' FOR UPDATE;IF NOT FOUND OR r.state<>'PENDING' THEN PERFORM c1_private.fail('INVALID_STATE');END IF;INSERT INTO c1_private.registration_outbox VALUES(r.chain_id,r.factory,r.id,n,r.record) ON CONFLICT DO NOTHING;RETURN jsonb_build_object('queued',true);END $$;
CREATE FUNCTION c1_api.onboarding_image_save(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_private,pg_temp AS $$
DECLARE a jsonb;old c1_private.registration_images;BEGIN a=c1_api.onboarding_authorize(n,q||jsonb_build_object('action','register'));SELECT * INTO old FROM c1_private.registration_images WHERE ns=n AND subject=a->>'subject' AND idem=q->>'key';IF FOUND THEN IF old.image_digest IS DISTINCT FROM c1_private.h(q->>'imageDigest') OR old.image IS DISTINCT FROM decode(q->>'image','base64') THEN PERFORM c1_private.fail('IDEMPOTENCY_CONFLICT');END IF;RETURN jsonb_build_object('imageRef',old.id);END IF;IF (SELECT count(*) FROM c1_private.registration_images WHERE ns=n AND subject=a->>'subject')>=10 THEN PERFORM c1_private.fail('QUEUE_FULL');END IF;INSERT INTO c1_private.registration_images VALUES(n,a->>'subject',q->>'id',decode(q->>'image','base64'),c1_private.h(q->>'imageDigest'),q->>'key');RETURN jsonb_build_object('imageRef',q->>'id');END $$;
CREATE FUNCTION c1_api.onboarding_image_get(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_private,pg_temp AS $$
DECLARE s c1_private.sessions;r c1_private.registration_images;BEGIN s=c1_private.auth(n,q);SELECT * INTO r FROM c1_private.registration_images WHERE ns=n AND subject=s.subject AND id=q->>'imageRef';IF NOT FOUND THEN PERFORM c1_private.fail('NOT_FOUND');END IF;RETURN jsonb_build_object('imageDigest','0x'||encode(r.image_digest,'hex'));END $$;
CREATE FUNCTION c1_api.wallet_material(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_private,pg_temp AS $$
DECLARE a jsonb;i c1_private.intents;m jsonb;BEGIN
 a=c1_api.onboarding_authorize(n,q||jsonb_build_object('action','read'));
 SELECT * INTO i FROM c1_private.intents WHERE ns=n AND id=(q->>'id')::uuid;
 IF NOT FOUND THEN PERFORM c1_private.fail('NOT_FOUND');END IF;
 IF i.action='fund' AND i.principal<>a->>'subject' THEN PERFORM c1_private.fail('NOT_FOUND');ELSIF i.action='settle' THEN PERFORM c1_private.owner_auth(n,c1_private.auth(n,q),i.payload->>'store','payout');ELSIF i.action<>'fund' THEN PERFORM c1_private.fail('NOT_FOUND');END IF;
 IF i.stage<>'WAIT_ACTOR' OR NOT EXISTS(SELECT 1 FROM c1_private.confirmed_store_registrations WHERE ns=n AND store=i.payload->>'store') THEN PERFORM c1_private.fail('NOT_CONFIGURED');END IF;
 SELECT material INTO m FROM c1_private.wallet_envelopes WHERE ns=n AND intent=i.id AND kind=i.action;
 IF NOT FOUND OR m->>'expectedAccount'<>a->>'owner' THEN PERFORM c1_private.fail('NOT_CONFIGURED');END IF;
 RETURN jsonb_build_object('material',m,'now',a->'now');END $$;
CREATE FUNCTION c1_api.wallet_attempt_begin(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_private,pg_temp AS $$
DECLARE m jsonb;BEGIN PERFORM c1_private.guard(n,true);m=c1_api.wallet_material(n,q);PERFORM c1_private.auth(n,q,true);
 IF q->>'kind' NOT IN('approve','fund','settle') OR (q->>'kind'='settle' AND m->'material'->>'kind'<>'settle') OR (q->>'kind' IN('approve','fund') AND m->'material'->>'kind'<>'fund') THEN PERFORM c1_private.fail('INVALID_REQUEST');END IF;
 IF EXISTS(SELECT 1 FROM c1_private.wallet_attempts WHERE ns=n AND intent=(q->>'id')::uuid AND kind=q->>'kind') THEN PERFORM c1_private.fail('ORIGINAL_ATTEMPT_UNKNOWN');END IF;
 INSERT INTO c1_private.wallet_attempts VALUES(n,(q->>'id')::uuid,q->>'kind');RETURN jsonb_build_object('status','UNKNOWN','attemptRetained',true);END $$;
CREATE FUNCTION c1_api.wallet_transaction_observe(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_private,pg_temp AS $$
DECLARE m jsonb;old text;BEGIN m=c1_api.wallet_material(n,q);PERFORM c1_private.auth(n,q,true);IF q->>'kind' NOT IN('approve','fund','settle') OR q->>'hash'!~'^0x[0-9a-f]{64}$' OR (q->>'kind'='settle' AND m->'material'->>'kind'<>'settle') OR (q->>'kind' IN('approve','fund') AND m->'material'->>'kind'<>'fund') THEN PERFORM c1_private.fail('INVALID_REQUEST');END IF;IF NOT EXISTS(SELECT 1 FROM c1_private.wallet_attempts WHERE ns=n AND intent=(q->>'id')::uuid AND kind=q->>'kind') THEN PERFORM c1_private.fail('ORIGINAL_ATTEMPT_REQUIRED');END IF;SELECT hash INTO old FROM c1_private.wallet_transaction_locators WHERE ns=n AND intent=(q->>'id')::uuid AND kind=q->>'kind' FOR UPDATE;IF FOUND AND old<>q->>'hash' THEN PERFORM c1_private.fail('ORIGINAL_TRANSACTION_CONFLICT');END IF;INSERT INTO c1_private.wallet_transaction_locators VALUES(n,(q->>'id')::uuid,q->>'kind',q->>'hash') ON CONFLICT DO NOTHING;RETURN jsonb_build_object('status','PENDING','transactionHash',q->>'hash','authority','OBSERVATION_ONLY');END $$;

CREATE FUNCTION c1_api.onboarding_public_catalog(n text,q jsonb) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,c1_private,pg_temp AS $$
 SELECT jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object('registrationId',c.id,'id',c.public_store,'storeId',c.public_store,'chainStoreId',c.store,'mealId',c.public_meal,'name',r.record->'request'->>'name','escrow',c.escrow,'firstMeal',jsonb_build_object('name',r.record->'request'->'firstMeal'->>'name','description',r.record->'request'->'firstMeal'->>'description','unitPrice',r.record->'request'->'firstMeal'->>'unitPrice','windows',r.record->'request'->'firstMeal'->'windows','imageDigest','0x'||encode(im.image_digest,'hex'))) ORDER BY c.store),'[]'::jsonb)) FROM c1_private.confirmed_store_registrations c JOIN c1_private.store_registrations r ON r.ns=c.ns AND r.id=c.id JOIN c1_private.registration_images im ON im.ns=r.ns AND im.subject=r.subject AND im.id=r.record->'request'->'firstMeal'->>'imageRef' WHERE c.ns=n AND r.state='CONFIRMED'; $$;
CREATE FUNCTION c1_api.onboarding_public_image(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,c1_private,pg_temp AS $$
DECLARE data bytea;BEGIN SELECT im.image INTO data FROM c1_private.confirmed_store_registrations c JOIN c1_private.store_registrations r ON r.ns=c.ns AND r.id=c.id JOIN c1_private.registration_images im ON im.ns=r.ns AND im.subject=r.subject AND im.id=r.record->'request'->'firstMeal'->>'imageRef' WHERE c.ns=n AND r.state='CONFIRMED' AND '0x'||encode(im.image_digest,'hex')=q->>'digest' LIMIT 1;IF NOT FOUND THEN PERFORM c1_private.fail('NOT_FOUND');END IF;RETURN jsonb_build_object('image',encode(data,'base64'));END $$;

-- No browser/API role can acquire these observer or verified-identity operations.
CREATE SCHEMA c1_onboarding_internal AUTHORIZATION c1_auth_code_owner;
REVOKE ALL ON SCHEMA c1_onboarding_internal FROM PUBLIC;
GRANT USAGE ON SCHEMA c1_private TO c1_auth_code_owner;
CREATE FUNCTION c1_onboarding_internal.registration_get(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_private,pg_temp AS $$ DECLARE r jsonb;BEGIN IF NOT coalesce((q->>'readOnly')::boolean,false) THEN PERFORM c1_private.guard(n);SELECT record INTO r FROM c1_private.store_registrations WHERE ns=n AND id=q->>'id' FOR UPDATE;ELSE SELECT record INTO r FROM c1_private.store_registrations WHERE ns=n AND id=q->>'id';END IF;RETURN jsonb_build_object('record',r);END $$;
CREATE FUNCTION c1_onboarding_internal.registration_save(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_private,pg_temp AS $$
DECLARE old c1_private.store_registrations;r jsonb=q->'record';BEGIN PERFORM c1_private.guard(n,true);SELECT * INTO old FROM c1_private.store_registrations WHERE ns=n AND id=r->>'registrationId' FOR UPDATE;IF NOT FOUND OR (old.record-'state'-'transactionHash'-'escrow'-'verifiedEvidence') IS DISTINCT FROM (r-'state'-'transactionHash'-'escrow'-'verifiedEvidence') OR NOT ((old.state='PENDING' AND r->>'state'='UNKNOWN') OR (old.state='UNKNOWN' AND r->>'state' IN('UNKNOWN','CONFIRMED'))) OR (old.record ? 'transactionHash' AND old.record->>'transactionHash' IS DISTINCT FROM r->>'transactionHash') THEN PERFORM c1_private.fail('ORIGINAL_RECORD_MISMATCH');END IF;IF old.state='PENDING' THEN PERFORM c1_onboarding_internal.registration_authorize(n,jsonb_build_object('id',old.id));END IF;UPDATE c1_private.store_registrations SET record=r,state=r->>'state' WHERE ns=n AND id=old.id;RETURN jsonb_build_object('saved',true);END $$;
CREATE FUNCTION c1_onboarding_internal.registration_publish(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_private,pg_temp AS $$
DECLARE r c1_private.store_registrations;BEGIN PERFORM c1_private.guard(n,true);SELECT * INTO r FROM c1_private.store_registrations WHERE ns=n AND id=q->>'id' FOR UPDATE;IF NOT FOUND OR r.state<>'CONFIRMED' OR r.record->'verifiedEvidence' IS NULL THEN PERFORM c1_private.fail('NOT_CONFIRMED');END IF;
 INSERT INTO c1_private.confirmed_store_registrations(ns,store,id,escrow,evidence,catalog) VALUES(n,r.store_id,r.id,r.record->>'escrow',r.record->'verifiedEvidence',r.record->'original'->'catalog') ON CONFLICT DO NOTHING;
 -- This is a real readiness relation only. Do NOT fabricate synthetic manifest,
 -- balances or terms to enter C1's existing synthetic source/projection.
 RETURN jsonb_build_object('publishedGate',true,'businessProjection','CONFIRMED_MENU_ONLY');END $$;
CREATE FUNCTION c1_onboarding_internal.factory_capacity(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_private,pg_temp AS $$ BEGIN PERFORM c1_private.guard(n,true);INSERT INTO c1_private.registration_factory_capacity VALUES(q->'profile'->>'chainId',q->'profile'->>'factory',q->'profile',(q->>'count')::integer,(q->>'observedAt')::bigint,c1_private.h(q->>'blockHash')) ON CONFLICT(chain_id,factory) DO UPDATE SET observed_count=EXCLUDED.observed_count,observed_at=EXCLUDED.observed_at,block_hash=EXCLUDED.block_hash WHERE c1_private.registration_factory_capacity.profile=EXCLUDED.profile;IF NOT FOUND THEN PERFORM c1_private.fail('IMMUTABLE_FACTORY_PROFILE');END IF;RETURN jsonb_build_object('retained',true);END $$;
CREATE FUNCTION c1_onboarding_internal.registration_authorize(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_private,pg_temp AS $$
DECLARE d c1_private.deployment;r c1_private.store_registrations;b c1_private.verified_owner_bindings;i c1_private.identities;BEGIN
 IF coalesce((q->>'readOnly')::boolean,false) THEN SELECT * INTO d FROM c1_private.deployment WHERE ns=n;ELSE d=c1_private.guard(n,true);END IF;
 IF d.halt OR d.now<d.clock_floor OR d.now-d.heartbeat>30 THEN PERFORM c1_private.fail('UNAVAILABLE');END IF;
 SELECT * INTO r FROM c1_private.store_registrations WHERE ns=n AND id=q->>'id';SELECT * INTO b FROM c1_private.verified_owner_bindings WHERE ns=n AND subject=r.subject;SELECT * INTO i FROM c1_private.identities WHERE ns=n AND subject=r.subject;
 IF r.id IS NULL OR b.subject IS NULL OR NOT b.enabled OR b.owner IS DISTINCT FROM r.record->>'owner' OR b.revision::text IS DISTINCT FROM r.record->>'bindingRevision' OR b.identity_revision<>i.revision OR b.credential_epoch<>d.credential_epoch OR b.verified_until<=d.now THEN PERFORM c1_private.fail('OWNER_BINDING_CHANGED');END IF;
 RETURN jsonb_build_object('subject',b.subject,'owner',b.owner,'bindingRevision',b.revision);END $$;

-- Identity and quote writer composition must be independently verified before
-- any narrowly scoped runtime role is provisioned; no success/binding setter is
-- exposed to the API. No grants to synthetic fixture roles are added.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA c1_onboarding_internal FROM PUBLIC;
GRANT EXECUTE ON FUNCTION c1_api.onboarding_authorize(text,jsonb),c1_api.onboarding_get_by_key(text,jsonb),
 c1_api.onboarding_get_by_id(text,jsonb),c1_api.onboarding_insert(text,jsonb),c1_api.onboarding_save(text,jsonb),
 c1_api.onboarding_reserve_slot(text,jsonb),c1_api.onboarding_enqueue(text,jsonb),c1_api.onboarding_image_save(text,jsonb),
 c1_api.onboarding_image_get(text,jsonb),c1_api.onboarding_public_catalog(text,jsonb),c1_api.onboarding_public_image(text,jsonb),c1_api.wallet_material(text,jsonb),c1_api.wallet_attempt_begin(text,jsonb),c1_api.wallet_transaction_observe(text,jsonb)
 TO c1_api_a,c1_api_b;
REVOKE ALL ON FUNCTION c1_api.onboarding_authorize(text,jsonb),c1_api.onboarding_get_by_key(text,jsonb),
 c1_api.onboarding_get_by_id(text,jsonb),c1_api.onboarding_insert(text,jsonb),c1_api.onboarding_save(text,jsonb),
 c1_api.onboarding_reserve_slot(text,jsonb),c1_api.onboarding_enqueue(text,jsonb),c1_api.onboarding_image_save(text,jsonb),
 c1_api.onboarding_image_get(text,jsonb),c1_api.onboarding_public_catalog(text,jsonb),c1_api.onboarding_public_image(text,jsonb),c1_api.wallet_material(text,jsonb),c1_api.wallet_attempt_begin(text,jsonb),c1_api.wallet_transaction_observe(text,jsonb) FROM PUBLIC;

ALTER FUNCTION c1_onboarding_internal.registration_get(text,jsonb) OWNER TO c1_auth_code_owner;
ALTER FUNCTION c1_onboarding_internal.registration_save(text,jsonb) OWNER TO c1_auth_code_owner;
ALTER FUNCTION c1_onboarding_internal.registration_publish(text,jsonb) OWNER TO c1_auth_code_owner;
ALTER FUNCTION c1_onboarding_internal.registration_authorize(text,jsonb) OWNER TO c1_auth_code_owner;
ALTER FUNCTION c1_onboarding_internal.factory_capacity(text,jsonb) OWNER TO c1_auth_code_owner;

CREATE FUNCTION c1_onboarding_internal.registration_next(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_private,pg_temp AS $$
DECLARE r c1_private.store_registrations;BEGIN SELECT * INTO r FROM c1_private.store_registrations WHERE ns=n AND state IN('PENDING','UNKNOWN') ORDER BY CASE state WHEN 'PENDING' THEN 0 ELSE 1 END,id LIMIT 1;RETURN jsonb_build_object('task',CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object('namespace',n,'registrationId',r.id) END);END $$;
REVOKE ALL ON FUNCTION c1_onboarding_internal.registration_next(text,jsonb) FROM PUBLIC;
ALTER FUNCTION c1_onboarding_internal.registration_next(text,jsonb) OWNER TO c1_auth_code_owner;

CREATE UNIQUE INDEX registration_public_store_unique ON c1_private.confirmed_store_registrations(ns,public_store);
CREATE UNIQUE INDEX registration_public_meal_unique ON c1_private.confirmed_store_registrations(ns,public_store,public_meal);
