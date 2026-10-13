"""Private original-only authority signer source. No key is read/signature produced at import."""
from copy import deepcopy
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import threading

PROTOCOL='CP30_ORIGINAL_SIGNER_V1'
ROLES={'quoteAuthority','issuerAuthority','operatorAuthority','catalogAuthority'}
OPERATIONS={'publish':('catalogAuthority','preparePublish'),'setListed':('catalogAuthority','prepareSetListed'),'issue':('issuerAuthority','prepareIssue'),'lock':('operatorAuthority','prepareLock'),
            'markHandover':('operatorAuthority','prepareMarkHandover'),'report':('operatorAuthority','prepareReport')}
BINDING=('escrow','asset','storeId','owner','receiver','quoteAuthority','catalogAuthority','issuerAuthority','operatorAuthority')


class OriginalSignerClosed(ValueError): pass

def canonical(value):
    try: return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
    except (TypeError,ValueError): raise OriginalSignerClosed('ORIGINAL_SIGNER_INPUT_REJECTED') from None


def digest(value): return hashlib.sha256(canonical(value)).hexdigest()
def word(value):
    if type(value) is not str or not re.fullmatch(r'0x[0-9a-f]{64}',value) or int(value,16)==0: raise OriginalSignerClosed('ORIGINAL_SIGNER_INPUT_REJECTED')
    return value

def address(value):
    if type(value) is not str or not re.fullmatch(r'0x[0-9a-f]{40}',value) or int(value,16)==0: raise OriginalSignerClosed('ORIGINAL_SIGNER_INPUT_REJECTED')
    return value

def uint(value):
    if type(value) is not str or not re.fullmatch(r'(0|[1-9][0-9]{0,77})',value) or int(value)>=2**256: raise OriginalSignerClosed('ORIGINAL_SIGNER_INPUT_REJECTED')
    return int(value)


def approved_profile(profile,role):
    fields={'namespace','binding','escrowCodeHash','chainProfileDigest','registrar','maxGas','maxFeePerGas','maxPriorityFeePerGas','maxTransactionCostWei'}
    if role not in ROLES or type(profile) is not dict or set(profile)!=fields: raise OriginalSignerClosed('DEDICATED_AUTHORITY_PROFILE_REQUIRED')
    b=profile['binding']
    if type(b) is not dict or set(b)!={'chainId',*BINDING} or type(b['chainId']) is not int or not 1<=b['chainId']<2**53: raise OriginalSignerClosed('DEDICATED_AUTHORITY_PROFILE_REQUIRED')
    for field in BINDING: (word if field=='storeId' else address)(b[field])
    if b['owner']!=b['receiver'] or b[role] in (b['owner'],address(profile['registrar'])): raise OriginalSignerClosed('OWNER_REGISTRAR_KEY_FORBIDDEN')
    if type(profile['namespace']) is not str or not 1<=len(profile['namespace'])<=256: raise OriginalSignerClosed('DEDICATED_AUTHORITY_PROFILE_REQUIRED')
    word(profile['escrowCodeHash']);word(profile['chainProfileDigest'])
    for field in ('maxGas','maxFeePerGas','maxTransactionCostWei'):
        if uint(profile[field])==0: raise OriginalSignerClosed('DEDICATED_AUTHORITY_PROFILE_REQUIRED')
    if uint(profile['maxPriorityFeePerGas'])>uint(profile['maxFeePerGas']): raise OriginalSignerClosed('DEDICATED_AUTHORITY_PROFILE_REQUIRED')
    return deepcopy(profile)


class AuthorityOriginalJournal:
    """Dedicated owned append-only response journal; Main's ledger/restore fence is separate."""
    def __init__(self, directory, *, role, profile, initialize=False):
        self.profile=approved_profile(profile,role);self.role=role;self.account=self.profile['binding'][role]
        path=Path(directory)
        if not path.is_absolute(): raise OriginalSignerClosed('OWNED_SIGNER_DIRECTORY_REQUIRED')
        info=path.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid!=os.getuid() or stat.S_IMODE(info.st_mode)!=0o700: raise OriginalSignerClosed('OWNED_SIGNER_DIRECTORY_REQUIRED')
        self.directory=path;self.directory_fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        opened=os.fstat(self.directory_fd)
        if opened.st_dev!=info.st_dev or opened.st_ino!=info.st_ino or opened.st_uid!=os.getuid() or stat.S_IMODE(opened.st_mode)!=0o700:
            os.close(self.directory_fd);raise OriginalSignerClosed('OWNED_SIGNER_DIRECTORY_REQUIRED')
        self.lock=threading.RLock();self.failed=False;self.rows={};self.nonces={};self.sequence=0;self.head='0'*64
        flags=os.O_RDWR|os.O_APPEND|os.O_NOFOLLOW
        if initialize: flags|=os.O_CREAT|os.O_EXCL
        try:
            self.fd=os.open('business-authority-originals.jsonl',flags,0o600,dir_fd=self.directory_fd)
            info=os.fstat(self.fd)
            if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or info.st_nlink!=1 or stat.S_IMODE(info.st_mode)!=0o600 or info.st_size>8388608: raise OriginalSignerClosed('OWNED_SIGNER_JOURNAL_REQUIRED')
            fcntl.flock(self.fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
            with os.fdopen(os.dup(self.fd),'rb') as reader:
                for line in reader:
                    if len(line)>262144 or not line.endswith(b'\n'): raise OriginalSignerClosed('SIGNER_JOURNAL_DAMAGED')
                    row=json.loads(line)
                    if type(row) is not dict or set(row)!={'sequence','parent','kind','key','data','digest'}: raise OriginalSignerClosed('SIGNER_JOURNAL_DAMAGED')
                    payload={k:row[k] for k in ('sequence','parent','kind','key','data')}
                    if type(row['sequence']) is not int or row['sequence']!=self.sequence+1 or row['parent']!=self.head or row['digest']!=digest(payload): raise OriginalSignerClosed('SIGNER_JOURNAL_DAMAGED')
                    self._apply(payload);self.sequence=row['sequence'];self.head=row['digest']
            if initialize:
                self._append('HEADER','',{'protocol':PROTOCOL,'role':role,'profile':self.profile})
                os.fsync(self.directory_fd)
            elif self.sequence==0: raise OriginalSignerClosed('SIGNER_JOURNAL_MISSING')
        except Exception:
            if hasattr(self,'fd'): os.close(self.fd)
            os.close(self.directory_fd)
            raise OriginalSignerClosed('SIGNER_JOURNAL_UNAVAILABLE') from None

    def _apply(self,row):
        kind,key,data=row['kind'],row['key'],row['data']
        if kind=='HEADER':
            if self.sequence or key!='' or data!={'protocol':PROTOCOL,'role':self.role,'profile':self.profile}: raise OriginalSignerClosed('SIGNER_JOURNAL_PROFILE_CONFLICT')
        elif kind=='SIGNING':
            if key in self.rows or set(data)!={'original','nonce'}: raise OriginalSignerClosed('SIGNER_ORIGINAL_CONFLICT')
            nonce=data['nonce']
            if nonce is not None:
                uint(nonce)
                if nonce in self.nonces: raise OriginalSignerClosed('SIGNER_NONCE_CONFLICT')
                self.nonces[nonce]=key
            self.rows[key]={**deepcopy(data),'stage':'SIGNING'}
        elif kind=='RETAINED':
            old=self.rows.get(key)
            if old is None or old['stage']!='SIGNING' or set(data)!={'original','response'} or old['original']!=data['original']: raise OriginalSignerClosed('SIGNER_ORIGINAL_CONFLICT')
            self.rows[key]={**deepcopy(old),'response':deepcopy(data['response']),'stage':'RETAINED'}
        else: raise OriginalSignerClosed('SIGNER_JOURNAL_DAMAGED')

    def _append(self,kind,key,data):
        if self.failed: raise OriginalSignerClosed('SIGNER_JOURNAL_CLOSED')
        payload={'sequence':self.sequence+1,'parent':self.head,'kind':kind,'key':key,'data':deepcopy(data)}
        frame={**payload,'digest':digest(payload)};raw=canonical(frame)+b'\n'
        if len(raw)>262144 or os.fstat(self.fd).st_size+len(raw)>8388608: raise OriginalSignerClosed('SIGNER_JOURNAL_LIMIT')
        try:
            view=memoryview(raw)
            while view:
                n=os.write(self.fd,view)
                if n<=0: raise OSError()
                view=view[n:]
            os.fsync(self.fd)  # Durable intent/result precedes all worker invocation/return.
            self._apply(payload);self.sequence=frame['sequence'];self.head=frame['digest']
        except Exception:
            self.failed=True
            raise OriginalSignerClosed('SIGNER_JOURNAL_CLOSED') from None

    def lookup(self,key,original):
        with self.lock:
            if self.failed: raise OriginalSignerClosed('SIGNER_JOURNAL_CLOSED')
            row=self.rows.get(key)
            if row is not None and row['original']!=original: raise OriginalSignerClosed('SIGNER_ORIGINAL_CONFLICT')
            return deepcopy(row)

    def begin(self,key,original,nonce=None):
        with self.lock:
            old=self.lookup(key,original)
            if old is not None: return False
            if nonce is not None and nonce in self.nonces: raise OriginalSignerClosed('SIGNER_NONCE_CONFLICT')
            self._append('SIGNING',key,{'original':original,'nonce':nonce});return True

    def retain(self,key,original,response):
        with self.lock: self._append('RETAINED',key,{'original':original,'response':response})

    def close(self):
        with self.lock:
            if not self.failed: self.failed=True
            if self.fd is not None:
                os.close(self.fd);os.close(self.directory_fd);self.fd=None;self.directory_fd=None


class DedicatedBusinessSigner:
    original_signer_protocol=PROTOCOL
    def __init__(self, *, role, profile, journal, business_codec, transaction_crypto, worker, clock):
        self.profile=approved_profile(profile,role);self.role=role;self.account=self.profile['binding'][role]
        if journal.profile!=self.profile or journal.role!=role or not callable(getattr(business_codec,'call',None)) or getattr(transaction_crypto,'transaction_codec_protocol',None)!='CP30_CANONICAL_SIGNED_TRANSACTION_V1' or any(not callable(getattr(transaction_crypto,k,None)) for k in ('prepare_original_envelope','inspect_signed_transaction')) or not callable(clock): raise OriginalSignerClosed('DEDICATED_SIGNER_ADAPTER_REQUIRED')
        if not all(callable(getattr(worker,k,None)) for k in ('sign_quote','sign_transaction')): raise OriginalSignerClosed('DEDICATED_SIGNER_ADAPTER_REQUIRED')
        self.journal,self.business,self.crypto,self.worker,self.clock=journal,business_codec,transaction_crypto,worker,clock

    def _scope(self,record):
        if type(record) is not dict or any(record.get(k)!=self.profile[k] for k in ('namespace','binding','escrowCodeHash','chainProfileDigest')): raise OriginalSignerClosed('DEDICATED_AUTHORITY_SCOPE_REQUIRED')
        if len(canonical(record))>131072: raise OriginalSignerClosed('ORIGINAL_SIGNER_INPUT_LIMIT')

    def _key(self,record,quote=False):
        return digest(['quote' if quote else 'transaction',self.role,self.account,self.profile['binding']['chainId'],self.profile['binding']['escrow'],word(record['quoteId' if quote else 'opId'])])

    def _quote(self,record):
        self._scope(record)
        if self.role!='quoteAuthority' or any(k in record for k in ('operation','deployment','transaction')): raise OriginalSignerClosed('PRIVATE_SIGNER_OPERATION_FORBIDDEN')
        prepared=self.business.call('prepareFundingQuote',{'binding':record['binding'],'quote':record['quote'],'now':'0'})
        if record.get('quoteId')!=record['quote'].get('quoteId') or prepared.get('quote')!=record['quote'] or prepared.get('typedData')!=record.get('typedData') or prepared.get('digest')!=word(record.get('digest')): raise OriginalSignerClosed('ORIGINAL_QUOTE_MISMATCH')
        word(prepared.get('payloadHash'))
        return prepared

    def _transaction(self,record):
        self._scope(record)
        operation=record.get('operation');config=OPERATIONS.get(operation)
        if config is None or config[0]!=self.role: raise OriginalSignerClosed('PRIVATE_SIGNER_OPERATION_FORBIDDEN')
        prepared=self.business.call(config[1],{'binding':record['binding'],'caller':self.account,'parameters':record['parameters'],'now':'0'})
        if prepared!=record.get('deployment') or prepared.get('opId')!=word(record.get('opId')) or prepared.get('expectedRole')!=self.role or prepared.get('functionName')!=operation or prepared.get('from')!=self.account or prepared.get('to')!=self.profile['binding']['escrow'] or prepared.get('chainId')!=self.profile['binding']['chainId'] or prepared.get('value')!='0': raise OriginalSignerClosed('ORIGINAL_OPERATION_MISMATCH')
        for field in ('paramsDigest','parametersHash','callDataDigest'): word(prepared.get(field))
        transaction=record.get('transaction')
        if type(transaction) is not dict or set(transaction)!={'nonce','gas','maxFeePerGas','maxPriorityFeePerGas'}: raise OriginalSignerClosed('ORIGINAL_TRANSACTION_PLAN_REQUIRED')
        values={k:uint(v) for k,v in transaction.items()}
        if values['nonce']>9007199254740991 or not 0<values['gas']<=uint(self.profile['maxGas']) or not 0<values['maxFeePerGas']<=uint(self.profile['maxFeePerGas']) or not 0<=values['maxPriorityFeePerGas']<=min(values['maxFeePerGas'],uint(self.profile['maxPriorityFeePerGas'])) or values['gas']*values['maxFeePerGas']>uint(self.profile['maxTransactionCostWei']): raise OriginalSignerClosed('ORIGINAL_TRANSACTION_PLAN_REJECTED')
        return self.crypto.prepare_original_envelope(prepared,{'type':'eip1559',**transaction,'gasBudgetWei':self.profile['maxTransactionCostWei']})

    def _fresh(self,record,quote=False):
        now=self.clock()
        if type(now) is not int or now<0: raise OriginalSignerClosed('TRUSTED_CLOCK_REQUIRED')
        params=record['quote'] if quote else record['parameters']
        if 'deadline' in params and uint(params['deadline'])<=now: raise OriginalSignerClosed('ORIGINAL_AUTHORIZATION_EXPIRED')

    def _verify_quote(self,record,signature):
        if type(signature) is not str or not re.fullmatch(r'0x[0-9a-f]{130}',signature): raise OriginalSignerClosed('SIGNER_RETAINED_SIGNATURE_CONFLICT')
        value=self.business.call('attachFundingSignature',{'binding':record['binding'],'quote':record['quote'],'signature':signature,'now':'0'})
        if value.get('signature')!=signature: raise OriginalSignerClosed('SIGNER_RETAINED_SIGNATURE_CONFLICT')
        return signature

    def _verify_raw(self,raw,expected,response_hash=None):
        observed=self.crypto.inspect_signed_transaction(raw,expected)
        if response_hash is not None and observed.get('hash')!=word(response_hash): raise OriginalSignerClosed('SIGNER_RETAINED_RAW_CONFLICT')
        return {'raw':raw.lower(),'transactionHash':word(observed.get('hash'))}

    def lookup_original_quote(self,record):
        record=deepcopy(record);expected=self._quote(record);original={'record':record,'expected':expected}
        row=self.journal.lookup(self._key(record,True),original)
        if row is None or row['stage']!='RETAINED': return None
        return self._verify_quote(record,row['response']['signature'])

    def sign_original_quote(self,record,prepared):
        record=deepcopy(record);expected=self._quote(record)
        if prepared!=expected: raise OriginalSignerClosed('ORIGINAL_QUOTE_MISMATCH')
        key=self._key(record,True);original={'record':record,'expected':expected}
        row=self.journal.lookup(key,original)
        if row is not None:
            retained=self.lookup_original_quote(record)
            if retained is None: raise OriginalSignerClosed('ORIGINAL_SIGNING_UNKNOWN')
            return retained
        self._fresh(record,True)
        if not self.journal.begin(key,original): raise OriginalSignerClosed('ORIGINAL_SIGNING_UNKNOWN')
        try:
            signature=self._verify_quote(record,self.worker.sign_quote(deepcopy(record),deepcopy(expected)))
            self.journal.retain(key,original,{'signature':signature});return signature
        except Exception: raise OriginalSignerClosed('ORIGINAL_SIGNING_UNKNOWN') from None

    def lookup_original_transaction(self,record):
        record=deepcopy(record);expected=self._transaction(record);original={'record':record,'expected':expected}
        row=self.journal.lookup(self._key(record),original)
        if row is None or row['stage']!='RETAINED': return None
        return self._verify_raw(row['response']['raw'],expected,row['response']['transactionHash'])['raw']

    def sign_original_transaction(self,record):
        record=deepcopy(record);expected=self._transaction(record);original={'record':record,'expected':expected};key=self._key(record)
        row=self.journal.lookup(key,original)
        if row is not None:
            retained=self.lookup_original_transaction(record)
            if retained is None: raise OriginalSignerClosed('ORIGINAL_SIGNING_UNKNOWN')
            return retained
        self._fresh(record)
        if not self.journal.begin(key,original,record['transaction']['nonce']): raise OriginalSignerClosed('ORIGINAL_SIGNING_UNKNOWN')
        try:
            response=self.worker.sign_transaction(deepcopy(record),deepcopy(expected))
            result=self._verify_raw(response['raw'],expected,response.get('hash'))
            self.journal.retain(key,original,result);return result['raw']
        except Exception: raise OriginalSignerClosed('ORIGINAL_SIGNING_UNKNOWN') from None


class DedicatedEOAWorker:
    """Future-only private FD worker. No key metadata/read/worker execution occurs in tests."""
    def __init__(self, *, journal, key_handle, node_executable):
        if type(key_handle) is not dict or set(key_handle)!={'name','device','inode'} or type(key_handle['name']) is not str or not re.fullmatch(r'[A-Za-z0-9_-]+\.key',key_handle['name']) or any(type(key_handle[k]) is not int or key_handle[k]<0 for k in ('device','inode')): raise OriginalSignerClosed('DEDICATED_KEY_HANDLE_REQUIRED')
        if type(node_executable) is not str or not Path(node_executable).is_absolute() or not Path(node_executable).is_file(): raise OriginalSignerClosed('ABSOLUTE_NODE_REQUIRED')
        self.journal,self.handle,self.node=journal,deepcopy(key_handle),node_executable
        self.helper=Path(__file__).with_name('original-signer-worker.mjs')

    def _call(self,mode,record,expected):
        quote=mode=='quote';key=digest(['quote' if quote else 'transaction',self.journal.role,self.journal.account,self.journal.profile['binding']['chainId'],self.journal.profile['binding']['escrow'],word(record['quoteId' if quote else 'opId'])])
        row=self.journal.lookup(key,{'record':record,'expected':expected})
        if row is None or row['stage']!='SIGNING': raise OriginalSignerClosed('DURABLE_SIGN_INTENT_REQUIRED')
        raw=canonical({'mode':mode,'role':self.journal.role,'profile':self.journal.profile,'record':record,'expected':expected})
        if len(raw)>131072: raise OriginalSignerClosed('ORIGINAL_SIGNER_INPUT_LIMIT')
        fd=os.open(self.handle['name'],os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=self.journal.directory_fd)
        try:
            info=os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or info.st_nlink!=1 or stat.S_IMODE(info.st_mode)!=0o600 or not 66<=info.st_size<=67 or info.st_dev!=self.handle['device'] or info.st_ino!=self.handle['inode']: raise OriginalSignerClosed('DEDICATED_KEY_HANDLE_REQUIRED')
            result=subprocess.run([self.node,str(self.helper),str(fd)],input=raw,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env={},pass_fds=(fd,),timeout=5,check=False)
            if result.returncode or len(result.stdout)>131072: raise OriginalSignerClosed('ORIGINAL_SIGNING_UNKNOWN')
            value=json.loads(result.stdout)
            if type(value) is not dict or value.get('error'): raise OriginalSignerClosed('ORIGINAL_SIGNING_UNKNOWN')
            return value
        finally: os.close(fd)

    def sign_quote(self,record,expected): return self._call('quote',record,expected)['signature']
    def sign_transaction(self,record,expected): return self._call('transaction',record,expected)
