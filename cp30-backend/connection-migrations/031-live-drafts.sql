-- Private editable content only. No published menu, registration or transaction changes.
SET ROLE c1_runtime_table_owner;
CREATE TABLE c1_live_private.drafts(
 ns text,store text,meal text,revision bigint NOT NULL CHECK(revision>0),
 body jsonb NOT NULL,image bytea,image_digest text,
 PRIMARY KEY(ns,store,meal),FOREIGN KEY(ns,store) REFERENCES c1_live_private.stores(ns,store),
 CHECK(image IS NULL OR octet_length(image)<=8388608),
 CHECK((image IS NULL AND image_digest IS NULL) OR (image IS NOT NULL AND image_digest~'^[0-9a-f]{64}$')));
CREATE TABLE c1_live_private.draft_replays(
 ns text,store text,subject text,idem text,request_hash text NOT NULL,response jsonb NOT NULL,
 PRIMARY KEY(ns,store,subject,idem),FOREIGN KEY(ns,store) REFERENCES c1_live_private.stores(ns,store));
RESET ROLE;
GRANT SELECT,INSERT,UPDATE ON c1_live_private.drafts TO c1_live_code_owner;
GRANT SELECT,INSERT ON c1_live_private.draft_replays TO c1_live_code_owner;
GRANT SELECT ON c1_live_private.drafts,c1_live_private.draft_replays TO c1_runtime_code_owner;

-- Empty tables contribute nothing: installing this forward migration preserves
-- the original runtime material digest and floors until the first sealed write.
ALTER FUNCTION c1_runtime_private.material(text) RENAME TO material_before_drafts;
CREATE FUNCTION c1_runtime_private.material(n text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,c1_live_private,c1_runtime_private,pg_temp AS $$
 SELECT material_before_drafts(n)||CASE WHEN EXISTS(SELECT 1 FROM drafts WHERE ns=n)
 THEN jsonb_build_object('privateDrafts',jsonb_build_object(
 'drafts',(SELECT jsonb_agg((to_jsonb(d)-'image')||jsonb_build_object('imageSha256',encode(sha256(d.image),'hex')) ORDER BY store,meal) FROM drafts d WHERE ns=n),
 'replays',(SELECT jsonb_agg(to_jsonb(r) ORDER BY store,subject,idem) FROM draft_replays r WHERE ns=n))) ELSE '{}'::jsonb END $$;
ALTER FUNCTION c1_runtime_private.floors(text) RENAME TO floors_before_drafts;
CREATE FUNCTION c1_runtime_private.floors(n text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,c1_live_private,c1_runtime_private,pg_temp AS $$
 SELECT floors_before_drafts(n)||jsonb_build_object('runtime_attempt',(floors_before_drafts(n)->'runtime_attempt')||
 coalesce((SELECT jsonb_object_agg(k,r) FROM (
 SELECT 'private-draft:'||store||':'||meal k,revision r FROM drafts WHERE ns=n
 UNION ALL SELECT 'draft-replay:'||store||':'||subject||':'||idem,1 FROM draft_replays WHERE ns=n) x),'{}')) $$;
ALTER FUNCTION c1_runtime_private.material(text) OWNER TO c1_runtime_code_owner;
ALTER FUNCTION c1_runtime_private.floors(text) OWNER TO c1_runtime_code_owner;
REVOKE ALL ON FUNCTION c1_runtime_private.material(text),c1_runtime_private.floors(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION c1_runtime_private.material(text),c1_runtime_private.floors(text) TO c1_runtime_controller_code_owner,c1_live_code_owner;

CREATE FUNCTION c1_live_private.draft_dto(d c1_live_private.drafts) RETURNS jsonb LANGUAGE sql IMMUTABLE
SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('id',d.meal,'meal',d.meal,'revision',d.revision,'draftRevision',d.revision,
 'saved',true,'publicationState','PRIVATE_DRAFT','draft',d.body||jsonb_build_object(
 'imageDigest',d.image_digest,'hasImage',d.image IS NOT NULL,
 'imageUrl',CASE WHEN d.image IS NOT NULL THEN '/v1/stores/'||d.store||'/drafts/'||d.meal||'/image' ELSE NULL END)) $$;
ALTER FUNCTION c1_live_private.draft_dto(c1_live_private.drafts) OWNER TO c1_live_code_owner;
REVOKE ALL ON FUNCTION c1_live_private.draft_dto(c1_live_private.drafts) FROM PUBLIC;

CREATE FUNCTION c1_runtime_internal.live_draft(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,c1_live_private,c1_private,pg_temp AS $$
DECLARE s c1_private.sessions;t c1_live_private.stores;d c1_live_private.drafts;
 replay c1_live_private.draft_replays;op text=q->>'op';m text=q->>'meal';p jsonb=q->'payload';
 expected bigint;req_hash text;answer jsonb;bytes bytea;part jsonb;previous_end int=-1;
BEGIN
 IF op NOT IN('list','get','image_get','save','image_save') OR op IS NULL THEN PERFORM fail('INVALID_REQUEST');END IF;
 s=c1_live_private.context(n,q,op IN('save','image_save'));
 t=c1_live_private.store(n,q->>'store',false);PERFORM c1_live_private.owner(n,t,s);
 IF op='list' THEN RETURN jsonb_build_object('items',coalesce((SELECT jsonb_agg(c1_live_private.draft_dto(x) ORDER BY meal) FROM drafts x WHERE ns=n AND store=t.store),'[]'));END IF;
 IF m IS NULL OR (m IS DISTINCT FROM t.meal AND m!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN PERFORM fail('INVALID_MEAL');END IF;
 SELECT * INTO d FROM drafts WHERE ns=n AND store=t.store AND meal=m;
 IF op='get' THEN
  IF d.ns IS NOT NULL THEN RETURN c1_live_private.draft_dto(d);END IF;
  p=CASE WHEN m=t.meal THEN jsonb_build_object('name',t.profile->'firstMeal'->'name','description',t.profile->'firstMeal'->'description','price',t.profile->'firstMeal'->'price','windows',t.profile->'firstMeal'->'windows')
   ELSE jsonb_build_object('name','','description','','price','1','windows',jsonb_build_array(jsonb_build_array(0,1440))) END;
  RETURN jsonb_build_object('id',m,'meal',m,'revision',0,'draftRevision',0,'saved',false,'publicationState','PRIVATE_DRAFT','draft',p||jsonb_build_object('imageDigest',NULL,'hasImage',false,'imageUrl',NULL));
 END IF;
 IF op='image_get' THEN IF d.image IS NULL THEN PERFORM fail('NOT_FOUND');END IF;RETURN jsonb_build_object('image',encode(d.image,'base64'));END IF;
 IF q->>'key' IS NULL OR q->>'key'!~'^[ -~]{16,128}$' OR jsonb_typeof(p) IS DISTINCT FROM 'object'
  OR jsonb_typeof(p->'expectedRevision') IS DISTINCT FROM 'number' OR p->>'expectedRevision'!~'^(0|[1-9][0-9]{0,8})$' THEN PERFORM fail('INVALID_REQUEST');END IF;
 expected=(p->>'expectedRevision')::bigint;
 req_hash=encode(sha256(convert_to(jsonb_build_array(op,m,p)::text,'UTF8')),'hex');
 SELECT * INTO replay FROM draft_replays WHERE ns=n AND store=t.store AND subject=s.subject AND idem=q->>'key';
 IF FOUND THEN IF replay.request_hash IS DISTINCT FROM req_hash THEN PERFORM fail('IDEMPOTENCY_CONFLICT');END IF;RETURN replay.response;END IF;
 IF (SELECT count(*) FROM draft_replays WHERE ns=n AND store=t.store)>=256 THEN PERFORM fail('QUEUE_FULL');END IF;
 IF coalesce(d.revision,0)<>expected THEN PERFORM fail('STALE_REVISION');END IF;
 IF op='save' THEN
  IF (SELECT count(*) FROM jsonb_object_keys(p))<>5 OR NOT p ?& ARRAY['name','description','price','windows','expectedRevision']
   OR jsonb_typeof(p->'name') IS DISTINCT FROM 'string' OR jsonb_typeof(p->'description') IS DISTINCT FROM 'string'
   OR length(btrim(p->>'name'))=0 OR octet_length(p->>'name')>200 OR octet_length(p->>'description')>8192
   OR jsonb_typeof(p->'price') IS DISTINCT FROM 'string' OR p->>'price'!~'^[1-9][0-9]{0,77}$' THEN PERFORM fail('INVALID_REQUEST');END IF;
  IF (p->>'price')::numeric>=power(2::numeric,256) THEN PERFORM fail('INVALID_REQUEST');END IF;
  IF jsonb_typeof(p->'windows') IS DISTINCT FROM 'array' THEN PERFORM fail('INVALID_WINDOWS');END IF;
  IF jsonb_array_length(p->'windows') NOT BETWEEN 1 AND 2 THEN PERFORM fail('INVALID_WINDOWS');END IF;
  FOR part IN SELECT value FROM jsonb_array_elements(p->'windows') LOOP
   IF jsonb_typeof(part) IS DISTINCT FROM 'array' THEN PERFORM fail('INVALID_WINDOWS');END IF;
   IF jsonb_array_length(part)<>2 OR jsonb_typeof(part->0) IS DISTINCT FROM 'number' OR jsonb_typeof(part->1) IS DISTINCT FROM 'number'
    OR part->>0!~'^[0-9]{1,4}$' OR part->>1!~'^[0-9]{1,4}$' THEN PERFORM fail('INVALID_WINDOWS');END IF;
   IF (part->>0)::int<previous_end OR (part->>0)::int>=(part->>1)::int OR (part->>1)::int>1440 THEN PERFORM fail('INVALID_WINDOWS');END IF;
   previous_end=(part->>1)::int;
  END LOOP;
  IF d.ns IS NULL AND (SELECT count(*) FROM drafts WHERE ns=n AND store=t.store)>=20 THEN PERFORM fail('QUEUE_FULL');END IF;
  INSERT INTO drafts(ns,store,meal,revision,body) VALUES(n,t.store,m,1,p-'expectedRevision')
   ON CONFLICT(ns,store,meal) DO UPDATE SET revision=drafts.revision+1,body=EXCLUDED.body RETURNING * INTO d;
 ELSE
  IF d.ns IS NULL THEN PERFORM fail('DRAFT_REQUIRED');END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p))<>3 OR NOT p ?& ARRAY['expectedRevision','image','imageDigest']
   OR jsonb_typeof(p->'image') IS DISTINCT FROM 'string' OR jsonb_typeof(p->'imageDigest') IS DISTINCT FROM 'string'
   OR p->>'imageDigest'!~'^[0-9a-f]{64}$' THEN PERFORM fail('INVALID_REQUEST');END IF;
  bytes=decode(p->>'image','base64');
  IF octet_length(bytes) NOT BETWEEN 8 AND 8388608 OR substring(bytes FROM 1 FOR 8)<>decode('89504e470d0a1a0a','hex') THEN PERFORM fail('INVALID_IMAGE');END IF;
  UPDATE drafts SET image=bytes,image_digest=p->>'imageDigest',revision=revision+1 WHERE ns=n AND store=t.store AND meal=m RETURNING * INTO d;
 END IF;
 answer=c1_live_private.draft_dto(d);
 INSERT INTO draft_replays VALUES(n,t.store,s.subject,q->>'key',req_hash,answer);
 RETURN answer;
END $$;
ALTER FUNCTION c1_runtime_internal.live_draft(text,jsonb) OWNER TO c1_live_code_owner;
REVOKE ALL ON FUNCTION c1_runtime_internal.live_draft(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION c1_runtime_internal.live_draft(text,jsonb) TO c1_live_api;
