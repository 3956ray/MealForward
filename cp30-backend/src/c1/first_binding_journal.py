"""Independent first-store binding retention; missing state is never recreated."""
import copy,fcntl,json,os,stat
from .registrar_signer_journal import owned_directory,canonical,word_hash

class BindingClosed(ValueError):pass
class FirstBindingJournal:
    def __init__(self,directory,template_digest,*,initialize=False):
        self.directory=owned_directory(directory);self.path=self.directory/'first-binding.jsonl';self.template_digest=template_digest
        flags=os.O_RDWR|os.O_APPEND|os.O_NOFOLLOW
        if initialize:flags|=os.O_CREAT|os.O_EXCL
        self.fd=os.open(self.path,flags,0o600);self.head='0'*64;self.sequence=0;self.original=None;self.roles={};self.bound=None;self.failed=False
        try:
            info=os.fstat(self.fd)
            if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or stat.S_IMODE(info.st_mode)!=0o600 or info.st_nlink!=1 or info.st_size>2097152:raise BindingClosed('PRIVATE_BINDING_JOURNAL_REQUIRED')
            fcntl.flock(self.fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
            with os.fdopen(os.dup(self.fd),'rb') as f:
                for line in f:
                    if not line.endswith(b'\n') or len(line)>262144:raise BindingClosed('BINDING_JOURNAL_DAMAGED')
                    row=json.loads(line);payload={key:row[key] for key in ('sequence','parent','kind','data')}
                    if row['sequence']!=self.sequence+1 or row['parent']!=self.head or row['digest']!=word_hash(payload):raise BindingClosed('BINDING_JOURNAL_DAMAGED')
                    self._apply(row);self.sequence=row['sequence'];self.head=row['digest']
            if initialize:self.append('HEADER',{'templateDigest':template_digest})
            elif not self.sequence:raise BindingClosed('BINDING_JOURNAL_MISSING')
        except BaseException:os.close(self.fd);raise
    def _apply(self,row):
        kind,data=row['kind'],row['data']
        if kind=='HEADER':
            if self.sequence or data!={'templateDigest':self.template_digest}:raise BindingClosed('BINDING_TEMPLATE_CHANGED')
        elif kind=='PREPARED':
            if self.original is not None:raise BindingClosed('ORIGINAL_FIRST_BINDING_REQUIRED')
            self.original=copy.deepcopy(data)
        elif kind=='CREATE_INTENT':
            if self.original is None or data['role'] in self.roles:raise BindingClosed('ORIGINAL_ROLE_CREATION_REQUIRED')
            self.roles[data['role']]={'intent':copy.deepcopy(data),'created':False}
        elif kind=='ROLE_CREATED':
            value=self.roles.get(data['role'])
            if not value or value['created']:raise BindingClosed('ORIGINAL_ROLE_CREATION_REQUIRED')
            value['created']=True
        elif kind=='BOUND':
            if self.original is None or self.bound or set(self.roles)!={'quoteAuthority','issuerAuthority','operatorAuthority'} or not all(v['created'] for v in self.roles.values()):raise BindingClosed('COMPLETE_ORIGINAL_ROLE_JOURNALS_REQUIRED')
            self.bound={'profileDigest':data['profileDigest'],'journalDigest':row['digest']}
        else:raise BindingClosed('BINDING_JOURNAL_DAMAGED')
    def append(self,kind,data):
        if self.failed:raise BindingClosed('BINDING_JOURNAL_DAMAGED')
        payload={'sequence':self.sequence+1,'parent':self.head,'kind':kind,'data':copy.deepcopy(data)};row={**payload,'digest':word_hash(payload)};raw=canonical(row)+b'\n'
        if len(raw)>262144 or os.fstat(self.fd).st_size+len(raw)>2097152:raise BindingClosed('BINDING_JOURNAL_LIMIT')
        try:
            view=memoryview(raw)
            while view:
                count=os.write(self.fd,view)
                if count<=0:raise OSError()
                view=view[count:]
            os.fsync(self.fd);self._apply(row);self.sequence=row['sequence'];self.head=row['digest']
            fd=os.open(self.directory,os.O_RDONLY);os.fsync(fd);os.close(fd)
        except BaseException:self.failed=True;raise
        return copy.deepcopy(row)
    def close(self):os.close(self.fd)
