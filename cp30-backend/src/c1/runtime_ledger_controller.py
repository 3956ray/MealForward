"""External private runtime ledger head/floors, independent of restored PG data."""
import copy
import fcntl
import json
import os
from pathlib import Path
import stat
import threading
import uuid
from .registrar_signer_journal import owned_directory,canonical,word_hash

PROTOCOL='CP30_RUNTIME_LEDGER_CONTROLLER_V1'
class RuntimeLedgerClosed(ValueError):pass

class RuntimeLedgerJournal:
    def __init__(self,directory,namespace,*,initialize=None):
        self.directory=owned_directory(directory);self.namespace=namespace;self.path=self.directory/'runtime-ledger.jsonl'
        flags=os.O_RDWR|os.O_APPEND|os.O_NOFOLLOW
        if initialize is not None:flags|=os.O_CREAT|os.O_EXCL
        self.fd=os.open(self.path,flags,0o600)
        try:
            info=os.fstat(self.fd)
            if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or stat.S_IMODE(info.st_mode)!=0o600:raise RuntimeLedgerClosed('EXTERNAL_RUNTIME_JOURNAL_REQUIRED')
            fcntl.flock(self.fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
            self.sequence=0;self.head='0'*64;self.checkpoint=None;self.pending=None;self.terminal=None;self.failed=False
            if os.fstat(self.fd).st_size>67108864:raise ValueError('EXTERNAL_JOURNAL_LIMIT')
            with os.fdopen(os.dup(self.fd),'rb') as source:
                for line in source:
                    if not line.endswith(b'\n') or len(line)>1048576:raise RuntimeLedgerClosed('EXTERNAL_RUNTIME_JOURNAL_DAMAGED')
                    row=json.loads(line);payload={key:row[key] for key in ('sequence','parent','namespace','kind','data')}
                    if row['sequence']!=self.sequence+1 or row['parent']!=self.head or row['namespace']!=namespace or row['digest']!=word_hash(payload):raise RuntimeLedgerClosed('EXTERNAL_RUNTIME_JOURNAL_DAMAGED')
                    self._apply(row);self.sequence=row['sequence'];self.head=row['digest']
            if initialize is not None:
                self.append('HEADER',{'protocol':PROTOCOL,'checkpoint':initialize})
                fd=os.open(self.directory,os.O_RDONLY);os.fsync(fd);os.close(fd)
            elif self.checkpoint is None:raise RuntimeLedgerClosed('EXTERNAL_RUNTIME_JOURNAL_MISSING')
        except BaseException:
            os.close(self.fd)
            raise
    def _apply(self,row):
        kind,data=row['kind'],row['data']
        if kind=='HEADER':
            if self.sequence or data['protocol']!=PROTOCOL:raise RuntimeLedgerClosed('EXTERNAL_RUNTIME_JOURNAL_DAMAGED')
            self.checkpoint={**copy.deepcopy(data['checkpoint']),'journalSequence':row['sequence'],'journalDigest':row['digest']}
        elif kind=='PREPARED':
            incoming=data['checkpoint']
            if self.pending or {k:v for k,v in incoming.items() if k!='globalFloors'}!={k:v for k,v in self.checkpoint.items() if k!='globalFloors'}:raise RuntimeLedgerClosed('OTHER_RUNTIME_MUTATION_PENDING')
            for key,revision in self.checkpoint['globalFloors']['runtime_nonce'].items():
                if incoming['globalFloors']['runtime_nonce'].get(key,-1)<revision:raise RuntimeLedgerClosed('GLOBAL_NONCE_FLOOR_ROLLBACK')
            self.pending={'protocol':PROTOCOL,'namespace':self.namespace,'readOnly':False,'checkpoint':copy.deepcopy(incoming),'mutation':{'id':data['mutation_id'],'sequence':row['sequence'],'digest':row['digest']}}
        elif kind in {'COMMITTED','ABORTED'}:
            ticket=data['ticket'];proof=data['proof']
            if self.pending!=ticket:raise RuntimeLedgerClosed('ORIGINAL_RUNTIME_PREPARATION_REQUIRED')
            cp=ticket['checkpoint'];mutation=ticket['mutation']
            if any(proof.get(key)!=value for key,value in {'namespace':self.namespace,'mutation_id':mutation['id'],'sequence':mutation['sequence'],'digest':mutation['digest'],'priorRevision':cp['ledgerRevision'],'priorHead':cp['ledgerHead'],'ledgerRevision':cp['ledgerRevision']+1}.items()):raise RuntimeLedgerClosed('ORIGINAL_RUNTIME_PROOF_REQUIRED')
            import re
            if any(not re.fullmatch('[0-9a-f]{64}',str(proof.get(key,''))) for key in ('ledgerHead','materialHash')):raise RuntimeLedgerClosed('ORIGINAL_RUNTIME_PROOF_REQUIRED')
            if proof['ledgerRevision']<self.checkpoint['ledgerRevision']:raise RuntimeLedgerClosed('RUNTIME_REVISION_ROLLBACK')
            for domain,objects in self.checkpoint['floors'].items():
                for key,revision in objects.items():
                    if proof['floors'].get(domain,{}).get(key,-1)<revision:raise RuntimeLedgerClosed('RUNTIME_OBJECT_FLOOR_ROLLBACK')
            if proof['epochs']!=self.checkpoint['epochs']:raise RuntimeLedgerClosed('RUNTIME_EPOCH_CHANGED')
            for key,revision in ticket['checkpoint']['globalFloors']['runtime_nonce'].items():
                if proof['globalFloors']['runtime_nonce'].get(key,-1)<revision:raise RuntimeLedgerClosed('GLOBAL_NONCE_FLOOR_ROLLBACK')
            self.checkpoint={key:copy.deepcopy(proof[key]) for key in ('ledgerRevision','ledgerHead','materialHash','epochs','floors','globalFloors')}
            self.checkpoint.update(journalSequence=row['sequence'],journalDigest=row['digest']);self.pending=None
            self.terminal={'kind':kind,'ticket':copy.deepcopy(ticket),'proof':copy.deepcopy(proof)}
        else:raise RuntimeLedgerClosed('EXTERNAL_RUNTIME_JOURNAL_DAMAGED')
    def append(self,kind,data):
        if self.failed:raise RuntimeLedgerClosed('EXTERNAL_RUNTIME_JOURNAL_DAMAGED')
        payload={'sequence':self.sequence+1,'parent':self.head,'namespace':self.namespace,'kind':kind,'data':data}
        row={**payload,'digest':word_hash(payload)};raw=canonical(row)+b'\n'
        if len(raw)>1048576 or os.fstat(self.fd).st_size+len(raw)>67108864:raise RuntimeLedgerClosed('RUNTIME_JOURNAL_LIMIT')
        try:
            view=memoryview(raw)
            while view:
                count=os.write(self.fd,view)
                if count<=0:raise OSError()
                view=view[count:]
            os.fsync(self.fd);self._apply(row);self.sequence=row['sequence'];self.head=row['digest']
        except BaseException:self.failed=True;raise
        return copy.deepcopy(row)
    def close(self):os.close(self.fd)

class RuntimeLedgerController:
    runtime_ledger_protocol=PROTOCOL
    def __init__(self,database,journal,*,clock=None):
        self.database,self.mutex=database,threading.RLock()
        self.journals=journal if isinstance(journal,dict) else {journal.namespace:journal}
        self.journal=next(iter(self.journals.values()));self.clock=clock
    def _select(self,namespace):
        if namespace not in self.journals:raise RuntimeLedgerClosed('EXTERNAL_NAMESPACE_ROSTER_REQUIRED')
        self.journal=self.journals[namespace]
    def _global(self):
        union={}
        for journal in self.journals.values():
            if journal.failed or journal.checkpoint is None:raise RuntimeLedgerClosed('EXTERNAL_NAMESPACE_ROSTER_REQUIRED')
            for values in (journal.checkpoint['globalFloors']['runtime_nonce'],journal.checkpoint['floors']['runtime_nonce']):
                for key,revision in values.items():union[key]=max(union.get(key,0),revision)
        return {'runtime_nonce':union}
    def _call(self,method,namespace,request):
        self._select(namespace)
        result=self.database.call(method,namespace,request)
        if result.get('error'):raise RuntimeLedgerClosed(result['error'])
        return result
    def _match(self,namespace):
        status=self._call('ledger_status',namespace,{})
        checkpoint=self.journal.checkpoint
        if self.journal.failed or status.get('configured') is not True or status.get('materialMatches') is not True or status.get('pending') is not None:raise RuntimeLedgerClosed('RUNTIME_RESTORE_FLOOR_MISMATCH')
        for field in ('ledgerRevision','ledgerHead','materialHash','epochs','floors','journalSequence','journalDigest'):
            if status.get(field)!=checkpoint.get(field):raise RuntimeLedgerClosed('RUNTIME_RESTORE_FLOOR_MISMATCH')
        global_floors=self._global()
        if status.get('globalFloors')!=global_floors:raise RuntimeLedgerClosed('GLOBAL_NONCE_FLOOR_MISMATCH')
        return {**copy.deepcopy(checkpoint),'globalFloors':global_floors}
    def begin(self,namespace,*,read_only=False):
        with self.mutex:
            self._select(namespace)
            # Recover every retained namespace before comparing the global nonce
            # union. A foreign committed mutation cannot remain invisible here.
            for ns,journal in self.journals.items():
                self._select(ns)
                if journal.pending:
                    ticket=copy.deepcopy(journal.pending)
                    actual=self._call('ledger_proof',ns,self.reference(ticket))
                    if actual.get('committed') is True:
                        proof={key:value for key,value in actual.items() if key not in {'ticket','finished'}}
                        if actual.get('ticket')!=ticket:raise RuntimeLedgerClosed('ORIGINAL_RUNTIME_PROOF_REQUIRED')
                        journal.append('COMMITTED',{'ticket':ticket,'proof':proof})
                    else:
                        proof=self._call('ledger_abort',ns,{**self.reference(ticket),'ticket':ticket})
                        if proof.get('aborted') is not True:raise RuntimeLedgerClosed('ORIGINAL_RUNTIME_ABORT_PROOF_REQUIRED')
                        journal.append('ABORTED',{'ticket':ticket,'proof':proof})
                if journal.terminal:self._ack(ns,journal.terminal)
            if self.clock is not None:
                for ns,journal in self.journals.items():
                    self._call('runtime_clock',ns,{'checkpoint':{**copy.deepcopy(journal.checkpoint),'globalFloors':self._global()},'now':int(self.clock())})
            for ns in self.journals:self._match(ns)
            checkpoint=self._match(namespace)
            if read_only:return {'protocol':PROTOCOL,'namespace':namespace,'readOnly':True,'checkpoint':checkpoint}
            self.journal.append('PREPARED',{'checkpoint':checkpoint,'mutation_id':str(uuid.uuid4())})
            return copy.deepcopy(self.journal.pending)
    def pulse(self):
        with self.mutex:
            if self.clock is None or any(j.pending for j in self.journals.values()):return {'advanced':False,'pending':True}
            for ns,j in self.journals.items():
                checkpoint=self._match(ns)
                self._call('runtime_clock',ns,{'checkpoint':checkpoint,'now':int(self.clock())})
            return {'advanced':True}
    @staticmethod
    def reference(ticket):return {'mutation_id':ticket['mutation']['id'],'sequence':ticket['mutation']['sequence'],'digest':ticket['mutation']['digest']}
    def _ack(self,namespace,terminal):
        method='ledger_finish' if terminal['kind']=='COMMITTED' else 'ledger_abort_finish'
        checkpoint=self.journal.checkpoint
        result=self._call(method,namespace,{**self.reference(terminal['ticket']),'proof':terminal['proof'],'journal_sequence':checkpoint['journalSequence'],'journal_digest':checkpoint['journalDigest']})
        if result.get('finished') is not True:raise RuntimeLedgerClosed('RUNTIME_FINISH_REQUIRED')
    def finish(self,namespace,ticket,proposed=None):
        with self.mutex:
            self._select(namespace)
            actual=self._call('ledger_proof',namespace,self.reference(ticket))
            proof={key:value for key,value in actual.items() if key not in {'ticket','finished'}}
            if actual.get('committed') is not True or actual.get('ticket')!=ticket or (proposed is not None and proof!=proposed):raise RuntimeLedgerClosed('ORIGINAL_RUNTIME_PROOF_REQUIRED')
            if self.journal.pending==ticket:self.journal.append('COMMITTED',{'ticket':ticket,'proof':proof})
            terminal=self.journal.terminal
            if terminal is None or terminal['ticket']!=ticket or terminal['proof']!=proof:raise RuntimeLedgerClosed('ORIGINAL_RUNTIME_COMPLETION_REQUIRED')
            self._ack(namespace,terminal);checkpoint=self._match(namespace)
            return {'finished':True,'mutation_id':ticket['mutation']['id'],**{key:checkpoint[key] for key in ('ledgerRevision','ledgerHead','journalSequence','journalDigest')}}
    def resolve(self,namespace,ticket):
        with self.mutex:
            self._select(namespace)
            actual=self._call('ledger_proof',namespace,self.reference(ticket))
            if actual.get('committed') is True:return self.finish(namespace,ticket)
            # Abort locks the DB state row, blocks a late transaction, and seals
            # absence independently. Caller rollback assertions are never consumed.
            proof=self._call('ledger_abort',namespace,{**self.reference(ticket),'ticket':ticket})
            if proof.get('aborted') is not True:raise RuntimeLedgerClosed('ORIGINAL_RUNTIME_ABORT_PROOF_REQUIRED')
            if self.journal.pending==ticket:self.journal.append('ABORTED',{'ticket':ticket,'proof':proof})
            terminal=self.journal.terminal
            if terminal is None or terminal['ticket']!=ticket or terminal['kind']!='ABORTED':raise RuntimeLedgerClosed('ORIGINAL_RUNTIME_ABORT_REQUIRED')
            self._ack(namespace,terminal);checkpoint=self._match(namespace)
            return {'finished':True,'mutation_id':ticket['mutation']['id'],**{key:checkpoint[key] for key in ('ledgerRevision','ledgerHead','journalSequence','journalDigest')}}

class RuntimeLedgerControllerClient:
    runtime_ledger_protocol=PROTOCOL
    def __init__(self,ipc):self.ipc=ipc
    def begin(self,namespace,*,read_only=False):return self._call(namespace,'runtime_ledger_begin',{'readOnly':read_only})
    def finish(self,namespace,ticket,proof):return self._call(namespace,'runtime_ledger_finish',{'ticket':ticket,'proof':proof})
    def resolve(self,namespace,ticket):return self._call(namespace,'runtime_ledger_resolve',{'ticket':ticket})
    def _call(self,namespace,method,body):
        value=self.ipc.call(namespace,method,body)
        if value.get('error'):raise RuntimeLedgerClosed(value['error'])
        return value

def main():
    import argparse,signal
    from .db import Database
    from .ipc import Server
    from .controller import Controller,ALLOWLIST
    parser=argparse.ArgumentParser();parser.add_argument('--config',required=True);args=parser.parse_args()
    if os.environ:raise SystemExit('EMPTY_ENVIRONMENT_REQUIRED')
    path=Path(args.config);info=path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or stat.S_IMODE(info.st_mode)!=0o600:raise SystemExit('PRIVATE_CONFIG_REQUIRED')
    from .private_connection_config import load
    config=load(path)
    if config.get('mode')!='CP30_RUNTIME_LEDGER_CONTROLLER':raise SystemExit('EXPLICIT_CONTROLLER_MODE_REQUIRED')
    from contextlib import ExitStack
    with ExitStack() as stack:
        database=Database(config,config['runtimeControllerRole'],'runtime_controller',max_size=1);stack.callback(database.close)
        journals={}
        for namespace,directory in config['journals'].items():
            journal=RuntimeLedgerJournal(directory,namespace);stack.callback(journal.close);journals[namespace]=journal
        runtime=RuntimeLedgerController(database,journals,clock=__import__('time').time if config.get('clockEnabled') is True else None)
        # Independent startup match precedes opening the private capability socket.
        for namespace in journals:runtime.begin(namespace,read_only=True)
        bridge=Controller(None,None,None,namespaces=tuple(journals),runtime_ledger=runtime)
        server=Server(config['socket_path'],{'runtime_ledger':{'cap':config['executor_cap'],'methods':list(ALLOWLIST['runtime_ledger'])}},bridge.handle,max_handlers=2);stack.callback(server.server_close)
        event=threading.Event();signal.signal(signal.SIGTERM,lambda *_:event.set());signal.signal(signal.SIGINT,lambda *_:event.set())
        thread=threading.Thread(target=lambda:server.serve_forever(poll_interval=.1),daemon=True);thread.start()
        try:
            while not event.wait(5):
                try:runtime.pulse()
                except Exception:pass  # Original mismatch remains closed on every caller.
        finally:server.shutdown();thread.join(timeout=5)

if __name__=='__main__':main()
