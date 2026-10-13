-- Server-owned deployment mode selects the live verified payer identity.
CREATE OR REPLACE FUNCTION c1_api.rate_limit(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_private,pg_temp AS $$ DECLARE nowv bigint;v jsonb;cnt integer;slot bigint;lim int;b bigint;s c1_private.sessions;payer text;bs jsonb=q->'buckets';k text;BEGIN IF coalesce((q->>'support')::boolean,false) THEN s=c1_private.auth(n,q,true);SELECT now INTO nowv FROM c1_private.deployment WHERE ns=n;
 IF (SELECT manifest->>'mode' FROM c1_private.deployment WHERE ns=n)='CP30_TESTNET_CONNECTION' THEN
  SELECT b.owner INTO payer FROM c1_private.verified_owner_bindings b
   WHERE b.ns=n AND b.subject=s.subject AND b.enabled
    AND b.identity_revision=s.identity_revision AND b.credential_epoch=s.epoch AND b.verified_until>nowv;
  IF payer IS NULL THEN PERFORM c1_private.fail('PAYER_BINDING_CHANGED');END IF;
 ELSE
  SELECT address INTO payer FROM c1_private.payer_bindings WHERE ns=n AND subject=s.subject;
  IF payer IS NULL THEN PERFORM c1_private.fail('PAYER_REQUIRED');END IF;
 END IF;FOREACH k IN ARRAY ARRAY['support-subject:'||s.subject,'support-payer:'||payer] LOOP bs=bs||jsonb_build_array(jsonb_build_object('key',k,'period',60,'limit',3),jsonb_build_object('key',k,'period',3600,'limit',10));END LOOP;END IF;SELECT now INTO nowv FROM c1_private.deployment WHERE ns=n;FOR v IN SELECT value FROM jsonb_array_elements(bs) LOOP slot=(v->>'period')::bigint;lim=(v->>'limit')::int;b=nowv/slot;INSERT INTO c1_private.rate_buckets VALUES(n,v->>'key',slot,b,1) ON CONFLICT(ns,key,period,bucket) DO UPDATE SET count=c1_private.rate_buckets.count+1 RETURNING count INTO cnt;IF cnt>lim THEN RETURN jsonb_build_object('error','RATE_LIMIT','status',429,'retryAfter',slot-nowv%slot);END IF;END LOOP;RETURN jsonb_build_object('allowed',true,'now',nowv);END $$;
