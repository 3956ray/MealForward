import json
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from .identity import MANIFEST, START, ReadError

class ReadStore:
    def __init__(self, path):
        self.path=Path(path).resolve(); self.path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
        self.path.parent.chmod(0o700)
        with self.connect() as db:
            tables=db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
            version=db.execute('PRAGMA user_version').fetchone()[0]
            if not tables:
                db.executescript('''BEGIN IMMEDIATE;
                  CREATE TABLE state(id INTEGER PRIMARY KEY CHECK(id=1), identity TEXT NOT NULL, origin TEXT NOT NULL,
                  snapshot TEXT, cursor INTEGER NOT NULL, cursor_hash TEXT, halted TEXT, attempt_at TEXT, error TEXT);
                  CREATE TABLE events(tx TEXT NOT NULL, log_index INTEGER NOT NULL, block INTEGER NOT NULL,
                  block_hash TEXT NOT NULL, tx_index INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(tx,log_index));
                  PRAGMA user_version=20; COMMIT;''')
                db.execute('INSERT INTO state VALUES(1,?,?,NULL,?,NULL,NULL,NULL,NULL)',
                           (json.dumps(MANIFEST,sort_keys=True),str(self.path),START-1))
            elif version!=20: raise ReadError('DATABASE_IDENTITY',True)
            row=db.execute('SELECT * FROM state WHERE id=1').fetchone()
            if row['identity']!=json.dumps(MANIFEST,sort_keys=True): raise ReadError('DATABASE_IDENTITY',True)
            if row['origin']!=str(self.path): db.execute("UPDATE state SET halted='RESTORE_QUARANTINED' WHERE id=1")
        self.path.chmod(0o600)
    @contextmanager
    def connect(self):
        db=sqlite3.connect(str(self.path),isolation_level=None,timeout=2)
        db.row_factory=sqlite3.Row
        try: yield db
        finally: db.close()
    def state(self):
        with self.connect() as db: return dict(db.execute('SELECT * FROM state WHERE id=1').fetchone())
    def attempt(self, at):
        with self.connect() as db: db.execute('UPDATE state SET attempt_at=? WHERE id=1',(at,))
    def failure(self, error):
        with self.connect() as db:
            db.execute('UPDATE state SET error=?,halted=coalesce(halted,?) WHERE id=1',
                       (error.code,error.code if error.conflict else None))
    def snapshot(self, data):
        with self.connect() as db:
            db.execute('UPDATE state SET snapshot=?,error=NULL WHERE id=1',(json.dumps(data),))
    def save_events(self, events, cursor=None, cursor_hash=None):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            try:
                if cursor is not None:
                    low=db.execute('SELECT cursor FROM state WHERE id=1').fetchone()[0]+1
                    observed={(e['transactionHash'],e['logIndex']):e for e in events}
                    known=db.execute('SELECT tx,log_index,data FROM events WHERE block>=? AND block<=?',(low,cursor)).fetchall()
                    # Receipt-verified evidence must also be present in the contiguous scan.
                    # Check inside the page/cursor transaction so failure commits neither.
                    if any(observed.get((row['tx'],row['log_index']))!=json.loads(row['data']) for row in known):
                        raise ReadError('SCAN_CONFLICT',True)
                for e in events:
                    payload=json.dumps(e,sort_keys=True)
                    old=db.execute('SELECT data FROM events WHERE tx=? AND log_index=?',(e['transactionHash'],e['logIndex'])).fetchone()
                    if old and old['data']!=payload: raise ReadError('EVENT_CONFLICT',True)
                    db.execute('INSERT OR IGNORE INTO events VALUES(?,?,?,?,?,?)',
                               (e['transactionHash'],e['logIndex'],e['blockNumber'],e['blockHash'],e['transactionIndex'],payload))
                if cursor is not None:
                    db.execute('UPDATE state SET cursor=?,cursor_hash=? WHERE id=1',(cursor,cursor_hash))
                db.execute('COMMIT')
            except BaseException: db.execute('ROLLBACK'); raise
    def events(self):
        with self.connect() as db:
            return [json.loads(row[0]) for row in db.execute('SELECT data FROM events ORDER BY block,tx_index,log_index')]
