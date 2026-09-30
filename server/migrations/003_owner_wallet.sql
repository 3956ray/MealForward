CREATE TABLE owner_wallet_bindings (
 actor_id TEXT PRIMARY KEY REFERENCES users(id), shop_id TEXT NOT NULL UNIQUE,
 deployment_id TEXT NOT NULL, address TEXT NOT NULL UNIQUE,
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1))
);
CREATE TABLE owner_wallet_challenges (
 id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES work_sessions(token_hash),
 actor_id TEXT NOT NULL REFERENCES owner_wallet_bindings(actor_id), message TEXT NOT NULL,
 expires_at INTEGER NOT NULL, consumed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE owner_wallet_sessions (
 session_id TEXT PRIMARY KEY REFERENCES work_sessions(token_hash),
 actor_id TEXT NOT NULL REFERENCES owner_wallet_bindings(actor_id), address TEXT NOT NULL,
 proved_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE owner_settlements (
 operation_id TEXT PRIMARY KEY REFERENCES operations(id), address TEXT NOT NULL,
 chain_id INTEGER NOT NULL CHECK(chain_id=31337), contract TEXT NOT NULL,
 data TEXT NOT NULL, value_wei INTEGER NOT NULL CHECK(value_wei=0),
 review_expires_at INTEGER NOT NULL, submission_started_at INTEGER
);
CREATE TRIGGER owner_settlement_intent_immutable BEFORE UPDATE OF
 operation_id,address,chain_id,contract,data,value_wei ON owner_settlements
 BEGIN SELECT RAISE(ABORT,'Original wallet intent is immutable'); END;
