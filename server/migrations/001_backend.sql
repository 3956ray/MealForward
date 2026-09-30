CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE users (
 id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
 role TEXT NOT NULL, partner_id TEXT, shop_id TEXT, enabled INTEGER NOT NULL CHECK(enabled IN (0,1))
);
CREATE TABLE work_sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf_hash TEXT NOT NULL,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
 revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE auth_failures (key TEXT NOT NULL, occurred_at INTEGER NOT NULL);
CREATE INDEX auth_failures_key_time ON auth_failures(key,occurred_at);
CREATE TABLE support_caps (
 id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL, operation_id TEXT UNIQUE
);
CREATE TABLE operations (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, actor_id TEXT NOT NULL, partner_id TEXT,
 intent_key TEXT NOT NULL, request_json TEXT NOT NULL, payload_hash TEXT NOT NULL,
 status TEXT NOT NULL, target TEXT, tx_hash TEXT, receipt_block INTEGER,
 receipt_hash TEXT, finalized_block INTEGER, error_code TEXT, created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL, UNIQUE(actor_id,kind,intent_key)
);
CREATE TABLE support_intents (
 operation_id TEXT PRIMARY KEY REFERENCES operations(id), intent_id TEXT UNIQUE NOT NULL,
 payer TEXT NOT NULL, quantity INTEGER NOT NULL, value_wei INTEGER NOT NULL,
 batch_id TEXT UNIQUE NOT NULL, data TEXT NOT NULL, quote_expires_at INTEGER NOT NULL
);
CREATE TABLE qualifications (
 partner_id TEXT NOT NULL, recipient_ref TEXT NOT NULL, eligible INTEGER NOT NULL,
 channel_verified INTEGER NOT NULL, quota INTEGER NOT NULL, reserved INTEGER NOT NULL DEFAULT 0,
 used INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(partner_id,recipient_ref),
 CHECK(quota>=0 AND reserved>=0 AND used>=0 AND reserved+used<=quota)
);
CREATE TABLE reservations (
 operation_id TEXT PRIMARY KEY REFERENCES operations(id), partner_id TEXT NOT NULL,
 recipient_ref TEXT NOT NULL, batch_id TEXT NOT NULL, quantity INTEGER NOT NULL,
 amount_wei INTEGER NOT NULL, state TEXT NOT NULL
);
CREATE TABLE private_vouchers (
 id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES operations(id), batch_id TEXT NOT NULL,
 secret_hash TEXT NOT NULL, secret_cipher TEXT NOT NULL, confirmed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE outbox (
 operation_id TEXT PRIMARY KEY REFERENCES operations(id), signer TEXT NOT NULL,
 nonce INTEGER, tx_json TEXT NOT NULL, raw_cipher TEXT, tx_hash TEXT,
 state TEXT NOT NULL, broadcast_count INTEGER NOT NULL DEFAULT 0,
 UNIQUE(signer,nonce)
);
CREATE TABLE signer_nonces (signer TEXT PRIMARY KEY, next_nonce INTEGER NOT NULL);
CREATE TABLE chain_events (
 event_id TEXT PRIMARY KEY, block_number INTEGER NOT NULL, block_hash TEXT NOT NULL,
 tx_hash TEXT NOT NULL, log_index INTEGER NOT NULL, transaction_index INTEGER NOT NULL,
 name TEXT NOT NULL, args_json TEXT NOT NULL
);
CREATE TABLE batches (
 id TEXT PRIMARY KEY, payer TEXT NOT NULL, F INTEGER NOT NULL, A INTEGER NOT NULL,
 R INTEGER NOT NULL, H INTEGER NOT NULL, S INTEGER NOT NULL, X INTEGER NOT NULL DEFAULT 0,
 L INTEGER NOT NULL DEFAULT 0, CHECK(F=A+R+H+S+X), CHECK(L>=0 AND L<=A)
);
CREATE TABLE public_vouchers (id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, status INTEGER NOT NULL, lock_id TEXT);
CREATE TABLE checkpoints (block_number INTEGER PRIMARY KEY, block_hash TEXT NOT NULL);
