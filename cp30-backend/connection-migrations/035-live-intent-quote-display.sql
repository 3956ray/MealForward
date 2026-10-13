-- Restore the exact original meal and signed quote expiry from an existing
-- contribution. This changes only its read DTO, never its stored deadline.
CREATE OR REPLACE FUNCTION c1_live_private.intent_dto(i c1_live_private.intents)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('id',i.id,'intentId',i.id,'store',i.store,
   'action',CASE i.action WHEN 'markHandover' THEN 'handover' ELSE i.action END,
   'stage',i.stage,'result',i.result,'transactionHash',i.transaction_hash)
 || CASE WHEN i.action='fund' THEN jsonb_build_object(
   'mealId',i.parameters->>'mealId',
   'quantity',i.parameters->>'quantity','amount',i.parameters->>'amount',
   'quoteExpiresAt',i.parameters->>'deadline') ELSE '{}'::jsonb END
$$;
