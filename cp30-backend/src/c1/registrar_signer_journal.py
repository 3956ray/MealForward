"""Owned append-only original signer responses. No signature generation at import."""
from contextlib import contextmanager
import copy
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import threading
from .encoding import NODE

class SignerClosed(ValueError):pass
def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def word_hash(value):return hashlib.sha256(canonical(value)).hexdigest()

def owned_directory(directory):
    path=Path(directory);info=path.lstat()
    if not path.is_absolute() or not stat.S_ISDIR(info.st_mode) or info.st_uid!=os.getuid() or stat.S_IMODE(info.st_mode)!=0o700:raise SignerClosed('OWNED_RUNTIME_DIRECTORY_REQUIRED')
    return path

class OriginalSignerJournal:
    def __init__(self,directory,*,initialize=False):
        self.directory=owned_directory(directory);self.path=self.directory/'registrar-originals.jsonl';self.mutex=threading.RLock()
        flags=os.O_RDWR|os.O_APPEND|os.O_NOFOLLOW
        if initialize:flags|=os.O_CREAT|os.O_EXCL
        self.fd=os.open(self.path,flags,0o600)
        try:
            info=os.fstat(self.fd)
            if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or stat.S_IMODE(info.st_mode)!=0o600:raise SignerClosed('SIGNER_JOURNAL_REQUIRED')
            # Exclusive for the lifetime: another host cannot share a signing handle.
            fcntl.flock(self.fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
            self.rows={};self.head='0'*64;self.sequence=0;self.failed=False
            if os.fstat(self.fd).st_size>8388608:raise ValueError('EXTERNAL_JOURNAL_LIMIT')
            with os.fdopen(os.dup(self.fd),'rb') as reader:
                for line in reader:
                    if len(line)>262144 or not line.endswith(b'\n'):raise SignerClosed('SIGNER_JOURNAL_DAMAGED')
                    row=json.loads(line);payload={key:row[key] for key in ('sequence','parent','kind','key','data')}
                    if row['sequence']!=self.sequence+1 or row['parent']!=self.head or row['digest']!=word_hash(payload):raise SignerClosed('SIGNER_JOURNAL_DAMAGED')
                    self._apply(payload);self.sequence=row['sequence'];self.head=row['digest']
            if initialize:
                self._append('HEADER','',{'protocol':'CP30_ORIGINAL_SIGNER_V1'})
                directory_fd=os.open(self.directory,os.O_RDONLY);os.fsync(directory_fd);os.close(directory_fd)
            elif not self.sequence:raise SignerClosed('SIGNER_JOURNAL_MISSING')
        except BaseException:
            os.close(self.fd)
            raise
    def _apply(self,row):
        kind,key,data=row['kind'],row['key'],row['data']
        if self.sequence==0 and kind!='HEADER':raise SignerClosed('SIGNER_JOURNAL_MISSING')
        if kind=='HEADER':
            if self.sequence or data!={'protocol':'CP30_ORIGINAL_SIGNER_V1'}:raise SignerClosed('SIGNER_JOURNAL_DAMAGED')
        elif kind=='SIGNING':
            if key in self.rows:raise SignerClosed('SIGNER_ORIGINAL_CONFLICT')
            self.rows[key]=copy.deepcopy(data)
        elif kind=='RETAINED':
            old=self.rows.get(key)
            if old is None or old.get('raw') is not None or old['original']!=data['original']:raise SignerClosed('SIGNER_ORIGINAL_CONFLICT')
            self.rows[key]=copy.deepcopy(data)
        else:raise SignerClosed('SIGNER_JOURNAL_DAMAGED')
    def _append(self,kind,key,data):
        if self.failed:raise SignerClosed('SIGNER_JOURNAL_DAMAGED')
        payload={'sequence':self.sequence+1,'parent':self.head,'kind':kind,'key':key,'data':data};frame={**payload,'digest':word_hash(payload)}
        raw=canonical(frame)+b'\n'
        if len(raw)>262144:raise SignerClosed('SIGNER_JOURNAL_LIMIT')
        if os.fstat(self.fd).st_size+len(raw)>8388608:raise SignerClosed('SIGNER_JOURNAL_LIMIT')
        try:
            view=memoryview(raw)
            while view:
                count=os.write(self.fd,view)
                if count<=0:raise OSError()
                view=view[count:]
            os.fsync(self.fd);self._apply(payload);self.sequence=frame['sequence'];self.head=frame['digest']
        except BaseException:self.failed=True;raise
    def begin(self,key,original):
        with self.mutex:
            old=self.rows.get(key)
            if old is not None:
                if old['original']!=original:raise SignerClosed('SIGNER_ORIGINAL_CONFLICT')
                return False
            self._append('SIGNING',key,{'original':copy.deepcopy(original)});return True
    def retain(self,key,original,raw,transaction_hash):
        with self.mutex:self._append('RETAINED',key,{'original':copy.deepcopy(original),'raw':raw,'transactionHash':transaction_hash})
    def lookup(self,key,original):
        with self.mutex:
            if self.failed:raise SignerClosed('SIGNER_JOURNAL_DAMAGED')
            row=self.rows.get(key)
            if row is not None and row['original']!=original:raise SignerClosed('SIGNER_ORIGINAL_CONFLICT')
            return copy.deepcopy(row)
    def close(self):os.close(self.fd)

class DedicatedRegistrarSigner:
    original_signer_protocol='CP30_ORIGINAL_SIGNER_V1'
    def __init__(self,*,journal,key_handle,registrar,crypto,factory,chain_id):
        self.journal,self.key_handle,self.registrar,self.crypto=journal,Path(key_handle),registrar,crypto
        self.factory,self.chain_id=factory,chain_id
        if self.key_handle.parent.resolve()!=journal.directory.resolve():raise SignerClosed('NEW_DEDICATED_KEY_HANDLE_REQUIRED')
        info=self.key_handle.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or stat.S_IMODE(info.st_mode)!=0o600 or not 64<=info.st_size<=67:raise SignerClosed('NEW_DEDICATED_KEY_HANDLE_REQUIRED')
    def _key(self,record):return word_hash(['registration',record['original']['chainId'],record['original']['factory'],record['registrationId']])
    def expected(self,record):
        d=record['deployment']
        if d['from']!=self.registrar or d['to']!=self.factory or d['chainId']!=self.chain_id or d['value']!='0' or not d['data'].startswith('0xed89c3b2'):raise SignerClosed('DEDICATED_REGISTRAR_SCOPE_REQUIRED')
        plan={'type':'eip1559',**record['transaction'],'gasBudgetWei':record['grant']['gasUnits']}
        return self.crypto.prepare_original_envelope(record['deployment'],plan)
    def lookup_original_transaction(self,record):
        row=self.journal.lookup(self._key(record),record)
        if not row or not row.get('raw'):return None
        observed=self.crypto.inspect_signed_transaction(row['raw'],self.expected(record))
        if observed['hash']!=row['transactionHash']:raise SignerClosed('SIGNER_RETAINED_RAW_CONFLICT')
        return row['raw']
    def sign_original_transaction(self,record):
        expected=self.expected(record)  # Scope/crypto validation before any key handle access.
        key=self._key(record)
        if not self.journal.begin(key,record):
            retained=self.lookup_original_transaction(record)
            if retained is None:raise SignerClosed('ORIGINAL_SIGNING_UNKNOWN')
            return retained
        # SIGNING was fsynced before opening the newly configured dedicated handle.
        fd=os.open(self.key_handle,os.O_RDONLY|os.O_NOFOLLOW)
        try:
            info=os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or stat.S_IMODE(info.st_mode)!=0o600 or not 64<=info.st_size<=67:raise SignerClosed('NEW_DEDICATED_KEY_HANDLE_REQUIRED')
            result=subprocess.run([NODE,str(Path(__file__).with_name('registrar_signer.mjs')),str(fd)],input=canonical({'registrar':self.registrar,'expected':expected}),
                stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env={},pass_fds=(fd,),timeout=5)
            if result.returncode or len(result.stdout)>131072:raise SignerClosed('REGISTRAR_SIGNING_UNKNOWN')
            value=json.loads(result.stdout);raw=value['raw'];observed=self.crypto.inspect_signed_transaction(raw,expected)
            if observed['hash']!=value['hash']:raise SignerClosed('SIGNER_RAW_CONFLICT')
            self.journal.retain(key,record,raw,observed['hash']);return raw
        finally:os.close(fd)
