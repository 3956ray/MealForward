"""Atomic private journal; one run-wide lock includes the independent owner client."""
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile
from .rpc import Stop, ROOT

DIRECTORY=ROOT/'.localbackend/cp19-testnet'


def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()


def read_private(path):
    try:
        info=path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_size>4*1024*1024:
            raise Stop('PRIVATE_FILE_INVALID')
        return json.loads(path.read_text())
    except Stop: raise
    except Exception: raise Stop('PRIVATE_FILE_INVALID') from None


def atomic(path, value):
    path=Path(path)
    fd,tmp=tempfile.mkstemp(prefix='.cp19-',dir=path.parent)
    try:
        os.fchmod(fd,0o600)
        with os.fdopen(fd,'w') as out:
            json.dump(value,out,sort_keys=True,indent=2)
            out.flush();os.fsync(out.fileno())
        os.replace(tmp,path)
        directory=os.open(path.parent,os.O_RDONLY)
        try: os.fsync(directory)
        finally: os.close(directory)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)


class Journal:
    def __init__(self,directory=DIRECTORY):
        self.directory=Path(directory)
        self.path=self.directory/'journal.json'

    @contextmanager
    def locked(self):
        self.directory.mkdir(parents=True,exist_ok=True,mode=0o700)
        if self.directory.is_symlink() or self.directory.stat().st_mode & 0o077: raise Stop('PRIVATE_DIRECTORY_INVALID')
        fd=os.open(self.directory/'run.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
        try:
            try: fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
            except BlockingIOError: raise Stop('RUN_IN_PROGRESS') from None
            yield
        finally: os.close(fd)

    def load(self):
        data=read_private(self.path)
        try:
            if data['version']!=1 or digest(data['plan'])!=data['planHash']: raise Stop('PLAN_CHANGED')
            if not isinstance(data['records'],dict) or not isinstance(data['fundingSeen'],dict): raise Stop('JOURNAL_INVALID')
        except (KeyError,TypeError): raise Stop('JOURNAL_INVALID') from None
        return data

    def save(self,data): atomic(self.path,data)
