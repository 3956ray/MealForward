"""CP15 isolated SQLite store. No CP11 seed/migration or external RPC inside transactions."""
from contextlib import contextmanager
from pathlib import Path
import sqlite3

class Store:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            version = db.execute('PRAGMA user_version').fetchone()[0]
            if version == 0:
                if db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchone():
                    raise RuntimeError('Refusing non-CP15 database')
                schema = (Path(__file__).parent / 'migrations/001_backend.sql').read_text()
                db.executescript('BEGIN IMMEDIATE;\n' + schema + '\nPRAGMA user_version=1;\nCOMMIT;')
            elif version != 1:
                raise RuntimeError('Unsupported backend schema')
        self.path.chmod(0o600)
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('PRAGMA journal_mode=WAL')
        return db
    @contextmanager
    def transaction(self):
        db = self.connect()
        try:
            db.execute('BEGIN IMMEDIATE')
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()
    def one(self, sql, args=()):
        db = self.connect()
        try:
            row = db.execute(sql,args).fetchone()
            return dict(row) if row else None
        finally: db.close()
    def all(self, sql, args=()):
        db = self.connect()
        try: return [dict(row) for row in db.execute(sql,args)]
        finally: db.close()
    def execute(self, sql, args=()):
        with self.transaction() as db: db.execute(sql,args)
    def create_user(self, user_id, username, password_hash, role, partner_id=None, shop_id=None, enabled=True):
        self.execute('INSERT INTO users VALUES(?,?,?,?,?,?,?)', (user_id,username,password_hash,role,partner_id,shop_id,int(enabled)))
    def get_user_by_username(self, username): return self.one('SELECT * FROM users WHERE username=?',(username,))
    def get_user(self, user_id): return self.one('SELECT * FROM users WHERE id=?',(user_id,))
    def set_user_enabled(self, user_id, enabled):
        with self.transaction() as db:
            db.execute('UPDATE users SET enabled=? WHERE id=?',(int(enabled),user_id))
            if not enabled:
                db.execute('UPDATE work_sessions SET revoked=1 WHERE user_id=?',(user_id,))
    def create_session(self, token_hash, user_id, csrf_hash, created_at, expires_at):
        self.execute('INSERT INTO work_sessions VALUES(?,?,?,?,?,?,0)',(token_hash,user_id,csrf_hash,created_at,expires_at,created_at))
    def get_session(self, token_hash): return self.one('SELECT * FROM work_sessions WHERE token_hash=?',(token_hash,))
    def touch_session(self, token_hash, now): self.execute('UPDATE work_sessions SET last_seen_at=? WHERE token_hash=?',(now,token_hash))
    def revoke_session(self, token_hash): self.execute('UPDATE work_sessions SET revoked=1 WHERE token_hash=?',(token_hash,))
    def auth_failure_count(self, key, now, window):
        return self.one('SELECT count(*) AS n FROM auth_failures WHERE key=? AND occurred_at>?',(key,now-window))['n']
    def record_auth_failure(self, key, now): self.execute('INSERT INTO auth_failures VALUES(?,?)',(key,now))
    def clear_auth_failures(self, key): self.execute('DELETE FROM auth_failures WHERE key=?',(key,))
