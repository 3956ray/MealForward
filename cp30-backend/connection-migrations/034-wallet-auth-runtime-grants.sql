-- 026 replaced auth after renaming its predecessor. Restore only the two
-- existing internal code-owner EXECUTE grants originally established by 023.
GRANT EXECUTE ON FUNCTION c1_private.auth(text,jsonb,boolean)
 TO c1_runtime_policy_owner,c1_runtime_code_owner;
