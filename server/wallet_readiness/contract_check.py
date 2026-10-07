"""CP27 fixed historical code/role observations; no generic eth_call proxy."""
import re
import time
from eth_utils import keccak
from .check import ReadRpc,CheckError,METHODS,ADDRESS,block,inspect,item
from .manifest import load_manifest,context,ROLE_NAMES


def calldata(manifest,address):
    return ['0x7593a0eb','0xa5ff7651','0x5c975abb']+[
        '0x91d14854'+manifest['roleIds'][role][2:]+address[2:].lower().rjust(64,'0') for role in ROLE_NAMES]

class ContractRpc(ReadRpc):
    methods=METHODS|{'eth_call'}
    max_calls=18
    def __init__(self,*args,**kwargs):
        super().__init__(*args,**kwargs);self.allowed_calls=[]
    def authorize_context(self,manifest,address,tag):
        self.allowed_calls=[[{'to':manifest['contractAddress'],'data':data,'gas':'0x186a0'},tag] for data in calldata(manifest,address)]
    def validate(self,method,params):
        if method=='eth_call' and params not in self.allowed_calls:raise CheckError('CALL_DENIED')


def word(value):
    if not isinstance(value,str) or not re.fullmatch(r'0x[0-9a-fA-F]{64}',value):raise CheckError('CALL_SCHEMA')
    return value.lower()

def boolean(value):
    value=int(word(value),16)
    if value not in (0,1):raise CheckError('CALL_SCHEMA')
    return bool(value)

def merchant(value):
    value=word(value)
    if value[2:26]!='0'*24 or int(value,16)==0:raise CheckError('CALL_SCHEMA')
    return '0x'+value[26:]

async def inspect_contract(rpc,address,now=time.time,loader=load_manifest):
    if not isinstance(address,str) or not ADDRESS.fullmatch(address):raise CheckError('INVALID_ADDRESS')
    # Manifest trust is resolved before any dependent code/role RPC, without
    # suppressing independently useful basic observations if it is unavailable.
    manifest=None;reason='MANIFEST_NOT_CONFIGURED'
    try:manifest=loader()
    except CheckError as e:reason=str(e)
    result=await inspect(rpc,address,now=now)
    result.update(manifest=context(manifest) if manifest else None,newBusinessTarget=None)
    result['deployment']=item('NOT_CHECKED' if manifest else 'NOT_CONFIGURED',reason if not manifest else 'BASE_INCOMPLETE')
    result['roles']=item('NOT_CHECKED',reason if not manifest else 'BASE_INCOMPLETE')
    if not manifest or result['network']['status']!='PASS':return result
    observed=result['block'];tag=hex(observed['number'])
    try:
        code=await rpc.call('eth_getCode',[manifest['contractAddress'],tag])
        if not isinstance(code,str) or not re.fullmatch(r'0x(?:[0-9a-fA-F]{2})*',code):raise CheckError('RPC_SCHEMA')
        actual_hash='0x'+keccak(bytes.fromhex(code[2:])).hex()
        if actual_hash!=manifest['expectedRuntimeKeccak']:raise CheckError('RUNTIME_MISMATCH')
        result['deployment']=item('PASS','HISTORICAL_CODE_MATCH',runtimeKeccak=actual_hash)
        rpc.authorize_context(manifest,address,tag)
        calls=calldata(manifest,address)
        async def call(index):
            return await rpc.call('eth_call',[{'to':manifest['contractAddress'],'data':calls[index],'gas':'0x186a0'},tag])
        rule=word(await call(0))
        if rule!=manifest['expectedRuleVersion']:raise CheckError('RULE_MISMATCH')
        recipient=merchant(await call(1))
        if recipient!=manifest['expectedMerchant'].lower():raise CheckError('MERCHANT_MISMATCH')
        paused=boolean(await call(2))
        roles={role:boolean(await call(i+3)) for i,role in enumerate(ROLE_NAMES)}
        canonical=block(await rpc.call('eth_getBlockByNumber',[tag,False]))
        if canonical!=observed:raise CheckError('BLOCK_CONFLICT')
        if now()>=result['expiresAt']:raise CheckError('OBSERVATION_EXPIRED')
        result['roles']=item('OBSERVED','HISTORICAL_ROLES_OBSERVED',values=roles,merchant=recipient,merchantMatches=recipient==address.lower(),paused=paused,ruleVersion=rule)
        result['checkedAt']=now()
    except CheckError as e:
        reason=str(e)
        result['roles']=item('NOT_CHECKED',reason)
        if reason in ('BLOCK_CONFLICT','OBSERVATION_EXPIRED'):
            result['network']=item('FAIL',reason);result['account']=item('NOT_CHECKED',reason)
            result['deployment']=item('NOT_CHECKED',reason);result['checkedAt']=None
            result.pop('block',None);result.pop('latestBlock',None)
        elif result['deployment']['status']!='PASS':result['deployment']=item('FAIL',reason)
    return result
