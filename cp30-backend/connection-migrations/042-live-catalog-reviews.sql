-- Catalog preview only: no authority grant, signing or publication activation.
SET ROLE c1_runtime_table_owner;
CREATE TABLE c1_live_private.catalog_reviews(
 ns text,store text,id uuid,subject text,draft_id text,draft_revision bigint,store_revision bigint,
 payload jsonb NOT NULL,expires bigint NOT NULL,used boolean NOT NULL DEFAULT false,revision bigint NOT NULL DEFAULT 1,
 PRIMARY KEY(ns,id),FOREIGN KEY(ns,store) REFERENCES c1_live_private.stores(ns,store));
RESET ROLE;
GRANT SELECT,INSERT,UPDATE ON c1_live_private.catalog_reviews TO c1_live_code_owner;
GRANT SELECT ON c1_live_private.catalog_reviews TO c1_runtime_code_owner;
ALTER FUNCTION c1_runtime_private.material(text) RENAME TO material_before_catalog_reviews;
CREATE FUNCTION c1_runtime_private.material(n text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,c1_live_private,c1_runtime_private,pg_temp AS $$
 SELECT material_before_catalog_reviews(n)||CASE WHEN EXISTS(SELECT 1 FROM catalog_reviews WHERE ns=n)
 THEN jsonb_build_object('catalogReviews',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM catalog_reviews r WHERE ns=n)) ELSE '{}'::jsonb END $$;
ALTER FUNCTION c1_runtime_private.floors(text) RENAME TO floors_before_catalog_reviews;
CREATE FUNCTION c1_runtime_private.floors(n text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,c1_live_private,c1_runtime_private,pg_temp AS $$
 SELECT floors_before_catalog_reviews(n)||jsonb_build_object('runtime_attempt',(floors_before_catalog_reviews(n)->'runtime_attempt')||
 coalesce((SELECT jsonb_object_agg('catalog-review:'||id,revision) FROM catalog_reviews WHERE ns=n),'{}')) $$;
ALTER FUNCTION c1_runtime_private.material(text) OWNER TO c1_runtime_code_owner;
ALTER FUNCTION c1_runtime_private.floors(text) OWNER TO c1_runtime_code_owner;
REVOKE ALL ON FUNCTION c1_runtime_private.material(text),c1_runtime_private.floors(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION c1_runtime_private.material(text),c1_runtime_private.floors(text) TO c1_runtime_controller_code_owner,c1_live_code_owner;
CREATE FUNCTION c1_live_private.catalog_meal_id(n text,t c1_live_private.stores,draft_id text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN draft_id=t.meal THEN '0x'||t.meal ELSE '0x'||encode(sha256(convert_to('CP30_CATALOG_MEAL_V1:'||n||':'||t.store||':'||draft_id,'UTF8')),'hex') END $$;
ALTER FUNCTION c1_live_private.catalog_meal_id(text,c1_live_private.stores,text) OWNER TO c1_live_code_owner;
REVOKE ALL ON FUNCTION c1_live_private.catalog_meal_id(text,c1_live_private.stores,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION c1_live_private.catalog_meal_id(text,c1_live_private.stores,text) TO c1_runtime_code_owner;
ALTER FUNCTION c1_runtime_internal.live_draft(text,jsonb) RENAME TO live_draft_before_catalog;
CREATE FUNCTION c1_runtime_internal.live_draft(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,c1_live_private,c1_private,pg_temp AS $$
DECLARE s sessions;t stores;d drafts;answer jsonb;meal_id text;version text;now bigint;replay draft_replays;req_hash text;input jsonb=q->'input';p jsonb;w jsonb;
BEGIN
 IF q->>'op' NOT IN('catalog_material','catalog_review') THEN
  answer=c1_runtime_internal.live_draft_before_catalog(n,q);
  IF q->>'op' IN('get','list') THEN
   t=c1_live_private.store(n,q->>'store',false);
   IF q->>'op'='list' THEN SELECT answer||jsonb_build_object('items',coalesce(jsonb_agg(value||jsonb_build_object('draftId',value->>'id','mealId',c1_live_private.catalog_meal_id(n,t,value->>'id'))),'[]')) INTO answer FROM jsonb_array_elements(answer->'items');
   ELSE answer=answer||jsonb_build_object('draftId',answer->>'id','mealId',c1_live_private.catalog_meal_id(n,t,answer->>'id'));END IF;
  END IF;RETURN answer;
 END IF;
 s=c1_live_private.context(n,q,q->>'op'='catalog_review');t=c1_live_private.store(n,q->>'store',true);PERFORM c1_live_private.owner(n,t,s);
 SELECT dep.now INTO now FROM c1_private.deployment dep WHERE ns=n;
 SELECT * INTO d FROM drafts WHERE ns=n AND store=t.store AND meal=q->>'meal';
 IF d.ns IS NULL OR d.image IS NULL THEN PERFORM fail('DRAFT_IMAGE_REQUIRED');END IF;
 IF d.revision IS DISTINCT FROM (q->>'expectedRevision')::bigint THEN PERFORM fail('STALE_REVISION');END IF;
 meal_id=c1_live_private.catalog_meal_id(n,t,d.meal);version=(coalesce((t.snapshot->'menu'->meal_id->>'currentVersion')::numeric,0)+1)::text;
 IF q->>'op'='catalog_material' THEN RETURN jsonb_build_object('draft',jsonb_build_object('body',d.body,'imageDigest',d.image_digest),
 'binding',t.profile->'binding','mealId',meal_id,'version',version,'storeRevision',t.revision,'expectedControlRevision',t.rows->'controls'->>'control_revision');END IF;
 req_hash=encode(sha256(convert_to(jsonb_build_array('catalog_review',d.meal,d.revision)::text,'UTF8')),'hex');
 SELECT * INTO replay FROM draft_replays WHERE ns=n AND store=t.store AND subject=s.subject AND idem=q->>'key';
 IF FOUND THEN IF replay.request_hash IS DISTINCT FROM req_hash THEN PERFORM fail('IDEMPOTENCY_CONFLICT');END IF;RETURN replay.response;END IF;
 IF q->>'key' IS NULL OR q->>'key'!~'^[ -~]{16,128}$' THEN PERFORM fail('INVALID_REQUEST');END IF;
 IF (SELECT count(*) FROM catalog_reviews WHERE ns=n AND store=t.store AND expires>now AND NOT used)>=20 THEN PERFORM fail('QUEUE_FULL');END IF;
 IF t.revision IS DISTINCT FROM (q->>'storeRevision')::bigint OR q->>'expectedControlRevision' IS DISTINCT FROM t.rows->'controls'->>'control_revision' THEN PERFORM fail('STALE_REVIEW');END IF;
 w=d.body->'windows';
 IF input->>'mealId' IS DISTINCT FROM meal_id OR input->>'version' IS DISTINCT FROM version OR input->>'unitPrice' IS DISTINCT FROM d.body->>'price'
 OR input->>'imageDigest' IS DISTINCT FROM '0x'||d.image_digest OR input->>'bodyDigest' IS NULL OR q->>'termsHash' IS NULL OR input->>'bodyDigest'!~'^0x[0-9a-f]{64}$' OR q->>'termsHash'!~'^0x[0-9a-f]{64}$'
 OR (input->>'windowCount')::int IS DISTINCT FROM jsonb_array_length(w)
 OR (input->>'startMinute0')::int IS DISTINCT FROM (w->0->>0)::int OR (input->>'endMinute0')::int IS DISTINCT FROM (w->0->>1)::int
 OR (input->>'startMinute1')::int IS DISTINCT FROM coalesce((w->1->>0)::int,0) OR (input->>'endMinute1')::int IS DISTINCT FROM coalesce((w->1->>1)::int,0)
 THEN PERFORM fail('DRAFT_CATALOG_MISMATCH');END IF;
 p=d.body||jsonb_build_object('draftId',d.meal,'draftRevision',d.revision,'mealId',meal_id,'version',version,'unitPrice',input->>'unitPrice',
 'bodyDigest',input->>'bodyDigest','imageDigest',input->>'imageDigest','termsHash',q->>'termsHash','expectedControlRevision',q->>'expectedControlRevision',
 'collectionTimeZone','Asia/Shanghai','needsListing',version='1','targetListed',version='1' OR coalesce((t.snapshot->'menu'->meal_id->>'listed')::boolean,false),'expiresAt',now+300);
 INSERT INTO catalog_reviews VALUES(n,t.store,(q->>'reviewId')::uuid,s.subject,d.meal,d.revision,t.revision,p||jsonb_build_object('input',input),now+300,false,1);
 answer=jsonb_build_object('reviewId',q->>'reviewId','store',t.store,'review',p);
 INSERT INTO draft_replays VALUES(n,t.store,s.subject,q->>'key',req_hash,answer);RETURN answer;
END $$;
ALTER FUNCTION c1_runtime_internal.live_draft(text,jsonb) OWNER TO c1_live_code_owner;
REVOKE ALL ON FUNCTION c1_runtime_internal.live_draft(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION c1_runtime_internal.live_draft(text,jsonb) TO c1_live_api;
