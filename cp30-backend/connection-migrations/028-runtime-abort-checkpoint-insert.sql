-- Forward ACL repair only: ledger_abort seals an original absence proof here.
-- Grant to its existing NOLOGIN SECURITY DEFINER owner, not a runtime login.
-- Retained PREPARED recovery still uses the original controller protocol.
GRANT INSERT ON TABLE c1_runtime_private.checkpoints TO c1_runtime_controller_code_owner;
