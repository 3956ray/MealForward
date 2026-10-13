"""Identity/security-only controller: real journal/proofs, no economic snapshot."""
from contextlib import ExitStack
import argparse,os,signal,threading
from .controller import Controller,_error
from .journal import Journal,Quarantined
from .db import Database
from .ipc import Server
from .private_connection_config import load

class IdentityCheckpoint:
    def __init__(self,database):self.database=database
    def call(self,method,namespace,snapshot):
        if method!='startup_check':return _error('ECONOMIC_AUTHORITY_DISABLED')
        return self.database.call('identity_security_checkpoint',namespace,snapshot)

class IdentitySecurityController(Controller):
    def __init__(self,journal,business,namespace):
        super().__init__(journal,business,IdentityCheckpoint(business),namespaces=(namespace,))
    def _compare(self,namespace):
        snapshot=self.journal.snapshot(namespace)
        if snapshot['pending'] or snapshot.get('restore_pending') or self.journal.failed:raise Quarantined('PENDING_OR_DAMAGED_JOURNAL')
        value=self.authority.call('startup_check',namespace,snapshot)
        if value.get('matched') is not True:raise Quarantined('IDENTITY_SECURITY_ANCHOR_MISMATCH')
        self.quarantined.discard(namespace);return snapshot
    def handle(self,namespace,method,request,*,role=None):
        if role=='api':
            if method=='query' and request=={}:pass
            elif method=='security':
                if request.get('phase') in {'finish','abort'}:
                    try:
                        prepared=self._prepared(namespace,request)
                        if prepared['data']['kind']!='logout':return _error('IPC_FORBIDDEN',403)
                    except Exception:return _error('IPC_FORBIDDEN',403)
                elif request.get('kind')!='logout':return _error('IPC_FORBIDDEN',403)
            else:return _error('ECONOMIC_AUTHORITY_DISABLED',403)
        elif role=='verified_identity':
            if method not in {'identity_exchange','wallet_binding','wallet_login_challenge','wallet_login','query'}:return _error('IPC_FORBIDDEN',403)
        else:return _error('IPC_FORBIDDEN',403)
        return super().handle(namespace,method,request,role=role)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--config',required=True);args=parser.parse_args()
    if os.environ:raise SystemExit('EMPTY_ENVIRONMENT_REQUIRED')
    config=load(args.config)
    if config.get('mode')!='CP30_IDENTITY_SECURITY_CONTROLLER':raise SystemExit('EXPLICIT_IDENTITY_SECURITY_MODE_REQUIRED')
    with ExitStack() as stack:
        db=Database(config,config['securityRole'],'identity_security',max_size=1);stack.callback(db.close)
        journal=Journal(config['journal_path'],config['run_id'],config['cluster_id']);stack.callback(journal.close)
        controller=IdentitySecurityController(journal,db,config['namespace']);controller.startup()
        if controller.quarantined:raise SystemExit('SECURITY_STARTUP_QUARANTINED')
        server=Server(config['socket_path'],{'api':{'cap':config['api_cap'],'methods':['query','security']},'verified_identity':{'cap':config['identity_cap'],'methods':['query','identity_exchange','wallet_binding','wallet_login_challenge','wallet_login']}},controller.handle,max_handlers=2);stack.callback(server.server_close)
        stopped=threading.Event();signal.signal(signal.SIGTERM,lambda *_:stopped.set());signal.signal(signal.SIGINT,lambda *_:stopped.set())
        thread=threading.Thread(target=lambda:server.serve_forever(poll_interval=.1),daemon=True);thread.start()
        try:stopped.wait()
        finally:server.shutdown();thread.join(timeout=5)
if __name__=='__main__':main()
