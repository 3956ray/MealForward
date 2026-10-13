"""Fixed durable onboarding adapters. No ambient profile, network or signing.

The runtime must explicitly compose real identity/registrar/finality/projection
authorities before the gateway opens. Missing authorities are never synthetic.
"""
from contextlib import contextmanager
from copy import deepcopy
import base64
import importlib
import importlib.util
import json
from pathlib import Path
import secrets
import subprocess
import sys
import time
from .encoding import NODE,encode_hash,image_hash
from .codec import normalize_image

ROOT=Path(__file__).resolve().parents[2]
PIN='0x3aed59967d18f9b80a436f1080f9b55b5ea9299f62eb1c7d8f612d7ed8d30b4e'
ENABLE_REJECTION_STATUS={'INVALID_SIGNATURE':422,'INVALID_OWNER_AUTHORIZATION':422,
    'INVALID_DEPLOYMENT_PAYLOAD':422,'INVALID_BYTES32':422,'CODEC_INPUT_LIMIT':422,
    'AUTHORIZATION_EXPIRED':409,'IDEMPOTENCY_CONFLICT':409,'SNAPSHOT_CHANGED':409,
    'CODEC_UNAVAILABLE':503,'OWNER_SIGNATURE_CHECKER_REQUIRED':503,'NOT_FOUND':404}

class IntegrationRejected(ValueError):
    def __init__(self,code,status=409):
        self.code,self.status=code,status
        super().__init__(code)

def domain_modules():
    # Import finalized helper source as-is, never copy/rewrite it into shared code.
    name='c1_onboarding_integration'
    if name not in sys.modules:
        directory=ROOT/'integrations/onboarding'
        spec=importlib.util.spec_from_file_location(name,directory/'__init__.py',submodule_search_locations=[str(directory)])
        module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module)
    return importlib.import_module(name+'.service'),importlib.import_module(name+'.codec')

class PostgresTransaction:
    def __init__(self,fixed,context,internal=False):
        self.fixed,self.context,self.internal=fixed,context,internal
    def call(self,method,**request):
        request={**request,'readOnly':self.fixed.read_only}
        if self.context:
            request={**request,'session_hash':self.context.session_hash,'csrf_hash':self.context.csrf_hash}
        return self.fixed.call(method,request)
    def by_key(self,namespace,subject,key):
        if self.internal or namespace!=self.fixed.namespace:raise IntegrationRejected('NOT_FOUND',404)
        record=self.call('onboarding_get_by_key',key=key)['record']
        if record and record['subject']!=subject:raise IntegrationRejected('NOT_FOUND',404)
        return deepcopy(record)
    def by_id(self,namespace,registration_id):
        if namespace!=self.fixed.namespace:raise IntegrationRejected('NOT_FOUND',404)
        return deepcopy(self.call('registration_get' if self.internal else 'onboarding_get_by_id',id=registration_id)['record'])
    def insert(self,record):
        if self.internal:raise IntegrationRejected('UNSUPPORTED_METHOD',422)
        self.call('onboarding_insert',record=record)
    def save(self,record):
        self.call('registration_save' if self.internal else 'onboarding_save',record=record)
    def reserve_slot(self,record,maximum):
        if self.internal or maximum!=3:raise IntegrationRejected('INVALID_CAPACITY',422)
        self.call('onboarding_reserve_slot',id=record['registrationId'])
    def enqueue_once(self,record):
        if self.internal:raise IntegrationRejected('UNSUPPORTED_METHOD',422)
        self.call('onboarding_enqueue',id=record['registrationId'])
    def publish_confirmed(self,record):
        if not self.internal:raise IntegrationRejected('PRIVATE_OBSERVER_REQUIRED',403)
        self.call('registration_publish',id=record['registrationId'])

class PostgresStorage:
    def __init__(self,database,namespace,context=None,*,internal=False):
        if internal and database.database!='onboarding_internal':raise IntegrationRejected('PRIVATE_OBSERVER_REQUIRED',403)
        self.database,self.namespace,self.context,self.internal=database,namespace,context,internal
    @contextmanager
    def transaction(self,*,read_only=False):
        with self.database.transaction(self.namespace,read_only=read_only) as fixed:
            yield PostgresTransaction(fixed,self.context,self.internal)

class IdentityAuthority:
    def __init__(self,owner_type):
        self.owner_type=owner_type;self.current=None
    def authorize(self,tx,context,action):
        if tx.context!=context or tx.fixed.namespace!=context.namespace:raise IntegrationRejected('NOT_FOUND',404)
        result=tx.call('onboarding_authorize',action=action)
        self.current=result
        return self.owner_type(result['subject'],result['owner'],result['bindingRevision'])
    def owner_kind(self,original):
        if not self.current or self.current['owner']!=original['owner']:raise IntegrationRejected('REAL_IDENTITY_BINDING_REQUIRED',401)
        return self.current['ownerKind']
    def authorize_internal(self,tx,record):
        if not tx.internal:raise IntegrationRejected('PRIVATE_OBSERVER_REQUIRED',403)
        result=tx.call('registration_authorize',id=record['registrationId'])
        return self.owner_type(result['subject'],result['owner'],result['bindingRevision'])

class CatalogBuilder:
    def __init__(self,draft=None):
        # Hash the exact text outside a transaction, using the existing pinned codec.
        self.draft=deepcopy(draft)
        self.meal_id='0x'+secrets.token_hex(32)
        self.body=encode_hash('body',name=draft['name'],description=draft['description'])['bodyDigest'] if draft else None
    def build(self,tx,identity,draft):
        if draft!=self.draft:raise IntegrationRejected('DRAFT_CATALOG_MISMATCH',422)
        image=tx.call('onboarding_image_get',imageRef=draft['imageRef'])
        windows=draft['windows']+[[0,0]]*(2-len(draft['windows']))
        return [{'current':True,'terms':{'mealId':self.meal_id,'version':'1',
            'unitPrice':draft['unitPrice'],'bodyDigest':self.body,'imageDigest':image['imageDigest'],
            'windowCount':len(draft['windows']),'startMinute0':windows[0][0],'endMinute0':windows[0][1],
            'startMinute1':windows[1][0],'endMinute1':windows[1][1]}}]

class ReceiptVerifier:
    """Prefetch only from a trusted internal reader, detached from DB transactions.

    Reader supplies original transaction/receipt, independent canonical+finalized
    headers, factory mappings/configuration, escrow code/getters/current catalog.
    Neither this reader nor confirmation is exposed as an HTTP input.
    """
    def __init__(self,reader=None,profile=None):
        self.reader,self.profile,self.cached=reader,profile or {},None
    def verify_original(self,original,tx_hash,deployment):
        if self.reader is None:raise IntegrationRejected('RECEIPT_VERIFIER_NOT_CONFIGURED',503)
        # Finalized helper owns template/immutable/EIP1898 verification; never
        # substitute a browser observation or a caller-selected runtime code hash.
        return self.reader.verify_original(deepcopy(original),tx_hash,deepcopy(deployment))

def wallet_bridge(request):
    raw=json.dumps(request,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()
    if len(raw)>1048576:raise IntegrationRejected('CODEC_INPUT_LIMIT',422)
    try:
        result=subprocess.run([NODE,str(Path(__file__).with_name('wallet-bridge.mjs'))],input=raw,
            stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env={},timeout=3,check=False)
        if result.returncode or len(result.stdout)>1048576:raise IntegrationRejected('CODEC_UNAVAILABLE',503)
        value=json.loads(result.stdout)
        if not isinstance(value,dict) or value.get('error'):raise IntegrationRejected('CODEC_UNAVAILABLE',503)
        return value
    except (OSError,subprocess.TimeoutExpired,json.JSONDecodeError):raise IntegrationRejected('CODEC_UNAVAILABLE',503) from None

class OnboardingGateway:
    def __init__(self,database,namespace,profile=None,*,run=None,clock=None,
                 verified_identity_authority=None,registrar_authority=None,
                 receipt_reader=None,publication_adapter=None,operation_gate=None,business_datasource=None):
        self.database,self.namespace,self.profile,self.run=database,namespace,deepcopy(profile),run
        self.clock=clock or (lambda:int(time.time()))
        self.identity_source,self.registrar,self.receipt_reader=verified_identity_authority,registrar_authority,receipt_reader
        self.publisher=publication_adapter or PublicationAdapter(database,namespace)
        self.operation_gate=operation_gate
        self.business_datasource=business_datasource
    def setup(self):
        missing=[]
        if not self.profile or self.profile.get('mode')!='TESTNET':missing.append('Reviewed chain, test asset, factory and authority profile')
        required=('chainId','factory','registrar','asset','assetDecimals','assetSymbol','quoteAuthority','catalogAuthority','issuerAuthority','operatorAuthority','escrowCreationCodeHash')
        if self.profile and any(key not in self.profile for key in required):missing.append('Complete immutable factory/asset profile and code pins')
        if self.identity_source is None:missing.append('Verified login and owner-wallet binding authority')
        if self.registrar is None:missing.append('Private registrar runtime and deployment/gas budget')
        if self.receipt_reader is None:missing.append('Independent canonical/finalized receipt and code verifier')
        if self.publisher is None:missing.append('Confirmed real store/catalog and quote projection')
        if not self.run:missing.append('Owned content normalization workspace')
        return {**(self.business_datasource.metadata() if self.business_datasource is not None and getattr(self.business_datasource,'configured',False) else {'mode':getattr(self,'mode',None),'assetVerified':False}),'status':'NOT_CONFIGURED' if missing else 'CONFIGURED_NOT_ACTIVATED','walletActionsEnabled':self.allowed('register','setup'),'registrationEnabled':not missing,'serverTime':self.clock(),
            'missing':missing,'realLoginConnected':self.identity_source is not None,'testnetConnected':False,
            'assetDecimals':self.business_datasource.metadata()['assetDecimals'] if self.business_datasource is not None and getattr(self.business_datasource,'configured',False) else self.profile.get('assetDecimals') if self.profile else None,'assetSymbol':self.business_datasource.metadata()['assetSymbol'] if self.business_datasource is not None and getattr(self.business_datasource,'configured',False) else self.profile.get('assetSymbol') if self.profile else None,
            'storeLimit':3,'firstRun':{'stores':1,'meals':1,'testAssets':1}}
    def allowed(self,action,original_id):
        return self.operation_gate is not None and self.operation_gate.allowed(self.namespace(),action,original_id)
    def require_configured(self):
        if self.setup()['missing']:raise IntegrationRejected('NOT_CONFIGURED',503)
        # Profile selection is server-only. A synthetic namespace/profile is never promoted.
        if self.profile['escrowCreationCodeHash']!=PIN:raise IntegrationRejected('FACTORY_BUILD_PIN_MISMATCH',503)
    def domain(self,session_hash,csrf_hash=None,draft=None):
        self.require_configured()
        service,codec=domain_modules();context=service.SessionContext(self.namespace(),session_hash,csrf_hash)
        identity=IdentityAuthority(service.OwnerIdentity)
        keys=['chainId','factory','registrar','asset','quoteAuthority','catalogAuthority','issuerAuthority','operatorAuthority','escrowCreationCodeHash']
        values=[self.profile[key] for key in keys];values[0]=int(values[0])
        config=service.FactoryConfig(*values)
        node_codec=codec.NodeRegistrationCodec(NODE,self.clock,identity.owner_kind,
            getattr(self.identity_source,'verify_smart_wallet',None))
        domain=service.Onboarding(PostgresStorage(self.database,context.namespace,context),identity,
            CatalogBuilder(draft),node_codec,ReceiptVerifier(self.receipt_reader,self.profile),config,
            lambda:'0x'+secrets.token_hex(32),self.clock)
        return domain,context
    def register(self,q,key,body):
        self.require_configured();service,_=domain_modules();body=service.validate_request(body)
        domain,context=self.domain(q.get('session_hash'),q.get('csrf_hash'),body['firstMeal'])
        data=domain.register(context,key,body)
        return {**data,'businessReady':False,'walletActionsEnabled':self.allowed('register',data['registrationId'])}
    def get(self,q,registration_id):
        domain,context=self.domain(q.get('session_hash'),q.get('csrf_hash'))
        data=domain.get(context,registration_id)
        business_ready=bool(data['ready'] and self.publisher.is_ready(registration_id) and self.business_datasource is not None and self.business_datasource.ready_for_store(registration_id))
        return {**data,'businessReady':business_ready,'walletActionsEnabled':self.allowed('register',registration_id)}
    def list_owned(self,q):
        self.require_configured()
        # Identity comes exclusively from the authenticated session in SQL.
        with self.database.transaction(self.namespace(),read_only=True) as tx:
            result=tx.call('onboarding_list_owned',{'session_hash':q.get('session_hash'),'readOnly':True})
        items=[]
        for data in result['items']:
            registration_id=data['registrationId']
            business_ready=bool(data['ready'] and self.publisher.is_ready(registration_id)
                and self.business_datasource is not None
                and self.business_datasource.ready_for_store(registration_id))
            items.append({**data,'businessReady':business_ready,
                'walletActionsEnabled':self.allowed('register',registration_id)})
        return {'items':items,'hasMore':result['hasMore']}
    def enable(self,q,registration_id,body):
        if not self.allowed('register',registration_id):raise IntegrationRejected('OPERATION_NOT_ACTIVATED',503)
        if type(body) is not dict or set(body)!={'ownerSignature'}:raise IntegrationRejected('INVALID_REQUEST',422)
        domain,context=self.domain(q.get('session_hash'),q.get('csrf_hash'))
        service,_=domain_modules()
        try:result=domain.enable(context,registration_id,body['ownerSignature'])
        except service.Rejected as exc:
            code=str(exc)
            if code not in ENABLE_REJECTION_STATUS:code='ONBOARDING_REQUEST_REJECTED'
            raise IntegrationRejected(code,ENABLE_REJECTION_STATUS.get(code,409)) from None
        return {**result,'businessReady':False,'walletActionsEnabled':self.allowed('register',registration_id)}
    def image(self,q,image,content_type):
        self.require_configured()
        # Authenticate before normalization, then reauthorize before the saved write.
        with self.database.transaction(self.namespace()) as tx:tx.call('onboarding_authorize',{**q,'action':'register'})
        normalized=normalize_image(image,content_type);digest=image_hash(normalized,self.run)[2:]
        with self.database.transaction(self.namespace()) as tx:
            return tx.call('onboarding_image_save',{**q,'id':'0x'+secrets.token_hex(32),
                'image':base64.b64encode(normalized).decode(),'imageDigest':digest})
    def wallet_preparation(self,q,intent_id):
        self.require_configured()
        if getattr(self,'mode',None)=='CP30_TESTNET_CONNECTION':
            if self.business_datasource is None or getattr(self.business_datasource,'live_business_protocol',None)!='CP30_LIVE_BUSINESS_V1':raise IntegrationRejected('LIVE_BUSINESS_NOT_CONFIGURED',503)
            return self.business_datasource.wallet_preparation(q,intent_id)
        material=self.database.call('wallet_material',self.namespace(),{**q,'id':intent_id})
        if material.get('error'):raise IntegrationRejected(material['error'],material.get('status',409))
        result=wallet_bridge({'op':'prepareWallet','material':material['material'],'now':str(material['now'])})
        # Runtime activation is a separate explicit gate. This slice prepares only.
        return {**result,'material':material['material'],'now':str(material['now']),'walletActionsEnabled':self.allowed(material['material']['kind'],intent_id),'status':'PREPARATION_ONLY'}
    def observe_wallet_transaction(self,q,intent_id,body):
        self.require_configured()
        if getattr(self,'mode',None)=='CP30_TESTNET_CONNECTION':
            if self.business_datasource is None or getattr(self.business_datasource,'live_business_protocol',None)!='CP30_LIVE_BUSINESS_V1':raise IntegrationRejected('LIVE_BUSINESS_NOT_CONFIGURED',503)
            return self.business_datasource.wallet_hash(q,intent_id,body)
        if type(body) is not dict or set(body)!={'kind','transactionHash'}:raise IntegrationRejected('INVALID_REQUEST',422)
        return self.database.call('wallet_transaction_observe',self.namespace(),{**q,'id':intent_id,
            'kind':body['kind'],'hash':body['transactionHash']})
    def begin_wallet_attempt(self,q,intent_id,body):
        self.require_configured()
        if getattr(self,'mode',None)=='CP30_TESTNET_CONNECTION':
            if self.business_datasource is None or getattr(self.business_datasource,'live_business_protocol',None)!='CP30_LIVE_BUSINESS_V1':raise IntegrationRejected('LIVE_BUSINESS_NOT_CONFIGURED',503)
            return self.business_datasource.wallet_attempt(q,intent_id,body)
        if not self.allowed('settle' if body.get('kind')=='settle' else 'fund',intent_id):raise IntegrationRejected('OPERATION_NOT_ACTIVATED',503)
        if type(body) is not dict or set(body)!={'kind'}:raise IntegrationRejected('INVALID_REQUEST',422)
        return self.database.call('wallet_attempt_begin',self.namespace(),{**q,'id':intent_id,'kind':body['kind']})
    def public_catalog(self):
        self.require_configured()
        return self.publisher.catalog()
    def public_image(self,image_digest):
        self.require_configured()
        return self.database.call('onboarding_public_image',self.namespace(),{'digest':image_digest})

class PublicationAdapter:
    """Confirmed-registration projection only; never seeds synthetic chain state."""
    def __init__(self,database,namespace):self.database,self.namespace=database,namespace
    def catalog(self):
        value=self.database.call('onboarding_public_catalog',self.namespace(),{})
        if value.get('error'):raise IntegrationRejected(value['error'],value.get('status',503))
        return value
    def is_ready(self,registration_id):
        return any(row['registrationId']==registration_id for row in self.catalog()['items'])
