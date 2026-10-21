-- Index the append-only audit foreign key for private original-Intent lookup
-- and FK maintenance. Fresh cloud schema contains zero application records.
CREATE INDEX t1c_audit_by_intent_event ON mf_t1c.audit_events(intent_id,event_id);
