"""Single issuance SQLite with an external, fsynced anchor."""
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
import re
from pathlib import Path
import sqlite3
import stat
import tempfile
from .chain import OPERATOR,BATCH,IssuanceError,hex_data,derive,issue_data,payload_hash


def digest(value): return hashlib.sha256(value.encode()).hexdigest()
def canonical(value): return json.dumps(value,sort_keys=True,separators=(',',':'))

def private_json(path):
    p=Path(path)
    try:
        info=p.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_mode&0o077 or info.st_size>1024*1024: raise ValueError()
        return json.loads(p.read_text())
    except Exception: raise IssuanceError('PRIVATE_FILE_INVALID',503) from None

def atomic(path,value):
    path=Path(path);fd,tmp=tempfile.mkstemp(prefix='.cp22-',dir=path.parent)
    try:
        os.fchmod(fd,0o600)
        with os.fdopen(fd,'w') as out:
            out.write(canonical(value));out.flush();os.fsync(out.fileno())
        os.replace(tmp,path)
        d=os.open(path.parent,os.O_RDONLY)
        try: os.fsync(d)
        finally: os.close(d)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)

def validate_config(config):
    if set(config)!={'version','issuanceId','batchId','operator','partnerLabel','recipientRef','approved','sourceCommit'} or config['version']!=1 or config['approved'] is not True:
        raise IssuanceError('APPROVED_ISSUANCE_REQUIRED')
    hex_data(config['issuanceId'],32)
    if config['batchId'].lower()!=BATCH: raise IssuanceError('BATCH_FROZEN_REQUIRED')
    if config['operator'].lower()!=OPERATOR: raise IssuanceError('OPERATOR_FROZEN_REQUIRED')
    for key in ('partnerLabel','recipientRef'):
        if not isinstance(config[key],str) or not re.fullmatch('[a-z0-9][a-z0-9-]{0,31}',config[key]): raise IssuanceError('ISSUANCE_INVALID')
    if not isinstance(config['sourceCommit'],str) or not re.fullmatch('[0-9a-f]{40}',config['sourceCommit']): raise IssuanceError('ISSUANCE_INVALID')

class IssuanceStore:
    def __init__(self,directory):
        self.directory=Path(directory);self.path=self.directory/'issuance.sqlite3'
        self.anchor=self.directory.parent/(self.directory.name+'.anchor.json')
        self.lock_path=self.directory.parent/(self.directory.name+'.lock')
    @contextmanager
    def lock(self):
        parent=self.directory.parent
        parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        if parent.is_symlink(): raise IssuanceError('PRIVATE_DIRECTORY_INVALID',503)
        fd=os.open(self.lock_path,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
        try:
            fcntl.flock(fd,fcntl.LOCK_EX)
            yield
        finally: os.close(fd)
    def configured(self): return self.path.exists() or self.anchor.exists()
    def initialize(self,config,height=None):
        validate_config(config)
        with self.lock():
            if self.configured() or self.directory.exists():
                if not self.configured(): raise IssuanceError('ISSUANCE_ALREADY_EXISTS')
                record=self.load()
                if canonical(record['config'])!=canonical(config): raise IssuanceError('INTENT_CONFLICT',409)
                return record
            if type(height) is not int or height<0: raise IssuanceError('ISSUANCE_INVALID')
            self.directory.mkdir(mode=0o700)
            operation_id,voucher_id=derive(config['issuanceId'])
            record={'config':config,'planHash':digest(canonical(config)),
                    'operationId':operation_id,'voucherId':voucher_id,'batchId':BATCH,
                    'data':issue_data(operation_id,BATCH,voucher_id),
                    'expectedPayloadHash':payload_hash(BATCH,[voucher_id]),
                    'phase':'PREPARED','status':'PREPARED','txHash':None,'errorCode':None,
                    'scanStart':height,'scanThrough':height-1,'scanHash':None,
                    'receiptBlock':None,'receiptBlockHash':None,'finalizedBlock':None,'gasFeeWei':None,
                    'accounting':None,'budgetViolation':False,'budgetEvidence':None,
                    'finalizedReceipt':None,'receiptConflict':None}
            # The watermark is part of this first atomic anchor+DB write: a crash before it
            # leaves no record at all; a persisted record without a watermark is quarantined
            # by load() rather than silently repaired.
            self.write_anchor(record,'PREPARED')  # a missing DB after a crash is quarantined
            fd=os.open(self.path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600);os.close(fd)
            with sqlite3.connect(self.path) as db:
                db.execute('PRAGMA synchronous=FULL')
                db.execute('CREATE TABLE issuance (id INTEGER PRIMARY KEY CHECK(id=1), record TEXT NOT NULL)')
                db.execute('INSERT INTO issuance VALUES(1,?)',(canonical(record),))
            return record
    def load(self):
        if not self.path.exists() or not self.anchor.exists(): raise IssuanceError('RESTORE_QUARANTINE',503)
        try:
            if self.directory.is_symlink() or self.directory.stat().st_mode&0o077: raise ValueError()
            info=self.path.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_mode&0o077: raise ValueError()
            with sqlite3.connect('file:'+str(self.path)+'?mode=rw',uri=True) as db:
                rows=db.execute('SELECT record FROM issuance').fetchall()
            if len(rows)!=1: raise ValueError()
            record=json.loads(rows[0][0]);anchor=private_json(self.anchor)
            expected={'planHash':record['planHash'],'operationId':record['operationId'],'phase':record['phase']}
            if anchor!=expected or digest(canonical(record['config']))!=record['planHash']: raise ValueError()
            validate_config(record['config'])
            operation_id,voucher_id=derive(record['config']['issuanceId'])
            if (record['operationId']!=operation_id or record['voucherId']!=voucher_id or record['batchId']!=BATCH or
                record['data']!=issue_data(operation_id,BATCH,voucher_id) or
                record['expectedPayloadHash']!=payload_hash(BATCH,[voucher_id])): raise ValueError()
            record.setdefault('budgetViolation',False);record.setdefault('budgetEvidence',None)
            record.setdefault('finalizedReceipt',None);record.setdefault('receiptConflict',None)
            # A persisted record without a valid watermark is a half-initialized leftover:
            # quarantine (never observe, never silently repair; CP21 consistency semantics).
            if type(record['scanStart']) is not int or record['scanStart']<0 or type(record['scanThrough']) is not int or record['scanThrough']<record['scanStart']-1: raise ValueError()
            return record
        except IssuanceError: raise
        except Exception: raise IssuanceError('RESTORE_QUARANTINE',503) from None
    def write_anchor(self,record,phase):
        atomic(self.anchor,{'planHash':record['planHash'],'operationId':record['operationId'],'phase':phase})
    def save(self,record):
        with sqlite3.connect('file:'+str(self.path)+'?mode=rw',uri=True) as db:
            db.execute('PRAGMA synchronous=FULL')
            db.execute('UPDATE issuance SET record=? WHERE id=1',(canonical(record),))
    def transition(self,record,phase):
        record['phase']=phase
        self.write_anchor(record,phase)
        self.save(record)
