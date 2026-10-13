-- Forward function-only correction for live_projection SQLSTATE 42702.
-- Preserve installed 026, original evidence, CAS/finality checks, owner and ACL.
CREATE OR REPLACE FUNCTION c1_runtime_internal.live_projection(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_live_private,c1_private,pg_temp AS $$
DECLARE t stores;r c1_private.store_registrations;i intents;old receipts;v_rows jsonb=q->'rows';snap jsonb=q->'snapshot';receipt jsonb=v_rows->'receipt';v jsonb;j jsonb;b numeric;report_id uuid;BEGIN
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
