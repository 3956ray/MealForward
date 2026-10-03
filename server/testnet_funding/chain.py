"""Immutable CP19 deployment and CP21 transaction checks, without signers."""
import re
from eth_abi import encode, decode
from eth_utils import keccak
from server.testnet_readonly.identity import MANIFEST

ADDRESS=MANIFEST['contractAddress']
ADMIN='0x16B4052BEFbB8125a6FC59A0a39e40B95A5EF7C9'
RULE=MANIFEST['ruleVersion']
SUPPORTER='0x'+keccak(text='SUPPORTER_ROLE').hex()
PRICE=10**15
MAX_FEE=200*10**9
TIP=2*10**9
ZERO='0x'+'00'*32
FUNDED='0x'+keccak(text='Funded(bytes32,address,bytes32,uint256)').hex()

class FundingError(Exception):
    def __init__(self, code, status=409): self.code,self.status=code,status; super().__init__(code)

def rpc_number(value):
    if not isinstance(value,str) or not re.fullmatch(r'0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})',value): raise FundingError('RPC_PROTOCOL',503)
    return int(value,16)

def hex_data(value,size=None):
    if not isinstance(value,str) or not re.fullmatch(r'0x(?:[0-9a-fA-F]{2})*',value) or (size is not None and len(value)!=size*2+2): raise FundingError('INVALID_HEX',422)
    return bytes.fromhex(value[2:])

def address(value):
    hex_data(value,20)
    if int(value,16)==0: raise FundingError('INVALID_ADDRESS',422)
    return value.lower()

SIGNATURES={
 'fund':(['bytes32','uint256','bytes32'],[]), 'grantRole':(['bytes32','address'],[]),
 'hasRole':(['bytes32','address'],['bool']), 'fundedBatch':(['address','bytes32'],['bytes32']),
 'getBatch':(['bytes32'],['uint256']*7),
 'merchant':([],['address']), 'ruleVersion':([],['bytes32']), 'priceWei':([],['uint256']),
 'fundingCapWei':([],['uint256']), 'maxQuantity':([],['uint256']), 'recoveryEnabled':([],['bool']),
 'paused':([],['bool']), 'totalFunded':([],['uint256']), 'liability':([],['uint256'])}

def encode_call(name,args):
    types=SIGNATURES[name][0]
    values=[hex_data(v) if t.startswith('bytes') and isinstance(v,str) else v for t,v in zip(types,args)]
    if len(args)!=len(types): raise FundingError('INVALID_ARGUMENTS')
    return '0x'+(keccak(text=name+'('+','.join(types)+')')[:4]+encode(types,values)).hex()

def contract_read(rpc,name,args,block='latest'):
    tag=hex(block) if type(block) is int else block
    try: return decode(SIGNATURES[name][1],hex_data(rpc.call('eth_call',[{'to':ADDRESS,'data':encode_call(name,args)},tag])))
    except FundingError: raise
    except Exception: raise FundingError('CONTRACT_PROTOCOL',503) from None

def block(rpc,tag):
    b=rpc.call('eth_getBlockByNumber',[hex(tag) if type(tag) is int else tag,False])
    if not isinstance(b,dict): raise FundingError('BLOCK_UNAVAILABLE',503)
    n=rpc_number(b.get('number'));hex_data(b.get('hash'),32)
    if type(tag) is int and n!=tag: raise FundingError('BLOCK_CONFLICT')
    return b

def guard(rpc,height=None):
    if rpc_number(rpc.call('eth_chainId',[]))!=10143: raise FundingError('WRONG_CHAIN')
    if block(rpc,0)['hash'].lower()!=MANIFEST['genesisHash']: raise FundingError('GENESIS_CONFLICT')
    tag='latest' if height is None else hex(height)
    if '0x'+keccak(hex_data(rpc.call('eth_getCode',[ADDRESS,tag]))).hex()!=MANIFEST['runtimeCodeHash']: raise FundingError('CODE_CONFLICT')
    expected={'merchant':MANIFEST['merchant'].lower(),'ruleVersion':hex_data(RULE),'priceWei':PRICE,
              'fundingCapWei':10**16,'maxQuantity':3,'recoveryEnabled':False}
    for name,value in expected.items():
        if contract_read(rpc,name,[],tag)[0]!=value: raise FundingError('IDENTITY_CONFLICT')

def verify_transaction(tx,expected,*,check_budget=True):
    if not isinstance(tx,dict): raise FundingError('TRANSACTION_UNAVAILABLE',503)
    for key in ('from','to'):
        if str(tx.get(key,'')).lower()!=expected[key].lower(): raise FundingError('TRANSACTION_CONFLICT')
    if str(tx.get('input',tx.get('data',''))).lower()!=expected['data'].lower(): raise FundingError('TRANSACTION_CONFLICT')
    for key in ('chainId','nonce','value'):
        wanted=rpc_number(expected[key]) if isinstance(expected[key],str) else expected[key]
        if rpc_number(tx.get(key))!=wanted: raise FundingError('TRANSACTION_CONFLICT')
    for key in ('gas','maxFeePerGas','maxPriorityFeePerGas'):
        limit=rpc_number(expected[key]) if isinstance(expected[key],str) else expected[key]
        actual=rpc_number(tx.get(key))
        if check_budget and actual>limit: raise FundingError('BUDGET_EXCEEDED')
    if rpc_number(tx.get('type'))!=2: raise FundingError('TRANSACTION_CONFLICT')


def funded_log(log,intent,payer,batch_id,amount=PRICE):
    try:
        return (isinstance(log,dict) and log.get('removed') is not True and
                log.get('address','').lower()==ADDRESS.lower() and
                [x.lower() for x in log['topics']]==[FUNDED,batch_id.lower(),'0x'+payer[2:].lower().rjust(64,'0'),intent.lower()] and
                decode(['uint256'],hex_data(log['data']))[0]==amount)
    except (KeyError,TypeError,ValueError,FundingError): return False
