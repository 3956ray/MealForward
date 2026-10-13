-- A witness is valid only for the exact persisted MVCC row inspected by the
-- bounded external hash helper. Updating any original byte invalidates it.
SET ROLE c1_table_owner;
CREATE TABLE c1_private.content_verified (
 ns text,store text,meal text,version bigint,row_version text NOT NULL,
 PRIMARY KEY(ns,store,meal,version),
 FOREIGN KEY(ns,store,meal,version) REFERENCES c1_private.terms(ns,store,meal,version)
);
RESET ROLE;
GRANT SELECT,INSERT,UPDATE ON c1_private.content_verified TO c1_api_code_owner,c1_auth_code_owner,c1_projection_code_owner;
CREATE FUNCTION c1_private.content_available(n text,st text,m text,v bigint)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce((SELECT t.available AND w.row_version=t.xmin::text
 FROM c1_private.terms t LEFT JOIN c1_private.content_verified w USING(ns,store,meal,version)
 WHERE t.ns=n AND t.store=st AND t.meal=m AND t.version=v),false)
$$;

CREATE FUNCTION c1_api.content_material(n text,q jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_private,pg_temp AS $$
DECLARE purpose text=q->>'purpose';s c1_private.sessions;r c1_private.reviews;
 i c1_private.intents;u c1_private.units;vc c1_private.vouchers;dc c1_private.display_credentials;
 st text;m text;v bigint;
 result jsonb;j c1_private.outbox;
BEGIN
 IF session_user IN('c1_api_a','c1_api_b') THEN
   s=c1_private.auth(n,q,true);
   -- This shortcut grants no new action or material: the original endpoint
   -- still checks its current object permission and exact idempotent payload.
   IF purpose IN('lock','handover_confirm','settle_confirm','support_confirm','claim_confirm') AND EXISTS(
    SELECT 1 FROM c1_private.intents WHERE ns=n AND principal=s.subject AND idem=q->>'key'
    AND action=CASE purpose WHEN 'lock' THEN 'lock' WHEN 'handover_confirm' THEN 'handover' WHEN 'settle_confirm' THEN 'settle' WHEN 'support_confirm' THEN 'fund' ELSE 'issue' END
   ) THEN RETURN jsonb_build_object('items','[]'::jsonb);END IF;
   IF purpose IN('display','recover') AND EXISTS(SELECT 1 FROM c1_private.security_mutations
    WHERE ns=n AND kind=purpose AND command->>'key'=q->>'key' AND command->>'voucher'=q->>'voucher'
    AND expected->>'subject'=s.subject AND state='COMMITTED') THEN RETURN jsonb_build_object('items','[]'::jsonb);END IF;
   IF purpose IN('support_review','claim_review') THEN
    st=q->>'store';m=q->>'meal';
    IF purpose='support_review' THEN SELECT version INTO v FROM c1_private.catalog_head WHERE ns=n AND store=st AND meal=m;
    ELSE SELECT * INTO u FROM c1_private.units WHERE ns=n AND store=st AND meal=m
     AND (bucket='A' OR (bucket='R' AND expires_at<=(SELECT now FROM c1_private.deployment WHERE ns=n) AND lock_id IS NULL AND marker_id IS NULL)) ORDER BY seq LIMIT 1;v=u.version;END IF;
   ELSIF purpose IN('support_confirm','claim_confirm','settle_confirm') THEN
    SELECT * INTO r FROM c1_private.reviews WHERE ns=n AND id=(q->'client'->>'reviewId')::uuid AND subject=s.subject;
    IF NOT FOUND THEN PERFORM c1_private.fail('NOT_FOUND');END IF;
    st=r.payload->>'store';m=r.payload->>'meal';v=(r.payload->>'version')::bigint;
    IF purpose='settle_confirm' THEN
     PERFORM c1_private.owner_auth(n,s,st,'payout');
     SELECT * INTO u FROM c1_private.units WHERE ns=n AND store=st AND seq=(r.payload->>'seq')::int;m=u.meal;v=u.version;
    END IF;
   ELSIF purpose IN('display','recover') THEN
    vc=c1_private.voucher_auth(n,s,q->>'voucher');
    SELECT * INTO u FROM c1_private.units WHERE ns=n AND store=vc.store AND seq=vc.seq;st=u.store;m=u.meal;v=u.version;
   ELSIF purpose IN('code_check','lock') THEN
    st=q->>'store';PERFORM c1_private.owner_auth(n,s,st,'redeem');
    SELECT * INTO dc FROM c1_private.display_credentials WHERE ns=n AND hash=c1_private.h(q->>'display_hash') AND active;
    SELECT * INTO vc FROM c1_private.vouchers WHERE ns=n AND id=dc.voucher AND store=st;
    IF NOT FOUND THEN PERFORM c1_private.fail('INVALID_CODE');END IF;
    SELECT * INTO u FROM c1_private.units WHERE ns=n AND store=st AND seq=vc.seq;m=u.meal;v=u.version;
   ELSIF purpose IN('handover_confirm','settle_review') THEN
    st=q->>'store';PERFORM c1_private.owner_auth(n,s,st,CASE WHEN purpose='handover_confirm' THEN 'redeem' ELSE 'payout' END);
    SELECT * INTO u FROM c1_private.units WHERE ns=n AND store=st AND ((purpose='handover_confirm' AND lock_id=q->>'case_id') OR (purpose='settle_review' AND voucher_id=q->>'id'));m=u.meal;v=u.version;
   ELSE PERFORM c1_private.fail('FORBIDDEN');END IF;
 ELSIF session_user='c1_controller' AND purpose='audit' THEN st=q->>'store';m=q->>'meal';v=(q->>'version')::bigint;
 ELSIF session_user IN('c1_worker_a','c1_worker_b') AND purpose='stage_job' THEN
  SELECT * INTO j FROM c1_private.outbox WHERE ns=n AND intent=(q->>'job_id')::uuid;
  IF NOT FOUND OR j.worker<>q->>'worker_id' OR j.lease_epoch<>(q->>'fencing_epoch')::bigint THEN PERFORM c1_private.fail('STALE_LEASE');END IF;
  SELECT * INTO i FROM c1_private.intents WHERE ns=n AND id=j.intent;
 ELSIF session_user='c1_controller' AND purpose='stage_actor' THEN
  SELECT * INTO i FROM c1_private.intents WHERE ns=n AND id=(q->>'intent_id')::uuid;
 ELSIF session_user='c1_reconciler' AND purpose='receipt' THEN
  SELECT x.* INTO i FROM c1_private.intents x JOIN c1_private.receipts rc ON rc.ns=x.ns AND rc.op=x.id WHERE x.ns=n AND rc.id=q->>'receipt_id';
  IF i.action<>'publish' THEN RETURN jsonb_build_object('items','[]'::jsonb);END IF;
 ELSE PERFORM c1_private.fail('FORBIDDEN');END IF;
 IF i.id IS NOT NULL THEN
  -- Proven report/expiry and original receipt observation preserve old liability.
  IF i.action NOT IN('fund','issue','publish','lock','handover','settle') THEN RETURN jsonb_build_object('items','[]'::jsonb);END IF;
  st=i.payload->>'store';m=i.payload->>'meal';v=(i.payload->>'version')::bigint;
  IF i.action IN('lock','handover','settle') THEN SELECT * INTO u FROM c1_private.units WHERE ns=n AND store=st AND seq=(i.payload->>'seq')::int;m=u.meal;v=u.version;END IF;
 END IF;
 IF (st IS NULL OR m IS NULL OR v IS NULL) THEN PERFORM c1_private.fail('CONTENT_UNAVAILABLE');END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('store',t.store,'meal',t.meal,'version',t.version,'rowVersion',t.xmin::text,
  'name',encode(t.name,'base64'),'description',encode(t.description,'base64'),'body',encode(t.body,'base64'),'image',encode(t.image,'base64'),
  'bodyDigest','0x'||encode(t.body_digest,'hex'),'imageDigest','0x'||encode(t.image_digest,'hex'),'termsHash','0x'||encode(t.terms_hash,'hex'),
  'price',t.price::text,'windows',t.windows,'scope',d.manifest->'stores'->t.store)),'[]') INTO result
 FROM c1_private.terms t JOIN c1_private.deployment d USING(ns)
 WHERE t.ns=n AND t.available AND t.store=st AND t.meal=m AND t.version=v
 AND NOT c1_private.content_available(n,t.store,t.meal,t.version);
 IF NOT EXISTS(SELECT 1 FROM c1_private.terms WHERE ns=n AND store=st AND meal=m AND version=v AND available) THEN PERFORM c1_private.fail('CONTENT_UNAVAILABLE');END IF;
 RETURN jsonb_build_object('items',result);
END $$;

CREATE FUNCTION c1_api.content_verify(n text,q jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_private,pg_temp AS $$
DECLARE material jsonb;item jsonb;proof jsonb;
BEGIN
 PERFORM c1_private.guard(n);
 material=c1_api.content_material(n,q-'proofs');
 FOR item IN SELECT value FROM jsonb_array_elements(material->'items') LOOP
  SELECT value INTO proof FROM jsonb_array_elements(q->'proofs') WHERE value->>'store'=item->>'store' AND value->>'meal'=item->>'meal' AND value->'version'=item->'version';
  IF proof IS NULL OR proof IS DISTINCT FROM (item-'name'-'description'-'body'-'image'-'price'-'windows'-'scope') THEN PERFORM c1_private.fail('CONTENT_UNAVAILABLE');END IF;
  INSERT INTO c1_private.content_verified VALUES(n,item->>'store',item->>'meal',(item->>'version')::bigint,item->>'rowVersion')
  ON CONFLICT(ns,store,meal,version) DO UPDATE SET row_version=EXCLUDED.row_version;
 END LOOP;
 RETURN jsonb_build_object('verified',true);
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA c1_private FROM PUBLIC;

CREATE OR REPLACE FUNCTION c1_private.term_dto(n text,st text,m text,v bigint) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT jsonb_build_object('store',store,'meal',meal,'version',version,'name',convert_from(name,'UTF8'),'description',convert_from(description,'UTF8'),'price',price::text,'windows',windows,'termsHash','0x'||encode(terms_hash,'hex'),'bodyDigest','0x'||encode(body_digest,'hex'),'imageDigest','0x'||encode(image_digest,'hex'),'available',c1_private.content_available(n,st,m,v)) FROM c1_private.terms WHERE ns=n AND store=st AND meal=m AND version=v $$;
