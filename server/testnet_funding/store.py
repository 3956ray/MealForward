"""Single campaign SQLite with an external, fsynced consumption anchor."""
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import secrets
import sqlite3
import stat
import tempfile
from eth_abi import encode
from eth_utils import keccak
from .chain import ADDRESS,RULE,PRICE,FundingError,address,hex_data,encode_call


def digest(value): return hashlib.sha256(value.encode()).hexdigest()
def canonical(value): return json.dumps(value,sort_keys=True,separators=(',',':'))

def private_json(path):
    p=Path(path)
    try:
        info=p.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_mode&0o077 or info.st_size>1024*1024: raise ValueError()
        return json.loads(p.read_text())
    except Exception: raise FundingError('PRIVATE_FILE_INVALID',503) from None

def atomic(path,value):
    path=Path(path);fd,tmp=tempfile.mkstemp(prefix='.cp21-',dir=path.parent)
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

class FundingStore:
    def __init__(self,directory):
        self.directory=Path(directory);self.path=self.directory/'funding.sqlite3'
        self.anchor=self.directory.parent/(self.directory.name+'.anchor.json')
        self.lock_path=self.directory.parent/(self.directory.name+'.lock')
    @contextmanager
    def lock(self):
        parent=self.directory.parent
        parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        if parent.is_symlink(): raise FundingError('PRIVATE_DIRECTORY_INVALID',503)
        fd=os.open(self.lock_path,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
        try:
            fcntl.flock(fd,fcntl.LOCK_EX)
            yield
        finally: os.close(fd)
    def configured(self): return self.path.exists() or self.anchor.exists()
    def initialize(self,config):
        import re
        if set(config)!={'version','campaignId','payer','nonce','approved','sourceCommit'} or config['version']!=1 or config['approved'] is not True:
            raise FundingError('APPROVED_CAMPAIGN_REQUIRED')
        hex_data(config['campaignId'],32);payer=address(config['payer'])
        if type(config['nonce']) is not int or config['nonce']<0 or not isinstance(config['sourceCommit'],str) or not re.fullmatch('[0-9a-f]{40}',config['sourceCommit']): raise FundingError('CAMPAIGN_INVALID')
        with self.lock():
            if self.configured() or self.directory.exists(): raise FundingError('CAMPAIGN_ALREADY_EXISTS')
            self.directory.mkdir(mode=0o700)
            intent='0x'+keccak(text='mealforward-cp21:'+config['campaignId']).hex()
            batch='0x'+keccak(encode(['uint256','address','address','bytes32'],[10143,ADDRESS,payer,hex_data(intent)])).hex()
            record={'config':config,'planHash':digest(canonical(config)), 'intentId':intent,'batchId':batch,
                    'data':encode_call('fund',[intent,1,RULE]),'phase':'PREPARED','capHash':None,'capExpires':None,
                    'status':'PREPARED','submitted':False,'txHash':None,'review':None,'transaction':None,
                    'errorCode':None,'scanStart':None,'scanThrough':None,'scanHash':None,
                    'receiptBlock':None,'receiptBlockHash':None,'finalizedBlock':None,'gasFeeWei':None,'accounting':None}
            self.write_anchor(record,'PREPARED')  # a missing DB after a crash is quarantined
            fd=os.open(self.path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600);os.close(fd)
            with sqlite3.connect(self.path) as db:
                db.execute('PRAGMA synchronous=FULL')
                db.execute('CREATE TABLE campaign (id INTEGER PRIMARY KEY CHECK(id=1), record TEXT NOT NULL)')
                db.execute('INSERT INTO campaign VALUES(1,?)',(canonical(record),))
    def load(self):
        if not self.path.exists() or not self.anchor.exists(): raise FundingError('RESTORE_QUARANTINE',503)
        try:
            if self.directory.is_symlink() or self.directory.stat().st_mode&0o077: raise ValueError()
            info=self.path.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_mode&0o077: raise ValueError()
            with sqlite3.connect('file:'+str(self.path)+'?mode=rw',uri=True) as db:
                rows=db.execute('SELECT record FROM campaign').fetchall()
            if len(rows)!=1: raise ValueError()
            record=json.loads(rows[0][0]);anchor=private_json(self.anchor)
            expected={'planHash':record['planHash'],'intentId':record['intentId'],'phase':record['phase'],'capHash':record['capHash']}
            if anchor!=expected or digest(canonical(record['config']))!=record['planHash']: raise ValueError()
            if record['submitted']!=(record['phase']=='CONSUMED'): raise ValueError()
            return record
        except Exception: raise FundingError('RESTORE_QUARANTINE',503) from None
    def write_anchor(self,record,phase):
        atomic(self.anchor,{'planHash':record['planHash'],'intentId':record['intentId'],'phase':phase,'capHash':record['capHash']})
    def save(self,record):
        with sqlite3.connect('file:'+str(self.path)+'?mode=rw',uri=True) as db:
            db.execute('PRAGMA synchronous=FULL')
            db.execute('UPDATE campaign SET record=? WHERE id=1',(canonical(record),))
    def transition(self,record,phase):
        record['phase']=phase
        self.write_anchor(record,phase)
        self.save(record)
    @staticmethod
    def require_cap(record,token,now):
        if not token or not record['capHash'] or not secrets.compare_digest(record['capHash'],digest(token)) or now>=record['capExpires']:
            raise FundingError('ORIGINAL_ACCESS_REQUIRED',401)
