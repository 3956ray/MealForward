ALTER TABLE operations ADD COLUMN shop_id TEXT;
ALTER TABLE operations ADD COLUMN redemption_id TEXT;
ALTER TABLE outbox ADD COLUMN signing_stage TEXT NOT NULL DEFAULT 'LEGACY_UNKNOWN';
UPDATE outbox SET signing_stage='RAW_SAVED' WHERE raw_cipher IS NOT NULL;
CREATE TABLE work_signers (role TEXT PRIMARY KEY, address TEXT NOT NULL UNIQUE);
CREATE TABLE work_audit (
 id INTEGER PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES operations(id),
 event TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TRIGGER work_audit_no_update BEFORE UPDATE ON work_audit BEGIN SELECT RAISE(ABORT,'Immutable audit'); END;
CREATE TRIGGER work_audit_no_delete BEFORE DELETE ON work_audit BEGIN SELECT RAISE(ABORT,'Immutable audit'); END;
CREATE UNIQUE INDEX work_target_pending ON operations(kind,target)
 WHERE kind IN ('lock','report','settle') AND status NOT IN ('FINALIZED_SUCCESS','FINALIZED_REVERT','NOT_SUBMITTED');
CREATE TABLE invitation_audits (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, partner_id TEXT NOT NULL,
 voucher_id TEXT NOT NULL REFERENCES private_vouchers(id), intent_key TEXT NOT NULL,
 created_at INTEGER NOT NULL, UNIQUE(actor_id,intent_key)
);
CREATE TRIGGER invitation_no_update BEFORE UPDATE ON invitation_audits BEGIN SELECT RAISE(ABORT,'Immutable disclosure'); END;
CREATE TRIGGER invitation_no_delete BEFORE DELETE ON invitation_audits BEGIN SELECT RAISE(ABORT,'Immutable disclosure'); END;
CREATE TABLE delivery_attempts (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, partner_id TEXT NOT NULL,
 voucher_id TEXT NOT NULL REFERENCES private_vouchers(id), intent_key TEXT NOT NULL,
 channel TEXT NOT NULL CHECK(channel IN ('private_message','in_person')),
 result TEXT NOT NULL CHECK(result IN ('sent','failed')), created_at INTEGER NOT NULL,
 UNIQUE(actor_id,intent_key)
);
CREATE TRIGGER delivery_no_update BEFORE UPDATE ON delivery_attempts BEGIN SELECT RAISE(ABORT,'Immutable delivery'); END;
CREATE TRIGGER delivery_no_delete BEFORE DELETE ON delivery_attempts BEGIN SELECT RAISE(ABORT,'Immutable delivery'); END;
CREATE TABLE recipient_sessions (
 token_hash TEXT PRIMARY KEY, session_id TEXT NOT NULL UNIQUE,
 voucher_id TEXT NOT NULL REFERENCES private_vouchers(id), csrf_hash TEXT NOT NULL,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
 revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1))
);
CREATE TABLE recipient_heads (
 voucher_id TEXT PRIMARY KEY REFERENCES private_vouchers(id),
 session_hash TEXT NOT NULL UNIQUE REFERENCES recipient_sessions(token_hash)
);
CREATE TABLE presentation_codes (
 id TEXT PRIMARY KEY, voucher_id TEXT NOT NULL REFERENCES private_vouchers(id),
 session_hash TEXT NOT NULL REFERENCES recipient_sessions(token_hash), intent_key TEXT NOT NULL,
 code_hash TEXT NOT NULL, code_cipher TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), consumed_by TEXT,
 UNIQUE(session_hash,intent_key)
);
CREATE UNIQUE INDEX active_code_unique ON presentation_codes(code_hash) WHERE active=1;
CREATE UNIQUE INDEX active_voucher_code_unique ON presentation_codes(voucher_id) WHERE active=1;
CREATE TABLE processing_groups (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, shop_id TEXT NOT NULL,
 intent_key TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(actor_id,intent_key)
);
CREATE TABLE processing_items (
 group_id TEXT NOT NULL REFERENCES processing_groups(id), voucher_id TEXT NOT NULL REFERENCES private_vouchers(id),
 actor_id TEXT NOT NULL, shop_id TEXT NOT NULL, created_at INTEGER NOT NULL,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), PRIMARY KEY(group_id,voucher_id)
);
CREATE UNIQUE INDEX staff_active_voucher_group ON processing_items(actor_id,voucher_id) WHERE active=1;
CREATE TABLE processing_item_requests (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, shop_id TEXT NOT NULL,
 group_id TEXT NOT NULL REFERENCES processing_groups(id), voucher_id TEXT NOT NULL REFERENCES private_vouchers(id),
 intent_key TEXT NOT NULL, request_json TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(actor_id,intent_key)
);
CREATE TABLE redemptions (
 id TEXT PRIMARY KEY, voucher_id TEXT NOT NULL REFERENCES private_vouchers(id),
 actor_id TEXT NOT NULL, shop_id TEXT NOT NULL, group_id TEXT REFERENCES processing_groups(id),
 lock_id TEXT NOT NULL UNIQUE, lock_operation_id TEXT NOT NULL UNIQUE REFERENCES operations(id),
 state TEXT NOT NULL DEFAULT 'LOCK_PENDING', created_at INTEGER NOT NULL
);
CREATE TABLE voucher_claims (
 voucher_id TEXT PRIMARY KEY REFERENCES private_vouchers(id),
 redemption_id TEXT NOT NULL UNIQUE REFERENCES redemptions(id)
);
CREATE TABLE handoff_statements (
 id TEXT PRIMARY KEY, redemption_id TEXT NOT NULL UNIQUE REFERENCES redemptions(id),
 actor_id TEXT NOT NULL, shop_id TEXT NOT NULL, intent_key TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(actor_id,intent_key)
);
CREATE TRIGGER handoff_no_update BEFORE UPDATE ON handoff_statements BEGIN SELECT RAISE(ABORT,'Immutable statement'); END;
CREATE TRIGGER handoff_no_delete BEFORE DELETE ON handoff_statements BEGIN SELECT RAISE(ABORT,'Immutable statement'); END;
