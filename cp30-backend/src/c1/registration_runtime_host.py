"""Executable private automatic-deployment host. Source checks never start it."""
from copy import deepcopy
from contextvars import ContextVar
import importlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time
import types
from .encoding import NODE
from .onboarding_adapter import ROOT,domain_modules,IntegrationRejected
from .private_business_host import business_modules
from .registrar_signer_journal import OriginalSignerJournal,DedicatedRegistrarSigner,owned_directory
from .registrar_rpc import RegistrarRpc
from .runtime_ledger_controller import RuntimeLedgerControllerClient
from .ipc import Client,Server

def persistence_module():
    name='c1_persistence_integration'
    if name not in sys.modules:
        package=types.ModuleType(name);package.__path__=[str(ROOT/'integrations/persistence')];sys.modules[name]=package
    return importlib.import_module(name+'.pg_runtime_ledger')

def profile_codec(body):
    result=subprocess.run([NODE,str(Path(__file__).with_name('registrar_profile_codec.mjs'))],input=json.dumps(body,separators=(',',':')).encode(),stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env={},timeout=2)
    if result.returncode or len(result.stdout)>262144:raise IntegrationRejected('FACTORY_PROFILE_UNVERIFIED',503)
    value=json.loads(result.stdout)
    if value.get('error'):raise IntegrationRejected('FACTORY_PROFILE_UNVERIFIED',503)
    return value

class RegistrarAdmission:
    def __init__(self,*,ledger,codec,crypto,profile,rpc_factory,grant_id,transaction_limits):
        self.ledger,self.codec,self.crypto,self.profile,self.rpc_factory,self.grant_id,self.limits=ledger,codec,crypto,profile,rpc_factory,grant_id,transaction_limits
        self.owner_kind=ContextVar('registrar_owner_kind',default=None)
    def material(self,registration_id,*,lookup_only=False):
        with self.ledger.transaction(read_only=True) as tx:
            return tx.fixed.call('registrar_admission_material',{'ticket':tx.ticket,'id':registration_id,'grantId':self.grant_id,'lookupOnly':lookup_only})
    def ensure(self,incoming):
        material=self.material(incoming['registrationId']);record=material['record']
        service,_=domain_modules()
        # RegistrarRuntime's exact immutable fields, not a new request digest.
        runtime=importlib.import_module('c1_onboarding_integration.registrar_runtime')
        original=runtime.RegistrarRuntime._immutable(record)
        if runtime.RegistrarRuntime._immutable(incoming)!=original:raise IntegrationRejected('ORIGINAL_REGISTRATION_CONFLICT',409)
        for key in ('chainId','factory','registrar','asset','quoteAuthority','catalogAuthority','issuerAuthority','operatorAuthority','escrowCreationCodeHash'):
            if original['original'].get(key)!=self.profile.get(key):raise IntegrationRejected('REGISTRAR_PROFILE_MISMATCH',503)
        self.owner_kind.set(material['ownerKind'])
        if material['approval'] is not None:return material['approval']
        if self.codec.prepare(original['original'])!=original['prepared'] or not self.codec.verify_owner_signature(original['original'],original['ownerSignature']) or self.codec.prepare_deployment(original['original'],original['ownerSignature'])!=original['deployment']:raise IntegrationRejected('ORIGINAL_REGISTRATION_UNVERIFIED',409)
        rpc=self.rpc_factory();profile=self.profile
        if int(rpc.request('eth_chainId',[]),16)!=int(profile['chainId']):raise IntegrationRejected('CHAIN_PROFILE_MISMATCH',503)
        genesis=rpc.request('eth_getBlockByNumber',['0x0',False])
        if genesis.get('hash')!=profile['genesisHash']:raise IntegrationRejected('CHAIN_PROFILE_MISMATCH',503)
        header=rpc.request('eth_getBlockByNumber',['finalized',False])
        if not header or not re.fullmatch('0x[0-9a-f]{64}',str(header.get('hash'))):raise IntegrationRejected('FINALIZED_FACTORY_REQUIRED',503)
        block={'blockHash':header['hash'],'requireCanonical':True};calls=profile_codec({'op':'calls'})['calls']
        code=rpc.request('eth_getCode',[profile['factory'],block]);values={name:rpc.request('eth_call',[{'to':profile['factory'],'data':data},block]) for name,data in calls.items()}
        checked=profile_codec({'op':'verify','profile':profile,'code':code,'values':values})
        if checked.get('verified') is not True or checked['count']>=3:raise IntegrationRejected('FACTORY_PROFILE_OR_CAPACITY_UNAVAILABLE',503)
        observed=int(rpc.request('eth_getTransactionCount',[profile['registrar'],'pending']),16)
        nonce=max(observed,int(material['nextNonce']))
        plan={**self.limits,'nonce':str(nonce)}
        if set(plan)!={'nonce','gas','maxFeePerGas','maxPriorityFeePerGas'}:raise IntegrationRejected('APPROVED_REGISTRAR_PLAN_REQUIRED',503)
        keys=['chainId','factory','registrar','asset','quoteAuthority','catalogAuthority','issuerAuthority','operatorAuthority','escrowCreationCodeHash']
        approved_profile={key:original['original'][key] for key in keys}
        approved_profile.update(factoryCodeHash=profile['factoryCodeHash'],chainProfileDigest=profile['chainProfileDigest'])
        approval={'original':original,'revision':1,'systemRole':'registrar','profile':approved_profile,'transaction':plan,'grant':material['grant']}
        expected=self.crypto.prepare_original_envelope(original['deployment'],{'type':'eip1559',**plan,'gasBudgetWei':material['grant']['gasUnits']})
        initial={'original':original,'approval':approval,'expected':expected,'reservation':material['grant'],'stage':'TRANSACTION_SIGNING'}
        signer_record={**original,'transaction':plan,'profile':approved_profile,'grant':material['grant']}
        with self.ledger.transaction() as tx:
            tx.fixed.call('registrar_admit',{'ticket':tx.ticket,'id':original['registrationId'],'grantId':self.grant_id,'ownerKind':self.owner_kind.get(),'observedNonce':str(observed),'approval':approval,'initialRow':initial,'reservationOriginal':signer_record})
            tx.dirty=True
        return approval

class RegistrarBroadcaster:
    original_lookup_protocol='CP30_ORIGINAL_REGISTRATION_V1'
    def __init__(self,rpc_factory,profile,crypto,*,before_broadcast):self.rpc_factory,self.profile,self.crypto,self.before_broadcast=rpc_factory,profile,crypto,before_broadcast
    def _rpc(self):
        rpc=self.rpc_factory()
        if int(rpc.request('eth_chainId',[]),16)!=int(self.profile['chainId']) or rpc.request('eth_getBlockByNumber',['0x0',False]).get('hash')!=self.profile['genesisHash']:raise IntegrationRejected('CHAIN_PROFILE_MISMATCH',503)
        return rpc
    def broadcast_original(self,raw,transaction_hash,record):
        expected=self.crypto.prepare_original_envelope(record['deployment'],{'type':'eip1559',**record['transaction'],'gasBudgetWei':record['grant']['gasUnits']})
        if self.crypto.inspect_signed_transaction(raw,expected)['hash']!=transaction_hash:raise IntegrationRejected('ORIGINAL_RAW_HASH_MISMATCH',409)
        # One invocation only. Runtime retained raw/hash and journal finish first.
        self.before_broadcast(record)
        return self._rpc().request('eth_sendRawTransaction',[raw])
    def lookup_original(self,record,transaction_hash):
        observed=self._rpc().request('eth_getTransactionByHash',[transaction_hash])
        if observed is None:return None
        d=record['deployment'];plan=record['transaction']
        if observed.get('hash')!=transaction_hash or observed.get('from','').lower()!=d['from'] or observed.get('to','').lower()!=d['to'] or observed.get('input','').lower()!=d['data'] or int(observed.get('value','-1'),16)!=0 or int(observed.get('nonce','-1'),16)!=int(plan['nonce']) or int(observed.get('chainId','-1'),16)!=d['chainId']:raise IntegrationRejected('ORIGINAL_RPC_TRANSACTION_MISMATCH',409)
        return transaction_hash

class RegistrationRuntimeHost:
    def __init__(self,namespace,domain=None,admission=None,*,missing=None):self.namespace,self.domain,self.admission,self.missing=namespace,domain,admission,list(missing or [])
    def handle(self,namespace,method,request,*,role=None):
        if namespace!=self.namespace or role!='registrar_client':return {'error':'IPC_FORBIDDEN','status':403}
        if method=='setup' and request=={}:return {'status':'NOT_CONFIGURED' if self.domain is None else 'CONFIGURED','missing':self.missing}
        if self.domain is None:return {'error':'REGISTRAR_NOT_CONFIGURED','status':503}
        if method not in {'registration_send_original','registration_lookup_original'} or set(request)!={'record'}:return {'error':'IPC_BAD_REQUEST','status':400}
        try:
            if method=='registration_lookup_original':
                material=self.admission.material(request['record']['registrationId'],lookup_only=True)
                runtime=importlib.import_module('c1_onboarding_integration.registrar_runtime')
                if runtime.RegistrarRuntime._immutable(material['record'])!=runtime.RegistrarRuntime._immutable(request['record']):raise IntegrationRejected('ORIGINAL_REGISTRATION_CONFLICT',409)
                if material['approval'] is None:return {'transactionHash':None,'authority':'LOCATOR_ONLY'}
            else:self.admission.ensure(request['record'])
            result=(self.domain.send_original if method=='registration_send_original' else self.domain.lookup_original)(request['record'])
            return {'transactionHash':result,'authority':'LOCATOR_ONLY'}
        except Exception as exc:
            code=getattr(exc,'code',str(exc));code=code if re.fullmatch('[A-Z0-9_]{1,80}',str(code)) else 'ORIGINAL_REGISTRAR_UNKNOWN'
            return {'error':code,'status':503}

def compose(config):
    if config.get('mode')!='CP30_REGISTRAR_RUNTIME' or config.get('enabled') is not True:return RegistrationRuntimeHost(config.get('namespace'),missing=['Explicit registrar activation and reviewed configuration']),[]
    from .db import Database
    namespace=config['namespace'];resources=[]
    try:
        owned_directory(config['runtimeDirectory']);module=persistence_module()
        # Registrar leaf imports its sibling business protocol under the documented name.
        business_modules();sys.modules.setdefault('business',sys.modules['c1_business_integration'])
        service,codec_module=domain_modules();registrar_module=importlib.import_module('c1_onboarding_integration.registrar_runtime')
        database=Database(config,config['runtimeExecutorRole'],'runtime_internal',max_size=2);resources.append(database)
        private=config['runtimeController'];controller=RuntimeLedgerControllerClient(Client(private['path'],private['cap'],timeout=5))
        ledger=module.PgRuntimeLedger(database,namespace,controller);profile=config['profile']
        rpc_settings={**config['rpc'],'registrar':profile['registrar'],'factory':profile['factory'],'factorySelectors':[value[:10] for value in profile_codec({'op':'calls'})['calls'].values()],'broadcastEnabled':True}
        rpc_factory=lambda:RegistrarRpc(rpc_settings)
        crypto=business_modules()['transaction_crypto'].TransactionCrypto(NODE)
        holder={}
        codec=codec_module.NodeRegistrationCodec(NODE,lambda:int(time.time()),lambda original:holder['admission'].owner_kind.get())
        admission=RegistrarAdmission(ledger=ledger,codec=codec,crypto=crypto,profile=profile,rpc_factory=rpc_factory,grant_id=config['grantId'],transaction_limits=config['transactionLimits']);holder['admission']=admission
        journal=OriginalSignerJournal(config['runtimeDirectory']);resources.append(journal)
        signer=DedicatedRegistrarSigner(journal=journal,key_handle=config['keyHandle'],registrar=profile['registrar'],crypto=crypto,factory=profile['factory'],chain_id=int(profile['chainId']))
        domain=registrar_module.RegistrarRuntime(module.PgRuntimePolicy(),ledger,signer,RegistrarBroadcaster(rpc_factory,profile,crypto,before_broadcast=lambda record:admission.material(record['registrationId'])),codec,crypto,lambda:int(time.time()))
        return RegistrationRuntimeHost(namespace,domain,admission),resources
    except BaseException:
        for resource in reversed(resources):resource.close()
        raise

def main():
    import argparse,signal,threading
    parser=argparse.ArgumentParser();parser.add_argument('--config',required=True);args=parser.parse_args()
    if os.environ:raise SystemExit('EMPTY_ENVIRONMENT_REQUIRED')
    path=Path(args.config);info=path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or stat.S_IMODE(info.st_mode)!=0o600:raise SystemExit('PRIVATE_CONFIG_REQUIRED')
    from .private_connection_config import load
    config=load(path);resources=[]
    try:host,resources=compose(config)
    except Exception:host=RegistrationRuntimeHost(config.get('namespace'),missing=['Registrar profile/ledger/key handle is not configured'])
    from contextlib import ExitStack
    with ExitStack() as stack:
        for resource in resources:stack.callback(resource.close)
        server=Server(config['socket_path'],{'registrar_client':{'cap':config['client_cap'],'methods':['setup','registration_send_original','registration_lookup_original']}},host.handle,max_handlers=2);stack.callback(server.server_close)
        event=threading.Event();signal.signal(signal.SIGTERM,lambda *_:event.set());signal.signal(signal.SIGINT,lambda *_:event.set())
        thread=threading.Thread(target=lambda:server.serve_forever(poll_interval=.1),daemon=True);thread.start()
        try:event.wait()
        finally:server.shutdown();thread.join(timeout=5)

if __name__=='__main__':main()
