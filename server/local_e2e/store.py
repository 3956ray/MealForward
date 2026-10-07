"""One acceptance transaction across the existing domain service calls."""
import threading
import hashlib
import json
import os
from server.contracts import ApiError
from contextlib import contextmanager
from server.storage import Store

class LocalStore(Store):
    def __init__(self, path):
        self.local = threading.local()
        super().__init__(path)
        with self.connect() as db:
            db.executescript('''
CREATE TABLE IF NOT EXISTS cp24_bridge(hash TEXT PRIMARY KEY, state TEXT NOT NULL, nonce INTEGER, raw_cipher TEXT, tx_hash TEXT, signature TEXT, signs INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS cp24_instance(id INTEGER PRIMARY KEY CHECK(id=1), support_token TEXT, support_key TEXT NOT NULL, issue_key TEXT NOT NULL, ref TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cp24_invite(id INTEGER PRIMARY KEY CHECK(id=1), voucher_id TEXT NOT NULL, hash TEXT NOT NULL, expires INTEGER NOT NULL, opened INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS cp24_session(hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS cp24_display(id INTEGER PRIMARY KEY CHECK(id=1), session_hash TEXT NOT NULL, qr_hash TEXT NOT NULL, code_hash TEXT NOT NULL, expires INTEGER NOT NULL, consumed TEXT);
CREATE TABLE IF NOT EXISTS cp24_terminal(redemption_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, hash TEXT NOT NULL, version INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS cp24_audit(id INTEGER PRIMARY KEY, redemption_id TEXT NOT NULL, actor TEXT NOT NULL, old_hash TEXT, new_hash TEXT, event TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS cp24_notes(id INTEGER PRIMARY KEY, redemption_id TEXT NOT NULL, actor TEXT NOT NULL, text TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS cp24_tickets(hash TEXT PRIMARY KEY, kind TEXT NOT NULL, operation_id TEXT NOT NULL, session_id TEXT, terminal_version INTEGER, payload TEXT NOT NULL, expires INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'PREPARED', result TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS cp24_ticket_operation ON cp24_tickets(kind,operation_id);
''')
        self.anchor = self.path.parent.parent / (self.path.parent.name + '.cp24-anchor.json')
        with self.connect() as db:
            if not self.anchor.exists() and not db.execute('SELECT 1 FROM cp24_instance').fetchone():
                self.save_anchor(self.fingerprint(db))
    def fingerprint(self,db):
        names=['cp24_instance','cp24_invite','cp24_session','cp24_display','cp24_terminal','cp24_audit','cp24_notes','cp24_tickets','cp24_bridge',
               'operations','outbox','redemptions','handoff_statements','voucher_claims']
        data={name:[dict(r) for r in db.execute('SELECT * FROM '+name+' ORDER BY rowid')] for name in names}
        return hashlib.sha256(json.dumps(data,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    def valid_anchor(self,db):
        try: return self.anchor.read_text().strip()==self.fingerprint(db)
        except OSError: return False
    def save_anchor(self,value):
        temp=self.anchor.with_suffix('.tmp')
        with open(temp,'w') as f:
            os.chmod(temp,0o600);f.write(value+'\n');f.flush();os.fsync(f.fileno())
        os.replace(temp,self.anchor)
        fd=os.open(str(self.anchor.parent),os.O_RDONLY)
        try: os.fsync(fd)
        finally: os.close(fd)
    @contextmanager
    def transaction(self):
        current = getattr(self.local, 'db', None)
        if current is not None:
            yield current
            return
        with super().transaction() as db:
            self.local.db = db
            before=self.fingerprint(db);valid=self.valid_anchor(db)
            self.local.anchor_valid=valid
            try:
                yield db
                after=self.fingerprint(db)
                if after!=before:
                    if not valid: raise ApiError(503,'RESTORE_QUARANTINE','本地数据与独立记录不一致，请保留原记录核对')
                    # Anchor first: a crash between this write and SQLite commit fails closed.
                    self.save_anchor(after)
            finally: self.local.db = None
    def one(self, sql, args=()):
        db = getattr(self.local, 'db', None)
        if db is None: return super().one(sql, args)
        row = db.execute(sql,args).fetchone()
        return dict(row) if row else None
    def all(self, sql, args=()):
        db = getattr(self.local, 'db', None)
        return [dict(r) for r in db.execute(sql,args)] if db else super().all(sql,args)
