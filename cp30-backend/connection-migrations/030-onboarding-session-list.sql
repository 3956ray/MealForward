-- Session-owned discovery only; no original registration or runtime mutation.
CREATE FUNCTION c1_api.onboarding_list_owned(n text,q jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,c1_private,pg_temp AS $$
DECLARE v_auth jsonb;v_items jsonb;v_count integer;
BEGIN
 v_auth=c1_api.onboarding_authorize(n,jsonb_build_object(
  'session_hash',q->>'session_hash','action','read','readOnly',true));
 WITH owned AS (
  SELECT r.id,r.record FROM c1_private.store_registrations r
  WHERE r.ns=n AND r.subject=v_auth->>'subject'
   AND r.record->>'owner'=v_auth->>'owner'
   AND r.record->>'bindingRevision'=v_auth->>'bindingRevision'
  ORDER BY r.id DESC LIMIT 51
 ), numbered AS (
  SELECT id,record,row_number() OVER(ORDER BY id DESC) AS position FROM owned
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'registrationId',record->'registrationId','storeId',record->'storeId',
  'state',record->'state','ready',record->>'state'='CONFIRMED',
  'escrow',record->'escrow','transactionHash',record->'transactionHash',
  'typedData',record->'prepared'->'typedData','configHash',record->'prepared'->'configHash',
  'request',record->'request'
 ) ORDER BY id DESC) FILTER(WHERE position<=50),'[]'::jsonb),count(*)
 INTO v_items,v_count FROM numbered;
 RETURN jsonb_build_object('items',v_items,'hasMore',v_count>50);
END $$;
ALTER FUNCTION c1_api.onboarding_list_owned(text,jsonb) OWNER TO c1_api_code_owner;
REVOKE ALL ON FUNCTION c1_api.onboarding_list_owned(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION c1_api.onboarding_list_owned(text,jsonb) TO c1_app_api,c1_api_a,c1_api_b;
