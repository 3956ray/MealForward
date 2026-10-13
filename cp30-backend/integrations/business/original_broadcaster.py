"""Future private original-only broadcaster. Import/construction performs no HTTP/signing."""
from copy import deepcopy
import math
from pathlib import Path
import re
import subprocess
import threading
import time
from .original_signer import approved_profile, OPERATIONS, canonical, word, uint
from .rpc_transport import BusinessTransportError, endpoint_config, json_bytes, strict_json

PROTOCOL='CP30_ORIGINAL_OPERATION_V1'
ROLES=frozenset(('issuerAuthority','operatorAuthority','catalogAuthority'))
METHODS=frozenset(('eth_chainId','eth_getBlockByNumber','eth_getCode','eth_getTransactionCount','eth_getTransactionByHash','eth_sendRawTransaction'))
_SEND_PERMIT=object()
CAPS={'maxCalls':6,'maxCallMs':3000,'maxTotalMs':20000,'maxResponseBytes':262144,'maxTotalBytes':1048576}

class OriginalBroadcastClosed(ValueError): pass

def fail(code): raise OriginalBroadcastClosed(code)

def profile_config(profile,role):
    if role not in ROLES or type(profile) is not dict or 'genesisHash' not in profile: fail('DEDICATED_BROADCAST_PROFILE_REQUIRED')
    word(profile['genesisHash']);base={k:v for k,v in profile.items() if k!='genesisHash'}
    approved_profile(base,role)
    return deepcopy(profile)

def rpc_config(config):
    if type(config) is not dict or set(config)!={'endpoint','allowedEndpoints','allowedHosts','pythonExecutable','budget'}: fail('DEDICATED_BROADCAST_RPC_REQUIRED')
    try: endpoint_config(config['endpoint'],config['allowedEndpoints'],config['allowedHosts'])
    except BusinessTransportError: fail('BROADCAST_RPC_ENDPOINT_REJECTED')
    if type(config['pythonExecutable']) is not str or not Path(config['pythonExecutable']).is_absolute(): fail('ABSOLUTE_PYTHON_REQUIRED')
    b=config['budget']
    if type(b) is not dict or set(b)!=set(CAPS) or any(type(b[k]) is not int or not 1<=b[k]<=CAPS[k] for k in CAPS) or b['maxCallMs']>b['maxTotalMs']: fail('BROADCAST_RPC_BUDGET_REJECTED')
    return deepcopy(config)

def quantity(value):
    if type(value) is not str or not re.fullmatch(r'0x(?:0|[1-9a-f][0-9a-f]{0,63})',value): fail('BROADCAST_RPC_QUANTITY_REJECTED')
    return int(value,16)

def validate_scope(scope):
    if type(scope) is not dict or set(scope)!={'profile','role','transactionHash','raw','stateBlockHash','stateBlockNumber'}: fail('BROADCAST_RPC_SCOPE_REJECTED')
    p=profile_config(scope['profile'],scope['role'])
    if scope['transactionHash'] is not None: word(scope['transactionHash'])
    if scope['raw'] is not None:
        if scope['transactionHash'] is None or type(scope['raw']) is not str or not re.fullmatch(r'0x02(?:[0-9a-f]{2})+',scope['raw']) or len(scope['raw'])>16384: fail('BROADCAST_RAW_REJECTED')
    if scope['stateBlockHash'] is not None: word(scope['stateBlockHash']);quantity(scope['stateBlockNumber'])
    elif scope['stateBlockNumber'] is not None: fail('BROADCAST_RPC_SCOPE_REJECTED')
    return p

def validate_request(method,params,scope):
    p=validate_scope(scope);b=p['binding']
    if type(method) is not str or method not in METHODS or type(params) is not list: fail('BROADCAST_RPC_METHOD_REJECTED')
    allowed=False
    if method=='eth_chainId': allowed=params==[]
    elif method=='eth_getBlockByNumber': allowed=params in (['0x0',False],['finalized',False]) or (scope['stateBlockNumber'] is not None and params==[scope['stateBlockNumber'],False])
    elif method=='eth_getCode': allowed=scope['stateBlockHash'] is not None and params==[b['escrow'],{'blockHash':scope['stateBlockHash'],'requireCanonical':True}]
    elif method=='eth_getTransactionCount': allowed=params==[b[scope['role']],'pending']
    elif method=='eth_getTransactionByHash': allowed=scope['transactionHash'] is not None and params==[scope['transactionHash']]
    elif method=='eth_sendRawTransaction': allowed=scope['raw'] is not None and params==[scope['raw']]
    if not allowed: fail('BROADCAST_RPC_PARAMETER_REJECTED')

class OriginalBroadcastRpcSession:
    """One owned six-call session. Production HTTP is isolated in its short-lived worker."""
    def __init__(self,*,config,profile,role,deadline,transaction_hash=None,raw=None,_permit=None):
        if raw is not None and _permit is not _SEND_PERMIT: fail('VERIFIED_ORIGINAL_RAW_REQUIRED')
        self.config=rpc_config(config);self.profile=profile_config(profile,role);self.role=role
        self.end=min(deadline,time.monotonic()+self.config['budget']['maxTotalMs']/1000)
        self.scope={'profile':self.profile,'role':role,'transactionHash':transaction_hash,'raw':raw,'stateBlockHash':None,'stateBlockNumber':None}
        validate_scope(self.scope);self.calls=0;self.bytes=0;self.failed=False;self.sent=False
        self.worker=Path(__file__).with_name('broadcast_rpc_worker.py')
    def request(self,method,params):
        try: return self._request(method,params)
        except Exception:
            self.failed=True
            raise OriginalBroadcastClosed('BROADCAST_RPC_UNAVAILABLE') from None
    def _request(self,method,params):
        if self.failed or self.sent: fail('BROADCAST_RPC_SESSION_CLOSED')
        b=self.config['budget'];end=min(self.end,time.monotonic()+b['maxCallMs']/1000)
        if end-time.monotonic()<0.15: fail('BROADCAST_RPC_TIME_LIMIT')
        validate_request(method,params,self.scope);self.calls+=1
        if self.calls>b['maxCalls']: fail('BROADCAST_RPC_CALL_LIMIT')
        cap=min(b['maxResponseBytes'],b['maxTotalBytes']-self.bytes)
        if cap<1: fail('BROADCAST_RPC_RESPONSE_LIMIT')
        packet={**{k:self.config[k] for k in ('endpoint','allowedEndpoints','allowedHosts')},'scope':deepcopy(self.scope),'method':method,'params':params,'id':self.calls,'maxBytes':cap,'deadline':end}
        raw=json_bytes(packet)
        if len(raw)>32768: fail('BROADCAST_RPC_INPUT_LIMIT')
        proc=None
        if method=='eth_sendRawTransaction': self.sent=True  # Even a timeout never permits another send.
        try:
            proc=subprocess.Popen([self.config['pythonExecutable'],'-I',str(self.worker)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env={},cwd=str(self.worker.parent))
            output,_=proc.communicate(raw,timeout=max(0.001,end-time.monotonic()-0.1))
            if proc.returncode or time.monotonic()>end or len(output)>cap+512: fail('BROADCAST_RPC_UNAVAILABLE')
            frame=strict_json(output)
            if type(frame) is not dict or set(frame)!={'response','responseBytes'} or type(frame['responseBytes']) is not int or not 1<=frame['responseBytes']<=cap: fail('BROADCAST_RPC_RESPONSE_REJECTED')
            self.bytes+=frame['responseBytes'];r=frame['response']
            if type(r) is not dict or set(r)!={'jsonrpc','id','result'} or r['jsonrpc']!='2.0' or type(r['id']) is not int or r['id']!=self.calls: fail('BROADCAST_RPC_RESPONSE_REJECTED')
            value=r['result']
            if method=='eth_getBlockByNumber' and params==['finalized',False]:
                if type(value) is not dict: fail('BROADCAST_FINALIZED_UNKNOWN')
                word(value.get('hash'));quantity(value.get('number'));self.scope.update(stateBlockHash=value['hash'],stateBlockNumber=value['number'])
            return value
        finally:
            if proc is not None:
                if proc.poll() is None: proc.kill()
                try: proc.wait(timeout=0.1)
                except subprocess.TimeoutExpired: fail('BROADCAST_RPC_CLEANUP_FAILED')
                for pipe in (proc.stdin,proc.stdout):
                    if pipe: pipe.close()

_HASH_JS="import {keccak256} from 'viem'; let s='';for await(const c of process.stdin)s+=c;process.stdout.write(keccak256(JSON.parse(s)));"

class DedicatedBusinessBroadcaster:
    original_lookup_protocol=PROTOCOL
    def __init__(self,*,role,profile,business_codec,transaction_crypto,rpc_config,before_broadcast,node_executable):
        self.profile=profile_config(profile,role);self.role=role;self.account=self.profile['binding'][role]
        self.config=globals()['rpc_config'](rpc_config)
        if not callable(getattr(business_codec,'call',None)) or getattr(transaction_crypto,'transaction_codec_protocol',None)!='CP30_CANONICAL_SIGNED_TRANSACTION_V1' or any(not callable(getattr(transaction_crypto,k,None)) for k in ('prepare_original_envelope','inspect_signed_transaction')) or not callable(before_broadcast) or type(node_executable) is not str or not Path(node_executable).is_absolute(): fail('DEDICATED_BROADCAST_ADAPTER_REQUIRED')
        self.business,self.crypto,self.before_broadcast,self.node=business_codec,transaction_crypto,before_broadcast,node_executable
        self.attempts=set();self.lock=threading.RLock()
    def _original(self,record):
        if type(record) is not dict or len(canonical(record))>131072 or any(record.get(k)!=self.profile[k] for k in ('namespace','binding','escrowCodeHash','chainProfileDigest')): fail('BROADCAST_ORIGINAL_SCOPE_REJECTED')
        operation=record.get('operation');config=OPERATIONS.get(operation)
        if config is None or config[0]!=self.role: fail('BROADCAST_OPERATION_FORBIDDEN')
        prepared=self.business.call(config[1],{'binding':record['binding'],'caller':self.account,'parameters':record['parameters'],'now':'0'})
        if prepared!=record.get('deployment') or prepared.get('opId')!=word(record.get('opId')) or prepared.get('expectedRole')!=self.role or prepared.get('functionName')!=operation or prepared.get('from')!=self.account or prepared.get('to')!=self.profile['binding']['escrow'] or prepared.get('chainId')!=self.profile['binding']['chainId'] or prepared.get('value')!='0': fail('BROADCAST_ORIGINAL_DESCRIPTOR_MISMATCH')
        for key in ('paramsDigest','parametersHash','callDataDigest'): word(prepared.get(key))
        plan=record.get('transaction')
        if type(plan) is not dict or set(plan)!={'nonce','gas','maxFeePerGas','maxPriorityFeePerGas'}: fail('BROADCAST_ORIGINAL_PLAN_REJECTED')
        values={k:uint(v) for k,v in plan.items()}
        if values['nonce']>=2**53 or not 0<values['gas']<=uint(self.profile['maxGas']) or not 0<values['maxFeePerGas']<=uint(self.profile['maxFeePerGas']) or values['maxPriorityFeePerGas']>min(values['maxFeePerGas'],uint(self.profile['maxPriorityFeePerGas'])) or values['gas']*values['maxFeePerGas']>uint(self.profile['maxTransactionCostWei']): fail('BROADCAST_ORIGINAL_CAP_REJECTED')
        # Actual approved grant, when present, is an additional bound rather than caller authority.
        budget=self.profile['maxTransactionCostWei']
        if 'grant' in record:
            budget=record['grant']['gasUnits']
            if uint(budget)>uint(self.profile['maxTransactionCostWei']) or values['gas']*values['maxFeePerGas']>uint(budget): fail('BROADCAST_ORIGINAL_BUDGET_REJECTED')
        return self.crypto.prepare_original_envelope(prepared,{'type':'eip1559',**plan,'gasBudgetWei':budget})
    def _runtime_hash(self,code,end):
        if type(code) is not str or not re.fullmatch(r'0x(?:[0-9a-f]{2})+',code) or len(code)>49154: fail('BROADCAST_RUNTIME_CODE_REJECTED')
        result=subprocess.run([self.node,'--input-type=module','-e',_HASH_JS],input=json_bytes(code),stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env={},cwd=str(Path(__file__).resolve().parent),timeout=min(2,max(0.001,end-time.monotonic())),check=False)
        if result.returncode or len(result.stdout)!=66 or time.monotonic()>end: fail('BROADCAST_RUNTIME_CHECK_UNAVAILABLE')
        return word(result.stdout.decode('ascii'))
    def _session(self,end,transaction_hash=None,raw=None):
        return OriginalBroadcastRpcSession(config=self.config,profile=self.profile,role=self.role,deadline=end,transaction_hash=transaction_hash,raw=raw,_permit=_SEND_PERMIT)
    def _checked_rpc(self,end,transaction_hash=None,raw=None):
        rpc=self._session(end,transaction_hash,raw)
        if quantity(rpc.request('eth_chainId',[]))!=self.profile['binding']['chainId']: fail('BROADCAST_CHAIN_MISMATCH')
        genesis=rpc.request('eth_getBlockByNumber',['0x0',False])
        if type(genesis) is not dict or genesis.get('hash')!=self.profile['genesisHash'] or quantity(genesis.get('number'))!=0: fail('BROADCAST_GENESIS_MISMATCH')
        finalized=rpc.request('eth_getBlockByNumber',['finalized',False])
        if type(finalized) is not dict: fail('BROADCAST_FINALIZED_UNKNOWN')
        word(finalized.get('hash'));quantity(finalized.get('number'))
        canonical_block=rpc.request('eth_getBlockByNumber',[finalized['number'],False])
        if type(canonical_block) is not dict or canonical_block.get('number')!=finalized['number'] or canonical_block.get('hash')!=finalized['hash']: fail('BROADCAST_CANONICAL_MISMATCH')
        code=rpc.request('eth_getCode',[self.profile['binding']['escrow'],{'blockHash':finalized['hash'],'requireCanonical':True}])
        if self._runtime_hash(code,end)!=self.profile['escrowCodeHash']: fail('BROADCAST_RUNTIME_CODE_MISMATCH')
        return rpc
    def pending_nonce(self):
        """Decimal locator for Main admission; never selects/replaces a transaction nonce."""
        end=time.monotonic()+self.config['budget']['maxTotalMs']/1000
        result=quantity(self._checked_rpc(end).request('eth_getTransactionCount',[self.account,'pending']))
        if result>=2**53: fail('BROADCAST_NONCE_REJECTED')
        return str(result)
    def broadcast_original(self,raw,transaction_hash,record):
        end=time.monotonic()+self.config['budget']['maxTotalMs']/1000;record=deepcopy(record)
        expected=self._original(record);word(transaction_hash)
        if type(raw) is not str or not re.fullmatch(r'0x02(?:[0-9a-f]{2})+',raw) or len(raw)>16384: fail('BROADCAST_RAW_REJECTED')
        if self.crypto.inspect_signed_transaction(raw,expected).get('hash')!=transaction_hash: fail('BROADCAST_ORIGINAL_RAW_HASH_MISMATCH')
        rpc=self._checked_rpc(end,transaction_hash,raw)
        with self.lock:
            key=(self.account,record['transaction']['nonce'])
            if key in self.attempts: fail('ORIGINAL_BROADCAST_UNKNOWN')
            self.before_broadcast(deepcopy(record))  # Trusted DB callback; Main owns durable winner/admission.
            if time.monotonic()>=end: fail('BROADCAST_RPC_TIME_LIMIT')
            self.attempts.add(key)  # Before send, retained even on uncertain/error result.
            try:
                result=rpc.request('eth_sendRawTransaction',[raw])
                if result!=transaction_hash: fail('BROADCAST_ORIGINAL_HASH_MISMATCH')
                return transaction_hash  # Locator only, never finality/funds/success.
            except Exception: raise OriginalBroadcastClosed('ORIGINAL_BROADCAST_UNKNOWN') from None
    def lookup_original(self,record,transaction_hash):
        end=time.monotonic()+self.config['budget']['maxTotalMs']/1000;record=deepcopy(record)
        self._original(record);word(transaction_hash)
        observed=self._checked_rpc(end,transaction_hash).request('eth_getTransactionByHash',[transaction_hash])
        if observed is None: return None
        d=record['deployment'];p=record['transaction']
        if type(observed) is not dict or observed.get('hash')!=transaction_hash or observed.get('from')!=d['from'] or observed.get('to')!=d['to'] or observed.get('input')!=d['data'] or quantity(observed.get('chainId'))!=d['chainId'] or quantity(observed.get('value'))!=0 or quantity(observed.get('type'))!=2 or observed.get('accessList')!=[]: fail('BROADCAST_LOOKUP_ORIGINAL_MISMATCH')
        for field in ('nonce','gas','maxFeePerGas','maxPriorityFeePerGas'):
            if quantity(observed.get(field))!=uint(p[field]): fail('BROADCAST_LOOKUP_ORIGINAL_MISMATCH')
        return transaction_hash
