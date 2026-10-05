"""Immutable CP19 deployment, CP22 derivation and issuance checks, without signers."""
import re
from eth_abi import encode, decode
from eth_utils import keccak
from server.testnet_readonly.identity import MANIFEST

ADDRESS=MANIFEST['contractAddress']
RULE=MANIFEST['ruleVersion']
OPERATOR='0xc23581f5656247057213bfafd279732993728c80'
BATCH='0x49d1be5e541373cf963d09f5d24de2f8a1976597e5d6ee5ddeb5da4f3d56e854'
ISSUER='0x'+keccak(text='ISSUER_ROLE').hex()
ISSUED='0x'+keccak(text='Issued(bytes32,bytes32,bytes32[])').hex()
PRICE=10**15
GAS_CAP=250000
MAX_FEE=200*10**9
TIP=2*10**9
ZERO='0x'+'00'*32

class IssuanceError(Exception):
    def __init__(self, code, status=409): self.code,self.status=code,status; super().__init__(code)

def rpc_number(value):
    if not isinstance(value,str) or not re.fullmatch(r'0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})',value): raise IssuanceError('RPC_PROTOCOL',503)
    return int(value,16)

def hex_data(value,size=None):
    if not isinstance(value,str) or not re.fullmatch(r'0x(?:[0-9a-fA-F]{2})*',value) or (size is not None and len(value)!=size*2+2): raise IssuanceError('INVALID_HEX',422)
    return bytes.fromhex(value[2:])

def address(value):
    hex_data(value,20)
    if int(value,16)==0: raise IssuanceError('INVALID_ADDRESS',422)
    return value.lower()

SIGNATURES={
 'issue':(['bytes32','bytes32','bytes32[]'],[]), 'hasRole':(['bytes32','address'],['bool']),
 'getBatch':(['bytes32'],['uint256']*7), 'getVoucher':(['bytes32'],['bytes32','uint8','bytes32']),
 'getOperation':(['uint8','bytes32'],['bytes32','bytes32']),
 'merchant':([],['address']), 'ruleVersion':([],['bytes32']), 'priceWei':([],['uint256']),
 'fundingCapWei':([],['uint256']), 'maxQuantity':([],['uint256']), 'recoveryEnabled':([],['bool']),
 'paused':([],['bool']), 'totalFunded':([],['uint256']), 'liability':([],['uint256'])}

def encode_call(name,args):
    types=SIGNATURES[name][0]
    values=[hex_data(v) if t.startswith('bytes') and isinstance(v,str) else v for t,v in zip(types,args)]
    if len(args)!=len(types): raise IssuanceError('INVALID_ARGUMENTS')
    return '0x'+(keccak(text=name+'('+','.join(types)+')')[:4]+encode(types,values)).hex()

def contract_read(rpc,name,args,block='latest'):
    tag=hex(block) if type(block) is int else block
    try: return decode(SIGNATURES[name][1],hex_data(rpc.call('eth_call',[{'to':ADDRESS,'data':encode_call(name,args)},tag])))
    except IssuanceError: raise
    except Exception: raise IssuanceError('CONTRACT_PROTOCOL',503) from None

def block(rpc,tag):
    b=rpc.call('eth_getBlockByNumber',[hex(tag) if type(tag) is int else tag,False])
    if not isinstance(b,dict): raise IssuanceError('BLOCK_UNAVAILABLE',503)
    n=rpc_number(b.get('number'));hex_data(b.get('hash'),32)
    if type(tag) is int and n!=tag: raise IssuanceError('BLOCK_CONFLICT')
    return b

def guard(rpc,height=None):
    if rpc_number(rpc.call('eth_chainId',[]))!=10143: raise IssuanceError('WRONG_CHAIN')
    if block(rpc,0)['hash'].lower()!=MANIFEST['genesisHash']: raise IssuanceError('GENESIS_CONFLICT')
    tag='latest' if height is None else hex(height)
    if '0x'+keccak(hex_data(rpc.call('eth_getCode',[ADDRESS,tag]))).hex()!=MANIFEST['runtimeCodeHash']: raise IssuanceError('CODE_CONFLICT')
    expected={'merchant':MANIFEST['merchant'].lower(),'ruleVersion':hex_data(RULE),'priceWei':PRICE,
              'fundingCapWei':10**16,'maxQuantity':3,'recoveryEnabled':False}
    for name,value in expected.items():
        if contract_read(rpc,name,[],tag)[0]!=value: raise IssuanceError('IDENTITY_CONFLICT')

def derive(issuance_id):
    """Deterministic CP22 domain derivation; identical inputs can never yield a second identity."""
    hex_data(issuance_id,32)
    return ('0x'+keccak(text='mealforward-cp22:'+issuance_id).hex(),
            '0x'+keccak(text='mealforward-cp22:voucher:'+issuance_id+':0').hex())

def issue_data(operation_id,batch_id,voucher_id):
    return encode_call('issue',[operation_id,batch_id,[hex_data(voucher_id,32)]])

def payload_hash(batch_id,voucher_ids):
    """Mirrors the contract's _record(1,...) payloadHash over (batchId, voucherIds)."""
    return '0x'+keccak(encode(['bytes32','bytes32[]'],[hex_data(batch_id,32),[hex_data(v,32) for v in voucher_ids]])).hex()

def verify_transaction(tx,expected,*,check_budget=True):
    if not isinstance(tx,dict): raise IssuanceError('TRANSACTION_UNAVAILABLE',503)
    for key in ('from','to'):
        if str(tx.get(key,'')).lower()!=expected[key].lower(): raise IssuanceError('TRANSACTION_CONFLICT')
    if str(tx.get('input',tx.get('data',''))).lower()!=expected['data'].lower(): raise IssuanceError('TRANSACTION_CONFLICT')
    for key in ('chainId','nonce','value'):
        wanted=rpc_number(expected[key]) if isinstance(expected[key],str) else expected[key]
        if rpc_number(tx.get(key))!=wanted: raise IssuanceError('TRANSACTION_CONFLICT')
    for key in ('gas','maxFeePerGas','maxPriorityFeePerGas'):
        limit=rpc_number(expected[key]) if isinstance(expected[key],str) else expected[key]
        actual=rpc_number(tx.get(key))
        if check_budget and actual>limit: raise IssuanceError('BUDGET_EXCEEDED')
    if rpc_number(tx.get('type'))!=2: raise IssuanceError('TRANSACTION_CONFLICT')

def verify_observed_transaction(tx,data):
    """Identity-only check for the observer: budget classification stays separate (P2-01)."""
    if not isinstance(tx,dict): raise IssuanceError('TRANSACTION_UNAVAILABLE',503)
    if str(tx.get('from','')).lower()!=OPERATOR: raise IssuanceError('TRANSACTION_CONFLICT')
    if str(tx.get('to','')).lower()!=ADDRESS.lower(): raise IssuanceError('TRANSACTION_CONFLICT')
    if str(tx.get('input',tx.get('data',''))).lower()!=data.lower(): raise IssuanceError('TRANSACTION_CONFLICT')
    if rpc_number(tx.get('chainId'))!=10143 or rpc_number(tx.get('value'))!=0 or rpc_number(tx.get('type'))!=2: raise IssuanceError('TRANSACTION_CONFLICT')

def issued_log(log,operation_id,batch_id,voucher_id):
    try:
        return (isinstance(log,dict) and log.get('removed') is not True and
                log.get('address','').lower()==ADDRESS.lower() and
                [x.lower() for x in log['topics']]==[ISSUED,operation_id.lower(),batch_id.lower()] and
                list(decode(['bytes32[]'],hex_data(log['data']))[0])==[hex_data(voucher_id,32)])
    except (KeyError,TypeError,ValueError,IssuanceError): return False
