"""Independent StoreEscrow readonly HTTPS session. Construction performs no network IO."""
from copy import deepcopy
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import time
from urllib.parse import urlsplit

if __package__:
    from .observer import READS, BINDING_FIELDS, PINS, RUNTIME_PIN
else:
    from observer import READS, BINDING_FIELDS, PINS, RUNTIME_PIN


class BusinessTransportError(RuntimeError):
    """Fixed public code only; never echo endpoint, body, calldata or provider errors."""


METHODS = frozenset(('eth_chainId','eth_getBlockByNumber','eth_getCode','eth_getTransactionByHash','eth_getTransactionReceipt','eth_call'))
WORKER_ERRORS = frozenset(('BUSINESS_RPC_TIMEOUT','BUSINESS_RPC_HTTP_REJECTED','BUSINESS_RPC_RESPONSE_REJECTED','BUSINESS_RPC_RESPONSE_LIMIT','BUSINESS_RPC_TIME_LIMIT','BUSINESS_RPC_TLS_FAILED','BUSINESS_RPC_CONNECTION_FAILED','BUSINESS_RPC_WORKER_EXIT'))
_last_rpc_diagnostic = None

def rpc_diagnostic(error,method,started):
    global _last_rpc_diagnostic
    now=time.monotonic()
    if _last_rpc_diagnostic is not None and now-_last_rpc_diagnostic<60:return
    _last_rpc_diagnostic=now
    code=str(error) if str(error) in WORKER_ERRORS else 'BUSINESS_RPC_UNAVAILABLE'
    print('C1_DIAGNOSTIC '+json.dumps({'component':'business_rpc','code':code,'method':method if method in METHODS else 'unknown','elapsedMs':max(0,round((now-started)*1000))}),file=sys.stderr,flush=True)

def worker_failure(output):
    try:
        value=strict_json(output)
        if type(value) is dict and set(value)=={'error'} and value['error'] in WORKER_ERRORS:return value['error']
    except (ValueError,TypeError,BusinessTransportError):pass
    return 'BUSINESS_RPC_WORKER_EXIT'
# Exact original ABI selectors/arguments. No registration selector scope is changed.
READ_ABI = {
 '0x36cfd8ba':('getAccounting',()), '0xed42136f':('getBatch',('bytes32',)),
 '0x279412c5':('getOperation',('bytes32',)), '0x2bb7c0f4':('getUnit',('uint8',)),
 '0x56dcb25e':('getVoucher',('bytes32',)), '0x38d52e0f':('asset',()),
 '0x753c6ae8':('catalogAuthority',()), '0x597e1fb5':('closed',()),
 '0x19d0a9a1':('controlRevision',()), '0x3b426d3f':('currentVersion',('bytes32',)),
 '0xded2363a':('getTerms',('bytes32','uint256')), '0xcbdb6f6a':('issuerAuthority',()),
 '0xbf7e3b60':('listed',('bytes32',)), '0x36f8a86e':('nextCandidate',('bytes32',)),
 '0x3e45b17c':('operationPayloadHash',('uint8','address','bytes32','bytes32')),
 '0x7bbecc95':('operatorAuthority',()), '0x8da5cb5b':('owner',()),
 '0x5c975abb':('paused',()), '0x7a092896':('quoteAuthority',()),
 '0x92b9ba87':('quoteUses',('bytes32',)), '0xf7260d3e':('receiver',()), '0x4e427852':('storeId',()),
}
SEND_ABI = {'0x8c540688':('issuerAuthority',6), '0xd62fcdde':('operatorAuthority',4),
            '0x2debe5d7':('operatorAuthority',5), '0x302897c2':('operatorAuthority',5),
            '0x3daef73e':('owner',3), '0x3cccb50a':('payer',None),
            '0x5e88339b':('catalogAuthority',12), '0x55e80d27':('catalogAuthority',4)}
_ZERO = '0x'+'0'*64


def _fail(code): raise BusinessTransportError(code)

def _pairs(items):
    value={}
    for key,item in items:
        if key in value: _fail('BUSINESS_RPC_JSON_REJECTED')
        value[key]=item
    return value


def strict_json(raw):
    try:
        return json.loads(raw,object_pairs_hook=_pairs,parse_constant=lambda _:(_ for _ in ()).throw(ValueError()))
    except (ValueError,TypeError,UnicodeError): _fail('BUSINESS_RPC_JSON_REJECTED')


def json_bytes(value):
    try: return json.dumps(value,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()
    except (TypeError,ValueError): _fail('BUSINESS_RPC_JSON_REJECTED')


def _word(value):
    return type(value) is str and re.fullmatch(r'0x[0-9a-f]{64}',value) and value!=_ZERO


def _address(value):
    return type(value) is str and re.fullmatch(r'0x[0-9a-f]{40}',value) and int(value[2:],16)!=0


def _quantity(value):
    if type(value) is not str or not re.fullmatch(r'0x(?:0|[1-9a-f][0-9a-f]{0,13})',value): _fail('BUSINESS_RPC_QUANTITY_REJECTED')
    n=int(value,16)
    if n>9007199254740991: _fail('BUSINESS_RPC_QUANTITY_REJECTED')
    return n


def endpoint_config(endpoint,allowed_endpoints,allowed_hosts):
    if (type(endpoint) is not str or len(endpoint)>4096 or type(allowed_endpoints) not in (list,tuple)
        or type(allowed_hosts) not in (list,tuple) or not allowed_hosts or endpoint not in allowed_endpoints
        or any(ord(c)<33 or ord(c)>126 for c in endpoint)): _fail('BUSINESS_RPC_ENDPOINT_REJECTED')
    try:
        parsed=urlsplit(endpoint);host=parsed.hostname
        if (parsed.scheme!='https' or not host or host not in allowed_hosts or parsed.username is not None or parsed.password is not None
            or parsed.fragment or parsed.port not in (None,443) or not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?',host)): raise ValueError()
        return host,parsed.path or '/',parsed.query
    except ValueError: _fail('BUSINESS_RPC_ENDPOINT_REJECTED')


def validate_profile(profile):
    fields={'binding','registrationState','registrationEvidence','genesisHash','finality','eip1898','runtimeTemplatePin','compilerPins','budget'}
    if type(profile) is not dict or set(profile)!=fields: _fail('BUSINESS_RPC_PROFILE_REQUIRED')
    binding=profile['binding']; evidence=profile['registrationEvidence']; budget=profile['budget']
    if type(binding) is not dict or set(binding)!={'chainId',*BINDING_FIELDS}: _fail('BUSINESS_RPC_BINDING_REQUIRED')
    if type(binding['chainId']) is not int or not 1<=binding['chainId']<2**53: _fail('BUSINESS_RPC_BINDING_REQUIRED')
    for key in BINDING_FIELDS:
        if not (_word(binding[key]) if key=='storeId' else _address(binding[key])): _fail('BUSINESS_RPC_BINDING_REQUIRED')
    if binding['owner']!=binding['receiver'] or profile['registrationState']!='CONFIRMED' or type(evidence) is not dict: _fail('BUSINESS_RPC_REGISTERED_EVIDENCE_REQUIRED')
    if any(evidence.get(key)!=binding[key] for key in BINDING_FIELDS) or evidence.get('chainId')!=str(binding['chainId']): _fail('BUSINESS_RPC_REGISTERED_EVIDENCE_REQUIRED')
    if any(not _word(evidence.get(k)) for k in ('configHash','parametersDigest','transactionHash','blockHash','registrationId')) or type(evidence.get('deployment')) is not dict or not evidence.get('catalog'): _fail('BUSINESS_RPC_REGISTERED_EVIDENCE_REQUIRED')
    if profile['finality']!='rpc-finalized' or profile['eip1898'] is not True or not _word(profile['genesisHash']) or profile['runtimeTemplatePin']!=RUNTIME_PIN or profile['compilerPins']!=PINS: _fail('BUSINESS_RPC_PROFILE_REJECTED')
    caps={'maxCalls':96,'maxTotalMs':45000,'maxCallMs':5000,'maxResponseBytes':1048576,'maxTotalBytes':1048576,'maxMealIds':3}
    if type(budget) is not dict or set(budget)!=set(caps) or any(type(budget[k]) is not int or not 1<=budget[k]<=cap for k,cap in caps.items()) or budget['maxCallMs']>budget['maxTotalMs']: _fail('BUSINESS_RPC_BUDGET_REJECTED')
    if {name for name,_ in READ_ABI.values()}!=set(READS): _fail('BUSINESS_RPC_ABI_SCOPE_MISMATCH')
    return strict_json(json_bytes(profile))


def validate_original(binding,transaction_hash,deployment):
    if transaction_hash is None and deployment is None: return
    if not _word(transaction_hash) or type(deployment) is not dict or set(deployment)!={'chainId','from','to','value','data','callDataDigest'}: _fail('BUSINESS_RPC_ORIGINAL_REQUIRED')
    if deployment['chainId']!=binding['chainId'] or deployment['to']!=binding['escrow'] or deployment['value']!='0' or not _address(deployment['from']) or not _word(deployment['callDataDigest']): _fail('BUSINESS_RPC_ORIGINAL_REJECTED')
    data=deployment['data']
    if type(data) is not str or not re.fullmatch(r'0x(?:[0-9a-f]{2})+',data) or len(data)>2048 or data[:10] not in SEND_ABI: _fail('BUSINESS_RPC_ORIGINAL_REJECTED')
    role,count=SEND_ABI[data[:10]]
    if role!='payer':
        if len(data)!=10+64*count or deployment['from']!=binding[role]: _fail('BUSINESS_RPC_ORIGINAL_REJECTED')
    else:
        if len(data)!=906 or data[74:98]!='0'*24 or '0x'+data[98:138]!=deployment['from']: _fail('BUSINESS_RPC_ORIGINAL_REJECTED')


def validate_request(method,params,scope):
    binding=scope['binding'];state_hash=scope['stateBlockHash'];original=scope['originalTransactionHash']
    if type(method) is not str or type(params) is not list or method not in METHODS: _fail('BUSINESS_RPC_METHOD_REJECTED')
    if method=='eth_chainId':
        if params: _fail('BUSINESS_RPC_PARAMS_REJECTED')
    elif method in ('eth_getTransactionByHash','eth_getTransactionReceipt'):
        if original is None or params!=[original]: _fail('BUSINESS_RPC_ORIGINAL_REJECTED')
    elif method=='eth_getBlockByNumber':
        if len(params)!=2 or params[1] is not False or (params[0]!='finalized' and _quantity(params[0]) not in scope['allowedBlockNumbers']): _fail('BUSINESS_RPC_BLOCK_REJECTED')
    elif method in ('eth_getCode','eth_call'):
        if len(params)!=2 or not _word(state_hash) or params[1]!={'blockHash':state_hash,'requireCanonical':True}: _fail('BUSINESS_RPC_SNAPSHOT_REJECTED')
        if method=='eth_getCode':
            if params[0]!=binding['escrow']: _fail('BUSINESS_RPC_TARGET_REJECTED')
            return
        call=params[0]
        if type(call) is not dict or set(call)!={'to','data'} or call['to']!=binding['escrow']: _fail('BUSINESS_RPC_TARGET_REJECTED')
        data=call['data']
        if type(data) is not str or not re.fullmatch(r'0x(?:[0-9a-f]{2})+',data) or data[:10] not in READ_ABI: _fail('BUSINESS_RPC_CALLDATA_REJECTED')
        name,inputs=READ_ABI[data[:10]]
        if len(data)!=10+64*len(inputs): _fail('BUSINESS_RPC_CALLDATA_REJECTED')
        words=[data[10+i*64:74+i*64] for i in range(len(inputs))]
        for kind,arg in zip(inputs,words):
            if kind=='bytes32' and int(arg,16)==0: _fail('BUSINESS_RPC_ARGUMENT_REJECTED')
            if kind=='uint8' and int(arg,16)>255: _fail('BUSINESS_RPC_ARGUMENT_REJECTED')
            if kind=='address' and (arg[:24]!='0'*24 or not _address('0x'+arg[24:])): _fail('BUSINESS_RPC_ARGUMENT_REJECTED')
        if name=='getUnit' and int(words[0],16)>9: _fail('BUSINESS_RPC_ARGUMENT_REJECTED')
        if name=='getTerms' and int(words[1],16)==0: _fail('BUSINESS_RPC_ARGUMENT_REJECTED')
        if name=='operationPayloadHash':
            roles={1:'catalogAuthority',2:'catalogAuthority',5:'issuerAuthority',6:'operatorAuthority',7:'operatorAuthority',8:'operatorAuthority',9:'owner'}
            role=roles.get(int(words[0],16))
            if role is None or '0x'+words[1][24:]!=binding[role]: _fail('BUSINESS_RPC_ARGUMENT_REJECTED')


class ReadOnlyBusinessRpcTransport:
    """Fresh per-observation session. Network is invoked only by explicit request()."""
    def __init__(self, *, endpoint, allowed_endpoints, allowed_hosts, python_executable, profile,
                 original_transaction_hash=None, original_deployment=None):
        endpoint_config(endpoint,allowed_endpoints,allowed_hosts)
        self.profile=validate_profile(profile);self.binding=self.profile['binding'];self.budget=self.profile['budget']
        validate_original(self.binding,original_transaction_hash,original_deployment)
        if type(python_executable) is not str or not Path(python_executable).is_absolute() or not Path(python_executable).is_file(): _fail('BUSINESS_RPC_PYTHON_REQUIRED')
        self.endpoint=endpoint;self.allowed_endpoints=tuple(allowed_endpoints);self.allowed_hosts=tuple(allowed_hosts);self.python=python_executable
        self.original_hash=original_transaction_hash;self.deployment=deepcopy(original_deployment)
        self.worker=Path(__file__).resolve().with_name('rpc_worker.py')
        for path,digest in PINS.items():
            if hashlib.sha256((self.worker.parent/path).read_bytes()).hexdigest()!=digest: _fail('BUSINESS_RPC_SOURCE_PIN_MISMATCH')
        self.started=time.monotonic();self.calls=0;self.bytes=0
        self.expected_blocks={0:self.profile['genesisHash']};self.canonical_blocks={}
        self.finalized_height=None;self.receipt_height=None;self.state_hash=None;self.failed=False

    def _scope(self):
        return {'binding':self.binding,'originalTransactionHash':self.original_hash,'stateBlockHash':self.state_hash,'allowedBlockNumbers':list(self.expected_blocks)}

    def _accept_result(self,method,params,result):
        if method=='eth_chainId':
            if _quantity(result)!=self.binding['chainId']: _fail('BUSINESS_RPC_CHAIN_MISMATCH')
        elif method=='eth_getBlockByNumber' and result is not None:
            if type(result) is not dict or not _word(result.get('hash')): _fail('BUSINESS_RPC_HEADER_REJECTED')
            number=_quantity(result.get('number'))
            if params[0]=='finalized':
                self.finalized_height=number
                previous=self.expected_blocks.get(number)
                if previous is not None and previous!=result['hash']: _fail('BUSINESS_RPC_CANONICAL_MISMATCH')
                self.expected_blocks[number]=result['hash']
            else:
                if number!=_quantity(params[0]) or self.expected_blocks.get(number)!=result['hash']: _fail('BUSINESS_RPC_CANONICAL_MISMATCH')
                self.canonical_blocks[result['hash']]=number
        elif method=='eth_getTransactionByHash' and result is not None:
            if type(result) is not dict: _fail('BUSINESS_RPC_ORIGINAL_REJECTED')
            for key,value in (('hash',self.original_hash),('from',self.deployment['from']),('to',self.binding['escrow']),('input',self.deployment['data'])):
                if result.get(key)!=value: _fail('BUSINESS_RPC_ORIGINAL_REJECTED')
            if _quantity(result.get('chainId'))!=self.binding['chainId'] or _quantity(result.get('value'))!=0: _fail('BUSINESS_RPC_ORIGINAL_REJECTED')
        elif method=='eth_getTransactionReceipt' and result is not None:
            if type(result) is not dict or result.get('transactionHash')!=self.original_hash or result.get('from')!=self.deployment['from'] or result.get('to')!=self.binding['escrow']: _fail('BUSINESS_RPC_ORIGINAL_REJECTED')
            number=_quantity(result.get('blockNumber'));block_hash=result.get('blockHash')
            if not _word(block_hash): _fail('BUSINESS_RPC_HEADER_REJECTED')
            previous=self.expected_blocks.get(number)
            if previous is not None and previous!=block_hash: _fail('BUSINESS_RPC_CANONICAL_MISMATCH')
            self.expected_blocks[number]=block_hash;self.receipt_height=number
        return result

    def request(self,method,params,*,deadline):
        if self.failed: _fail('BUSINESS_RPC_SESSION_CLOSED')
        if type(deadline) not in (int,float) or not math.isfinite(deadline): _fail('BUSINESS_RPC_DEADLINE_REQUIRED')
        end=min(deadline,self.started+self.budget['maxTotalMs']/1000,time.monotonic()+self.budget['maxCallMs']/1000)
        if end-time.monotonic()<=0.1: _fail('BUSINESS_RPC_TIME_LIMIT')
        if method in ('eth_getCode','eth_call'):
            requested_hash=params[1].get('blockHash') if type(params) is list and len(params)==2 and type(params[1]) is dict else None
            height=self.canonical_blocks.get(requested_hash)
            if self.finalized_height is None or height is None or height>self.finalized_height or height not in (self.finalized_height,self.receipt_height): _fail('BUSINESS_RPC_SNAPSHOT_REJECTED')
            if self.state_hash is not None and self.state_hash!=requested_hash: _fail('BUSINESS_RPC_SNAPSHOT_CHANGED')
            self.state_hash=requested_hash
        scope=self._scope();validate_request(method,params,scope)
        self.calls+=1
        if self.calls>self.budget['maxCalls']: _fail('BUSINESS_RPC_CALL_LIMIT')
        cap=min(self.budget['maxResponseBytes'],self.budget['maxTotalBytes']-self.bytes)
        if cap<1: _fail('BUSINESS_RPC_RESPONSE_LIMIT')
        packet={'endpoint':self.endpoint,'allowedEndpoints':self.allowed_endpoints,'allowedHosts':self.allowed_hosts,
                'scope':scope,'method':method,'params':params,'id':self.calls,'maxBytes':cap,'deadline':end}
        raw=json_bytes(packet)
        if len(raw)>16384: _fail('BUSINESS_RPC_INPUT_LIMIT')
        proc=None;request_started=time.monotonic()
        try:
            proc=subprocess.Popen([self.python,'-I',str(self.worker)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,
                                  stderr=subprocess.DEVNULL,env={},cwd=str(self.worker.parent))
            output,_=proc.communicate(raw,timeout=max(0.001,end-time.monotonic()-0.1))
            if len(output)>cap+512:_fail('BUSINESS_RPC_RESPONSE_LIMIT')
            if time.monotonic()>end:_fail('BUSINESS_RPC_TIMEOUT')
            if proc.returncode:_fail(worker_failure(output))
            envelope=strict_json(output)
            if type(envelope) is not dict or set(envelope)!={'response','responseBytes'} or type(envelope['responseBytes']) is not int or not 1<=envelope['responseBytes']<=cap: _fail('BUSINESS_RPC_RESPONSE_REJECTED')
            self.bytes+=envelope['responseBytes'];response=envelope['response']
            if type(response) is not dict or set(response)!={'jsonrpc','id','result'} or response['jsonrpc']!='2.0' or type(response['id']) is not int or response['id']!=self.calls: _fail('BUSINESS_RPC_RESPONSE_REJECTED')
            return self._accept_result(method,params,response['result'])
        except BusinessTransportError as error:
            self.failed=True
            rpc_diagnostic(error,method,request_started)
            raise
        except (OSError,subprocess.TimeoutExpired) as error:
            self.failed=True
            code='BUSINESS_RPC_TIMEOUT' if isinstance(error,subprocess.TimeoutExpired) else 'BUSINESS_RPC_WORKER_EXIT'
            rpc_diagnostic(BusinessTransportError(code),method,request_started)
            _fail(code)
        finally:
            if proc is not None:
                if proc.poll() is None: proc.kill()
                try: proc.wait(timeout=0.1)
                except subprocess.TimeoutExpired:
                    self.failed=True
                    _fail('BUSINESS_RPC_CLEANUP_FAILED')
                for pipe in (proc.stdin,proc.stdout):
                    if pipe: pipe.close()
