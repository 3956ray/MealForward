-- Only the private controller can install a retained-journal restore fence.
SET ROLE c1_table_owner;
CREATE TABLE c1_private.restore_runs(ns text,id uuid,sequence bigint,digest text,binding jsonb,floors jsonb,state text CHECK(state IN('INSTALLED','FINISHED')),PRIMARY KEY(ns,id));
RESET ROLE;
GRANT SELECT,INSERT,UPDATE ON c1_private.restore_runs TO c1_auth_code_owner;
GRANT DELETE ON c1_private.content_verified TO c1_auth_code_owner;
GRANT SELECT ON c1_private.restore_runs TO c1_projection_code_owner;
CREATE FUNCTION c1_api.restore_status(n text,q jsonb) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,c1_private,pg_temp AS $$
 SELECT jsonb_build_object('now',now,'clock_floor',clock_floor,'restore_generation',restore_generation,'credential_epoch',credential_epoch,'source_epoch',source_epoch,'height',height,'parent',parent,'reason',reason,'halted',halt,'content_valid',NOT EXISTS(SELECT 1 FROM c1_private.terms t WHERE t.ns=n AND NOT c1_private.content_available(n,t.store,t.meal,t.version)))
 FROM c1_private.deployment WHERE ns=n
$$;
CREATE FUNCTION c1_api.restore_material_list(n text,q jsonb) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,c1_private,pg_temp AS $$
 SELECT jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object('id',key,'store',store,'meal',meal,'version',version) ORDER BY key),'[]')) FROM
 (SELECT store,meal,version,store||':'||meal||':'||lpad(version::text,20,'0') AS key FROM c1_private.terms
 WHERE ns=n AND store||':'||meal||':'||lpad(version::text,20,'0')>coalesce(q->>'after','') ORDER BY store,meal,version LIMIT 50) rows
$$;
CREATE FUNCTION c1_api.restore_install(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_private,pg_temp AS $$
DECLARE d c1_private.deployment;b jsonb=q->'binding';f jsonb;existing c1_private.restore_runs;x jsonb;
BEGIN
 d=c1_private.guard(n);
 SELECT * INTO existing FROM c1_private.restore_runs WHERE ns=n AND id=(b->>'mutation_id')::uuid;
 IF FOUND THEN
  IF existing.binding IS DISTINCT FROM b OR existing.sequence IS DISTINCT FROM (q->>'sequence')::bigint OR existing.digest IS DISTINCT FROM q->>'digest' THEN PERFORM c1_private.fail('RESTORE_PROOF_MISMATCH');END IF;
  RETURN jsonb_build_object('installed',true);
 END IF;
 IF b->>'kind'<>'restore' OR (b->>'restore_generation')::bigint<=d.restore_generation OR (b->>'credential_epoch')::bigint<=d.credential_epoch OR (b->>'source_epoch')::bigint<>d.source_epoch OR q->>'digest'!~'^[0-9a-f]{64}$' THEN PERFORM c1_private.fail('RESTORE_EPOCH_MISMATCH');END IF;
 UPDATE c1_private.deployment SET restore_generation=(b->>'restore_generation')::bigint,credential_epoch=(b->>'credential_epoch')::bigint,
  now=greatest(now,(b->'expected_revision'->>'service_floor')::bigint),clock_floor=greatest(clock_floor,(b->'expected_revision'->>'service_floor')::bigint),halt=true,reason='CONTROLLED_RESTORE' WHERE ns=n;
 UPDATE c1_private.sessions SET revoked=true,revision=greatest(revision,coalesce((b->'floors'->'session'->>encode(hash,'hex'))::bigint,0))+1 WHERE ns=n;
 UPDATE c1_private.access_credentials SET active=false WHERE ns=n;
 UPDATE c1_private.display_credentials SET active=false WHERE ns=n;
 UPDATE c1_private.vouchers SET access_epoch=greatest(access_epoch,coalesce((b->'floors'->'access'->>id)::bigint,0))+1,display_epoch=greatest(display_epoch,coalesce((b->'floors'->'display'->>id)::bigint,0))+1 WHERE ns=n;
 DELETE FROM c1_private.content_verified WHERE ns=n;
 f=c1_private.merge_floors(b->'floors',jsonb_build_object('credential',jsonb_build_object('global',(b->>'credential_epoch')::bigint),'restore',jsonb_build_object('global',(b->>'restore_generation')::bigint)));
 SELECT coalesce(jsonb_object_agg(encode(hash,'hex'),revision),'{}') INTO x FROM c1_private.sessions WHERE ns=n;f=c1_private.merge_floors(f,jsonb_build_object('session',x));
 SELECT coalesce(jsonb_object_agg(id,access_epoch),'{}') INTO x FROM c1_private.vouchers WHERE ns=n;f=c1_private.merge_floors(f,jsonb_build_object('access',x));
 SELECT coalesce(jsonb_object_agg(id,display_epoch),'{}') INTO x FROM c1_private.vouchers WHERE ns=n;f=c1_private.merge_floors(f,jsonb_build_object('display',x));
 INSERT INTO c1_private.restore_runs VALUES(n,(b->>'mutation_id')::uuid,(q->>'sequence')::bigint,q->>'digest',b,f,'INSTALLED');
 RETURN jsonb_build_object('installed',true);
END $$;
CREATE FUNCTION c1_api.restore_proof(n text,q jsonb) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,c1_private,pg_temp AS $$
 SELECT jsonb_build_object('installed',true,'mutation_id',id,'sequence',sequence,'digest',digest,'binding',binding,'floors',floors,'state',state)
 FROM c1_private.restore_runs WHERE ns=n AND id=(q->>'mutation_id')::uuid
$$;
CREATE FUNCTION c1_api.restore_finish(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_private,pg_temp AS $$
DECLARE r c1_private.restore_runs;d c1_private.deployment;
BEGIN
 d=c1_private.guard(n);SELECT * INTO r FROM c1_private.restore_runs WHERE ns=n AND id=(q->>'mutation_id')::uuid FOR UPDATE;
 IF NOT FOUND OR r.sequence IS DISTINCT FROM (q->>'sequence')::bigint OR r.digest IS DISTINCT FROM q->>'digest' OR d.restore_generation<>(r.binding->>'restore_generation')::bigint OR d.credential_epoch<>(r.binding->>'credential_epoch')::bigint THEN PERFORM c1_private.fail('RESTORE_PROOF_MISMATCH');END IF;
 PERFORM c1_private.retain_journal(n,q);UPDATE c1_private.restore_runs SET state='FINISHED' WHERE ns=n AND id=r.id;
 UPDATE c1_private.deployment SET halt=false,reason='LOCAL_SYNTHETIC' WHERE ns=n;
 RETURN jsonb_build_object('finished',true);
END $$;

SET ROLE c1_table_owner;
CREATE TABLE c1_private.journal_anchors(ns text PRIMARY KEY,sequence bigint NOT NULL,digest text NOT NULL);
RESET ROLE;
GRANT SELECT,INSERT,UPDATE ON c1_private.journal_anchors TO c1_auth_code_owner;
CREATE FUNCTION c1_private.retain_journal(n text,q jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE prior c1_private.journal_anchors;seq bigint=(q->>'journal_sequence')::bigint;dg text=q->>'journal_digest';
BEGIN
 IF seq IS NULL OR seq<1 OR dg IS NULL OR dg!~'^[0-9a-f]{64}$' THEN PERFORM c1_private.fail('JOURNAL_ANCHOR_REQUIRED');END IF;
 SELECT * INTO prior FROM c1_private.journal_anchors WHERE ns=n FOR UPDATE;
 IF FOUND AND (seq<prior.sequence OR (seq=prior.sequence AND dg<>prior.digest)) THEN PERFORM c1_private.fail('JOURNAL_ANCHOR_ROLLBACK');END IF;
 INSERT INTO c1_private.journal_anchors VALUES(n,seq,dg) ON CONFLICT(ns) DO UPDATE SET sequence=EXCLUDED.sequence,digest=EXCLUDED.digest;
END $$;
CREATE FUNCTION c1_api.journal_anchor(n text,q jsonb) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,c1_private,pg_temp AS $$
 SELECT coalesce((SELECT jsonb_build_object('sequence',sequence,'digest',digest) FROM c1_private.journal_anchors ORDER BY sequence DESC LIMIT 1),jsonb_build_object('sequence',0,'digest',repeat('0',64)))
$$;
REVOKE ALL ON FUNCTION c1_private.retain_journal(text,jsonb) FROM PUBLIC;
