-- Proposed local migration filename; deployed Supabase version must be recorded after application.
-- Add sequential business scopes without rewriting first-business state or receipts.
-- Apply with MVP writes disabled; all subsequent writers must use schema version 2.
BEGIN;
ALTER TABLE mf_mvp_usdc.state DROP CONSTRAINT state_id_check;
ALTER TABLE mf_mvp_usdc.state ADD CONSTRAINT positive_business_id CHECK(id BETWEEN 1 AND 10);
CREATE UNIQUE INDEX one_active_business ON mf_mvp_usdc.state ((1)) WHERE data->>'phase' <> 'SETTLED';
ALTER TABLE mf_mvp_usdc.operations ADD COLUMN business_id integer NOT NULL DEFAULT 1 REFERENCES mf_mvp_usdc.state(id);
ALTER TABLE mf_mvp_usdc.operations DROP CONSTRAINT operations_action_key;
ALTER TABLE mf_mvp_usdc.operations ADD CONSTRAINT business_action_unique UNIQUE(business_id,action);
-- Existing global wallet/nonce and one_pending_wallet constraints remain intact.
ALTER TABLE mf_mvp_usdc.events ADD COLUMN business_id integer NOT NULL DEFAULT 1 REFERENCES mf_mvp_usdc.state(id);
CREATE OR REPLACE FUNCTION mf_mvp_usdc.guard_operation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF NEW.id<>OLD.id OR NEW.business_id<>OLD.business_id OR NEW.action<>OLD.action OR NEW.wallet<>OLD.wallet OR NEW.nonce<>OLD.nonce OR NEW.immutable<>OLD.immutable OR (OLD.tx_hash IS NOT NULL AND NEW.tx_hash IS DISTINCT FROM OLD.tx_hash) THEN RAISE EXCEPTION 'immutable operation'; END IF;
 IF NOT (NEW.state=OLD.state OR (OLD.state='PREPARED' AND NEW.state='SEND_UNKNOWN') OR (OLD.state='SEND_UNKNOWN' AND NEW.state='HASH_BOUND') OR (OLD.state='HASH_BOUND' AND NEW.state IN ('CONFIRMED','REVERTED'))) THEN RAISE EXCEPTION 'invalid transition'; END IF;
 IF OLD.receipt IS NOT NULL AND NEW.receipt IS DISTINCT FROM OLD.receipt THEN RAISE EXCEPTION 'immutable receipt'; END IF;
 RETURN NEW; END $$;
INSERT INTO mf_mvp_usdc.schema_version VALUES(2);
COMMIT;
