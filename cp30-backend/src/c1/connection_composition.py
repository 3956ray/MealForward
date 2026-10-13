"""Explicit source composition. Defaults never connect or activate real services."""
import importlib
import re
import sys
import time
import types
from copy import deepcopy
from .ipc import Client
from .onboarding_adapter import (OnboardingGateway,PostgresStorage,IdentityAuthority,
    CatalogBuilder,ReceiptVerifier,domain_modules,ROOT,NODE,IntegrationRejected)
from .identity_adapter import IdentityGateway
from .identity_runtime import IdentityServiceClient
from .factory_capacity_transport import FactoryCapacityTransport

def wallet_modules():
    name='c1_wallet_integration'
    if name not in sys.modules:
        module=types.ModuleType(name);module.__path__=[str(ROOT/'integrations/wallet')];sys.modules[name]=module
    return importlib.import_module(name+'.registration_observer'),importlib.import_module(name+'.rpc_transport')

class ActivationGate:
    def __init__(self,config,namespace):self.config,self.namespace=config,namespace
    def allowed(self,namespace,action,original_id):
        flags={'register':'storeDeployment','fund':'payerWalletTransactions','settle':'ownerSettlement','walletProof':'ownerWalletBinding'}
        key=flags.get(action)
        if not key or self.config.get(key) is not True:return False
        return bool(original_id and namespace==self.namespace()
            and type(self.config.get('expiresAt')) is int and int(time.time())<self.config['expiresAt'])

class PrivateRegistrarClient:
    original_lookup_protocol='CP30_ORIGINAL_REGISTRATION_V1'
    def __init__(self,ipc,namespace):self.ipc,self.namespace=ipc,namespace
    def _call(self,method,record):
        if record['namespace']!=self.namespace():raise IntegrationRejected('NOT_FOUND',404)
        response=self.ipc.call(record['namespace'],method,{'record':record})
        if response.get('error'):raise IntegrationRejected('REGISTRAR_UNAVAILABLE',503)
        value=response.get('transactionHash')
        if value is not None and (not isinstance(value,str) or len(value)!=66):raise IntegrationRejected('REGISTRAR_PROTOCOL_ERROR',503)
        return value
    def send_original(self,record):return self._call('registration_send_original',record)
    def lookup_original(self,record):return self._call('registration_lookup_original',record)

class PersistentRegistrationTasks:
    def __init__(self,database,namespace):self.database,self.namespace=database,namespace
    def next_task(self):
        value=self.database.call('registration_next',self.namespace(),{})
        if value.get('error'):raise IntegrationRejected(value['error'],value.get('status',503))
        return value.get('task')

class RegistrationWorker:
    def __init__(self,dispatcher,*,capacity_observer=None,database=None,namespace=None,
        expected_profile=None,monotonic=time.monotonic):
        self.dispatcher,self.last_error=dispatcher,None
        self.capacity_observer,self.database,self.namespace=capacity_observer,database,namespace
        self.expected_profile,self.monotonic=expected_profile,monotonic
        self.next_capacity_refresh=0
        if capacity_observer is not None and (database is None or not callable(namespace) or expected_profile is None):
            raise IntegrationRejected('FACTORY_CAPACITY_NOT_CONFIGURED',503)
    def close(self):
        if getattr(self,'database',None) is not None:self.database.close()
    def step(self):
        if self.capacity_observer is not None:
            if self.monotonic()>=self.next_capacity_refresh:
                try:
                    # Observer IO completes before the one private DB transaction.
                    evidence=self.capacity_observer.observe()
                    if type(evidence) is not dict or set(evidence)!={'profile','count','observedAt','blockHash'} or evidence['profile']!=self.expected_profile:
                        raise IntegrationRejected('FACTORY_CAPACITY_UNAVAILABLE',503)
                    block_hash=evidence['blockHash']
                    if type(block_hash) is not str or not re.fullmatch('0x[0-9a-f]{64}',block_hash):
                        raise IntegrationRejected('FACTORY_CAPACITY_UNAVAILABLE',503)
                    retained=self.database.call('factory_capacity',self.namespace(),{**evidence,'blockHash':block_hash[2:]})
                    if retained.get('retained') is not True:raise IntegrationRejected('FACTORY_CAPACITY_UNAVAILABLE',503)
                    self.last_error=None
                except Exception:
                    self.last_error='FACTORY_CAPACITY_UNAVAILABLE'
                finally:self.next_capacity_refresh=self.monotonic()+10
            # New enable still requires fresh trusted capacity and its saved
            # slot in SQL. Keep the original authorized queue/UNKNOWN protocol.
        return self._dispatch(self.dispatcher)
    def _dispatch(self,dispatcher):
        try:return dispatcher.step()
        except Exception as exc:
            # The dispatcher has durably made UNKNOWN before any send. Observer
            # transport errors do not turn into confirmation or a fresh send.
            self.last_error=type(exc).__name__
            return {'state':'UNKNOWN','ready':False,'reason':'ORIGINAL_OBSERVATION_UNAVAILABLE'}

def compose_services(config,database,namespace,*,services=None):
    services=services or {};connection=config.get('connection') or {}
    profile=connection.get('profile') or config.get('onboarding')
    activation=connection.get('activation') or {}
    gate=ActivationGate(activation,namespace)
    identity_client=services.get('identity_client')
    if identity_client is None and connection.get('identityService'):
        private=connection['identityService']
        identity_client=IdentityServiceClient(Client(private['path'],private['cap'],timeout=5),namespace,{})
    identity=IdentityGateway(service_client=identity_client)
    registrar=services.get('registrar')
    if registrar is None and connection.get('registrar'):
        private=connection['registrar'];registrar=PrivateRegistrarClient(Client(private['path'],private['cap'],timeout=3),namespace)
    observer=services.get('receipt_verifier')
    if observer is None and connection.get('observer'):
        module,transport_module=wallet_modules();settings=connection['observer'];observer_profile=settings['profile']
        def transport_factory():
            return transport_module.ReadOnlyJsonRpcTransport(endpoint=settings['endpoint'],allowed_endpoints=settings['allowedEndpoints'],
                allowed_hosts=settings['allowedHosts'],python_executable=settings['pythonExecutable'],profile=observer_profile,registration_receipt=True)
        observer=module.NodeReceiptVerifier(node_executable=NODE,profile=observer_profile,transport_factory=transport_factory,
            compiler_pins=settings['compilerPins'])
    business=services.get('business_gateway')
    if business is None and config.get('mode')=='CP30_TESTNET_CONNECTION':
        from .live_gateway import compose_live
        business=compose_live(config,namespace,gate)
    if business is not None and profile:
        asset=business.config['asset']
        if int(profile['chainId'])!=asset['chainId'] or profile['asset']!=asset['address'] or profile['assetDecimals']!=asset['decimals'] or profile['assetSymbol']!=asset['symbol']:
            business.close();raise IntegrationRejected('REVIEWED_ASSET_PROFILE_MISMATCH',503)
    gateway=OnboardingGateway(database,namespace,profile,run=config.get('run'),
        verified_identity_authority=identity_client,registrar_authority=registrar,receipt_reader=observer,operation_gate=gate,business_datasource=business)
    gateway.mode=config.get('mode')
    result={'onboarding':gateway,'identity':identity,'dispatcher':None,'business_gateway':business}
    private_database=services.get('registration_database')
    if private_database is None and connection.get('registrationDatabaseRole') and activation.get('storeDeployment') is True:
        from .db import Database
        private_database=Database(config,connection['registrationDatabaseRole'],'onboarding_internal',max_size=1)
    if private_database is not None and registrar is not None and observer is not None and profile is not None:
        domain,codec=domain_modules();identity_authority=IdentityAuthority(domain.OwnerIdentity)
        values=[profile[k] for k in ['chainId','factory','registrar','asset','quoteAuthority','catalogAuthority','issuerAuthority','operatorAuthority','escrowCreationCodeHash']];values[0]=int(values[0])
        factory_config=domain.FactoryConfig(*values)
        original_domain=domain.Onboarding(PostgresStorage(private_database,namespace(),internal=True),identity_authority,
            CatalogBuilder(),codec.NodeRegistrationCodec(NODE,lambda:int(time.time()),identity_authority.owner_kind),
            ReceiptVerifier(observer),factory_config,lambda:None,lambda:int(time.time()))
        dispatcher_module=importlib.import_module('c1_onboarding_integration.dispatcher')
        capacity_observer=services.get('capacity_observer')
        if capacity_observer is None:
            capacity_module=importlib.import_module('c1_onboarding_integration.factory_capacity')
            settings=connection['observer']
            capacity_profile=deepcopy(settings['profile'])
            capacity_profile['budget']['maxTotalMs']=min(20000,capacity_profile['budget']['maxTotalMs'])
            capacity_settings={**settings,'profile':capacity_profile}
            capacity_observer=capacity_module.FactoryCapacityObserver(profile=capacity_profile,
                transport_factory=lambda:FactoryCapacityTransport(capacity_settings,capacity_profile),node_executable=NODE)
        result['dispatcher']=RegistrationWorker(dispatcher_module.OnboardingDispatcher(original_domain,registrar,PersistentRegistrationTasks(private_database,namespace)),
            capacity_observer=capacity_observer,database=private_database,namespace=namespace,expected_profile=factory_config.parameters())
    return result
