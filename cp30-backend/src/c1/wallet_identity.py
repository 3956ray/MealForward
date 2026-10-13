"""Independent verified wallet principal. No email fabrication or transaction signer."""
import hashlib
import hmac
import json
import re
import secrets
import uuid
from .onboarding_adapter import IntegrationRejected, NODE
from .private_connection_config import read_private

PROTOCOL='CP30_WALLET_LOGIN_EXTENSION_V1'
SOURCE_PIN_PATHS=('src/c1/wallet_identity.py','src/c1/identity_runtime.py','src/c1/identity_adapter.py',
 'src/c1/identity_security_controller.py','src/c1/controller.py','src/c1/db.py','src/c1/application.py',
 'integrations/identity/wallet_login.py','integrations/identity/wallet-login-codec.mjs')
def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()
def digest(value):return hashlib.sha256(value.encode()).hexdigest()

def load_extension(run,marker,installed):
    path=run/'WALLET-LOGIN-INSTALLED.json'
    if not path.exists():return None
    manifest,_=read_private(path);config,raw=read_private(run/'wallet-login.json')
    if (manifest.get('protocol')!=PROTOCOL or manifest.get('runId')!=marker['id']
        or manifest.get('configSha256')!=hashlib.sha256(raw).hexdigest()
        or manifest.get('originalConfigs')!=installed['configs']):raise ValueError('WALLET_EXTENSION_PIN_REQUIRED')
    from pathlib import Path
    root=Path(__file__).resolve().parents[2]
    pins=manifest.get('sourcePins')
    if type(pins) is not dict or set(pins)!=set(SOURCE_PIN_PATHS) or any(hashlib.sha256((root/name).read_bytes()).hexdigest()!=pins[name] for name in SOURCE_PIN_PATHS):raise ValueError('WALLET_EXTENSION_SOURCE_PIN_REQUIRED')
    if config.get('protocol')!=PROTOCOL or config.get('namespace')!=manifest.get('namespace') or config.get('installId')!=manifest.get('installId'):raise ValueError('WALLET_EXTENSION_SCOPE_REQUIRED')
    from .full_configuration import validate_origin
    validate_origin(config['origin'],config['port'])
    if (config['chainId']!=10143 or type(config['chainId']) is not int
        or config['challengeTtlSeconds']!=180 or config['sessionTtlSeconds']!=3600
        or type(config.get('activationExpiresAt')) is not int
        or not re.fullmatch('[0-9a-f]{64}',str(config.get('principalHmacKey')))):
        raise ValueError('WALLET_EXTENSION_PROFILE_REQUIRED')
    return {**config,'configSha256':manifest['configSha256']}

class WalletIdentityAuthority:
    def __init__(self,config,database,controller,clock,*,wallet_kind,leaf=None):
        self.config,self.database,self.controller,self.clock=config,database,controller,clock
        self.wallet_kind=wallet_kind
        if leaf is None:
            from .identity_runtime import identity_modules
            identity_modules()
            import importlib
            leaf=importlib.import_module('c1_identity_integration.wallet_login')
        self.leaf=leaf;self.key=bytes.fromhex(config['principalHmacKey'])
        if len(self.key)!=32:raise ValueError('WALLET_EXTENSION_PROFILE_REQUIRED')
    def status(self,namespace):
        if namespace!=self.config['namespace']:raise IntegrationRejected('IPC_FORBIDDEN',403)
        value=self.database.call('wallet_login_status',namespace,{})
        if (value.get('error') or value.get('configDigest')!=self.config['configSha256']
            or value.get('origin')!=self.config['origin'] or value.get('chainId')!=self.config['chainId']):
            raise IntegrationRejected('WALLET_LOGIN_NOT_CONFIGURED',503)
        return value
    def require_enabled(self,namespace):
        if self.status(namespace).get('enabled') is not True:raise IntegrationRejected('WALLET_LOGIN_DISABLED',503)
    def crypto(self,method,*args,**kwargs):
        try:return getattr(self.leaf,method)(*args,**kwargs)
        except Exception as error:
            code=getattr(error,'code','WALLET_LOGIN_REJECTED')
            if code not in {'WALLET_LOGIN_REJECTED','WALLET_LOGIN_CODEC_UNAVAILABLE'}:code='WALLET_LOGIN_REJECTED'
            raise IntegrationRejected(code,503 if code=='WALLET_LOGIN_CODEC_UNAVAILABLE' else 401) from None
    def challenge(self,namespace,body,context):
        self.require_enabled(namespace)
        if type(body) is not dict or set(body)!={'address'} or type(body['address']) is not str or not re.fullmatch('0x[0-9a-fA-F]{40}',body['address']) or int(body['address'],16)==0:raise IntegrationRejected('INVALID_REQUEST',422)
        now=int(self.clock());challenge=self.crypto('build_wallet_login_challenge',wallet=body['address'].lower(),
            origin=self.config['origin'],chain_id=self.config['chainId'],nonce=secrets.token_hex(32),
            challenge_id=str(uuid.uuid4()),issued_at=now,expires_at=now+self.config['challengeTtlSeconds'],node_executable=NODE)
        result=self.controller.call(namespace,'wallet_login_challenge',{'mutation_id':str(uuid.uuid4()),
            'command':{'pre_hash':context.get('pre_hash'),'csrf_hash':context.get('csrf_hash'),'challenge':challenge}})
        if result.get('error'):return result
        return result['challenge']
    def login(self,namespace,body,context):
        self.require_enabled(namespace)
        if type(body) is not dict or set(body)!={'challengeId','signature'}:raise IntegrationRejected('INVALID_REQUEST',422)
        material=self.database.call('wallet_login_material',namespace,{'id':body['challengeId'],
            'pre_hash':context.get('pre_hash'),'csrf_hash':context.get('csrf_hash')})
        if material.get('error'):return material
        challenge=material['challenge'];now=int(self.clock())
        address=self.crypto('verify_wallet_login_signature',challenge,body['signature'],now=now,node_executable=NODE)
        if address!=challenge['address']:raise IntegrationRejected('WALLET_LOGIN_REJECTED',401)
        try:kind=self.wallet_kind(address)
        except Exception:raise IntegrationRejected('WALLET_LOGIN_WALLET_KIND_UNAVAILABLE',503) from None
        if kind=='UNKNOWN':raise IntegrationRejected('WALLET_LOGIN_WALLET_KIND_UNAVAILABLE',503)
        if kind!='EOA':raise IntegrationRejected('WALLET_LOGIN_REJECTED',401)
        original=canonical(['wallet',namespace,self.config['chainId'],address])
        subject=hmac.new(self.key,b'CP30_WALLET_SUBJECT_V1\0'+original,hashlib.sha256).hexdigest()
        recipient=hmac.new(self.key,b'CP30_WALLET_RECIPIENT_V1\0'+original,hashlib.sha256).hexdigest()
        session,csrf=secrets.token_urlsafe(32),secrets.token_urlsafe(32)
        command={'challenge_id':body['challengeId'],'expected_challenge':challenge,'subject_hash':subject,
            'recipient_key':recipient,'wallet_address':address,'chain_id':self.config['chainId'],
            'expires_at':min(now+self.config['sessionTtlSeconds'],self.config['activationExpiresAt']),'pre_hash':context.get('pre_hash'),
            'csrf_hash':context.get('csrf_hash'),'new_session_hash':digest(session),'new_csrf_hash':digest(csrf),
            'evidence_digest':hashlib.sha256(canonical({'challenge':challenge,'signature':body['signature']})).hexdigest()}
        result=self.controller.call(namespace,'wallet_login',{'mutation_id':str(uuid.uuid4()),'command':command})
        if result.get('error'):return result
        return {**result,'sessionToken':session,'csrfToken':csrf}
