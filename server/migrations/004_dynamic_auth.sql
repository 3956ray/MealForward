CREATE TABLE dynamic_identity_mappings (
 id TEXT PRIMARY KEY, environment_id TEXT NOT NULL, issuer TEXT NOT NULL,
 subject TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES users(id),
 revision INTEGER NOT NULL CHECK(revision>0), enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 authority_source_version TEXT NOT NULL,
 UNIQUE(environment_id,issuer,subject)
);
CREATE TABLE dynamic_session_bindings (
 session_id TEXT PRIMARY KEY REFERENCES work_sessions(token_hash),
 mapping_id TEXT NOT NULL REFERENCES dynamic_identity_mappings(id), mapping_revision INTEGER NOT NULL,
 environment_id TEXT NOT NULL, issuer TEXT NOT NULL, subject_hash TEXT NOT NULL,
 access_expires_at INTEGER NOT NULL, scopes TEXT NOT NULL, sid_hash TEXT,
 actor_role TEXT NOT NULL CHECK(actor_role IN ('partner','owner')), partner_id TEXT, shop_id TEXT
);
CREATE TABLE operation_auth_bindings (
 operation_id TEXT PRIMARY KEY REFERENCES operations(id), auth_source TEXT NOT NULL CHECK(auth_source='dynamic'),
 mapping_id TEXT NOT NULL REFERENCES dynamic_identity_mappings(id), mapping_revision INTEGER NOT NULL,
 environment_id TEXT NOT NULL, subject_hash TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES users(id),
 role TEXT NOT NULL CHECK(role IN ('partner','owner')), partner_id TEXT, shop_id TEXT
);
CREATE TRIGGER operation_auth_binding_immutable BEFORE UPDATE ON operation_auth_bindings
 BEGIN SELECT RAISE(ABORT,'Accepted authorization is immutable'); END;
