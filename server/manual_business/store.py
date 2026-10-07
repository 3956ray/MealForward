"""Explicit fresh creation and fail-closed resume, including every security table."""
import fcntl
import hashlib
import json
import os
from contextlib import contextmanager
from pathlib import Path
from server.backend import canonical, digest
from server.local_e2e.store import LocalStore
from server.contracts import ApiError

SCHEMA = '''
CREATE TABLE cp28_identity(id INTEGER PRIMARY KEY CHECK(id=1),run_id TEXT NOT NULL,config_digest TEXT NOT NULL,plan_digest TEXT,halted TEXT NOT NULL DEFAULT '');
CREATE TABLE cp28_signing(operation_id TEXT PRIMARY KEY,kind TEXT NOT NULL,sender TEXT NOT NULL,nonce INTEGER,review TEXT NOT NULL,state TEXT NOT NULL,fee_reserved TEXT NOT NULL,value_reserved TEXT NOT NULL,started_at INTEGER NOT NULL,tx_hash TEXT,raw_cipher TEXT,actual_fee TEXT,polls INTEGER NOT NULL DEFAULT 0,last_poll INTEGER NOT NULL DEFAULT 0,scan_from INTEGER);
CREATE UNIQUE INDEX cp28_nonce ON cp28_signing(sender,nonce) WHERE nonce IS NOT NULL;
CREATE TABLE cp28_mapping(actor_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,enabled INTEGER NOT NULL,scope TEXT NOT NULL);
CREATE TABLE cp28_reviews(operation_id TEXT PRIMARY KEY,actor_id TEXT,session_id TEXT,mapping_revision INTEGER,expires INTEGER NOT NULL,context TEXT NOT NULL);
CREATE TABLE cp28_sessions(session_id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,mapping_revision INTEGER NOT NULL,config_digest TEXT NOT NULL);
CREATE TABLE cp28_wallet_reviews(operation_id TEXT PRIMARY KEY,review TEXT NOT NULL);
'''


class ManualStore(LocalStore):
    def __init__(self, path, config, *, create=False):
        path = Path(path).resolve()
        anchor = path.parent.parent / (path.parent.name + '.cp24-anchor.json')
        self._lock_path = path.parent / 'cp28-writer.lock'
        if create:
            if path.exists() or anchor.exists(): raise ValueError('Fresh run must not overwrite state')
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            os.close(fd)
        elif not path.is_file() or not anchor.is_file() or not self._lock_path.is_file():
            raise ValueError('Missing original database, anchor or writer identity; no auto creation')
        # LocalStore's table layout supplies existing credential/domain services.
        super().__init__(path)
        if create:
            with self.transaction() as db:
                if config['chainId'] == 10143:
                    # Only the brand-new CP28 database has a different network.
                    # Do not relax the shared local schema or migrate persisted intents.
                    schema = db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='owner_settlements'").fetchone()['sql']
                    trigger = db.execute("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='owner_settlement_intent_immutable'").fetchone()['sql']
                    if schema.count('CHECK(chain_id=31337)') != 1 or db.execute('SELECT 1 FROM owner_settlements').fetchone():
                        raise ValueError('Unexpected fresh owner settlement schema')
                    db.execute('DROP TABLE owner_settlements')
                    db.execute(schema.replace('CHECK(chain_id=31337)', 'CHECK(chain_id=10143)'))
                    db.execute(trigger)
                for statement in SCHEMA.split(';'):
                    if statement.strip(): db.execute(statement)
                db.execute('INSERT INTO cp28_identity(id,run_id,config_digest) VALUES(1,?,?)',
                           (config['runId'], digest(canonical(config))))
        with self.transaction() as db:
            row = db.execute('SELECT * FROM cp28_identity WHERE id=1').fetchone()
            if not row or row['run_id'] != config['runId'] or row['config_digest'] != digest(canonical(config)):
                raise ValueError('Run/config identity mismatch; preserve original state')
            schema = db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='owner_settlements'").fetchone()['sql']
            if f"CHECK(chain_id={config['chainId']})" not in schema:
                raise ValueError('Owner settlement network mismatch; preserve original database')

    def fingerprint(self, db):
        names = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
        state = {'path': str(self.path.resolve()), 'schema': [tuple(r) for r in db.execute(
            "SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name")]}
        for name in names:
            quoted = '"' + name.replace('"', '""') + '"'
            state[name] = [dict(r) for r in db.execute('SELECT * FROM ' + quoted + ' ORDER BY rowid')]
        return hashlib.sha256(canonical(state).encode()).hexdigest()

    @contextmanager
    def transaction(self):
        if getattr(self.local, 'db', None) is not None:
            yield self.local.db
            return
        with open(self._lock_path, 'a+b') as lock:
            os.chmod(self._lock_path, 0o600)
            fcntl.flock(lock, fcntl.LOCK_EX)
            with super().transaction() as db:
                if not self.valid_anchor(db):
                    raise ApiError(503, 'RESTORE_QUARANTINED', 'Database and external anchor disagree')
                yield db
