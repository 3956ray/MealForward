"""Private first verified store binding and hot authority composition. No web keys."""
from copy import deepcopy
from contextlib import ExitStack
import argparse,importlib,os,signal,threading,time
from pathlib import Path
from .first_binding_journal import FirstBindingJournal,BindingClosed
from .registrar_signer_journal import word_hash
from .live_gateway import module,registered_profile
from .private_business_host import business_modules
from .registration_runtime_host import persistence_module
from .runtime_ledger_controller import RuntimeLedgerControllerClient
from .onboarding_adapter import NODE
from .encoding import encode_hash
from .ipc import Client,Server

def binding_probe(config,registration):
    profile=registered_profile(config['business'],registration)
    strict={k:profile[k] for k in ('binding','registrationState','registrationEvidence','genesisHash','finality','eip1898','runtimeTemplatePin','compilerPins','budget')}
    rpc=config['business']['rpc'];codec=business_modules()['codec'].BusinessCodec(NODE)
    def transport():return module('rpc_transport').ReadOnlyBusinessRpcTransport(endpoint=rpc['endpoint'],allowed_endpoints=rpc['allowedEndpoints'],allowed_hosts=rpc['allowedHosts'],python_executable=rpc['pythonExecutable'],profile=strict)
    leaf=business_modules()['observer'];observer=leaf.StoreEscrowObserver(codec=codec,transport_factory=transport,profile=strict)
    session=leaf._Session(observer);session.start()
    raw=session.request('eth_getCode',[profile['binding']['escrow'],{'blockHash':session.block['hash'],'requireCanonical':True}])
    session.proof(op='runtime',code=raw,pin=profile['runtimeTemplatePin'])
    code_hash=encode_hash('keccak',hex=raw)['digest'];session.finish()
    chain_digest='0x'+word_hash({'binding':profile['binding'],'genesisHash':profile['genesisHash'],'escrowCodeHash':code_hash,'runtimeTemplatePin':profile['runtimeTemplatePin'],'compilerPins':profile['compilerPins'],'assetMetadata':profile['assetMetadata']})
    return profile['binding'],code_hash,chain_digest

class AutomaticBusiness:
    def __init__(self,config,ledger,journal,*,probe=binding_probe,compose_host=None,signer_leaf=None):
        self.config,self.ledger,self.journal,self.probe=config,ledger,journal,probe
        self.hosts={};self.resources=[];self.mutex=threading.RLock();self.closed=None
        self._catalog_attempt=None
        self.compose_host=compose_host or __import__('c1.business_runtime_host',fromlist=['compose']).compose
        self.signer_leaf=signer_leaf or module('original_signer')
    def fixed(self,method,body,*,read_only=False):
        with self.ledger.transaction(read_only=read_only) as tx:
            value=tx.fixed.call(method,{'ticket':tx.ticket,**deepcopy(body)})
            if not read_only:tx.dirty=True
        return deepcopy(value)
    def _profiles(self,registration):
        binding,code_hash,chain_digest=self.probe(self.config,registration);profiles=[]
        for role,value in self.config['template']['roles'].items():
            if binding[role]!=value['account']:raise BindingClosed('APPROVED_AUTHORITY_ACCOUNT_CHANGED')
            profile={'namespace':self.config['namespace'],'binding':binding,'escrowCodeHash':code_hash,'chainProfileDigest':chain_digest,**value['profileCaps']}
            self.signer_leaf.approved_profile(profile,role);profiles.append({'role':role,'profile':profile})
        return sorted(profiles,key=lambda x:x['role'])
    def _roles(self,original):
        for value in original['profiles']:
            role,profile=value['role'],value['profile'];directory=Path(self.config['services'][role]['runtimeDirectory']);path=directory/'business-authority-originals.jsonl'
            retained=self.journal.roles.get(role)
            if retained is None:
                # Fsync intention BEFORE first-create. Restart never creates a
                # journal whose CREATE_INTENT was retained but file is missing.
                self.journal.append('CREATE_INTENT',{'role':role,'directory':str(directory),'profileDigest':word_hash(profile)})
                journal=self.signer_leaf.AuthorityOriginalJournal(directory,role=role,profile=profile,initialize=True);journal.close()
            else:
                if retained['intent']['directory']!=str(directory) or retained['intent']['profileDigest']!=word_hash(profile) or not path.exists():raise BindingClosed('ORIGINAL_ROLE_JOURNAL_REQUIRED')
                try:journal=self.signer_leaf.AuthorityOriginalJournal(directory,role=role,profile=profile)
                except Exception:raise BindingClosed('ORIGINAL_ROLE_JOURNAL_CONFLICT') from None
                try:
                    if not retained['created'] and getattr(journal,'rows',{}):raise BindingClosed('UNEXPECTED_SIGNING_BEFORE_BINDING')
                finally:journal.close()
            if not retained or not retained['created']:self.journal.append('ROLE_CREATED',{'role':role})
    def _activate(self,original):
        resources=[];hosts={}
        try:
            for entry in original['profiles']:
                role=entry['role'];source={**deepcopy(self.config['services'][role]),'profile':entry['profile']}
                host,owned=self.compose_host(source);resources.extend(owned);hosts[role]=host
        except BaseException:
            for resource in reversed(resources):resource.close()
            raise
        self.hosts,self.resources=hosts,resources
    def _activate_catalog(self):
        source=self.config['services'].get('catalogAuthority')
        if source is None or 'catalogAuthority' in self.hosts:return
        now=time.monotonic()
        if self._catalog_attempt is not None and now-self._catalog_attempt<20:return
        self._catalog_attempt=now
        try:
            saved=self.fixed('first_binding_material',{},read_only=True).get('catalogActivation')
            if not saved or source['grantId']!=saved['grantId']:return
            if saved['profile']['binding']!=self.journal.original['profiles'][0]['profile']['binding']:return
            host,owned=self.compose_host({**deepcopy(source),'profile':saved['profile']})
            self.resources.extend(owned);self.hosts['catalogAuthority']=host
        except Exception:
            # Optional catalog setup must not disable already bound business roles.
            # Compose only opens the independently initialized catalog journal.
            return
    def tick(self):
        with self.mutex:
            if self.closed:return {'state':'CLOSED','reason':self.closed}
            if self.hosts:
                self._activate_catalog();return {'state':'BOUND'}
            try:
                material=self.fixed('first_binding_material',{},read_only=True);registration=material.get('registration');saved=material.get('binding')
                if material['template']['template_digest']!=self.journal.template_digest:raise BindingClosed('BINDING_TEMPLATE_CHANGED')
                if not registration:
                    if self.journal.original or saved:raise BindingClosed('BOUND_REGISTRATION_MISSING')
                    return {'state':'WAIT_VERIFIED_REGISTRATION'}
                original=self.journal.original
                if original is None:
                    if saved:raise BindingClosed('EXTERNAL_BINDING_PREPARATION_MISSING')
                    profiles=self._profiles(registration)
                    original={'registrationId':registration['id'],'registrationRecord':registration['record'],'profiles':profiles,'profileDigest':word_hash(profiles),'templateDigest':self.journal.template_digest}
                    self.journal.append('PREPARED',original)
                elif original['registrationId']!=registration['id'] or original['registrationRecord']!=registration['record']:raise BindingClosed('ORIGINAL_FIRST_REGISTRATION_CHANGED')
                if saved and (saved['profiles']!=original['profiles'] or saved['profile_digest']!=original['profileDigest']):raise BindingClosed('ORIGINAL_DATABASE_BINDING_CHANGED')
                if not saved:self.fixed('first_binding_begin',original)
                self._roles(original)
                if self.journal.bound is None:self.journal.append('BOUND',{'profileDigest':original['profileDigest']})
                self.fixed('first_binding_finish',self.journal.bound)
                self._activate(original);self._activate_catalog();return {'state':'BOUND'}
            except BindingClosed as exc:self.closed=str(exc);return {'state':'CLOSED','reason':self.closed}
            except Exception:
                # No new profile, store or signer creation after uncertainty.
                # Next tick may only resolve/reopen the retained ORIGINAL state.
                return {'state':'ORIGINAL_BINDING_UNKNOWN'}
    def handle(self,namespace,method,request,*,role=None):
        if namespace!=self.config['namespace'] or role not in self.config['services']:return {'error':'IPC_FORBIDDEN','status':403}
        host=self.hosts.get(role)
        if host is None:
            if method=='setup' and request=={}:return {'status':'NOT_CONFIGURED','role':role,'state':'CLOSED' if self.closed else 'WAIT_VERIFIED_REGISTRATION'}
            return {'error':'ORIGINAL_BINDING_NOT_READY','status':503}
        return host.handle(namespace,method,request,role='business_client')
    def close(self):
        for resource in reversed(self.resources):resource.close()
        self.resources=[];self.hosts={}

def main():
    from .db import Database
    from .private_connection_config import load
    parser=argparse.ArgumentParser();parser.add_argument('--config',required=True);args=parser.parse_args()
    if os.environ:raise SystemExit('EMPTY_ENVIRONMENT_REQUIRED')
    config=load(args.config)
    if config.get('mode')!='CP30_AUTOMATIC_BUSINESS' or config.get('enabled') is not True:raise SystemExit('APPROVED_AUTOMATIC_BUSINESS_REQUIRED')
    with ExitStack() as stack:
        database=Database(config,config['bindingRole'],'runtime_internal',max_size=1);stack.callback(database.close)
        controller=RuntimeLedgerControllerClient(Client(config['runtimeController']['path'],config['runtimeController']['cap'],timeout=5));ledger=persistence_module().PgRuntimeLedger(database,config['namespace'],controller)
        journal=FirstBindingJournal(config['bindingDirectory'],word_hash(config['template']));stack.callback(journal.close)
        service=AutomaticBusiness(config,ledger,journal);stack.callback(service.close)
        capabilities={role:{'cap':value['client_cap'],'methods':['setup','execute_original','lookup_original']} for role,value in config['services'].items()}
        server=Server(config['socket_path'],capabilities,service.handle,max_handlers=2);stack.callback(server.server_close)
        stopped=threading.Event();signal.signal(signal.SIGTERM,lambda *_:stopped.set());signal.signal(signal.SIGINT,lambda *_:stopped.set())
        thread=threading.Thread(target=lambda:server.serve_forever(poll_interval=.1),daemon=True);thread.start()
        try:
            while not stopped.wait(2):service.tick()
        finally:server.shutdown();thread.join(timeout=5)
if __name__=='__main__':main()
