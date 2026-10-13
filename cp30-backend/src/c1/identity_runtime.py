"""Private JWT/proof authority. No API-selected identities, roles or proof evidence.

Runtime entry is explicit; this module never starts services or reads configuration
at import. The API holds only this service's narrow capability, not the controller's.
"""
from dataclasses import asdict
import hashlib
import importlib
import importlib.util
import json
import secrets
import sys
import uuid
from .onboarding_adapter import ROOT,NODE,IntegrationRejected
from .email_policy import canonical_email,email_key

def identity_modules():
    project=str(ROOT.parent)
    if project not in sys.path:sys.path.insert(0,project)
    name='c1_identity_integration'
    if name not in sys.modules:
        directory=ROOT/'integrations/identity'
        spec=importlib.util.spec_from_file_location(name,directory/'__init__.py',submodule_search_locations=[str(directory)])
        module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module)
    return importlib.import_module(name+'.adapter'),importlib.import_module(name+'.wallet_proof')

def digest(value):return hashlib.sha256(value.encode()).hexdigest()
def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False)

class PgChallengeStore:
    def __init__(self,database,namespace,context,controller,proof_module):
        self.database,self.namespace,self.context,self.controller,self.proof=database,namespace,context,controller,proof_module
        self.signature_digest=None
    def session(self,session_hash):
        if session_hash.removeprefix('0x')!=self.context.get('session_hash'):return None
        data=self.database.call('wallet_session',self.namespace,self.context)
        if data.get('error'):return None
        identity_module,_=identity_modules();binding=identity_module.IdentityBinding(**data['identity'])
        return self.proof.WalletProofSession(session_hash,binding,data['expiresAt'])
    def reserve(self,challenge):
        result=self.database.call('wallet_challenge_create',self.namespace,{**self.context,'payload':asdict(challenge)})
        return result.get('reserved') is True
    def read(self,challenge_id):
        value=self.database.call('wallet_challenge_get',self.namespace,{**self.context,'id':challenge_id})
        payload=value.get('payload')
        if not payload:return None
        identity_module,_=identity_modules();session=payload['session']
        identity=identity_module.IdentityBinding(**session['identity'])
        session=self.proof.WalletProofSession(session['session_hash'],identity,session['expires_at'])
        return self.proof.WalletChallenge(payload['challenge_id'],payload['nonce'],payload['wallet'],payload['deadline'],self.proof.WalletProofDomain(**payload['domain']),session)
    def consume_once(self,expected,session,now):
        if not self.signature_digest:return False
        # Existing controller journal prepares immutable payload, independently
        # reads the committed proof and finishes. SQL consumes+binds atomically.
        command={**self.context,'challenge_id':expected.challenge_id,'owner':expected.wallet,
            'owner_kind':'EOA','proof_digest':self.signature_digest,'expected_challenge':asdict(expected)}
        result=self.controller.call(self.namespace,'wallet_binding',{'mutation_id':str(uuid.uuid4()),'command':command})
        return result.get('walletBound') is True

class VerifiedIdentityAuthority:
    def __init__(self,*,adapter,database,controller,clock,domain_factory,wallet_kind):
        self.adapter,self.database,self.controller,self.clock=adapter,database,controller,clock
        self.domain_factory,self.wallet_kind=domain_factory,wallet_kind
    def login(self,namespace,body,context):
        if type(body) is not dict or set(body)!={'accessToken'}:raise IntegrationRejected('INVALID_REQUEST',422)
        verified=self.adapter.verify_bearer('Bearer '+body['accessToken'])
        binding=self.adapter.normalize_binding(verified).to_json()
        session,csrf=secrets.token_urlsafe(32),secrets.token_urlsafe(32)
        command={**binding,'pre_hash':context.get('pre_hash'),'csrf_hash':context.get('csrf_hash'),
            'new_session_hash':digest(session),'new_csrf_hash':digest(csrf),'evidence_digest':digest(canonical(binding))}
        result=self.controller.call(namespace,'identity_exchange',{'mutation_id':str(uuid.uuid4()),'command':command})
        if result.get('error'):return result
        return {**result,'sessionToken':session,'csrfToken':csrf}
    def proof_service(self,namespace,context):
        _,proof=identity_modules()
        store=PgChallengeStore(self.database,namespace,context,self.controller,proof)
        domain=self.domain_factory(namespace)
        service=proof.WalletProofService(domain=domain,store=store,clock=self.clock,
            current_session=store.session,wallet_kind=self.wallet_kind,recoverer=proof.NodeEoaRecoverer(NODE))
        current=store.session('0x'+context.get('session_hash',''))
        if current is None:raise IntegrationRejected('UNAUTHENTICATED',401)
        return service,store,current
    def wallet_prepare(self,namespace,body,context):
        if type(body) is not dict or set(body)!={'wallet'}:raise IntegrationRejected('INVALID_REQUEST',422)
        service,_,session=self.proof_service(namespace,context)
        return service.issue(body['wallet'],session=session).public_projection()
    def wallet_submit(self,namespace,body,context):
        if type(body) is not dict or set(body)!={'challengeId','signature'}:raise IntegrationRejected('INVALID_REQUEST',422)
        service,store,session=self.proof_service(namespace,context)
        store.signature_digest=digest(body['signature'])
        verified=service.verify(body['challengeId'],body['signature'],session=session)
        return {'walletBound':True,'wallet':verified.wallet}

class IdentityServiceClient:
    def __init__(self,ipc,namespace,public_setup):self.ipc,self.namespace,self.public_setup=ipc,namespace,public_setup
    def setup(self):return self.ipc.call(self.namespace(),'setup',{})
    def call(self,operation,body,context):
        if operation not in {'login','wallet_prepare','wallet_submit','wallet_login_challenge','wallet_login'}:raise IntegrationRejected('INVALID_REQUEST',422)
        from .ipc import Client
        # Signature codec plus finalized EOA classification has a bounded10s RPC
        # session. Avoid a5s caller expiry after a valid session has committed.
        ipc=Client(self.ipc.path,self.ipc.cap,timeout=20) if operation=='wallet_login' else self.ipc
        return ipc.call(self.namespace(),operation,{'body':body,'context':context})

def compose_authority(config,database,controller,clock,*,wallet_kind):
    """Private service composition only. New server HMAC secrets are injected,
    never fetched from old runtime files, environment or browser inputs.
    """
    import hmac
    adapter_module,proof=identity_modules()
    from server.dynamic_contracts import ClaimProfile
    identity=config['identity'];profile=dict(identity['claimProfile']);profile['audiences']=tuple(profile['audiences'])
    email=dict(identity['emailProfile'])
    for field in ('email_path','verified_path','credentials_path'):
        if field in email and email[field] is not None:email[field]=tuple(email[field])
    namespace=config['namespace'];key=bytes.fromhex(identity['emailHmacKey']);subject_secret=bytes.fromhex(identity['subjectHmacKey'])
    if len(key)!=32 or len(subject_secret)!=32:raise IntegrationRejected('IDENTITY_BINDING_NOT_CONFIGURED',503)
    def subject_key(environment,issuer,subject):
        values=[namespace,environment,issuer,subject]
        payload=b'MCPAY-C1-SUBJECT-v1'+b''.join(len(x.encode()).to_bytes(4,'big')+x.encode() for x in values)
        return hmac.new(subject_secret,payload,hashlib.sha256).hexdigest()
    adapter=adapter_module.compose_dynamic_identity(profile=ClaimProfile(**profile),clock=clock,
        email_profile=adapter_module.SignedEmailClaimProfile(**email),canonical_email=canonical_email,
        email_key=lambda raw:email_key(namespace,raw,key),subject_key=subject_key)
    wallet=config['walletProof']
    def domain_factory(actual_namespace):
        if actual_namespace!=namespace:raise IntegrationRejected('NOT_FOUND',404)
        return proof.WalletProofDomain(wallet['name'],wallet['version'],wallet['chainId'],wallet['verifyingContract'],
            '0x'+digest(config['origin']),'0x'+digest(namespace),wallet['ttlSeconds'])
    return VerifiedIdentityAuthority(adapter=adapter,database=database,controller=controller,clock=clock,
        domain_factory=domain_factory,wallet_kind=wallet_kind)

def main():
    import argparse,os,re,signal,stat,threading,time
    from pathlib import Path
    from .db import Database
    from .ipc import Client,Server
    from .connection_composition import wallet_modules
    parser=argparse.ArgumentParser();parser.add_argument('--config',required=True);args=parser.parse_args()
    if os.environ:raise SystemExit('EMPTY_ENVIRONMENT_REQUIRED')
    path=Path(args.config);info=path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or stat.S_IMODE(info.st_mode)!=0o600:raise SystemExit('PRIVATE_CONFIG_REQUIRED')
    from .private_connection_config import load
    config=load(path)
    if config.get('mode')!='CP30_REAL_IDENTITY_AUTHORITY':raise SystemExit('EXPLICIT_IDENTITY_MODE_REQUIRED')
    namespace=config['namespace'];activation=config.get('activation') or {}
    setup={'status':'NOT_CONFIGURED','sdkLoginEnabled':False,'walletProofEnabled':False,'walletLoginEnabled':False,'environmentId':'7fe95f70-e5cc-4c3c-beed-a133e81268dc','missing':[]}
    database=None;authority=None;wallet_authority=None
    try:
        if activation.get('identity') is not True:raise IntegrationRejected('IDENTITY_NOT_ACTIVATED',503)
        database=Database(config,config['identityDatabaseRole'],'onboarding_internal',max_size=2)
        private=config['controller'];controller=Client(private['path'],private['cap'],timeout=5)
        _,transport_module=wallet_modules();rpc=config['walletKindRpc']
        def wallet_kind(address):
            # Only absence of code at a canonical finalized block is classified
            # EOA. Contracts, delegation code and unknown provider policy reject.
            profile=rpc['profile'];transport=transport_module.ReadOnlyJsonRpcTransport(endpoint=rpc['endpoint'],allowed_endpoints=rpc['allowedEndpoints'],allowed_hosts=rpc['allowedHosts'],python_executable=rpc['pythonExecutable'],profile=profile)
            deadline=time.monotonic()+min(10,profile['budget']['maxTotalMs']/1000)
            if int(transport.request('eth_chainId',[],deadline=deadline),16)!=profile['chainId']:return 'UNKNOWN'
            genesis=transport.request('eth_getBlockByNumber',['0x0',False],deadline=deadline)
            if genesis.get('hash')!=profile['genesisHash']:return 'UNKNOWN'
            header=transport.request('eth_getBlockByNumber',['finalized',False],deadline=deadline)
            if not header or not re.fullmatch('0x[0-9a-f]{64}',str(header.get('hash'))):return 'UNKNOWN'
            code=transport.request('eth_getCode',[address,{'blockHash':header['hash'],'requireCanonical':True}],deadline=deadline)
            ending=transport.request('eth_getBlockByNumber',[header['number'],False],deadline=deadline)
            if ending.get('hash')!=header['hash'] or int(transport.request('eth_chainId',[],deadline=deadline),16)!=profile['chainId']:return 'UNKNOWN'
            return 'EOA' if code=='0x' else 'SMART'
        authority=compose_authority(config,database,controller,lambda:int(time.time()),wallet_kind=wallet_kind)
        setup.update(status='CONFIGURED',sdkLoginEnabled=True,walletProofEnabled=activation.get('ownerWalletBinding') is True,walletProofChainId=config['walletProof']['chainId'])
        from .wallet_identity import load_extension,WalletIdentityAuthority
        from .private_connection_config import read_private
        marker,_=read_private(path.parent/'CONNECTION-OWNED.json');installed,_=read_private(path.parent/'INSTALLED.json')
        extension=load_extension(path.parent,marker,installed)
        if extension is not None:
            if extension['namespace']!=namespace or extension['origin']!=config['origin'] or extension['activationExpiresAt']!=activation['expiresAt']:raise ValueError('WALLET_EXTENSION_ORIGIN_REQUIRED')
            wallet_authority=WalletIdentityAuthority(extension,database,controller,lambda:int(time.time()),wallet_kind=wallet_kind)
            state=wallet_authority.status(namespace)
            setup.update(walletLoginEnabled=state['enabled'],walletLoginChainId=extension['chainId'],walletLoginOrigin=extension['origin'])
    except Exception as exc:
        code=getattr(exc,'code',str(exc))
        setup['missing']=[code if isinstance(code,str) and re.fullmatch('[A-Z0-9_]{1,80}',code) else 'IDENTITY_CONFIGURATION_REQUIRED']
    def handler(actual_namespace,method,request,*,role=None):
        if actual_namespace!=namespace or role!='identity_api':return {'error':'IPC_FORBIDDEN','status':403}
        if method=='setup' and request=={}:
            if wallet_authority is not None:
                try:setup['walletLoginEnabled']=wallet_authority.status(namespace).get('enabled') is True
                except Exception:setup['walletLoginEnabled']=False
            return setup
        if authority is None:return {'error':setup['missing'][0] if setup['missing'] else 'NOT_CONFIGURED','status':503}
        if set(request)!={'body','context'} or method not in {'login','wallet_prepare','wallet_submit','wallet_login_challenge','wallet_login'}:return {'error':'INVALID_REQUEST','status':422}
        if method in {'wallet_prepare','wallet_submit'} and not setup['walletProofEnabled']:return {'error':'OPERATION_NOT_ACTIVATED','status':503}
        try:
            if method in {'wallet_login_challenge','wallet_login'}:
                if wallet_authority is None:return {'error':'WALLET_LOGIN_DISABLED','status':503}
                return getattr(wallet_authority,'challenge' if method=='wallet_login_challenge' else 'login')(namespace,request['body'],request['context'])
            return getattr(authority,method)(namespace,request['body'],request['context'])
        except Exception as exc:
            code=getattr(exc,'code','IDENTITY_REQUEST_REJECTED');status=getattr(exc,'status',401)
            return {'error':code if re.fullmatch('[A-Z0-9_]{1,80}',str(code)) else 'IDENTITY_REQUEST_REJECTED','status':status}
    server=Server(config['socket_path'],{'identity_api':{'cap':config['api_cap'],'methods':['setup','login','wallet_prepare','wallet_submit','wallet_login_challenge','wallet_login']}},handler,max_handlers=4)
    stopped=threading.Event();signal.signal(signal.SIGTERM,lambda *_:stopped.set());signal.signal(signal.SIGINT,lambda *_:stopped.set())
    thread=threading.Thread(target=lambda:server.serve_forever(poll_interval=.1),daemon=True);thread.start()
    try:stopped.wait()
    finally:server.shutdown();thread.join(timeout=5);server.server_close();database.close() if database is not None else None

if __name__=='__main__':main()
