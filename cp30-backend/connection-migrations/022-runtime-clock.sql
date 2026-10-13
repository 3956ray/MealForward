-- Private clock only: no profile, success, epoch adoption or halt reset setter.
CREATE FUNCTION c1_runtime_internal.runtime_clock(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,c1_runtime_private,c1_private,pg_temp AS $$
DECLARE s c1_runtime_private.state;d c1_private.deployment;t jsonb=q->'checkpoint';v bigint=(q->>'now')::bigint;BEGIN
 SELECT * INTO s FROM c1_runtime_private.state WHERE ns=n FOR UPDATE;
 SELECT * INTO d FROM c1_private.deployment WHERE ns=n FOR UPDATE;
 IF s.ns IS NULL OR d.ns IS NULL OR d.halt OR s.pending IS NOT NULL
 OR s.revision IS DISTINCT FROM (t->>'ledgerRevision')::bigint OR s.head IS DISTINCT FROM t->>'ledgerHead'
 OR s.material_hash IS DISTINCT FROM t->>'materialHash' OR s.material_hash IS DISTINCT FROM encode(sha256(convert_to(c1_runtime_private.material(n)::text,'UTF8')),'hex')
 OR s.journal_sequence IS DISTINCT FROM (t->>'journalSequence')::bigint OR s.journal_digest IS DISTINCT FROM t->>'journalDigest'
 OR t->'floors' IS DISTINCT FROM c1_runtime_private.floors(n) OR t->'globalFloors' IS DISTINCT FROM c1_runtime_private.global_floors()
 OR t->'epochs' IS DISTINCT FROM jsonb_build_object('source_epoch',d.source_epoch,'credential_epoch',d.credential_epoch,'restore_generation',d.restore_generation)
 OR EXISTS(SELECT 1 FROM c1_private.transaction_guard WHERE ns=n AND (security_pending IS NOT NULL OR execution_pending IS NOT NULL))
 OR v IS NULL OR v<greatest(d.now,d.clock_floor) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='EXTERNAL_CLOCK_ANCHOR_REQUIRED';END IF;
 UPDATE c1_private.deployment SET now=v,clock_floor=v,heartbeat=v WHERE ns=n;
 RETURN jsonb_build_object('updated',true);END $$;
ALTER FUNCTION c1_runtime_internal.runtime_clock(text,jsonb) OWNER TO c1_runtime_controller_code_owner;
GRANT SELECT ON c1_private.deployment,c1_private.transaction_guard TO c1_runtime_controller_code_owner;
GRANT UPDATE(now,clock_floor,heartbeat) ON c1_private.deployment TO c1_runtime_controller_code_owner;
REVOKE ALL ON FUNCTION c1_runtime_internal.runtime_clock(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION c1_runtime_internal.runtime_clock(text,jsonb) TO c1_runtime_controller;
